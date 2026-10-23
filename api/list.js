// The shared list. GET returns everything (and pulls in anything waiting in
// the Keep inbox). POST applies one change: { op: 'add' | 'update' | ... }.
//
// Each household has its own list. The original household uses FAMILY_CODE and
// the plain keys (items, catalog, ...). Invited households get their own code
// and keys prefixed with "h:<id>:".
const { cmd, pipeline, multi } = require('./_redis');
const Catalog = require('../public/catalog.js');

const MAX_HISTORY = 8; // purchase dates remembered per item
const WORDS = ['kale', 'riot', 'mosh', 'skull', 'gravy', 'spud', 'chorizo', 'feral', 'salami', 'pogo', 'snag', 'fist',
  'turnip', 'stomp', 'pickle', 'crust', 'leek', 'amp', 'chilli', 'thrash', 'mango', 'radish', 'chant', 'wombat'];

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Which household is this? Returns { ns, name, home } or null.
async function household(req) {
  const code = String(req.headers['x-family-code'] || '').trim().toLowerCase();
  const home = String(process.env.FAMILY_CODE || '').trim().toLowerCase();
  if (!home || code === home) return { ns: '', name: 'Home', home: true };
  if (!code) return null;
  const raw = await cmd('HGET', 'households', code);
  if (!raw) return null;
  try {
    const h = JSON.parse(raw);
    return { ns: `h:${h.id}:`, name: h.name, home: false };
  } catch { return null; }
}

function parseHash(arr) {
  // Upstash returns HGETALL as a flat [k, v, k, v] array
  const out = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) {
    try { out[arr[i]] = JSON.parse(arr[i + 1]); } catch { /* skip junk */ }
  }
  return out;
}

function cleanOrder(order) {
  const o = (Array.isArray(order) ? order : []).filter((s) => Catalog.SECTIONS.includes(s));
  for (const s of Catalog.SECTIONS) if (!o.includes(s)) o.push(s);
  return o;
}

const clampPri = (p) => Math.max(0, Math.min(2, Math.round(Number(p) || 0)));

async function loadAll(ns) {
  const [items, catalog, meta, shops, bonus] = await pipeline([
    ['HGETALL', ns + 'items'], ['HGETALL', ns + 'catalog'], ['GET', ns + 'meta'], ['HGETALL', ns + 'shops'], ['GET', ns + 'bonus'],
  ]);
  let m = {};
  try { m = JSON.parse(meta || '{}') || {}; } catch {}
  let b = null;
  try { b = bonus ? JSON.parse(bonus) : null; } catch { b = null; }
  if (!b || typeof b !== 'object') b = null; // older format was a bare id
  return { ns, items: parseHash(items), catalog: parseHash(catalog), order: cleanOrder(m.order), shops: parseHash(shops), bonus: b };
}

async function addItem(state, { id: wantId, name, qty = '', note = '', by = '', section, pri }) {
  const K = (k) => state.ns + k;
  const parsed = Catalog.parseQty(name);
  const cleanName = parsed.name;
  if (!cleanName) return null;
  const k = Catalog.key(cleanName);
  qty = String(qty || parsed.qty || '').slice(0, 20);
  note = String(note || '').slice(0, 120);
  pri = clampPri(pri != null ? pri : parsed.pri);

  // Already on the list and not ticked? Just top up the details.
  const existing = Object.values(state.items).find((i) => i.key === k && !i.checked);
  if (existing) {
    let changed = false;
    if (qty && qty !== existing.qty) { existing.qty = qty; changed = true; }
    if (note && note !== existing.note) { existing.note = note; changed = true; }
    if (pri > (existing.pri || 0)) { existing.pri = pri; changed = true; }
    if (changed) await cmd('HSET', K('items'), existing.id, JSON.stringify(existing));
    return existing;
  }

  const learned = state.catalog[k];
  const item = {
    id: (typeof wantId === 'string' && /^[a-z0-9]{6,24}$/.test(wantId) && !state.items[wantId]) ? wantId : id(),
    name: learned ? learned.name : cleanName,
    key: k,
    qty, note, pri,
    section: section || Catalog.guessSection(cleanName, state.catalog),
    by: String(by || '').slice(0, 20),
    at: Date.now(),
    checked: false,
  };
  state.items[item.id] = item;
  const cat = learned || { name: item.name, section: item.section, count: 0, last: [] };
  cat.added = (cat.added || 0) + 1;
  state.catalog[k] = cat;
  await pipeline([
    ['HSET', K('items'), item.id, JSON.stringify(item)],
    ['HSET', K('catalog'), k, JSON.stringify(cat)],
  ]);
  return item;
}

