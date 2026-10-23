// The page's sections, the display settings, and short course names. No
// Node-only code: the page loads this file as /display.js and the server
// uses it to check what the page saves.

/**
 * The sections in page order. Adding a section or a show/hide switch is one
 * entry here. keepSignedOut: still shown when not connected (local data).
 * top: one of the three side-by-side columns at the top on a wide screen.
 * open: open by default; 'untilOn' means open until phone alerts are on.
 * perCourse: listed by course, so earlier terms fold into 往期课程.
 */
export const SECTIONS = [
  { id: 'deadlines', label: '截止日期', top: true, open: true },
  { id: 'files', label: '课程文件', top: true, open: true, perCourse: true },
  { id: 'alerts', label: '手机提醒', keepSignedOut: true, top: true, open: 'untilOn' },
  { id: 'checklist', label: '清单', keepSignedOut: true },
  { id: 'messages', label: '课程消息', keepSignedOut: true, perCourse: true },
  { id: 'announcements', label: '公告' },
  { id: 'grades', label: '成绩', perCourse: true },
];

export const COURSE_NAME_MODES = ['full', 'short'];
// 外观: 跟随电脑 / 白天 / 夜间, applied as data-theme on <html>. 护眼 is the
// separate switch `eye` (data-eye), which works with any of them.
export const THEMES = ['system', 'light', 'dark'];
// collapsed: only the sections the student opened or folded ({ id: true } is
// folded); the rest follow SECTIONS. pastOpen: sections whose 往期课程 are open.
// gloss: 课程词条中文 (Chinese after known English terms), on by default.
export const DISPLAY_DEFAULTS = { hidden: [], courseNames: 'full', theme: 'system', eye: false, collapsed: {}, pastOpen: [], gloss: true };

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Checks display settings sent by the page; throws a plain-Chinese 400 when wrong. */
export function checkDisplay(d) {
  if (!d || typeof d !== 'object') throw bad('显示设置的格式不对，请刷新页面再试。');
  const hidden = d.hidden ?? [];
  const ids = new Set(SECTIONS.map((s) => s.id));
  if (!Array.isArray(hidden) || !hidden.every((id) => ids.has(id))) throw bad('显示设置里有不认识的区域，请刷新页面再试。');
  const unique = [...new Set(hidden)];
  if (unique.length >= SECTIONS.length) throw bad('至少要显示一个区域。');
  const courseNames = d.courseNames ?? DISPLAY_DEFAULTS.courseNames;
  if (!COURSE_NAME_MODES.includes(courseNames)) throw bad('课程名只能选"完整"或"简短"。');
  let theme = d.theme ?? DISPLAY_DEFAULTS.theme;
  let eye = d.eye ?? DISPLAY_DEFAULTS.eye;
  // An older version saved 护眼 as a theme of its own: it becomes 白天 with 护眼 on.
  if (theme === 'eye') {
    theme = 'light';
    eye = true;
  }
  if (!THEMES.includes(theme)) throw bad('外观只能选"跟随电脑""白天"或"夜间"。');
  if (typeof eye !== 'boolean') throw bad('护眼只能选"开"或"关"。');
  const collapsed = d.collapsed ?? {};
  if (!collapsed || typeof collapsed !== 'object' || Array.isArray(collapsed)
    || !Object.entries(collapsed).every(([id, v]) => ids.has(id) && typeof v === 'boolean')) {
    throw bad('显示设置里展开收起的记录不对，请刷新页面再试。');
  }
  const perCourse = new Set(SECTIONS.filter((s) => s.perCourse).map((s) => s.id));
  const pastOpen = d.pastOpen ?? [];
  if (!Array.isArray(pastOpen) || !pastOpen.every((id) => perCourse.has(id))) throw bad('显示设置里往期课程的记录不对，请刷新页面再试。');
  const gloss = d.gloss ?? DISPLAY_DEFAULTS.gloss;
  if (typeof gloss !== 'boolean') throw bad('课程词条中文只能选"显示"或"不显示"。');
  return { hidden: unique, courseNames, theme, eye, collapsed: { ...collapsed }, pastOpen: [...new Set(pastOpen)], gloss };
}

/** Whether a section starts open: the student's own choice, else the default. */
export function isOpen(display, id, { alertsOn = false } = {}) {
  const saved = display?.collapsed?.[id];
  if (typeof saved === 'boolean') return !saved;
  const open = SECTIONS.find((s) => s.id === id)?.open;
  return open === 'untilOn' ? !alertsOn : Boolean(open);
}

