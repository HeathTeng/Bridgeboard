# blackboard-study-hub

**An all-in-one Blackboard hub for international students.** See every deadline, announcement and grade across your courses on one page, and sync deadlines to your calendar. It runs on your own computer, so your login never leaves it.

**面向留学生的 Blackboard 一站式学习平台。** 在一个页面里集中查看所有课程的截止日期、公告和成绩，并把截止日期一键同步到日历，不用再一门一门课点进去找。程序在你自己的电脑上运行，登录信息不会离开你的电脑。

![screenshot](docs/screenshot.png)

## 新手使用步骤（Windows）

不需要懂代码，按顺序做一次就好。

**1. 安装 Node.js（只需一次）**
打开 [nodejs.org](https://nodejs.org)，下载左边的 **LTS** 版本，一路点"下一步"安装。

**2. 下载本项目**
在本页面上方点绿色的 **Code** 按钮，选 **Download ZIP**，然后把压缩包解压到一个文件夹，比如 `D:\BLACKBOARD` 或你的 U 盘。

**3. 准备 blackboard-mcp（暂时需要，下一个版本会内置，这一步就不用了）**
打开 [blackboard-mcp](https://github.com/felipedias-ie/blackboard-mcp)，同样点 **Code → Download ZIP**，解压到同一个文件夹，并把解压出来的文件夹改名为 `blackboard-mcp`。然后进入这个文件夹，在地址栏里输入 `powershell` 并回车，**一行一行**粘贴运行：

```
npm install
npx tsc -p tsconfig.build.json
```

做完后文件夹里应该是这样：

```
D:\BLACKBOARD\
├── blackboard-mcp\
└── blackboard-study-hub\    （第 2 步解压出来的，叫 blackboard-study-hub-main 也没关系）
```

**4. 双击 `start.bat`**
在 `blackboard-study-hub` 文件夹里双击 `start.bat`。会出现一个黑色窗口（**不要关掉它**，关掉面板就停了），浏览器会自动打开面板。如果 Windows 提示"已保护你的电脑"，点"更多信息"，再点"仍要运行"。

**5. 连接 Blackboard**
填入你们学校的 Blackboard 网址（浏览器地址栏里到 `.com` 为止的部分），点 **连接 Blackboard**。

![连接 Blackboard](docs/step-connect.png)

**6. 在弹出的窗口里登录学校账号**
像平时一样输入学号和密码。如果学校问 **"保持登录状态？"（Stay signed in?），一定要选"是"**，这样以后打开基本不用再登录。登录完成后窗口会自己关闭，面板显示你的截止日期、公告和成绩。

以后每次使用，只要双击 `start.bat` 就行。想先看看效果，可以双击 `demo.bat`，用的是虚构的示例数据，不需要登录。

遇到问题请看 **[常见问题](docs/FAQ.md)**。

---

## Why

Students can't use Blackboard's official API without approval from their school's admin. [blackboard-mcp](https://github.com/felipedias-ie/blackboard-mcp) solves that for AI assistants by reusing your own browser session. blackboard-study-hub builds on its client library and gives you a normal web page instead, with no AI client or terminal needed day to day.

## Roadmap

The hub is built as separate modules so new features can be added over time. Planned ideas include a weekly digest, course file organiser and study packs.

后续会以模块的形式持续加入新功能，例如每周学习简报、课件整理和复习资料包。

## Features

- **Deadlines** grouped into overdue, due today, upcoming and submitted, with time left.
- **Announcements** from all open courses, newest first.
- **Grades** per course, with percentages.
- **Calendar export**: download an `.ics` file and import it into Google Calendar, Outlook or Apple Calendar. Each deadline has reminders 1 day and 3 days before.
- **One-click sign-in**: a pop-up browser window, with your school login remembered and silent renewal.
- **Demo mode** with made-up data, for trying it without an account.

## Requirements

- Node.js 22.5 or newer
- A built copy of [blackboard-mcp](https://github.com/felipedias-ie/blackboard-mcp) in a folder next to this one

```
your-folder/
├── blackboard-mcp/   # git clone + npm install + npx tsc -p tsconfig.build.json
└── blackboard-study-hub/   # this project
```

Or point `BB_MCP_PATH` at `blackboard-mcp/dist/index.js`.

## Quick start (command line)

Windows users who don't use the terminal: follow the Chinese step-by-step guide above.

```bash
git clone https://github.com/felipedias-ie/blackboard-mcp.git
cd blackboard-mcp && npm install && npx tsc -p tsconfig.build.json && cd ..
git clone https://github.com/heathteng/blackboard-study-hub.git
cd blackboard-study-hub
npm start          # or double-click start.bat on Windows
```

Your browser opens at http://localhost:3100. Try it with fake data first with `npm run demo` (or `demo.bat`).

### Signing in

Enter your school's Blackboard address and click **连接 Blackboard**. A separate browser window opens: sign in as you normally do. When you're in, the window closes by itself and your dashboard fills in.

- The window uses its own profile folder (`~/.blackboard-study-hub/browser-profile`), never your everyday browser data.
- It remembers your school login, so next time connecting is usually automatic. If your school's login page asks "Stay signed in?", choose yes.
- While the hub runs it keeps the session alive, and if it lapses it signs back in silently in the background.
- If the pop-up doesn't work, expand "手动粘贴" on the page and paste a "Copy as cURL" instead.
- More help: [FAQ (Chinese)](docs/FAQ.md).

## Privacy and safety

- The server listens on `127.0.0.1` only and rejects requests from other host names or web pages.
- The sign-in window's debugging port listens on `127.0.0.1` only and closes with the window.
- It only **reads** from Blackboard. It cannot submit work or take quizzes.
- Your session is stored encrypted by blackboard-mcp in `~/.blackboard-mcp/`. Never commit that folder or share a copied cURL.
- Check your school's IT acceptable-use policy before using automation tools.

## Development

```bash
npm test
```

## Credits

- **Author:** [Heath Teng (@HeathTeng)](https://github.com/HeathTeng), who designed and maintains this project, built with help from Claude Code.
- **Built on:** [blackboard-mcp](https://github.com/felipedias-ie/blackboard-mcp) by [Felipe Dias (@felipedias-ie)](https://github.com/felipedias-ie), MIT licensed. Its Blackboard client library does the sign-in and data fetching; thank you, Felipe.

**作者：** 滕泽浩（[@HeathTeng](https://github.com/HeathTeng)），负责项目设计与维护，开发过程中使用了 Claude Code。
**致谢：** 本项目基于 Felipe Dias（[@felipedias-ie](https://github.com/felipedias-ie)）的开源项目 [blackboard-mcp](https://github.com/felipedias-ie/blackboard-mcp)（MIT 许可证）。

## License

MIT
