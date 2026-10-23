# Bridgeboard: notes for Claude Code

Bridgeboard (formerly blackboard-study-hub; subtitle Blackboard 学习面板) is a local web dashboard for Blackboard Learn Ultra, aimed at international students who are not programmers. The owner (HeathTeng) is new to coding and works mostly through Claude Code: explain changes in plain Chinese, one step at a time, and stop to ask before anything irreversible.

## Layout

- `server.js`: zero-dependency Node HTTP server on 127.0.0.1:3100. API routes plus static files from `public/`.
- `lib/bb.js`: loads blackboard-mcp's library (`BB_MCP_PATH`, else the bundled `vendor/blackboard-mcp.js`, else `../blackboard-mcp/dist/index.js`) and shapes data for the page. Also keep-alive and silent renewal.
- `lib/edge-login.js`: one-click sign-in. Opens Edge/Chrome with its own profile (`~/.blackboard-study-hub/browser-profile`), reads cookies over CDP on 127.0.0.1, closes the window.
- Checklist: `lib/checklist.js` (`ChecklistStore`: own items and manual ticks in `~/.blackboard-study-hub/checklist.json`, temp file + rename; memory-only in demo), `lib/checklist-rows.js` (which assignments appear and row order; browser-safe, served as `/checklist-rows.js` like `/status.js`). Routes under `/api/checklist` in `server.js`. When signed out, the page shows only the checklist card (`#main.signed-out`). Deletes wait out a 6-second undo window before reaching the server. Spec: `docs/dev/module2-checklist.md`.
- Course messages: `lib/messages.js` (threads and messages shaped for the page; bodies become plain text with the library's `htmlToText`), `lib/message-view.js` (filters and relative times; browser-safe, served as `/message-view.js`), `messageThreads` / `messageThread` in `lib/bb.js` (GET only; never `markMessageRead`). Ultra messages have no subject, so a thread is named by who it is with. Links go to `/ultra/courses/<id>/messages`. Spec: `docs/dev/module7-messages.md`.
- Phone alerts: `lib/push-rules.js` (`planAlerts`: which alerts are due at one check; pure, no clock or network, heavily tested), `lib/push.js` (Bark key / ntfy topic parsing and masking, settings shape and `applyPatch`, senders with a 10 s timeout and one retry, the sent log `~/.blackboard-study-hub/push-sent.json`), `lib/push-service.js` (`PushService`: the 15-minute checker, test, topic changes; demo mode only logs), `lib/autostart.js` (开机自动启动: a `.cmd` in the Startup folder running `start.bat --background` minimised; not .vbs). Settings live under `push` in settings.json; secrets go to the page masked. Routes under `/api/push`; page code in `public/push.js`. `start.bat` passes its arguments on and closes itself when the server exits 0 (already running: it only opened the page; `/api/ping` tells the copies apart). Spec: `docs/dev/module4-push.md`.
- `lib/ics.js`: deadline calendar export. `lib/demo.js`: fake data for `--demo`.
- Five-colour deadlines: `lib/status.js` (`statusOf`, time-left labels; no Node-only code, the page loads it as `/status.js`), `lib/seen.js` (`~/.blackboard-study-hub/seen.json`, first-seen times when Blackboard gives no opening date), `lib/links.js` (assignment links, https on the school host only). Opening dates come from the content item's date release rule (`releaseStart` in `lib/bb.js`). The timeline durations (`newHours`, `dueSoonHours`) are in settings.json. Spec: `docs/dev/module1-deadlines.md`.
- Course file downloader: `lib/downloader.js` (target paths, Windows length limit, skip-existing; pure, tested), `lib/office-text.js` (.docx/.pptx text via zlib, since the library only extracts PDF), `lib/settings.js` (`~/.blackboard-study-hub/settings.json`, download folder checks). Listing and the one-at-a-time download loop are `courseFiles` / `downloadAll` in `lib/bb.js`; the page sends file ids only, never URLs. Spec: `docs/dev/step3-downloader.md`.
- `public/`: plain HTML/CSS/JS, Chinese UI, no build step. `ui.js` (DOM helpers; `api()` turns every error into plain Chinese, raw text to the console; notices when the server is gone and when it is back), `layout.js` (sticky section nav with counts, 回到顶部, the 显示设置 panel, short/full course names via CSS, the footer 意见反馈 mailto to feedback@getboundly.com with the version from `/api/ping`), `app.js` (the sections). The footer holds the one privacy line for the whole page; sections only mention what leaves the computer (phone alerts).
- Sections and display settings: `lib/display.js` (browser-safe, served as `/display.js`): `SECTIONS` lists every section in page order (one entry per section or switch; ids are the `<section>` ids), `checkDisplay` validates what the page saves (`display` in settings.json), `shortNames` shortens course names and keeps them unique. Hint lines use the `tip` class, which adds the lightbulb.
- `test/`: `node --test`. Run `npm test` before every commit.
- `start.bat` / `demo.bat`: double-click launchers for Windows. They use `runtime/node.exe` when present (portable zip), else `node` on PATH.
- `scripts/build-portable.sh` + `.github/workflows/release.yml`: pushing a `v*` tag builds the Windows portable zip (app + node.exe, SHA-256 checked; folder `Bridgeboard`, `Bridgeboard-<version>-windows.zip` plus the same file as `Bridgeboard-Windows.zip`, which getboundly.com links to) and publishes it as a GitHub Release.

## Who we design for

Picture the user as extremely impatient, not technical at all, who reads nothing and must be taught everything from zero. For every feature: plain Chinese with no jargon, the explanation visible right where it is needed, empty and error states that say exactly what to do next, one obvious action, and protection against easy mistakes. When proposing a plan, list what such a user could get stuck on. This persona is for catching gaps, not for hiding information: real users are normal students, so keep full details visible (for example, always show full course names, which tell similar subjects apart).

## Rules

- **Read-only.** Never call Blackboard write operations (submit, quiz, mark reviewed). Never set `BLACKBOARD_MCP_ALLOW_WRITES`.
- **No secrets in git.** Cookies, cURL captures, HAR files, `~/.blackboard-mcp/`, `~/.blackboard-study-hub/`, API keys and personal paths (e.g. `C:\Users\<name>`) must never be committed or printed in full. Check `git diff --staged` before committing.
- **Stay local.** The server binds 127.0.0.1 only and checks Host/Origin. Do not add anything that sends student data to a third party; the planned AI feature uses the student's own API key, stored locally.
- **The one opt-in exception: phone alerts.** Off by default; only after the student switches them on and a test reached their phone, assignment/course names, due times and links go to Bark (`https://api.day.app`), ntfy (`https://ntfy.sh`) or a self-hosted https server they typed in. No other hosts, never cookies or message text; keys and topics are never logged and reach the page masked.
- **Old names that stay** after the rename (`test/rename.test.js` guards them): the data folder `~/.blackboard-study-hub/`, the calendar UID suffix `@blackboard-study-hub`, the Startup file `blackboard-study-hub.cmd`, the `/api/ping` app id. Changing them loses data or makes duplicates. The GitHub repository keeps its old name until the owner renames it; then update the links in README, FAQ and the build script.
- **Zero dependencies** for now: Node built-ins only, so the app can ship as a portable zip.
- **Windows first.** The owner uses Windows + Edge. In Claude Code's `!` shell (Git Bash) use forward slashes in paths.
- UI text is Chinese; README is bilingual. Times come from the API in UTC; display in local time.

## Versions and releases

- The owner wants a new release for every change pushed to `main`: bump the patch number by one each time (v0.2.0 → v0.2.1 → v0.2.2 …), set the same number in `package.json` `version`, commit, then push the tag (`git tag v0.2.1 && git push origin v0.2.1`). The Release workflow builds and publishes the Windows zip.
- Bump the middle number (v0.3.0) only when the owner says a stage or big feature is finished.

## Roadmap

Order agreed with the owner (2026-10-22): **functional modules first, then UI design, then the first-run guide**, because the guide walks through every feature and would need redoing after each change.

- Done: pop-up sign-in with silent renewal; blackboard-mcp bundled in vendor/ (rebuild with `npm run vendor`, keep vendor/THIRD-PARTY-NOTICES.txt in sync); course file downloader (not yet: attachments and files embedded in page bodies); Windows portable zip via the Release workflow; module 1, five-colour deadlines with the adjustable timeline and links to Blackboard; module 2, the checklist; module 7, course messages (read-only; see the open check below); module 3, section navigation, display settings and beginner safety nets; module 4, phone alerts (Bark / ntfy) with the Windows start-up launcher.
- Next: the remaining functional modules (e.g. weekly digest, study packs, AI Q&A with the student's own API key). Keep their UI plain and consistent with the current page; no visual redesign yet.
- Open check: 课程消息：等有真实未读消息时，验证在面板里阅读不会让 Blackboard 变成已读；如果会，改成只列出线程。
- Now: UI redesign, agreed with the owner on 2026-10-23 (spec: `docs/dev/ui-redesign.md`, five steps, one release each; step 1 is the rename to Bridgeboard).
- Then: first-run guide with the FAQ as its last page and an always-available help button (spec: `docs/dev/step5-onboarding.md`), then README screenshots, then a public launch.
- Keep `docs/FAQ.md` current as features change, including the Windows run warnings (click 运行 / 更多信息 → 仍要运行).

Progress is logged in the owner's GITHUB_PROGRESS.md.
