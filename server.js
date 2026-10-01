const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Staging only ever swaps DATA and suppresses outbound side effects — never
// features. Here it decides whether the boot seed block runs; the seed plants
// obviously fake demo rows so a fresh staging preview isn't an empty ledger.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// Ledger read: the all-time balance, the totals for the selected period and
// the entries themselves. `?month=YYYY-MM` filters the list and the totals;
// without it everything is returned. Amounts are integer rupiah.
app.get('/api/entries', async (req, res) => {
  const month = req.query.month;
  if (month != null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: 'Bulan tidak valid' });
  }
  const where = month ? `WHERE to_char(occurred_on, 'YYYY-MM') = $1` : '';
  const args = month ? [month] : [];
  try {
    const entries = await pool.query(`
      SELECT id, username, type, amount, note,
             to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on
      FROM entries ${where}
      ORDER BY occurred_on DESC, id DESC
      LIMIT 500
    `, args);
    const balance = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) AS balance
      FROM entries
    `);
    const totals = await pool.query(`
      SELECT COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expense
      FROM entries ${where}
    `, args);
    res.json({
      balance: Number(balance.rows[0].balance),
      income: Number(totals.rows[0].income),
      expense: Number(totals.rows[0].expense),
      entries: entries.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ledger write: one entry, typed income/expense, integer rupiah, optional
// note, date defaulting to today. The ledger is shared — every signed-in
// member sees it — so each row records who added it.
app.post('/api/entries', async (req, res) => {
  const body = req.body || {};
  const type = body.type;
  const amount = Number(body.amount);
  let date = body.date;
  if (type !== 'income' && type !== 'expense') {
    return res.status(400).json({ error: 'Pilih pemasukan atau pengeluaran' });
  }
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1e12) {
    return res.status(400).json({ error: 'Nominal harus angka lebih dari 0' });
  }
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > 200)) {
    return res.status(400).json({ error: 'Catatan maksimal 200 karakter' });
  }
  if (date == null || date === '') {
    date = new Date().toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
    return res.status(400).json({ error: 'Tanggal tidak valid' });
  }
  try {
    const { rows } = await pool.query(`
      INSERT INTO entries (user_id, username, type, amount, note, occurred_on)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, username, type, amount, note,
                to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on
    `, [req.user.id, req.user.username, type, amount, (body.note || '').trim(), date]);
    res.json({ entry: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/kas-komunitas-6c1025/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/kas-komunitas-6c1025/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username VARCHAR(255) NOT NULL,
      type VARCHAR(10) NOT NULL CHECK (type IN ('income', 'expense')),
      amount BIGINT NOT NULL CHECK (amount > 0),
      note VARCHAR(200) NOT NULL DEFAULT '',
      occurred_on DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS entries_occurred_on_idx ON entries (occurred_on)`
  );
  // Demo table from the replaced starter template; the demo screen and its
  // endpoints are gone, so the table goes too.
  await pool.query(`DROP TABLE IF EXISTS presses`);

  // Staging previews start with an empty ledger (the entries table is new).
  // Seed a handful of obviously fake rows so the screen is reviewable.
  // Fake identities only — never rows owned by whoever opened the preview.
  if (IS_STAGING) {
    // Month-relative dates: a few entries inside the CURRENT month and a
    // few in the previous one, so both views have data no matter when the
    // preview boots. Clamped to today so nothing lands in the future.
    const now = new Date();
    const cur = (dayOfMonth) => new Date(now.getFullYear(), now.getMonth(),
      Math.min(dayOfMonth, now.getDate())).toISOString().slice(0, 10);
    const prev = (dayOfMonth) => new Date(now.getFullYear(), now.getMonth() - 1,
      dayOfMonth).toISOString().slice(0, 10);
    await pool.query(`
      INSERT INTO entries (id, user_id, username, type, amount, note, occurred_on) VALUES
        (900001, 0, 'staging-demo-user', 'income',  500000, 'Staging demo: iuran bulanan anggota', $1),
        (900002, 0, 'staging-demo-user', 'income',  250000, 'Staging demo: donasi kegiatan', $2),
        (900003, 0, 'staging-demo-user', 'expense', 150000, 'Staging demo: konsumsi rapat', $3),
        (900004, 0, 'staging-demo-user', 'expense',  75000, 'Staging demo: transportasi', $4),
        (900005, 0, 'staging-demo-user', 'income',  400000, 'Staging demo: iuran bulan lalu', $5),
        (900006, 0, 'staging-demo-user', 'expense', 200000, 'Staging demo: perlengkapan', $6)
      ON CONFLICT (id) DO NOTHING
    `, [cur(2), cur(5), cur(7), cur(12), prev(20), prev(10)]);
  }

  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;
  return server;
}

// Graceful shutdown: the platform SIGTERMs the container on every deploy.
// Stop accepting connections, drain briefly, close the pool, exit — and
// make a repeat signal a no-op.
const DRAIN_MS = 3000;
let shuttingDown = false;
let currentServer = null;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, draining`);
  if (currentServer) {
    currentServer.close(() => {});
    currentServer.closeIdleConnections?.();
    const t = setTimeout(() => currentServer.closeAllConnections?.(), DRAIN_MS);
    t.unref?.();
  }
  try {
    await pool.end();
  } catch (e) {
    console.error('[shutdown] pool.end failed', e.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().then((server) => { currentServer = server; })
  .catch(err => { console.error(err); process.exit(1); });