// Standalone static server for the public site (public-site spec §40/§41):
// no database, no sessions — its ONLY runtime dependency is the public API
// base URL. Use for separate-origin local development or an independent
// deployment (the production default serves the same directory host-routed
// from the main app, where the API is same-origin).
//
//   PUBLIC_API_BASE=http://localhost:3000/api/public/language node public-site/serve.js
//   (remember to add http://localhost:3001 to the app's PUBLIC_DEV_ORIGINS)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || 3001;
const API_BASE = process.env.PUBLIC_API_BASE || 'http://localhost:3000/api/public/language';
const DIR = import.meta.dirname;

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8' };

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/app.js' || p === '/style.css') {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] });
    return fs.createReadStream(path.join(DIR, p.slice(1))).pipe(res);
  }
  // SPA fallback: every route serves the shell with the API base injected.
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
    .replaceAll('{{TITLE}}', 'Language Collection')
    .replaceAll('{{DESCRIPTION}}', '')
    .replaceAll('{{CANONICAL}}', '')
    .replace('<script>', `<script>window.PUBLIC_API_BASE=${JSON.stringify(API_BASE)};</script>\n  <script>`);
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  res.end(html);
}).listen(PORT, () => console.log(`public site (standalone) at http://localhost:${PORT} -> API ${API_BASE}`));
