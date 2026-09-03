#!/usr/bin/env node
/**
 * bundle.mjs — turn a finished run into everything an Artifact needs.
 *
 *   node bundle.mjs                          # newest run, auto-pick evidence shots
 *   node bundle.mjs --run=<runDir>
 *   node bundle.mjs --shots=4,13             # embed these step numbers
 *   node bundle.mjs --shots=all              # embed every screenshot (watch the budget)
 *   node bundle.mjs --shots=none             # journey only, no images
 *   node bundle.mjs --max-mb=8 --out=bundle.json
 *
 * Runs STANDALONE: it reads the run directory off disk, so it works after
 * `eyes stop` has already killed the daemon. That is the point — the report is
 * written after the session closes.
 *
 * Emits `bundle.json` in the run dir:
 *   session   stats, timing, engine, and the console/network/dialog tallies
 *   steps[]   the journey, one entry per action: step, label, url, signals, shot
 *   shots{}   step number -> { file, bytes, dataUri }  ready to drop into <img src>
 *
 * `dataUri` exists because a published Artifact cannot reach the user's disk.
 * Citing `shots/004-click.png` in a shared page shows the reader nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const STATE_DIR = path.join(os.tmpdir(), 'claude-eyes');

/** Per-shot ceiling before we try to shrink it. 1.5 MB raw ~= 2 MB of base64. */
const SHOT_SOFT_CAP = 1.5 * 1024 * 1024;
/** Total base64 ceiling. The Artifact hard limit is 16 MB; leave real headroom. */
const DEFAULT_MAX_MB = 10;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Byte count as MB, without rounding a small budget down to a bare "0". */
function mb(bytes) {
  const v = bytes / 1048576;
  return v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);
}

function parseArgv(argv) {
  const flags = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return flags;
}

