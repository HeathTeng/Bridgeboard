import { DEFAULTS, STATUSES, durations, pillText, statusLabel, statusOf, timeLeft } from './status.js';
import { assignmentRows, sortRows } from './checklist-rows.js';
import { courseOptions, filterThreads, relativeTime } from './message-view.js';
import { activeCourseIds, pastCourseIds, splitByTerm } from './terms.js';
import {
  LOADING, NOTHING_TODAY, SIGNED_OUT, announcementsSummary, checklistSummary, deadlinesSummary, filesSummary, gradesSummary,
  messagesSummary, todayChips,
} from './section-summary.js';
import { initPush, reloadPush, setDueSoonHours } from './push.js';
import { initKeepOpen } from './keep-open.js';
import { $, SERVER_LOST, actionLine, api, el, fmt, friendlyText, isSignedOutError, sleep, watchServer } from './ui.js';
import {
  buildNav, clearError, courseEl, courseText, flagError, glossed, goToSection, initDisplayPanel, initFeedback, initToTop, onDisplayChange, pastFold,
  scrollToHash, setCount, setCourseNames, setDisplay, setSignedIn, setSummary,
} from './layout.js';

// ---- 往期课程 ----

let overviewData = null; // the last /api/overview, for redrawing when messages arrive
let past = new Set(); // ids of courses from an earlier term

/**
 * Works out which courses belong to an earlier term. Courses that still
 * need the student stay up top. Returns whether the answer changed.
 */
function updatePast() {
  if (!overviewData) return false;
  const active = activeCourseIds({ todo: overviewData.todo, threads: messageData?.threads ?? [], grades: overviewData.grades });
  const next = pastCourseIds(overviewData.courses, { active });
  const changed = [...next].sort().join() !== [...past].sort().join();
  past = next;
  return changed;
}

const courseCount = (list, idOf) => new Set(list.map(idOf)).size;

/** The banner under the header, optionally with buttons for the next step. */
function showBanner(text, actions = []) {
  $('banner').replaceChildren(...(text ? actionLine(text, actions, 'banner-line').childNodes : []));
  $('banner').hidden = !text;
}

/** Puts an error line with buttons into an element that is itself a <p>. */
function fillAction(target, text, actions) {
  target.replaceChildren(...actionLine(text, actions).childNodes);
}

function showLogin() {
  $('login').hidden = false;
  $('login').scrollIntoView({ block: 'start' });
  $('baseUrl').focus({ preventScroll: true });
}
const reconnect = { label: '重新连接', onClick: showLogin };

// ---- 截止日期 ----

let todoItems = [];
let timeline = { ...DEFAULTS }; // how long counts as "new" and "due soon"

const TODO_FIRST = 4; // the most urgent items shown before 再显示 N 项
let todoAll = false; // 再显示 N 项 pressed; not remembered

/** 今天要注意: up to three chips that jump to their section. */
function renderToday(rows, now) {
  $('today').hidden = !signedIn || !todoLoaded;
  if ($('today').hidden) return;
  const chips = todayChips({ rows, threads: messageData?.threads ?? [], now, courseName: courseText });
  $('todayChips').replaceChildren(...(chips.length
    ? chips.map((c) => {
      const b = el('button', { type: 'button', class: `today-chip st-${c.status}` }, c.text);
      b.addEventListener('click', () => goToSection(c.section));
      return b;
    })
    : [el('p', { class: 'muted today-none' }, NOTHING_TODAY)]));
}

