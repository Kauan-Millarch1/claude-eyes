/**
 * inpage.mjs — everything that runs inside the page.
 *
 * These are passed to page.evaluate / page.addInitScript, so they must be
 * self-contained: no imports, no closures over module scope.
 */

/** Registered before every navigation so the observers exist from the first paint. */
export const INIT_SCRIPT = `(() => {
  if (window.__eyesInit) return;
  window.__eyesInit = true;
  window.__eyesPerf = { lcp: 0, cls: 0, longTasks: 0, longTaskMs: 0 };
  var obs = function (type, fn) { try { new PerformanceObserver(fn).observe({ type: type, buffered: true }); } catch (e) {} };
  obs('largest-contentful-paint', function (l) { l.getEntries().forEach(function (e) { window.__eyesPerf.lcp = Math.max(window.__eyesPerf.lcp, e.startTime); }); });
  obs('layout-shift', function (l) { l.getEntries().forEach(function (e) { if (!e.hadRecentInput) window.__eyesPerf.cls += e.value; }); });
  obs('longtask', function (l) { l.getEntries().forEach(function (e) { window.__eyesPerf.longTasks++; window.__eyesPerf.longTaskMs += e.duration; }); });
})();`;

/**
 * Builds the interactive snapshot: every clickable/typable thing gets a stable
 * ref the agent can act on, plus the static UX/a11y defects found while walking
 * the DOM. This is the "eye" — refs are how intent becomes a real click.
 */
