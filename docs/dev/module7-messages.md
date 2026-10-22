# Module 7: course messages

Spec for Claude Code. Read CLAUDE.md first (rules, the user we design for, versions). Functional work: keep the current plain style; the visual redesign comes later.

## Goal

Messages that teachers and classmates send inside Blackboard (Ultra "Messages", which are per course) are easy to miss because they live inside each course. Show them all in one place, newest first, with unread ones clearly marked.

## What the student sees

A new 课程消息 section:

- A short note under the title: 这里汇总老师和同学在 Blackboard 课程里发给你的消息，只在这台电脑上显示。
- A list of message threads across all open courses, newest first. Each row: unread dot and count, subject, full course name, who sent the latest message (if the data gives a name), time ("2 小时前", "昨天 14:30"), and a one-line preview.
- Click a row to expand it and read the thread's messages in place (plain text, newest at the bottom). A link 在 Blackboard 中打开 opens the course's messages page in a new tab so the student can reply there.
- Filter chips: 全部 / 未读, and a course dropdown.
- An unread total in the section title, e.g. 课程消息（3 条未读）.
- Empty state: 还没有课程消息。老师或同学在 Blackboard 里给你发消息后，会出现在这里。
- Not signed in: 重新连接 Blackboard 后会显示消息。

## Must not change anything in Blackboard

- Reading here must **not** mark messages as read in Blackboard, so the student still sees them as new there. Before building, check on the owner's account: note the unread count, open a thread through the hub, and confirm the unread count in Blackboard is unchanged. If the API marks messages read on fetch, only list threads (subject, preview, counts) and leave reading the full thread to Blackboard; tell the owner which way it went.
- Read-only as always: no replying or sending from the hub.

## Data (blackboard-mcp library)

- `client.listConversations(courseId, { limit })` for threads (`subject`/`title`, `messageCount`, `unreadCount`, `modifiedDate`, `lastMessagePreview`).
- `client.listConversationMessages(courseId, conversationId)` for one thread's messages (`body`, `authorId`, `createdDate`, `isRead`). Convert bodies with the library's `htmlToText`; never put Blackboard HTML into the page.
- `client.conversationCounts()` may give unread counts for all courses in one call; use it if it works, to avoid one request per course.
- First print **only field names** from the real data (never subjects, bodies or names), to confirm what exists, including whether sender names can be resolved from `authorId`.
- Cache the thread list like the overview (5 minutes, 刷新 forces), fetch thread bodies only when expanded.
- Courses where messages are turned off or forbidden: skip quietly, no error banner.
- Find the correct Ultra URL for a course's messages page and build it with `lib/links.js` rules (https, school host only).

## Beginner checks

- Unread must be obvious without colour alone (dot plus the word 未读).
- Long messages: show the first lines with 展开全文.
- Times in local time, relative when recent.

## Demo mode

Sample threads across two or three courses, some unread, with multi-message threads; nothing fetched.

## Tests and release

- Unit tests for shaping threads (sorting, unread totals, filters, preview text from HTML, link building) with fixture data.
- Check in demo mode (narrow, wide, dark) and with the real account (count only).
- `git diff` checked for cookies, personal paths, names and real course data; commit in English as HeathTeng; bump to the next patch version; push main first, then the tag.
