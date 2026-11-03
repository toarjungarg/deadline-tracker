// Reads your Crowdmark assessments and turns them into deadline records.
// Crowdmark has no public API, so this asks the same address its student dashboard uses,
// from inside a Crowdmark tab (tabs.js). Nothing here sees or keeps a password or cookie.

import { makeDeadline } from "./deadlines.js";
import { runInSite } from "./tabs.js";

const SITE = "https://app.crowdmark.com";

// Crowdmark's internal address and field names, all in one place.
// The address is the one Crowdmark's own dashboard asks (seen in DevTools, Nov 2026).
// The field names are still a best guess until checked against a real response.
export const CROWDMARK_API = {
  assessments:
    "/api/v2/student/assignments?fields%5Bexam-masters%5D%5B%5D=type&fields%5Bexam-masters%5D%5B%5D=title" +
    "&fields%5Bexam-masters%5D%5B%5D=course&filter%5Bupcoming%5D=true&filter%5Btype%5D=assigned&sort=due",
  // Field names tried in order, since the real ones aren't confirmed yet
  dueFields: ["due", "due-at", "dueAt", "due_at", "ends-at", "endsAt"],
  titleFields: ["title", "name"],
  courseNameFields: ["name", "title", "code"],
  // Words that mean a timed test rather than an assignment
  quizWords: ["test", "exam", "quiz", "midterm", "timed"],
  link: (id) => `${SITE}/student/assessments/${encodeURIComponent(id)}`,
};

// Asks Crowdmark for your assessments and returns deadline records.
//   openIfMissing: with no Crowdmark tab open, open one in the background (Sync now does this)
export async function readCrowdmark({ openIfMissing = false } = {}) {
  const json = await runInSite("crowdmark", readCrowdmarkInPage, [{ path: CROWDMARK_API.assessments }], {
    openIfMissing,
  });
  return parseCrowdmark(json);
}

// Runs inside a Crowdmark tab. Chrome copies only this function's text into the page, so
// everything it needs is inside it or passed in. Answers { data } or { error }.
// Crowdmark's own page sends a security code (X-Csrf-Token) with each request, which it keeps
// in the page itself; this reads it from there and only ever uses it for this one request.
export async function readCrowdmarkInPage({ path }) {
  const meta = document.querySelector('meta[name="csrf-token"]');
  const code = meta ? meta.getAttribute("content") : "";
  if (!code) {
    return { error: "Couldn't read Crowdmark: no security code on the page" };
  }
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/vnd.api+json, application/json", "X-Csrf-Token": code },
    });
  } catch {
    return { error: "Couldn't read Crowdmark: no connection" };
  }
  if (!response.ok) {
    // 401 or 403 usually means you're signed out of Crowdmark in Chrome
    return { error: `Couldn't read Crowdmark: it answered ${response.status}` };
  }
  try {
    return { data: await response.json() };
  } catch {
    return { error: "Couldn't read Crowdmark: the answer wasn't JSON (are you signed in?)" };
  }
}

// Turns Crowdmark's answer into deadline records. No internet, so it can be tested alone.
// Expected shape: { data: [{ id, type, attributes, relationships }], included: [courses] }
// Anything without a due date, or that doesn't fit, is skipped instead of breaking the list.
export function parseCrowdmark(json) {
  const items = Array.isArray(json?.data) ? json.data : [];
  const courses = courseNames(json?.included);
  const deadlines = [];

  for (const item of items) {
    const attributes = item?.attributes || {};
    const due = toDate(pick(attributes, CROWDMARK_API.dueFields));
    const title = pick(attributes, CROWDMARK_API.titleFields);
    if (!item?.id || !due || typeof title !== "string" || !title) {
      continue;
    }
    const courseId = item.relationships?.course?.data?.id;
    deadlines.push(
      makeDeadline({
        source: "crowdmark",
        sourceId: String(item.id),
        type: looksLikeQuiz(attributes) ? "quiz" : "assignment",
        course: courses.get(String(courseId)) || "",
        title,
        start: due,
        link: CROWDMARK_API.link(item.id),
      }),
    );
  }
  return deadlines;
}

// Course id to course name, from the "included" part of the answer
function courseNames(included) {
  const names = new Map();
  for (const entry of Array.isArray(included) ? included : []) {
    if (!String(entry?.type || "").startsWith("course")) continue;
    const name = pick(entry.attributes || {}, CROWDMARK_API.courseNameFields);
    if (typeof name === "string") names.set(String(entry.id), name);
  }
  return names;
}

// The first of these fields that has a value
function pick(attributes, fields) {
  for (const field of fields) {
    if (attributes[field] != null && attributes[field] !== "") return attributes[field];
  }
  return undefined;
}

function toDate(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Only the assessment's own kind counts, not its record type: Crowdmark may call every
// assessment an "exam" internally, which would wrongly make everything a quiz.
function looksLikeQuiz(attributes) {
  const kind = String(attributes["exam-type"] || attributes.kind || "").toLowerCase();
  return CROWDMARK_API.quizWords.some((word) => kind.includes(word));
}
