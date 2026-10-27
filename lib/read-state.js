// When Blackboard does not answer: a failed read must never look like an
// empty list (「近期没有截止事项 🎉」 after a failed first read). Used by the
// server to keep failures apart from empty answers, and by the page for the
// wording. No Node-only code: the page loads it as /read-state.js.

/** Sign-in errors are passed on, so the server can renew and the page can ask to reconnect. */
const SIGNED_OUT = new Set(['NOT_AUTHENTICATED', 'SESSION_EXPIRED']);

/** A course with messages turned off answers like this; that is not a failure. */
export const MESSAGES_OFF = ['FORBIDDEN', 'NOT_FOUND', 'UNSUPPORTED'];

export const READ_FAILED = '这次没读到 Blackboard 的数据，点「重新读取」再试一次。';
export const RELOAD = '重新读取';

/** Some courses answered and some did not. */
export function partlyFailed(courses) {
  return `有 ${courses} 门课这次没读到 Blackboard 的数据，点「重新读取」再试一次。`;
}

/**
 * One read that may fail on its own: { ok: true, value }, { ok: false } for
 * a failure, or { ok: false, quiet: true } for an answer listed in `quiet`.
 * Sign-in errors are thrown, never swallowed.
 */
export async function settle(promise, quiet = []) {
  try {
    return { ok: true, value: await promise };
  } catch (err) {
    if (SIGNED_OUT.has(err?.code)) throw err;
    return { ok: false, quiet: quiet.includes(err?.code) };
  }
}

/**
 * Whether a read result has anything that failed, so it is not cached.
 * `failed` is { todo, announcements, grades } for the overview and a count
 * of courses for messages.
 */
export function hasFailures(data) {
  const f = data?.failed;
  if (typeof f === 'number') return f > 0;
  return Boolean(f && Object.values(f).some(Boolean));
}

/**
 * What a list section shows: 'failed' (the alert and 重新读取), 'empty' (the
 * usual empty line) or 'list'. A partly failed read shows the list with a
 * note above it.
 */
export function listView({ failed = false, count = 0 }) {
  if (failed && !count) return 'failed';
  return count ? 'list' : 'empty';
}
