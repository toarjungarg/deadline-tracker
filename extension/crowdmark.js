// Reads your Crowdmark assessments and turns them into deadline records.
// Crowdmark has no public API, so this asks the same address its student dashboard uses,
// from inside a Crowdmark tab (tabs.js). Nothing here sees or keeps a password or login cookie.

import { makeDeadline } from "./deadlines.js";
import { runInSite } from "./tabs.js";

const SITE = "https://app.crowdmark.com";

// Crowdmark's internal address and field names, all in one place.
// The address is the one Crowdmark's own dashboard asks (seen in DevTools, Nov 2026).
// "due" and "title" are checked against a real answer; the other names are kept as backups.
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
// Crowdmark's own page sends a security code (X-Csrf-Token) with each request. Sites keep that
// code in different places, so this tries the usual ones in order and uses the first one
// Crowdmark accepts. The codes are only used for these requests: never returned, logged or saved.
// If none work, the error lists what was tried and what Crowdmark answered, without the codes.
export async function readCrowdmarkInPage({ path }) {
  const fromMeta = (doc) => {
    const meta = doc.querySelector('meta[name="csrf-token"]') || doc.querySelector('meta[name="csrf_token"]');
    return (meta && meta.getAttribute("content")) || "";
  };
  // Only cookies named like a security code; login cookies are hidden from pages anyway
  const fromCookie = () => {
    const names = ["CSRF-TOKEN", "XSRF-TOKEN", "csrf-token", "csrf_token", "_csrf_token"];
    for (const part of document.cookie.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (names.includes(name)) return decodeURIComponent(rest.join("="));
    }
    return "";
  };
  // A fresh copy of the page, in case the open one holds an old code. Parsed as data, never run.
  const fromFreshPage = async () => {
    const page = await fetch(location.href, { credentials: "same-origin" });
    if (!page.ok) return "";
    return fromMeta(new DOMParser().parseFromString(await page.text(), "text/html"));
  };
  const sources = [
    ["page code", async () => fromMeta(document)],
    ["cookie code", async () => fromCookie()],
    ["fresh page code", fromFreshPage],
    ["no code", async () => null],
  ];

  const tried = [];
  const used = [];
  const statuses = [];
  for (const [label, find] of sources) {
    let code;
    try {
      code = await find();
    } catch {
      code = "";
    }
    if (code === "" || used.includes(code)) {
      tried.push(`${label}: ${code === "" ? "none found" : "same as before"}`);
      continue;
    }
    used.push(code);
    const headers = { Accept: "application/vnd.api+json, application/json" };
    if (code) headers["X-Csrf-Token"] = code;
    let response;
    try {
      response = await fetch(path, { credentials: "same-origin", headers });
    } catch {
      return { error: "Couldn't read Crowdmark: no connection" };
    }
    if (response.ok) {
      try {
        return { data: await response.json() };
      } catch {
        return { error: "Couldn't read Crowdmark: the answer wasn't JSON (are you signed in?)" };
      }
    }
    tried.push(`${label}: ${response.status}`);
    statuses.push(response.status);
  }
  // Every way was refused. 401/403 on every try almost always means signed out of Crowdmark
  const signedOut = statuses.length > 0 && statuses.every((status) => status === 401 || status === 403);
  const start = signedOut ? "Couldn't read Crowdmark: log in to Crowdmark in Chrome first" : "Couldn't read Crowdmark";
  return { error: `${start} (tried ${tried.join(", ")})` };
}

// Turns Crowdmark's answer into deadline records. No internet, so it can be tested alone.
// Real shape (checked against a real answer, Nov 2026):
//   data: your assignments, each with its "due" date and a pointer to an "exam-master"
//   included: the exam-masters, which hold the title, the kind (like "ExamMaster::AtHome")
//             and a pointer to the course (an id like "mte-100-fall-2026", no name)
// Anything without a due date, or that doesn't fit, is skipped instead of breaking the list.
export function parseCrowdmark(json) {
  const items = Array.isArray(json?.data) ? json.data : [];
  const courses = courseNames(json?.included);
  const masters = examMasters(json?.included);
  const deadlines = [];

  for (const item of items) {
    const attributes = item?.attributes || {};
    const masterId = item?.relationships?.["exam-master"]?.data?.id;
    const master = (masterId != null && masters.get(String(masterId))) || {};
    const masterAttributes = master.attributes || {};
    const due = toDate(pick(attributes, CROWDMARK_API.dueFields) ?? pick(masterAttributes, CROWDMARK_API.dueFields));
    const title = pick(masterAttributes, CROWDMARK_API.titleFields) ?? pick(attributes, CROWDMARK_API.titleFields);
    if (!item?.id || !due || typeof title !== "string" || !title) {
      continue;
    }
    const courseId = master.relationships?.course?.data?.id ?? item.relationships?.course?.data?.id;
    deadlines.push(
      makeDeadline({
        source: "crowdmark",
        sourceId: String(item.id),
        type: looksLikeQuiz(attributes, masterAttributes) ? "quiz" : "assignment",
        course: courses.get(String(courseId)) || courseFromId(courseId),
        title,
        start: due,
        link: CROWDMARK_API.link(item.id),
      }),
    );
  }
  return deadlines;
}

// Exam-master id to exam-master, from the "included" part of the answer
function examMasters(included) {
  const masters = new Map();
  for (const entry of Array.isArray(included) ? included : []) {
    if (entry?.type === "exam-masters" && entry.id != null) masters.set(String(entry.id), entry);
  }
  return masters;
}

// Crowdmark sends only a course id like "mte-100-fall-2026", so this makes "MTE 100" from it.
// Anything that doesn't start like a course code gives no course rather than a wrong one.
function courseFromId(id) {
  const match = /^([a-z]{2,6})-(\d{2,4}[a-z]?)(?:-|$)/i.exec(String(id ?? ""));
  return match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : "";
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

// Only the assessment's own kind counts, not its record type. Crowdmark calls every
// assessment an exam-master, with the kind after "ExamMaster::" (a take-home one is
// "ExamMaster::AtHome"), so that prefix is dropped first or everything would look like a quiz.
function looksLikeQuiz(attributes, masterAttributes = {}) {
  const raw = attributes["exam-type"] || attributes.kind || masterAttributes.type || "";
  const kind = String(raw).replace(/^ExamMaster::/i, "").toLowerCase();
  return CROWDMARK_API.quizWords.some((word) => kind.includes(word));
}
