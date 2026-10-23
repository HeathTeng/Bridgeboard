import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

/** The custom properties set by the block that starts with this selector. */
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no block for ${selector}`);
  const body = css.slice(start + selector.length + 2, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const PALETTES = {
  白天: ':root',
  夜间: ':root[data-theme="dark"]',
  '夜间（跟随电脑）': '  :root:not([data-theme])',
  '护眼 + 白天': ':root[data-eye]',
  '护眼 + 夜间': ':root[data-eye][data-theme="dark"]',
  '护眼 + 夜间（跟随电脑）': '  :root[data-eye]:not([data-theme])',
};

test('every palette sets the same colour tokens', () => {
  const light = Object.keys(tokens(':root')).sort();
  assert.ok(light.length > 30);
  for (const [name, selector] of Object.entries(PALETTES)) assert.deepEqual(Object.keys(tokens(selector)).sort(), light, name);
  // The 跟随电脑 copies match the ones chosen by hand.
  assert.deepEqual(tokens('  :root:not([data-theme])'), tokens(':root[data-theme="dark"]'));
  assert.deepEqual(tokens('  :root[data-eye]:not([data-theme])'), tokens(':root[data-eye][data-theme="dark"]'));
});

// WCAG contrast, with see-through colours laid over what is under them.
const parse = (v) => {
  if (/^#[0-9a-f]{3}$/i.test(v)) return parse(`#${[...v.slice(1)].map((c) => c + c).join('')}`);
  if (v.startsWith('#')) return [...[1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)), 1];
  const m = v.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
};
const over = (top, under) => { const [r, g, b, a] = parse(top); return [r, g, b].map((v, i) => v * a + under[i] * (1 - a)); };
const lum = (c) => {
  const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('text stays at 4.5:1 or better in every palette, even where a card sits on a light spot', () => {
  for (const [name, selector] of Object.entries(PALETTES)) {
    const t = tokens(selector);
    const rgb = (k) => parse(t[k]).slice(0, 3);
    const checks = [];
    for (const spot of ['bg', 'blob-1', 'blob-2', 'blob-3']) {
      const card = over(t.glass, rgb(spot));
      const row = over(t.row, card);
      for (const k of ['text', 'muted', 'accent']) checks.push([`${k} on card/${spot}`, ratio(rgb(k), card)], [`${k} on row/${spot}`, ratio(rgb(k), row)]);
      for (const s of ['red', 'orange', 'blue', 'yellow', 'green']) checks.push([`${s} heading/${spot}`, ratio(rgb(s), card)]);
    }
    for (const s of ['red', 'orange', 'blue', 'yellow', 'green']) checks.push([`${s} capsule`, ratio(rgb(s), rgb(`${s}-bg`))]);
    checks.push(['title card', ratio(rgb('on-hero'), rgb('hero'))], ['title card muted', ratio(rgb('on-hero-muted'), rgb('hero'))]);
    checks.push(['filled button', ratio(rgb('on-accent'), rgb('accent'))], ['warning', ratio(rgb('warn-text'), rgb('warn-bg'))], ['error', ratio(rgb('error-text'), rgb('error-bg'))]);
    // 💡 hint boxes: lighter text on a pale box, on a card over any light spot and in the 显示设置 panel.
    for (const spot of ['bg', 'blob-1', 'blob-2', 'blob-3']) checks.push([`hint box/${spot}`, ratio(rgb('muted'), over(t['tip-bg'], over(t.glass, rgb(spot))))]);
    checks.push(['hint box in panel', ratio(rgb('muted'), over(t['tip-bg'], rgb('solid')))]);
    checks.push(['hint in title card', ratio(rgb('on-hero-muted'), over(t['hero-btn'], rgb('hero')))]);
    for (const [what, r] of checks) assert.ok(r >= 4.5, `${name}: ${what} is ${r.toFixed(2)}`);
  }
});

/** Runs public/theme.js with this localStorage and returns what it put on <html>. */
function themeScript(stored) {
  const dataset = {};
  const context = {
    document: { documentElement: { dataset } },
    localStorage: { getItem: (k) => (k in stored ? stored[k] : null) },
  };
  vm.runInNewContext(readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8'), context);
  return dataset;
}

test('no white flash: the saved 外观 and 护眼 are on <html> before the page draws', () => {
  assert.deepEqual(themeScript({}), {}, 'nothing saved: follow the computer');
  assert.deepEqual(themeScript({ 'bridgeboard-theme': 'system', 'bridgeboard-eye': 'off' }), {});
  assert.deepEqual(themeScript({ 'bridgeboard-theme': 'dark' }), { theme: 'dark' });
  assert.deepEqual(themeScript({ 'bridgeboard-theme': 'dark', 'bridgeboard-eye': 'on' }), { theme: 'dark', eye: '' });
  assert.deepEqual(themeScript({ 'bridgeboard-theme': 'system', 'bridgeboard-eye': 'on' }), { eye: '' });
  // Saved by an older version: 护眼 was a theme, now 白天 with 护眼 on.
  assert.deepEqual(themeScript({ 'bridgeboard-theme': 'eye' }), { theme: 'light', eye: '' });
  assert.deepEqual(themeScript({ 'bridgeboard-theme': 'neon' }), {});
});

test('must-see notes use the apricot warning box, not the quiet hint box', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const classOf = (words) => {
    const m = html.match(new RegExp(`<p class="([^"]+)">[^<]*${words}`));
    assert.ok(m, words);
    return m[1].split(' ');
  };
  for (const words of ['相当于你的登录凭证', '这个名字就像密码', '黑色窗口也开着时', '会经过 Bark / ntfy 的服务器']) {
    const cls = classOf(words);
    assert.ok(cls.includes('alert') && !cls.includes('tip'), `${words}: ${cls.join(' ')}`);
  }
  // Ordinary hints keep the 💡 box.
  assert.ok(classOf('改动会自动保存').includes('tip'));
  // Error lines (p.fail) get the same warning box.
  assert.match(css, /\.alert, p\.fail:not\(:empty\)/);
});

test('the keep-the-black-window-open reminder: once, always shown, above 今天要注意', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const text = '使用时请保持黑色窗口开着，关掉它面板和手机提醒都会停止。';
  const bar = html.match(/<p class="keep-open-bar"([^>]*)>([^<]*)<\/p>/);
  assert.ok(bar, 'the bar is there');
  assert.equal(bar[2], text);
  assert.ok(!/hidden/.test(bar[1]), 'never hidden: shown signed in and signed out');
  assert.ok(!/[!！]/.test(bar[2]), 'no exclamation marks');
  // Under the title card, above 今天要注意, outside <main> (which is hidden before sign-in).
  const at = html.indexOf('keep-open-bar');
  assert.ok(at > html.indexOf('</header>') && at < html.indexOf('id="today"') && at < html.indexOf('<main'));
  // Said once: the footer no longer repeats it.
  assert.equal(html.split('黑色窗口开着，关掉它').length - 1, 1);
  // Pale red with deep red text; the 4.5:1 check above covers --error-text on --error-bg in every palette.
  assert.match(css, /\.keep-open-bar \{[^}]*background: var\(--error-bg\); color: var\(--error-text\)/);
  assert.ok(!/\.keep-open-bar[^{]*\{[^}]*animation/.test(css), 'does not blink');
});
