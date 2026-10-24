// The first-run guide and the FAQ page: the Markdown subset, FAQ groups and
// search, the guideSeen setting, and the guide pages themselves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIRST_OPEN, countQuestions, filterFaq, inline, parseFaq, plainText, safeHref } from '../lib/faq.js';
import { guideStore } from '../lib/guide-state.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { GUIDE_PAGES } from '../public/guide.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const FAQ = read('../docs/FAQ.md');

// ---- Markdown ----

test('markdown: ## groups, ### questions, paragraphs and both kinds of list', () => {
  const { groups } = parseFaq('# 标题\n\n> 引言\n\n## 大类\n介绍\n\n### 问题一？\n第一段\n第二段\n\n- 甲\n- 乙\n\n1. 一\n2. 二\n\n### 问题二？\n答案');
  assert.equal(groups.length, 1);
  const [g] = groups;
  assert.equal(g.title, '大类');
  assert.deepEqual(g.intro, [{ type: 'p', segments: [{ type: 'text', text: '介绍' }] }]);
  assert.deepEqual(g.questions.map((q) => q.title), ['问题一？', '问题二？']);
  assert.deepEqual(g.questions[0].blocks.map((b) => b.type), ['p', 'p', 'ul', 'ol']);
  assert.deepEqual(g.questions[0].blocks[2].items, [[{ type: 'text', text: '甲' }], [{ type: 'text', text: '乙' }]]);
  assert.deepEqual(g.questions[0].blocks[3].items.length, 2);
});

test('markdown: **bold**, `code` and https links', () => {
  assert.deepEqual(inline('点 **运行**，再双击 `start.bat`，或看 [GitHub](https://github.com/HeathTeng/Bridgeboard)。'), [
    { type: 'text', text: '点 ' },
    { type: 'bold', text: '运行' },
    { type: 'text', text: '，再双击 ' },
    { type: 'code', text: 'start.bat' },
    { type: 'text', text: '，或看 ' },
    { type: 'link', text: 'GitHub', href: 'https://github.com/HeathTeng/Bridgeboard' },
    { type: 'text', text: '。' },
  ]);
});

test('markdown: javascript: and other non-https links, and HTML tags, stay plain text', () => {
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'http://example.com', 'data:text/html,x', 'file:///C:/x', '/api/faq']) {
    assert.equal(safeHref(bad), null, bad);
    assert.deepEqual(inline(`[点我](${bad})`), [{ type: 'text', text: '点我' }], bad);
  }
  const html = '<b>粗</b> <img src=x onerror=alert(1)> <a href="javascript:x">链接</a>';
  assert.deepEqual(inline(html), [{ type: 'text', text: html }]);
  const { groups } = parseFaq(`## 组\n### <script>alert(1)</script>\n${html}`);
  assert.equal(groups[0].questions[0].title, '<script>alert(1)</script>');
  assert.equal(plainText(groups[0].questions[0].blocks), html);
});

test('the page draws the FAQ with DOM methods only, and links open in a new tab', () => {
  const help = read('../public/help.js');
  assert.doesNotMatch(help, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(help, /el\('a', \{ href: s\.href, target: '_blank', rel: 'noopener noreferrer' \}, s\.text\)/);
  assert.match(help, /document\.createTextNode\(s\.text\)/);
});

// ---- FAQ groups and search ----

test('FAQ: grouped by ##, only 「最重要的一条」 open, and it is the first group', () => {
  const { groups } = parseFaq(FAQ);
  assert.ok(groups.length >= 6);
  assert.equal(groups[0].title, FIRST_OPEN);
  assert.deepEqual(groups.filter((g) => g.open).map((g) => g.title), [FIRST_OPEN]);
  assert.equal(groups[0].questions[0].title, '只有电脑开着、黑色窗口开着才会发提醒');
  for (const g of groups) assert.ok(g.questions.length > 0, `${g.title} has questions`);
  const install = groups.find((g) => g.title === '安装和打开');
  assert.ok(install.questions.some((q) => q.title === '怎么重新看新手引导？'));
});

test('FAQ search: a keyword keeps only matching questions, any case, every word must match', () => {
  const groups = [
    { title: '登录', open: false, intro: [], questions: [
      { title: '要重新登录', blocks: [{ type: 'p', segments: [{ type: 'text', text: '点 Connect 按钮' }] }] },
      { title: '弹出窗口', blocks: [{ type: 'ul', items: [[{ type: 'text', text: '装 Edge' }]] }] },
    ] },
    { title: '手机提醒', open: false, intro: [], questions: [{ title: 'Bark 在哪', blocks: [] }, { title: 'ntfy', blocks: [] }] },
  ];
  assert.deepEqual(filterFaq(groups, '  '), groups, 'empty search shows everything');
  assert.deepEqual(filterFaq(groups, 'connect').map((g) => g.questions.map((q) => q.title)), [['要重新登录']]);
  assert.deepEqual(filterFaq(groups, 'EDGE')[0].questions.map((q) => q.title), ['弹出窗口'], 'list items and any case');
  assert.equal(countQuestions(filterFaq(groups, '提醒')), 2, 'the group title counts');
  assert.equal(countQuestions(filterFaq(groups, '提醒 bark')), 1, 'every word must match');
  assert.deepEqual(filterFaq(groups, '找不到的词'), []);
});

test('FAQ search on the real file finds what beginners type', () => {
  const { groups } = parseFaq(FAQ);
  for (const word of ['提醒', '登录', '下载', '黑色窗口', '引导']) assert.ok(countQuestions(filterFaq(groups, word)) > 0, word);
});

// ---- guideSeen ----

test('guideSeen: saved in settings.json and read back, keeping the other settings', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-guide-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'sub', 'settings.json');
  saveSettings({ downloadDir: 'E:\\课程资料' }, file);
  const store = guideStore({ load: () => loadSettings(file), save: (p) => saveSettings(p, file) });
  assert.equal(store.seen(), false);
  store.markSeen();
  assert.equal(store.seen(), true);
  assert.deepEqual(loadSettings(file), { downloadDir: 'E:\\课程资料', guideSeen: true });
  // A new start reads it from the file.
  assert.equal(guideStore({ load: () => loadSettings(file), save: (p) => saveSettings(p, file) }).seen(), true);
});

