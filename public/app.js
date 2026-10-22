import { DEFAULTS, STATUSES, durations, statusLabel, statusOf, timeLeft } from './status.js';

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

const fmt = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), data);
  return data;
}

function showBanner(text) {
  $('banner').textContent = text;
  $('banner').hidden = !text;
}

// ---- 截止日期 ----

let todoItems = [];
let timeline = { ...DEFAULTS }; // how long counts as "new" and "due soon"

function renderTodo(todo = todoItems) {
  todoItems = todo;
  const box = $('todo');
  box.replaceChildren();
  if (!todo.length) return box.append(el('p', { class: 'muted' }, '近期没有截止事项。'));
  const now = Date.now();
  const withStatus = todo.map((t) => ({ ...t, status: statusOf(t, now, timeline) }));
  for (const key of STATUSES) {
    const items = withStatus.filter((t) => t.status === key);
    if (!items.length) continue;
    box.append(el('div', { class: `group st-${key}` },
      el('h3', {}, el('span', { class: 'dot' }), `${statusLabel(key, timeline)}（${items.length}）`),
      items.map((t) => el('div', { class: 'item' },
        el('div', { class: 'title' }, /^https:\/\//.test(t.link ?? '')
          ? el('a', { href: t.link, target: '_blank', rel: 'noopener noreferrer', title: '在 Blackboard 里打开' }, t.title)
          : t.title),
        el('div', { class: 'meta' }, `${t.course} · ${fmt.format(new Date(t.due))} · ${timeLeft(t, now)}`),
      )),
    ));
  }
}

function showTimeline() {
  $('newRange').value = timeline.newHours || 5; // the far right end of the slider means "today"
  $('soonRange').value = timeline.dueSoonHours;
  $('newLabel').textContent = timeline.newHours ? `${timeline.newHours} 小时` : '当天';
  $('soonLabel').textContent = `${timeline.dueSoonHours} 小时`;
}

function readTimeline() {
  const v = Number($('newRange').value);
  timeline = { newHours: v <= 5 ? 0 : v, dueSoonHours: Number($('soonRange').value) };
  showTimeline();
  renderTodo();
}

async function saveTimeline() {
  try {
    timeline = await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(timeline),
    });
    $('tlMsg').textContent = settings.demo ? '示例模式：只在这次运行时有效。' : '已保存，下次打开还在。';
  } catch (err) {
    $('tlMsg').textContent = `没有保存：${err.message}`;
  }
}

for (const id of ['newRange', 'soonRange']) {
  $(id).addEventListener('input', readTimeline);
  $(id).addEventListener('change', saveTimeline);
}

$('resetTimeline').addEventListener('click', () => {
  timeline = { ...DEFAULTS };
  showTimeline();
  renderTodo();
  saveTimeline();
});

// Keep the colours and "还剩…" labels current while the page stays open.
setInterval(() => { if (todoItems.length) renderTodo(); }, 60_000);

function renderAnnouncements(list) {
  const box = $('announcements');
  box.replaceChildren();
  if (!list.length) return box.append(el('p', { class: 'muted' }, '没有公告。'));
  for (const a of list.slice(0, 12)) {
    box.append(el('div', { class: 'item' },
      el('details', {},
        el('summary', {}, el('span', { class: 'title' }, a.title)),
        el('div', { class: 'body' }, a.body || '（无正文）'),
      ),
      el('div', { class: 'meta' }, `${a.course}${a.date ? ` · ${fmt.format(new Date(a.date))}` : ''}`),
    ));
  }
}

function renderGrades(courses) {
  const box = $('grades');
  box.replaceChildren();
  const withItems = courses.filter((c) => c.items.length);
  if (!withItems.length) return box.append(el('p', { class: 'muted' }, '还没有成绩。'));
  for (const c of withItems) {
    box.append(el('div', { class: 'group' },
      el('h3', {}, c.course),
      el('table', {},
        el('tr', {}, el('th', {}, '项目'), el('th', {}, '分数'), el('th', {}, '百分比')),
        c.items.map((g) => el('tr', {},
          el('td', {}, g.name),
          el('td', {}, g.text),
          el('td', {}, g.pct == null ? '—' : [el('span', { class: 'bar' }, el('i', { style: `width:${Math.min(100, g.pct)}%` })), `${g.pct}%`]),
        )),
      ),
    ));
  }
}

