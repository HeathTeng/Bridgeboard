// Page layout: folding sections, the section navigation bar, 回到顶部, the
// 显示设置 panel (with the theme), short or full course names and the 意见反馈
// link in the footer. Sections and switches come from display.js.
import { $, api, el } from './ui.js';
import { DISPLAY_DEFAULTS, SECTIONS, isOpen, shortNames } from './display.js';
import { LOADING } from './section-summary.js';

let display = { ...DISPLAY_DEFAULTS };
let signedIn = false;
let shortMap = new Map();
const changeListeners = [];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const behavior = () => (reduceMotion.matches ? 'auto' : 'smooth');

/** Runs fn whenever the display settings change (e.g. to redraw dropdowns). */
export const onDisplayChange = (fn) => changeListeners.push(fn);

function isShown(s) {
  return !display.hidden.includes(s.id) && (signedIn || Boolean(s.keepSignedOut));
}

// ---- Course names ----

/** Learns every course name, so short names can be made unique across them. */
export function setCourseNames(names) {
  shortMap = shortNames(names);
}

/** Plain text, for places like <option> that cannot hold markup. */
export function courseText(full) {
  return display.courseNames === 'short' ? shortMap.get(full) ?? full : full;
}

/**
 * Both names in the page; CSS shows one. The full name is always in the
 * tooltip, and an opened <details> shows it in its summary.
 */
export function courseEl(full) {
  const short = shortMap.get(full) ?? full;
  return el('span', { class: 'cn', title: full },
    short !== full ? el('span', { class: 'cn-short' }, short) : null,
    el('span', { class: 'cn-full' }, full));
}

// ---- Folding sections ----

// Line icons, drawn on a 24 x 24 grid.
const ICONS = {
  deadlines: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M12 7v5l3 2'],
  files: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  alerts: ['M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z', 'M10 20a2 2 0 0 0 4 0'],
  checklist: ['M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z', 'M8.5 12l2.5 2.5 4.5-5'],
  messages: ['M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H10l-5 4v-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z'],
  announcements: ['M4 10v4h3l7 4V6l-7 4z', 'M17.5 9.5a3.5 3.5 0 0 1 0 5'],
  grades: ['M5 20V11', 'M12 20V5', 'M19 20v-6'],
};
const SVG = 'http://www.w3.org/2000/svg';

function icon(id) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'sec-icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[id] ?? []) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

const toggles = new Map(); // section id -> its heading button
let alertsOn = false;
let alertsKnown = false;

function setOpen(id, open) {
  const button = toggles.get(id);
  if (!button) return;
  button.setAttribute('aria-expanded', String(open));
  $(`${id}-body`).hidden = !open;
  $(id).classList.toggle('folded', !open);
}

/** Opens a section without remembering it, e.g. before jumping to it. */
export function openSection(id) {
  setOpen(id, true);
}

/** An error inside a section: open it and put a warning mark on its nav item. */
export function flagError(id) {
  setOpen(id, true);
  links.get(id)?.classList.add('has-error');
}

export function clearError(id) {
  links.get(id)?.classList.remove('has-error');
}

/** The one line a folded section shows. */
export function setSummary(id, text) {
  const line = $(`${id}-sum`);
  if (line) line.textContent = text;
}

function applyFolds() {
  for (const s of SECTIONS) setOpen(s.id, isOpen(display, s.id, { alertsOn }));
}

/**
 * Phone alerts start folded once they are on. Only the first answer moves
 * the section, so switching alerts on does not fold it under the student.
 */
export function setAlertsOn(on) {
  const first = !alertsKnown;
  alertsKnown = true;
  alertsOn = on;
  if (first) setOpen('alerts', isOpen(display, 'alerts', { alertsOn }));
}

/** Saves a fold without a message in the panel; a failure only loses the memory. */
function remember(next) {
  display = next;
  saveDisplay(next).then((saved) => { display = saved.display ?? next; }).catch(() => {});
}

/**
 * Turns each section's <h2> into a full-width button (icon, name, summary,
 * chevron) and moves the rest into a body that folds. Also adds the
 * 💡 怎么用？ buttons (.howto) and the 显示全部 buttons ([data-more]).
 */
