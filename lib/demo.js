// Made-up data for trying the dashboard without a Blackboard account.
const DAY = 24 * 60 * 60 * 1000;
const at = (days, hour = 15, minute = 59) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};

const fromNow = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

// Made-up course names in the same shape as real ones, so 简短 course names can be tried.
const DA = 'FT MSBA - Descriptive Analytics - Group A B - Autumn 2026 Term';
const MGMT = 'FT MSc/MBA - Management - Autumn 2026 Term (Lecture A)';
const MGMT_B = 'FT MSc/MBA - Management - Autumn 2026 Term (Lecture B)';
const STORY = 'FT MSBA - Data Storytelling for Business - Autumn 2026 Term';
const EXAM = 'Exam - Macroeconomics (FT MSc) - Sep 2026 Exam Board';
// Last term: one folds into 往期课程, the other stays up top (a grade is still waiting).
const STATS = 'FT MSBA - Business Statistics - July 2026 Term';
const ARW = 'FT MSc/MBA - Academic Reading & Writing - July 2026 Term';

export const demoStatus = { signedIn: true, name: '示例同学', secondsLeft: 9000, demo: true };

export function demoOverview() {
  const courses = [
    { id: '_1_1', code: 'DEMO101', name: DA, open: true },
    { id: '_2_1', code: 'DEMO102', name: MGMT, open: true },
    { id: '_3_1', code: 'DEMO103', name: STORY, open: true },
    { id: '_5_1', code: 'DEMO104', name: MGMT_B, open: true },
    { id: '_4_1', code: 'DEMO100', name: EXAM, open: false },
    { id: '_6_1', code: 'DEMO090', name: STATS, open: true },
    { id: '_7_1', code: 'DEMO091', name: ARW, open: true },
  ];
  return {
    generatedAt: new Date().toISOString(),
    demo: true,
    courses,
    // One item per colour: overdue, due soon, new today, open, submitted;
    // the last one has not opened yet, so the checklist leaves it out.
    todo: [
      { key: 'demo|1', title: 'Reflection Journal', course: DA, courseId: '_1_1', due: at(-5), submitted: true, opened: at(-20) },
      { key: 'demo|2', title: 'Weekly Quiz 3', course: MGMT, courseId: '_2_1', due: at(-2), opened: at(-9) },
      { key: 'demo|3', title: 'Individual Assignment Draft', course: DA, courseId: '_1_1', due: fromNow(5), opened: at(-14) },
      { key: 'demo|4', title: 'Group Presentation Slides', course: STORY, courseId: '_3_1', due: at(6), opened: fromNow(0) },
      { key: 'demo|5', title: 'Case Study Report', course: MGMT, courseId: '_2_1', due: at(9), opened: at(-10) },
      { key: 'demo|6', title: 'Final Essay', course: STORY, courseId: '_3_1', due: at(20), opened: fromNow(-30) },
      { key: 'demo|7', title: 'Week 8 Quiz', course: MGMT, courseId: '_2_1', due: at(12), opened: fromNow(48) },
    ],
    announcements: [
      { title: 'Class moved to Room 4.2 this Friday', course: MGMT, date: at(-1, 2), body: 'Dear students,\nThis Friday our lecture will be held in Room 4.2 instead of the usual room.' },
      { title: 'Assignment brief updated', course: DA, date: at(-3, 4), body: 'The rubric for the individual assignment has been clarified. Please download the latest brief.' },
    ],
    grades: [
      { courseId: '_1_1', course: DA, items: [
        { name: 'Quiz 1', text: '8/10', pct: 80 },
        { name: 'Reflection Journal', text: '等待评分' },
      ] },
      { courseId: '_2_1', course: MGMT, items: [{ name: 'Weekly Quiz 1', text: '9/10', pct: 90 }, { name: 'Weekly Quiz 2', text: '6/10', pct: 60 }] },
      { courseId: '_3_1', course: STORY, items: [] },
      { courseId: '_6_1', course: STATS, items: [{ name: 'Midterm Test', text: '72/100', pct: 72 }, { name: 'Final Report', text: '68/100', pct: 68 }] },
      { courseId: '_7_1', course: ARW, items: [{ name: 'Essay 1', text: '15/20', pct: 75 }, { name: 'Final Essay', text: '等待评分' }] },
    ],
  };
}

/** Sample own to-dos for demo mode; changes stay in memory. */
export function demoChecklist() {
  const item = (id, text, due, done = false) => ({
    id, text, due, done, createdAt: fromNow(-48), doneAt: done ? fromNow(-3) : null,
  });
  return {
    items: [
      item('demo-1', '复习 Management 第 3 章', fromNow(30)),
      item('demo-2', '打印小组展示的讲稿', null),
      item('demo-3', '给导师发邮件确认论文选题', null, true),
    ],
    marks: {},
  };
}