test('guideSeen in demo mode: remembered while running, never written to a file', () => {
  let writes = 0;
  const store = guideStore({ demo: true, load: () => ({ guideSeen: true }), save: () => { writes += 1; } });
  assert.equal(store.seen(), false, 'every demo start shows the guide, whatever settings.json says');
  store.markSeen();
  assert.equal(store.seen(), true);
  assert.equal(writes, 0);
  assert.equal(guideStore({ demo: true, save: () => { writes += 1; } }).seen(), false, 'the next demo start shows it again');
});

test('guideSeen: when settings.json cannot be written, this run still remembers', () => {
  const store = guideStore({ load: () => ({}), save: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
  store.markSeen();
  assert.equal(store.seen(), true);
});

// ---- The guide pages ----

test('guide: nine pages, each with a title and one to three short lines', () => {
  assert.equal(GUIDE_PAGES.length, 9);
  assert.equal(new Set(GUIDE_PAGES.map((p) => p.id)).size, 9, 'ids are unique');
  for (const p of GUIDE_PAGES) {
    assert.ok(p.title?.trim(), `${p.id} has a title`);
    assert.ok(Array.isArray(p.lines) && p.lines.length >= 1 && p.lines.length <= 3, `${p.id}: 1 to 3 lines`);
    for (const line of p.lines) assert.ok(line.trim(), `${p.id}: no empty line`);
    assert.doesNotMatch(p.title + p.lines.join(''), /[!！]/, `${p.id}: calm wording`);
  }
});

test('guide: page 2 is the black-window rule, in the same words as the first FAQ entry', () => {
  const p = GUIDE_PAGES[1];
  assert.equal(p.id, 'keep-open');
  const first = parseFaq(FAQ).groups[0].questions[0].title;
  assert.ok(p.lines[0].startsWith(first), 'same sentence as FAQ 第一条');
  assert.match(p.lines.join(''), /黑色窗口/);
  assert.match(p.lines.join(''), /睡眠/);
});

test('guide: the order agreed with the owner, page 7 for iPhone, the FAQ last', () => {
  assert.deepEqual(GUIDE_PAGES.map((p) => p.id), ['welcome', 'keep-open', 'connect', 'deadlines', 'files', 'alerts', 'iphone', 'more', 'faq']);
  assert.equal(GUIDE_PAGES[6].lines[0], '用安卓的直接点下一步。');
  assert.match(GUIDE_PAGES[6].lines.join(''), /重要警告/);
  assert.match(GUIDE_PAGES[6].lines.join(''), /始终播放/);
  assert.match(GUIDE_PAGES[6].lines.join(''), /试听强提醒/);
  assert.match(GUIDE_PAGES[5].lines.join(''), /作业名、课程名、截止时间和链接/);
  const last = GUIDE_PAGES[GUIDE_PAGES.length - 1];
  assert.equal(last.faq, true);
  assert.equal(last.title, '常见问题');
  assert.equal(GUIDE_PAGES.filter((p) => p.faq).length, 1);
});

test('guide: screenshots exist and are served one by one, never the whole docs folder', () => {
  const server = read('../server.js');
  const routes = new Map([...server.matchAll(/\['(\/guide-img\/[\w.-]+)', '([\w.-]+)'\]/g)].map((m) => [m[1], m[2]]));
  assert.equal(routes.size, 2);
  for (const p of GUIDE_PAGES.filter((x) => x.image)) {
    assert.ok(routes.has(p.image.src), `${p.image.src} is a route`);
    assert.ok(existsSync(new URL(`../docs/${routes.get(p.image.src)}`, import.meta.url)), `${p.image.src} exists`);
    assert.match(p.image.alt, /示例截图/);
  }
  assert.match(server, /readFile\(join\(DOCS, 'FAQ\.md'\), 'utf8'\)/);
  assert.doesNotMatch(server, /join\(DOCS, (url|file|req)/, 'no path from the request reaches docs/');
});

test('page: the dialog, the 💡 帮助 button and the 常见问题 links are in place', () => {
  const html = read('../public/index.html');
  assert.match(html, /<div id="guideBox" class="guide" role="dialog" aria-modal="true" aria-labelledby="guideTitle">/);
  assert.match(html, /<div id="guide" class="guide-scrim" hidden>/);
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(header, /<button id="helpBtn" type="button" aria-haspopup="dialog">💡 帮助<\/button>/);
  assert.match(header, /<button id="faqBtn" type="button" aria-haspopup="dialog">常见问题<\/button>/);
  const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
  assert.match(footer, /id="faqFooter"/);
  assert.match(footer, /id="guideFooter"/);
  const css = read('../public/style.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.guide \{ animation: none; \} \}/);
  // Esc closes, arrows turn pages but not while typing in the search box.
  const help = read('../public/help.js');
  assert.match(help, /e\.key === 'Escape'/);
  assert.match(help, /!e\.target\.closest\('input, textarea, select'\)/);
});
