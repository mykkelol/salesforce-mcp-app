// Local preview server: `npm run preview`. Builds each card exactly as the MCP
// server does (one self-contained HTML document) and serves a stand-in host page
// that drives it with the fixtures. It listens on localhost only.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 5180;
// URL prefix → folder it serves.
const STATIC = { preview: join(root, 'preview'), cards: join(root, 'src', 'cards') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const KINDS = new Set(['record', 'quote-change', 'write-result']);
const TITLES = { record: 'Salesforce record', 'quote-change': 'Change preview', 'write-result': 'Salesforce result' };

const builderUrl = pathToFileURL(join(root, 'src', 'ui', 'build-html.js')).href;
const loadBuilder = async () => (await import(`${builderUrl}?t=${Date.now()}`)).buildCardHtml;

const clients = new Set();
let reloadTimer;
for (const dir of [join(root, 'src', 'ui'), join(root, 'src', 'cards'), STATIC.preview]) {
  watch(dir, () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => clients.forEach((res) => res.write('data: reload\n\n')), 80);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  if (url.pathname === '/') {
    res.writeHead(302, { location: '/preview/' });
    return res.end();
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const card = /^\/card\/([a-z-]+)$/.exec(url.pathname);
  if (card) {
    if (!KINDS.has(card[1])) return send(404, 'text/plain', 'Unknown card kind');
    try {
      const buildCardHtml = await loadBuilder();
      return send(200, TYPES['.html'], buildCardHtml(card[1], { title: TITLES[card[1]], version: 'preview' }));
    } catch (err) {
      return send(500, 'text/plain', String(err && err.stack ? err.stack : err));
    }
  }

  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
  const [top, ...rest] = rel.split(sep);
  const base = STATIC[top];
  if (!base) return send(404, 'text/plain', 'Not found');
  const file = join(base, rest.length && rest.join(sep) ? rest.join(sep) : 'index.html');
  if (file !== base && !file.startsWith(base + sep)) return send(404, 'text/plain', 'Not found');
  try {
    send(200, TYPES[extname(file)] || 'application/octet-stream', await readFile(file));
  } catch {
    send(404, 'text/plain', 'Not found');
  }
});

server.listen(PORT, HOST, () => console.log(`Card preview: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`));
