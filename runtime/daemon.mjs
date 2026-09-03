/**
 * daemon.mjs — long-lived browser session behind a tiny localhost HTTP API.
 *
 * One process holds the browser open so the agent can take a step, look at the
 * result, and decide the next step. Everything observed is also written to
 * disk (journal, screenshots, console, network, video) so a report can cite
 * evidence instead of recollection.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { launchBrowser, DEVICES, NETWORK } from './browser.mjs';
import { INIT_SCRIPT, snapshotFn, contrastFn, focusFn, storageFn, textFn } from './inpage.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

export async function startDaemon({ runDir, opts, stateFile }) {
  fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true });

  const S = {
    runDir,
    opts,
    engine: null,
    browser: null,
    context: null,
    pages: [],
    active: 0,
    console: [],
    pageErrors: [],
    network: [],
    dialogs: [],
    downloads: [],
    cursors: { console: 0, pageErrors: 0, network: 0, dialogs: 0 },
    lastSnapshot: null,
    shotN: 0,
    stepN: 0,
    dialogPolicy: opts.dialog || 'accept',
    cdp: null,
    startedAt: nowIso(),
  };

  const journal = (entry) => {
    try {
      fs.appendFileSync(path.join(runDir, 'journal.jsonl'), JSON.stringify({ t: nowIso(), ...entry }) + '\n', 'utf8');
    } catch {}
  };

  const page = () => {
    const p = S.pages[S.active];
    if (!p || p.isClosed()) {
      const alive = S.pages.filter((x) => x && !x.isClosed());
      if (!alive.length) throw new Error('no open page — the browser window was closed. Run `stop` then `start` again.');
      S.pages = alive;
      S.active = 0;
      return S.pages[0];
    }
    return p;
  };

  function wirePage(p) {
    p.on('console', (m) => {
      const type = m.type();
      if (type !== 'error' && type !== 'warning' && type !== 'assert') return;
      let loc = '';
      try { const l = m.location(); loc = l.url ? l.url.split('/').slice(-1)[0] + ':' + l.lineNumber : ''; } catch {}
      S.console.push({ t: nowIso(), type, text: m.text().slice(0, 600), loc });
    });
    p.on('pageerror', (e) => S.pageErrors.push({ t: nowIso(), text: String(e.message).slice(0, 600), stack: String(e.stack || '').split('\n').slice(0, 4).join(' | ') }));
    p.on('requestfailed', (r) => {
      const f = r.failure();
      S.network.push({ t: nowIso(), kind: 'failed', method: r.method(), url: r.url().slice(0, 220), error: f ? f.errorText : 'unknown' });
    });
    p.on('response', (r) => {
      const st = r.status();
      if (st >= 400) S.network.push({ t: nowIso(), kind: 'http', status: st, method: r.request().method(), url: r.url().slice(0, 220) });
    });
    p.on('dialog', async (d) => {
      S.dialogs.push({ t: nowIso(), type: d.type(), message: d.message().slice(0, 300) });
      try {
        if (S.dialogPolicy === 'dismiss' || d.type() === 'beforeunload') await d.dismiss();
        else await d.accept();
      } catch {}
    });
    p.on('download', async (d) => {
      const target = path.join(runDir, 'downloads', d.suggestedFilename());
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { await d.saveAs(target); S.downloads.push({ t: nowIso(), file: target }); } catch {}
    });
    p.on('close', () => { S.pages = S.pages.filter((x) => x !== p && x && !x.isClosed()); if (S.active >= S.pages.length) S.active = Math.max(0, S.pages.length - 1); });
  }

  /* ------------------------------------------------------------- bootstrap */

  const launched = await launchBrowser(chromium, opts);
  S.browser = launched.browser;
  S.engine = launched.engine;

  const devicePreset = DEVICES[opts.device] || DEVICES.desktop;
  const ctxOpts = {
    ...devicePreset,
    locale: opts.locale || 'pt-BR',
    timezoneId: opts.timezone || 'America/Sao_Paulo',
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
  };
  if (opts.video !== false) ctxOpts.recordVideo = { dir: path.join(runDir, 'video'), size: devicePreset.viewport };
  if (opts.viewport) {
    const m = /^(\d+)x(\d+)$/.exec(opts.viewport);
    if (m) ctxOpts.viewport = { width: +m[1], height: +m[2] };
  }
  S.context = await S.browser.newContext(ctxOpts);
  S.context.setDefaultTimeout(15000);
  S.context.setDefaultNavigationTimeout(45000);
  await S.context.addInitScript(INIT_SCRIPT);
  S.context.on('page', (p) => { S.pages.push(p); wirePage(p); });

  const first = await S.context.newPage();
  if (!S.pages.includes(first)) { S.pages.push(first); wirePage(first); }
  S.active = S.pages.indexOf(first);

  /* --------------------------------------------------------------- helpers */

  const flags = (o) => o || {};

  function fmtEl(e) {
    const bits = [`[${e.ref}]`, e.role === e.tag ? e.tag : `${e.tag}/${e.role}`];
    if (e.type) bits.push(`[${e.type}]`);
    bits.push(`"${e.name || '(SEM NOME ACESSÍVEL)'}"`);
    if (!e.name && e.placeholder) bits.push(`placeholder:"${e.placeholder}"`);
    if (!e.name && e.hint) bits.push(`name="${e.hint}"`);
    if (e.href) bits.push(`-> ${e.href.slice(0, 60)}`);
    if (e.value) bits.push(`= "${e.value}"`);
    if (e.options) bits.push(`opts:${e.options.slice(0, 5).join('|')}`);
    const tags = [];
    if (e.disabled) tags.push('disabled');
    if (e.required) tags.push('required');
    if (e.checked) tags.push('checked');
    if (e.readonly) tags.push('readonly');
    if (e.invalid) tags.push('aria-invalid');
    if (e.newTab) tags.push('new-tab');
    if (!e.inViewport) tags.push('off-screen');
    if (tags.length) bits.push(`{${tags.join(',')}}`);
    bits.push(`${e.w}x${e.h}`);
    return '  ' + bits.join(' ');
  }

  function drainNew() {
    const out = [];
    const nc = S.console.slice(S.cursors.console);
    const ne = S.pageErrors.slice(S.cursors.pageErrors);
    const nn = S.network.slice(S.cursors.network);
    const nd = S.dialogs.slice(S.cursors.dialogs);
    S.cursors = { console: S.console.length, pageErrors: S.pageErrors.length, network: S.network.length, dialogs: S.dialogs.length };
    for (const e of ne) out.push(`  !! UNCAUGHT: ${e.text}`);
    for (const c of nc) out.push(`  ${c.type === 'error' ? '!!' : ' ~'} console.${c.type}: ${c.text}${c.loc ? ' (' + c.loc + ')' : ''}`);
    for (const r of nn) out.push(`  ${r.kind === 'failed' ? '!! request failed' : '!! HTTP ' + r.status}: ${r.method} ${r.url}${r.error ? ' — ' + r.error : ''}`);
    for (const d of nd) out.push(`  ** dialog(${d.type}) auto-${S.dialogPolicy}ed: "${d.message}"`);
    return out;
  }

  async function shot(label) {
    const p = page();
    const nm = String(++S.shotN).padStart(3, '0') + '-' + (label || 'step').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) + '.png';
    const file = path.join(runDir, 'shots', nm);
    try { await p.screenshot({ path: file }); } catch { return null; }
    return file;
  }

  async function settle(ms) {
    const p = page();
    try { await p.waitForLoadState('domcontentloaded', { timeout: 8000 }); } catch {}
    await sleep(ms == null ? 450 : ms);
    try { await p.waitForLoadState('networkidle', { timeout: 2500 }); } catch {}
  }

  async function bodyFingerprint() {
    try {
      return await page().evaluate(() => {
        const t = document.body ? document.body.innerText : '';
        let h = 0;
        for (let i = 0; i < t.length; i++) { h = (h * 31 + t.charCodeAt(i)) | 0; }
        return { hash: h, len: t.length, url: location.href, dialogs: document.querySelectorAll('[role=dialog],dialog[open]').length };
      });
    } catch { return null; }
  }

  function resolveRef(arg) {
    if (!arg) throw new Error('missing target: pass a ref like e12, or text like "Comprar"');
    if (/^e\d+$/.test(arg)) return arg;
    if (!S.lastSnapshot) throw new Error('no snapshot yet — run `snap` before targeting by text');
    const needle = arg.toLowerCase();
    const cand = S.lastSnapshot.elements.filter((e) => (e.name || '').toLowerCase().includes(needle));
    if (!cand.length) throw new Error(`no element whose name contains "${arg}". Run \`snap\` and target a ref.`);
    const exact = cand.filter((e) => (e.name || '').toLowerCase() === needle);
    const pick = exact.length === 1 ? exact : cand;
    if (pick.length > 1) throw new Error(`"${arg}" is ambiguous (${pick.length} matches): ${pick.slice(0, 8).map((e) => e.ref + ':"' + e.name + '"').join(', ')}`);
    return pick[0].ref;
  }

  const locOf = (ref) => page().locator(`[data-eyes-ref="${ref}"]`);

  /** Confirms what the field actually holds after an input action. */
  async function readback(ref, expected) {
    try {
      const info = await locOf(ref).evaluate((el) => ({
        value: el.value != null ? String(el.value) : (el.textContent || ''),
        invalid: el.getAttribute('aria-invalid') === 'true' || (el.checkValidity ? !el.checkValidity() : false),
        message: el.validationMessage || '',
      }));
      const got = info.value;
      let line = `\n  field now holds: "${got.slice(0, 80)}"`;
      if (expected != null && got !== expected) line += `  <-- DIFFERENT from what was typed ("${expected.slice(0, 80)}") — mask, maxlength or input filter altered it`;
      if (info.invalid) line += `\n  the browser considers this field invalid${info.message ? ': "' + info.message + '"' : ''}`;
      return line;
    } catch { return ''; }
  }

  async function snapshot(o) {
    const p = page();
    const data = await p.evaluate(snapshotFn, { max: flags(o).max ? +flags(o).max : 220 });
    S.lastSnapshot = data;
    const lines = [];
    lines.push(`url    ${data.url}`);
    lines.push(`title  ${data.title || '(vazio)'}`);
    const perf = data.stats.perf;
    lines.push(
      `page   viewport ${data.stats.viewport} | scrollH ${data.stats.scrollHeight} | interactive ${data.stats.interactive}${data.stats.truncated ? ' (TRUNCATED)' : ''} | iframes ${data.stats.iframes}` +
        (perf ? ` | LCP ${Math.round(perf.lcp)}ms CLS ${perf.cls.toFixed(3)} longtasks ${perf.longTasks}` : '')
    );
    if (S.pages.length > 1) lines.push(`tabs   ${S.pages.length} open, active #${S.active}`);
    if (data.outline.length) {
      lines.push('', 'outline:');
      for (const h of data.outline) lines.push(`  ${h.level} ${h.text}`);
    }
    lines.push('', `elements (${data.elements.length}):`);
    for (const e of data.elements) lines.push(fmtEl(e));
    if (data.issues.length) {
      lines.push('', `static issues (${data.issues.length}):`);
      for (const i of data.issues) lines.push(`  ${i.kind}${i.ref ? ' ' + i.ref : ''}: ${i.detail}`);
    }
    const fresh = drainNew();
    if (fresh.length) { lines.push('', 'runtime signals since last look:'); lines.push(...fresh); }
    return { text: lines.join('\n'), data };
  }

  /** Every action funnels through here so cause -> effect is always recorded. */
  async function act(label, fn, o) {
    const before = await bodyFingerprint();
    const beforeTabs = S.pages.length;
    let error = null;
    try { await fn(); } catch (e) {
      error = String(e.message).split('\n').slice(0, 3).join(' | ');
      if (/data-eyes-ref/.test(error) && /Timeout|not found|detached/i.test(error)) {
        error = 'stale ref: that element no longer exists (the page re-rendered or navigated since the last `snap`). Run `snap` and use the new ref.';
        S.lastSnapshot = null;
      }
    }
    await settle(flags(o).settle ? +flags(o).settle : undefined);
    const after = await bodyFingerprint();
    const file = flags(o).shot === 'off' ? null : await shot(label);
    const lines = [];
    S.stepN++;
    lines.push(`step ${S.stepN}: ${label}${error ? '  -> ACTION FAILED' : ''}`);
    if (error) lines.push(`  error: ${error}`);
    // Verdicts are the *computed* observations about this step — a dead control,
    // a navigation, a stolen tab. They are journaled alongside the raw console
    // and network signals, because a report written after the session (and any
    // Artifact built from it) only ever sees the journal, never this terminal.
    const verdicts = [];
    if (before && after) {
      if (before.url !== after.url) verdicts.push(`  navigated: ${before.url}  ->  ${after.url}`);
      else if (before.hash === after.hash && after.dialogs === before.dialogs) {
        // Only an interaction is *expected* to change something; a resize or a
        // scroll changing nothing is not a finding.
        if (flags(o).expectChange !== false) verdicts.push('  NO VISIBLE CHANGE: same URL, identical body text, no dialog opened (possible dead control or silent failure)');
        else verdicts.push('  page text unchanged (expected for this command)');
      }
      else verdicts.push(`  page changed in place (text ${before.len} -> ${after.len} chars${after.dialogs > before.dialogs ? ', dialog/modal opened' : ''})`);
    }
    if (S.pages.length > beforeTabs) verdicts.push(`  a new tab/window opened (${S.pages.length} total) — use \`tabs\` / \`tab <n>\``);
    if (S.lastSnapshot) {
      // If the refs were wiped out by a re-render, say so once instead of
      // letting the next command fail on a stale locator.
      let refsAlive = true;
      try { refsAlive = await page().evaluate(() => !!document.querySelector('[data-eyes-ref]')); } catch { refsAlive = false; }
      if (!refsAlive) { S.lastSnapshot = null; verdicts.push('  refs invalidated (page re-rendered/navigated) — run `snap` before targeting anything'); }
    }
    lines.push(...verdicts);
    const fresh = drainNew();
    if (fresh.length) lines.push(...fresh);
    else if (!error) lines.push('  no console error, no failed request');
    if (file) lines.push(`  shot: ${file}`);
    const signals = [...verdicts, ...fresh];
    journal({ step: S.stepN, label, error, url: after ? after.url : null, shot: file, signals });
    return { text: lines.join('\n'), data: { step: S.stepN, error, url: after ? after.url : null, shot: file, signals } };
  }

  /* -------------------------------------------------------------- commands */

  const cmds = {
    async status() {
      const p = S.pages[S.active];
      let url = '(nenhuma)';
      try { url = p && !p.isClosed() ? p.url() : '(fechada)'; } catch {}
      return {
        text: [
          `engine   ${S.engine}${S.opts.headless ? ' (headless)' : ' (headed)'}`,
          `device   ${S.opts.device || 'desktop'}  locale ${S.opts.locale || 'pt-BR'}`,
          `runDir   ${S.runDir}`,
          `url      ${url}`,
          `tabs     ${S.pages.length} (active #${S.active})`,
          `steps    ${S.stepN} | shots ${S.shotN}`,
          `logged   ${S.console.length} console, ${S.pageErrors.length} uncaught, ${S.network.length} net problems, ${S.dialogs.length} dialogs`,
          `started  ${S.startedAt}`,
        ].join('\n'),
      };
    },

    async goto({ args, o }) {
      let url = args[0];
      if (!url) throw new Error('usage: goto <url>');
      if (!/^[a-z]+:\/\//i.test(url)) url = (/^localhost|^127\.|^\d+\.\d+\.\d+\.\d+/.test(url) ? 'http://' : 'https://') + url;
      const p = page();
      let status = null;
      const r = await act(`goto ${url}`, async () => {
        const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        status = resp ? resp.status() : null;
      }, o);
      const head = status ? `  HTTP ${status}${status >= 400 ? '  <-- error status on the page itself' : ''}` : '';
      const snap = await snapshot(o);
      return { text: [r.text, head, '', snap.text].filter(Boolean).join('\n'), data: { ...r.data, snapshot: snap.data } };
    },

    async snap({ o }) { return snapshot(o); },

    async click({ args, o }) {
      const ref = resolveRef(args[0]);
      const el = S.lastSnapshot && S.lastSnapshot.elements.find((e) => e.ref === ref);
      const label = `click ${ref} "${el ? el.name : '?'}"`;
      const dbl = !!flags(o).double;
      return act(label + (dbl ? ' (double)' : ''), async () => {
        const l = locOf(ref);
        await l.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        if (dbl) { await l.dblclick({ timeout: 10000 }); } else { await l.click({ timeout: 10000 }); }
      }, o);
    },

    /** Reads the value back so "I typed it" is never assumed — masks, maxlength
     *  and input filters get caught right here. */
    async fill({ args, o }) {
      const ref = resolveRef(args[0]);
      const value = args.slice(1).join(' ');
      const r = await act(`fill ${ref} with "${value.slice(0, 60)}"`, async () => {
        const l = locOf(ref);
        await l.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await l.fill(value, { timeout: 10000 });
      }, { ...flags(o), expectChange: false });
      return { text: r.text + (await readback(ref, value)), data: r.data };
    },

    async type({ args, o }) {
      const ref = resolveRef(args[0]);
      const value = args.slice(1).join(' ');
      const r = await act(`type "${value.slice(0, 60)}" into ${ref} (keystroke by keystroke)`, async () => {
        const l = locOf(ref);
        await l.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await l.click({ timeout: 8000 });
        await l.pressSequentially(value, { delay: flags(o).delay ? +flags(o).delay : 45 });
      }, { ...flags(o), expectChange: false });
      return { text: r.text + (await readback(ref, value)), data: r.data };
    },

    async press({ args, o }) {
      const key = args[0];
      if (!key) throw new Error('usage: press <Key>  (Enter, Tab, Escape, ArrowDown, Control+A...)');
      return act(`press ${key}`, async () => { await page().keyboard.press(key); }, o);
    },

    async select({ args, o }) {
      const ref = resolveRef(args[0]);
      const value = args.slice(1).join(' ');
      const r = await act(`select "${value}" in ${ref}`, async () => { await locOf(ref).selectOption(value, { timeout: 10000 }); }, { ...flags(o), expectChange: false });
      return { text: r.text + (await readback(ref, null)), data: r.data };
    },

    async check({ args, o }) {
      const ref = resolveRef(args[0]);
      return act(`${flags(o).off ? 'uncheck' : 'check'} ${ref}`, async () => { await locOf(ref).setChecked(flags(o).off ? false : true, { timeout: 10000 }); }, { ...flags(o), expectChange: false });
    },

    async hover({ args, o }) {
      const ref = resolveRef(args[0]);
      return act(`hover ${ref}`, async () => { await locOf(ref).hover({ timeout: 10000 }); }, o);
    },

    async scroll({ args, o }) {
      const where = (args[0] || 'down').toLowerCase();
      return act(`scroll ${where}`, async () => {
        const p = page();
        if (where === 'top') await p.evaluate(() => window.scrollTo({ top: 0 }));
        else if (where === 'bottom') await p.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
        else if (where === 'up') await p.evaluate(() => window.scrollBy({ top: -Math.round(window.innerHeight * 0.85) }));
        else if (/^e\d+$/.test(where)) await locOf(where).scrollIntoViewIfNeeded({ timeout: 5000 });
        else await p.evaluate(() => window.scrollBy({ top: Math.round(window.innerHeight * 0.85) }));
      }, { ...flags(o), settle: 350, expectChange: false });
    },

    async back({ o }) { return act('browser back', async () => { await page().goBack({ waitUntil: 'domcontentloaded' }); }, { ...flags(o), expectChange: false }); },
    async forward({ o }) { return act('browser forward', async () => { await page().goForward({ waitUntil: 'domcontentloaded' }); }, { ...flags(o), expectChange: false }); },
    async reload({ o }) { return act('reload (F5)', async () => { await page().reload({ waitUntil: 'domcontentloaded' }); }, { ...flags(o), expectChange: false }); },

    async wait({ args, o }) {
      const arg = args.join(' ');
      if (!arg) throw new Error('usage: wait <ms> | wait "<visible text>" | wait --sel="<css>"');
      return act(`wait ${arg}`, async () => {
        const p = page();
        if (flags(o).sel) await p.locator(String(flags(o).sel)).first().waitFor({ state: 'visible', timeout: 20000 });
        else if (/^\d+$/.test(arg)) await sleep(Math.min(+arg, 30000));
        else await p.getByText(arg, { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
      }, { ...flags(o), settle: 100, expectChange: false });
    },

    async find({ args }) {
      const needle = args.join(' ');
      if (!needle) throw new Error('usage: find <text>');
      const p = page();
      const hits = await p.evaluate((q) => {
        const res = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const ql = q.toLowerCase();
        let n;
        while ((n = walk.nextNode()) && res.length < 25) {
          const t = n.textContent.replace(/\s+/g, ' ').trim();
          if (!t || !t.toLowerCase().includes(ql)) continue;
          const el = n.parentElement;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          res.push({ text: t.slice(0, 100), tag: el.tagName.toLowerCase(), ref: el.getAttribute('data-eyes-ref') || (el.closest('[data-eyes-ref]') ? el.closest('[data-eyes-ref]').getAttribute('data-eyes-ref') : null), y: Math.round(r.top + window.scrollY) });
        }
        return res;
      }, needle);
      if (!hits.length) return { text: `"${needle}" não aparece no texto visível desta página.` };
      return { text: hits.map((h) => `  ${h.ref ? '[' + h.ref + '] ' : '(sem ref) '}${h.tag} y=${h.y}: ${h.text}`).join('\n') };
    },

    async text({ o }) {
      const t = await page().evaluate(textFn, flags(o).max ? +flags(o).max : 6000);
      return { text: t || '(página sem texto visível)' };
    },

    async shot({ args, o }) {
      const p = page();
      const nm = String(++S.shotN).padStart(3, '0') + '-' + ((args[0] || 'manual').replace(/[^a-z0-9_-]+/gi, '-')) + '.png';
      const file = path.join(runDir, 'shots', nm);
      await p.screenshot({ path: file, fullPage: !!flags(o).full });
      journal({ step: S.stepN, label: 'screenshot', shot: file });
      return { text: `shot: ${file}${flags(o).full ? ' (full page)' : ''}` };
    },

    async console({ o }) {
      const list = flags(o).all ? S.console : S.console.filter((c) => c.type === 'error' || c.type === 'assert');
      const lines = [];
      if (S.pageErrors.length) {
        lines.push(`uncaught exceptions (${S.pageErrors.length}):`);
        for (const e of S.pageErrors) lines.push(`  ${e.text}\n      ${e.stack}`);
      }
      lines.push(`console ${flags(o).all ? 'messages' : 'errors'} (${list.length}${flags(o).all ? '' : ' of ' + S.console.length + ' captured'}):`);
      for (const c of list.slice(-60)) lines.push(`  [${c.type}] ${c.text}${c.loc ? '  (' + c.loc + ')' : ''}`);
      if (!list.length && !S.pageErrors.length) lines.push('  (limpo — nenhum erro de console nesta sessão)');
      return { text: lines.join('\n') };
    },

    async net({ o }) {
      const lines = [`network problems captured (${S.network.length}):`];
      for (const r of S.network.slice(-60)) lines.push(`  ${r.kind === 'failed' ? 'FAILED' : 'HTTP ' + r.status} ${r.method} ${r.url}${r.error ? ' — ' + r.error : ''}`);
      if (!S.network.length) lines.push('  (nenhum request falhou nem retornou >=400)');
      if (S.downloads.length) { lines.push('', 'downloads:'); for (const d of S.downloads) lines.push('  ' + d.file); }
      return { text: lines.join('\n') };
    },

    async dialogs() {
      if (!S.dialogs.length) return { text: '(nenhum alert/confirm/prompt disparado)' };
      return { text: S.dialogs.map((d) => `  ${d.type}: "${d.message}"`).join('\n') };
    },

    async perf() {
      const p = page();
      const d = await p.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] || {};
        const res = performance.getEntriesByType('resource');
        const by = {};
        let total = 0;
        for (const r of res) {
          const t = r.initiatorType || 'other';
          const sz = r.transferSize || r.encodedBodySize || 0;
          by[t] = by[t] || { n: 0, bytes: 0 };
          by[t].n++; by[t].bytes += sz; total += sz;
        }
        const slow = res.slice().sort((a, b) => b.duration - a.duration).slice(0, 6).map((r) => ({ url: r.name.slice(-80), ms: Math.round(r.duration), kb: Math.round((r.transferSize || 0) / 1024) }));
        const paint = {};
        for (const e of performance.getEntriesByType('paint')) paint[e.name] = Math.round(e.startTime);
        return {
          ttfb: Math.round((nav.responseStart || 0) - (nav.requestStart || 0)),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
          load: Math.round(nav.loadEventEnd || 0),
          transferKB: Math.round(total / 1024),
          requests: res.length,
          by, slow, paint,
          perf: window.__eyesPerf || null,
          domNodes: document.querySelectorAll('*').length,
        };
      });
      const lines = [
        `TTFB ${d.ttfb}ms | first-paint ${d.paint['first-paint'] || '?'}ms | FCP ${d.paint['first-contentful-paint'] || '?'}ms | DOMContentLoaded ${d.domContentLoaded}ms | load ${d.load}ms`,
        d.perf ? `LCP ${Math.round(d.perf.lcp)}ms | CLS ${d.perf.cls.toFixed(3)} | long tasks ${d.perf.longTasks} (${Math.round(d.perf.longTaskMs)}ms blocking)` : '',
        `${d.requests} requests, ${d.transferKB}KB transferred, ${d.domNodes} DOM nodes`,
        'by type: ' + Object.entries(d.by).map(([k, v]) => `${k} ${v.n}/${Math.round(v.bytes / 1024)}KB`).join(', '),
        'slowest resources:',
        ...d.slow.map((r) => `  ${r.ms}ms ${r.kb}KB ${r.url}`),
        '',
        'budget: LCP <2500ms good / >4000ms poor | CLS <0.1 good / >0.25 poor | TTFB <800ms good',
      ];
      return { text: lines.filter(Boolean).join('\n'), data: d };
    },

    async contrast() {
      const d = await page().evaluate(contrastFn);
      if (!d.length) return { text: 'contraste: nenhum texto visível abaixo do mínimo WCAG AA nesta viewport.' };
      const lines = [`WCAG AA contrast failures in this viewport (${d.length}):`];
      for (const c of d) lines.push(`  ${c.ratio}:1 (precisa ${c.need}:1) ${c.fontSize}px  "${c.text}"  fg ${c.color} on ${c.bg}`);
      return { text: lines.join('\n'), data: d };
    },

    async a11y() {
      const p = page();
      let src;
      try {
        const axePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules', 'axe-core', 'axe.min.js');
        src = fs.readFileSync(axePath, 'utf8');
      } catch (e) {
        try { src = fs.readFileSync(path.join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'), 'utf8'); } catch { throw new Error('axe-core not found — run `npm install` inside the skill runtime dir'); }
      }
      await p.addScriptTag({ content: src });
      const res = await p.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const r = await axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
        return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')), summary: (v.nodes[0] && v.nodes[0].failureSummary || '').split('\n').slice(0, 3).join(' ') }));
      });
      if (!res.length) return { text: 'axe-core: 0 violações (wcag2a/aa + best-practice).' };
      const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
      res.sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9));
      const lines = [`axe-core violations (${res.length} rules, ${res.reduce((s, v) => s + v.n, 0)} nodes):`];
      for (const v of res) lines.push(`  [${(v.impact || '?').toUpperCase()}] ${v.id} x${v.n} — ${v.help}\n      targets: ${v.targets.join(' ; ')}`);
      return { text: lines.join('\n'), data: res };
    },

    /** Keyboard-only sweep: does Tab reach everything, in order, with a visible ring? */
    async tabaudit({ args }) {
      const steps = Math.min(parseInt(args[0] || '40', 10), 120);
      const p = page();
      // Reset the sequential-focus starting point to the top of the document,
      // otherwise Tab resumes from whatever was clicked last and the audit
      // silently skips everything above it.
      await p.evaluate(() => {
        const de = document.documentElement;
        const had = de.getAttribute('tabindex');
        de.setAttribute('tabindex', '-1');
        de.focus();
        de.blur();
        if (had === null) de.removeAttribute('tabindex'); else de.setAttribute('tabindex', had);
        window.scrollTo({ top: 0 });
      });
      const seq = [];
      let escaped = false;
      for (let i = 0; i < steps; i++) {
        await p.keyboard.press('Tab');
        await sleep(55);
        let f;
        try { f = await p.evaluate(focusFn); } catch { break; }
        if (f.none) { escaped = true; break; }
        seq.push(f);
        // a ref repeating after >2 stops means the focus is looping in a trap
        if (seq.length > 3 && f.ref && seq.slice(0, -1).some((s2, idx) => s2.ref === f.ref && idx > seq.length - 4)) break;
      }
      const lines = [`tab order (${seq.length} stops${escaped ? ', then focus left the page' : ''}):`];
      let prevY = -1, jumps = 0, noRing = 0, offscreen = 0;
      seq.forEach((f, i) => {
        const back = prevY >= 0 && f.y < prevY - 80;
        if (back) jumps++;
        if (!f.visibleRing) noRing++;
        if (f.offscreen) offscreen++;
        lines.push(`  ${i + 1}. ${f.tag}${f.ref ? '/' + f.ref : ''} "${f.name}"${f.visibleRing ? '' : '  NO-FOCUS-RING'}${f.offscreen ? '  OFF-SCREEN' : ''}${back ? '  ORDER-JUMP-UP' : ''}`);
        prevY = f.y;
      });
      let unreachable = [];
      if (S.lastSnapshot) {
        const reached = new Set(seq.map((f) => f.ref).filter(Boolean));
        unreachable = S.lastSnapshot.elements.filter((e) => !e.disabled && !reached.has(e.ref));
      }
      if (unreachable.length) {
        lines.push('', `NEVER FOCUSED by the keyboard (${unreachable.length}) — unusable without a mouse:`);
        for (const u of unreachable.slice(0, 15)) lines.push(`  ${u.ref} ${u.tag} "${u.name || u.placeholder || '?'}"`);
      }
      lines.push('', `keyboard verdict: ${noRing} stop(s) with no visible focus ring, ${jumps} backwards jump(s) vs visual order, ${offscreen} focus stop(s) scrolled out of view, ${unreachable.length} control(s) unreachable.`);
      if (!escaped && seq.length >= steps) lines.push(`(hit the ${steps}-stop cap; pass a bigger number, or suspect a focus trap)`);
      journal({ step: S.stepN, label: 'tabaudit', data: { stops: seq.length, noRing, jumps, unreachable: unreachable.length } });
      return { text: lines.join('\n'), data: { seq, unreachable } };
    },

    async storage() {
      const d = await page().evaluate(storageFn);
      const fmt = (o) => Object.keys(o).length ? Object.entries(o).map(([k, v]) => `    ${k} = ${v}`).join('\n') : '    (vazio)';
      return { text: [`cookies: ${d.cookieCount}`, 'localStorage:', fmt(d.localStorage), 'sessionStorage:', fmt(d.sessionStorage)].join('\n'), data: d };
    },

    async reset({ o }) {
      await S.context.clearCookies();
      try { await page().evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); } catch {}
      return act('reset session state (cookies + localStorage + sessionStorage cleared) — next load is a first-time visitor', async () => {
        if (!flags(o).noreload) await page().reload({ waitUntil: 'domcontentloaded' });
      }, { ...flags(o), expectChange: false });
    },

    async viewport({ args, o }) {
      const m = /^(\d+)x(\d+)$/.exec(args[0] || '');
      if (!m) throw new Error('usage: viewport <width>x<height>');
      return act(`resize viewport to ${args[0]}`, async () => { await page().setViewportSize({ width: +m[1], height: +m[2] }); }, { ...flags(o), expectChange: false });
    },

    async device({ args, o }) {
      const name = args[0];
      const d = DEVICES[name];
      if (!d) throw new Error('unknown device. options: ' + Object.keys(DEVICES).join(', '));
      const r = await act(`switch viewport to ${name} (${d.viewport.width}x${d.viewport.height})`, async () => {
        await page().setViewportSize(d.viewport);
      }, { ...flags(o), expectChange: false });
      const note = d.isMobile && !S.opts.device?.startsWith('mobile') && !S.opts.device?.startsWith('tablet')
        ? '\n  note: viewport is now touch-sized but the context still reports a desktop UA/touch profile — restart with `start --device=' + name + '` when the app branches on user-agent or touch support.'
        : '';
      return { text: r.text + note, data: r.data };
    },

    async throttle({ args }) {
      const name = (args[0] || 'none').toLowerCase();
      const prof = NETWORK[name];
      if (!prof) throw new Error('unknown profile. options: ' + Object.keys(NETWORK).join(', '));
      try {
        if (!S.cdp) S.cdp = await S.context.newCDPSession(page());
        await S.cdp.send('Network.enable');
        await S.cdp.send('Network.emulateNetworkConditions', prof);
      } catch (e) { throw new Error('CDP throttling failed (chromium-only): ' + e.message); }
      journal({ step: S.stepN, label: 'throttle ' + name });
      return { text: `network throttled to "${name}". Reload to see how the UI behaves while slow — missing skeletons/spinners show up here.` };
    },

    async tabs() {
      const lines = ['open tabs:'];
      for (let i = 0; i < S.pages.length; i++) {
        let u = '(?)', t = '';
        try { u = S.pages[i].url(); t = await S.pages[i].title(); } catch {}
        lines.push(`  ${i === S.active ? '*' : ' '} #${i} ${t ? '"' + t.slice(0, 40) + '" ' : ''}${u}`);
      }
      return { text: lines.join('\n') };
    },

    async tab({ args }) {
      const i = parseInt(args[0], 10);
      if (!Number.isInteger(i) || !S.pages[i]) throw new Error('usage: tab <index>  (see `tabs`)');
      S.active = i;
      await S.pages[i].bringToFront().catch(() => {});
      S.lastSnapshot = null;
      return { text: `active tab -> #${i} ${S.pages[i].url()} (refs invalidated, run \`snap\`)` };
    },

    async closetab({ args }) {
      const i = args[0] == null ? S.active : parseInt(args[0], 10);
      if (!S.pages[i]) throw new Error('no such tab');
      await S.pages[i].close();
      return { text: `closed tab #${i}; ${S.pages.length} left` };
    },

    async eval({ args }) {
      const code = args.join(' ');
      if (!code) throw new Error('usage: eval <javascript expression>');
      const r = await page().evaluate(`(() => { return (${code}); })()`).catch(async (e) => {
        return await page().evaluate(`(() => { ${code} })()`).catch((e2) => 'EVAL ERROR: ' + e2.message);
      });
      return { text: typeof r === 'string' ? r : JSON.stringify(r, null, 1).slice(0, 4000) };
    },

    async journal() {
      const f = path.join(runDir, 'journal.jsonl');
      let n = 0;
      try { n = fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).length; } catch {}
      return { text: `journal: ${f} (${n} entries)\nshots:   ${path.join(runDir, 'shots')}\nvideo:   ${path.join(runDir, 'video')} (written on stop)` };
    },

    async stop() {
      const summary = {
        steps: S.stepN, shots: S.shotN,
        consoleErrors: S.console.filter((c) => c.type === 'error').length,
        uncaught: S.pageErrors.length,
        netProblems: S.network.length,
        dialogs: S.dialogs.length,
      };
      journal({ label: 'session end', data: summary });
      try { fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ ...summary, runDir, startedAt: S.startedAt, endedAt: nowIso(), console: S.console, pageErrors: S.pageErrors, network: S.network, dialogs: S.dialogs }, null, 2)); } catch {}
      let videos = [];
      try {
        await S.context.close();
        videos = fs.readdirSync(path.join(runDir, 'video')).map((f) => path.join(runDir, 'video', f));
      } catch {}
      try { await S.browser.close(); } catch {}
      try { fs.unlinkSync(stateFile); } catch {}
      const text = [
        `session closed. ${summary.steps} steps, ${summary.shots} screenshots.`,
        `console errors ${summary.consoleErrors} | uncaught ${summary.uncaught} | network problems ${summary.netProblems} | dialogs ${summary.dialogs}`,
        `evidence: ${runDir}`,
        videos.length ? `video: ${videos.join(', ')}` : '',
      ].filter(Boolean).join('\n');
      setTimeout(() => process.exit(0), 250);
      return { text };
    },
  };

  cmds['tab-audit'] = cmds.tabaudit;
  cmds.dblclick = async ({ args, o }) => cmds.click({ args, o: { ...flags(o), double: true } });
  cmds.screenshot = cmds.shot;
  cmds.net_errors = cmds.net;

  /* ------------------------------------------------------------ http layer */

  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let out;
      try {
        const { cmd, args = [], o = {} } = JSON.parse(body || '{}');
        const fn = cmds[cmd];
        if (!fn) throw new Error(`unknown command "${cmd}". available: ${Object.keys(cmds).sort().join(', ')}`);
        out = { ok: true, ...(await fn({ args, o })) };
      } catch (e) {
        out = { ok: false, text: 'ERROR: ' + String(e.message) };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ port, pid: process.pid, runDir, engine: S.engine, opts, startedAt: S.startedAt }, null, 2));
  journal({ label: 'session start', data: { engine: S.engine, opts, port } });
  return { port, engine: S.engine };
}