function renderTodo(todo = todoItems) {
  todoItems = todo;
  const box = $('todo');
  box.replaceChildren();
  const now = Date.now();
  const withStatus = todo.map((t) => ({ ...t, status: statusOf(t, now, timeline) }));
  const urgent = withStatus.filter((t) => t.status === 'overdue' || t.status === 'dueSoon').length;
  setCount('deadlines', urgent, '已逾期和临期的作业');
  if (signedIn && todoLoaded) setSummary('deadlines', deadlinesSummary(withStatus, now));
  renderToday(withStatus, now);
  if (!todoLoaded) return;
  if (!todo.length) return box.append(el('p', { class: 'muted' }, '近期没有截止事项 🎉 新作业出现后会显示在这里。'));
  // Most urgent first: by colour, then by due time (the list comes sorted by due time).
  const ordered = STATUSES.flatMap((key) => withStatus.filter((t) => t.status === key));
  const shown = todoAll ? ordered : ordered.slice(0, TODO_FIRST);
  for (const key of STATUSES) {
    const items = shown.filter((t) => t.status === key);
    if (!items.length) continue;
    box.append(el('div', { class: `group st-${key}` },
      el('h3', {}, el('span', { class: 'dot', 'aria-hidden': 'true' }), statusLabel(key, timeline),
        el('span', { class: 'count' }, String(ordered.filter((t) => t.status === key).length))),
      items.map((t) => el('div', { class: 'item dl-row' },
        el('div', { class: 'dl-body' },
          el('div', { class: 'title' }, /^https:\/\//.test(t.link ?? '')
            ? el('a', { href: t.link, target: '_blank', rel: 'noopener noreferrer', title: '在 Blackboard 里打开' }, glossed(t.title))
            : glossed(t.title)),
          el('div', { class: 'meta' }, courseEl(t.course), ` · ${fmt.format(new Date(t.due))}`)),
        el('span', { class: 'pill', title: timeLeft(t, now) }, pillText(t, key, now)),
      )),
    ));
  }
  if (ordered.length > TODO_FIRST) {
    const rest = ordered.slice(TODO_FIRST);
    const label = todoAll
      ? `只显示最紧要的 ${TODO_FIRST} 项`
      : `再显示 ${rest.length} 项${rest.some((t) => t.status === 'done') ? '（含已完成）' : ''}`;
    const more = el('button', { type: 'button', class: 'show-all' }, label);
    more.addEventListener('click', () => {
      todoAll = !todoAll;
      renderTodo();
    });
    box.append(more);
  }
}

