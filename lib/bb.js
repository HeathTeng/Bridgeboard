// Thin layer over the blackboard-mcp library: loads it from disk and shapes
// Blackboard's data into what the dashboard shows.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureSession, hasProfile } from './edge-login.js';

const DAY = 24 * 60 * 60 * 1000;

let lib;

/** Finds blackboard-mcp's built library: BB_MCP_PATH, the bundled copy, or a sibling checkout. */
export function libraryPath() {
  const candidates = [
    process.env.BB_MCP_PATH,
    resolve(import.meta.dirname, '..', 'vendor', 'blackboard-mcp.js'),
    resolve(import.meta.dirname, '..', '..', 'blackboard-mcp', 'dist', 'index.js'),
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

export async function loadLibrary() {
  if (lib) return lib;
  const path = libraryPath();
  if (!path) {
    throw new Error(
      '找不到 blackboard-mcp。请把它放在本项目旁边的 blackboard-mcp 文件夹并构建，或设置 BB_MCP_PATH 指向 dist/index.js。',
    );
  }
  lib = await import(pathToFileURL(path).href);
  lib.setLogLevel?.('warn');
  return lib;
}

let clientPromise;

let stopKeeper;

async function client() {
  const { BlackboardClient } = await loadLibrary();
  clientPromise ??= BlackboardClient.create()
    .then((c) => {
      // Pings Blackboard while the hub runs, so an idle session does not time out.
      stopKeeper = c.startSessionKeeper({ intervalMs: 5 * 60_000 });
      return c;
    })
    .catch((err) => {
      clientPromise = undefined;
      throw err;
    });
  return clientPromise;
}

/** Forget the cached client, e.g. after a new login. */
export function resetClient() {
  stopKeeper?.();
  stopKeeper = undefined;
  clientPromise = undefined;
}

let renewing;

/**
 * When the session has lapsed, signs in again in the background using the
 * school login saved in the pop-up browser's profile. Returns true on success.
 */
export async function renewSilently() {
  if (!hasProfile()) return false;
  const baseUrl = await savedBaseUrl();
  if (!baseUrl) return false;
  renewing ??= connectWithBrowser(baseUrl, () => {}, { silent: true })
    .then(() => true)
    .catch(() => false)
    .finally(() => { renewing = undefined; });
  return renewing;
}

/** Signs in with a pasted "Copy as cURL" or cookie string. */
export async function loginWithCurl(text, url) {
  const { login } = await loadLibrary();
  const r = await login({ cookie: text, url, paste: true, noBrowser: true });
  resetClient();
  return { baseUrl: r.baseUrl };
}

/** The Blackboard address saved by the last successful sign-in, if any. */
export async function savedBaseUrl() {
  const { loadConfigOrNull } = await loadLibrary();
  try {
    return loadConfigOrNull()?.baseUrl;
  } catch {
    return undefined;
  }
}

/**
 * Signs in through a pop-up browser window (see edge-login.js). The captured
 * cookies go through blackboard-mcp's normal login, which checks them against
 * the live API before storing anything.
 */
export async function connectWithBrowser(url, onStatus, { silent = false } = {}) {
  const { login, normaliseBaseUrl } = await loadLibrary();
  const baseUrl = normaliseBaseUrl(url);
  const result = await captureSession({
    baseUrl,
    onStatus,
    silent,
    timeoutMs: silent ? 90 * 1000 : undefined,
    validate: async (cookie, userAgent) => {
      // Shaped like a "Copy as cURL" so login() also keeps the browser's User-Agent.
      const curl = `curl '${baseUrl}/ultra' -H 'User-Agent: ${userAgent}' -H 'Cookie: ${cookie}'`;
      const r = await login({ cookie: curl, url: baseUrl, paste: true, noBrowser: true });
      return { baseUrl: r.baseUrl };
    },
  });
  resetClient();
  return { baseUrl: result.baseUrl };
}

const EXPIRED = new Set(['NOT_AUTHENTICATED', 'SESSION_EXPIRED']);

export async function status({ retry = true } = {}) {
  try {
    const c = await client();
    // whoami() is cached, so ask Blackboard directly whether the session is live.
    const seconds = await c.sessionSecondsRemaining();
    if (seconds <= 0) throw Object.assign(new Error('登录已过期'), { code: 'SESSION_EXPIRED' });
    const user = await c.whoami();
    const { displayName } = await loadLibrary();
    return { signedIn: true, name: displayName(user), secondsLeft: seconds, baseUrl: c.config?.baseUrl };
  } catch (err) {
    if (retry && EXPIRED.has(err.code)) {
      resetClient();
      if (await renewSilently()) return status({ retry: false });
    }
    return { signedIn: false, error: err.message, code: err.code };
  }
}

function text(t) {
  const raw = t?.displayText ?? t?.rawText ?? '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function score(g) {
  const value = g.effectiveScore ?? g.manualScore ?? g.displayGrade?.score;
  const possible = g.column?.possible ?? g.pointsPossible ?? g.displayGrade?.possible;
  if (g.isExempt) return { text: '免除' };
  if (value === undefined) {
    if (g.status === 'NEEDS_GRADING') return { text: '等待评分' };
    return { text: g.displayGrade?.text ?? g.manualGrade ?? '—' };
  }
  const pct = possible ? Math.round((value / possible) * 100) : undefined;
  return { text: possible ? `${value}/${possible}` : String(value), pct };
}

/** Everything the dashboard needs, in one call. */
export async function overview({ days = 30 } = {}) {
  const c = await client();
  const { courseLabel } = await loadLibrary();
  const memberships = await c.listCourses();
  const courses = memberships
    .filter((m) => m.course)
    .map((m) => ({
      id: m.course.id,
      code: m.course.courseId ?? m.course.displayId ?? '',
      name: courseLabel(m.course),
      open: m.course.isClosed !== true && m.course.isAvailable !== false,
    }));
  const names = new Map(courses.map((x) => [x.id, x.name]));
  const open = courses.filter((x) => x.open);

  const now = Date.now();
  const [todo, announcements, grades] = await Promise.all([
    c
      .listTodo({ since: new Date(now - 14 * DAY).toISOString(), until: new Date(now + days * DAY).toISOString() })
      .catch(() => []),
    Promise.all(open.map((x) => c.listCourseAnnouncements(x.id, { limit: 10 }).catch(() => []))),
    Promise.all(open.map((x) => c.listGrades(x.id).catch(() => []))),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    courses,
    todo: todo
      .filter((t) => t.dueDate)
      .map((t) => ({
        title: t.title ?? t.column?.effectiveColumnName ?? '未命名',
        course: names.get(t._courseId) ?? '',
        courseId: t._courseId,
        due: t.dueDate,
        bucket: t._bucket,
      }))
      .sort((a, b) => a.due.localeCompare(b.due)),
    announcements: announcements
      .flat()
      .filter((a) => !a.isDraft)
      .map((a) => ({
        title: a.title ?? '',
        course: a._courseName ?? names.get(a.courseId) ?? '',
        date: a.startDateRestriction ?? a.createdDate,
        body: text(a.body).slice(0, 2000),
      }))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 30),
    grades: open.map((x, i) => ({
      course: x.name,
      items: grades[i]
        .filter((g) => g.column && g.column.scorable !== false)
        .map((g) => ({
          name: g.column.effectiveColumnName ?? g.column.columnName ?? '',
          due: g.column.dueDate,
          ...score(g),
        })),
    })),
  };
}