// ---- 课程文件 ----

function fmtSize(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

const filesByCourse = new Map(); // courseId -> listed files
const selected = new Set(); // "courseId|fileId"
let refreshFiles = false;

function syncCourseBox(courseId) {
  const box = document.querySelector(`input[data-course="${courseId}"]`);
  const files = filesByCourse.get(courseId);
  if (!box || !files?.length) return;
  const n = files.filter((f) => selected.has(`${courseId}|${f.id}`)).length;
  box.checked = n === files.length;
  box.indeterminate = n > 0 && n < files.length;
}

function updateSelectionUi() {
  for (const id of filesByCourse.keys()) syncCourseBox(id);
  $('startDownload').textContent = selected.size ? `下载选中的文件（${selected.size} 个）` : '下载选中的文件';
}

async function loadCourseFiles(course, body) {
  if (filesByCourse.has(course.id)) return filesByCourse.get(course.id);
  body.replaceChildren(el('p', { class: 'muted small' }, '正在读取这门课的文件…（文件多的课程可能要几十秒）'));
  try {
    const data = await api(`/api/courses/${course.id}/files${refreshFiles ? '?refresh' : ''}`);
    filesByCourse.set(course.id, data.files);
    renderFileTable(course, body, data.files);
    return data.files;
  } catch (err) {
    body.replaceChildren(el('p', { class: 'fail small' }, `读取失败：${err.message}`));
    return [];
  }
}

function renderFileTable(course, body, files) {
  const meta = document.querySelector(`[data-meta="${course.id}"]`);
  const done = files.filter((f) => f.downloaded).length;
  if (meta) meta.textContent = `${files.length} 个文件${done ? `，已下载 ${done} 个` : ''}`;
  if (!files.length) return body.replaceChildren(el('p', { class: 'muted small' }, '这门课里没有找到可以下载的文件。'));
  body.replaceChildren(el('table', { class: 'files' },
    el('tr', {}, el('th', {}, ''), el('th', {}, '文件'), el('th', { class: 'size' }, '大小')),
    files.map((f) => {
      const key = `${course.id}|${f.id}`;
      const box = el('input', { type: 'checkbox' });
      box.checked = selected.has(key);
      box.addEventListener('change', () => {
        if (box.checked) selected.add(key); else selected.delete(key);
        updateSelectionUi();
      });
      return el('tr', {},
        el('td', {}, box),
        el('td', {},
          f.name,
          f.external ? el('span', { class: 'tag ext' }, '外部文档') : null,
          f.downloaded ? el('span', { class: 'tag done' }, '已下载') : null,
          f.folder ? el('div', { class: 'where' }, f.folder) : null,
        ),
        el('td', { class: 'size' }, fmtSize(f.size)),
      );
    }),
  ));
  syncCourseBox(course.id);
}

function renderCourseFiles(courses, refresh) {
  refreshFiles = refresh;
  filesByCourse.clear();
  selected.clear();
  $('selectAll').checked = false;
  const box = $('courseFiles');
  box.replaceChildren();
  if (!courses.length) return box.append(el('p', { class: 'muted' }, '没有课程。'));
  for (const course of courses) {
    const check = el('input', { type: 'checkbox', 'data-course': course.id, title: '选中这门课的全部文件' });
    const body = el('div', {});
    const details = el('details', { class: 'course' },
      el('summary', {}, check, course.name, course.open ? null : el('span', { class: 'tag' }, '已结课'),
        el('span', { class: 'meta', 'data-meta': course.id }, '点击展开')),
      body,
    );
    // A click on the checkbox should not also fold the course open or shut.
    check.addEventListener('click', (e) => e.stopPropagation());
    check.addEventListener('change', async () => {
      const want = check.checked;
      details.open = true;
      const files = await loadCourseFiles(course, body);
      for (const f of files) {
        if (want) selected.add(`${course.id}|${f.id}`); else selected.delete(`${course.id}|${f.id}`);
      }
      renderFileTable(course, body, files);
      updateSelectionUi();
    });
    details.addEventListener('toggle', () => { if (details.open) loadCourseFiles(course, body); });
    box.append(details);
  }
  updateSelectionUi();
}

$('selectAll').addEventListener('change', () => {
  for (const [courseId, files] of filesByCourse) {
    for (const f of files) {
      if ($('selectAll').checked) selected.add(`${courseId}|${f.id}`); else selected.delete(`${courseId}|${f.id}`);
    }
  }
  for (const details of document.querySelectorAll('#courseFiles details')) {
    const id = details.querySelector('input[data-course]').dataset.course;
    if (filesByCourse.has(id)) for (const b of details.querySelectorAll('.files input')) b.checked = $('selectAll').checked;
  }
  updateSelectionUi();
});

let settings = {};

async function loadSettings() {
  settings = await api('/api/settings').catch(() => ({}));
  timeline = durations(settings);
  showTimeline();
  if (todoItems.length) renderTodo();
  $('downloadDir').value = settings.downloadDir ?? '';
  $('pickDir').hidden = !settings.canPick;
  $('downloadDir').readOnly = Boolean(settings.demo);
  if (settings.demo) $('dirMsg').textContent = '示例模式：不会真的保存文件。';
}

$('downloadDir').addEventListener('input', () => {
  $('saveDir').hidden = settings.demo || $('downloadDir').value.trim() === (settings.downloadDir ?? '');
});

$('saveDir').addEventListener('click', async () => {
  try {
    settings = { ...settings, ...(await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadDir: $('downloadDir').value }),
    })) };
    $('downloadDir').value = settings.downloadDir;
    $('saveDir').hidden = true;
    $('dirMsg').textContent = '已保存，下次打开会记住。';
    resetDownloadedMarks();
  } catch (err) {
    $('dirMsg').textContent = err.message;
  }
});