function showTimeline() {
  $('newRange').value = timeline.newHours || 5; // the far right end of the slider means "today"
  $('soonRange').value = timeline.dueSoonHours;
  $('newLabel').textContent = timeline.newHours ? `${timeline.newHours} 小时` : '当天';
  $('soonLabel').textContent = `${timeline.dueSoonHours} 小时`;
  setDueSoonHours(timeline.dueSoonHours);
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
setInterval(() => {
  if (todoItems.length) renderTodo();
  renderAssignments();
  // Not while the student is typing in their own list.
  if (!document.activeElement?.closest('#clOwn, #clOwnDone')) renderOwn();
  for (const s of document.querySelectorAll('.rel-time')) s.textContent = relativeTime(s.dataset.time || null);
}, 60_000);

// ---- 课程消息 ----

let messageData = null; // { threads, unread }
const msgFilter = { unreadOnly: false, courseId: '' };
const threadCache = new Map(); // "courseId|threadId" -> messages, fetched when first opened
const openThreads = new Set();
const LONG_LINES = 6;
const LONG_CHARS = 400;

const note = (text) => el('p', { class: 'muted small' }, text);

function timeSpan(iso) {
  return el('span', { class: 'rel-time', 'data-time': iso ?? '', title: iso ? fmt.format(new Date(iso)) : '' }, relativeTime(iso));
}

function renderMessages() {
  const box = $('msgList');
  const unread = signedIn ? messageData?.unread ?? 0 : 0;
  setCount('messages', unread, '未读消息');
  $('msgControls').hidden = !signedIn || !messageData?.threads.length;
  if (!signedIn) {
    setSummary('messages', SIGNED_OUT);
    return box.replaceChildren(note('重新连接 Blackboard 后会显示消息。'));
  }
  if (!messageData) {
    setSummary('messages', LOADING);
    return box.replaceChildren(note('正在读取消息…'));
  }
  const { threads } = messageData;
  setSummary('messages', messagesSummary(threads));
  if (todoLoaded) renderTodo(); // 今天要注意 counts unread messages
  if (!threads.length) return box.replaceChildren(note('还没有课程消息。老师或同学在 Blackboard 里给你发消息后，会出现在这里。'));

  // Earlier terms go into their own group at the end of the dropdown.
  const options = splitByTerm(courseOptions(threads), past);
  const option = (c) => el('option', { value: c.id, title: c.name }, courseText(c.name));
  if (![...options.current, ...options.earlier].some((c) => c.id === msgFilter.courseId)) msgFilter.courseId = '';
  $('msgCourse').replaceChildren(el('option', { value: '' }, '全部课程'), ...options.current.map(option),
    ...(options.earlier.length ? [el('optgroup', { label: '往期课程' }, options.earlier.map(option))] : []));
  $('msgCourse').value = msgFilter.courseId;
  for (const b of document.querySelectorAll('#msgControls .chip')) {
    b.setAttribute('aria-pressed', String((b.dataset.filter === 'unread') === msgFilter.unreadOnly));
  }
  const shown = filterThreads(threads, msgFilter);
  if (!shown.length) return box.replaceChildren(note(msgFilter.unreadOnly ? '没有未读消息 🎉' : '这门课还没有消息。'));
  const { current, earlier } = splitByTerm(shown, past, (t) => t.courseId);
  box.replaceChildren(...[
    ...(current.length ? current.map(threadRow) : [note('本学期的课程还没有消息。')]),
    earlier.length ? pastFold('messages', courseCount(earlier, (t) => t.courseId), earlier.map(threadRow)) : null,
  ].filter(Boolean));
}

function threadRow(t) {
  const key = `${t.courseId}|${t.id}`;
  const body = el('div', { class: 'msg-thread' });
  const row = el('details', { class: `msg${t.unread ? ' is-unread' : ''}` },
    el('summary', {},
      el('div', { class: 'msg-top' },
        t.unread ? el('span', { class: 'unread-tag' }, el('span', { class: 'dot' }), `未读 ${t.unread}`) : null,
        el('span', { class: 'msg-with' }, t.with),
        timeSpan(t.time),
        el('span', { class: 'chev' })),
      el('div', { class: 'meta' }, courseEl(t.course), ` · 最新：${t.from || '—'} · 共 ${t.total} 条`),
      el('div', { class: 'msg-preview' }, t.preview)),
    body);
  row.addEventListener('toggle', () => {
    if (row.open) {
      openThreads.add(key);
      showThread(t, body);
    } else {
      openThreads.delete(key);
    }
  });
  if (openThreads.has(key)) row.open = true;
  return row;
}

async function showThread(t, body) {
  const key = `${t.courseId}|${t.id}`;
  if (!threadCache.has(key)) {
    body.replaceChildren(note('正在读取这段对话…'));
    try {
      const data = await api(`/api/messages/${encodeURIComponent(t.courseId)}/${encodeURIComponent(t.id)}`);
      threadCache.set(key, data.messages);
    } catch (err) {
      return body.replaceChildren(actionLine(`这段对话没有读取成功：${err.message}`,
        isSignedOutError(err) ? [reconnect] : [{ label: '重试', onClick: () => showThread(t, body) }]));
    }
  }
  const link = /^https:\/\//.test(t.link ?? '')
    ? el('a', { href: t.link, target: '_blank', rel: 'noopener noreferrer', class: 'button' }, '在 Blackboard 中打开')
    : note('（暂时没有 Blackboard 链接）');
  body.replaceChildren(
    ...threadCache.get(key).map(messageBlock),
    el('div', { class: 'msg-foot' }, link,
      note('要回复，请点「在 Blackboard 中打开」。在这里看过的消息，Blackboard 上仍会显示为未读，直到你在 Blackboard 里打开。')),
  );
}

function messageBlock(m) {
  const long = m.text.split('\n').length > LONG_LINES || [...m.text].length > LONG_CHARS;
  const text = el('div', { class: `msg-text${long ? ' clamped' : ''}` }, m.text || '（没有文字内容）');
  const more = long ? el('button', { type: 'button', class: 'link' }, '展开全文') : null;
  more?.addEventListener('click', () => {
    more.textContent = text.classList.toggle('clamped') ? '展开全文' : '收起';
  });
  return el('div', { class: `msg-item${m.mine ? ' mine' : ''}` },
    el('div', { class: 'msg-head' },
      el('b', {}, m.from || '—'),
      m.time ? fmt.format(new Date(m.time)) : null,
      m.unread ? el('span', { class: 'unread-tag' }, el('span', { class: 'dot' }), '未读') : null),
    text,
    more,
    m.hasMedia ? note('这条消息里有图片或附件，请在 Blackboard 中查看。') : null);
}

async function loadMessages(refresh) {
  if (refresh) threadCache.clear();
  try {
    messageData = await api(`/api/messages${refresh ? '?refresh' : ''}`);
  } catch (err) {
    messageData = null;
    $('msgControls').hidden = true;
    setSummary('messages', '消息没有读取成功，点开看怎么办');
    flagError('messages');
    return $('msgList').replaceChildren(actionLine(`消息没有读取成功：${err.message}`,
      isSignedOutError(err) ? [reconnect] : [{ label: '重试', onClick: () => loadMessages(true) }]));
  }
  clearError('messages');
  // An unread message keeps an earlier term's course up top.
  if (updatePast()) {
    renderGrades(overviewData.grades);
    renderCourseFiles(overviewData.courses, refreshFiles);
  }
  renderMessages();
}

for (const b of document.querySelectorAll('#msgControls .chip')) {
  b.addEventListener('click', () => {
    msgFilter.unreadOnly = b.dataset.filter === 'unread';
    renderMessages();
  });
}
$('msgCourse').addEventListener('change', () => {
  msgFilter.courseId = $('msgCourse').value;
  renderMessages();
});

// ---- 清单 ----

let checklist = { items: [], marks: {} };
let signedIn = false;
let todoLoaded = false;
let pendingRemoval; // a delete waiting out its undo window
const openCounts = { assignments: 0, own: 0 }; // for the nav badge
const totalCounts = { assignments: 0, own: 0 }; // done or not, for the folded line

function updateChecklistCount() {
  const open = openCounts.assignments + openCounts.own;
  setCount('checklist', open, '还没完成的事项');
  setSummary('checklist', checklistSummary(open, totalCounts.assignments + totalCounts.own));
}
const hiddenIds = new Set(); // own items hidden while their delete can still be undone
const doneOpen = {}; // which 已完成 groups the student has opened

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const short = (text) => ([...text].length > 20 ? `${[...text].slice(0, 20).join('')}…` : text);

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);