// Made-up course messages: already in the shape lib/messages.js produces.
const DEMO_THREADS = [
  { id: 'demo-t1', courseId: '_2_1', course: MGMT, with: '全班', from: 'Dr Ada Lee', time: fromNow(-2), unread: 1, total: 1,
    messages: [{ id: 'm1', from: 'Dr Ada Lee', time: fromNow(-2), unread: true, text: '同学们好：\n本周五的课改到 4.2 教室，时间不变。\n请提前阅读第 5 章，并带上上周的案例分析草稿，课上会分组讨论。' }] },
  { id: 'demo-t2', courseId: '_3_1', course: STORY, with: 'Group 4', from: 'Bo Chen', time: fromNow(-20), unread: 2, total: 4,
    messages: [
      { id: 'm2', from: '我', mine: true, time: fromNow(-50), text: '大家好，我们周三下午开个会分一下展示的部分？' },
      { id: 'm3', from: 'Mia Wong', time: fromNow(-46), text: '可以，我周三 3 点以后都有空。' },
      { id: 'm4', from: 'Bo Chen', time: fromNow(-21), unread: true, hasMedia: true, text: '我把初稿的结构图放在附件里了，大家看看。' },
      { id: 'm5', from: 'Bo Chen', time: fromNow(-20), unread: true, text: `补充一下我的想法：${'我们可以先讲数据来源，再讲三个主要发现，最后给出建议。'.repeat(16)}` },
    ] },
  { id: 'demo-t3', courseId: '_1_1', course: DA, with: 'Dr Sam Patel', from: '我', time: fromNow(-80), unread: 0, total: 2,
    messages: [
      { id: 'm6', from: 'Dr Sam Patel', time: fromNow(-96), text: '你的作业草稿我看过了，第二部分的图表需要加上坐标轴标题。' },
      { id: 'm7', from: '我', mine: true, time: fromNow(-80), text: '谢谢老师，我会修改后重新提交。' },
    ] },
  { id: 'demo-t4', courseId: '_6_1', course: STATS, with: '全班', from: 'Dr Lin Ho', time: at(-60), unread: 0, total: 1,
    messages: [{ id: 'm8', from: 'Dr Lin Ho', time: at(-60), text: '期末报告的成绩已经公布，祝大家下学期顺利。' }] },
];

export function demoMessages() {
  const threads = DEMO_THREADS.map(({ messages, ...t }) => ({ ...t, preview: messages.at(-1).text.replace(/\s+/g, ' ').slice(0, 80) }));
  return { threads, unread: threads.reduce((n, t) => n + t.unread, 0), skipped: 0 };
}

export function demoThread(courseId, threadId) {
  const t = DEMO_THREADS.find((x) => x.id === threadId && x.courseId === courseId);
  if (!t) throw Object.assign(new Error('找不到这个消息线程，请点"刷新"再试。'), { status: 404 });
  return { messages: t.messages.map((m) => ({ mine: false, unread: false, hasMedia: false, ...m })) };
}

const MB = 1024 * 1024;
const DEMO_FILES = {
  _1_1: [
    { id: 'd1', name: 'Course Handbook.pdf', folders: [], size: 1.2 * MB, downloaded: true },
    { id: 'd2', name: 'Week 1 - Introduction.pptx', folders: ['Week 1', 'Lecture'], size: 4.8 * MB },
    { id: 'd3', name: 'Week 1 Tutorial.docx', folders: ['Week 1', 'Tutorial'], size: 0.3 * MB },
    { id: 'd4', name: 'Week 2 - Descriptive Statistics.pptx', folders: ['Week 2', 'Lecture'], size: 6.1 * MB },
    { id: 'd5', name: 'Dataset.xlsx', folders: ['Week 2', 'Tutorial'], size: 0.9 * MB },
    { id: 'd6', name: 'Assignment Brief.pdf', folders: ['Assessment'], size: 0.5 * MB },
    { id: 'd7', name: 'Reading - Chapter 3.pdf', folders: ['Week 3'], size: 140 * MB, tooBig: true },
    { id: 'd8', name: 'Group Project Template.pdf', folders: ['Assessment'], external: true },
  ],
  _2_1: [
    { id: 'm1', name: 'Module Guide.pdf', folders: [], size: 0.8 * MB },
    { id: 'm2', name: 'Lecture 1 Slides.pdf', folders: ['Lectures'], size: 2.4 * MB },
    { id: 'm3', name: 'Case Study Reading.pdf', folders: ['Readings'], external: true, private: true },
  ],
  _3_1: [{ id: 's1', name: 'Storytelling Toolkit.pdf', folders: ['Resources'], size: 3.3 * MB }],
  _4_1: [],
  _6_1: [{ id: 'b1', name: 'Statistics Formula Sheet.pdf', folders: [], size: 0.4 * MB, downloaded: true }],
  _7_1: [{ id: 'w1', name: 'Essay Guidelines.pdf', folders: [], size: 0.6 * MB }],
};

/** Made-up course files; nothing here exists on disk. */
export function demoFiles(courseId) {
  const course = demoOverview().courses.find((c) => c.id === courseId);
  if (!course) throw Object.assign(new Error('没有这门课。'), { status: 404 });
  return { course: course.name, files: (DEMO_FILES[courseId] ?? []).map((f) => ({ ...f, size: f.size && Math.round(f.size) })) };
}

/** Pretends to download, so the page can be tried without writing anything. */
export async function demoDownload(files, { onProgress, shouldStop }) {
  const result = { downloaded: 0, skipped: 0, failed: [], noText: [], stopped: false };
  for (let i = 0; i < files.length; i += 1) {
    if (shouldStop()) {
      result.stopped = true;
      break;
    }
    const f = files[i];
    onProgress({ index: i + 1, total: files.length, name: f.name });
    await new Promise((r) => setTimeout(r, 700));
    if (f.downloaded) result.skipped += 1;
    else if (f.tooBig) result.failed.push({ name: f.name, reason: '文件太大（140.0 MB），超过了单个文件 100.0 MB 的上限。' });
    else if (f.private) result.failed.push({ name: f.name, reason: '这个 Google 文档没有公开分享，需要登录 Google 才能打开，请在浏览器里手动下载。' });
    else result.downloaded += 1;
  }
  return result;
}
