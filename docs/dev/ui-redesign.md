# UI redesign: Bridgeboard

Spec for Claude Code. Read CLAUDE.md first (rules, the user we design for, versions). All functional modules are done; this stage changes how the page looks and reads, not what it does.

Agreed with the owner on 2026-10-23 after walking through demo mode. The approved look is the mockup at `https://claude.ai/artifact/4ZqERX8YCQz9RSf68feMnf` (a static HTML file; the owner can open it, Claude Code may not be able to, so everything needed is written here).

## What the owner said

1. The page carries too much text and feels stiff. Every section should fold up, so a student sees one line per section until they open it.
2. Users are Chinese international students. English course and assignment names should get Chinese glosses **per term** (Management 管理学, Quiz 小测), never a full translation, because every student's courses are different.
3. Colours should sit close to Blackboard so jumping there is not jarring, with a darker title area. The school's Blackboard (PSB) is a charcoal sidebar with crimson highlights on white. Decision: charcoal header band that fades into deep green and then pale green; **green accent, not the school red**, because red already means 逾期 on this page and other schools use other colours.
4. Semi-transparent, frosted-glass cards, and let the layout guide the eye (a "today" summary first) instead of explanations.

Plus the UI items collected earlier (handover, section 6): five-colour countdown capsules, three themes, phone-width layout, nicer nav and 回到顶部, Reminders-style checklist, one lightbulb style, one privacy line for the whole page, rename to Bridgeboard, a feedback button.

Out of scope here: drag-and-drop layout (dropped to optional; ask the owner at the end), the login features on the website (weekly digest, phone checklist: separate spec after this stage), the first-run guide (next stage).

## Work in five releases

Each step is its own commit, test run and patch release (v0.2.9, v0.2.10, …), in this order. Step 1 goes first because the website (getboundly.com) waits for the new name and the fixed download link.

### Step 1: rename to Bridgeboard, feedback, privacy line

- Page `<title>` and header: **Bridgeboard**, with a small subtitle **Blackboard 学习面板** underneath, so a student who downloaded "Bridgeboard" still sees what it is for.
- A simple wordmark: the word Bridgeboard in the display face, plus a small inline SVG bridge mark (no image files, no external fonts that need the network; see "Fonts" below). Also use the mark as the favicon (inline SVG data URI).
- README title and intro, `package.json` name `bridgeboard`, `scripts/build-portable.sh`: the folder inside the zip becomes `Bridgeboard`, the versioned zip `Bridgeboard-<version>-windows.zip`. The release workflow **also uploads the same zip a second time under the fixed name `Bridgeboard-Windows.zip`** (exactly this name; the website links to `/releases/latest/download/Bridgeboard-Windows.zip`). Update the release notes text.
- Phone alert test message title, server start-up line, README and FAQ wording: Bridgeboard.
- **Do not rename these**, or existing users lose data or get duplicates:
  - the data folder `~/.blackboard-study-hub/` (checklist, settings, sent log, browser profile);
  - the calendar UID suffix `@blackboard-study-hub` in `lib/ics.js` (a new UID makes every imported deadline appear twice);
  - the Startup file name `blackboard-study-hub.cmd` in `lib/autostart.js` (a new name leaves the old one behind and starts the panel twice);
  - the `/api/ping` app id `blackboard-study-hub` (an old copy still running must be recognised). Add a comment at each of these saying why the old name stays.
- Footer: one privacy line for the whole page, with a lock icon: **你的数据只保存在这台电脑上，我们收不到。** Keep the per-feature notes that say what leaves the computer (phone alerts) since those are exceptions; drop the repeated "只保存在这台电脑上" lines from the checklist and messages sections.
- **意见反馈** link in the footer and in the help area: a `mailto:bridgeboard.feedback@gmail.com` with the subject `Bridgeboard 意见反馈 v<version>` and a body that starts with the version and Windows version placeholder lines for the student to fill. The panel sends nothing itself. Next to it, show the address as selectable text with a 复制 button, because some computers have no mail app and the link then does nothing.
- The GitHub repository itself is renamed by the owner (Settings → Repository name → `Bridgeboard`); old links redirect. Update links in README, FAQ and the build script after that.

