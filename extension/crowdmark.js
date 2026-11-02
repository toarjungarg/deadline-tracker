// Reads your Crowdmark assessments and turns them into deadline records.
// Crowdmark has no public API, so this asks the same address its student dashboard uses,
// with the login Chrome already has. Nothing here sees or keeps a password or cookie.

import { makeDeadline } from "./deadlines.js";

const SITE = "https://app.crowdmark.com";

// Crowdmark's internal address and field names, all in one place.
// These are a best guess until checked against a real response, so fix them here first.
export const CROWDMARK_API = {
  assessments: "/api/v2/student/assignments?include=course",
  // Field names tried in order, since the real ones aren't confirmed yet
  dueFields: ["due", "due-at", "dueAt", "due_at", "ends-at", "endsAt"],
  titleFields: ["title", "name"],
  courseNameFields: ["name", "title", "code"],
  // Words that mean a timed test rather than an assignment
  quizWords: ["test", "exam", "quiz", "midterm", "timed"],
  link: (id) => `${SITE}/student/assessments/${encodeURIComponent(id)}`,
};

// Asks Crowdmark for your assessments and returns deadline records.
export async function readCrowdmark() {
  let response;
  try {
    response = await fetch(SITE + CROWDMARK_API.assessments, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Couldn't read Crowdmark: no connection");
  }
  if (!response.ok) {
    // 401 or 403 usually means you're signed out of Crowdmark in Chrome
    throw new Error(`Couldn't read Crowdmark: it answered ${response.status}`);
  }
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error("Couldn't read Crowdmark: the answer wasn't JSON (are you signed in?)");
  }
  return parseCrowdmark(json);
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
