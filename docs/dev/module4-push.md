# Module 4: phone alerts (Bark for iPhone, ntfy for Android)

Spec for Claude Code. Read CLAUDE.md first (rules, the user we design for, versions). Functional work in the current plain style; the redesign comes later.

The phone only **receives** alerts. The dashboard still runs on the computer, and tapping an alert opens the Blackboard assignment page, which works on a phone.

## 0. Rules for this module

- **Off by default.** Nothing leaves the computer until the student turns alerts on and fills in their own Bark key or ntfy topic.
- This is the one place where data leaves the computer, so say exactly what is sent, right next to the switch: 💡 打开后，作业名、课程名、截止时间和 Blackboard 链接会经过 Bark / ntfy 的服务器发到你的手机。不想发作业名，可以打开「隐藏作业名」。 Add one line to CLAUDE.md's "Stay local" rule naming this opt-in exception.
- Only send to the Bark server (`https://api.day.app`), ntfy (`https://ntfy.sh`), or a self-hosted server the student types in (https only). No other hosts. Never send cookies or message bodies.
- The Bark key and ntfy topic work like passwords. Keep them in settings.json, never log them, and return them masked to the page (last 4 characters).
- Read-only toward Blackboard, as always.

## 1. Settings panel: 手机提醒

- A 手机提醒 card in the settings, with a main switch (default off).
- Choose 苹果手机（Bark） or 安卓手机（ntfy）, each with short numbered steps on the page:
  - Bark: install Bark from the App Store, open it, copy the link it shows (`https://api.day.app/xxxx/`), paste it here. Accept the full link or just the key; extract and check the key.
  - ntfy: install ntfy from Google Play or F-Droid, tap +, type the topic shown here. Generate a long random topic (e.g. `bb-` + 16 random letters) with a 换一个 button, and a copy button. Explain: 这个名字就像密码，别人知道了也能收到你的提醒，不要发给别人。 Advanced: custom server (https only), hidden behind 高级.
- **发一条测试** button: sends 「测试成功 ✅ 以后作业快到期时，手机会这样提醒你。」 Show plain-Chinese results: sent / key wrong / no internet / server refused, each with what to do next. Saving alerts as on is only allowed after one successful test.
- Switches, each with a one-line explanation:
  - 变成橙色（临期）时提醒一次 (default on; uses the timeline's due-soon hours).
  - 剩 N 小时还没交时**强提醒** (default on, N = 5, choose 1 to 24). Bark: `level: critical` (rings even on silent) plus `call: 1` (keeps ringing). ntfy: priority 5. Explain that the iPhone asks once to allow 重要警告 and they should tap 允许.
  - 逾期时提醒一次 (default on).
  - 老师或同学发来新的课程消息时提醒 (default off; sender and course only, never the message text).
  - 隐藏作业名 (default off): the alert says 「有 1 项作业 5 小时后截止」 without names or links.
  - 安静时段 (default off, e.g. 23:00 to 08:00): normal alerts wait until it ends; strong alerts still go out.

## 2. The checker (server side)

- While alerts are on, the server checks every 15 minutes, plus once at start. It reuses the existing data fetch and cache, and silent renewal when the session lapses.
- Rules are a pure function in `lib/push-rules.js`: given the items, the time now, the settings and the sent log, it returns the alerts to send. Unit-test it thoroughly.
  - Only items that are not submitted. Turned-orange and strong alerts fire once each per assignment, at the first check after the threshold, but not if the item is already overdue.
  - Overdue fires once, and only if the item became overdue within the last 24 hours, so turning alerts on does not flood the phone with old overdue work.
  - If more than 3 alerts are due in one check, send one combined alert (「3 项作业快到期：…」) linking to the nearest one.
  - Times are UTC inside; the alert text shows local time and time left (reuse `lib/status.js`).
- Remember what was sent in `~/.blackboard-study-hub/push-sent.json` (assignment id + rule + time; atomic write; prune entries older than 60 days), so a restart never repeats an alert.
- Senders in `lib/push.js` use Node's built-in `fetch` with a 10-second timeout and one retry. Bark: POST `https://api.day.app/push` with JSON (`device_key`, `title`, `body`, `url`, `group`, `level`, `call`). ntfy: POST the server root with JSON (`topic`, `title`, `message`, `priority`, `click`, `tags`). A failed send stays unsent and retries at the next check.
- If sign-in has lapsed and silent renewal fails, send one alert per day: 「面板登录已过期，作业提醒暂停了。请在电脑上重新连接。」
- Demo mode never sends to the internet: the test button and the checker say 示例模式不会真的发送 and log what they would send.

## 3. Keeping it running

Alerts only work while the computer is on, awake and the black window is open. Say this plainly under the switch, and suggest 导出到日历 as a backup.

- Optional 开机自动启动 switch (Windows only, default off): put a small launcher in the user's Startup folder that starts the app minimised without opening the browser (add a `--background` flag for this). Turning it off removes the launcher. If the app folder has moved or is on a USB drive that is not plugged in, show a warning and offer to fix or remove it.
- The page shows 上次检查：x 分钟前 and the next check, so the student can see it is working.

## Things a beginner could get stuck on (cover each on the page or in docs/FAQ.md)

- Can't find the Bark link or the ntfy + button.
- Tapped 不允许 for iPhone 重要警告 or notifications (how to turn it back on in iPhone settings).
- Phone on 勿扰模式 / 专注模式.
- Test works but no real alerts later: computer asleep, black window closed, or signed out.
- Got the same alert twice (should not happen; say how to report it).
- Shared the ntfy topic by mistake: tap 换一个 and subscribe again.

## Tests and release

- Unit tests: rule engine (each rule, once-only, the 24-hour overdue limit, combining, hidden names, quiet hours, timezones), key and topic validation, masking, the sent log.
- Manual: real test alert to the owner's phone; demo mode sends nothing; a short real run with the strong alert set high so it fires.
- `git diff` checked for keys, topics, cookies, personal paths and real course data; commit in English as HeathTeng; bump to the next patch version; push main first, then the tag. Add FAQ entries and tick the README roadmap line.
