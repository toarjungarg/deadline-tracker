// Runs every time the popup opens: shows the saved deadlines, and reads them again on Refresh.

import { sortByStart, upcoming, groupByDay, daysUntil } from "./deadlines.js";
import { sampleDeadlines } from "./sample.js";
import { toIcs } from "./calendar.js";
import { loadDeadlines, refreshDeadlines } from "./store.js";

// What the list shows right now, so Download .ics saves the same thing
let shown = [];

async function main() {
  const now = new Date();
  showToday(now);
  byId("download-ics").addEventListener("click", () => downloadIcs(shown));

  // popup.html?demo shows made-up deadlines, for screenshots with no private info
  if (new URLSearchParams(location.search).has("demo")) {
    byId("refresh").hidden = true;
    draw(sampleDeadlines(now), now, "No upcoming deadlines.");
    setStatus("Demo mode: made-up deadlines");
    return;
  }

  byId("refresh").addEventListener("click", refresh);
  try {
    const saved = await loadDeadlines();
    const emptyText = saved.savedAt
      ? "No upcoming deadlines."
      : "Nothing saved yet. Press Refresh to read Learn and Crowdmark.";
    draw(saved.deadlines, now, emptyText);
    setStatus(saved.savedAt ? `Last updated ${whenLabel(saved.savedAt, now)}` : "");
  } catch {
    draw([], now, "No upcoming deadlines.");
    setStatus("Couldn't open saved deadlines");
  }
}

// Reads Learn and Crowdmark again, saves, and redraws.
async function refresh() {
  const button = byId("refresh");
  button.disabled = true;
  setStatus("Reading Learn and Crowdmark...");
  try {
    const result = await refreshDeadlines();
    const now = new Date();
    draw(result.deadlines, now, "No upcoming deadlines.");
    showErrors(result.errors);
    setStatus(result.savedAt ? `Last updated ${whenLabel(result.savedAt, now)}` : "Nothing read yet");
  } catch {
    setStatus("Refresh failed");
  } finally {
    button.disabled = false;
  }
}

// Keeps today's and later deadlines, earliest first, and draws them.
function draw(deadlines, now, emptyText) {
  shown = sortByStart(upcoming(deadlines, now));
  byId("empty").textContent = emptyText;
  showDeadlines(shown, now);
}

// One line per source that couldn't be read, like "Couldn't read Crowdmark"
function showErrors(errors) {
  const box = byId("errors");
  box.replaceChildren(...errors.map((error) => textElement("p", "error", error)));
  box.hidden = errors.length === 0;
}

// "2:15 p.m." for today, "Nov 1, 2:15 p.m." for earlier days
function whenLabel(date, now) {
  if (daysUntil(date, now) === 0) return formatTime(date);
  return date.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
