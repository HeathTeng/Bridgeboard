// Shapes Blackboard course messages ("conversations") for the page. Ultra
// messages have no subject, so a thread is named by who it is with. Bodies
// become plain text here; Blackboard's HTML never reaches the page.
import { messagesLink } from './links.js';

const PREVIEW_CHARS = 80;
// Things plain text cannot show: point the student to Blackboard instead.
const MEDIA = /<(img|video|audio|iframe|object|embed)\b|bbcswebdav|data-bbfile/i;

export function personName(p) {
  if (!p) return '';
  return (p.preferredDisplayName || [p.givenName, p.familyName].filter(Boolean).join(' ')).trim() || '某位用户';
}

function bodyText(body, toText) {
  const html = body?.displayText || '';
  const text = html ? toText(html) : body?.rawText ?? '';
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), hasMedia: MEDIA.test(html) };
}

export function previewOf(text) {
  const line = text.replace(/\s+/g, ' ').trim();
  return [...line].length > PREVIEW_CHARS ? `${[...line].slice(0, PREVIEW_CHARS).join('')}…` : line;
}

const byPostDate = (a, b) => (a.postDate ?? '').localeCompare(b.postDate ?? '');

/** Who a thread is with: the whole class, its groups, or the other people in it. */
function audience(raw, selfId) {
  if (raw.includesAllMembers) return '全班';
  const groups = (raw.groups ?? []).map((g) => g.title).filter(Boolean);
  if (groups.length) return groups.join('、');
  const others = (raw.participantsNotInACategory ?? []).filter((p) => p.id !== selfId).map(personName);
  if (others.length) return others.join('、');
  // Some threads carry only participant ids, without names.
  const count = (raw.participantIds ?? []).filter((id) => id !== selfId).length;
  return count ? `另外 ${count} 人` : '（收件人未知）';
}

export function shapeThread(raw, { courseId, course, selfId, toText, baseUrl }) {
  const latest = (raw.messages ?? []).slice().sort(byPostDate).at(-1);
  const { text, hasMedia } = latest ? bodyText(latest.body, toText) : { text: '', hasMedia: false };
  return {
    id: raw.id,
    courseId,
    course,
    with: audience(raw, selfId),
    from: latest ? (latest.senderId === selfId ? '我' : personName(latest.sender)) : '',
    time: raw.updatedDate ?? latest?.postDate ?? raw.createdDate ?? null,
    preview: previewOf(text) || (hasMedia ? '（图片或附件）' : ''),
    unread: Math.max(0, Number(raw.unreadCount) || 0),
    total: Math.max(0, Number(raw.totalCount) || raw.messages?.length || 0),
    link: messagesLink(baseUrl, courseId),
  };
}

/** Every course's threads, newest first, with the unread total. */
export function shapeThreads(perCourse, { selfId, toText, baseUrl }) {
  const threads = perCourse
    .flatMap(({ courseId, course, threads: rows }) => (rows ?? []).map((raw) => shapeThread(raw, { courseId, course, selfId, toText, baseUrl })))
    .sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''));
  return { threads, unread: threads.reduce((n, t) => n + t.unread, 0) };
}

/** One thread's messages, oldest first so the newest is at the bottom. */
export function shapeMessages(rows, { selfId, toText }) {
  return rows.slice().sort(byPostDate).map((m) => {
    const { text, hasMedia } = bodyText(m.body, toText);
    return {
      id: m.id,
      from: m.senderId === selfId ? '我' : personName(m.sender),
      mine: m.senderId === selfId,
      time: m.postDate ?? null,
      text,
      hasMedia,
      unread: m.isRead === false,
    };
  });
}