async function drainInbox(state) {
  const [entries] = await multi([['LRANGE', state.ns + 'inbox', 0, -1], ['DEL', state.ns + 'inbox']]);
  const added = [];
  for (const raw of entries || []) {
    let e;
    try { e = JSON.parse(raw); } catch { continue; }
    const item = await addItem(state, { name: e.text, by: e.by || 'Voice' });
    if (item) added.push(item.name);
  }
  return added;
}

// The bonus is secret. It's drawn at the first tick of a shop from everything
// still on the list, and cleared when the shop is finished.
async function tickBonus(state, item) {
  let b = state.bonus;
  if (b && b.hit) return false;
  const stillThere = b && state.items[b.id] && (!state.items[b.id].checked || b.id === item.id);
  if (!stillThere) {
    const pool = Object.values(state.items).filter((i) => !i.checked || i.id === item.id);
    if (!pool.length) return false;
    b = { id: pool[Math.floor(Math.random() * pool.length)].id, hit: false };
  }
  if (b.id === item.id) b.hit = true;
  state.bonus = b;
  await cmd('SET', state.ns + 'bonus', JSON.stringify(b));
  return b.hit;
}

const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function newCode() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  const a = pick();
  let b = pick();
  while (b === a) b = pick();
  return `${a}-${b}-${10 + Math.floor(Math.random() * 90)}`;
}

