// Runs every time the popup opens: shows the saved deadlines and the last sync,
// and asks the background (background.js) to sync again on Sync now.

import { sortByStart, upcoming, groupByDay, daysUntil } from "./deadlines.js";
import { sampleDeadlines } from "./sample.js";
import { toIcs } from "./calendar.js";
import { loadDeadlines } from "./store.js";
import { loadSummary } from "./summary.js";
import { getToken, isSignedIn, signOut } from "./google.js";
import { loadDoneIds, saveDoneIds, markDone } from "./done.js";

// What the list shows right now, so Download .ics saves the same thing
let shown = [];

// The ids of deadlines ticked off as done, and the ids of every saved deadline
// (so ids of deadlines that are gone get dropped when saving)
let doneIds = new Set();
let savedIds = new Set();

// Demo mode ticks boxes on screen only and never saves them
let demo = false;

async function main() {
  const now = new Date();
  showToday(now);
  byId("download-ics").addEventListener("click", () => downloadIcs(shown));

  // popup.html?demo shows made-up deadlines, for screenshots with no private info
  if (new URLSearchParams(location.search).has("demo")) {
    demo = true;
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
  doneIds = await loadDoneIds();
  savedIds = new Set(saved.deadlines.map((deadline) => deadline.id));
  const emptyText = saved.savedAt
    ? "No upcoming deadlines."
    : "Nothing saved yet. Press Sync now to read Learn and Crowdmark.";
  draw(saved.deadlines, now, emptyText);
  showErrors(summary ? summary.errors : [], summary ? skippedNotes(summary.skipped, saved.sources, now) : []);
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

// One line per source that couldn't be read, like "Couldn't read Crowdmark",
// then quieter notes for sources that were skipped because they weren't open
function showErrors(errors, notes = []) {
  const box = byId("errors");
  box.replaceChildren(
    ...errors.map((error) => textElement("p", "error", error)),
    ...notes.map((note) => textElement("p", "note", note)),
  );
  box.hidden = errors.length === 0 && notes.length === 0;
}

// "Learn wasn't open: showing what it had at 2:15 p.m." for each skipped source
function skippedNotes(skipped, sources, now) {
  const names = { learn: "Learn", crowdmark: "Crowdmark" };
  return skipped
    .filter((site) => names[site])
    .map((site) => {
      const last = sources[site] ? new Date(sources[site]) : null;
      return last && !Number.isNaN(last.getTime())
        ? `${names[site]} wasn't open: showing what it had at ${whenLabel(last, now)}`
        : `${names[site]} hasn't been read yet: open it, or press Sync now`;
    });
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

// One row: coloured bar by type, a done checkbox, course and title, time on the right.
// The text sits inside the checkbox's <label>, so clicking the title ticks it too
// and screen readers read the title as the checkbox's name.
function deadlineRow(deadline) {
  const row = document.createElement("article");
  row.className = `deadline deadline--${deadline.type}`;

  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "deadline-done";
  box.checked = doneIds.has(deadline.id);
  box.addEventListener("change", () => doneChanged(deadline, box, row));

  const text = document.createElement("span");
  text.className = "deadline-text";
  text.append(
    textElement("span", "deadline-course", deadline.course || typeLabel(deadline.type)),
    textElement("span", "deadline-title", deadline.title),
  );

  const label = document.createElement("label");
  label.className = "deadline-label";
  label.append(box, text);

  row.append(label, textElement("span", "deadline-when", timeLabel(deadline)));
  row.classList.toggle("deadline--done", box.checked);
  return row;
}

// Ticked or unticked: grey the row out (or back), save it, then update the calendar.
async function doneChanged(deadline, box, row) {
  const done = box.checked;
  row.classList.toggle("deadline--done", done);
  // Changed here first and then the whole set is saved, so two quick ticks can't undo each other
  if (done) doneIds.add(deadline.id);
  else doneIds.delete(deadline.id);
  if (demo) {
    return;
  }
  try {
    await saveDoneIds(doneIds, { knownIds: savedIds });
  } catch {
    // Couldn't save, so put the box back the way it was
    if (done) doneIds.delete(deadline.id);
    else doneIds.add(deadline.id);
    box.checked = !done;
    row.classList.toggle("deadline--done", !done);
    setStatus("Couldn't save that");
    return;
  }
  // Only the calendar is updated (Learn and Crowdmark aren't read again). Not waited for,
  // and if it fails the next sync puts "Done: " on the event anyway.
  chrome.runtime.sendMessage({ type: "update-calendar" }).catch(() => {});
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
  const file = new Blob([toIcs(markDone(deadlines, doneIds))], { type: "text/calendar" });
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