function flash(text) {
  $('clMsg').textContent = text;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { $('clMsg').textContent = ''; }, 5000);
}

/**
 * Same colour capsule as the deadlines; only for unfinished work with a due date.
 * The checklist has no group headings, so the text keeps 还剩 / 已逾期.
 */
function badge(row, now) {
  if (!row.due || row.done) return null;
  const status = statusOf({ due: row.due, opened: row.opened }, now, timeline);
  return el('span', { class: `pill st-${status}`, title: statusLabel(status, timeline) }, timeLeft({ due: row.due }, now));
}

function roundBox(checked, title, onChange, disabled = false) {
  const box = el('input', { type: 'checkbox', class: 'round', title, 'aria-label': title });
  box.checked = checked;
  box.disabled = disabled;
  box.addEventListener('change', () => onChange(box.checked));
  return box;
}

function doneGroup(key, rows, ...extra) {
  const group = el('details', { class: 'cl-done' }, el('summary', {}, `已完成（${rows.length}）`), rows, extra);
  group.open = Boolean(doneOpen[key]);
  group.addEventListener('toggle', () => { doneOpen[key] = group.open; });
  return group;
}

function assignmentRow(t, now) {
  const byBlackboard = t.done && !t.manual;
  const box = roundBox(
    t.done,
    byBlackboard ? 'Blackboard 显示已提交，这里不能取消' : '只是在这台电脑上做个记号，不会在 Blackboard 上提交',
    (done) => setMark(t, done),
    byBlackboard,
  );
  const title = /^https:\/\//.test(t.link ?? '')
    ? el('a', { href: t.link, target: '_blank', rel: 'noopener noreferrer', title: '在 Blackboard 里打开' }, glossed(t.title))
    : glossed(t.title);
  return el('div', { class: `cl-row${t.done ? ' is-done' : ''}` }, box,
    el('div', { class: 'cl-body' },
      el('div', { class: 'cl-text' }, title),
      el('div', { class: 'meta' }, courseEl(t.course)),
      t.manual ? el('div', { class: 'cl-note' }, '已手动标记完成（不会在 Blackboard 上提交）') : null,
      byBlackboard ? el('div', { class: 'cl-note' }, 'Blackboard 显示已提交') : null,
    ),
    el('div', { class: 'cl-side' }, dueLabel(t.due), badge(t, now)));
}

/** The due time, small and grey at the right of a row; nothing when there is none. */
const dueLabel = (due) => (due ? el('span', { class: 'cl-due' }, fmt.format(new Date(due))) : null);

function renderAssignments() {
  const box = $('clAssignments');
  if (!signedIn) return box.replaceChildren(el('p', { class: 'muted small' }, '重新连接 Blackboard 后会显示作业。'));
  if (!todoLoaded) return box.replaceChildren(el('p', { class: 'muted small' }, '正在读取作业…'));
  const now = Date.now();
  const { open, done } = sortRows(assignmentRows(todoItems, checklist.marks, now), (r) => r.due);
  openCounts.assignments = open.length;
  totalCounts.assignments = open.length + done.length;
  updateChecklistCount();
  box.replaceChildren(...[
    open.length
      ? el('div', {}, open.map((t) => assignmentRow(t, now)))
      : el('p', { class: 'muted small' }, done.length ? '已开放的作业都完成了 🎉' : '目前没有已开放的作业 🎉', el('br'), '还没开放的作业，开放后会自动出现在这里。'),
    done.length ? doneGroup('assignments', done.map((t) => assignmentRow(t, now))) : null,
  ].filter(Boolean));
}

async function setMark(t, done) {
  try {
    await api(`/api/checklist/marks/${encodeURIComponent(t.key)}`, json('PUT', { done }));
    if (done) checklist.marks[t.key] = { at: new Date().toISOString() };
    else delete checklist.marks[t.key];
    flash(done ? '已移到下面的「已完成」。这只是本机记号，不会在 Blackboard 上提交。' : '已取消完成标记。');
  } catch (err) {
    flash(`没有保存：${err.message}`);
  }
  renderAssignments();
}

