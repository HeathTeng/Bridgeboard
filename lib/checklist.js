// The student's own to-dos, their manual ticks on assignments and the overdue
// assignments they chose to ignore (忽略), kept in
// ~/.blackboard-study-hub/checklist.json. Local only: nothing here talks to Blackboard.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Old name kept on purpose after the rename to Bridgeboard: existing users' data lives in this folder.
export const CHECKLIST_FILE = join(homedir(), '.blackboard-study-hub', 'checklist.json');
export const LIMITS = { text: 200, items: 500, key: 300 };
const MARK_KEEP_MS = 180 * 24 * 60 * 60 * 1000;

function bad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function checkText(text) {
  if (typeof text !== 'string' || !text.trim()) throw bad('请先输入内容。');
  const clean = text.trim().replace(/\s*[\r\n]+\s*/g, ' ');
  const length = [...clean].length;
  if (length > LIMITS.text) throw bad(`内容太长了：最多 ${LIMITS.text} 个字，现在有 ${length} 个字。`);
  return clean;
}

function checkDue(due) {
  if (due === undefined || due === null || due === '') return null;
  if (typeof due !== 'string' || Number.isNaN(Date.parse(due))) throw bad('截止时间的格式不对，请重新选择。');
  return new Date(due).toISOString();
}

function checkDone(done) {
  if (typeof done !== 'boolean') throw bad('完成状态的格式不对。');
  return done;
}

function checkKey(key) {
  if (typeof key !== 'string' || !key || key.length > LIMITS.key) throw bad('作业的记号不对，请刷新页面再试。');
  return key;
}

function empty() {
  return { items: [], marks: {}, ignored: {} };
}

/**
 * A checklist kept in `file`, or only in memory when `file` is null (demo
 * mode). Every change is written to a temp file first and then renamed over
 * the real one, so a crash mid-write cannot leave a half-written file.
 */
export class ChecklistStore {
  constructor(file = CHECKLIST_FILE, initial = empty()) {
    this.file = file;
    this.memory = file ? undefined : structuredClone(initial);
  }

  read() {
    if (!this.file) return structuredClone(this.memory);
    if (!existsSync(this.file)) return empty();
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'));
      const map = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
      return { items: Array.isArray(data.items) ? data.items : [], marks: map(data.marks), ignored: map(data.ignored) };
    } catch {
      // Unreadable (edited by hand?): keep it aside instead of overwriting it.
      renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      return empty();
    }
  }

  write(data) {
    if (!this.file) {
      this.memory = structuredClone(data);
      return;
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  change(fn) {
    const data = this.read();
    const result = fn(data);
    this.write(data);
    return result;
  }

  find(data, id) {
    const item = data.items.find((x) => x.id === id);
    if (!item) throw bad('找不到这条事项，可能已经被删除了。请刷新页面。', 404);
    return item;
  }

  list(now = Date.now()) {
    const data = this.read();
    // Forget manual ticks and ignores long after the assignment could still be listed.
    data.ignored ??= {};
    const stale = (map) => Object.keys(map).filter((k) => now - Date.parse(map[k].at) > MARK_KEEP_MS);
    const old = { marks: stale(data.marks), ignored: stale(data.ignored) };
    if (old.marks.length || old.ignored.length) {
      this.change((d) => {
        d.ignored ??= {};
        for (const field of ['marks', 'ignored']) old[field].forEach((k) => delete d[field][k]);
      });
    }
    for (const field of ['marks', 'ignored']) old[field].forEach((k) => delete data[field][k]);
    return data;
  }

  add({ text, due } = {}, now = Date.now()) {
    const item = { id: randomUUID(), text: checkText(text), due: checkDue(due), done: false, createdAt: new Date(now).toISOString(), doneAt: null };
    return this.change((data) => {
      if (data.items.length >= LIMITS.items) {
        throw bad(`清单最多 ${LIMITS.items} 条。请先点"清除已完成"，或删掉一些不需要的事项。`);
      }
      data.items.push(item);
      return item;
    });
  }

  update(id, patch = {}, now = Date.now()) {
    const fields = Object.keys(patch).filter((k) => ['text', 'due', 'done'].includes(k));
    if (!fields.length) throw bad('没有收到要修改的内容。');
    const next = {};
    if ('text' in patch) next.text = checkText(patch.text);
    if ('due' in patch) next.due = checkDue(patch.due);
    if ('done' in patch) next.done = checkDone(patch.done);
    return this.change((data) => {
      const item = this.find(data, id);
      if ('done' in next && next.done !== item.done) item.doneAt = next.done ? new Date(now).toISOString() : null;
      Object.assign(item, next);
      return item;
    });
  }

  remove(id) {
    return this.change((data) => {
      const item = this.find(data, id);
      data.items = data.items.filter((x) => x !== item);
      return item;
    });
  }

  /** Removes finished items: the listed ids only, or every finished item. */
  clearDone(ids) {
    if (ids !== undefined && (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string'))) throw bad('要清除的事项格式不对。');
    return this.change((data) => {
      const gone = data.items.filter((x) => x.done && (!ids || ids.includes(x.id)));
      data.items = data.items.filter((x) => !gone.includes(x));
      return { removed: gone.length };
    });
  }

  /**
   * Ignore (or stop ignoring) an overdue assignment: no more reminders for it
   * on this computer. Blackboard is never told; the page shows it under 已忽略.
   */
  ignore(key, on, now = Date.now()) {
    checkKey(key);
    if (typeof on !== 'boolean') throw bad('忽略状态的格式不对。');
    return this.change((data) => {
      data.ignored ??= {};
      if (on) data.ignored[key] = { at: new Date(now).toISOString() };
      else delete data.ignored[key];
      return { key, ignored: on };
    });
  }

  /** A local tick on an assignment. It never submits anything on Blackboard. */
  mark(key, done, now = Date.now()) {
    checkKey(key);
    checkDone(done);
    return this.change((data) => {
      if (done) data.marks[key] = { at: new Date(now).toISOString() };
      else delete data.marks[key];
      return { key, done };
    });
  }
}