$('pickDir').addEventListener('click', async () => {
  $('pickDir').disabled = true;
  $('dirMsg').textContent = '已经打开选择文件夹的窗口（如果没看到，看看任务栏）…';
  try {
    const r = await api('/api/pick-folder', { method: 'POST' });
    if (r.downloadDir) {
      settings = { ...settings, ...r };
      $('downloadDir').value = r.downloadDir;
      $('saveDir').hidden = true;
      $('dirMsg').textContent = '已选择，下次打开会记住。';
      resetDownloadedMarks();
    } else {
      $('dirMsg').textContent = '没有选择文件夹。';
    }
  } catch (err) {
    $('dirMsg').textContent = err.message;
  } finally {
    $('pickDir').disabled = false;
  }
});

/** The 已下载 marks depend on the folder, so re-read the courses already open. */
function resetDownloadedMarks() {
  for (const details of document.querySelectorAll('#courseFiles details')) {
    const id = details.querySelector('input[data-course]').dataset.course;
    if (!filesByCourse.has(id)) continue;
    filesByCourse.delete(id);
    const course = { id, name: '' };
    if (details.open) loadCourseFiles(course, details.querySelector(':scope > div'));
  }
}

function showResult(job) {
  const r = job.result;
  const box = $('dlResult');
  if (job.state === 'error') return box.replaceChildren(el('p', { class: 'fail' }, `下载出错：${job.message}`));
  const failed = r.failed.length;
  box.replaceChildren(...[
    el('p', {}, `${r.stopped ? '已停止。' : '完成。'}新下载 ${r.downloaded} 个，跳过 ${r.skipped} 个（已存在），失败 ${failed} 个。`),
    failed ? el('ul', { class: 'small' }, r.failed.map((f) => el('li', {}, el('b', {}, f.name), '：', el('span', { class: 'fail' }, f.reason)))) : null,
    r.noText?.length ? el('p', { class: 'muted small' }, `这些文件没能导出文字版（可能是扫描版 PDF，没有文字层）：${r.noText.join('、')}`) : null,
  ].filter(Boolean));
}

