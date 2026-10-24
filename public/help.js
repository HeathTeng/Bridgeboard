// Help for newcomers, in three parts that share the words in guide.js:
// - the first start: a welcome box (the title card's colours), then the
//   spotlight tour on the real page (spotlight.js);
// - 💡 帮助: the same pages as frosted cards, the FAQ last (常见问题 opens it);
// - once after the first sign-in: 要不要看看各个功能在哪？
// The FAQ comes from docs/FAQ.md through /api/faq and is drawn with DOM
// methods and text nodes only, so no text can turn into markup.
import { GUIDE_PAGES, TOUR_STEPS } from './guide.js';
import { countQuestions, filterFaq, parseFaq } from './faq.js';
import { afterWelcome, firstRunAction, flagsAfterFirstRun, helpAction } from './tour.js';
import { initSpotlight, startTour, swatchesEl, tourRunning } from './spotlight.js';
import { $, actionLine, api, el } from './ui.js';

const LAST = GUIDE_PAGES.length - 1;

let page = 0;
let opener = null; // where focus goes back to when the cards close
let flags = { guideSeen: true, tourSeen: true }; // until /api/settings says otherwise
let welcomeShown = false;
let asked = false;
let isSignedIn = () => false;
let afterFirstRun = () => {};

let faq = null; // { groups } once loaded
let faqQuery = '';

function saveFlags(patch) {
  flags = { ...flags, ...patch };
  api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {});
}

const busy = () => !$('guide').hidden || !$('welcome').hidden || tourRunning();

// ---- The first start ----

/** Called with /api/settings: the welcome box on the very first start, once per page load at most. */
export function maybeShowGuide(settings) {
  if (typeof settings?.guideSeen !== 'boolean') return; // settings did not load: ask nothing
  flags = { guideSeen: settings.guideSeen, tourSeen: settings.tourSeen === true };
  if (welcomeShown || firstRunAction(flags) !== 'welcome') return;
  welcomeShown = true;
  $('welcome').hidden = false;
  document.body.classList.add('guide-open');
  $('welcomeTitle').focus();
}

function leaveWelcome(choice) {
  $('welcome').hidden = true;
  document.body.classList.remove('guide-open');
  const { steps, mode } = afterWelcome(choice, TOUR_STEPS);
  startTour(steps, { mode, signedIn: isSignedIn, onEnd: finishFirstRun });
}

/** Finished or skipped: never shown again on its own; focus to 连接 Blackboard when signed out. */
function finishFirstRun() {
  saveFlags(flagsAfterFirstRun({ signedIn: isSignedIn() }));
  afterFirstRun();
}

/** After the first sign-in, once the courses are on the page: offer the tour once. */
export function maybeAskTour() {
  if (asked || busy()) return;
  if (firstRunAction({ ...flags, signedIn: isSignedIn(), dataLoaded: true }) !== 'ask-tour') return;
  asked = true;
  startTour([{ id: 'ask', text: {
    title: '要不要看看各个功能在哪？',
    lines: ['课程数据已经读到了。花半分钟，在页面上看看截止日期、课程文件、手机提醒都在哪。'],
  } }], {
    mode: 'ask',
    labels: { yes: '好', no: '不用了' },
    onEnd: ({ choice }) => {
      saveFlags({ tourSeen: true });
      if (choice === 'yes') walkAgain(false);
    },
  });
}

/** The tour again (在页面上再带我走一遍, or 好 after signing in, without the black-window card). */
function walkAgain(withCard = true) {
  startTour(withCard ? TOUR_STEPS : TOUR_STEPS.filter((s) => !s.mustSee), { signedIn: isSignedIn });
}

// ---- The cards (💡 帮助 / 常见问题) ----

/** Opens the card guide at page `at` (帮助: 0, 常见问题: the FAQ page). */
export function openGuide(at = 0) {
  opener = document.activeElement;
  page = Math.max(0, Math.min(LAST, at));
  $('guide').hidden = false;
  document.body.classList.add('guide-open');
  render();
  $('guideTitle').focus();
}

