// Local dev server: fake Upstash Redis + static files + /api/list.
// Run: node dev/server.js  then open http://localhost:3000 (family code: test)
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- Fake Upstash REST (just the commands the app uses) ----
const db = new Map();
function run([c, ...a]) {
  c = c.toUpperCase();
  const h = (k) => { if (!db.has(k)) db.set(k, new Map()); return db.get(k); };
  switch (c) {
    case 'GET': return db.has(a[0]) ? db.get(a[0]) : null;
    case 'SET': {
      const nx = a.includes('NX');
      if (nx && db.has(a[0])) return null;
      db.set(a[0], String(a[1])); return 'OK';
    }
    case 'DEL': { const had = db.delete(a[0]); return had ? 1 : 0; }
    case 'HSET': h(a[0]).set(a[1], a[2]); return 1;
    case 'HDEL': return h(a[0]).delete(a[1]) ? 1 : 0;
    case 'HGETALL': return [...h(a[0])].flat();
    case 'RPUSH': { const l = db.get(a[0]) || []; l.push(...a.slice(1)); db.set(a[0], l); return l.length; }
    case 'LRANGE': return (db.get(a[0]) || []).slice();
    default: throw new Error('fake redis: ' + c);
  }
}
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    const body = JSON.parse(b);
    let out;
    try {
      out = req.url === '/' ? { result: run(body) } : body.map((cmd) => ({ result: run(cmd) }));
    } catch (e) { out = { error: e.message }; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(out));
  });
});

fake.listen(0, () => {
  process.env.KV_REST_API_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.KV_REST_API_TOKEN = 'dev';
  process.env.FAMILY_CODE = process.env.FAMILY_CODE || 'test';
  const list = require('../api/list.js');
  const root = path.join(__dirname, '..', 'public');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/list') {
      let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
        req.body = b ? JSON.parse(b) : {};
        res.status = (c) => { res.statusCode = c; return res; };
        res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
        list(req, res);
      });
      return;
    }
    if (url.pathname === '/api/keep_sync') { // pretend Google added things by voice
      const say = url.searchParams.get('say');
      if (say) run(['RPUSH', 'inbox', ...say.split(',').map((t) => JSON.stringify({ text: t, by: 'Voice' }))]);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ ok: true, moved: say ? say.split(',') : [] }));
    }
    const f = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!f.startsWith(root) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nope'); }
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
  }).listen(process.env.PORT || 3000, () => console.log('http://localhost:' + (process.env.PORT || 3000)));
});
