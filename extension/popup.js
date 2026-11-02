// Runs every time the popup opens: gets the deadlines and draws them.

import { sortByStart, upcoming, groupByDay, daysUntil } from "./deadlines.js";
import { sampleDeadlines } from "./sample.js";
import { toIcs } from "./calendar.js";

function main() {
  const now = new Date();

  // For now the list is sample data. Learn and Crowdmark replace this later.
  const deadlines = sortByStart(upcoming(sampleDeadlines(now), now));

  showToday(now);
  showDeadlines(deadlines, now);
  setStatus(countLabel(deadlines.length, "sample deadline"));

  byId("download-ics").addEventListener("click", () => downloadIcs(deadlines));
}

// "Friday, October 31" under the title
function showToday(now) {
  byId("today").textContent = now.toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// One section per day, each with a heading and its deadlines.
function showDeadlines(deadlines, now) {
  const list = byId("list");
  list.replaceChildren();
  byId("empty").hidden = deadlines.length > 0;

  for (const group of groupByDay(deadlines)) {
    const section = document.createElement("section");
    section.append(textElement("h2", "day-heading", dayLabel(group.day, now)));
    for (const deadline of group.items) {
      section.append(deadlineRow(deadline));
    }
    list.append(section);
  }
}

// One row: coloured bar by type, course and title, time on the right.
function deadlineRow(deadline) {
  const row = document.createElement("article");
  row.className = `deadline deadline--${deadline.type}`;

  const text = document.createElement("div");
  text.className = "deadline-text";
  text.append(
    textElement("span", "deadline-course", deadline.course || typeLabel(deadline.type)),
    textElement("span", "deadline-title", deadline.title),
  );

  row.append(text, textElement("span", "deadline-when", timeLabel(deadline)));
  return row;
}

// "Today", "Tomorrow" or "Tuesday, Nov 4 (in 4 days)"
function dayLabel(day, now) {
  const days = daysUntil(day, now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const date = day.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });
  return `${date} (in ${days} days)`;
}

// "11:59 p.m.", "All day" or "2:00 p.m. to 4:00 p.m."
function timeLabel(deadline) {
  if (deadline.allDay) return "All day";
  const start = formatTime(deadline.start);
  return deadline.end ? `${start} to ${formatTime(deadline.end)}` : start;
}

function formatTime(date) {
  return date.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

function typeLabel(type) {
  const labels = { assignment: "Assignment", quiz: "Quiz", event: "Event" };
  return labels[type] || type;
}

// "1 sample deadline", "5 sample deadlines"
function countLabel(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Saves the list as deadlines.ics, which Apple or Google Calendar can open.
function downloadIcs(deadlines) {
  const file = new Blob([toIcs(deadlines)], { type: "text/calendar" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "deadlines.ics";
  link.click();
  // Give the download a moment to start before freeing the file from memory
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Saved deadlines.ics");
}

function setStatus(text) {
  byId("status").textContent = text;
}

// Makes an element with plain text inside. textContent means the text is
// never run as code, even if a title has HTML in it.
function textElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function byId(id) {
  return document.getElementById(id);
}

main();
