# blackboard-study-hub

**An all-in-one Blackboard hub for international students.** See every deadline, announcement and grade across your courses on one page, and sync deadlines to your calendar. It runs on your own computer, so your login never leaves it.

**面向留学生的 Blackboard 一站式学习平台。** 在一个页面里集中查看所有课程的截止日期、公告和成绩，并把截止日期一键同步到日历，不用再一门一门课点进去找。程序在你自己的电脑上运行，登录信息不会离开你的电脑。

![screenshot](docs/screenshot.png)

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
- **Sign in inside the page**: paste a "Copy as cURL" once, no command line.
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

## Quick start

```bash
git clone https://github.com/felipedias-ie/blackboard-mcp.git
cd blackboard-mcp && npm install && npx tsc -p tsconfig.build.json && cd ..
git clone https://github.com/heathteng/blackboard-study-hub.git
cd blackboard-study-hub
npm start          # or double-click start.bat on Windows
```

Your browser opens at http://localhost:3100. Try it with fake data first with `npm run demo` (or `demo.bat`).

### Signing in

1. Sign in to your school's Blackboard in your browser.
2. Press F12, open **Network**, press F5.
3. Right-click a `me?expand=…` request, then **Copy → Copy as cURL (bash)**.
4. Paste it into the box on the dashboard and click 登录.

The session is shared with blackboard-mcp, so signing in here also signs in your AI client. Pasted sessions can't renew themselves and last a few hours.

## Privacy and safety

- The server listens on `127.0.0.1` only and rejects requests from other host names or web pages.
- It only **reads** from Blackboard. It cannot submit work or take quizzes.
- Your session is stored encrypted by blackboard-mcp in `~/.blackboard-mcp/`. Never commit that folder or share a copied cURL.
- Check your school's IT acceptable-use policy before using automation tools.

## Development

```bash
npm test
```

## Credits

Built on [blackboard-mcp](https://github.com/felipedias-ie/blackboard-mcp) by Felipe Dias (MIT).

## License

MIT
