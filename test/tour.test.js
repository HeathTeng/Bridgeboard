// The first start (welcome box, spotlight tour) and the frosted card guide:
// step targets exist, missing targets are left out, the flow between the
// parts, the shared words, and the frosted glass staying readable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GUIDE_PAGES, TOUR_STEPS } from '../public/guide.js';
import { afterWelcome, available, findStep, firstRunAction, flagsAfterFirstRun, helpAction, planTour, stepText } from '../lib/tour.js';
import { SECTIONS } from '../lib/display.js';
import { guideStore } from '../lib/guide-state.js';
import { loadSettings, saveSettings } from '../lib/settings.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../public/index.html');
const css = read('../public/style.css');
const ids = (list) => list.map((s) => s.id);

/** A page where everything is shown, except the selectors in `hidden`. */
const page = ({ signedIn = true, hidden = [] } = {}) => ({ signedIn, isShown: (sel) => !hidden.includes(sel) });

// ---- Steps and their targets ----

test('every spotlight target and section is on the page (index.html / SECTIONS)', () => {
  for (const s of TOUR_STEPS.filter((x) => x.target)) {
    const m = /^#([\w-]+)$/.exec(s.target);
    assert.ok(m, `${s.id}: a plain #id selector`);
    assert.match(html, new RegExp(`id="${m[1]}"`), `${s.id}: ${s.target} is in index.html`);
    if (s.section) assert.ok(SECTIONS.some((x) => x.id === s.section), `${s.id}: section ${s.section} exists`);
  }
  assert.deepEqual(ids(TOUR_STEPS), ['keep-open', 'connect', 'deadlines', 'files', 'alerts', 'add', 'display', 'help']);
});

test('the tour borrows the guide pages\' words: no step has text of its own, only line numbers', () => {
  for (const s of TOUR_STEPS) {
    const pageOf = GUIDE_PAGES.find((p) => p.id === s.page);
    assert.ok(pageOf, `${s.id}: page ${s.page} exists`);
    assert.equal(s.text, undefined, `${s.id}: no text of its own`);
    if (s.lines) assert.ok(s.lines.every((i) => Number.isInteger(i) && pageOf.lines[i]), `${s.id}: lines point at real lines`);
    const t = stepText(s, GUIDE_PAGES);
    assert.ok(t.title && t.lines.length >= 1 && t.lines.length <= 3, `${s.id}: a title and 1 to 3 lines`);
    for (const line of t.lines) assert.ok(pageOf.lines.includes(line), `${s.id}: the same words as the card`);
  }
  assert.deepEqual(stepText(TOUR_STEPS.find((s) => s.id === 'add'), GUIDE_PAGES).lines, [GUIDE_PAGES.find((p) => p.id === 'more').lines[0]]);
  assert.equal(stepText(TOUR_STEPS.find((s) => s.id === 'deadlines'), GUIDE_PAGES).swatches, true);
});

test('the black-window card comes first, in the middle, and is the one step that cannot be skipped', () => {
  const [first] = TOUR_STEPS;
  assert.equal(first.id, 'keep-open');
  assert.equal(first.target, undefined, 'a card in the middle');
  assert.equal(first.mustSee, true);
  assert.deepEqual(ids(TOUR_STEPS.filter((s) => s.mustSee)), ['keep-open']);
});

// ---- Missing targets ----

test('signed in: every feature is framed, the connect card is not', () => {
  assert.deepEqual(ids(planTour(TOUR_STEPS, page())), ['keep-open', 'deadlines', 'files', 'alerts', 'add', 'display', 'help']);
});

test('signed out: only the black-window card, 连接 Blackboard and the checklist', () => {
  assert.deepEqual(ids(planTour(TOUR_STEPS, page({ signedIn: false }))), ['keep-open', 'connect', 'add']);
});

test('a target that is not on the page (hidden section, other layout) is left out, never framed empty', () => {
  const ctx = page({ hidden: ['#files', '#checklist', '#displayBtn'] });
  const plan = planTour(TOUR_STEPS, ctx);
  assert.deepEqual(ids(plan), ['keep-open', 'deadlines', 'alerts', 'help']);
  for (const s of plan) assert.ok(!s.target || ctx.isShown(s.section ? `#${s.section}` : s.target), `${s.id} is on the page`);
  // A step inside a section is judged by the section, which is opened for it.
  assert.equal(available({ target: '#addRow', section: 'checklist' }, page({ hidden: ['#addRow'] })), true);
  assert.equal(available({ target: '#addRow', section: 'checklist' }, page({ hidden: ['#checklist'] })), false);
  // A card in the middle always shows.
  assert.equal(available({ page: 'keep-open' }, page({ hidden: ['#everything'] })), true);
});