### Step 2: the look (tokens, glass, themes, capsules)

All colours are CSS custom properties on `:root`; components use only tokens. Starting values (from the mockup; fine-tune by eye):

| Token | 白天 | 夜间 |
| --- | --- | --- |
| header band (top of the page wash) | `#141c19` → `#1e4434` → `#dcefe5` → page | `#062a1f` → `#0b3b2c` → `#0b1f18` |
| page background | `#eef6f1` | `#0b1f18` |
| glass card | `rgba(255,255,255,.66)`, border `rgba(255,255,255,.75)` | `rgba(24,52,42,.58)`, border `rgba(255,255,255,.08)` |
| text / muted | `#12261d` / `#4f6b5e` | `#e3f2ea` / `#9dbcae` |
| accent | `#157a55` | `#4cc797` |
| status: 逾期 / 临期 / 刚开放 / 还有时间 / 已完成 | `#c4372d` / `#d4570f` / `#2563c9` / `#a07400` / `#1d8a5a` | `#ff7d72` / `#ff9a57` / `#7aa7ff` / `#f0c84b` / `#5fd49b` |

- **Page wash**: a vertical gradient on `body`: solid charcoal behind the header (about the first 150 px), then deep green, then pale green, then the page colour. The header text sits on the dark band in light colours.
- **Glass cards**: `backdrop-filter: blur(18px) saturate(1.2)`, rounded 18 px, soft shadow. Under `@supports not (backdrop-filter: blur(1px))` and under `prefers-reduced-transparency: reduce`, use solid card colours. Rows inside a card use a slightly more opaque glass so text stays readable.
- **Three themes**: 显示设置 gets 主题: 跟随电脑 (default) / 白天 / 夜间 / 护眼. Saved as `display.theme` in settings.json (`checkDisplay` validates it), applied as `data-theme` on `<html>`. Dark mode must keep working when "跟随电脑" is chosen (current behaviour). **护眼**: warm, lower brightness: paper-like background around `#efe6d2`, text around `#3a3126`, accent a muted green around `#4f7a52`, warmer glass; keep text contrast at least 4.5:1 and the five status colours distinguishable. To avoid a white flash on load, also keep the choice in `localStorage` and apply it from a tiny script loaded in `<head>` before the stylesheet renders (no inline scripts).
- **Five-colour capsules**: replace the dot + text badge with a horizontal pill: semi-transparent fill of the status colour (about 15%), 1 px border (about 30%), text in the status colour, tabular numbers. Text is Chinese and short: `逾期 2 天`, `6 小时`, `刚开放 · 12 天`, `9 天`, `已完成`. Use the existing time-left labels in `lib/status.js`; adjust them there (with tests) if they read too long in a pill. Keep the group headings and a small colour legend at the top of the deadlines section, so colour is never the only signal.
- **Nav bar**: a glass pill bar, sticky at the top; the section in view is a filled accent pill; counts are small pills. Scrolls sideways on narrow screens.
- **回到顶部**: floating glass pill bottom-right, clear of the safe area.
- **Lightbulb**: one style everywhere: `.tip` keeps the 💡; the help button and FAQ entry point use the same 💡, so the bulb always means help.
- **Fonts**: no web fonts (the panel works offline and loads nothing from the internet). Headings and the wordmark use a system stack such as `"Segoe UI Variable Display", "Segoe UI", "Microsoft YaHei UI", sans-serif` with weight 600 to 700; body `"Segoe UI", "Microsoft YaHei", system-ui, sans-serif`.

### Step 3: folding sections and the "today" guide

- **Every section folds.** The section heading becomes a full-width button (`aria-expanded`, `aria-controls`) with: an icon, the section name, a one-line summary, and a chevron. Folded, only that row shows. The summary hides when the section is open.
- **Summaries** (computed from the data already on the page; put the wording in a browser-safe `lib/section-summary.js` with unit tests, served like `/display.js`):
  - 截止日期: `1 项逾期 · 1 项临期 · 最近一项还剩 6 小时`; nothing due: `最近没有要交的作业`.
  - 清单: `还有 3 件没做`; empty: `清单是空的，点开添加`.
  - 课程消息: `2 条未读 · 最新：<sender>「<first words>」`; none unread: `没有未读消息`.
  - 公告: `最近 2 条 · <latest title>`.
  - 成绩: `<n> 门课 · <k> 项等待评分`.
  - 课程文件: `<n> 门课可下载 · 保存到 <folder>` or `还没选择保存位置`.
  - 手机提醒: `已打开 · Bark` / `还没打开 · 3 步就能让作业快到期时手机响`.
  - Signed out or loading: `正在读取…` / `连接 Blackboard 后显示`.
