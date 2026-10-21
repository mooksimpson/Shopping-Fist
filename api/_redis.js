// Tiny Upstash Redis REST client. No dependencies.
// Works with the env vars Vercel's Upstash / KV integration creates.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function call(path, body) {
  if (!URL_ || !TOKEN) throw new Error('Redis env vars missing (KV_REST_API_URL / KV_REST_API_TOKEN)');
  const res = await fetch(URL_.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}: ${await res.text()}`);
  return res.json();
}

// Single command: cmd('HGET', 'items', 'abc')
async function cmd(...args) {
  const out = await call('', args);
  if (out.error) throw new Error(out.error);
  return out.result;
}

// Several commands, one round trip (not atomic)
async function pipeline(cmds) {
  if (!cmds.length) return [];
  const out = await call('/pipeline', cmds);
  return out.map((r) => { if (r.error) throw new Error(r.error); return r.result; });
}

// Several commands, atomic
async function multi(cmds) {
  const out = await call('/multi-exec', cmds);
  if (out.error) throw new Error(out.error);
  return out.map((r) => { if (r.error) throw new Error(r.error); return r.result; });
}

module.exports = { cmd, pipeline, multi };
