#!/usr/bin/env node
/**
 * probe.mjs — find something to look at before opening the browser.
 *
 *   node probe.mjs                 # scan the usual dev-server ports
 *   node probe.mjs 3000 8080       # scan only these
 *   node probe.mjs --dir=.         # also read package.json for a start script
 *
 * Prints live URLs with their title, so the session starts against a real app
 * instead of a guessed port.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PORTS = [3000, 3001, 3002, 4000, 4173, 4200, 4321, 5000, 5173, 5174, 7000, 8000, 8080, 8081, 8788, 8888, 9000, 1313, 1420, 5500];

function head(port) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 1200 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (body.length < 4000) body += c; });
      res.on('end', () => {
        const m = /<title[^>]*>([^<]{1,80})</i.exec(body);
        const isHtml = /text\/html/i.test(res.headers['content-type'] || '') || /<html/i.test(body);
        resolve({ port, status: res.statusCode, title: m ? m[1].trim() : null, isHtml, server: res.headers['x-powered-by'] || res.headers.server || null });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

function scripts(dir) {
  const out = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const k of ['dev', 'start', 'serve', 'preview', 'dev:web']) if (pkg.scripts && pkg.scripts[k]) out.push(`${k}: ${pkg.scripts[k]}`);
  } catch {}
  return out;
}

const args = process.argv.slice(2);
const dirFlag = args.find((a) => a.startsWith('--dir='));
const ports = args.filter((a) => /^\d+$/.test(a)).map(Number);
const list = ports.length ? ports : DEFAULT_PORTS;

const found = (await Promise.all(list.map(head))).filter(Boolean);
if (!found.length) {
  console.log('no HTTP server answering on: ' + list.join(', '));
} else {
  console.log('live locally:');
  for (const f of found) console.log(`  http://localhost:${f.port}  [${f.status}]${f.isHtml ? '' : ' (not HTML)'}${f.title ? '  "' + f.title + '"' : ''}${f.server ? '  via ' + f.server : ''}`);
}
if (dirFlag) {
  const s = scripts(dirFlag.slice(6) || '.');
  if (s.length) { console.log('\nstart scripts in package.json:'); for (const x of s) console.log('  npm run ' + x); }
}
