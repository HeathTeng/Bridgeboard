// Builds an iCalendar (.ics) feed from to-do items, so deadlines show up in
// Google Calendar, Outlook or Apple Calendar.
import { createHash } from 'node:crypto';

function stamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escape(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545 lines are limited to 75 octets; longer ones are folded.
function fold(line) {
  const out = [];
  let rest = Buffer.from(line, 'utf8');
  while (rest.length > 75) {
    let cut = 75;
    // Never split a multi-byte UTF-8 character.
    while (cut > 0 && (rest[cut] & 0xc0) === 0x80) cut--;
    out.push(rest.subarray(0, cut).toString('utf8'));
    rest = Buffer.concat([Buffer.from(' '), rest.subarray(cut)]);
  }
  out.push(rest.toString('utf8'));
  return out.join('\r\n');
}

/**
 * Reminders in minutes before the deadline. 12 and 5 hours come first:
 * phone calendars that keep only two alerts per event (Apple Calendar shows
 * two) keep those, so the phone still reminds you with the computer off.
 */
export const REMINDERS = [720, 300, 1440, 4320];

function reminderText(minutes) {
  return minutes % 1440 === 0 ? `${minutes / 1440} 天` : `${minutes / 60} 小时`;
}

export function toIcs(todo, { reminders = REMINDERS } = {}) {
  const now = stamp(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//blackboard-study-hub//Blackboard deadlines//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Blackboard 截止日期',
  ];
  for (const t of todo) {
    if (!t.due || t.submitted) continue;
    const uid = createHash('sha1').update(`${t.courseId ?? t.course}|${t.title}`).digest('hex');
    const end = stamp(t.due);
    // A deadline is a moment; show it as a 30-minute block ending at the due time.
    const start = stamp(new Date(Date.parse(t.due) - 30 * 60 * 1000).toISOString());
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}@blackboard-study-hub`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escape(`截止：${t.title}`)}`,
      `DESCRIPTION:${escape(t.course)}`,
    );
    // URL is a URI value, not text: no escaping, and only https links.
    if (/^https:\/\/[^\s]+$/.test(t.link ?? '')) lines.push(`URL:${t.link}`);
    for (const minutes of reminders) {
      const text = `还剩 ${reminderText(minutes)}截止：${t.title}`;
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escape(text)}`, `TRIGGER:-PT${minutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