function ownRow(x, now) {
  const text = el('span', { class: 'cl-text editable', title: '点文字可以修改', tabindex: '0', role: 'button' }, x.text);
  text.addEventListener('click', () => startEdit(x, text));
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') startEdit(x, text); });

  const dueInput = el('input', { type: 'datetime-local', 'aria-label': '截止时间' });
  dueInput.value = toLocalInput(x.due);
  dueInput.addEventListener('change', () => { if (dueInput.value) patchItem(x.id, { due: fromLocalInput(dueInput.value) }, '截止时间已保存。'); });
  const clearDue = el('button', { type: 'button', class: 'link' }, '去掉截止时间');
  clearDue.addEventListener('click', () => patchItem(x.id, { due: null }, '已去掉截止时间。'));
  const dueEditor = el('div', { class: 'cl-due-edit', hidden: '' }, dueInput, x.due ? clearDue : null);

  // A small calendar button next to the due time; without a due time it only shows on hover.
  const dueTitle = x.due ? '改截止时间' : '加截止时间';
  const dueBtn = el('button', { type: 'button', class: `cl-cal${x.due ? '' : ' cl-cal-add'}`, title: dueTitle, 'aria-label': dueTitle, 'aria-expanded': 'false' });
  dueBtn.addEventListener('click', () => {
    dueEditor.hidden = !dueEditor.hidden;
    dueBtn.setAttribute('aria-expanded', String(!dueEditor.hidden));
    if (!dueEditor.hidden) dueInput.focus();
  });
  const del = el('button', { type: 'button', class: 'link danger cl-del' }, '删除');
  del.addEventListener('click', () => removeLater([x.id], `已删除"${short(x.text)}"`,
    (keepalive) => api(`/api/checklist/items/${x.id}`, { method: 'DELETE', keepalive })));

  return el('div', { class: `cl-row${x.done ? ' is-done' : ''}` },
    roundBox(x.done, x.done ? '取消完成' : '标记完成', (done) => patchItem(x.id, { done }, done ? '已移到下面的「已完成」。' : '')),
    el('div', { class: 'cl-body' }, text, dueEditor),
    el('div', { class: 'cl-side' }, dueLabel(x.due), badge(x, now), x.done ? null : dueBtn, del));
}

/** Open items above the 「＋」 row, the 已完成 group under it. */
function renderOwn() {
  const now = Date.now();
  const { open, done } = sortRows(checklist.items.filter((x) => !hiddenIds.has(x.id)));
  openCounts.own = open.length;
  totalCounts.own = open.length + done.length;
  updateChecklistCount();
  const clear = el('button', { type: 'button', class: 'link danger' }, '清除已完成');
  clear.addEventListener('click', () => {
    const ids = done.map((x) => x.id);
    removeLater(ids, `已清除 ${ids.length} 条已完成的事项`,
      (keepalive) => api('/api/checklist/clear-done', { ...json('POST', { ids }), keepalive }));
  });
  $('clOwn').replaceChildren(open.length
    ? el('div', { class: 'cl-list' }, open.map((x) => ownRow(x, now)))
    : el('p', { class: 'muted small cl-empty' }, done.length ? '自己的待办都做完了。' : '还没有自己的待办。'));
  $('clOwnDone').replaceChildren(...(done.length ? [doneGroup('own', done.map((x) => ownRow(x, now)), el('p', {}, clear))] : []));
}

function startEdit(x, span) {
  const input = el('input', { type: 'text', maxlength: '200', class: 'cl-edit', 'aria-label': '修改待办' });
  input.value = x.text;
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const value = input.value.trim();
    if (save && value && value !== x.text) return patchItem(x.id, { text: value }, '已保存修改。');
    if (save && !value) flash('内容不能为空，没有修改。想删掉这条，请点"删除"。');
    renderOwn();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  // Clicking somewhere else saves too, so a change is not lost.
  input.addEventListener('blur', () => finish(true));
  span.replaceWith(input);
  input.focus();
}

async function patchItem(id, patch, okText) {
  try {
    const item = await api(`/api/checklist/items/${id}`, json('PATCH', patch));
    checklist.items = checklist.items.map((x) => (x.id === id ? item : x));
    if (okText) flash(okText);
    renderOwn();
  } catch (err) {
    flash(`没有保存：${err.message}`);
    await loadChecklist();
  }
}

/** Hides the items now and only deletes them once the undo window has passed. */
function removeLater(ids, text, send) {
  flushRemoval();
  ids.forEach((id) => hiddenIds.add(id));
  renderOwn();
  pendingRemoval = { ids, send, timer: setTimeout(() => flushRemoval(), 6000) };
  $('undoText').textContent = text;
  $('undoBar').hidden = false;
}

