// The spotlight tour and the first start, as pure rules: which steps can be
// shown on the page as it is right now, where 上一步 / 下一步 go, what each step
// says (taken from the guide pages, so the words are written once), and what
// the first start shows. No DOM: the page passes in what it sees. Served as
// /tour.js; public/spotlight.js draws the tour.

/**
 * Whether a step can be shown now. `ctx.signedIn`: connected to Blackboard;
 * `ctx.isShown(selector)`: the element is on the page and not hidden. A step
 * inside a section checks the section, since a folded section is opened for
 * the step. A step without a target is a card in the middle and always shows.
 */
export function available(step, ctx) {
  if (step.when === 'signedIn' && !ctx.signedIn) return false;
  if (step.when === 'signedOut' && ctx.signedIn) return false;
  if (!step.target) return true;
  return Boolean(ctx.isShown(step.section ? `#${step.section}` : step.target));
}

/** The steps that can be shown now, in order. Missing targets are left out, never framed empty. */
export function planTour(steps, ctx) {
  return steps.filter((s) => available(s, ctx));
}

/**
 * The next step from index `from` in direction `dir` (+1 or -1) that can be
 * shown now, or -1 when there is none. Asked at every move, because the page
 * can change while the tour runs (data arriving, signing in).
 */
export function findStep(steps, from, dir, ctx) {
  for (let i = from + dir; i >= 0 && i < steps.length; i += dir) {
    if (available(steps[i], ctx)) return i;
  }
  return -1;
}

/**
 * What a step says: its guide page's title and lines, or only some lines with
 * a short title of its own (e.g. 我的清单 out of 其他好用的).
 */
export function stepText(step, pages) {
  const page = pages.find((p) => p.id === step.page);
  if (!page) throw new Error(`no guide page ${step.page}`);
  return {
    title: step.title ?? page.title,
    lines: step.lines ? step.lines.map((i) => page.lines[i]) : page.lines,
    swatches: Boolean(page.swatches && !step.lines),
  };
}

/**
 * What to show when the page opens: 'welcome' on the very first start, then
 * once — after signing in for the first time and the courses have loaded —
 * 'ask-tour' (要不要看看各个功能在哪？), else nothing.
 */
export function firstRunAction({ guideSeen, tourSeen, signedIn, dataLoaded }) {
  if (guideSeen === false) return 'welcome';
  if (guideSeen === true && tourSeen === false && signedIn && dataLoaded) return 'ask-tour';
  return null;
}

/**
 * The welcome box: 开始 runs the whole tour; 跳过引导 still shows the
 * black-window card once (it cannot be skipped), on its own.
 */
export function afterWelcome(choice, steps) {
  const keepOpen = steps.filter((s) => s.mustSee);
  return choice === 'start' ? { steps, mode: 'tour' } : { steps: keepOpen, mode: 'card' };
}

/** 💡 帮助 opens the card guide at page 1; 常见问题 at its last page (the FAQ). */
export function helpAction(which, pages) {
  return { mode: 'cards', page: which === 'faq' ? pages.findIndex((p) => p.faq) : 0 };
}

/**
 * Flags to save when a first-start guide ends (finished or skipped): the
 * guide is seen; the tour counts as seen only when signed in, so a student
 * who started signed out is asked once after the first sign-in.
 */
export function flagsAfterFirstRun({ signedIn }) {
  return signedIn ? { guideSeen: true, tourSeen: true } : { guideSeen: true };
}