function initSections() {
  for (const s of SECTIONS) {
    const section = $(s.id);
    const h2 = section.querySelector(':scope > h2');
    const body = el('div', { id: `${s.id}-body`, class: 'sec-body' });
    body.append(...[...section.childNodes].filter((n) => n !== h2));
    const button = el('button', { type: 'button', class: 'sec-toggle', 'aria-expanded': 'true', 'aria-controls': body.id },
      icon(s.id),
      el('span', { class: 'sec-name' }, h2.textContent.trim()),
      el('span', { class: 'sec-sum', id: `${s.id}-sum` }, LOADING),
      el('span', { class: 'sec-chev', 'aria-hidden': 'true' }));
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      setOpen(s.id, open);
      remember({ ...display, collapsed: { ...display.collapsed, [s.id]: !open } });
    });
    h2.className = 'sec-head';
    h2.replaceChildren(button);
    section.classList.toggle('top', Boolean(s.top));
    section.append(body);
    toggles.set(s.id, button);
  }
  for (const box of document.querySelectorAll('.howto')) {
    const b = el('button', { type: 'button', class: 'howto-btn', 'aria-expanded': 'false' }, '💡 怎么用？');
    b.addEventListener('click', () => {
      box.hidden = !box.hidden;
      b.setAttribute('aria-expanded', String(!box.hidden));
    });
    box.before(b);
  }
  for (const box of document.querySelectorAll('[data-more]')) {
    const b = el('button', { type: 'button', class: 'show-all' }, box.dataset.more);
    b.addEventListener('click', () => {
      box.hidden = false;
      b.remove();
    });
    box.before(b);
  }
  applyFolds();
}

/**
 * The 往期课程（N 门） row at the bottom of a per-course section. Whether it is
 * open is remembered per section; 恢复默认 folds it again.
 */
export function pastFold(sectionId, count, children) {
  const fold = el('details', { class: 'past-fold', 'data-section': sectionId },
    el('summary', {}, `往期课程（${count} 门）`),
    el('p', { class: 'muted small' }, '上学期和更早的课程。还有作业、未读消息或等待评分的课会留在上面。'),
    children);
  fold.open = display.pastOpen.includes(sectionId);
  fold.addEventListener('toggle', () => {
    if (fold.open === display.pastOpen.includes(sectionId)) return;
    remember({ ...display, pastOpen: fold.open ? [...display.pastOpen, sectionId] : display.pastOpen.filter((x) => x !== sectionId) });
  });
  return fold;
}

function syncPastFolds() {
  for (const fold of document.querySelectorAll('.past-fold')) fold.open = display.pastOpen.includes(fold.dataset.section);
}

// ---- Navigation ----

const links = new Map(); // section id -> nav link

