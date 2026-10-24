# First-run guide and help

Spec for Claude Code, as built in v0.2.15 (agreed with the owner on 2026-10-24; it replaces the 2026-10-22 draft). Read CLAUDE.md first; its rules apply (zero dependencies, Chinese UI, no innerHTML for content).

## Goal

A student who has never used the panel, has no patience and reads nothing knows what to do the first time it opens; whenever they get stuck later, help is one click away.

## Three parts, one set of words

All the words are in `public/guide.js`: `GUIDE_PAGES` (the nine card pages) and `TOUR_STEPS` (the spotlight steps, which point at a page and, when they use only part of it, at line numbers plus a short title; they never carry text of their own). The rules live in `lib/tour.js` (pure, served as `/tour.js`); `public/spotlight.js` draws the tour, `public/help.js` the welcome box, the cards and the flow between them.

### 1. The welcome box (first start)

The same frosted glass as the cards (not the title card's dark green, which sits right above it), dark words, centred, with the Bridgeboard logo: 「感谢您选择 **Bridgeboard**」 (the name in the brand face, bold, in `--brand-word`: deep green by day, light green at night; no underline, which would look like a link), 「下面开始新手引导」 in `--muted`, the button 开始 (`--accent`), a small link 跳过引导, and under it a small light line: 「在页面上一步步带你认识的引导只出现这一次，只有几步，建议看完。以后也可以点「💡 帮助」看文字版。」. Esc is 跳过引导.

- 开始: the spotlight tour.
- 跳过引导: still the black-window card on its own (button 知道了); that rule cannot be skipped.
- Either way `guideSeen: true` is saved when it ends; `tourSeen: true` too if the student is signed in (`flagsAfterFirstRun`).

### 2. The spotlight tour

1. 先记住一件事: a frosted card in the middle (`mustSee`: no 跳过), the first line being the first FAQ entry's title.
2. Then the real page, one place at a time: signed in, 截止日期 (`#deadlines`), 课程文件 (`#files`), 手机提醒 (`#alerts`), 我的清单 (`#addRow`), 折叠和显示设置 (`#displayBtn`), 💡 帮助 (`#helpBtn`); signed out, only 连接 Blackboard (`#login`) and 我的清单.

How it works:

- A transparent layer (`.tour-block`) covers the page, so nothing under it can be clicked; only the bubble's buttons, ← / → and Esc work, and Tab stays in the bubble. The first framed step says 「引导中页面不能点，看完再去点。」.
- The ring (`.tour-ring`) frames the element with round corners and an `--accent-deco` line and dims the rest with a wide `--tour-dim` shadow. Ring and bubble use page coordinates, so they scroll with the page; on resize, scroll and layout changes they are placed again.
- 下一步 answers at once: the ring and bubble go straight to where the target will be (page coordinates, so they need not wait), and the page scrolls the target to just under the sticky nav at the same time, with its own 0.26 s glide (`GLIDE_MS`; not the browser's smooth scroll, whose length depends on the distance). Ring and bubble transitions are 0.26 s too. Under reduced motion everything jumps straight there.
- The bubble sits below the target, else above; at phone width, or when neither fits (a tall section), it docks at the bottom of the screen.
- A target in a folded section is opened with `peekOpen` (`layout.js`) for the step and folded back after; the saved folds are not touched.
- Which steps show is decided at every move (`available` / `findStep` / `planTour`): signed in or out, and whether the target (or its section) is on the page. A target that is not there is left out; nothing is framed empty. A step without a target is a card in the middle.
- Once after the first sign-in, when the courses are on the page (`firstRunAction` → 'ask-tour', saved as `tourSeen`): 「要不要看看各个功能在哪？」 with 好 / 不用了; 好 walks the tour without the black-window card.

### 3. The card guide (💡 帮助)

The nine pages, for looking things up again: 欢迎, 先记住一件事, 连接 Blackboard (picture `docs/step-connect.png`), 截止日期 (the five colour capsules), 课程文件 (picture `docs/step-download.png`), 手机提醒（可选）, iPhone 设置要点 (starts 「用安卓的直接点下一步。」), 其他好用的, 常见问题 (button 开始使用). Page 1 has the link 在页面上再带我走一遍, which closes the cards and starts the spotlight tour. 💡 帮助 opens page 1, 常见问题 the last page (`helpAction`); the footer repeats both.

## Saved state

`guideSeen` and `tourSeen` in `~/.blackboard-study-hub/settings.json` through `POST /api/settings` (only `true` is accepted), read back by `GET /api/settings`; `lib/guide-state.js` (`guideStore({ key })`). Demo mode writes no file and remembers only while it runs, so every demo start begins with the welcome box. If the file cannot be written, the running server still remembers.

## The FAQ page

- `docs/FAQ.md` is the only place the FAQ is written. `GET /api/faq` returns `{ text }` from that one file; the two pictures come from a fixed list (`GUIDE_IMAGES` in `server.js`). Nothing else under `docs/` is reachable.
- `lib/faq.js` (no DOM, served as `/faq.js`): `parseFaq` splits by `##` group and `###` question; `inline` handles `**bold**`, `` `code` `` and `[text](https://…)`; `filterFaq` keeps questions containing every search word (any case; the group title counts); `safeHref` allows https only. Paragraphs and `-` / `1.` lists; `#` and `>` lines are skipped. HTML tags and other link schemes stay plain text.
- `help.js` draws it with DOM methods and text nodes only. Groups are `<details>`, folded except 「最重要的一条」; each question is a `<details>` too. A search box on top: matching groups open, three or fewer results open their answers, and no result says which words to try and points to 意见反馈, with 清空搜索.

## Look and accessibility

- Frosted green glass for the cards, the tour bubble and the welcome box, like a bathroom window: `--guide-glass` (clearly greener than the white cards; deep green at night, olive in 护眼; about .8 opaque, so the colours behind glow through) with `backdrop-filter: blur(40px) saturate(1.5)`, so no word or shape behind can be made out; `--guide-solid` (also green) without blur support or under reduced transparency. Quieter words on the glass use `--guide-muted` (`--muted` is not 4.5:1 on green), the name `--brand-word`, links `--text`. `--scrim` behind the cards and the welcome box, `--tour-dim` around the spotlight. Every palette has all of them; `test/tour.test.js` checks 4.5:1 with the page, the dark title card, a solid panel or a white card behind the glass.
- Every card page is the same size (600 × 470, nearly the whole screen at 600 px and below); long pages scroll inside, the buttons stay at the bottom. Pictures are at most 210 px high.
- Dialogs: `role="dialog"`, `aria-modal`, labelled by their title; focus moves in on open and back on close (after the first-start guide, to 连接 Blackboard when signed out; 💡 帮助 holds it while the sign-in check is out). The small lift-in animation never starts from invisible and is off under reduced motion. Calm wording, no exclamation marks.

## Tests

- `test/help.test.js`: the Markdown subset; FAQ groups and search; `guideSeen`; the card pages; screenshots served one by one; the dialog markup.
- `test/tour.test.js`: every spotlight target is in `index.html` and every section in `SECTIONS`; the tour borrows the pages' words; missing targets are left out (signed in / out, hidden sections); 上一步 / 下一步 skip them; the welcome → tour / 跳过 → black-window card flow; asked once after signing in; 帮助 / 常见问题 open the right card; `tourSeen`; the glass and the welcome box at 4.5:1 in every palette; the solid fallbacks.

## Screenshots

`docs/step-connect.png` and `docs/step-download.png` are taken in demo mode (headless Edge, 820 px wide at 1.5x; the login card is unhidden for the first, one course with four files ticked for the second). Retake them when those cards change.
