// A short note about the last sync: when it ran, how many deadlines, what changed on the calendar,
// and any problems. background.js writes it after every sync and the popup reads it.
// It never holds a token: only times, counts and short messages.

export const SUMMARY_KEY = "lastSync";

// At most this many problem lines are kept, so the popup stays short
export const MAX_ERRORS = 5;

export async function saveSummary(summary) {
  await chrome.storage.local.set({
    [SUMMARY_KEY]: { ...summary, errors: summary.errors.slice(0, MAX_ERRORS) },
  });
}

// Returns the last summary, or null if there's none (or it's not the right shape).
export async function loadSummary() {
  const summary = (await chrome.storage.local.get(SUMMARY_KEY))[SUMMARY_KEY];
  if (typeof summary !== "object" || summary === null || typeof summary.time !== "string") {
    return null;
  }
  const time = new Date(summary.time);
  if (Number.isNaN(time.getTime())) {
    return null;
  }
  return {
    time,
    deadlines: Number(summary.deadlines) || 0,
    signedIn: summary.signedIn === true,
    calendar: isCounts(summary.calendar) ? summary.calendar : null,
    errors: Array.isArray(summary.errors) ? summary.errors.filter((e) => typeof e === "string") : [],
  };
}

function isCounts(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    ["added", "updated", "unchanged", "failed"].every((key) => Number.isInteger(value[key]))
  );
}
