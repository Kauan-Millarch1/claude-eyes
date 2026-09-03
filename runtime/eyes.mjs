#!/usr/bin/env node
/**
 * eyes.mjs — CLI front-end for the /eyes skill's browser.
 *
 *   node eyes.mjs start [--headless] [--device=mobile] [--url=...] [--browser=chrome]
 *   node eyes.mjs goto http://localhost:3000
 *   node eyes.mjs snap
 *   node eyes.mjs click e12          |  node eyes.mjs click "Finalizar compra"
 *   node eyes.mjs fill e7 joao@x.com |  node eyes.mjs press Enter
 *   node eyes.mjs a11y | contrast | perf | tabaudit | console | net | storage
 *   node eyes.mjs stop
 *
 * `start` spawns a detached daemon that keeps the browser open; every other
 * command is a one-shot round trip to it. Run `node eyes.mjs help` for all.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.join(os.tmpdir(), 'claude-eyes');
const STATE_FILE = path.join(STATE_DIR, 'session.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HELP = `eyes — real browser, driven step by step.

session
  start [--url=URL] [--headless] [--device=desktop|laptop|tv|tablet|mobile|mobile-small]
        [--browser=chrome|msedge|chromium] [--viewport=WxH] [--locale=pt-BR] [--slowmo=120]
        [--no-video] [--dialog=accept|dismiss]
  status                       engine, url, tab count, what has been logged
  stop                         close browser, flush summary.json + video

look
  snap [--max=N]               THE eye: refs for every interactive element, page outline,
                               static UX/a11y defects, plus runtime signals since last look
  text [--max=N]               visible text of the page
  find <text>                  locate text on the page (and its ref, if any)
  shot [name] [--full]         screenshot to the run dir
  console [--all]              console errors (+ uncaught exceptions); --all adds warnings
  net                          failed requests and >=400 responses
  dialogs                      alert/confirm/prompt that fired
  perf                         TTFB, FCP, LCP, CLS, long tasks, weight, slowest resources
  a11y                         axe-core wcag2a/aa + best-practice violations
  contrast                     real WCAG contrast ratios for visible text
  tabaudit [n]                 keyboard-only sweep: tab order, focus rings, dead ends
  storage                      cookies / localStorage / sessionStorage
  journal                      where the evidence for this run lives

act (every action reports what changed, what broke, and screenshots itself)
  goto <url>                   navigate (bare host gets https://, localhost gets http://)
  click <ref|"text"> [--double]
  dblclick <ref|"text">
  fill <ref|"text"> <value>    set a field's value at once
  type <ref|"text"> <value>    keystroke by keystroke (fires per-key handlers)
  press <Key>                  Enter, Tab, Escape, ArrowDown, Control+A ...
  select <ref> <value>         <select> option
  check <ref> [--off]
  hover <ref>
  scroll <down|up|top|bottom|eN>
  back | forward | reload
  wait <ms> | wait "<text>" | wait --sel="<css>"
  viewport <WxH> | device <name>
  throttle <none|fast-3g|slow-3g|2g|offline>
  reset [--noreload]           clear cookies + storage: become a first-time visitor
  tabs | tab <i> | closetab [i]
  eval <js>

flags valid on any action: --shot=off (skip the screenshot), --settle=<ms>
`;

function parseArgv(argv) {
  const flags = {};
  const rest = [];
  for (const a of argv) {
    const m = /^--([^=]+)(?:=([\s\S]*))?$/.exec(a);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
    else rest.push(a);
  }
  return { flags, rest };
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

function post(port, body, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      { host: '127.0.0.1', port, path: '/act', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': payload.length } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('bad reply: ' + data.slice(0, 300))); } });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('daemon did not answer in ' + timeoutMs + 'ms')));
    req.on('error', reject);
    req.end(payload);
  });
}

async function alive(state) {
  if (!state) return false;
  try { const r = await post(state.port, { cmd: 'status' }, 5000); return !!r; } catch { return false; }
}

async function cmdStart(flags) {
  const existing = readState();
  if (await alive(existing)) {
    console.log(`session already running (pid ${existing.pid}, ${existing.engine}).\nrunDir: ${existing.runDir}\nUse \`stop\` first if you want a clean one.`);
    if (flags.url) { const r = await post(existing.port, { cmd: 'goto', args: [String(flags.url)] }); console.log('\n' + r.text); }
    return;
  }
  try { fs.unlinkSync(STATE_FILE); } catch {}

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const runDir = flags.rundir ? String(flags.rundir) : path.join(STATE_DIR, 'run-' + stamp);
  fs.mkdirSync(runDir, { recursive: true });

  const opts = {
    headless: !!flags.headless,
    device: flags.device ? String(flags.device) : 'desktop',
    browser: flags.browser ? String(flags.browser) : 'auto',
    viewport: flags.viewport ? String(flags.viewport) : null,
    locale: flags.locale ? String(flags.locale) : 'pt-BR',
    timezone: flags.timezone ? String(flags.timezone) : 'America/Sao_Paulo',
    slowMo: flags.slowmo != null ? Number(flags.slowmo) : (flags.headless ? 0 : 110),
    video: flags['no-video'] ? false : true,
    dialog: flags.dialog ? String(flags.dialog) : 'accept',
  };

  const logFile = path.join(runDir, 'daemon.log');
  const out = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [path.join(HERE, 'eyes.mjs'), '__daemon', runDir, JSON.stringify(opts)], {
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: false,
  });
  child.unref();

  for (let i = 0; i < 100; i++) {
    await sleep(250);
    const st = readState();
    if (st && st.pid === child.pid && (await alive(st))) {
      console.log(`eyes open: ${st.engine}${opts.headless ? ' headless' : ' (janela visível)'} | device ${opts.device} | pid ${st.pid}`);
      console.log(`evidence dir: ${runDir}`);
      if (flags.url) { const r = await post(st.port, { cmd: 'goto', args: [String(flags.url)] }); console.log('\n' + r.text); }
      return;
    }
    if (child.exitCode != null) break;
  }
  let log = '';
  try { log = fs.readFileSync(logFile, 'utf8').slice(-1500); } catch {}
  console.error('FAILED to start the browser session.\n' + log);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv[0] === '__daemon') {
    const runDir = argv[1];
    const opts = JSON.parse(argv[2] || '{}');
    const { startDaemon } = await import('./daemon.mjs');
    await startDaemon({ runDir, opts, stateFile: STATE_FILE });
    return; // event loop stays alive on the http server
  }

  const { flags, rest } = parseArgv(argv);
  const cmd = (rest[0] || 'help').toLowerCase();
  const args = rest.slice(1);

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return; }
  if (cmd === 'start') return cmdStart(flags);

  const state = readState();
  if (!(await alive(state))) {
    console.error('no live session. Run:  node "' + path.join(HERE, 'eyes.mjs') + '" start --url=<url>');
    process.exit(2);
  }
  const r = await post(state.port, { cmd, args, o: flags });
  console.log(r.text);
  if (r.ok === false) process.exit(1);
}

main().catch((e) => { console.error('ERROR: ' + e.message); process.exit(1); });