function markCurrent(id) {
  for (const [sid, a] of links) {
    if (sid === id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
}

/**
 * The section in view: the one whose top is nearest above a line a third of
 * the way down the screen. Two sections side by side on a wide screen are
 * told apart by where each starts; at the very bottom, the last one.
 * After a nav click the clicked section stays marked until the student
 * scrolls by hand, since a short last section may never reach the line.
 */
let pinned;
for (const type of ['wheel', 'touchstart', 'keydown']) window.addEventListener(type, () => { pinned = undefined; }, { passive: true });

function updateCurrent() {
  const shown = SECTIONS.filter(isShown);
  if (!shown.length) return;
  if (pinned && shown.some((s) => s.id === pinned)) return markCurrent(pinned);
  if (window.scrollY < 40) return markCurrent(shown[0].id);
  const page = document.documentElement;
  if (window.scrollY + window.innerHeight >= page.scrollHeight - 2) return markCurrent(shown.at(-1).id);
  const line = window.innerHeight / 3;
  let best;
  for (const s of shown) {
    const top = $(s.id).getBoundingClientRect().top;
    if (top <= line && (!best || top > best.top)) best = { id: s.id, top };
  }
  markCurrent((best ?? { id: shown[0].id }).id);
}

let spyFrame;
const spy = () => {
  cancelAnimationFrame(spyFrame);
  spyFrame = requestAnimationFrame(updateCurrent);
};
window.addEventListener('scroll', spy, { passive: true });
window.addEventListener('resize', spy);

/** Opens a section and scrolls to it, as a nav click does. */
export function goToSection(id) {
  openSection(id);
  pinned = id;
  markCurrent(id);
  $(id).scrollIntoView({ behavior: behavior(), block: 'start' });
  window.history.replaceState(null, '', `#${id}`);
}

export function buildNav() {
  initSections();
  const nav = $('sectionNav');
  for (const s of SECTIONS) {
    const section = $(s.id);
    section.toggleAttribute('data-keep-signed-out', Boolean(s.keepSignedOut));
    const a = el('a', { href: `#${s.id}`, 'data-section': s.id }, s.label, el('span', { class: 'nav-count', hidden: '' }));
    // Open first, so the link scrolls to the section with its content showing.
    a.addEventListener('click', () => {
      openSection(s.id);
      pinned = s.id;
      markCurrent(s.id);
    });
    links.set(s.id, a);
  }
  const hiddenNote = el('button', { type: 'button', id: 'navHidden', class: 'link nav-hidden', hidden: '' });
  hiddenNote.addEventListener('click', () => openPanel());
  nav.replaceChildren(...links.values(), hiddenNote);
}

/** The small number next to a nav item; 0 hides it. */
export function setCount(id, n, title = '') {
  const badge = links.get(id)?.querySelector('.nav-count');
  if (!badge) return;
  badge.hidden = !n;
  badge.textContent = n ? String(n) : '';
  badge.title = title;
}

export function setSignedIn(value) {
  signedIn = value;
  applyLayout();
}

/** 跟随电脑 leaves data-theme off, so the CSS follows the computer's light or dark mode. */
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme && theme !== 'system') root.dataset.theme = theme;
  else delete root.dataset.theme;
  // theme.js reads this copy before the page is drawn on the next visit.
  try {
    localStorage.setItem('bridgeboard-theme', theme || 'system');
  } catch {
    // No storage: the theme still comes from settings.json, just a moment later.
  }
}

function applyLayout() {
  for (const s of SECTIONS) {
    $(s.id).classList.toggle('user-hidden', display.hidden.includes(s.id));
    links.get(s.id).hidden = !isShown(s);
  }
  // The top columns share the row equally, however many of them are shown.
  const tops = SECTIONS.filter((s) => s.top && isShown(s)).length;
  for (const k of [1, 2, 3]) $('main').classList.toggle(`tops-${k}`, tops === k);
  const n = display.hidden.length;
  $('navHidden').hidden = !n;
  $('navHidden').textContent = n ? `已隐藏 ${n} 个 · 显示设置` : '';
  document.body.classList.toggle('short-names', display.courseNames === 'short');
  updateCurrent();
  changeListeners.forEach((fn) => fn());
}

/** After the first load: go to the section named in the address (#messages), if shown. */
export function scrollToHash() {
  const s = SECTIONS.find((x) => `#${x.id}` === window.location.hash);
  if (s && isShown(s)) {
    openSection(s.id);
    pinned = s.id;
    // Jump straight there: a smooth scroll can be cut short while the page is still filling in.
    $(s.id).scrollIntoView({ behavior: 'instant' });
    markCurrent(s.id);
  }
}

// ---- 回到顶部 ----

export function initToTop() {
  const button = $('toTop');
  const update = () => { button.hidden = window.scrollY < window.innerHeight; };
  window.addEventListener('scroll', update, { passive: true });
  button.addEventListener('click', () => {
    pinned = undefined;
    window.scrollTo({ top: 0, behavior: behavior() });
    window.history.replaceState(null, '', window.location.pathname);
    document.querySelector('h1').focus({ preventScroll: true });
  });
  update();
}

// ---- 意见反馈 ----

export const FEEDBACK_ADDRESS = 'feedback@getboundly.com';

/** A mailto link with the version filled in. The panel itself sends nothing. */
export function feedbackHref(version) {
  const v = version ? `v${version}` : '';
  const body = [`版本：${v || '（不知道就留空）'}`, 'Windows 版本：（例如 Windows 11，请填写）', '', '想说的话：', ''].join('\r\n');
  return `mailto:${FEEDBACK_ADDRESS}?subject=${encodeURIComponent(`Bridgeboard 意见反馈 ${v}`.trim())}&body=${encodeURIComponent(body)}`;
}

