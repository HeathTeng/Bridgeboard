// Links from a deadline back to Blackboard Ultra, built from the saved school address.

/**
 * Assessment pages (assignments, tests) open their overview; anything else,
 * or a missing content id, opens the course outline. Returns undefined unless
 * the school address is https.
 */
export function blackboardLink(baseUrl, { courseId, contentId, assessment = false } = {}) {
  if (!courseId) return undefined;
  const c = encodeURIComponent(courseId);
  return onSchoolHost(baseUrl, contentId && assessment
    ? `/ultra/courses/${c}/outline/assessment/${encodeURIComponent(contentId)}/overview?courseId=${c}`
    : `/ultra/courses/${c}/outline`);
}

/** A course's Messages page, where the student can read and reply. */
export function messagesLink(baseUrl, courseId) {
  if (!courseId) return undefined;
  return onSchoolHost(baseUrl, `/ultra/courses/${encodeURIComponent(courseId)}/messages`);
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
