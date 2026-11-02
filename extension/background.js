// The background part of the extension: syncs every hour, and whenever the popup asks.
// One sync = read Learn and Crowdmark again (store.js), then put the deadlines on Google Calendar
// (calendar-sync.js) if you're signed in. Chrome starts this file when something needs it and stops
// it when it's idle, so the hourly timer lives in chrome.alarms, not in a variable here.

import { refreshDeadlines } from "./store.js";
import { syncToGoogle } from "./calendar-sync.js";
import { getToken, isSignedIn } from "./google.js";
import { saveSummary } from "./summary.js";

export const ALARM_NAME = "sync";
export const SYNC_EVERY_MINUTES = 60;

// The sync running right now. A second request gets this same one instead of starting another,
// so two syncs can never add the same event twice.
let running = null;

// interactive: true shows Google's sign-in window if needed (only when you clicked something)
// readers: only passed by tests; normally the real Learn and Crowdmark readers are used
export function syncAll({ interactive = false, readers } = {}) {
  if (!running) {
    running = runSync({ interactive, readers }).finally(() => {
      running = null;
    });
  }
  return running;
}

async function runSync({ interactive, readers }) {
  const summary = { time: new Date().toISOString(), deadlines: 0, signedIn: false, calendar: null, errors: [] };
  try {
    const result = await refreshDeadlines({ readers });
    summary.deadlines = result.deadlines.length;
    summary.errors.push(...result.errors);

    summary.signedIn = await signedIn(interactive, summary.errors);
    if (summary.signedIn) {
      const counts = await syncToGoogle(result.deadlines, { getToken: () => getToken({ interactive: false }) });
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

// The popup sends { type: "sync-now" }. Only messages from this extension are answered.
export function onMessage(message, sender, sendResponse) {
  if (sender.id !== chrome.runtime.id || !message || message.type !== "sync-now") {
    return false;
  }
  syncAll({ interactive: message.interactive === true }).then(sendResponse, () => sendResponse(null));
  // true keeps the reply open until the sync finishes
  return true;
}

// Chrome needs these set up as soon as the file runs, every time it starts.
chrome.runtime.onInstalled.addListener(startTimer);
chrome.runtime.onStartup.addListener(startTimer);
chrome.alarms.onAlarm.addListener(onAlarm);
chrome.runtime.onMessage.addListener(onMessage);
