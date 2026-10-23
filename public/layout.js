// Page layout: the section navigation bar, 回到顶部, the 显示设置 panel,
// short or full course names and the 意见反馈 link in the footer.
// Sections and switches come from display.js.
import { $, api, el } from './ui.js';
import { DISPLAY_DEFAULTS, SECTIONS, shortNames } from './display.js';

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

export function buildNav() {
  const nav = $('sectionNav');
  for (const s of SECTIONS) {
    const section = $(s.id);
    section.toggleAttribute('data-keep-signed-out', Boolean(s.keepSignedOut));
    const a = el('a', { href: `#${s.id}`, 'data-section': s.id }, s.label, el('span', { class: 'nav-count', hidden: '' }));
    a.addEventListener('click', () => {
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

function applyLayout() {
  for (const s of SECTIONS) {
    $(s.id).classList.toggle('user-hidden', display.hidden.includes(s.id));
    links.get(s.id).hidden = !isShown(s);
  }
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
}

async function change(next, okText = '已保存，下次打开还在。') {
  const before = display;
  display = next;
  applyLayout();
  try {
    const saved = await saveDisplay(next);
    display = saved.display ?? next;
    panelMsg(saved.demo ? '示例模式：只在这次运行时有效。' : okText);
  } catch (err) {
    display = before;
    applyLayout();
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
  $('displayReset').addEventListener('click', () => change({ ...DISPLAY_DEFAULTS }, '已恢复默认。'));
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
}
