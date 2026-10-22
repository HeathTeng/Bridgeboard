# First-run guide and help

> On hold: the owner wants all functional modules and the UI redesign done first, so the guide is built once against the final page. Pages 2 to 4 below will need updating to match.

Spec for Claude Code. Read CLAUDE.md first; its rules apply (zero dependencies, Chinese UI, no innerHTML for content).

## Goal

Someone who has never seen the hub opens it and knows what to do without reading the README. Whenever they get stuck later, help is one click away.

## What the student sees

- **First launch:** a guide opens on top of the page. It has a few short pages with 上一步 / 下一步, page dots, and a 跳过 link:
  1. 欢迎: what the hub does in three lines (deadlines, announcements and grades in one place; course files to a folder; everything stays on your computer).
  2. 连接 Blackboard: enter the school address, click the button, sign in in the pop-up window. Say clearly: **when the school asks "保持登录状态？", choose 是**. Keep the black window open while using the hub.
  3. 截止日期和日历: what the groups mean, and how 导出到日历 works (import the .ics into Google/Outlook/Apple Calendar).
  4. 课程文件: choose a folder (a USB drive works), tick files, download; the .txt option is for AI tools; files already there are skipped.
  5. 常见问题 (last page): the content of `docs/FAQ.md`.
  The last page's button is 开始使用.
- **Help button:** a 帮助 button in the header reopens the guide at page 1, and a 常见问题 link next to it (or in the footer) opens it straight at the FAQ page.
- The guide is not shown again after it is finished or skipped once. Remember this in `~/.blackboard-study-hub/settings.json` (`guideSeen: true`), so it survives a new browser or profile.

## Owner's notes (2026-10-22)

- Every tip or hint text in the app starts with a small lightbulb icon (💡 or an equivalent inline SVG). The help button and the FAQ page use the same lightbulb, so the lightbulb always means "help".
- The guide can be reopened at any time from the lightbulb help button.
- Guide pages are data, not code: keep them in one file (for example `public/guide.js` exporting a list of pages with title, text and optional image), so adding a feature later means adding one page there.

## FAQ as the single source

- `docs/FAQ.md` stays the only place the FAQ is written; the page reads it, so updating the file updates the app. Serve it from a read-only route (e.g. `GET /api/faq` returning the text) rather than exposing the whole `docs/` folder.
- Render a small Markdown subset with DOM methods and `textContent` (headings `##`, paragraphs, `-` lists, `**bold**`, links). Links open in a new tab and only allow `https:`. No `innerHTML`.
- Update the FAQ where steps 3 and 4 changed things: the portable zip (no Node.js needed; unzip first, don't run from inside the zip), the folder picker, and where downloaded files go. Remove anything that is no longer true.

## Design

- Plain HTML/CSS/JS in `public/`, matching the current style and dark mode. Readable at phone width.
- Accessible: it is a dialog (`role="dialog"`, `aria-modal`, focus moves into it and back to the help button when closed), Esc closes it, arrow keys move between pages.
- Small illustrations are optional; reuse the existing screenshots in `docs/` if they help, served the same read-only way.

## Tests

- The Markdown renderer: headings, lists, bold, links, and that `javascript:` links and HTML tags come out as plain text.
- The `guideSeen` setting round-trips.
- Keep `npm test` passing.

## Done when

- Fresh start (delete `guideSeen` from settings) shows the guide; finishing or skipping it hides it on the next start; 帮助 and 常见问题 open it at the right page.
- Checked in demo mode in a narrow window and a wide one. Screenshot the first page and the FAQ page in demo mode into `docs/` for the README (step 6 will use them).
- `git diff` checked for cookies, personal paths and names; commit in English as HeathTeng and push.
