// v0.3.2: one look for everything that folds, three equal top cards with the
// 💡 怎么用？ buttons in line, and grades drawn as bars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAITING, gradeAverage, gradeWords } from '../lib/grade-view.js';
import { demoOverview } from '../lib/demo.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const layout = read('../public/layout.js');
const app = read('../public/app.js');
const html = read('../public/index.html');
const css = read('../public/style.css');

test('收起 ▲: sections, each course and 往期课程 always; other folds when taller than 240 px', () => {
  assert.match(layout, /export const CLOSE_AT_PX = 240;/);
  assert.match(layout, /const ALWAYS = 'details\.course, details\.past-fold';/);
  assert.match(layout, /want: d\.matches\(ALWAYS\) \|\| height > CLOSE_AT_PX,/);
  // One listener for every <details>, also ones drawn later; watched while open, since content arrives later.
  assert.match(layout, /document\.addEventListener\('toggle', \(e\) => \{[\s\S]{0,200}syncDetails\(d\);\n\s+watched\?\.observe\(d\);/);
  assert.match(layout, /if \(!d\.open \|\| d\.closest\('#guide'\)\) return;/, 'not inside the help cards');
});

test('each 收起 says what it folds, so nested ones can be told apart; the words are all a screen reader hears', () => {
  assert.match(layout, /export function closeText\(what\) \{\n\s+return `收起\$\{what\} ▲`;/);
  const table = layout.slice(layout.indexOf('export const CLOSE_WORDS = ['), layout.indexOf('];', layout.indexOf('export const CLOSE_WORDS = [')));
  const words = Object.fromEntries([...table.matchAll(/\['([^']+)', '([^']*)'\]/g)].map((m) => [m[1], m[2]]));
  assert.equal(words['[data-more]'], '设置', '手机提醒: 收起设置 ▲ above 收起手机提醒 ▲');
  assert.equal(words['details.course'], '这门课');
  assert.equal(words['details.past-fold'], '往期课程');
  assert.equal(words['details.grade-detail'], '明细');
  // 往期课程 and 已忽略 come before the general rules they would also match.
  const order = Object.keys(words);
  assert.ok(order.indexOf('details.past-fold') < order.indexOf('details.course'));
  assert.ok(order.indexOf('details.dl-ignored') < order.indexOf('details.cl-done'));
  // A section uses its own name (收起清单 ▲), taken before its heading becomes a button.
  assert.match(layout, /const name = h2\.textContent\.trim\(\);/);
  assert.match(layout, /\}, closeText\(name\)\)\);/);
  assert.match(layout, /b \?\?= closeButton\(close, closeWordsFor\(box\)\);/);
  assert.match(layout, /const b = el\('button', \{ type: 'button', class: 'fold-close' \}, words\);/, 'no aria-label that could differ');
});