function closeGuide() {
  $('guide').hidden = true;
  document.body.classList.remove('guide-open');
  (opener && opener !== document.body && document.contains(opener) ? opener : $('helpBtn')).focus();
}

function go(to) {
  if (to < 0 || to > LAST) return;
  const wasOn = document.activeElement;
  page = to;
  render();
  // Keep focus on the button pressed, unless it just went away.
  if (wasOn === $('guidePrev') && page === 0) $('guideNext').focus();
}

function render() {
  const p = GUIDE_PAGES[page];
  $('guideStep').textContent = `第 ${page + 1} / ${GUIDE_PAGES.length} 页`;
  $('guideSkip').textContent = page === LAST ? '关闭' : '跳过';
  $('guidePrev').classList.toggle('invisible', page === 0);
  $('guidePrev').disabled = page === 0;
  $('guideNext').textContent = page === LAST ? '开始使用' : '下一步';
  $('guideDots').replaceChildren(...GUIDE_PAGES.map((x, i) => {
    const dot = el('button', { type: 'button', class: 'guide-dot', 'aria-label': `第 ${i + 1} 页：${x.title}` });
    if (i === page) dot.setAttribute('aria-current', 'step');
    dot.addEventListener('click', () => go(i));
    return dot;
  }));
  const body = $('guideBody');
  body.scrollTop = 0;
  let walk = null;
  if (page === 0) {
    walk = el('button', { type: 'button', id: 'walkAgain', class: 'link guide-walk' }, '在页面上再带我走一遍');
    walk.addEventListener('click', () => {
      closeGuide();
      walkAgain();
    });
  }
  // replaceChildren would write a null as the word "null", so the parts a page lacks are dropped first.
  body.replaceChildren(...[
    p.icon ? el('div', { class: 'guide-icon', 'aria-hidden': 'true' }, p.icon) : null,
    el('h2', { id: 'guideTitle', tabindex: '-1' }, p.title),
    ...p.lines.map((line) => el('p', { class: 'guide-line' }, line)),
    p.swatches ? swatchesEl() : null,
    p.image ? el('figure', { class: 'guide-shot' },
      el('img', { src: p.image.src, alt: p.image.alt, width: String(p.image.width), height: String(p.image.height) }),
      el('figcaption', { class: 'muted small' }, '示例截图（只是图片，不能点）')) : null,
    walk,
    p.faq ? faqSection() : null,
  ].filter(Boolean));
}

// ---- The FAQ page ----

function faqSection() {
  const input = el('input', { id: 'faqSearch', type: 'search', placeholder: '输入关键字，例如 提醒、登录、下载', autocomplete: 'off' });
  input.value = faqQuery;
  input.addEventListener('input', () => {
    faqQuery = input.value;
    drawFaq();
  });
  const box = el('div', { class: 'faq' },
    el('label', { class: 'faq-search', for: 'faqSearch' }, '搜索常见问题'),
    input,
    el('p', { id: 'faqCount', class: 'muted small', role: 'status' }),
    el('div', { id: 'faqList' }));
  if (faq) queueMicrotask(drawFaq);
  else loadFaq();
  return box;
}

async function loadFaq() {
  try {
    faq = parseFaq((await api('/api/faq')).text);
  } catch (err) {
    $('faqList')?.replaceChildren(actionLine(`常见问题没有读取成功：${err.message}`, [{ label: '再试一次', onClick: loadFaq }]));
    return;
  }
  drawFaq();
}

