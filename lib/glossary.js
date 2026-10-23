// Chinese glosses for English course terms: the English stays exactly as it
// is and a short Chinese word follows a term the list knows, e.g.
// "Management · 管理学". Never a full translation. No Node-only code: the page
// loads this file as /glossary.js and renders segments with textContent.
//
// Keep the list to unambiguous academic terms. No single letters (group
// letters like "Group T U V W X") and nothing that could be a person's name.
// Not yet: DBA / DIBA (meaning differs between schools; ask the owner).

export const TERMS = {
  // Subjects
  'Management': '管理学',
  'Marketing': '市场营销',
  'Digital Marketing': '数字营销',
  'Macroeconomics': '宏观经济学',
  'Microeconomics': '微观经济学',
  'Economics': '经济学',
  'Econometrics': '计量经济学',
  'Accounting': '会计',
  'Financial Accounting': '财务会计',
  'Management Accounting': '管理会计',
  'Finance': '金融',
  'Corporate Finance': '公司金融',
  'Financial Management': '财务管理',
  'Investment': '投资',
  'Investments': '投资学',
  'Risk Management': '风险管理',
  'Descriptive Analytics': '描述性分析',
  'Predictive Analytics': '预测分析',
  'Prescriptive Analytics': '规范性分析',
  'Business Analytics': '商业分析',
  'Data Analytics': '数据分析',
  'Data Storytelling': '数据叙事',
  'Data Collection Methods': '数据收集方法',
  'Data Collection': '数据收集',
  'Data Visualisation': '数据可视化',
  'Data Visualization': '数据可视化',
  'Data Mining': '数据挖掘',
  'Machine Learning': '机器学习',
  'Artificial Intelligence': '人工智能',
  'AI Governance': '人工智能治理',
  'Academic Reading & Writing': '学术阅读与写作',
  'Academic Reading and Writing': '学术阅读与写作',
  'Academic Writing': '学术写作',
  'Statistics': '统计学',
  'Business Statistics': '商业统计',
  'Business Law': '商法',
  'Business Ethics': '商业伦理',
  'Ethics': '伦理学',
  'Strategy': '战略',
  'Strategic Management': '战略管理',
  'Human Resource Management': '人力资源管理',
  'Organisational Behaviour': '组织行为学',
  'Organizational Behavior': '组织行为学',
  'Leadership': '领导力',
  'Operations Management': '运营管理',
  'Supply Chain Management': '供应链管理',
  'Supply Chain': '供应链',
  'Logistics': '物流',
  'Entrepreneurship': '创业学',
  'Innovation': '创新',
  'Information Systems': '信息系统',
  'PC Revolution': '个人电脑革命',
  'Consumer Behaviour': '消费者行为',
  'Consumer Behavior': '消费者行为',
  'International Business': '国际商务',
  'Project Management': '项目管理',
  'Research Methods': '研究方法',
  'Business Communication': '商务沟通',
  'Critical Thinking': '批判性思维',
  'Programming': '编程',
  'Database': '数据库',
  'Databases': '数据库',
  // Assessment
  'Quiz': '小测',
  'Quizzes': '小测',
  'MCQ': '选择题',
  'Assignment': '作业',
  'Assignments': '作业',
  'Individual Assignment': '个人作业',
  'Group Assignment': '小组作业',
  'Assignment Brief': '作业说明',
  'Brief': '作业说明',
  'Coursework': '课程作业',
  'CW': '课程作业',
  'Project': '项目',
  'Group Project': '小组项目',
  'Presentation': '展示',
  'Presentations': '展示',
  'Group Presentation': '小组展示',
  'Report': '报告',
  'Essay': '论文',
  'Case Study': '案例分析',
  'Reflection Journal': '反思日志',
  'Reflective Journal': '反思日志',
  'Reflection': '反思',
  'Proposal': '方案',
  'Draft': '草稿',
  'Submission': '提交',
  'Exam': '考试',
  'Examination': '考试',
  'Mock Exam': '模拟考试',
  'Final Exam': '期末考试',
  'Final Report': '期末报告',
  'Final Essay': '期末论文',
  'Final': '期末',
  'Midterm': '期中',
  'Mid-term': '期中',
  'Midterm Test': '期中测验',
  'Test': '测验',
  'Rubric': '评分标准',
  'Peer Review': '同学互评',
  'Peer Assessment': '同学互评',
  'Portfolio': '作品集',
  'Dissertation': '学位论文',
  'Thesis': '论文',
  'Resit': '补考',
  'Re-sit': '补考',
  'Practice Questions': '练习题',
  'Worksheet': '练习单',
  'Discussion Board': '讨论区',
  'Feedback': '反馈',
  // Course structure
  'Lecture': '大课',
  'Lectures': '大课',
  'Tutorial': '辅导课',
  'Tutorials': '辅导课',
  'Seminar': '研讨课',
  'Seminars': '研讨课',
  'Workshop': '工作坊',
  'Workshops': '工作坊',
  'Online Lesson': '网课',
  'Online Lessons': '网课',
  'Lesson': '课',
  'Class': '课堂',
  'Term': '学期',
  'Semester': '学期',
  'Trimester': '学期',
  'Module': '模块',
  'Topic': '主题',
  'Week': '周',
  'Weekly': '每周',
  'Diploma': '文凭',
  'Degree': '学位',
  'FT': '全日制',
  'PT': '非全日制',
  'Syllabus': '课程大纲',
  'Course Outline': '课程大纲',
  'Module Guide': '课程指南',
  'Handbook': '手册',
  'Timetable': '课表',
  'Office Hours': '答疑时间',
  'Attendance': '出勤',
  'Orientation': '新生介绍',
  'Exam Board': '考试委员会',
  'Getting to know you': '认识你',
};

// Every course name has these (FT … Autumn 2026 Term), so there they add
// nothing; in assignment and announcement titles they are glossed.
const NOT_IN_COURSE_NAMES = new Set(['ft', 'pt', 'term', 'semester', 'trimester']);

const key = (s) => s.toLowerCase().replace(/\s+/g, ' ');
const LOOKUP = new Map(Object.entries(TERMS).map(([en, zh]) => [key(en), zh]));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Longest first, so "Data Storytelling" wins over a shorter term at the same place.
// Whole words only: no letter or digit right before or after (codes stay untouched).
const PATTERN = new RegExp(`(?<![A-Za-z0-9])(?:${Object.keys(TERMS)
  .sort((a, b) => b.length - a.length)
  .map((t) => escape(t).replace(/ /g, '\\s+'))
  .join('|')})(?![A-Za-z0-9])`, 'gi');

/**
 * Splits text into segments: [{ text }, { text, zh }, …]. Joining every
 * segment's text gives back the original exactly. Each term is glossed once
 * per text. course: true for course names (no FT / PT / Term there).
 */
export function glossSegments(text, { course = false } = {}) {
  const s = typeof text === 'string' ? text : String(text ?? '');
  const segments = [];
  const used = new Set();
  let last = 0;
  for (const m of s.matchAll(PATTERN)) {
    const k = key(m[0]);
    if (used.has(k) || (course && NOT_IN_COURSE_NAMES.has(k))) continue;
    used.add(k);
    if (m.index > last) segments.push({ text: s.slice(last, m.index) });
    segments.push({ text: m[0], zh: LOOKUP.get(k) });
    last = m.index + m[0].length;
  }
  if (last < s.length || !segments.length) segments.push({ text: s.slice(last) });
  return segments;
}
