// Runs the Learn and Crowdmark readers, joins their lists and saves the result.
// Nothing here touches the popup page, so the background timer (step 8) can use it too.

import { makeDeadline, sortByStart } from "./deadlines.js";
import { readLearn } from "./learn.js";
import { readCrowdmark } from "./crowdmark.js";

// The real readers. openIfMissing: open a background tab for a site that isn't open (Sync now);
// otherwise a site with no open tab is skipped this time.
export function siteReaders({ openIfMissing = false } = {}) {
  return {
    learn: () => readLearn({ openIfMissing }),
    crowdmark: () => readCrowdmark({ openIfMissing }),
  };
}

export const DEFAULT_READERS = siteReaders();

// Everything is saved under this one name in chrome.storage.local
export const STORAGE_KEY = "saved";

// Runs every reader at once. One failing doesn't stop the others.
// A reader that was skipped (its site wasn't open) isn't an error.
// Returns { deadlines, errors, succeeded, failed, skipped }
export async function collectDeadlines(readers = DEFAULT_READERS) {
  const names = Object.keys(readers);
  const results = await Promise.allSettled(names.map((name) => readers[name]()));

  const deadlines = [];
  const errors = [];
  const succeeded = [];
  const failed = [];
  const skipped = [];
  results.forEach((result, i) => {
    const name = names[i];
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      deadlines.push(...result.value);
      succeeded.push(name);
    } else if (result.reason && result.reason.skipped === true) {
      skipped.push(name);
    } else {
      failed.push(name);
      errors.push(errorMessage(name, result.reason));
    }
  });

  return { deadlines: removeDuplicates(deadlines), errors, succeeded, failed, skipped };
}

// Reads everything again and saves it.
// A source that fails or is skipped keeps what it had last time, so the list never empties by itself.
export async function refreshDeadlines({ readers = DEFAULT_READERS, storage, now = new Date() } = {}) {
  storage = storage || chromeStorage();
  const before = await loadDeadlines(storage);
  const result = await collectDeadlines(readers);

  const notRead = [...result.failed, ...result.skipped];
  const kept = before.deadlines.filter((deadline) => notRead.includes(deadline.source));
  const deadlines = removeDuplicates([...result.deadlines, ...kept]);

  // When each source last worked, so the popup can say how fresh the list is
  const sources = { ...before.sources };
  for (const name of result.succeeded) {
    sources[name] = now.toISOString();
  }
  const savedAt = result.succeeded.length > 0 ? now : before.savedAt;

  await saveDeadlines(deadlines, { sources, savedAt }, storage);
  return { deadlines, errors: result.errors, skipped: result.skipped, savedAt, sources };
}

// Saves only the deadline fields, with dates written as text (storage can't hold Date objects).
export async function saveDeadlines(deadlines, { sources = {}, savedAt = new Date() } = {}, storage) {
  storage = storage || chromeStorage();
  await storage.set({
    [STORAGE_KEY]: {
      deadlines: deadlines.map(toRow),
      sources,
      savedAt: savedAt ? savedAt.toISOString() : null,
    },
  });
}

// Returns { deadlines, sources, savedAt }. Rows that don't make a valid deadline are dropped.
export async function loadDeadlines(storage) {
  storage = storage || chromeStorage();
  const saved = (await storage.get(STORAGE_KEY))[STORAGE_KEY] || {};

  const rows = Array.isArray(saved.deadlines) ? saved.deadlines : [];
  const deadlines = sortByStart(rows.map(fromRow).filter(Boolean));
  const sources = isPlainObject(saved.sources) ? saved.sources : {};
  const savedAt = typeof saved.savedAt === "string" ? new Date(saved.savedAt) : null;

  return {
    deadlines,
    sources,
    savedAt: savedAt && !Number.isNaN(savedAt.getTime()) ? savedAt : null,
  };
}

// Same id means the same assignment, so only the first copy is kept.
function removeDuplicates(deadlines) {
  const byId = new Map();
  for (const deadline of deadlines) {
    if (!byId.has(deadline.id)) {
      byId.set(deadline.id, deadline);
    }
  }
  return sortByStart([...byId.values()]);
}

function toRow(deadline) {
  return {
    id: deadline.id,
    source: deadline.source,
    type: deadline.type,
    course: deadline.course,
    title: deadline.title,
    start: deadline.start.toISOString(),
    end: deadline.end ? deadline.end.toISOString() : null,
    allDay: deadline.allDay,
    link: deadline.link,
  };
}

// Rebuilt through makeDeadline, so a saved row gets the same checks as fresh data.
function fromRow(row) {
  if (!isPlainObject(row) || typeof row.source !== "string" || typeof row.id !== "string") {
    return null;
  }
  const prefix = `${row.source}:`;
  if (!row.id.startsWith(prefix) || typeof row.title !== "string" || typeof row.start !== "string") {
    return null;
  }
  try {
    return makeDeadline({
      source: row.source,
      sourceId: row.id.slice(prefix.length),
      type: row.type,
      course: typeof row.course === "string" ? row.course : "",
      title: row.title,
      start: new Date(row.start),
      end: typeof row.end === "string" ? new Date(row.end) : null,
      allDay: row.allDay === true,
      link: typeof row.link === "string" ? row.link : "",
    });
  } catch {
    return null;
  }
}

// "Couldn't read Crowdmark: ..." from the reader, or a plain fallback
function errorMessage(name, reason) {
  const message = reason && typeof reason.message === "string" ? reason.message : "";
  return message.startsWith("Couldn't read") ? message : `Couldn't read ${sourceName(name)}`;
}

function sourceName(name) {
  const names = { learn: "Learn", crowdmark: "Crowdmark" };
  return names[name] || name;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chromeStorage() {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage) {
    throw new Error("chrome.storage isn't available here");
  }
  return storage;
}
