// Remembers which deadlines you've ticked off as done in the popup.
// Only the deadline ids are saved (like "learn:123"), nothing else.
// A done deadline stays in the list, greyed out, and its calendar event title starts with "Done: ".

// Saved under this one name in chrome.storage.local
export const DONE_KEY = "doneIds";

// Returns the done ids as a Set. Anything that isn't a list of text is ignored.
export async function loadDoneIds(storage) {
  storage = storage || chromeStorage();
  const saved = (await storage.get(DONE_KEY))[DONE_KEY];
  return new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : []);
}

// Saves the done ids. knownIds: the ids of every saved deadline. Done ids that no longer
// match any of them are dropped, so the list doesn't keep growing forever.
export async function saveDoneIds(doneIds, { knownIds, storage } = {}) {
  storage = storage || chromeStorage();
  let ids = [...doneIds];
  if (knownIds) {
    ids = ids.filter((id) => knownIds.has(id));
  }
  await storage.set({ [DONE_KEY]: ids });
  return new Set(ids);
}

// Ticks (done = true) or unticks (done = false) one deadline, saves, and returns the new Set.
export async function setDone(id, done, { knownIds, storage } = {}) {
  const doneIds = await loadDoneIds(storage);
  if (done) {
    doneIds.add(id);
  } else {
    doneIds.delete(id);
  }
  return saveDoneIds(doneIds, { knownIds, storage });
}

// Copies of the deadlines with done: true on the ones that are done.
// calendar.js reads this to put "Done: " in front of the title.
export function markDone(deadlines, doneIds) {
  return deadlines.map((deadline) => (doneIds.has(deadline.id) ? { ...deadline, done: true } : deadline));
}

function chromeStorage() {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    throw new Error("chrome.storage isn't available here");
  }
  return storage;
}
