import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { KEEP_OPEN_KEY, KEEP_OPEN_VERSION, initKeepOpen } from '../public/keep-open.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/index.html');
const css = read('../public/style.css');

/** A browser's localStorage, kept between "page loads". */
function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), clear: () => data.clear() };
}

/** Opens the page: runs theme.js (in <head>), then wires up the button like app.js. Returns what the student sees. */
function openPage(storage) {
  const root = { dataset: {} };
  vm.runInNewContext(read('../public/theme.js'), { document: { documentElement: root }, localStorage: storage });
  let onClick;
  const wrap = { hidden: false };
  const button = { addEventListener: (type, fn) => { if (type === 'click') onClick = fn; } };
  initKeepOpen({ wrap, button, root, storage });
  // CSS hides the reminder when <html> has data-keep-open-off (before anything is drawn).
  const shown = () => !wrap.hidden && !('keepOpenOff' in root.dataset);
  return { shown, click: () => onClick() };
}

test('不再提示: the button is there, inside the reminder', () => {
  const wrap = html.match(/<div id="keepOpen" class="keep-open-wrap">([\s\S]*?)<\/div>/);
  assert.ok(wrap, 'the reminder has its wrapper');
  assert.match(wrap[1], /<p class="keep-open-bar"/);
  assert.match(wrap[1], /<button id="keepOpenOff" type="button"[^>]*>不再提示<\/button>/);
  // The text keeps clear of the button, so a wrapped line never runs under it or pushes it out.
  assert.match(css, /\.keep-open-wrap \.keep-open-bar \{ padding-right: \d+px; \}/);
  assert.match(css, /\.keep-open-off \{[^}]*position: absolute;[^}]*white-space: nowrap;/);
  assert.match(css, /:root\[data-keep-open-off\] \.keep-open-wrap \{ display: none; \}/);
});

test('不再提示: hides at once, stays hidden after a refresh, comes back when storage is cleared', () => {
  const storage = memoryStorage();
  const first = openPage(storage);
  assert.equal(first.shown(), true, 'shown the first time');
  first.click();
  assert.equal(first.shown(), false, 'gone as soon as it is clicked');
  assert.equal(storage.getItem(KEEP_OPEN_KEY), KEEP_OPEN_VERSION, 'remembered with its version');

  assert.equal(openPage(storage).shown(), false, 'still hidden after a refresh');

  storage.clear();
  assert.equal(openPage(storage).shown(), true, 'back after clearing this browser\'s storage');
});

test('不再提示: new wording (a new version) shows the reminder once more', () => {
  const storage = memoryStorage();
  storage.setItem(KEEP_OPEN_KEY, 'old');
  assert.equal(openPage(storage).shown(), true);
  // theme.js and keep-open.js must agree on the version, or a dismissed reminder would come back on every visit.
  assert.match(read('../public/theme.js'), new RegExp(`var KEEP_OPEN_VERSION = '${KEEP_OPEN_VERSION}';`));
});

test('不再提示: without storage it still hides, for this visit', () => {
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const page = openPage(blocked);
  assert.equal(page.shown(), true);
  page.click();
  assert.equal(page.shown(), false);
  // No storage at all (app.js passes null when reading localStorage throws).
  const root = { dataset: {} };
  let onClick;
  const wrap = { hidden: false };
  initKeepOpen({ wrap, button: { addEventListener: (_, fn) => { onClick = fn; } }, root, storage: null });
  onClick();
  assert.equal(wrap.hidden, true);
});
