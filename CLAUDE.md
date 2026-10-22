# blackboard-study-hub: notes for Claude Code

A local web dashboard for Blackboard Learn Ultra, aimed at international students who are not programmers. The owner (HeathTeng) is new to coding and works mostly through Claude Code: explain changes in plain Chinese, one step at a time, and stop to ask before anything irreversible.

## Layout

- `server.js`: zero-dependency Node HTTP server on 127.0.0.1:3100. API routes plus static files from `public/`.
- `lib/bb.js`: loads blackboard-mcp's built library (`../blackboard-mcp/dist/index.js` or `BB_MCP_PATH`) and shapes data for the page. Also keep-alive and silent renewal.
- `lib/edge-login.js`: one-click sign-in. Opens Edge/Chrome with its own profile (`~/.blackboard-study-hub/browser-profile`), reads cookies over CDP on 127.0.0.1, closes the window.
- `lib/ics.js`: deadline calendar export. `lib/demo.js`: fake data for `--demo`.
- `public/`: plain HTML/CSS/JS, Chinese UI, no build step.
- `test/`: `node --test`. Run `npm test` before every commit.
- `start.bat` / `demo.bat`: double-click launchers for Windows.

## Rules

- **Read-only.** Never call Blackboard write operations (submit, quiz, mark reviewed). Never set `BLACKBOARD_MCP_ALLOW_WRITES`.
- **No secrets in git.** Cookies, cURL captures, HAR files, `~/.blackboard-mcp/`, `~/.blackboard-study-hub/`, API keys and personal paths (e.g. `C:\Users\<name>`) must never be committed or printed in full. Check `git diff --staged` before committing.
- **Stay local.** The server binds 127.0.0.1 only and checks Host/Origin. Do not add anything that sends student data to a third party; the planned AI feature uses the student's own API key, stored locally.
- **Zero dependencies** for now: Node built-ins only, so the app can ship as a portable zip.
- **Windows first.** The owner uses Windows + Edge. In Claude Code's `!` shell (Git Bash) use forward slashes in paths.
- UI text is Chinese; README is bilingual. Times come from the API in UTC; display in local time.

## Roadmap

Stage 1 (now), in order: pop-up Edge sign-in (done, needs real-school test) → course file downloader (choose files, choose folder such as a USB drive, organised by course, skip existing, optional text-for-AI export) → bundle blackboard-mcp into the project → portable Windows zip via GitHub Actions Releases → first-run guide with a always-available troubleshooting (FAQ) page → README "three steps to start".

Stage 2: UI redesign and modules (weekly digest, study packs), AI Q&A with the student's own API key, then a public launch.

Progress is logged in the owner's GITHUB_PROGRESS.md.
