// Made-up data for trying the dashboard without a Blackboard account.
const DAY = 24 * 60 * 60 * 1000;
const at = (days, hour = 15, minute = 59) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
};

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
    todo: [
      { title: 'Weekly Quiz 3', course: 'Management', courseId: '_2_1', due: at(-2), bucket: 'overdue' },
      { title: 'Individual Assignment Draft', course: 'Descriptive Analytics', courseId: '_1_1', due: at(0, 23), bucket: 'dueToday' },
      { title: 'Group Presentation Slides', course: 'Data Storytelling for Business', courseId: '_3_1', due: at(3), bucket: 'upcoming' },
      { title: 'Case Study Report', course: 'Management', courseId: '_2_1', due: at(9), bucket: 'upcoming' },
      { title: 'Reflection Journal', course: 'Descriptive Analytics', courseId: '_1_1', due: at(-5), bucket: 'submitted' },
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
