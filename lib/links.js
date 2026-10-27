// Links from the panel back to Blackboard Ultra, built from the saved school address.
// The formats were copied from the address bar of a real Ultra site (2026-10-27):
//   course home   /ultra/courses/<courseId>/outline
//   assessment    /ultra/courses/<courseId>/assessment/<contentId>/overview?courseId=<courseId>
//   message       /ultra/courses/<courseId>/messages/edit/<threadId>?courseId=<courseId>&offset=0&count=1
// Ids are Blackboard's internal ids (like _12345_1), never course codes.
// Pages not checked this way link to the course home instead of a guess.

/**
 * Assessment pages (assignments, tests) open their overview; anything else,
 * or a missing content id, opens the course home. Returns undefined unless
 * the school address is https.
 */
export function blackboardLink(baseUrl, { courseId, contentId, assessment = false } = {}) {
  if (!courseId) return undefined;
  const c = encodeURIComponent(courseId);
  return contentId && assessment
    ? onSchoolHost(baseUrl, `/ultra/courses/${c}/assessment/${encodeURIComponent(contentId)}/overview?courseId=${c}`)
    : courseLink(baseUrl, courseId);
}

/**
 * What a link opens, for the button's words: 'item' (that assignment or
 * message: 在 Blackboard 打开) or 'course' (the course home: 打开课程主页).
 */
export function linkKind({ contentId, assessment = false, threadId } = {}) {
  return (contentId && assessment) || threadId ? 'item' : 'course';
}

/**
 * A course's home page (its outline). Checked against the live API: this is
 * the address Blackboard itself gives as a course's externalAccessUrl.
 * Announcements and grades link here, since the API gives no page address
 * for them and other Ultra addresses are not guessed.
 */
export function courseLink(baseUrl, courseId) {
  if (!courseId) return undefined;
  return onSchoolHost(baseUrl, `/ultra/courses/${encodeURIComponent(courseId)}/outline`);
}

/**
 * One message thread in a course, where the student can read and reply.
 * Without a thread id it opens the course home: Ultra has no plain
 * course-messages address that was checked to open.
 */
export function messagesLink(baseUrl, courseId, threadId) {
  if (!courseId) return undefined;
  if (!threadId) return courseLink(baseUrl, courseId);
  const c = encodeURIComponent(courseId);
  return onSchoolHost(baseUrl, `/ultra/courses/${c}/messages/edit/${encodeURIComponent(threadId)}?courseId=${c}&offset=0&count=1`);
}

function onSchoolHost(baseUrl, path) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (base.protocol !== 'https:') return undefined;
  const url = new URL(path, base.origin);
  return url.protocol === 'https:' && url.host === base.host ? url.href : undefined;
}