export function snapshotFn(opts) {
  var MAX = (opts && opts.max) || 220;
  var out = { url: location.href, title: document.title, elements: [], outline: [], issues: [], stats: {} };

  document.querySelectorAll('[data-eyes-ref]').forEach(function (e) { e.removeAttribute('data-eyes-ref'); });

  var vw = window.innerWidth, vh = window.innerHeight;
  var isNarrow = vw <= 640;

  function visible(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    if (parseFloat(s.opacity || '1') < 0.05) return false;
    if (el.hasAttribute('hidden')) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    return true;
  }
  function inViewport(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  }
  function txt(el) { return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function name(el) {
    var aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      var parts = lb.split(/\s+/).map(function (id) { var n = document.getElementById(id); return n ? txt(n) : ''; }).filter(Boolean);
      if (parts.length) return parts.join(' ').slice(0, 120);
    }
    if (el.id) {
      var lab = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (lab && txt(lab)) return txt(lab).slice(0, 120);
    }
    var wrap = el.closest('label');
    if (wrap && txt(wrap)) return txt(wrap).slice(0, 120);
    if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').slice(0, 120);
    var t = txt(el);
    if (t) return t.slice(0, 120);
    // title and the value of a push button are real accessible names.
    // placeholder and the name attribute are NOT — they are reported separately
    // so that "field with only a placeholder" shows up as the defect it is.
    var isPush = el.tagName === 'BUTTON' || /^(submit|button|reset)$/i.test(el.getAttribute('type') || '');
    return (el.getAttribute('title') || (isPush ? el.getAttribute('value') : '') || '').trim().slice(0, 120);
  }

  var SEL = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary',
    '[role=button]', '[role=link]', '[role=tab]', '[role=menuitem]', '[role=checkbox]',
    '[role=radio]', '[role=switch]', '[role=combobox]', '[role=option]', '[role=textbox]',
    '[onclick]', '[contenteditable=""]', '[contenteditable=true]', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  var n = 0, seen = new Set();
  var nodes = document.querySelectorAll(SEL);
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (seen.has(el) || !visible(el)) continue;
    seen.add(el);
    if (n >= MAX) { out.stats.truncated = true; break; }
    var ref = 'e' + (++n);
    el.setAttribute('data-eyes-ref', ref);
    var r = el.getBoundingClientRect();
    var tag = el.tagName.toLowerCase();
    var role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag);
    var item = {
      ref: ref, tag: tag, role: role, name: name(el),
      w: Math.round(r.width), h: Math.round(r.height),
      x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
      inViewport: inViewport(el)
    };
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') item.disabled = true;
    var ph = (el.getAttribute('placeholder') || '').trim();
    var nameAttr = (el.getAttribute('name') || el.id || '').trim();
    if (ph) item.placeholder = ph.slice(0, 60);
    if (!item.name && nameAttr) item.hint = nameAttr.slice(0, 40);
    if (tag === 'input' || tag === 'textarea') {
      item.type = el.getAttribute('type') || 'text';
      if (el.required || el.getAttribute('aria-required') === 'true') item.required = true;
      if (el.value) item.value = String(el.value).slice(0, 60);
      if (el.checked) item.checked = true;
      if (el.readOnly) item.readonly = true;
      if (el.getAttribute('aria-invalid') === 'true') item.invalid = true;
      if (!el.getAttribute('autocomplete') && /email|tel|phone|celular|name|nome|address|endere|cep|zip|card|cart|cpf/i.test(nameAttr + item.name + ph + item.type)) item.noAutocomplete = true;
    }
    if (tag === 'select') item.options = Array.prototype.slice.call(el.options, 0, 12).map(function (o) { return o.value; });
    if (tag === 'a') {
      item.href = el.getAttribute('href');
      if (el.target === '_blank') item.newTab = true;
    }
    out.elements.push(item);

    if (!item.name) {
      out.issues.push({
        kind: 'unnamed-control', ref: ref,
        detail: tag + (item.type ? '[' + item.type + ']' : '') + (item.hint ? ' (name="' + item.hint + '")' : '') +
          ' has no accessible name' + (item.placeholder ? ' — only a placeholder "' + item.placeholder + '", which vanishes as soon as the user types' : ' (no label, aria-label or text)'),
      });
    }
    // WCAG 2.5.8 puts the hard floor at 24x24 and exempts links inline in text;
    // 32px is the practical floor for a thumb on a real phone.
    if (isNarrow && item.w > 0) {
      var minDim = Math.min(item.w, item.h);
      var floor = tag === 'a' ? 24 : 32;
      if (minDim < floor) out.issues.push({ kind: 'small-tap-target', ref: ref, detail: '"' + (item.name || item.placeholder || tag) + '" is ' + item.w + 'x' + item.h + 'px — smallest side ' + minDim + 'px is under the ' + floor + 'px thumb floor on a ' + vw + 'px viewport' });
    }
    if (tag === 'a' && (item.href === '#' || item.href === '' || item.href === 'javascript:void(0)')) out.issues.push({ kind: 'dead-link', ref: ref, detail: 'link "' + item.name + '" has href="' + item.href + '"' });
    if (item.noAutocomplete) out.issues.push({ kind: 'no-autocomplete', ref: ref, detail: 'field "' + (item.name || item.placeholder || item.hint || tag) + '" looks like personal data but has no autocomplete attribute (browser autofill will not work)' });
  }

  var heads = document.querySelectorAll('h1,h2,h3,[role=heading]');
  for (var j = 0; j < heads.length && out.outline.length < 40; j++) {
    if (!visible(heads[j])) continue;
    var t = txt(heads[j]);
    if (t) out.outline.push({ level: heads[j].tagName.toLowerCase(), text: t.slice(0, 110) });
  }

  var de = document.documentElement;
  if (de.scrollWidth > vw + 2) {
    var widest = null, ww = 0;
    var all = document.querySelectorAll('body *');
    for (var k = 0; k < all.length; k++) {
      var rr = all[k].getBoundingClientRect();
      if (rr.width > vw + 2 && rr.width > ww && visible(all[k])) { ww = rr.width; widest = all[k]; }
    }
    var who = '';
    if (widest) {
      var cls = typeof widest.className === 'string' && widest.className ? '.' + widest.className.split(/\s+/)[0] : '';
      who = '; widest node: ' + widest.tagName.toLowerCase() + cls + ' at ' + Math.round(ww) + 'px';
    }
    out.issues.push({ kind: 'horizontal-overflow', detail: 'scrollWidth ' + de.scrollWidth + 'px > viewport ' + vw + 'px' + who });
  }

  var imgs = Array.prototype.slice.call(document.images).filter(visible);
  var noAlt = imgs.filter(function (i2) { return !i2.hasAttribute('alt'); });
  if (noAlt.length) out.issues.push({ kind: 'img-missing-alt', detail: noAlt.length + '/' + imgs.length + ' visible images have no alt attribute' });
  var broken = imgs.filter(function (i2) { return i2.complete && i2.naturalWidth === 0; });
  if (broken.length) out.issues.push({ kind: 'broken-image', detail: broken.length + ' image(s) failed to load: ' + broken.slice(0, 3).map(function (i2) { return (i2.currentSrc || i2.src || '').slice(-70); }).join(', ') });
  if (!document.querySelector('h1')) out.issues.push({ kind: 'no-h1', detail: 'page has no <h1>' });
  if (!document.title || !document.title.trim()) out.issues.push({ kind: 'no-title', detail: '<title> is empty' });
  if (!de.lang) out.issues.push({ kind: 'no-lang', detail: '<html> has no lang attribute' });
  if (!document.querySelector('meta[name=viewport]')) out.issues.push({ kind: 'no-viewport-meta', detail: 'no <meta name=viewport> — mobile browsers zoom the whole page out' });

  var forms = Array.prototype.slice.call(document.forms);
  forms.forEach(function (f) {
    if (!visible(f)) return;
    var fields = Array.prototype.slice.call(f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea'));
    var unlabeled = fields.filter(function (el2) { return !name(el2); });
    if (unlabeled.length) out.issues.push({ kind: 'form-unlabeled-fields', detail: unlabeled.length + '/' + fields.length + ' fields in a visible form have no label' });
    if (fields.length && !f.querySelector('button,[type=submit],[role=button]')) out.issues.push({ kind: 'form-no-submit', detail: 'form with ' + fields.length + ' field(s) has no visible submit control' });
  });

  var smalls = [];
  var textish = document.querySelectorAll('p,span,div,li,td,label,a,button');
  for (var m = 0; m < textish.length && smalls.length < 5; m++) {
    var el3 = textish[m];
    if (!visible(el3) || !inViewport(el3)) continue;
    var own = Array.prototype.filter.call(el3.childNodes, function (nd) { return nd.nodeType === 3 && nd.textContent.trim().length > 7; });
    if (!own.length) continue;
    var fsz = parseFloat(getComputedStyle(el3).fontSize);
    if (fsz && fsz < 12) smalls.push(Math.round(fsz) + 'px: "' + txt(el3).slice(0, 40) + '"');
  }
  if (smalls.length) out.issues.push({ kind: 'tiny-text', detail: smalls.join(' | ') });

  out.stats.interactive = out.elements.length;
  out.stats.viewport = vw + 'x' + vh;
  out.stats.scrollHeight = de.scrollHeight;
  out.stats.iframes = document.querySelectorAll('iframe').length;
  out.stats.perf = window.__eyesPerf || null;
  return out;
}

