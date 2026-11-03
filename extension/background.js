// The background part of the extension: syncs every hour, when you open Learn or Crowdmark,
// and whenever the popup asks. One sync = read Learn and Crowdmark again (store.js), then put the
// deadlines on Google Calendar (calendar-sync.js) if you're signed in. Chrome starts this file when
// something needs it and stops it when it's idle, so the hourly timer lives in chrome.alarms.
// The sites are read through their own tabs (tabs.js): the hourly sync only uses tabs you have open,
// and Sync now opens a background tab for a site that isn't open.
// Ticking a deadline done in the popup only updates the calendar (updateCalendar), without reading the sites.

import { refreshDeadlines, siteReaders, loadDeadlines } from "./store.js";
import { loadDoneIds, markDone } from "./done.js";
import { syncToGoogle } from "./calendar-sync.js";
import { getToken, isSignedIn } from "./google.js";
import { saveSummary } from "./summary.js";
import { siteOf } from "./tabs.js";

export const ALARM_NAME = "sync";
export const SYNC_EVERY_MINUTES = 60;

// Opening Learn or Crowdmark starts a sync, but at most this often per site
export const VISIT_GAP_MINUTES = 15;
const VISITS_KEY = "visitReads";

// The sync running right now. A second request gets this same one instead of starting another,
// so two syncs can never add the same event twice.
let running = null;

// interactive: true shows Google's sign-in window if needed (only when you clicked something)
// openIfMissing: open a background tab for a site that isn't open (Sync now)
// readers: only passed by tests; normally the real Learn and Crowdmark readers are used
export function syncAll({ interactive = false, openIfMissing = false, readers } = {}) {
  if (!running) {
    running = runSync({ interactive, readers: readers || siteReaders({ openIfMissing }) }).finally(() => {
      running = null;
    });
  }
  return running;
}

async function runSync({ interactive, readers }) {
  const summary = {
    time: new Date().toISOString(),
    deadlines: 0,
    signedIn: false,
    calendar: null,
    errors: [],
    skipped: [],
  };
  try {
    const result = await refreshDeadlines({ readers });
    summary.deadlines = result.deadlines.length;
    summary.errors.push(...result.errors);
    summary.skipped.push(...result.skipped);

    summary.signedIn = await signedIn(interactive, summary.errors);
    if (summary.signedIn) {
      const counts = await syncDone(result.deadlines);
      const { added, updated, unchanged, failed } = counts;
      summary.calendar = { added, updated, unchanged, failed };
      summary.errors.push(...counts.errors);
    }
  } catch (error) {
    summary.errors.push(shortMessage(error));
  }
  await saveSummary(summary);
  return summary;
}

// Puts the deadlines on Google Calendar, with "Done: " on the ones ticked off in the popup.
async function syncDone(deadlines) {
  const doneIds = await loadDoneIds();
  return syncToGoogle(markDone(deadlines, doneIds), { getToken: () => getToken({ interactive: false }) });
}

// After a tick in the popup: update the calendar from the saved deadlines, without reading Learn
// or Crowdmark. It shares the one-sync-at-a-time lock, so it can't add an event twice either.
// If a full sync is already running, that one is used instead (the next sync picks up the tick).
export function updateCalendar() {
  if (!running) {
    running = runCalendarUpdate().finally(() => {
      running = null;
    });
  }
  return running;
}

// Returns the calendar counts, or null if you're not signed in to Google.
async function runCalendarUpdate() {
  if (!(await isSignedIn())) {
    return null;
  }
  const saved = await loadDeadlines();
  const { added, updated, unchanged, failed } = await syncDone(saved.deadlines);
  return { added, updated, unchanged, failed };
}

async function signedIn(interactive, errors) {
  if (!interactive) {
    return isSignedIn();
  }
  try {
    await getToken({ interactive: true });
    return true;
  } catch (error) {
    errors.push(shortMessage(error));
    return false;
  }
}

// Our own messages ("Couldn't ...") are kept; anything else becomes a plain line.
function shortMessage(error) {
  const message = error && typeof error.message === "string" ? error.message : "";
  return message.startsWith("Couldn't") || message.startsWith("Google Calendar")
    ? message
    : "Sync failed";
}

// Makes the hourly alarm, unless it already exists (so restarting Chrome doesn't stack them).
export async function startTimer() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 1, periodInMinutes: SYNC_EVERY_MINUTES });
  }
}

export function onAlarm(alarm) {
  if (alarm.name === ALARM_NAME) {
    syncAll();
  }
}

// The popup sends { type: "sync-now" } or, after a tick, { type: "update-calendar" }.
// Only messages from this extension are answered.
export function onMessage(message, sender, sendResponse) {
  if (sender.id !== chrome.runtime.id || !message) {
    return false;
  }
  let work;
  if (message.type === "sync-now") {
    work = syncAll({ interactive: message.interactive === true, openIfMissing: true });
  } else if (message.type === "update-calendar") {
    work = updateCalendar();
  } else {
    return false;
  }
  work.then(sendResponse, () => sendResponse(null));
  // true keeps the reply open until the sync finishes
  return true;
}

// A Learn or Crowdmark tab finished loading: sync, unless that site started one in the last 15 minutes.
// The times are kept in chrome.storage.session, which lives in memory and is gone when Chrome closes.
export async function onTabUpdated(tabId, change, tab) {
  const site = change.status === "complete" && tab ? siteOf(tab.url) : null;
  if (!site) {
    return null;
  }
  const visits = (await chrome.storage.session.get(VISITS_KEY))[VISITS_KEY] || {};
  const now = Date.now();
  if (typeof visits[site] === "number" && now - visits[site] < VISIT_GAP_MINUTES * 60 * 1000) {
    return null;
  }
  await chrome.storage.session.set({ [VISITS_KEY]: { ...visits, [site]: now } });
  return syncAll();
}

// Chrome needs these set up as soon as the file runs, every time it starts.
chrome.runtime.onInstalled.addListener(startTimer);
chrome.runtime.onStartup.addListener(startTimer);
chrome.alarms.onAlarm.addListener(onAlarm);
chrome.runtime.onMessage.addListener(onMessage);
chrome.tabs.onUpdated.addListener(onTabUpdated);
