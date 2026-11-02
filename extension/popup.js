// Runs every time the popup opens: shows the saved deadlines and the last sync,
// and asks the background (background.js) to sync again on Sync now.

import { sortByStart, upcoming, groupByDay, daysUntil } from "./deadlines.js";
import { sampleDeadlines } from "./sample.js";
import { toIcs } from "./calendar.js";
import { loadDeadlines } from "./store.js";
import { loadSummary } from "./summary.js";
import { getToken, isSignedIn, signOut } from "./google.js";

// What the list shows right now, so Download .ics saves the same thing
let shown = [];

async function main() {
  const now = new Date();
  showToday(now);
  byId("download-ics").addEventListener("click", () => downloadIcs(shown));

  // popup.html?demo shows made-up deadlines, for screenshots with no private info
  if (new URLSearchParams(location.search).has("demo")) {
    byId("sync-now").hidden = true;
    byId("google").hidden = true;
    draw(sampleDeadlines(now), now, "No upcoming deadlines.");
    setStatus("Demo mode: made-up deadlines");
    return;
  }

  byId("sync-now").addEventListener("click", syncNow);
  byId("sign-in").addEventListener("click", signIn);
  byId("sign-out").addEventListener("click", signOutClicked);
  showGoogle(await isSignedIn());

  try {
    await showSaved(now);
  } catch {
    draw([], now, "No upcoming deadlines.");
    setStatus("Couldn't open saved deadlines");
  }
}

// Draws the saved list and the last sync's status and problems.
async function showSaved(now) {
  const saved = await loadDeadlines();
  const summary = await loadSummary();
  const emptyText = saved.savedAt
    ? "No upcoming deadlines."
    : "Nothing saved yet. Press Sync now to read Learn and Crowdmark.";
  draw(saved.deadlines, now, emptyText);
  showErrors(summary ? summary.errors : []);
  if (summary) {
    setStatus(summaryLabel(summary, now));
  } else {
    setStatus(saved.savedAt ? `Last updated ${whenLabel(saved.savedAt, now)}` : "");
  }
}

// Asks the background to read Learn and Crowdmark and update the calendar, then redraws.
// The work happens in the background, so it finishes even if the popup closes.
async function syncNow() {
  const button = byId("sync-now");
  button.disabled = true;
  setStatus("Syncing...");
  try {
    const summary = await chrome.runtime.sendMessage({ type: "sync-now" });
    if (!summary) throw new Error("no answer");
    await showSaved(new Date());
  } catch {
    setStatus("Sync failed");
  } finally {
    button.disabled = false;
  }
}

// Opens Google's sign-in window, then syncs straight away.
async function signIn() {
  try {
    await getToken({ interactive: true });
    showGoogle(true);
    await syncNow();
  } catch (error) {
    showErrors([error.message]);
  }
}

async function signOutClicked() {
  await signOut();
  showGoogle(false);
  setStatus("Signed out. Deadlines still update here.");
}

function showGoogle(signedIn) {
  byId("google-status").textContent = signedIn ? "Signed in to Google" : "Google Calendar:";
  byId("sign-in").hidden = signedIn;
  byId("sign-out").hidden = !signedIn;
}

// "Last synced 2:15 p.m.: 2 added, 1 updated", or a note to sign in
function summaryLabel(summary, now) {
  const when = `Last synced ${whenLabel(summary.time, now)}`;
  if (!summary.calendar) {
    return summary.signedIn ? when : `${when}. Sign in to add them to Google Calendar.`;
  }
  const { added, updated, failed } = summary.calendar;
  const parts = [];
  if (added) parts.push(`${added} added`);
  if (updated) parts.push(`${updated} updated`);
  if (failed) parts.push(`${failed} failed`);
  return `${when}: ${parts.length ? parts.join(", ") : "calendar up to date"}`;
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