function flushRemoval(keepalive = false) {
  const p = pendingRemoval;
  if (!p) return;
  pendingRemoval = undefined;
  clearTimeout(p.timer);
  $('undoBar').hidden = true;
  p.send(keepalive)
    .then(() => { checklist.items = checklist.items.filter((x) => !p.ids.includes(x.id)); })
    .catch((err) => flash(`没有删除成功：${err.message}`))
    .finally(() => {
      p.ids.forEach((id) => hiddenIds.delete(id));
      renderOwn();
    });
}

$('undoBtn').addEventListener('click', () => {
  const p = pendingRemoval;
  if (!p) return;
  pendingRemoval = undefined;
  clearTimeout(p.timer);
  $('undoBar').hidden = true;
  p.ids.forEach((id) => hiddenIds.delete(id));
  renderOwn();
  flash('已恢复。');
});

// Leaving the page during the undo window still carries out the delete.
window.addEventListener('pagehide', () => flushRemoval(true));

// ---- 「＋ 点这里添加一件事」 ----

function openAdd() {
  $('addOpen').hidden = true;
  $('addForm').hidden = false;
  $('addText').focus();
}

function closeAdd() {
  $('addText').value = '';
  $('addDue').value = '';
  $('addDueBox').hidden = true;
  $('addDueBtn').setAttribute('aria-expanded', 'false');
  $('addMsg').textContent = '';
  $('addForm').hidden = true;
  $('addOpen').hidden = false;
}

$('addOpen').addEventListener('click', openAdd);
$('addDueBtn').addEventListener('click', () => {
  $('addDueBox').hidden = !$('addDueBox').hidden;
  $('addDueBtn').setAttribute('aria-expanded', String(!$('addDueBox').hidden));
  if (!$('addDueBox').hidden) $('addDue').focus();
});
$('addForm').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeAdd();
  $('addOpen').focus();
});
// Clicking somewhere else puts the row back only when nothing was typed, so no words are lost.
$('addForm').addEventListener('focusout', (e) => {
  if ($('addForm').contains(e.relatedTarget)) return;
  if (!$('addText').value.trim() && !$('addDue').value) closeAdd();
});

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('addText').value.trim();
  if (!text) return; // an empty box: Enter does nothing
  try {
    const item = await api('/api/checklist/items', json('POST', { text, due: fromLocalInput($('addDue').value) }));
    checklist.items.push(item);
    // The box stays open for the next one, like 提醒事项.
    $('addText').value = '';
    $('addDue').value = '';
    $('addDueBox').hidden = true;
    $('addDueBtn').setAttribute('aria-expanded', 'false');
    $('addMsg').textContent = '';
    renderOwn();
    $('addText').focus();
  } catch (err) {
    $('addMsg').textContent = err.message;
  }
});

$('addText').addEventListener('input', () => {
  const left = 200 - [...$('addText').value].length;
  $('addMsg').textContent = left <= 20 ? `还能输入 ${left} 个字。` : '';
});

async function loadChecklist() {
  try {
    checklist = await api('/api/checklist');
  } catch (err) {
    renderAssignments();
    setSummary('checklist', '清单没有读取成功，点开看怎么办');
    flagError('checklist');
    $('clOwnDone').replaceChildren();
    return $('clOwn').replaceChildren(actionLine(`清单没有读取成功：${err.message}`, [{ label: '重试', onClick: loadChecklist }]));
  }
  clearError('checklist');
  renderOwn();
  renderAssignments();
}

/** Signed out: only the checklist stays, since the student's own list is local. */
function showSignedOut() {
  signedIn = false;
  $('main').hidden = false;
  $('sectionNav').hidden = false;
  $('main').classList.add('signed-out');
  setSignedIn(false);
  setCount('deadlines', 0);
  $('today').hidden = true;
  for (const id of ['deadlines', 'files', 'announcements', 'grades']) setSummary(id, SIGNED_OUT);
  renderAssignments();
  renderMessages();
}

function renderAnnouncements(list) {
  const box = $('annList');
  box.replaceChildren();
  setSummary('announcements', announcementsSummary(list));
  if (!list.length) return box.append(el('p', { class: 'muted' }, '最近没有公告。老师发布公告后会出现在这里。'));
  for (const a of list.slice(0, 12)) {
    box.append(el('div', { class: 'item' },
      el('details', {},
        el('summary', {}, el('span', { class: 'title' }, glossed(a.title))),
        el('div', { class: 'body' }, a.body || '（无正文）'),
      ),
      el('div', { class: 'meta' }, courseEl(a.course), a.date ? ` · ${fmt.format(new Date(a.date))}` : ''),
    ));
  }
}

const bar = (pct) => el('span', { class: 'bar' }, el('i', { style: `width:${Math.min(100, pct)}%` }));

