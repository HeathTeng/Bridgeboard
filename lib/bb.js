// Thin layer over the blackboard-mcp library: loads it from disk and shapes
// Blackboard's data into what the dashboard shows.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { captureSession, hasProfile, profileDir } from './edge-login.js';
import { alreadyThere, folderParts } from './downloader.js';
import { officeText } from './office-text.js';
import { blackboardLink, courseLink, linkKind } from './links.js';
import { firstSeen } from './seen.js';
import { shapeMessages, shapeThreads } from './messages.js';
import { quickStatus } from './session-status.js';
import { MESSAGES_OFF, settle } from './read-state.js';

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
let stopRenewal; // aborts the hidden window, for 退出登录

/**
 * When the session has lapsed, signs in again in the background using the
 * school login saved in the pop-up browser's profile. Returns true on success.
 */
export async function renewSilently() {
  if (!hasProfile()) return false;
  const baseUrl = await savedBaseUrl();
  if (!baseUrl) return false;
  if (!renewing) {
    const ctl = new AbortController();
    stopRenewal = () => ctl.abort();
    renewing = connectWithBrowser(baseUrl, () => {}, { silent: true, signal: ctl.signal })
      .then(() => true)
      .catch(() => false)
      .finally(() => { renewing = undefined; stopRenewal = undefined; });
  }
  return renewing;
}

/**
 * 退出登录: forgets the Blackboard login on this computer. Deletes the saved
 * session (cookies, via the library's logout, which only removes the local
 * file) and the pop-up browser's own profile folder, which holds the school's
 * sign-in. Keeps the school address, the checklist, settings and downloads.
 * Nothing is sent to Blackboard.
 */