test('收起 ▲ of a section is the same fold as its heading, remembered, and goes back to the heading', () => {
  assert.match(layout, /const fold = \(open\) => \{\n\s+setOpen\(s\.id, open\);\n\s+remember\(\{ \.\.\.display, collapsed: \{ \.\.\.display\.collapsed, \[s\.id\]: !open \} \}\);/);
  assert.match(layout, /button\.addEventListener\('click', \(\) => fold\(button\.getAttribute\('aria-expanded'\) !== 'true'\)\);/);
  assert.match(layout, /body\.append\(closeButton\(\(\) => \{\n\s+fold\(false\);\n\s+backTo\(section, button\);/);
  // Back to the heading, with the keyboard there; no smooth scrolling under reduced motion.
  assert.match(layout, /prefers-reduced-motion: reduce/);
  assert.match(layout, /target\.scrollIntoView\(\{ block: 'start', behavior: smooth \? 'smooth' : 'auto' \}\);\n\s+focus\.focus\(\{ preventScroll: true \}\);/);
  assert.match(css, /details > summary, \.howto-btn, \.show-all \{ scroll-margin-top: 76px; \}/, 'not hidden under the sticky nav');
});

test('显示全部设置 (手机提醒 steps 2 and 3) can be folded again', () => {
  const more = layout.slice(layout.indexOf("for (const box of document.querySelectorAll('[data-more]'))"));
  assert.doesNotMatch(more.slice(0, 500), /b\.remove\(\)/, 'the button is kept, not removed');
  assert.match(more, /box\.hidden = false;\n\s+b\.hidden = true;/);
  assert.match(layout, /box\.hidden = true;\n\s+button\.hidden = false;\n\s+button\.setAttribute\('aria-expanded', 'false'\);\n\s+backTo\(button\);/);
});

test('three top cards: two-line folded summaries, so they are one height; full text on hover', () => {
  assert.match(css, /\.section\.top \.sec-toggle\[aria-expanded="false"\] \.sec-sum \{ display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2;\n\s+overflow: hidden; min-height: 3em; \}/);
  assert.match(css, /main \{ display: grid;[^}]*align-items: start;/, 'open cards line up at the top');
  assert.match(layout, /line\.textContent = text;\n\s+line\.title = text;/);
});

test('💡 怎么用？ is the first thing in all three top cards, so the buttons line up; the colours stay in view', () => {
  for (const id of ['deadlines', 'files', 'alerts']) {
    const start = html.indexOf(`<section id="${id}"`);
    const section = html.slice(start, html.indexOf('</section>', start));
    const afterHeading = section.slice(section.indexOf('</h2>') + 5).replace(/<!--[\s\S]*?-->/g, '').trim();
    assert.match(afterHeading, /^<(p|div) class="howto/, `${id}: 怎么用？ first`);
  }
  const deadlines = html.slice(html.indexOf('<section id="deadlines"'));
  assert.ok(deadlines.indexOf('class="howto') < deadlines.indexOf('<p class="legend small"'), 'colours under 怎么用？');
  assert.doesNotMatch(deadlines.slice(0, deadlines.indexOf('<p class="legend small"')), /<p class="legend small"[^>]*hidden/);
});

test('grade words: score and percentage, words-only grades, 待评分', () => {
  assert.equal(WAITING, '等待评分');
  assert.equal(gradeWords({ text: '42/50', pct: 84 }), '42/50 · 84%');
  assert.equal(gradeWords({ text: '84%', pct: 84 }), '84%', 'no repeat');
  assert.equal(gradeWords({ text: 'Pass' }), 'Pass');
  assert.equal(gradeWords({ text: '等待评分' }), '待评分');
  assert.equal(gradeAverage([{ pct: 80 }, { pct: 61 }, { text: 'Pass' }, { text: '等待评分' }]), 71);
  assert.equal(gradeAverage([{ text: 'Pass' }]), null);
  // The demo shows every kind.
  const items = demoOverview().grades.flatMap((c) => c.items);
  assert.ok(items.some((g) => g.pct != null) && items.some((g) => g.text === WAITING) && items.some((g) => g.pct == null && g.text !== WAITING));
});

test('grades page: bars for the eye, words for everyone, the table under 查看明细, earlier terms folded', () => {
  assert.match(app, /function gradeBar\(pct, cls = ''\) \{\n\s+return el\('span', \{ class: `gbar[^\n]*, 'aria-hidden': 'true' \},/, 'bars are hidden from screen readers');
  assert.match(app, /el\('span', \{ class: 'gbar is-none', 'aria-hidden': 'true' \}\)/);
  assert.match(app, /el\('span', \{ class: 'gscore' \}, gradeWords\(g\)\)\);/, 'the score in words beside each bar');
  assert.match(app, /\[gradeBar\(avg, 'gbar-avg'\), el\('span', \{ class: 'gscore' \}, `平均 \$\{avg\}%`\)\]/);
  assert.match(app, /el\('summary', \{\}, '查看明细'\),/);
  assert.match(app, /if \(earlier\.length\) box\.append\(pastFold\('grades', earlier\.length, earlier\.map\(gradeCourse\)\)\);/);
  assert.doesNotMatch(app, /<svg|innerHTML/, 'CSS only, built from DOM nodes');
  // Phone width: name on its own line, nothing scrolls sideways.
  const phone = css.slice(css.lastIndexOf('@media (max-width: 600px) {'));
  assert.match(phone, /\.gitem \{ grid-template-columns: minmax\(0, 1fr\) auto; \}\n\s+\.gitem \.gname \{ grid-column: 1 \/ -1; \}/);
  assert.match(read('../server.js'), /'grade-view\.js'\]\);/, 'served to the page');
});

test('README: three centred lines under the logo, the feature line in Chinese only', () => {
  const readme = read('../README.md');
  const top = readme.slice(readme.indexOf('# Bridgeboard'), readme.indexOf('[![最新版本]'));
  assert.equal(top.trim(), [
    '# Bridgeboard',
    '',
    '<h3 align="center">你的专属 Blackboard 看板</h3>',
    '<p align="center"><sub>Your personal Blackboard dashboard</sub></p>',
    '<p align="center">截止提醒 · 文件下载 · 手机提醒 · 清单 · 消息 · 公告 · 成绩</p>',
  ].join('\n'));
});
