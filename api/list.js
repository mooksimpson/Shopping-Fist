// The shared list. GET returns everything (and pulls in anything waiting in
// the Keep inbox). POST applies one change: { op: 'add' | 'update' | ... }.
const { cmd, pipeline, multi } = require('./_redis');
const Catalog = require('../public/catalog.js');

const MAX_HISTORY = 8; // purchase dates remembered per item

function authed(req) {
  const code = process.env.FAMILY_CODE;
  if (!code) return true;
  return (req.headers['x-family-code'] || '') === code;
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function parseHash(arr) {
  // Upstash returns HGETALL as a flat [k, v, k, v] array
  const out = {};
  if (Array.isArray(arr)) for (let i = 0; i < arr.length; i += 2) {
    try { out[arr[i]] = JSON.parse(arr[i + 1]); } catch { /* skip junk */ }
  }
  return out;
}

async function loadAll() {
  const [items, catalog, meta] = await pipeline([
    ['HGETALL', 'items'], ['HGETALL', 'catalog'], ['GET', 'meta'],
  ]);
  let m = {};
  try { m = JSON.parse(meta || '{}') || {}; } catch {}
  const order = Array.isArray(m.order) ? m.order : [];
  // Keep any new default sections in the order list
  for (const s of Catalog.SECTIONS) if (!order.includes(s)) order.push(s);
  return { items: parseHash(items), catalog: parseHash(catalog), order };
}

async function addItem(state, { id: wantId, name, qty = '', note = '', by = '', section }) {
  const parsed = Catalog.parseQty(name);
  const cleanName = parsed.name;
  if (!cleanName) return null;
  const k = Catalog.key(cleanName);
  qty = String(qty || parsed.qty || '').slice(0, 20);
  note = String(note || '').slice(0, 120);

  // Already on the list and not ticked? Just top up the details.
  const existing = Object.values(state.items).find((i) => i.key === k && !i.checked);
  if (existing) {
    let changed = false;
    if (qty && qty !== existing.qty) { existing.qty = qty; changed = true; }
    if (note && note !== existing.note) { existing.note = note; changed = true; }
    if (changed) await cmd('HSET', 'items', existing.id, JSON.stringify(existing));
    return existing;
  }

  const learned = state.catalog[k];
  const item = {
    id: (typeof wantId === 'string' && /^[a-z0-9]{6,24}$/.test(wantId) && !state.items[wantId]) ? wantId : id(),
    name: learned ? learned.name : cleanName,
    key: k,
    qty, note,
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
    ['HSET', 'items', item.id, JSON.stringify(item)],
    ['HSET', 'catalog', k, JSON.stringify(cat)],
  ]);
  return item;
}

async function drainInbox(state) {
  const [entries] = await multi([['LRANGE', 'inbox', 0, -1], ['DEL', 'inbox']]);
  const added = [];
  for (const raw of entries || []) {
    let e;
    try { e = JSON.parse(raw); } catch { continue; }
    const item = await addItem(state, { name: e.text, by: e.by || 'Voice' });
    if (item) added.push(item.name);
  }
  return added;
}

async function applyOp(state, body) {
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
      const cmds = [];
      if (typeof f.section === 'string' && Catalog.SECTIONS.includes(f.section)) {
        item.section = f.section;
        // Remember where this item lives next time
        const cat = state.catalog[item.key] || { name: item.name, section: f.section, count: 0, last: [] };
        cat.section = f.section;
        cat.name = item.name;
        state.catalog[item.key] = cat;
        cmds.push(['HSET', 'catalog', item.key, JSON.stringify(cat)]);
      }
      cmds.push(['HSET', 'items', item.id, JSON.stringify(item)]);
      await pipeline(cmds);
      return;
    }
    case 'check': {
      if (!item) return;
      item.checked = !!body.checked;
      item.checkedAt = item.checked ? Date.now() : null;
      await cmd('HSET', 'items', item.id, JSON.stringify(item));
      return;
    }
    case 'delete': {
      if (!item) return;
      delete state.items[item.id];
      await cmd('HDEL', 'items', item.id);
      return;
    }
    case 'restore': {
      const it = body.item;
      if (!it || !it.id || !it.name) return;
      state.items[it.id] = it;
      await cmd('HSET', 'items', it.id, JSON.stringify(it));
      return;
    }
    case 'finish': {
      // Everything ticked was bought: log it and clear it off the list.
      const now = Date.now();
      const done = Object.values(state.items).filter((i) => i.checked);
      if (!done.length) return;
      const cmds = [];
      for (const i of done) {
        const cat = state.catalog[i.key] || { name: i.name, section: i.section, count: 0, last: [] };
        cat.count = (cat.count || 0) + 1;
        cat.last = [...(cat.last || []), now].slice(-MAX_HISTORY);
        cat.section = i.section;
        state.catalog[i.key] = cat;
        delete state.items[i.id];
        cmds.push(['HSET', 'catalog', i.key, JSON.stringify(cat)], ['HDEL', 'items', i.id]);
      }
      await pipeline(cmds);
      return;
    }
    case 'order': {
      if (!Array.isArray(body.order)) return;
      const order = body.order.filter((s) => Catalog.SECTIONS.includes(s));
      state.order = order;
      await cmd('SET', 'meta', JSON.stringify({ order }));
      return;
    }
    case 'forget': {
      // Remove something from suggestions (typos, one-offs)
      if (!body.key) return;
      delete state.catalog[body.key];
      await cmd('HDEL', 'catalog', body.key);
      return;
    }
    default:
      throw Object.assign(new Error('Unknown op'), { status: 400 });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!authed(req)) return res.status(401).json({ error: 'Wrong family code' });
  try {
    const state = await loadAll();
    let added = [];
    if (req.method === 'GET') {
      added = await drainInbox(state);
    } else if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      await applyOp(state, body);
    } else {
      return res.status(405).end();
    }
    return res.status(200).json({ ...state, fromVoice: added, serverTime: Date.now() });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.message });
  }
};

module.exports._test = { addItem, applyOp, loadAll, drainInbox };
