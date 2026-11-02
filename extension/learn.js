// Reads deadlines from Waterloo Learn (D2L Brightspace) using the login Chrome already has.
//   readLearn:  asks Learn for your courses and calendar events (needs the internet and your login)
//   parseLearn: turns Learn's answer into deadline records (no internet, so it can be tested alone)
// The extension never sees your password: Chrome sends its own Learn login along with each request.

import { makeDeadline, startOfDay } from "./deadlines.js";

export const LEARN_ORIGIN = "https://learn.uwaterloo.ca";

// How far ahead to look for deadlines.
export const DAYS_AHEAD = 120;

// Used only if Learn doesn't say which API versions it supports.
const FALLBACK_VERSIONS = { le: "1.74", lp: "1.43" };

// D2L's number for a real course (not a department or a term).
const COURSE_OFFERING_TYPE = 3;

// Stops a broken "more pages" answer from looping forever.
const MAX_PAGES = 50;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Asks Learn for your current courses, then every calendar event in them from today on.
export async function readLearn(now = new Date()) {
  const versions = await apiVersions();

  const enrollments = await getAllPages(
    `/d2l/api/lp/${versions.lp}/enrollments/myenrollments/?orgUnitTypeId=${COURSE_OFFERING_TYPE}`,
    "Items",
  );
  const courseIds = enrollments.filter(isCurrentCourse).map((enrollment) => enrollment.OrgUnit.Id);
  if (courseIds.length === 0) {
    return [];
  }

  const from = startOfDay(now);
  const to = new Date(from.getTime() + DAYS_AHEAD * MS_PER_DAY);
  const query = new URLSearchParams({
    orgUnitIdsCSV: courseIds.join(","),
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
  });
  const events = await getAllPages(`/d2l/api/le/${versions.le}/calendar/events/myEvents/?${query}`, "Objects");

  return parseLearn({ events, enrollments });
}

// Turns Learn's answer into deadline records.
// Takes { events, enrollments }, or just the events (a list, or a page with an "Objects" list),
// so a response saved straight from DevTools can be tested too.
// Anything without a usable title, id or date is skipped instead of breaking the whole list.
export function parseLearn(data) {
  const events = listFrom(Array.isArray(data) || data?.Objects ? data : data?.events);
  const enrollments = listFrom(data?.enrollments);

  const courseNames = new Map();
  for (const enrollment of enrollments) {
    if (enrollment?.OrgUnit?.Id != null) {
      courseNames.set(enrollment.OrgUnit.Id, enrollment.OrgUnit.Name || "");
    }
  }

  const deadlines = [];
  for (const event of events) {
    const deadline = toDeadline(event, courseNames);
    if (deadline) {
      deadlines.push(deadline);
    }
  }
  return deadlines;
}

// One Learn calendar event as a deadline record, or null if it can't be used.
function toDeadline(event, courseNames) {
  if (!event || typeof event !== "object") {
    return null;
  }
  const type = learnType(event);
  const common = {
    source: "learn",
    sourceId: event.CalendarEventId != null ? String(event.CalendarEventId) : "",
    type,
    course: courseNames.get(event.OrgUnitId) || event.OrgUnitName || "",
    title: String(event.Title || "").trim(),
    link: learnLink(event),
  };

  try {
    if (type !== "event") {
      // For assignments and quizzes Learn puts the due time in the event; the end is the due time
      return makeDeadline({ ...common, start: toDate(event.EndDateTime) || toDate(event.StartDateTime) });
    }
    if (event.IsAllDayEvent) {
      const startTime = toDate(event.StartDateTime);
      const start = localDay(event.StartDay) || (startTime && startOfDay(startTime));
      const lastDay = localDay(event.EndDay);
      // Multi-day events end at the start of the day after the last day (what calendar.js expects)
      const end = lastDay && lastDay > start ? addDays(lastDay, 1) : null;
      return makeDeadline({ ...common, start, end, allDay: true });
    }
    const start = toDate(event.StartDateTime);
    const end = toDate(event.EndDateTime);
    return makeDeadline({ ...common, start, end: end && start && end > start ? end : null });
  } catch {
    // Missing title, id or date: leave this one out
    return null;
  }
}

// Learn marks what an event belongs to, like "D2L.LE.Dropbox.Dropbox" for an assignment.
function learnType(event) {
  const kind = String(event.AssociatedEntity?.AssociatedEntityType || "");
  if (/dropbox/i.test(kind)) return "assignment";
  if (/quiz/i.test(kind)) return "quiz";
  return "event";
}

// A link back to the item on Learn. Only learn.uwaterloo.ca links are kept.
function learnLink(event) {
  const raw = event.AssociatedEntity?.Link;
  if (typeof raw === "string" && !/\s/.test(raw)) {
    if (raw.startsWith("/")) return LEARN_ORIGIN + raw;
    if (raw.startsWith(LEARN_ORIGIN + "/")) return raw;
  }
  if (/^\d+$/.test(String(event.OrgUnitId ?? ""))) {
    return `${LEARN_ORIGIN}/d2l/le/calendar/${event.OrgUnitId}`;
  }
  return "";
}

function isCurrentCourse(enrollment) {
  const access = enrollment?.Access || {};
  return enrollment?.OrgUnit?.Id != null && access.IsActive !== false && access.CanAccess !== false;
}

// Asks Learn which API versions it has, and uses the newest.
async function apiVersions() {
  try {
    const products = await getJson(`${LEARN_ORIGIN}/d2l/api/versions/`);
    const latest = (code) => products.find((product) => product.ProductCode === code)?.LatestVersion;
    return { le: latest("le") || FALLBACK_VERSIONS.le, lp: latest("lp") || FALLBACK_VERSIONS.lp };
  } catch {
    return FALLBACK_VERSIONS;
  }
}

// Learn answers in pages. Keeps asking for the next page until there are no more.
async function getAllPages(path, listKey) {
  const items = [];
  let bookmark = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const separator = path.includes("?") ? "&" : "?";
    const url = LEARN_ORIGIN + path + (bookmark ? `${separator}bookmark=${encodeURIComponent(bookmark)}` : "");
    const answer = await getJson(url);
    items.push(...listFrom(answer?.[listKey]));
    const paging = answer?.PagingInfo;
    if (!paging?.HasMoreItems || !paging.Bookmark) {
      break;
    }
    bookmark = paging.Bookmark;
  }
  return items;
}

// One request to Learn. credentials: "include" sends Chrome's Learn login with it.
async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Couldn't read Learn: no connection");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Couldn't read Learn: log in to Learn in Chrome first");
  }
  if (!response.ok) {
    throw new Error(`Couldn't read Learn (error ${response.status})`);
  }
  // Without a login, Learn sends its sign-in web page instead of data
  if (!(response.headers.get("content-type") || "").includes("json")) {
    throw new Error("Couldn't read Learn: log in to Learn in Chrome first");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Couldn't read Learn: unexpected answer");
  }
}

function listFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.Objects)) return value.Objects;
  if (Array.isArray(value?.Items)) return value.Items;
  return [];
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "2026-11-06T00:00:00.000Z" or "2026-11-06" becomes midnight on Nov 6 in your own time zone,
// so an all-day event doesn't slide to the day before.
function localDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