function newestRun() {
  let entries;
  try {
    entries = fs.readdirSync(STATE_DIR);
  } catch {
    return null;
  }
  const runs = entries
    .filter((d) => d.startsWith('run-'))
    .map((d) => path.join(STATE_DIR, d))
    .filter((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
  return runs.length ? runs[runs.length - 1] : null;
}

function readJournal(runDir) {
  const f = path.join(runDir, 'journal.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readSummary(runDir) {
  const f = path.join(runDir, 'summary.json');
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The journey. One row per journaled action, in order, carrying the signals the
 * driver volunteered at that step — which is what makes a step interesting.
 */
function buildSteps(journal) {
  return journal
    .filter((e) => e.step != null || e.label === 'session start' || e.label === 'session end')
    .map((e) => ({
      step: e.step == null ? null : e.step,
      t: e.t || null,
      label: e.label || null,
      url: e.url || null,
      error: e.error || null,
      signals: Array.isArray(e.signals) ? e.signals : e.signals ? [e.signals] : [],
      shot: e.shot ? path.basename(e.shot) : null,
      data: e.data || null,
    }));
}

/**
 * Not every signal is a problem. Every step carries a verdict — "page changed
 * in place", "navigated: a -> b" — and those are just narration. These are the
 * ones that mean something is wrong:
 *   NO VISIBLE CHANGE   a dead control, or a failure the UI never showed
 *   !!                  the driver's own marker for console errors, uncaught
 *                       exceptions and HTTP 4xx/5xx
 *   a new tab/window    the flow jumped context
 *   DIFFERENT           a mask or filter mangled what was typed
 *   considers this field invalid   native validation fired
 */
const PROBLEM = /NO VISIBLE CHANGE|!!|a new tab\/window opened|DIFFERENT|considers this field invalid/;

function isProblem(step) {
  return !!step.error || step.signals.some((s) => PROBLEM.test(s));
}

/** A step earns a screenshot when something actually went wrong there. */
function autoPickSteps(steps) {
  return steps.filter((s) => s.step != null && s.shot && isProblem(s)).map((s) => s.step);
}

function resolveShotFile(runDir, steps, wanted) {
  const hit = steps.find((s) => s.step === wanted && s.shot);
  if (hit) return path.join(runDir, 'shots', hit.shot);
  // Fall back to matching the zero-padded prefix the daemon writes.
  const dir = path.join(runDir, 'shots');
  if (!fs.existsSync(dir)) return null;
  const pad = String(wanted).padStart(3, '0');
  const f = fs.readdirSync(dir).find((n) => n.startsWith(pad + '-'));
  return f ? path.join(dir, f) : null;
}

function toDataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const b64 = fs.readFileSync(file).toString('base64');
  return 'data:' + (MIME[ext] || 'image/png') + ';base64,' + b64;
}

/**
 * Shrink oversized screenshots by round-tripping them through a real canvas.
 * playwright-core is already a dependency and the system browser is already
 * required, so this costs no new install. If no browser is reachable we say so
 * and the caller drops the shot rather than blowing the budget.
 */
async function shrink(files, maxWidth, quality) {
  const out = new Map();
  let chromium;
  let launchBrowser;
  try {
    ({ chromium } = await import('playwright-core'));
    ({ launchBrowser } = await import('./browser.mjs'));
  } catch {
    return { out, error: 'playwright-core not installed (run `npm install` in runtime/)' };
  }
  let browser;
  try {
    ({ browser } = await launchBrowser(chromium, { headless: true }));
  } catch (e) {
    return { out, error: String(e.message).split('\n')[0] };
  }
  try {
    const page = await browser.newPage();
    for (const [key, file] of files) {
      const src = toDataUri(file);
      const jpeg = await page.evaluate(
        (arg) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const scale = Math.min(1, arg.maxWidth / img.naturalWidth);
              const c = document.createElement('canvas');
              c.width = Math.max(1, Math.round(img.naturalWidth * scale));
              c.height = Math.max(1, Math.round(img.naturalHeight * scale));
              const ctx = c.getContext('2d');
              ctx.fillStyle = '#fff';
              ctx.fillRect(0, 0, c.width, c.height);
              ctx.drawImage(img, 0, 0, c.width, c.height);
              resolve(c.toDataURL('image/jpeg', arg.quality));
            };
            img.onerror = () => reject(new Error('could not decode'));
            img.src = arg.src;
          }),
        { src, maxWidth, quality }
      );
      out.set(key, jpeg);
    }
    return { out, error: null };
  } catch (e) {
    return { out, error: String(e.message).split('\n')[0] };
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}

function collectVideo(runDir) {
  const d = path.join(runDir, 'video');
  try {
    return fs.readdirSync(d).map((f) => path.join(d, f));
  } catch {
    return [];
  }
}

async function main() {
  const flags = parseArgv(process.argv.slice(2));

  const runDir = flags.run ? String(flags.run) : newestRun();
  if (!runDir || !fs.existsSync(runDir)) {
    console.error(
      'no run directory found.\n' +
        'Looked under ' + STATE_DIR + '. Pass --run=<dir>, or run a session first.'
    );
    process.exit(2);
  }

  const journal = readJournal(runDir);
  if (!journal.length) {
    console.error('no journal.jsonl in ' + runDir + ' — was a session actually driven here?');
    process.exit(2);
  }
  const summary = readSummary(runDir);
  const steps = buildSteps(journal);
  const startEntry = journal.find((e) => e.label === 'session start');

  const session = {
    runDir,
    engine: (startEntry && startEntry.data && startEntry.data.engine) || null,
    opts: (startEntry && startEntry.data && startEntry.data.opts) || null,
    startedAt: (summary && summary.startedAt) || (startEntry && startEntry.t) || null,
    endedAt: (summary && summary.endedAt) || null,
    closed: !!summary,
    steps: summary && summary.steps != null ? summary.steps : steps.filter((s) => s.step != null).length,
    shots: summary && summary.shots != null ? summary.shots : steps.filter((s) => s.shot).length,
    consoleErrors: summary ? summary.consoleErrors : null,
    uncaught: summary ? summary.uncaught : null,
    netProblems: summary ? summary.netProblems : null,
    console: (summary && summary.console) || [],
    pageErrors: (summary && summary.pageErrors) || [],
    network: (summary && summary.network) || [],
    dialogs: (summary && summary.dialogs) || [],
    video: collectVideo(runDir),
  };

  // ---- which screenshots to embed ----
  const spec = flags.shots === undefined ? 'auto' : String(flags.shots);
  let wanted;
  if (spec === 'none') wanted = [];
  else if (spec === 'all') wanted = steps.filter((s) => s.shot && s.step != null).map((s) => s.step);
  else if (spec === 'auto') wanted = autoPickSteps(steps);
  else wanted = spec.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
  wanted = Array.from(new Set(wanted));

  const maxBytes = Math.round((flags['max-mb'] ? Number(flags['max-mb']) : DEFAULT_MAX_MB) * 1024 * 1024);
  const shots = {};
  const notes = [];
  const oversized = new Map();

  for (const n of wanted) {
    const file = resolveShotFile(runDir, steps, n);
    if (!file || !fs.existsSync(file)) {
      notes.push('step ' + n + ': no screenshot on disk');
      continue;
    }
    if (fs.statSync(file).size > SHOT_SOFT_CAP) {
      oversized.set(n, file);
      continue;
    }
    const dataUri = toDataUri(file);
    shots[n] = { file: path.basename(file), bytes: dataUri.length, dataUri };
  }

  if (oversized.size) {
    const maxWidth = flags['max-width'] ? Number(flags['max-width']) : 1100;
    const quality = flags.quality ? Number(flags.quality) : 0.72;
    const { out, error } = await shrink(oversized, maxWidth, quality);
    for (const [n, uri] of out) {
      shots[n] = {
        file: path.basename(oversized.get(n)),
        bytes: uri.length,
        dataUri: uri,
        shrunk: { maxWidth, quality },
      };
    }
    for (const n of oversized.keys()) {
      if (shots[n]) continue;
      const mb = (fs.statSync(oversized.get(n)).size / 1048576).toFixed(1);
      notes.push(
        'step ' + n + ': ' + mb + ' MB, too big to embed' +
          (error ? ' and could not be shrunk (' + error + ')' : '') +
          ' — cite the path instead: ' + oversized.get(n)
      );
    }
  }

  // ---- budget: drop the biggest first, never silently ----
  let total = Object.keys(shots).reduce((a, k) => a + shots[k].bytes, 0);
  if (total > maxBytes) {
    const ranked = Object.keys(shots)
      .map((k) => [k, shots[k]])
      .sort((a, b) => b[1].bytes - a[1].bytes);
    while (total > maxBytes && ranked.length) {
      const [n, s] = ranked.shift();
      delete shots[n];
      total -= s.bytes;
      notes.push(
        'step ' + n + ': dropped to stay under the ' + mb(maxBytes) +
          ' MB budget — cite the path instead'
      );
    }
  }

  const bundle = {
    generatedAt: new Date().toISOString(),
    session,
    steps,
    shots,
    budget: {
      embeddedBytes: total,
      maxBytes,
      embedded: Object.keys(shots).length,
      requested: wanted.length,
    },
    notes,
  };

  const out = flags.out ? String(flags.out) : path.join(runDir, 'bundle.json');
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2), 'utf8');

  const flagged = steps.filter(isProblem);
  const lines = [
    'bundle: ' + out,
    'run:    ' + runDir + (session.closed ? '' : '   (session still open — `stop` first for video + summary)'),
    'steps:  ' + session.steps + '   flagged: ' + flagged.length + '   shots on disk: ' + session.shots,
    'signals: console errors ' + (session.consoleErrors == null ? '?' : session.consoleErrors) +
      ' | uncaught ' + (session.uncaught == null ? '?' : session.uncaught) +
      ' | network ' + (session.netProblems == null ? '?' : session.netProblems),
    'embedded: ' + Object.keys(shots).length + '/' + wanted.length + ' screenshots, ' +
      (total / 1048576).toFixed(2) + ' MB of ' + mb(maxBytes) + ' MB budget',
  ];
  if (session.video.length) {
    lines.push('video:  ' + session.video.join(', ') + '   (local only — an Artifact cannot reach it)');
  }
  if (flagged.length) {
    lines.push('', 'flagged steps (these are your findings):');
    for (const s of flagged.slice(0, 25)) {
      lines.push(
        '  ' + String(s.step).padStart(3) + '  ' + (s.label || '') +
          (s.error ? '  ERROR: ' + s.error : '') +
          (s.signals.length ? '  [' + s.signals.join(' | ') + ']' : '')
      );
    }
    if (flagged.length > 25) lines.push('  … ' + (flagged.length - 25) + ' more in bundle.json');
  }
  if (notes.length) {
    lines.push('', 'notes:');
    for (const n of notes) lines.push('  - ' + n);
  }
  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error('ERROR: ' + e.message);
  process.exit(1);
});