test('上一步 / 下一步 jump over steps that are not on the page right now', () => {
  const ctx = page({ hidden: ['#files'] });
  const i = (id) => TOUR_STEPS.findIndex((s) => s.id === id);
  assert.equal(findStep(TOUR_STEPS, i('deadlines'), 1, ctx), i('alerts'));
  assert.equal(findStep(TOUR_STEPS, i('alerts'), -1, ctx), i('deadlines'));
  assert.equal(findStep(TOUR_STEPS, i('keep-open'), -1, ctx), -1);
  assert.equal(findStep(TOUR_STEPS, i('help'), 1, ctx), -1);
  assert.equal(findStep(TOUR_STEPS, -1, 1, ctx), 0);
  // Signed out, 下一步 after the black-window card goes to 连接 Blackboard.
  assert.equal(findStep(TOUR_STEPS, 0, 1, page({ signedIn: false })), i('connect'));
});

// ---- The flow ----

test('first start: the welcome box first; nothing once it has been seen', () => {
  assert.equal(firstRunAction({ guideSeen: false, tourSeen: false, signedIn: false, dataLoaded: false }), 'welcome');
  assert.equal(firstRunAction({ guideSeen: false, tourSeen: false, signedIn: true, dataLoaded: true }), 'welcome');
  assert.equal(firstRunAction({ guideSeen: true, tourSeen: true, signedIn: true, dataLoaded: true }), null);
  assert.equal(firstRunAction({}), null, 'settings not loaded: ask nothing');
});

test('开始 runs the spotlight tour; 跳过引导 still shows the black-window card on its own', () => {
  assert.deepEqual(afterWelcome('start', TOUR_STEPS), { steps: TOUR_STEPS, mode: 'tour' });
  const skipped = afterWelcome('skip', TOUR_STEPS);
  assert.equal(skipped.mode, 'card');
  assert.deepEqual(ids(skipped.steps), ['keep-open']);
});

test('started signed out: asked once after the first sign-in, when the courses are on the page', () => {
  const flags = flagsAfterFirstRun({ signedIn: false });
  assert.deepEqual(flags, { guideSeen: true });
  const seen = { ...flags, tourSeen: false };
  assert.equal(firstRunAction({ ...seen, signedIn: false, dataLoaded: false }), null);
  assert.equal(firstRunAction({ ...seen, signedIn: true, dataLoaded: false }), null, 'not before the courses arrive');
  assert.equal(firstRunAction({ ...seen, signedIn: true, dataLoaded: true }), 'ask-tour');
  assert.equal(firstRunAction({ ...seen, tourSeen: true, signedIn: true, dataLoaded: true }), null, 'only once');
  assert.deepEqual(flagsAfterFirstRun({ signedIn: true }), { guideSeen: true, tourSeen: true }, 'signed in: the features were shown');
});

test('卡片教程 opens the card guide at page 1; 常见问题 at its last page', () => {
  assert.deepEqual(helpAction('help', GUIDE_PAGES), { mode: 'cards', page: 0 });
  assert.deepEqual(helpAction('faq', GUIDE_PAGES), { mode: 'cards', page: GUIDE_PAGES.length - 1 });
  assert.equal(GUIDE_PAGES[GUIDE_PAGES.length - 1].faq, true);
  const help = read('../public/help.js');
  assert.match(help, /for \(const id of \['faqBtn', 'faqFooter'\]\) \$\(id\)\.addEventListener\('click', \(\) => openGuide\(helpAction\('faq', GUIDE_PAGES\)\.page\)\)/);
  assert.match(help, /else openGuide\(helpAction\(choice === 'faq' \? 'faq' : 'help', GUIDE_PAGES\)\.page\);/);
});

test('tourSeen: saved and read back like guideSeen; demo mode writes nothing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-tour-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');
  const store = guideStore({ key: 'tourSeen', load: () => loadSettings(file), save: (p) => saveSettings(p, file) });
  assert.equal(store.seen(), false);
  store.markSeen();
  assert.deepEqual(loadSettings(file), { tourSeen: true });
  let writes = 0;
  const demo = guideStore({ key: 'tourSeen', demo: true, save: () => { writes += 1; } });
  demo.markSeen();
  assert.equal(demo.seen(), true);
  assert.equal(writes, 0);
  assert.match(read('../server.js'), /const tour = guideStore\(\{ key: 'tourSeen', demo: DEMO \}\);/);
});