export async function signOut() {
  stopRenewal?.();
  await renewing;
  resetClient();
  const { logout } = await loadLibrary();
  await logout(false);
  // The browser may hold its files for a moment after closing.
  rmSync(profileDir(), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
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
export async function connectWithBrowser(url, onStatus, { silent = false, signal } = {}) {
  const { login, normaliseBaseUrl } = await loadLibrary();
  const baseUrl = normaliseBaseUrl(url);
  const result = await captureSession({
    baseUrl,
    onStatus,
    silent,
    signal,
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

/**
 * Whether the session is live. Never waits for silent renewal: when the
 * session has lapsed it starts renewing in the background and answers
 * { signedIn: false, renewing: true }, so the page can say what is going on.
 */
export const status = quickStatus({
  async check() {
    const c = await client();
    // whoami() is cached, so ask Blackboard directly whether the session is live.
    const seconds = await c.sessionSecondsRemaining();
    if (seconds <= 0) throw Object.assign(new Error('登录已过期'), { code: 'SESSION_EXPIRED' });
    const user = await c.whoami();
    const { displayName } = await loadLibrary();
    return { name: displayName(user), secondsLeft: seconds, baseUrl: c.config?.baseUrl };
  },
  canRenew: async () => hasProfile() && Boolean(await savedBaseUrl()),
  renew: renewSilently,
  reset: resetClient,
});

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

const ASSESSMENT = 'resource/x-bb-asmt-test-link';
const CONTENT_MS = 6 * 60 * 60 * 1000;
const contentCache = new Map(); // "courseId|contentId" -> { at, info }

/**
 * When a content item opened: the start of its date-based release rule.
 * Criteria in one rule must all hold and any one rule releases the item, so
 * this is the earliest rule's latest start. A rule without a date means the
 * opening time is unknown.
 */
export function releaseStart(content) {
  const rules = content?.adaptiveReleaseRules?.rules;
  if (!Array.isArray(rules) || !rules.length) return undefined;
  const starts = rules.map((r) => Math.max(...(r.criteria ?? [])
    .filter((x) => !x.negate && x.start && !Number.isNaN(Date.parse(x.start)))
    .map((x) => Date.parse(x.start))));
  if (!starts.every(Number.isFinite)) return undefined;
  return new Date(Math.min(...starts)).toISOString();
}

/** Opening date and page type of the content item behind a deadline; {} if unreadable. */
async function contentInfo(c, courseId, contentId) {
  const key = `${courseId}|${contentId}`;
  const hit = contentCache.get(key);
  if (hit && Date.now() - hit.at < CONTENT_MS) return hit.info;
  const info = await c.getContent(courseId, contentId)
    .then((item) => ({ opened: releaseStart(item), assessment: item.contentHandler === ASSESSMENT }))
    .catch(() => undefined);
  if (info) contentCache.set(key, { at: Date.now(), info });
  return info ?? {};
}

/**
 * The library only checks past-due work for submissions; this checks work
 * handed in before its due date, from the grade records already fetched.
 * A saved draft does not count.
 */
async function handedInEarly(c, t, grades) {
  const g = grades.find((x) => (x.columnId ?? x.column?.id) === t.column?.id);
  if (!g || ![g.lastAttemptId, g.firstAttemptId, g.highestAttemptId].some(Boolean)) return false;
  const { handedIn } = await c.readAttempts(t._courseId, g).catch(() => ({ handedIn: [] }));
  return handedIn.length > 0;
}

const todoKey = (t) => `${t._courseId}|${t.column?.id ?? t.title}`;

/**
 * The term of each course, for 往期课程: { name, start?, end? }. Courses often
 * carry only a termId, so the term list is read once (GET only); when that is
 * not allowed, the page falls back to the term in the course name.
 */
async function termsOf(c, memberships) {
  const needList = memberships.some((m) => m.course?.termId && !m.course?.term);
  const list = needList ? await c.listTerms({ limit: 100 }).catch(() => []) : [];
  const byId = new Map((Array.isArray(list) ? list : []).map((t) => [t.id, t]));
  return (course) => {
    const t = course.term ?? byId.get(course.termId);
    if (!t) return undefined;
    const d = t.availability?.duration;
    const dated = d?.type === 'DateRange' || (d?.start && d?.end);
    return { name: t.name ?? '', start: dated ? d.start : undefined, end: dated ? d.end : undefined };
  };
}

/** Everything the dashboard needs, in one call. */
export async function overview({ days = 30 } = {}) {
  const c = await client();
  const { courseLabel } = await loadLibrary();
  const memberships = await c.listCourses();
  const termOf = await termsOf(c, memberships);
  const courses = memberships
    .filter((m) => m.course)
    .map((m) => ({
      id: m.course.id,
      code: m.course.courseId ?? m.course.displayId ?? '',
      name: courseLabel(m.course),
      open: m.course.isClosed !== true && m.course.isAvailable !== false,
      term: termOf(m.course),
    }));
  const names = new Map(courses.map((x) => [x.id, x.name]));
  const open = courses.filter((x) => x.open);

  const now = Date.now();
  // A read that fails is marked as failed, never passed off as an empty list.
  const [todoRead, annReads, gradeReads] = await Promise.all([
    settle(c.listTodo({ since: new Date(now - 14 * DAY).toISOString(), until: new Date(now + days * DAY).toISOString() })),
    Promise.all(open.map((x) => settle(c.listCourseAnnouncements(x.id, { limit: 10 })))),
    Promise.all(open.map((x) => settle(c.listGrades(x.id)))),
  ]);
  const valueOf = (r) => (r.ok ? r.value : []);
  const todo = valueOf(todoRead);
  const announcements = annReads.map(valueOf);
  const grades = gradeReads.map(valueOf);

  const base = await savedBaseUrl();
  const gradesOf = new Map(open.map((x, i) => [x.id, grades[i]]));
  const dated = todo.filter((t) => t.dueDate);
  const seen = firstSeen(dated.map(todoKey));
  const items = await Promise.all(dated.map(async (t) => {
    const contentId = t.column?.contentId;
    const info = contentId ? await contentInfo(c, t._courseId, contentId) : {};
    const submitted = t._bucket === 'submitted'
      || (t._bucket === 'upcoming' && (await handedInEarly(c, t, gradesOf.get(t._courseId) ?? [])));
    return {
      key: todoKey(t),
      title: t.title ?? t.column?.effectiveColumnName ?? '未命名',
      course: names.get(t._courseId) ?? '',
      courseId: t._courseId,
      due: t.dueDate,
      submitted,
      opened: info.opened ?? seen[todoKey(t)],
      link: blackboardLink(base, { courseId: t._courseId, contentId, assessment: info.assessment }),
      linkKind: linkKind({ contentId, assessment: info.assessment }),
    };
  }));

  return {
    generatedAt: new Date().toISOString(),
    failed: {
      todo: !todoRead.ok,
      announcements: annReads.filter((r) => !r.ok).length,
      grades: gradeReads.filter((r) => !r.ok).length,
    },
    courses: courses.map((x) => ({ ...x, link: courseLink(base, x.id), linkKind: 'course' })),
    todo: items.sort((a, b) => a.due.localeCompare(b.due)),
    announcements: announcements
      .flat()
      .filter((a) => !a.isDraft)
      .map((a) => ({
        title: a.title ?? '',
        course: a._courseName ?? names.get(a.courseId) ?? '',
        courseId: a.courseId,
        link: courseLink(base, a.courseId),
        linkKind: 'course',
        date: a.startDateRestriction ?? a.createdDate,
        body: text(a.body).slice(0, 2000),
      }))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 30),
    grades: open.map((x, i) => ({
      courseId: x.id,
      course: x.name,
      link: courseLink(base, x.id),
      linkKind: 'course',
      failed: !gradeReads[i].ok,
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

/**
 * Message threads in every open course, newest first. Read-only: listing and
 * reading use GET requests; the library's markMessageRead is never called.
 * Courses with messages turned off or forbidden are skipped quietly; other
 * failures are counted in `failed`, so the page does not call them empty.
 */
export async function messageThreads() {
  const c = await client();
  const { courseLabel, htmlToText } = await loadLibrary();
  const open = (await c.listCourses())
    .filter((m) => m.course && m.course.isClosed !== true && m.course.isAvailable !== false)
    .map((m) => ({ courseId: m.course.id, course: courseLabel(m.course) }));
  const [selfId, baseUrl] = await Promise.all([c.selfId(), savedBaseUrl()]);
  const reads = await Promise.all(open.map((x) => settle(c.listConversations(x.courseId, { limit: 100 }), MESSAGES_OFF)));
  const perCourse = open.map((x, i) => ({ ...x, threads: reads[i].ok ? reads[i].value : [] }));
  return {
    ...shapeThreads(perCourse, { selfId, toText: htmlToText, baseUrl }),
    skipped: reads.filter((r) => r.quiet).length,
    failed: reads.filter((r) => !r.ok && !r.quiet).length,
  };
}

/** All messages in one thread, oldest first. */
export async function messageThread(courseId, threadId) {
  const c = await client();
  const { htmlToText } = await loadLibrary();
  const rows = await c.listConversationMessages(courseId, threadId, { limit: 200 });
  return { messages: shapeMessages(rows, { selfId: await c.selfId(), toText: htmlToText }) };
}

/** Google documents are saved as PDF: it opens anywhere and its text can be exported. */
function exportFormat(doc) {
  return doc.formats.includes('pdf') ? 'pdf' : doc.formats[0];
}

/**
 * Every stored file in one course, plus the public Google documents it links
 * to. Files attached through the attachments API or embedded in page bodies
 * are not listed yet.
 */
export async function courseFiles(courseId) {
  const c = await client();
  const { fileDetailOf, linkTargetOf, recogniseExternalDocument, externalFileName } = await loadLibrary();
  const [course, nodes] = await Promise.all([
    c.courseName(courseId),
    c.walkContents(courseId, { maxNodes: 600 }),
  ]);
  const files = [];
  for (const node of nodes) {
    const folders = folderParts(node._path);
    const detail = fileDetailOf(node);
    if (detail?.fileName && (detail.permanentUrl || detail.viewerUrl)) {
      files.push({ id: node.id, name: detail.fileName, folders, size: detail.fileSize, detail });
      continue;
    }
    const link = linkTargetOf(node.contentHandler, node.contentDetail);
    const doc = link ? recogniseExternalDocument(link) : null;
    if (doc) {
      files.push({ id: node.id, name: externalFileName(node.title, doc, exportFormat(doc)), folders, external: true, doc });
    }
  }
  return { course, files };
}

/** Fetches one listed file to `path`. Google documents are fetched without any cookies. */
async function downloadFile(file, path) {
  const c = await client();
  const lib = await loadLibrary();
  const maxBytes = c.config.maxDownloadBytes;
  if (file.external) {
    const got = await lib.fetchExternalDocument(file.doc, { format: exportFormat(file.doc), maxBytes });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, got.data);
    return { path, cached: false };
  }
  const dl = await lib.downloadToDisk(c.http, lib.rawFileUrl(file.detail), {
    dir: dirname(path),
    fileName: basename(path),
    maxBytes,
    expectedBytes: file.size,
    reuseExisting: true,
  });
  return { path: dl.path, cached: dl.cached };
}

/**
 * Saves `<file>.txt` with the text of a PDF, Word or PowerPoint file, for
 * pasting into an AI tool. Keeps an existing one unless the file is new.
 * Returns false for other types and for PDFs with no text layer (scans).
 */
async function writeTextExport(path, overwrite) {
  const txt = `${path}.txt`;
  if (!overwrite && existsSync(txt)) return true;
  let text = officeText(readFileSync(path), path);
  if (text == null) {
    if (extname(path).toLowerCase() !== '.pdf') return false;
    const { extractText } = await loadLibrary();
    text = (await extractText(path, { maxPages: 5000, maxChars: 20_000_000 })).text;
  }
  if (!text?.trim()) return false;
  writeFileSync(txt, text);
  return true;
}

/** Turns a library error into a reason a student can act on. */
function reason(err, file) {
  const big = /is ([\d.]+ [KMG]?B), above the ([\d.]+ [KMG]?B) limit/.exec(err.message);
  if (big) return `文件太大（${big[1]}），超过了单个文件 ${big[2]} 的上限。`;
  if (/above the limit/.test(err.message)) return '文件太大，超过了单个文件的大小上限。';
  if (err.code === 'FORBIDDEN' && file.external) return '这个 Google 文档没有公开分享，需要登录 Google 才能打开，请在浏览器里手动下载。';
  if (err.code === 'FORBIDDEN') return '没有权限下载这个文件。';
  if (err.code === 'NOT_FOUND') return 'Blackboard 上已经找不到这个文件了。';
  if (err.code === 'NETWORK') return '网络连接失败或超时，请稍后重试。';
  if (err.code === 'RATE_LIMITED') return '学校服务器暂时限制了访问频率，请过几分钟再试。';
  if (EXPIRED.has(err.code)) return '登录已过期，请重新登录后再下载。';
  return err.message;
}

/**
 * Downloads planned files one at a time, so the school's server is not
 * flooded. `plan` is [{ file, path }] from courseFiles + targetPath. If the
 * session lapses mid-run it renews silently once, then carries on.
 */
export async function downloadAll(plan, { exportText = false, onProgress = () => {}, shouldStop = () => false } = {}) {
  const result = { downloaded: 0, skipped: 0, failed: [], noText: [], stopped: false };
  let renewed = false;
  for (let i = 0; i < plan.length; i += 1) {
    if (shouldStop()) {
      result.stopped = true;
      break;
    }
    const { file, path } = plan[i];
    onProgress({ index: i + 1, total: plan.length, name: file.name });
    try {
      let saved = path;
      let fresh = false;
      if (alreadyThere(path, file.size)) {
        result.skipped += 1;
      } else {
        const dl = await downloadFile(file, path);
        saved = dl.path;
        fresh = !dl.cached;
        result[fresh ? 'downloaded' : 'skipped'] += 1;
      }
      if (exportText && /\.(pdf|docx|pptx)$/i.test(saved)) {
        const ok = await writeTextExport(saved, fresh).catch(() => false);
        if (!ok) result.noText.push(file.name);
      }
    } catch (err) {
      if (EXPIRED.has(err.code) && !renewed) {
        renewed = true;
        resetClient();
        if (await renewSilently()) {
          i -= 1;
          continue;
        }
      }
      result.failed.push({ name: file.name, reason: reason(err, file) });
      if (EXPIRED.has(err.code)) break;
    }
  }
  return result;
}