export function initFeedback() {
  // Works without the version too: the plain address is already in the HTML.
  api('/api/ping').then((p) => {
    $('feedbackLink').href = feedbackHref(p.version);
    if (p.version) $('appVersion').textContent = ` · 当前版本 v${p.version}`;
  }).catch(() => {});
  $('feedbackCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(FEEDBACK_ADDRESS);
      $('feedbackMsg').textContent = '已复制，粘贴到你的邮箱里发送。';
    } catch {
      $('feedbackMsg').textContent = '没能自动复制，请用鼠标选中地址后按 Ctrl+C。';
    }
  });
}

// ---- 显示设置 ----

// The page decides where to be after loading (the #section in the address), not the browser.
if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

let saveDisplay = async (d) => d;

function panelMsg(text) {
  $('displayMsg').textContent = text;
}

function openPanel() {
  $('displayPanel').hidden = false;
  $('displayBtn').setAttribute('aria-expanded', 'true');
  $('displayPanel').querySelector('input')?.focus();
}

function closePanel() {
  if ($('displayPanel').hidden) return;
  $('displayPanel').hidden = true;
  $('displayBtn').setAttribute('aria-expanded', 'false');
  $('displayBtn').focus();
}

function syncPanel() {
  for (const box of document.querySelectorAll('#displaySections input')) box.checked = !display.hidden.includes(box.value);
  for (const r of document.querySelectorAll('input[name="courseNames"]')) r.checked = r.value === display.courseNames;
  for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === display.theme;
}

async function change(next, okText = '已保存，下次打开还在。') {
  const before = display;
  display = next;
  applyLayout();
  applyTheme(display.theme);
  try {
    const saved = await saveDisplay(next);
    display = saved.display ?? next;
    panelMsg(saved.demo ? '示例模式：只在这次运行时有效。' : okText);
  } catch (err) {
    display = before;
    applyLayout();
    applyTheme(display.theme);
    panelMsg(`没有保存：${err.message}`);
  }
  syncPanel();
}

/** save(display) must resolve to { display, demo? } once the server has stored it. */
export function initDisplayPanel(save) {
  saveDisplay = save;
  $('displaySections').replaceChildren(...SECTIONS.map((s) => {
    const box = el('input', { type: 'checkbox', value: s.id });
    box.addEventListener('change', () => {
      const hidden = box.checked ? display.hidden.filter((id) => id !== s.id) : [...display.hidden, s.id];
      if (hidden.length >= SECTIONS.length) {
        box.checked = true;
        return panelMsg('至少要显示一个区域。');
      }
      change({ ...display, hidden: SECTIONS.map((x) => x.id).filter((id) => hidden.includes(id)) });
    });
    return el('label', { class: 'switch' }, box, el('span', {}, s.label));
  }));
  for (const r of document.querySelectorAll('input[name="courseNames"]')) {
    r.addEventListener('change', () => change({ ...display, courseNames: r.value }));
  }
  for (const r of document.querySelectorAll('input[name="theme"]')) {
    r.addEventListener('change', () => change({ ...display, theme: r.value }));
  }
  $('displayReset').addEventListener('click', async () => {
    await change({ ...DISPLAY_DEFAULTS }, '已恢复默认。');
    applyFolds();
    syncPastFolds();
  });
  $('displayBtn').addEventListener('click', () => ($('displayPanel').hidden ? openPanel() : closePanel()));
  $('displayDone').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  document.addEventListener('click', (e) => {
    if (!$('displayPanel').hidden && !e.target.closest('#displayPanel, #displayBtn, #navHidden')) closePanel();
  });
}

/** Display settings as loaded from the server. */
export function setDisplay(d) {
  display = { ...DISPLAY_DEFAULTS, ...d };
  syncPanel();
  applyLayout();
  applyFolds();
  syncPastFolds();
  // Only here and in change(): before the settings arrive, theme.js's choice stays.
  applyTheme(display.theme);
}