$('startDownload').addEventListener('click', async () => {
  if (!selected.size) return ($('dlProgress').textContent = '请先展开课程，勾选要下载的文件。');
  if (!settings.demo && !settings.downloadDir) return ($('dlProgress').textContent = '请先选择保存位置。');
  const items = [...selected].map((k) => { const [courseId, id] = k.split('|'); return { courseId, id }; });
  $('startDownload').disabled = true;
  $('stopDownload').hidden = false;
  $('stopDownload').disabled = false;
  $('openFolder').hidden = true;
  $('dlResult').replaceChildren();
  try {
    let job = await api('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, exportText: $('exportText').checked }),
    });
    while (job.state === 'running') {
      $('dlProgress').textContent = job.index ? `正在下载第 ${job.index} / ${job.total} 个：${job.name}` : '正在准备…';
      await sleep(1000);
      job = await api('/api/download');
    }
    $('dlProgress').textContent = '';
    showResult(job);
    $('openFolder').hidden = Boolean(settings.demo) || job.state !== 'done';
    if (!settings.demo) resetDownloadedMarks();
  } catch (err) {
    $('dlProgress').textContent = `下载没有开始：${err.message}`;
  } finally {
    $('startDownload').disabled = false;
    $('stopDownload').hidden = true;
  }
});

$('stopDownload').addEventListener('click', async () => {
  $('stopDownload').disabled = true;
  $('dlProgress').textContent = '正在停止（当前这个文件下载完就停）…';
  await api('/api/download/stop', { method: 'POST' }).catch(() => {});
});

$('openFolder').addEventListener('click', () => {
  api('/api/open-folder', { method: 'POST' }).catch((err) => { $('dlProgress').textContent = err.message; });
});

async function load(refresh = false) {
  $('refresh').disabled = true;
  try {
    const status = await api('/api/status');
    if (!status.signedIn) {
      $('who').textContent = '未登录，或登录已过期';
      $('login').hidden = false;
      $('main').hidden = true;
      showBanner('');
      return;
    }
    $('login').hidden = true;
    const mins = status.secondsLeft ? Math.round(status.secondsLeft / 60) : null;
    $('who').textContent = `${status.name}${status.demo ? '（示例数据）' : ''}${mins ? ` · 登录还剩约 ${mins} 分钟` : ''}`;
    $('main').hidden = false;
    showBanner('正在读取 Blackboard 数据…');
    const data = await api(`/api/overview${refresh ? '?refresh' : ''}`);
    renderTodo(data.todo);
    renderAnnouncements(data.announcements);
    renderGrades(data.grades);
    renderCourseFiles(data.courses, refresh);
    showBanner('');
  } catch (err) {
    if (err.code === 'NOT_AUTHENTICATED' || err.code === 'SESSION_EXPIRED' || err.code === 'NOT_CONFIGURED') {
      $('login').hidden = false;
      $('main').hidden = true;
      showBanner('登录已过期，请重新登录。');
    } else {
      showBanner(`出错了：${err.message}`);
    }
  } finally {
    $('refresh').disabled = false;
  }
}

$('refresh').addEventListener('click', () => load(true));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

$('connect').addEventListener('click', async () => {
  const url = $('baseUrl').value.trim();
  if (!url) return ($('connectMsg').textContent = '请先填写学校的 Blackboard 网址。');
  $('connect').disabled = true;
  try {
    let job = await api('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    while (job.state === 'running') {
      $('connectMsg').textContent = job.message;
      await sleep(1000);
      job = await api('/api/connect');
    }
    $('connectMsg').textContent = job.state === 'done' ? job.message : `没有连接成功：${job.message}`;
    if (job.state === 'done') await load(true);
  } catch (err) {
    $('connectMsg').textContent = `没有连接成功：${err.message}`;
  } finally {
    $('connect').disabled = false;
  }
});

$('doLogin').addEventListener('click', async () => {
  const curl = $('curl').value.trim();
  if (!curl) return ($('loginMsg').textContent = '请先粘贴内容。');
  $('doLogin').disabled = true;
  $('loginMsg').textContent = '正在验证…';
  try {
    const s = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ curl, url: $('baseUrl').value.trim() || undefined }),
    });
    $('curl').value = '';
    $('loginMsg').textContent = `登录成功：${s.name}`;
    await load(true);
  } catch (err) {
    $('loginMsg').textContent = `登录失败：${err.message}${err.hint ? `（${err.hint}）` : ''}`;
  } finally {
    $('doLogin').disabled = false;
  }
});

api('/api/config').then((c) => { if (c.baseUrl && !$('baseUrl').value) $('baseUrl').value = c.baseUrl; }).catch(() => {});
loadSettings();
load();