- **Order and default open** (changed by the owner on 2026-10-23, replacing "截止日期 and 清单 open"): 截止日期, 课程文件, 手机提醒 first, side by side in three equal columns on a wide screen (stacked below about 1000 px; long content shows the most urgent few, then 显示全部), then 清单, 课程消息, 公告, 成绩 full width. 截止日期 and 课程文件 open; 手机提醒 open until alerts are on, then folded to `已打开 · Bark`; the rest folded. Per-course sections put earlier terms into a 往期课程（N 门） fold at the bottom (`lib/terms.js`), unless the course still has work, an unread message or a grade waiting. Each section's open/closed state is remembered (`display.collapsed`, a list of section ids, validated by `checkDisplay`; one entry in `SECTIONS` still defines a section). 恢复默认 restores it.
- Clicking a nav item, a "today" chip, or a link to a section **opens** that section before scrolling to it. Error states inside a folded section open it (a student must not miss an error).
- **今天要注意** card at the top (signed in only), above the nav: up to three chips that each jump to their section: overdue count with the first title and how long ago; due-soon count with the first title and time left; unread messages count with the course. Chips use the status colours. When there is nothing: `今天没有要紧的事`. Keep the wording calm: no exclamation marks, no flashing, no red dot badges.
- **Less text by default**:
  - How-to explanations move behind one small `💡 怎么用？` button per section (opens an inline box under it; not remembered). This includes: the timeline help, the "点作业标题直达 Blackboard" note, the checklist explanation, the messages explanation, the downloader explanation.
  - **These stay visible** because a beginner gets hurt without them: what phone alerts send to Bark/ntfy, the ntfy topic is like a password, the cURL box is a login credential, keep the black window open, the server-gone banner, every error and empty state.
  - The deadline timeline sliders fold behind `调整时间轴` inside the deadlines section (they stay in that section; they are used rarely).
  - Deadlines show the four most urgent items, then `再显示 N 项（含已完成）`.
  - Grades: folded per course; the course row shows the average bar and percentage; opening it shows every item as now.
  - Announcements: titles only, as now (bodies already fold).

### Step 4: Chinese glosses for terms

