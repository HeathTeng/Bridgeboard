// The spotlight tour: dims the page, frames one real element at a time with a
// round ring, and explains it in a small frosted bubble. While it runs the
// page cannot be clicked (a transparent layer covers it); only the bubble's
// buttons, ← / → and Esc work. Which steps show is decided by lib/tour.js.
import { GUIDE_PAGES } from './guide.js';
import { findStep, planTour, stepText } from './tour.js';
import { peekOpen } from './layout.js';
import { $, el } from './ui.js';

const GAP = 14; // between the ring and the bubble
const PAD = 6; // the ring sits this far outside its target
const TOP = 84; // room above a target for the sticky section nav

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const phoneWidth = () => window.matchMedia('(max-width: 600px)').matches;

let run = null; // the tour under way

/** On the page and drawn (not hidden, not inside something hidden). */
export function isShown(selector) {
  const node = document.querySelector(selector);
  return Boolean(node && node.getClientRects().length);
}

export const tourRunning = () => Boolean(run);

/** The five deadline colours as the page's own capsules; the card guide uses them too. */
export function swatchesEl() {
  const pills = [['overdue', '逾期'], ['dueSoon', '临期'], ['open', '还有时间'], ['new', '刚开放'], ['done', '已完成']];
  return el('p', { class: 'legend guide-swatches', 'aria-label': '颜色示例' },
    ...pills.map(([st, text]) => el('span', { class: `pill st-${st}` }, text)));
}

/**
 * Runs `steps`. mode 'tour': 上一步 / 下一步 / 跳过 (except on a mustSee step);
 * 'card': one card with 知道了; 'ask': one card whose two buttons are
 * `labels.yes` / `labels.no`. onEnd({ completed, choice }) runs at the end,
 * after focus has gone back to where it was.
 */
export function startTour(steps, { signedIn = () => true, mode = 'tour', labels = {}, onEnd = () => {} } = {}) {
  if (run) endTour({ completed: false });
  const ctx = { get signedIn() { return signedIn(); }, isShown };
  const first = findStep(steps, -1, 1, ctx);
  if (first < 0) return onEnd({ completed: true });
  run = { steps, ctx, mode, labels, onEnd, i: -1, fold: () => {}, opener: document.activeElement };
  $('tour').hidden = false;
  document.body.classList.add('tour-open');
  show(first, true);
}

function endTour(result) {
  if (!run) return;
  const r = run;
  run = null;
  r.fold();
  $('tour').hidden = true;
  $('tourRing').hidden = true;
  document.body.classList.remove('tour-open');
  const back = r.opener && r.opener !== document.body && document.contains(r.opener) ? r.opener : $('helpBtn');
  back.focus({ preventScroll: true });
  r.onEnd(result);
}

// ---- One step ----

/** How long a move takes: ring, bubble and page all at once, well under 0.3 s. */
export const GLIDE_MS = 260;

function show(i, first = false) {
  const r = run;
  const step = r.steps[i];
  r.fold();
  r.fold = () => {};
  const wasOn = document.activeElement;
  r.i = i;
  drawBubble(step);
  if (step.target) {
    if (step.section) r.fold = peekOpen(step.section);
    const target = document.querySelector(step.target);
    const to = scrollTopFor(target);
    // Ring and bubble go straight to where the target will be; the page scrolls at the same time.
    r.moving = true;
    place(target, { scrollTo: to });
    glideTo(to).then(() => {
      if (run !== r || r.i !== i) return; // moved on meanwhile
      r.moving = false;
      place(target, { jump: true }); // settle on the real position (the same, unless the page moved)
    });
  } else {
    center();
  }
  if (first || !$('tourBubble').contains(wasOn) || wasOn.hidden) $('tourTitle').focus({ preventScroll: true });
}

function drawBubble(step) {
  const { mode, steps, ctx } = run;
  const text = step.text ?? stepText(step, GUIDE_PAGES);
  const page = GUIDE_PAGES.find((p) => p.id === step.page);
  const plan = planTour(steps, ctx);
  const firstFramed = plan.find((s) => s.target) === step;
  $('tourBody').replaceChildren(...[
    !step.target && page?.icon ? el('div', { class: 'guide-icon', 'aria-hidden': 'true' }, page.icon) : null,
    el('h2', { id: 'tourTitle', tabindex: '-1' }, text.title),
    ...text.lines.map((line) => el('p', { class: 'tour-line' }, line)),
    text.swatches ? swatchesEl() : null,
    firstFramed && mode === 'tour' ? el('p', { class: 'tour-hint muted small' }, '引导中页面不能点，看完再去点。') : null,
  ].filter(Boolean));
  const hasPrev = findStep(steps, run.i, -1, ctx) >= 0;
  const hasNext = findStep(steps, run.i, 1, ctx) >= 0;
  $('tourStep').textContent = mode === 'tour' ? `第 ${plan.indexOf(step) + 1} / ${plan.length} 步` : '';
  $('tourSkip').hidden = mode !== 'tour' || Boolean(step.mustSee);
  if (mode === 'ask') {
    $('tourPrev').hidden = false;
    $('tourPrev').textContent = run.labels.no;
    $('tourNext').textContent = run.labels.yes;
  } else {
    $('tourPrev').hidden = !hasPrev;
    $('tourPrev').textContent = '上一步';
    $('tourNext').textContent = hasNext ? '下一步' : mode === 'card' ? '知道了' : '完成';
  }
}

/** A step without a target: a card in the middle, the whole page dimmed. */
function center() {
  $('tourRing').hidden = true;
  $('tourBlock').classList.add('dim');
  const b = $('tourBubble');
  b.classList.remove('dock');
  b.classList.add('center');
  b.style.left = '';
  b.style.top = '';
}