/** Saved settings, or the defaults when missing or unreadable. */
export function displayOf(saved) {
  try {
    return checkDisplay(saved ?? DISPLAY_DEFAULTS);
  } catch {
    return { ...DISPLAY_DEFAULTS };
  }
}

// ---- Short course names ----

const PROGRAMME = /^(FT|PT)\b/;
const YEAR = /\b(19|20)\d{2}\b/;
const TERM = /\b(term|semester|trimester)\b/i;
const GROUP = /^(group|groups|grp)\b/i;
const SESSION = /\s*\(((?:lecture|lec|seminar|tutorial|class|section)\b[^)]*)\)\s*$/i;

/**
 * Splits "FT MSc/MBA - Marketing - Group A B - Autumn 2026 Term (Lecture B)"
 * into its parts. Returns null unless the pattern is clear: a FT/PT
 * programme prefix first, the term with its year last, a subject between.
 */
export function courseParts(name) {
  const segs = String(name ?? '').split(' - ').map((s) => s.trim());
  if (segs.length < 3 || !PROGRAMME.test(segs[0])) return null;
  const last = segs.length - 1;
  const session = SESSION.exec(segs[last]);
  const term = session ? segs[last].slice(0, session.index).trim() : segs[last];
  if (!YEAR.test(term) || !TERM.test(term)) return null;
  const subject = segs.slice(1, last).filter((s) => s && !GROUP.test(s)).join(' - ');
  if (!subject) return null;
  return { prefix: segs[0], subject, term, session: session?.[1] ?? '' };
}

/** One name on its own: the subject when the pattern is clear, else the full name. */
export function shortCourseName(name) {
  return courseParts(name)?.subject ?? String(name ?? '');
}

// Ways to tell apart courses that shorten to the same subject, tried in order.
const DISAMBIGUATE = [
  (p) => (p.session ? `${p.subject} (${p.session})` : p.subject),
  (p) => `${p.subject} (${p.prefix})`,
  (p) => `${p.subject} (${[p.prefix, p.session].filter(Boolean).join(', ')})`,
  (p) => `${p.subject} (${[p.prefix, p.term, p.session].filter(Boolean).join(', ')})`,
];

/**
 * Short names for a whole list: full name -> short name, never giving two
 * different courses the same short name. Clashes get the lecture, the
 * programme or the term added; if nothing tells them apart, they keep their
 * full names.
 */
export function shortNames(names) {
  const full = [...new Set(names.map((n) => String(n ?? '')))];
  const parts = new Map(full.map((n) => [n, courseParts(n)]));
  const result = new Map(full.map((n) => [n, parts.get(n)?.subject ?? n]));

  const clashes = () => {
    const by = new Map();
    for (const [n, s] of result) by.set(s.toLowerCase(), [...(by.get(s.toLowerCase()) ?? []), n]);
    return [...by.values()].filter((g) => g.length > 1);
  };

  for (const group of clashes()) {
    const parsed = group.filter((n) => parts.get(n));
    const fixed = DISAMBIGUATE.find((variant) => {
      const tried = parsed.map((n) => variant(parts.get(n)).toLowerCase());
      const others = [...result].filter(([n]) => !parsed.includes(n)).map(([, s]) => s.toLowerCase());
      return new Set(tried).size === tried.length && !tried.some((s) => others.includes(s));
    });
    for (const n of parsed) result.set(n, fixed ? fixed(parts.get(n)) : n);
  }
  // Anything still clashing keeps its full name.
  for (const group of clashes()) for (const n of group) result.set(n, n);
  return result;
}

// ---- The nav bar on a narrow screen ----

/** Room kept clear at each end of the nav for the ‹ › buttons (px). */
export const NAV_EDGE = 44;

/**
 * Which ‹ › buttons the nav needs: none when everything fits, no ‹ at the
 * far left, no › at the far right (1 px slack for rounding).
 */
export function navArrows({ scrollLeft, scrollWidth, clientWidth }) {
  const max = scrollWidth - clientWidth;
  if (max <= 1) return { prev: false, next: false };
  return { prev: scrollLeft > 1, next: scrollLeft < max - 1 };
}

/** How far one ‹ or › press moves: about the width of the bar, keeping a little of what was in view. */
export const navStep = (clientWidth) => Math.max(clientWidth - 2 * NAV_EDGE, clientWidth / 2);

/**
 * How far to scroll the bar so an item (its left and right edge, in the same
 * coordinates as the bar's) is in view and clear of the ‹ › buttons; 0 when it already is.
 */
export function navReveal(item, bar, edge = NAV_EDGE) {
  if (item.left < bar.left + edge) return item.left - (bar.left + edge);
  if (item.right > bar.right - edge) return item.right - (bar.right - edge);
  return 0;
}