async function applyOp(state, body, result) {
  const K = (k) => state.ns + k;
  const { op } = body;
  const item = body.id ? state.items[body.id] : null;

  switch (op) {
    case 'add': {
      const names = Array.isArray(body.names) ? body.names : [body.name];
      for (const [ix, n] of names.entries()) await addItem(state, { ...body, id: ix === 0 ? body.id : undefined, name: n });
      return;
    }
    case 'update': {
      if (!item) return;
      const f = body.fields || {};
      if (typeof f.name === 'string' && f.name.trim()) {
        item.name = Catalog.tidyName(f.name);
        item.key = Catalog.key(item.name);
      }
      if (typeof f.qty === 'string') item.qty = f.qty.slice(0, 20);
      if (typeof f.note === 'string') item.note = f.note.slice(0, 120);
      if (f.pri != null) item.pri = clampPri(f.pri);
      const cmds = [];
      const shop = body.shop && state.shops[body.shop] ? body.shop : null;
      if (shop && typeof f.section === 'string' && Catalog.SECTIONS.includes(f.section)) {
        // Moved while in a shop: remember the aisle for this shop only, for everyone
        const cat = state.catalog[item.key] || { name: item.name, section: item.section, count: 0, last: [] };
        cat.shops = { ...(cat.shops || {}), [shop]: f.section };
        cat.name = item.name;
        state.catalog[item.key] = cat;
        cmds.push(['HSET', K('catalog'), item.key, JSON.stringify(cat)]);
      } else if (typeof f.section === 'string' && Catalog.SECTIONS.includes(f.section)) {
        item.section = f.section;
        // Remember where this item lives next time
        const cat = state.catalog[item.key] || { name: item.name, section: f.section, count: 0, last: [] };
        cat.section = f.section;
        cat.name = item.name;
        state.catalog[item.key] = cat;
        cmds.push(['HSET', K('catalog'), item.key, JSON.stringify(cat)]);
      }
      cmds.push(['HSET', K('items'), item.id, JSON.stringify(item)]);
      await pipeline(cmds);
      return;
    }
    case 'check': {
      if (!item) return;
      const was = item.checked;
      item.checked = !!body.checked;
      item.checkedAt = item.checked ? Date.now() : null;
      await cmd('HSET', K('items'), item.id, JSON.stringify(item));
      if (item.checked && !was && await tickBonus(state, item)) result.bonusHit = item.id;
      return;
    }
    case 'delete': {
      if (!item) return;
      delete state.items[item.id];
      await cmd('HDEL', K('items'), item.id);
      return;
    }
    case 'restore': {
      const it = body.item;
      if (!it || !it.id || !it.name) return;
      state.items[it.id] = it;
      await cmd('HSET', K('items'), it.id, JSON.stringify(it));
      return;
    }
    case 'finish': {
      // Everything ticked was bought: log it, clear it off, and reset the bonus.
      const now = Date.now();
      const done = Object.values(state.items).filter((i) => i.checked);
      if (!done.length) return;
      const cmds = [['DEL', K('bonus')]];
      state.bonus = null;
      for (const i of done) {
        const cat = state.catalog[i.key] || { name: i.name, section: i.section, count: 0, last: [] };
        cat.count = (cat.count || 0) + 1;
        cat.last = [...(cat.last || []), now].slice(-MAX_HISTORY);
        cat.section = i.section;
        state.catalog[i.key] = cat;
        delete state.items[i.id];
        cmds.push(['HSET', K('catalog'), i.key, JSON.stringify(cat)], ['HDEL', K('items'), i.id]);
      }
      await pipeline(cmds);
      return;
    }
    case 'order': {
      if (!Array.isArray(body.order)) return;
      const order = cleanOrder(body.order);
      const shop = body.shop && state.shops[body.shop];
      if (shop) {
        shop.order = order;
        await cmd('HSET', K('shops'), shop.id, JSON.stringify(shop));
      } else {
        state.order = order;
        await cmd('SET', K('meta'), JSON.stringify({ order }));
      }
      return;
    }
    case 'shop_add': {
      const lat = Number(body.lat), lng = Number(body.lng);
      const name = String(body.name || '').trim().slice(0, 40);
      if (!name || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      const sid = (typeof body.shopId === 'string' && /^[a-z0-9]{6,24}$/.test(body.shopId)) ? body.shopId : id();
      const shop = { id: sid, name, lat, lng, order: cleanOrder(state.order) };
      state.shops[sid] = shop;
      await cmd('HSET', K('shops'), sid, JSON.stringify(shop));
      return;
    }
    case 'shop_del': {
      if (!state.shops[body.shopId]) return;
      delete state.shops[body.shopId];
      await cmd('HDEL', K('shops'), body.shopId);
      return;
    }
    case 'household_new': {
      // A separate list for someone else: their own items, shops and code
      const name = titleCase(String(body.name || '').trim().slice(0, 30) || 'Friends');
      let code = newCode();
      for (let tries = 0; tries < 5 && await cmd('HEXISTS', 'households', code); tries++) code = newCode();
      await cmd('HSET', 'households', code, JSON.stringify({ id: id(), name, created: Date.now() }));
      result.newHousehold = { code, name };
      return;
    }
    case 'forget': {
      // Remove something from suggestions (typos, one-offs)
      if (!body.key) return;
      delete state.catalog[body.key];
      await cmd('HDEL', K('catalog'), body.key);
      return;
    }
    default:
      throw Object.assign(new Error('Unknown op'), { status: 400 });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const hh = await household(req);
    if (!hh) return res.status(401).json({ error: 'Wrong family code' });
    const state = await loadAll(hh.ns);
    const result = {};
    let added = [];
    if (req.method === 'GET') {
      added = await drainInbox(state);
    } else if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      await applyOp(state, body, result);
    } else {
      return res.status(405).end();
    }
    const { ns, bonus, ...pub } = state; // the bonus stays secret
    return res.status(200).json({
      ...pub, ...result, household: { name: hh.name, home: hh.home },
      fromVoice: added, serverTime: Date.now(),
    });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.message });
  }
};

module.exports._test = { addItem, applyOp, loadAll, drainInbox, household };
