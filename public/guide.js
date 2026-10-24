// The first-run guide, as data: one entry per page, in order. Adding a
// feature means adding a page here; public/help.js draws them.
//
// title: the page heading. lines: at most three short sentences.
// icon: a large emoji, or image: { src, width, height, alt } (screenshots from demo mode,
// served read-only under /guide-img/). swatches: the five deadline colours.
// faq: the last page, which shows docs/FAQ.md with a search box.
//
// The same pages feed two guides: 💡 帮助 shows them as cards (GUIDE_PAGES),
// and the first start walks through the real page (TOUR_STEPS below), which
// borrows the pages' words instead of having its own.

export const GUIDE_PAGES = [
  {
    id: 'welcome',
    title: '欢迎使用 Bridgeboard',
    icon: '👋',
    lines: [
      '截止日期、课程文件、手机提醒、清单，都在一个页面里。',
      '面板只读取 Blackboard，不会替你提交或修改任何东西。',
      '所有东西都留在你自己的电脑上，我们收不到。',
    ],
  },
  {
    id: 'keep-open',
    title: '先记住一件事',
    icon: '⚠️',
    lines: [
      '只有电脑开着、黑色窗口开着才会发提醒。',
      '黑色窗口可以最小化，但不要点 ✕ 关掉。',
      '电脑不要睡眠，否则面板停了，手机也收不到提醒。',
    ],
  },
  {
    id: 'connect',
    title: '连接 Blackboard',
    image: { src: '/guide-img/connect.png', width: 1182, height: 563, alt: '示例截图：填写学校网址，点「连接 Blackboard」' },
    lines: [
      '填好学校的 Blackboard 网址，点「连接 Blackboard」，在弹出的窗口里登录学校账号。',
      '学校问「保持登录状态？」时，选「是」。',
      '登录过期时面板会自己在后台重新登录，不行再点一次「连接 Blackboard」。',
    ],
  },
  {
    id: 'deadlines',
    title: '截止日期',
    swatches: true,
    lines: [
      '颜色表示有多急：红色逾期，橙色临期，黄色还有时间，蓝色刚开放，绿色已完成。',
      '点作业标题打开 Blackboard 上的作业页面；逾期的可以点 × 忽略。',
      '右上角「导出到日历」可以导进手机日历，当备用提醒。',
    ],
  },
  {
    id: 'files',
    title: '课程文件',
    image: { src: '/guide-img/download.png', width: 1182, height: 977, alt: '示例截图：选择保存位置，勾选课程文件，点「下载选中的文件」' },
    lines: [
      '点「选择文件夹」，选一个保存的地方，U 盘也可以。',
      '勾选要的文件，点「下载选中的文件」。',
      '已经下载过的文件会自动跳过，不会重复下载。',
    ],
  },
  {
    id: 'alerts',
    title: '手机提醒（可选）',
    icon: '🔔',
    lines: [
      'iPhone 用 Bark，安卓用 ntfy，按「手机提醒」里的步骤设置。',
      '打开提醒之前，要先「发一条测试」，确认手机收到了。',
      '会发出去的只有作业名、课程名、截止时间和链接。',
    ],
  },
  {
    id: 'iphone',
    title: 'iPhone 设置要点',
    icon: '📱',
    lines: [
      '用安卓的直接点下一步。',
      '在「设置 → 通知 → Bark」打开「重要警告」；静音时也想震动，把「设置 → 声音与触感 → 触感」设为「始终播放」。',
      '强提醒音量保持 10，可以先点「试听强提醒」；电脑关机时，靠导入手机的日历提醒。',
    ],
  },
  {
    id: 'more',
    title: '其他好用的',
    icon: '🧰',
    lines: [
      '「我的清单」：点最后一行「＋ 点这里添加一件事」。',
      '每个区都能点标题折叠起来，再点一次展开。',
      '右上角「显示设置」：换夜间、护眼，关掉中文注释，隐藏不用的区。',
    ],
  },
  {
    id: 'faq',
    title: '常见问题',
    faq: true,
    lines: [
      '卡住了先在这里搜一搜，比如「提醒」「登录」「下载」。',
      '随时点右上角「💡 帮助」再看这份引导，点「常见问题」直接打开这一页。',
    ],
  },
];

/**
 * The spotlight tour on the real page. page: whose words to use (lines: only
 * those lines, with a short title of its own). target: the element to frame;
 * none means a card in the middle. section: the folding section it sits in,
 * opened for the step and folded back after. when: only signed in / out.
 * mustSee: shown even when the tour is skipped (the black-window rule).
 * Steps whose target is not on the page are left out (lib/tour.js).
 */
export const TOUR_STEPS = [
  { id: 'keep-open', page: 'keep-open', mustSee: true },
  { id: 'connect', page: 'connect', target: '#login', when: 'signedOut' },
  { id: 'deadlines', page: 'deadlines', target: '#deadlines', section: 'deadlines', when: 'signedIn' },
  { id: 'files', page: 'files', target: '#files', section: 'files', when: 'signedIn' },
  { id: 'alerts', page: 'alerts', target: '#alerts', section: 'alerts', when: 'signedIn' },
  { id: 'add', page: 'more', title: '我的清单', lines: [0], target: '#addRow', section: 'checklist' },
  { id: 'display', page: 'more', title: '折叠和显示设置', lines: [1, 2], target: '#displayBtn', when: 'signedIn' },
  { id: 'help', page: 'faq', title: '💡 帮助', lines: [1], target: '#helpBtn', when: 'signedIn' },
];