- New browser-safe `lib/glossary.js` (served as `/glossary.js`): a built-in list of English term → Chinese, and `glossSegments(text)` that returns segments `[{ text }, { text, zh }]` for rendering with `textContent` (never `innerHTML`).
- Matching: case-insensitive, whole words only, **longest match first** (`Data Storytelling` before `Data`), each term glossed once per string. No match: text unchanged. Never gloss inside codes like `MGTG200520261001FTC`, group letters (`Group T U V W X`) or people's names.
- Rendering: the English stays as it is; the Chinese follows the term in a smaller, lighter accent-coloured span, e.g. `Management · 管理学`. Screen readers get it too (it is real text).
- Where: course names (full and short), assignment titles, grade item names, announcement titles, message thread course names, file-section course names. Not in message or announcement bodies, file names, or anything the student types.
- Display setting **课程词条中文：显示 / 不显示** (default 显示), `display.gloss`.
- Starting list (about 120 entries; grow it from the owner's real course list). Groups:
  - Subjects: Management 管理学, Marketing 市场营销, Macroeconomics 宏观经济学, Microeconomics 微观经济学, Economics 经济学, Accounting 会计, Finance 金融, Descriptive Analytics 描述性分析, Predictive Analytics 预测分析, Business Analytics 商业分析, Data Storytelling 数据叙事, Data Collection Methods 数据收集方法, Academic Reading & Writing 学术阅读与写作, Statistics 统计学, Business Law 商法, Human Resource Management 人力资源管理, Operations Management 运营管理, Supply Chain 供应链, Entrepreneurship 创业学, Information Systems 信息系统, PC Revolution 个人电脑革命 …
  - Assessment: Quiz 小测, MCQ 选择题, Assignment 作业, Individual Assignment 个人作业, Coursework 课程作业, CW 课程作业, Group Project 小组项目, Presentation 展示, Report 报告, Essay 论文, Case Study 案例分析, Reflection Journal 反思日志, Proposal 方案, Draft 草稿, Submission 提交, Exam 考试, Midterm 期中, Final 期末, Rubric 评分标准, Brief 作业说明, Peer Review 同学互评 …
  - Course structure: Lecture 大课, Tutorial 辅导课, Seminar 研讨课, Workshop 工作坊, Term 学期, Module 模块, Topic 主题, Week 周, Diploma 文凭, Degree 学位, FT 全日制, PT 非全日制.
- Unit tests: longest match, whole words, case, no gloss in codes and group letters, each term once, empty and odd input, segments join back to the original text exactly.
- Later (not this step): let students add their own terms in 显示设置.

### Step 5: Reminders-style checklist and phone width

- **Checklist like iPhone 提醒事项**: round checkboxes (already there) in a clean list with thin separators; tap the text to edit in place (already there; make it obvious with a text cursor and a light highlight on hover); the add form becomes a last row `＋ 点这里添加一件事` that turns into an input when clicked (Enter adds, Esc cancels); the due time is a small grey label at the right of the row, editable from a small calendar button. Keep the 6-second undo, the 作业清单 / 我的清单 split and the auto-ticks.
- **Phone width** (the panel still runs on the computer; this prepares the styles): at 600 px and below one column, header buttons wrap under the title, the nav scrolls sideways, "today" chips stack, rows wrap instead of overflowing, 16 px side gutters, nothing scrolls the page sideways. Test at 375 px.

## Where a beginner could get stuck (and what we do)

- **"Where did everything go?"** Folded sections look empty to someone who does not know they open. The whole heading row is the button (not just the chevron), the chevron is clearly visible, the summary line says what is inside, and the first-run guide will show it.
- **Missing an error inside a folded section**: errors open their section and the nav item shows a small warning mark.
- **Glosses look like part of the real name** and a student copies them into an email: the gloss is visibly different (smaller, coloured, after a dot) and can be switched off.
- **A wrong gloss** (a term that means something else in context): keep the list to unambiguous academic terms; the FAQ says how to report a wrong one via 意见反馈.
- **Glass makes text hard to read** on some screens: rows use more opaque glass; reduced-transparency and unsupported browsers get solid cards; 护眼 and 夜间 tested for contrast.
- **Theme confusion** ("why is it dark?"): default follows the computer; the theme switch is in 显示设置 with the four options spelled out.
- **The new name**: a student who knew "Blackboard 学习面板" sees Bridgeboard; the subtitle keeps the old description. Old shortcuts and the Startup launcher keep working because the file names they point to do not change.
- **Feedback link does nothing** on computers without a mail app: the address is shown with a 复制 button.
- **Old zip folder next to the new one**: README and FAQ say to move nothing: unzip the new version anywhere, the checklist and settings are kept in the user folder, and turn 开机自动启动 off and on again once if the folder moved.

Add each of these to `docs/FAQ.md` under the right category, as the FAQ rule in CLAUDE.md asks.

## Tests and checks for every step

- `npm test` passes; new pure code (`section-summary.js`, `glossary.js`, display settings fields) has unit tests.
- Check in demo mode: wide and 375 px; 白天, 夜间, 护眼 and 跟随电脑 with the computer in dark mode; every section folded and open; after a restart (folds, theme and gloss setting kept); signed out (only the checklist card, as now); with the server stopped (banner still shows on top of the new look).
- No `innerHTML` with data; no inline styles in HTML; section ids still match `SECTIONS`.
- `git diff --staged` checked for cookies, personal paths, names and real course data; commit in English as HeathTeng; bump the patch version; push main first, then the tag.

## Open questions for the owner

- Has `bridgeboard.feedback@gmail.com` been registered? (Step 1 needs it to work.)
- At the end: still want drag-and-drop layout, or are the fold and hide switches enough?