// ---- The page ----

test('page: the welcome box thanks the student by name, with 开始 and 跳过引导', () => {
  assert.match(html, /<div id="welcomeBox" class="welcome" role="dialog" aria-modal="true" aria-labelledby="welcomeTitle">/);
  assert.match(html, /<h2 id="welcomeTitle" tabindex="-1">感谢您选择 <span class="brand-word">Bridgeboard<\/span><\/h2>/);
  assert.match(html, /<p class="welcome-sub">下面开始新手引导<\/p>/);
  assert.match(html, /<button id="welcomeStart" type="button" class="primary">开始<\/button>/);
  assert.match(html, /<button id="welcomeSkip" type="button" class="link">跳过引导<\/button>/);
  // A quiet line under 跳过引导: the walk-through comes only once, the cards stay under 💡 帮助.
  assert.match(html, /<\/div>\s*<p class="welcome-note">在页面上一步步带你认识的引导只出现这一次，只有几步，建议看完。以后也可以点「💡 帮助」看文字版。<\/p>/);
  assert.match(css, /\.welcome-note \{[^}]*font-size: 12\.5px;/);
  assert.match(css, /\.guide \.muted, \.tour-bubble \.muted, \.welcome-sub, \.welcome-note \{ color: var\(--guide-muted\); \}/, 'light and small, in the glass\'s own quiet colour');
  assert.doesNotMatch(html.slice(html.indexOf('id="welcomeBox"'), html.indexOf('id="tour"')), /[!！]/, 'calm wording');
  const box = html.slice(html.indexOf('id="welcomeBox"'), html.indexOf('id="welcomeTitle"'));
  assert.match(box, /<svg class="mark welcome-mark"/, 'the Bridgeboard logo');
});

test('page: during the tour a layer covers the page, so only the bubble can be used', () => {
  assert.match(html, /<div id="tour" class="tour" hidden>\s*<div id="tourBlock" class="tour-block"><\/div>/);
  assert.match(html, /<div id="tourBubble" class="tour-bubble" role="dialog" aria-modal="true" aria-labelledby="tourTitle">/);
  assert.match(css, /\.tour-block \{ position: fixed; inset: 0; \}/);
  assert.match(css, /\.tour-ring \{[^}]*pointer-events: none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.tour-ring \{ transition: none; \} \}/);
  const spot = read('../public/spotlight.js');
  assert.doesNotMatch(spot, /innerHTML/);
});

test('page: 下一步 answers at once: ring, bubble and page move together, in under 0.3 seconds', () => {
  const spot = read('../public/spotlight.js');
  const ms = Number(/export const GLIDE_MS = (\d+);/.exec(spot)?.[1]);
  assert.ok(ms > 0 && ms <= 300, `the page scroll takes ${ms} ms`);
  // The ring and bubble are placed before the scroll, not after it ends.
  const show = spot.slice(spot.indexOf('function show('), spot.indexOf('function drawBubble('));
  assert.ok(show.indexOf('place(target, { scrollTo: to })') < show.indexOf('glideTo(to)'), 'placed first, then the page glides');
  assert.doesNotMatch(show, /await /, 'nothing waits for the scroll before showing the step');
  assert.doesNotMatch(spot, /behavior: 'smooth'/, 'not the browser\'s smooth scroll, whose length depends on the distance');
  // Under reduced motion: no glide, straight there.
  assert.match(spot, /if \(reduceMotion\(\)\) \{\n\s+window\.scrollTo\(\{ top: to, behavior: 'instant' \}\);/);
  for (const sel of ['tour-ring', 'tour-bubble']) {
    const rule = new RegExp(`\\.${sel} \\{[^}]*transition: left \\.(\\d+)s`).exec(css);
    assert.ok(rule && Number(`0.${rule[1]}`) <= 0.3, `.${sel} moves in 0.3 s or less`);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.tour-bubble \{ transition: none; \} \}/);
});

