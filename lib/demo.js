// Made-up data for trying the dashboard without a Blackboard account.
const DAY = 24 * 60 * 60 * 1000;
const at = (days, hour = 15, minute = 59) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};

const fromNow = (hours) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

export const demoStatus = { signedIn: true, name: '示例同学', secondsLeft: 9000, demo: true };

export function demoOverview() {
  const courses = [
    { id: '_1_1', code: 'DEMO101', name: 'Descriptive Analytics', open: true },
    { id: '_2_1', code: 'DEMO102', name: 'Management', open: true },
    { id: '_3_1', code: 'DEMO103', name: 'Data Storytelling for Business', open: true },
    { id: '_4_1', code: 'DEMO100', name: 'Macroeconomics (Exam)', open: false },
  ];
  return {
    generatedAt: new Date().toISOString(),
    demo: true,
    courses,
    // One item per colour: overdue, due soon, new today, open, submitted.
    todo: [
      { title: 'Reflection Journal', course: 'Descriptive Analytics', courseId: '_1_1', due: at(-5), submitted: true, opened: at(-20) },
      { title: 'Weekly Quiz 3', course: 'Management', courseId: '_2_1', due: at(-2), opened: at(-9) },
      { title: 'Individual Assignment Draft', course: 'Descriptive Analytics', courseId: '_1_1', due: fromNow(5), opened: at(-14) },
      { title: 'Group Presentation Slides', course: 'Data Storytelling for Business', courseId: '_3_1', due: at(6), opened: fromNow(0) },
      { title: 'Case Study Report', course: 'Management', courseId: '_2_1', due: at(9), opened: at(-10) },
      { title: 'Final Essay', course: 'Data Storytelling for Business', courseId: '_3_1', due: at(20), opened: fromNow(-30) },
    ],
    announcements: [
      { title: 'Class moved to Room 4.2 this Friday', course: 'Management', date: at(-1, 2), body: 'Dear students,\nThis Friday our lecture will be held in Room 4.2 instead of the usual room.' },
      { title: 'Assignment brief updated', course: 'Descriptive Analytics', date: at(-3, 4), body: 'The rubric for the individual assignment has been clarified. Please download the latest brief.' },
    ],
    grades: [
      { course: 'Descriptive Analytics', items: [
        { name: 'Quiz 1', text: '8/10', pct: 80 },
        { name: 'Reflection Journal', text: '等待评分' },
      ] },
      { course: 'Management', items: [{ name: 'Weekly Quiz 1', text: '9/10', pct: 90 }, { name: 'Weekly Quiz 2', text: '6/10', pct: 60 }] },
      { course: 'Data Storytelling for Business', items: [] },
    ],
  };
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
