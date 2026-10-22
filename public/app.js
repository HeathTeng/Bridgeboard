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

function relative(iso) {
  const diff = Date.parse(iso) - Date.now();
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const span = days > 0 ? `${days} 天${hours ? ` ${hours} 小时` : ''}` : `${Math.max(1, hours)} 小时`;
  return diff >= 0 ? `还剩 ${span}` : `已过 ${span}`;
}

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

const BUCKETS = [
  ['overdue', '已逾期'],
  ['dueToday', '今天截止'],
  ['upcoming', '即将截止'],
  ['submitted', '已提交'],
];

function renderTodo(todo) {
  const box = $('todo');
  box.replaceChildren();
  if (!todo.length) return box.append(el('p', { class: 'muted' }, '近期没有截止事项。'));
  for (const [key, label] of BUCKETS) {
    const items = todo.filter((t) => t.bucket === key);
    if (!items.length) continue;
    box.append(el('div', { class: `group ${key}` },
      el('h3', {}, `${label}（${items.length}）`),
      items.map((t) => el('div', { class: 'item' },
        el('div', { class: 'title' }, t.title),
        el('div', { class: 'meta' }, `${t.course} · ${fmt.format(new Date(t.due))} · ${relative(t.due)}`),
      )),
    ));
  }
}

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

$('doLogin').addEventListener('click', async () => {
  const curl = $('curl').value.trim();
  if (!curl) return ($('loginMsg').textContent = '请先粘贴内容。');
  $('doLogin').disabled = true;
  $('loginMsg').textContent = '正在验证…';
  try {
    const s = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ curl, url: $('baseUrl').value.trim() }),
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

load();