test('page: every card page is the same size, long pages scroll inside', () => {
  assert.match(css, /\.guide \{ display: flex; flex-direction: column; width: min\(600px, 100%\); height: min\(470px, calc\(100vh - 48px\)\);/);
  assert.match(css, /\.guide-body \{ flex: 1; overflow-y: auto;/);
  const phone = css.slice(css.indexOf('@media (max-width: 600px) {\n  body'));
  assert.match(phone, /\.guide \{ height: calc\(100vh - 16px\); height: calc\(100dvh - 16px\); \}/);
});

// ---- Frosted glass: readable in every palette ----

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
const parse = (v) => {
  if (/^#[0-9a-f]{3}$/i.test(v)) return parse(`#${[...v.slice(1)].map((c) => c + c).join('')}`);
  if (v.startsWith('#')) return [...[1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)), 1];
  const m = v.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
};
const over = (top, under) => { const [r, g, b, a] = parse(top); return [r, g, b].map((v, i) => v * a + under[i] * (1 - a)); };
const solid = (v) => parse(v).slice(0, 3);
const lum = (c) => {
  const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('frosted glass: every palette has it, green and see-through, and text stays at 4.5:1 whatever is behind the card', () => {
  for (const [name, selector] of Object.entries(PALETTES)) {
    const t = tokens(selector);
    for (const k of ['guide-glass', 'guide-solid', 'tour-dim', 'guide-muted']) assert.ok(t[k], `${name}: --${k}`);
    const [r, g, b, a] = parse(t['guide-glass']);
    assert.ok(a >= 0.7 && a <= 0.85, `${name}: the colours behind glow through (opacity ${a})`);
    assert.ok(g - r >= 20 && g - b >= 15, `${name}: clearly green, unlike the white cards (${r}, ${g}, ${b})`);
    const [sr, sg, sb] = solid(t['guide-solid']);
    assert.ok(sg - sr >= 15 && sg - sb >= 10, `${name}: the solid fallback is green too`);
    // Behind the card: the page, the dark title card, a solid panel, a glass card on the page.
    const behind = [solid(t.bg), solid(t.hero), solid(t.solid), over(t.glass, solid(t.bg))];
    for (const under of behind) {
      const card = over(t['guide-glass'], under);
      for (const text of ['text', 'guide-muted']) {
        const c = ratio(solid(t[text]), card);
        assert.ok(c >= 4.5, `${name}: --${text} on the glass is ${c.toFixed(2)}:1`);
      }
    }
    for (const text of ['text', 'guide-muted']) {
      const r = ratio(solid(t[text]), solid(t['guide-solid']));
      assert.ok(r >= 4.5, `${name}: --${text} on the solid fallback is ${r.toFixed(2)}:1`);
    }
  }
});

test('welcome box: the same frosted glass as the guide, dark words, the name in bold deep green without underline', () => {
  assert.match(css, /\.guide, \.tour-bubble, \.welcome \{ background: var\(--guide-glass\);/);
  const welcome = /\.welcome \{[^}]*\}/.exec(css)[0];
  assert.doesNotMatch(welcome, /--hero/, 'not the title card\'s dark green');
  const brand = /\.brand-word \{[^}]*\}/.exec(css)[0];
  assert.match(brand, /color: var\(--brand-word\)/);
  assert.match(brand, /font-weight: 800/);
  assert.doesNotMatch(brand, /border-bottom|text-decoration|underline/, 'no underline: it would look like a link');
  for (const [name, selector] of Object.entries(PALETTES)) {
    const t = tokens(selector);
    assert.ok(t['brand-word'], `${name}: --brand-word`);
    const behind = [solid(t.bg), solid(t.hero), solid(t.solid), over(t.glass, solid(t.bg))];
    for (const under of behind) {
      const card = over(t['guide-glass'], under);
      const r = ratio(solid(t['brand-word']), card);
      assert.ok(r >= 4.5, `${name}: Bridgeboard on the glass is ${r.toFixed(2)}:1`);
    }
    const r = ratio(solid(t['brand-word']), solid(t['guide-solid']));
    assert.ok(r >= 4.5, `${name}: Bridgeboard on the solid fallback is ${r.toFixed(2)}:1`);
    const b = ratio(solid(t['on-accent']), solid(t.accent));
    assert.ok(b >= 4.5, `${name}: 开始 is ${b.toFixed(2)}:1`);
  }
});

test('frosted glass falls back to a solid colour without blur or with less transparency', () => {
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\) \{\n  \.guide, \.tour-bubble, \.welcome \{ background: var\(--guide-solid\); \}/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\) \{\n  \.guide, \.tour-bubble, \.welcome \{ background: var\(--guide-solid\); -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
  assert.match(css, /\.guide, \.tour-bubble, \.welcome \{ background: var\(--guide-glass\);[^}]*-webkit-backdrop-filter: blur\(40px\) saturate\(1\.5\); backdrop-filter: blur\(40px\) saturate\(1\.5\);/, 'blurred so much that nothing behind can be read');
});
