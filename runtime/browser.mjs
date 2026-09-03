/**
 * browser.mjs — resolve and launch a real browser with playwright-core.
 *
 * We deliberately avoid the `playwright` package: it downloads its own
 * Chromium (~150MB per version). playwright-core drives whatever browser is
 * already on the machine (Chrome / Edge channel), and only falls back to a
 * Chromium already sitting in the ms-playwright cache.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function findCachedChromium() {
  const roots = [
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  ];
  const candidates = [];
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries) {
      const m = /^chromium-(\d+)$/.exec(e);
      if (!m) continue;
      const build = parseInt(m[1], 10);
      const rels = [
        ['chrome-win', 'chrome.exe'],
        ['chrome-linux', 'chrome'],
        ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
      ];
      for (const rel of rels) {
        const p = path.join(root, e, ...rel);
        if (fs.existsSync(p)) candidates.push({ build, p });
      }
    }
  }
  candidates.sort((a, b) => b.build - a.build);
  return candidates.length ? candidates[0].p : null;
}

export async function launchBrowser(chromium, opts) {
  const launchOpts = {
    headless: !!opts.headless,
    slowMo: opts.slowMo || 0,
    args: ['--disable-features=Translate', '--no-default-browser-check', '--no-first-run'],
  };
  const wanted = opts.browser || 'auto';
  const attempts = [];
  if (wanted === 'auto') attempts.push({ channel: 'chrome' }, { channel: 'msedge' }, { cached: true });
  else if (wanted === 'chromium') attempts.push({ cached: true });
  else attempts.push({ channel: wanted }, { cached: true });

  const errors = [];
  for (const a of attempts) {
    try {
      if (a.cached) {
        const exe = findCachedChromium();
        if (!exe) throw new Error('no cached chromium found under ms-playwright');
        const browser = await chromium.launch({ ...launchOpts, executablePath: exe });
        return { browser, engine: 'chromium (cached)' };
      }
      const browser = await chromium.launch({ ...launchOpts, channel: a.channel });
      return { browser, engine: a.channel };
    } catch (e) {
      errors.push((a.channel || 'cached-chromium') + ': ' + String(e.message).split('\n')[0]);
    }
  }
  throw new Error('could not launch any browser.\n  ' + errors.join('\n  '));
}

/** Minimal device presets — enough for the mobile/tablet/desktop sweep. */
export const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  laptop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  tv: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  tablet: {
    viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  mobile: {
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  'mobile-small': {
    viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  },
};

/** Network profiles for CDP Network.emulateNetworkConditions. */
export const NETWORK = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  'fast-3g': { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  'slow-3g': { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
  '2g': { offline: false, latency: 800, downloadThroughput: (250 * 1024) / 8, uploadThroughput: (50 * 1024) / 8 },
};