/** Where the page should be scrolled to: the target just under the sticky nav, within the page. */
function scrollTopFor(target) {
  const top = Math.round(target.getBoundingClientRect().top + window.scrollY - TOP);
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return Math.max(0, Math.min(top, max));
}

/**
 * Scrolls to `to` in GLIDE_MS (at once under reduced motion). Our own short
 * animation, not the browser's smooth scroll, whose length depends on the
 * distance. A timer finishes it if animation frames stop (a hidden tab).
 */
function glideTo(to) {
  const from = window.scrollY;
  if (Math.abs(to - from) < 2) return Promise.resolve();
  if (reduceMotion()) {
    window.scrollTo({ top: to, behavior: 'instant' });
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.scrollTo({ top: to, behavior: 'instant' });
      resolve();
    };
    const tick = (now) => {
      if (done) return;
      const t = Math.min(1, (now - start) / GLIDE_MS);
      window.scrollTo({ top: from + (to - from) * (1 - (1 - t) ** 3), behavior: 'instant' });
      if (t < 1) requestAnimationFrame(tick);
      else finish();
    };
    requestAnimationFrame(tick);
    setTimeout(finish, GLIDE_MS + 120);
  });
}

/**
 * Frames the target. Page coordinates: the ring and bubble scroll with the
 * page, so they can be put in place before the page has finished scrolling;
 * `scrollTo` says where it is scrolling to, for choosing the bubble's side.
 */
function place(target, { jump = false, scrollTo = window.scrollY } = {}) {
  const rect = target.getBoundingClientRect();
  const ring = $('tourRing');
  const appearing = ring.hidden;
  ring.classList.toggle('jump', appearing || jump);
  ring.hidden = false;
  Object.assign(ring.style, {
    left: `${rect.left + window.scrollX - PAD}px`,
    top: `${rect.top + window.scrollY - PAD}px`,
    width: `${rect.width + 2 * PAD}px`,
    height: `${rect.height + 2 * PAD}px`,
  });
  $('tourBlock').classList.remove('dim');
  placeBubble(rect, scrollTo - window.scrollY, jump);
}

/**
 * Below the target if it fits on the screen, else above; on a phone, or when
 * neither fits (a tall section), the bubble sits at the bottom of the screen.
 * `shift`: how far the page is about to scroll.
 */
function placeBubble(rect, shift = 0, jump = false) {
  const b = $('tourBubble');
  const wasPlaced = !b.classList.contains('center') && !b.classList.contains('dock');
  b.classList.remove('center');
  const top = rect.top - shift; // on the screen, once scrolled
  const bottom = rect.bottom - shift;
  const below = window.innerHeight - bottom - GAP;
  const above = top - GAP;
  const height = b.offsetHeight;
  if (phoneWidth() || (below < height && above < height)) {
    b.classList.add('dock');
    b.style.left = '';
    b.style.top = '';
    return;
  }
  b.classList.remove('dock');
  // Glide from where it was; appear in place when it was docked or in the middle.
  b.classList.toggle('jump', jump || !wasPlaced);
  const pageTop = (below >= height ? bottom + GAP : top - GAP - height) + window.scrollY + shift;
  const left = Math.min(Math.max(16, rect.left), window.innerWidth - b.offsetWidth - 16);
  b.style.left = `${left + window.scrollX}px`;
  b.style.top = `${pageTop}px`;
}

/** Window resized or the page changed under the ring: frame the target again, without animation. */
let pending = false;
function reposition() {
  if (!run || run.moving || pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const step = run?.steps[run.i];
    if (!step) return;
    const target = step.target && document.querySelector(step.target);
    if (!target) return center();
    if (!target.getClientRects().length) return next(); // gone (e.g. hidden by a re-render): move on
    place(target, { jump: true });
  });
}

// ---- Moving ----

function next() {
  if (run.mode === 'ask') return endTour({ completed: true, choice: 'yes' });
  const j = findStep(run.steps, run.i, 1, run.ctx);
  if (j < 0) return endTour({ completed: true });
  show(j);
}

function prev() {
  if (run.mode === 'ask') return endTour({ completed: false, choice: 'no' });
  const j = findStep(run.steps, run.i, -1, run.ctx);
  if (j >= 0) show(j);
}

/** Esc: the end of the tour. A mustSee card has been shown by then, so it counts as seen. */
function skip() {
  endTour({ completed: false, choice: run.mode === 'ask' ? 'no' : undefined });
}

export function initSpotlight() {
  $('tourNext').addEventListener('click', next);
  $('tourPrev').addEventListener('click', prev);
  $('tourSkip').addEventListener('click', skip);
  // The page under the tour cannot be clicked.
  $('tourBlock').addEventListener('click', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    if (!run) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      skip();
    } else if (e.key === 'ArrowRight' && run.mode === 'tour') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft' && run.mode === 'tour') {
      e.preventDefault();
      prev();
    } else if (e.key === 'Tab') {
      trapFocus(e);
    }
  }, true);
  window.addEventListener('resize', reposition);
  // The ring scrolls with the page by itself; the bubble's side (below / above / docked) may need to change.
  window.addEventListener('scroll', reposition, { passive: true });
  new ResizeObserver(reposition).observe(document.body);
}

/** Tab and Shift+Tab stay inside the bubble. */
function trapFocus(e) {
  const items = [$('tourTitle'), ...$('tourBubble').querySelectorAll('button')].filter((x) => x && !x.hidden && !x.disabled);
  const at = items.indexOf(document.activeElement);
  e.preventDefault();
  const to = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + items.length) % items.length;
  items[to].focus();
}
