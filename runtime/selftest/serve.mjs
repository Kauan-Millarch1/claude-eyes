import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/carrinho') {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end('{"erro":"cart service down"}');
  }
  const file = url === '/' ? 'eyes-testbed.html' : url.slice(1);
  const p = path.join(DIR, file);
  fs.readFile(p, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(p);
    res.writeHead(200, { 'content-type': ext === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' });
    res.end(buf);
  });
}).listen(4599, () => console.log('testbed on http://localhost:4599'));
