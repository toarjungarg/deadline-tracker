// Turns deadline records into calendar events, two ways:
//   toGoogleEvent: the shape the Google Calendar API expects (sent once Google sign-in is added)
//   toIcs:         a .ics calendar file, the standard format Google, Apple and Outlook all read.
//                  A calendar subscription link is just a web address that serves this same text.

import { startOfDay } from "./deadlines.js";

// Assignments and quizzes show as a short block that ends at the due time.
export const DEADLINE_BLOCK_MINUTES = 30;

// When the calendar block for one deadline starts and ends.
export function eventTimes(deadline) {
  if (deadline.allDay) {
    const start = startOfDay(deadline.start);
    // For all-day events the end is the start of the day after the last day
    const end = deadline.end ? startOfDay(deadline.end) : addDays(start, 1);
    return { start, end: end > start ? end : addDays(start, 1) };
  }
  if (deadline.end) {
    return { start: deadline.start, end: deadline.end };
  }
  const blockMs = DEADLINE_BLOCK_MINUTES * 60 * 1000;
  return { start: new Date(deadline.start.getTime() - blockMs), end: deadline.start };
}

// "MATH 101: Assignment 5", or "Done: MATH 101: Assignment 5" once it's ticked off (done.js)
export function eventTitle(deadline) {
  const title = deadline.course ? `${deadline.course}: ${deadline.title}` : deadline.title;
  return deadline.done === true ? `Done: ${title}` : title;
}

// One deadline as a Google Calendar event.
export function toGoogleEvent(deadline) {
  const { start, end } = eventTimes(deadline);
  const event = {
    summary: eventTitle(deadline),
    description: eventDescription(deadline),
    start: deadline.allDay ? { date: localDateString(start) } : { dateTime: start.toISOString() },
    end: deadline.allDay ? { date: localDateString(end) } : { dateTime: end.toISOString() },
    // Saved on the event so the extension can find it again and update it instead of adding a copy
    extendedProperties: { private: { deadlineId: deadline.id } },
  };
  if (isWebLink(deadline.link)) {
    event.source = { title: sourceName(deadline.source), url: deadline.link };
  }
  return event;
}

// A whole list of deadlines as the text of a .ics file.
export function toIcs(deadlines, now = new Date()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//deadline-tracker//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Deadlines",
  ];
  for (const deadline of deadlines) {
    lines.push(...icsEvent(deadline, now));
  }
  lines.push("END:VCALENDAR");
  // The .ics format wants \r\n line endings and lines no longer than 75 characters
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function icsEvent(deadline, now) {
  const { start, end } = eventTimes(deadline);
  const lines = [
    "BEGIN:VEVENT",
    // Same deadline, same UID: calendars use this to update an event instead of adding a copy
    `UID:${deadline.id}@deadline-tracker`,
    `DTSTAMP:${icsUtc(now)}`,
  ];
  if (deadline.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${icsDate(start)}`, `DTEND;VALUE=DATE:${icsDate(end)}`);
  } else {
    lines.push(`DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(end)}`);
  }
  lines.push(
    `SUMMARY:${icsText(eventTitle(deadline))}`,
    `DESCRIPTION:${icsText(eventDescription(deadline))}`,
  );
  if (isWebLink(deadline.link)) {
    lines.push(`URL:${deadline.link}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

function eventDescription(deadline) {
  const lines = [];
  if (deadline.type !== "event") {
    const due = deadline.start.toLocaleString("en-CA", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    lines.push(`Due ${due}`);
  }
  if (isWebLink(deadline.link)) {
    lines.push(deadline.link);
  }
  lines.push(`From ${sourceName(deadline.source)}`);
  return lines.join("\n");
}

function sourceName(source) {
  const names = { learn: "Learn", crowdmark: "Crowdmark", sample: "sample data" };
  return names[source] || source;
}

// Only plain http(s) links with no spaces or line breaks make it into an event.
function isWebLink(link) {
  return typeof link === "string" && /^https?:\/\/\S+$/.test(link);
}

// Backslashes, semicolons, commas and line breaks mean something special in .ics,
// so they get a \ in front. This stops a title from adding its own lines to the file.
function icsText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Long lines get split, and each extra piece starts with a space.
function foldLine(line) {
  if (line.length <= 75) {
    return line;
  }
  const pieces = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) {
    pieces.push(" " + line.slice(i, i + 74));
  }
  return pieces.join("\r\n");
}

// 2026-10-31T16:30:00.000Z becomes 20261031T163000Z
function icsUtc(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// 20261031
function icsDate(date) {
  return localDateString(date).replace(/-/g, "");
}

// 2026-10-31, using your own time zone
function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