/** One course: the average on the folded row, every item once opened. */
function gradeCourse(c) {
  const pcts = c.items.map((g) => g.pct).filter((p) => p != null);
  const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
  const waiting = c.items.filter((g) => g.text === '等待评分').length;
  return el('details', { class: 'course grade-course' },
    el('summary', {},
      courseEl(c.course),
      el('span', { class: 'grade-avg' }, avg == null ? el('span', { class: 'muted' }, '还没有分数') : [bar(avg), `平均 ${avg}%`]),
      waiting ? el('span', { class: 'tag' }, `${waiting} 项等待评分`) : null),
    el('table', {},
      el('tr', {}, el('th', {}, '项目'), el('th', {}, '分数'), el('th', {}, '百分比')),
      c.items.map((g) => el('tr', {},
        el('td', {}, glossed(g.name)),
        el('td', {}, g.text),
        el('td', {}, g.pct == null ? '—' : [bar(g.pct), `${g.pct}%`]),
      )),
    ));
}

function renderGrades(courses) {
  const box = $('gradeList');
  box.replaceChildren();
  const withItems = courses.filter((c) => c.items.length);
  const { current, earlier } = splitByTerm(withItems, past, (c) => c.courseId);
  setSummary('grades', gradesSummary(current));
  if (!withItems.length) return box.append(el('p', { class: 'muted' }, '还没有成绩。老师公布成绩后会出现在这里。'));
  if (!current.length) box.append(el('p', { class: 'muted' }, '本学期的课程还没有成绩。'));
  box.append(...current.map(gradeCourse));
  if (earlier.length) box.append(pastFold('grades', earlier.length, earlier.map(gradeCourse)));
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
    flagError('files');
    body.replaceChildren(actionLine(`这门课的文件没有读取成功：${err.message}`,
      isSignedOutError(err) ? [reconnect] : [{ label: '重试', onClick: () => loadCourseFiles(course, body) }]));
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

const FILES_FIRST = 4; // courses shown before 显示全部
let filesAll = false;
let fileCourses = 0; // this term's courses, for the folded line

function updateFilesSummary() {
  if (overviewData) setSummary('files', filesSummary(fileCourses, settings.downloadDir));
}

function renderCourseFiles(courses, refresh) {
  refreshFiles = refresh;
  filesByCourse.clear();
  selected.clear();
  $('selectAll').checked = false;
  const box = $('courseFiles');
  box.replaceChildren();
  const { current, earlier } = splitByTerm(courses, past);
  fileCourses = current.length;
  updateFilesSummary();
  if (!courses.length) return box.append(el('p', { class: 'muted' }, '没有找到课程。可以点右上角的「刷新」再试一次。'));
  // A long course list stays short in its column until 显示全部.
  const rest = filesAll ? [] : current.slice(FILES_FIRST);
  box.append(...current.slice(0, current.length - rest.length).map(fileCourse));
  if (rest.length) {
    const more = el('div', { hidden: '' }, rest.map(fileCourse));
    const button = el('button', { type: 'button', class: 'show-all' }, `显示全部（还有 ${rest.length} 门课）`);
    button.addEventListener('click', () => {
      filesAll = true;
      more.hidden = false;
      button.remove();
    });
    box.append(button, more);
  }
  if (earlier.length) box.append(pastFold('files', earlier.length, earlier.map(fileCourse)));
  updateSelectionUi();
}

function fileCourse(course) {
  const check = el('input', { type: 'checkbox', 'data-course': course.id, title: '选中这门课的全部文件' });
  const body = el('div', {});
  const details = el('details', { class: 'course' },
    el('summary', {}, check, courseEl(course.name), course.open ? null : el('span', { class: 'tag' }, '已结课'),
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
  return details;
}

$('selectAll').addEventListener('change', () => {
  for (const [courseId, files] of filesByCourse) {
    for (const f of files) {
      if ($('selectAll').checked) selected.add(`${courseId}|${f.id}`); else selected.delete(`${courseId}|${f.id}`);
    }
  }
  for (const details of document.querySelectorAll('#courseFiles details.course')) {
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
  if (settings.display) setDisplay(settings.display);
  if (todoItems.length) renderTodo();
  $('downloadDir').value = settings.downloadDir ?? '';
  updateFilesSummary();
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
    updateFilesSummary();
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
      updateFilesSummary();
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
  for (const details of document.querySelectorAll('#courseFiles details.course')) {
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
  if (job.state === 'error') return box.replaceChildren(el('p', { class: 'fail' }, `下载出错：${friendlyText(job.message, job.code)}`));
  const failed = r.failed.length;
  box.replaceChildren(...[
    el('p', {}, `${r.stopped ? '已停止。' : '完成。'}新下载 ${r.downloaded} 个，跳过 ${r.skipped} 个（已存在），失败 ${failed} 个。`),
    failed ? el('ul', { class: 'small' }, r.failed.map((f) => el('li', {}, el('b', {}, f.name), '：', el('span', { class: 'fail' }, f.reason)))) : null,
    r.noText?.length ? el('p', { class: 'muted small' }, `这些文件没能导出文字版（可能是扫描版 PDF，没有文字层）：${r.noText.join('、')}`) : null,
  ].filter(Boolean));
}

$('startDownload').addEventListener('click', async () => {
  if (!selected.size) return ($('dlProgress').textContent = '请先展开课程，勾选要下载的文件。');
  if (!settings.demo && !settings.downloadDir) {
    return fillAction($('dlProgress'), '请先选择保存位置。', settings.canPick
      ? [{ label: '选择文件夹', onClick: () => $('pickDir').click() }]
      : [{ label: '填写保存位置', onClick: () => $('downloadDir').focus() }]);
  }
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
      showSignedOut();
      showBanner('');
      return;
    }
    $('login').hidden = true;
    const mins = status.secondsLeft ? Math.round(status.secondsLeft / 60) : null;
    $('who').textContent = `${status.name}${status.demo ? '（示例数据）' : ''}${mins ? ` · 登录还剩约 ${mins} 分钟` : ''}`;
    $('main').hidden = false;
    $('sectionNav').hidden = false;
    $('main').classList.remove('signed-out');
    signedIn = true;
    setSignedIn(true);
    renderAssignments();
    // Messages load alongside the overview, so a slow course does not hold up the rest.
    messageData = null;
    renderMessages();
    loadMessages(refresh);
    showBanner('正在读取 Blackboard 数据…');
    for (const id of ['deadlines', 'files', 'announcements', 'grades']) setSummary(id, LOADING);
    const data = await api(`/api/overview${refresh ? '?refresh' : ''}`);
    overviewData = data;
    updatePast();
    setCourseNames(data.courses.map((c) => c.name));
    todoLoaded = true;
    renderTodo(data.todo);
    renderAssignments();
    renderAnnouncements(data.announcements);
    renderGrades(data.grades);
    renderCourseFiles(data.courses, refresh);
    // Course names are known now: redraw messages with short names if chosen.
    if (messageData) renderMessages();
    showBanner('');
    if (firstLoad) scrollToHash();
    firstLoad = false;
  } catch (err) {
    if (isSignedOutError(err)) {
      $('login').hidden = false;
      showSignedOut();
      showBanner('登录已过期，请重新连接 Blackboard。', [reconnect]);
    } else if (err.code !== 'SERVER_DOWN') {
      showBanner(`数据没有读取成功：${err.message}`, [{ label: '重试', onClick: () => load(true) }]);
      for (const id of ['deadlines', 'files', 'announcements', 'grades']) setSummary(id, '没有读取成功，看页面上方的提示');
    }
  } finally {
    $('refresh').disabled = false;
  }
}

let firstLoad = true;

$('refresh').addEventListener('click', () => load(true));

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
    $('connectMsg').textContent = job.state === 'done' ? job.message : `没有连接成功：${friendlyText(job.message, job.code)}`;
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
    const hint = /[\u3400-\u9fff]/.test(err.hint ?? '') ? `（${err.hint}）` : '';
    $('loginMsg').textContent = `登录失败：${err.message}${hint}`;
  } finally {
    $('doLogin').disabled = false;
  }
});

buildNav();
// Reading localStorage itself can throw when the browser blocks site data.
let storage = null;
try { storage = window.localStorage; } catch { /* hidden for this visit only */ }
initKeepOpen({ wrap: $('keepOpen'), button: $('keepOpenOff'), root: document.documentElement, storage });
initToTop();
initFeedback();
initDisplayPanel(async (display) => {
  const saved = await api('/api/settings', json('POST', { display }));
  return { display: saved.display, demo: settings.demo };
});
// The dropdown of course names is plain text, so redraw it when the name style changes.
onDisplayChange(() => { if (messageData) renderMessages(); });

watchServer(
  () => {
    $('serverDown').textContent = SERVER_LOST;
    $('serverDown').hidden = false;
  },
  () => {
    $('serverDown').hidden = true;
    showBanner('面板已恢复运行。');
    setTimeout(() => { if ($('banner').textContent === '面板已恢复运行。') showBanner(''); }, 4000);
    loadSettings();
    loadChecklist();
    reloadPush();
    load();
  },
);

api('/api/config').then((c) => { if (c.baseUrl && !$('baseUrl').value) $('baseUrl').value = c.baseUrl; }).catch(() => {});
loadSettings();
loadChecklist();
initPush();
load();
