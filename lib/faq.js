// The FAQ page: docs/FAQ.md turned into groups and questions, and the search
// box. No DOM and no Node-only code: the page loads it as /faq.js and draws
// the result with textContent, so nothing in the file can become HTML.
//
// Markdown supported: ## group, ### question, paragraphs, "- " and "1. "
// lists, **bold**, `code` and [links](https://…). Anything else (HTML tags,
// other link schemes) stays plain text. "# " and "> " lines are skipped.

/** The one group that starts open. */
export const FIRST_OPEN = '最重要的一条';

// A link target may hold one level of brackets, e.g. …/Foo_(bar).
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;

/** Only https links become links; anything else keeps just its words. */
export function safeHref(href) {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** One line of text as segments: { type: 'text' | 'bold' | 'code', text } or { type: 'link', text, href }. */
export function inline(line) {
  const out = [];
  let last = 0;
  const push = (seg) => {
    const prev = out[out.length - 1];
    if (seg.type === 'text' && prev?.type === 'text') prev.text += seg.text;
    else if (seg.text) out.push(seg);
  };
  for (const m of line.matchAll(INLINE)) {
    push({ type: 'text', text: line.slice(last, m.index) });
    const [, bold, code, label, href] = m;
    if (bold !== undefined) push({ type: 'bold', text: bold });
    else if (code !== undefined) push({ type: 'code', text: code });
    else {
      const safe = safeHref(href);
      push(safe ? { type: 'link', text: label, href: safe } : { type: 'text', text: label });
    }
    last = m.index + m[0].length;
  }
  push({ type: 'text', text: line.slice(last) });
  return out;
}

/**
 * docs/FAQ.md as { groups: [{ title, open, intro: blocks, questions: [{ title, blocks }] }] }.
 * A block is { type: 'p', segments } or { type: 'ul' | 'ol', items: [segments] }.
 */
export function parseFaq(md) {
  const groups = [];
  let blocks = null; // where the next block goes
  let list = null;
  const add = (block) => {
    if (!blocks) {
      // Text before the first group gets a group of its own, so nothing is lost.
      groups.push({ title: '说明', open: false, intro: [], questions: [] });
      blocks = groups[0].intro;
    }
    blocks.push(block);
    return block;
  };
  for (const raw of String(md).split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!line || /^#\s/.test(line) || line.startsWith('>')) {
      list = null;
    } else if ((m = /^##\s+(.+)$/.exec(line))) {
      const title = m[1].trim();
      const group = { title, open: title === FIRST_OPEN, intro: [], questions: [] };
      groups.push(group);
      blocks = group.intro;
      list = null;
    } else if ((m = /^###\s+(.+)$/.exec(line))) {
      if (!groups.length) groups.push({ title: '说明', open: false, intro: [], questions: [] });
      const question = { title: m[1].trim(), blocks: [] };
      groups[groups.length - 1].questions.push(question);
      blocks = question.blocks;
      list = null;
    } else if ((m = /^(?:([-*])|\d+[.)])\s+(.+)$/.exec(line))) {
      const type = m[1] ? 'ul' : 'ol';
      if (!list || list.type !== type) list = add({ type, items: [] });
      list.items.push(inline(m[2]));
    } else {
      list = null;
      add({ type: 'p', segments: inline(line) });
    }
  }
  return { groups };
}

const segText = (segs) => segs.map((s) => s.text).join('');

/** The words of some blocks, for searching. */
export function plainText(blocks) {
  return blocks.map((b) => (b.type === 'p' ? segText(b.segments) : b.items.map(segText).join(' '))).join(' ');
}

/**
 * The questions that contain every word of `query` (any case), in their
 * groups. A word may also match the group's title, so 「提醒」 finds the
 * whole 手机提醒 group. An empty query gives everything back.
 */
export function filterFaq(groups, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups
    .map((g) => ({
      ...g,
      questions: g.questions.filter((q) => {
        const hay = `${g.title} ${q.title} ${plainText(q.blocks)}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }),
    }))
    .filter((g) => g.questions.length);
}

/** How many questions are left after filtering. */
export const countQuestions = (groups) => groups.reduce((n, g) => n + g.questions.length, 0);
