# blackboard-study-hub: notes for Claude Code

A local web dashboard for Blackboard Learn Ultra, aimed at international students who are not programmers. The owner (HeathTeng) is new to coding and works mostly through Claude Code: explain changes in plain Chinese, one step at a time, and stop to ask before anything irreversible.

## Layout

- `server.js`: zero-dependency Node HTTP server on 127.0.0.1:3100. API routes plus static files from `public/`.
- `lib/bb.js`: loads blackboard-mcp's library (`BB_MCP_PATH`, else the bundled `vendor/blackboard-mcp.js`, else `../blackboard-mcp/dist/index.js`) and shapes data for the page. Also keep-alive and silent renewal.
- `lib/edge-login.js`: one-click sign-in. Opens Edge/Chrome with its own profile (`~/.blackboard-study-hub/browser-profile`), reads cookies over CDP on 127.0.0.1, closes the window.
- `lib/ics.js`: deadline calendar export. `lib/demo.js`: fake data for `--demo`.
- Five-colour deadlines: `lib/status.js` (`statusOf`, time-left labels; no Node-only code, the page loads it as `/status.js`), `lib/seen.js` (`~/.blackboard-study-hub/seen.json`, first-seen times when Blackboard gives no opening date), `lib/links.js` (assignment links, https on the school host only). Opening dates come from the content item's date release rule (`releaseStart` in `lib/bb.js`). The timeline durations (`newHours`, `dueSoonHours`) are in settings.json. Spec: `docs/dev/module1-deadlines.md`.
- Course file downloader: `lib/downloader.js` (target paths, Windows length limit, skip-existing; pure, tested), `lib/office-text.js` (.docx/.pptx text via zlib, since the library only extracts PDF), `lib/settings.js` (`~/.blackboard-study-hub/settings.json`, download folder checks). Listing and the one-at-a-time download loop are `courseFiles` / `downloadAll` in `lib/bb.js`; the page sends file ids only, never URLs. Spec: `docs/dev/step3-downloader.md`.
- `public/`: plain HTML/CSS/JS, Chinese UI, no build step.
- `test/`: `node --test`. Run `npm test` before every commit.
- `start.bat` / `demo.bat`: double-click launchers for Windows. They use `runtime/node.exe` when present (portable zip), else `node` on PATH.
- `scripts/build-portable.sh` + `.github/workflows/release.yml`: pushing a `v*` tag builds the Windows portable zip (app + node.exe, SHA-256 checked) and publishes it as a GitHub Release.

## Who we design for

Picture the user as extremely impatient, not technical at all, who reads nothing and must be taught everything from zero. For every feature: plain Chinese with no jargon, the explanation visible right where it is needed, empty and error states that say exactly what to do next, one obvious action, and protection against easy mistakes. When proposing a plan, list what such a user could get stuck on.

## Rules

- **Read-only.** Never call Blackboard write operations (submit, quiz, mark reviewed). Never set `BLACKBOARD_MCP_ALLOW_WRITES`.
- **No secrets in git.** Cookies, cURL captures, HAR files, `~/.blackboard-mcp/`, `~/.blackboard-study-hub/`, API keys and personal paths (e.g. `C:\Users\<name>`) must never be committed or printed in full. Check `git diff --staged` before committing.
- **Stay local.** The server binds 127.0.0.1 only and checks Host/Origin. Do not add anything that sends student data to a third party; the planned AI feature uses the student's own API key, stored locally.
- **Zero dependencies** for now: Node built-ins only, so the app can ship as a portable zip.
- **Windows first.** The owner uses Windows + Edge. In Claude Code's `!` shell (Git Bash) use forward slashes in paths.
- UI text is Chinese; README is bilingual. Times come from the API in UTC; display in local time.

## Versions and releases

- The owner wants a new release for every change pushed to `main`: bump the patch number by one each time (v0.2.0 → v0.2.1 → v0.2.2 …), set the same number in `package.json` `version`, commit, then push the tag (`git tag v0.2.1 && git push origin v0.2.1`). The Release workflow builds and publishes the Windows zip.
- Bump the middle number (v0.3.0) only when the owner says a stage or big feature is finished.

## Roadmap

Order agreed with the owner (2026-10-22): **functional modules first, then UI design, then the first-run guide**, because the guide walks through every feature and would need redoing after each change.

- Done: pop-up sign-in with silent renewal; blackboard-mcp bundled in vendor/ (rebuild with `npm run vendor`, keep vendor/THIRD-PARTY-NOTICES.txt in sync); course file downloader (not yet: attachments and files embedded in page bodies); Windows portable zip via the Release workflow; module 1, five-colour deadlines with the adjustable timeline and links to Blackboard.
- Next: the remaining functional modules (e.g. weekly digest, study packs, AI Q&A with the student's own API key). Keep their UI plain and consistent with the current page; no visual redesign yet.
- Then: UI redesign, after walking through the whole dashboard with the owner and agreeing on their vision.
- Then: first-run guide with the FAQ as its last page and an always-available help button (spec: `docs/dev/step5-onboarding.md`), then README screenshots, then a public launch.
- Keep `docs/FAQ.md` current as features change, including the Windows run warnings (click 运行 / 更多信息 → 仍要运行).

Progress is logged in the owner's GITHUB_PROGRESS.md.
