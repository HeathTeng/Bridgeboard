# Module 1: five-colour deadlines and links to Blackboard

Spec for Claude Code. Read CLAUDE.md first; its rules apply. Functional work only: keep the current plain style, the visual redesign comes later.

## Goal

Every deadline shows at a glance how urgent it is, with time left, and opens the assignment in Blackboard in one click.

## Status rules

Work out one status per item, checked in this order (first match wins):

| Status | Colour | Rule |
| --- | --- | --- |
| done | green | submitted |
| overdue | red | due time has passed and not submitted |
| dueSoon | orange | 12 hours or less left (the 12 is a setting, `dueSoonHours`, default 12) |
| new | blue | opened today (local date) |
| open | yellow | everything else |

- Put this in a pure function, e.g. `lib/status.js` → `statusOf(item, now, settings)`, fully unit-tested (boundaries: exactly 12 h left, due exactly now, opened yesterday 23:59 vs today 00:01, submitted but overdue = green).
- Time left label: `还剩 3 天`, `还剩 5 小时`, `还剩 40 分钟`, `已逾期 2 天`, `已提交`. Use days when 24 h or more (round down), hours below that.
- Keep the existing groups on the page (overdue / due today / upcoming / submitted) or replace them with the colours, whichever reads more clearly; colours must also have a text label (not colour alone).

## When an item "opened"

The Ultra to-do API gives a due date but may not give an opening date.

1. First check what the real data offers. With the owner's account, print **only the field names** (not values) of a to-do item, its `column`, and the matching course content item (via the column's content id, if any), and look for an availability or start date (`availability`, `adaptiveRelease`, `startDate`, `dateCreated`…). Do not print titles, ids or any values to the console or commit them.
2. Use a real opening date if one exists and is reliable.
3. Otherwise fall back to **the first time the hub saw the item**: keep `~/.blackboard-study-hub/seen.json` (item key → first-seen ISO time). Items already listed the first time this runs count as "not new" (so the first launch doesn't paint everything blue).

## Link to Blackboard

- Each deadline title becomes a link that opens the assignment page in Blackboard Ultra in a new tab.
- Find the right URL from the real data (the column usually points to a content item; Ultra assignment pages look like `/ultra/courses/<courseId>/outline/assessment/<contentId>/overview?courseId=<courseId>`). Verify it opens the right page on the owner's account.
- If the content id can't be found, link to the course outline (`/ultra/courses/<courseId>/outline`) instead.
- Links are built from the saved base URL; only `https:` links on the school's own host are allowed.

## Calendar export

The `.ics` export keeps working; add the Blackboard link as the event `URL`.

## Tests and release

- Unit tests for `statusOf`, the time-left label, the first-seen store and the link builder.
- Check in demo mode (add demo items covering all five colours) and with the real account.
- `git diff` checked for cookies, personal paths, names and real course data; commit in English as HeathTeng; bump the patch version (see CLAUDE.md) and push the tag.