/** WCAG contrast sampler: computes real ratios against the effective background. */
export function contrastFn() {
  function lum(c) {
    var f = c.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  }
  function parse(s) {
    var m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return null;
    var p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  }
  function bgOf(el) {
    var cur = el;
    while (cur && cur !== document.documentElement) {
      var c = parse(getComputedStyle(cur).backgroundColor);
      if (c && c.a > 0.6) return c.rgb;
      cur = cur.parentElement;
    }
    var b = parse(getComputedStyle(document.body).backgroundColor);
    return b && b.a > 0.6 ? b.rgb : [255, 255, 255];
  }
  var out = [], seen = new Set();
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length && out.length < 25; i++) {
    var el = all[i];
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) continue;
    var own = Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim().length > 3; });
    if (!own.length) continue;
    var s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity || '1') < 0.5) continue;
    var fg = parse(s.color);
    if (!fg) continue;
    var bg = bgOf(el);
    var L1 = lum(fg.rgb), L2 = lum(bg);
    var ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    var size = parseFloat(s.fontSize);
    var large = size >= 24 || (parseInt(s.fontWeight, 10) >= 700 && size >= 18.66);
    var need = large ? 3 : 4.5;
    if (ratio < need) {
      var label = own.map(function (n) { return n.textContent.trim(); }).join(' ').replace(/\s+/g, ' ').slice(0, 50);
      var key = label + ratio.toFixed(2);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: label, ratio: Math.round(ratio * 100) / 100, need: need, fontSize: Math.round(size), color: s.color, bg: 'rgb(' + bg.join(',') + ')' });
    }
  }
  return out;
}

/** Describes whatever currently has focus, and whether that focus is visible. */
export function focusFn() {
  var el = document.activeElement;
  if (!el || el === document.body) return { none: true };
  var s = getComputedStyle(el);
  var r = el.getBoundingClientRect();
  var hasRing =
    (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) ||
    (s.boxShadow && s.boxShadow !== 'none') ||
    s.getPropertyValue('--eyes-focus') === 'ok';
  return {
    tag: el.tagName.toLowerCase(),
    ref: el.getAttribute('data-eyes-ref') || null,
    name: (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    visibleRing: !!hasRing,
    offscreen: r.bottom < 0 || r.top > window.innerHeight,
    y: Math.round(r.top + window.scrollY),
    x: Math.round(r.left + window.scrollX),
  };
}

/** Snapshot of client-side state, for "does a refresh lose my work?" checks. */
export function storageFn() {
  function dump(store) {
    var o = {};
    try { for (var i = 0; i < store.length; i++) { var k = store.key(i); o[k] = String(store.getItem(k)).slice(0, 120); } } catch (e) { return { error: String(e.message) }; }
    return o;
  }
  return { localStorage: dump(localStorage), sessionStorage: dump(sessionStorage), cookieCount: document.cookie ? document.cookie.split(';').length : 0 };
}

/** Visible text of the page, cheap enough to diff between steps. */
export function textFn(max) {
  var t = (document.body ? document.body.innerText : '') || '';
  return t.replace(/\n{3,}/g, '\n\n').trim().slice(0, max || 6000);
}
