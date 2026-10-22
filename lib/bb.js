// Thin layer over the blackboard-mcp library: loads it from disk and shapes
// Blackboard's data into what the dashboard shows.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY = 24 * 60 * 60 * 1000;

let lib;

/** Finds blackboard-mcp's built library: BB_MCP_PATH, or a sibling checkout. */
export function libraryPath() {
  const candidates = [
    process.env.BB_MCP_PATH,
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

async function client() {
  const { BlackboardClient } = await loadLibrary();
  clientPromise ??= BlackboardClient.create().catch((err) => {
    clientPromise = undefined;
    throw err;
  });
  return clientPromise;
}

/** Forget the cached client, e.g. after a new login. */
export function resetClient() {
  clientPromise = undefined;
}

/** Signs in with a pasted "Copy as cURL" or cookie string. */
export async function loginWithCurl(text, url) {
  const { login } = await loadLibrary();
  const r = await login({ cookie: text, url, paste: true, noBrowser: true });
  resetClient();
  return { baseUrl: r.baseUrl };
}

export async function status() {
  try {
    const c = await client();
    const [user, seconds] = await Promise.all([
      c.whoami(),
      c.sessionSecondsRemaining().catch(() => null),
    ]);
    const { displayName } = await loadLibrary();
    return { signedIn: true, name: displayName(user), secondsLeft: seconds, baseUrl: c.config?.baseUrl };
  } catch (err) {
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
