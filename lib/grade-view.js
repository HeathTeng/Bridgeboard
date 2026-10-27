// 成绩: the words beside each bar. No DOM and no Node-only code: the page
// loads it as /grade-view.js.

/** Grade words that mean the score is not out yet (from `score` in lib/bb.js). */
export const WAITING = '等待评分';

/** The words for one item: 42/50 · 84%, Pass, or 待评分. */
export function gradeWords(g) {
  if (g.text === WAITING) return '待评分';
  if (g.pct == null) return g.text;
  return g.text === `${g.pct}%` ? g.text : `${g.text} · ${g.pct}%`;
}

/** The average of the items that have a percentage; null when none has. */
export function gradeAverage(items) {
  const pcts = items.map((g) => g.pct).filter((p) => p != null);
  return pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
}