function drawFaq() {
  const list = $('faqList');
  if (!list || !faq) return;
  const searching = faqQuery.trim() !== '';
  const groups = filterFaq(faq.groups, faqQuery);
  const found = countQuestions(groups);
  $('faqCount').textContent = searching ? (found ? `找到 ${found} 个相关问题` : '') : '点大类展开，再点问题看答案。';
  if (!found) {
    const clear = el('button', { type: 'button', class: 'link' }, '清空搜索');
    clear.addEventListener('click', () => {
      faqQuery = '';
      $('faqSearch').value = '';
      drawFaq();
      $('faqSearch').focus();
    });
    return list.replaceChildren(el('p', { class: 'faq-none' },
      '没找到相关的问题。换个词试试，比如「提醒」「登录」「下载」；还是找不到，点页面最下面的「意见反馈」问我们。 ', clear));
  }
  // A few results open straight away; otherwise the student picks.
  const openAnswers = searching && found <= 3;
  list.replaceChildren(...groups.map((g) => {
    const group = el('details', { class: 'faq-group' },
      el('summary', {}, el('span', {}, g.title), el('span', { class: 'faq-n muted small' }, `${g.questions.length} 个问题`)),
      ...(searching ? [] : blocks(g.intro)),
      ...g.questions.map((q) => {
        const item = el('details', { class: 'faq-q' }, el('summary', {}, q.title), el('div', { class: 'faq-a' }, ...blocks(q.blocks)));
        item.open = openAnswers;
        return item;
      }));
    group.open = searching || g.open;
    return group;
  }));
}

/** Parsed Markdown blocks as elements; every piece of text goes in as text. */
function blocks(list) {
  return list.map((b) => (b.type === 'p'
    ? el('p', {}, segments(b.segments))
    : el(b.type, {}, b.items.map((item) => el('li', {}, segments(item))))));
}

function segments(segs) {
  return segs.map((s) => {
    if (s.type === 'bold') return el('b', {}, s.text);
    if (s.type === 'code') return el('code', {}, s.text);
    if (s.type === 'link') return el('a', { href: s.href, target: '_blank', rel: 'noopener noreferrer' }, s.text);
    return document.createTextNode(s.text);
  });
}

// ---- Wiring ----

/**
 * signedIn(): connected to Blackboard (the sign-in check said so).
 * onFirstRunDone: after the first-start guide (focus to 连接 Blackboard).
 */
export function initHelp({ signedIn = () => false, onFirstRunDone = () => {} } = {}) {
  isSignedIn = signedIn;
  afterFirstRun = onFirstRunDone;
  initSpotlight();
  $('welcomeStart').addEventListener('click', () => leaveWelcome('start'));
  $('welcomeSkip').addEventListener('click', () => leaveWelcome('skip'));
  // Esc on the welcome box is 跳过引导: the black-window card still follows.
  $('welcome').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      leaveWelcome('skip');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const items = [$('welcomeStart'), $('welcomeSkip')];
      items[(items.indexOf(document.activeElement) + 1) % items.length].focus();
    }
  });
  $('helpBtn').addEventListener('click', () => openGuide(helpAction('help', GUIDE_PAGES).page));
  for (const id of ['faqBtn', 'faqFooter']) $(id).addEventListener('click', () => openGuide(helpAction('faq', GUIDE_PAGES).page));
  $('guideFooter').addEventListener('click', () => openGuide(helpAction('help', GUIDE_PAGES).page));
  $('guidePrev').addEventListener('click', () => go(page - 1));
  $('guideNext').addEventListener('click', () => (page === LAST ? closeGuide() : go(page + 1)));
  $('guideSkip').addEventListener('click', closeGuide);
  $('guide').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGuide();
    } else if (e.key === 'Tab') {
      trapFocus(e);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.target.closest('input, textarea, select')) {
      e.preventDefault();
      go(page + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });
}

/** Tab and Shift+Tab stay inside the dialog while it is open. */
function trapFocus(e) {
  const items = [...$('guideBox').querySelectorAll('button, [href], input, summary, [tabindex="-1"]#guideTitle')]
    .filter((x) => !x.disabled && x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  } else if (!$('guideBox').contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  }
}
