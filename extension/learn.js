// Reads deadlines from Waterloo Learn (D2L Brightspace) using the login Chrome already has.
//   readLearn:       runs readLearnInPage inside a Learn tab (tabs.js), then parses the answer
//   readLearnInPage: asks Learn for your courses and calendar events, from inside Learn's own page
//   parseLearn:      turns Learn's answer into deadline records (no internet, so it can be tested alone)
// The extension never sees your password: the Learn tab sends its own login with each request.

import { makeDeadline, startOfDay } from "./deadlines.js";
import { runInSite } from "./tabs.js";

export const LEARN_ORIGIN = "https://learn.uwaterloo.ca";

// How far ahead to look for deadlines.
export const DAYS_AHEAD = 120;

// Used only if Learn doesn't say which API versions it supports (Learn's newest, Nov 2026).
const FALLBACK_VERSIONS = { le: "1.100", lp: "1.64" };

// D2L's number for a real course (not a department or a term).
const COURSE_OFFERING_TYPE = 3;

// Stops a broken "more pages" answer from looping forever.
const MAX_PAGES = 50;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Reads your current courses and every calendar event in them from today on.
//   openIfMissing: with no Learn tab open, open one in the background (Sync now does this)
export async function readLearn({ openIfMissing = false, now = new Date() } = {}) {
  const from = startOfDay(now);
  const to = new Date(from.getTime() + DAYS_AHEAD * MS_PER_DAY);
  const options = {
    from: from.toISOString(),
    to: to.toISOString(),
    fallback: FALLBACK_VERSIONS,
    courseType: COURSE_OFFERING_TYPE,
    maxPages: MAX_PAGES,
  };
  const answer = await runInSite("learn", readLearnInPage, [options], { openIfMissing });
  return parseLearn(answer);
}

// Runs inside a Learn tab. Chrome copies only this function's text into the page, so everything
// it needs is inside it or passed in options. Answers { data: { events, enrollments } } or { error }.
// Asking from Learn's own page means Learn treats it like its own request.
export async function readLearnInPage({ from, to, fallback, courseType, maxPages }) {
  const login = "Couldn't read Learn: log in to Learn in Chrome first";

  async function getJson(path) {
    let response;
    try {
      response = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
    } catch {
      throw new Error("Couldn't read Learn: no connection");
    }
    if (response.status === 401 || response.status === 403) throw new Error(login);
    if (!response.ok) throw new Error(`Couldn't read Learn (error ${response.status})`);
    // Without a login, Learn sends its sign-in web page instead of data
    if (!(response.headers.get("content-type") || "").includes("json")) throw new Error(login);
    try {
      return await response.json();
    } catch {
      throw new Error("Couldn't read Learn: unexpected answer");
    }
  }

  function listFrom(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.Objects)) return value.Objects;
    if (value && Array.isArray(value.Items)) return value.Items;
    return [];
  }

  // Learn answers in pages. Keeps asking for the next page until there are no more.
  async function getAllPages(path, listKey) {
    const items = [];
    let bookmark = null;
    for (let page = 0; page < maxPages; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const answer = await getJson(path + (bookmark ? `${separator}bookmark=${encodeURIComponent(bookmark)}` : ""));
      items.push(...listFrom(answer && answer[listKey]));
      const paging = answer && answer.PagingInfo;
      if (!paging || !paging.HasMoreItems || !paging.Bookmark) break;
      bookmark = paging.Bookmark;
    }
    return items;
  }

  try {
    // Which API versions Learn has; the newest is used
    let versions = fallback;
    try {
      const products = await getJson("/d2l/api/versions/");
      const latest = (code) => (products.find((product) => product.ProductCode === code) || {}).LatestVersion;
      versions = { le: latest("le") || fallback.le, lp: latest("lp") || fallback.lp };
    } catch {
      versions = fallback;
    }

    const enrollments = await getAllPages(
      `/d2l/api/lp/${versions.lp}/enrollments/myenrollments/?orgUnitTypeId=${courseType}`,
      "Items",
    );
    const courseIds = enrollments
      .filter((e) => e && e.OrgUnit && e.OrgUnit.Id != null && (e.Access || {}).IsActive !== false && (e.Access || {}).CanAccess !== false)
      .map((e) => e.OrgUnit.Id);
    if (courseIds.length === 0) {
      return { data: { events: [], enrollments } };
    }

    const query = new URLSearchParams({ orgUnitIdsCSV: courseIds.join(","), startDateTime: from, endDateTime: to });
    const events = await getAllPages(`/d2l/api/le/${versions.le}/calendar/events/myEvents/?${query}`, "Objects");
    return { data: { events, enrollments } };
  } catch (error) {
    return { error: error && typeof error.message === "string" ? error.message : "Couldn't read Learn" };
  }
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
    title: type === "lecture" ? cleanTitle(String(event.Title || "").trim()) : String(event.Title || "").trim(),
    link: learnLink(event),
  };

  try {
    if (type !== "event") {
      // For assignments, quizzes and lectures Learn puts one time in the event; the end is that time
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
  // A dated page, video or file in a course's Content (like a library session): not something to hand in
  if (/content/i.test(kind)) return "lecture";
  return "event";
}

// Learn names some content topics like files: "MTE100_Effectively_Searching_for_Patent_Literature_11_03_2026_BALL".
// Turns those into "Effectively Searching for Patent Literature" by dropping the course code at the
// start and the date (and anything after it) at the end. Normal titles with spaces are left alone.
function cleanTitle(title) {
  if (/\s/.test(title) || !title.includes("_")) return title;
  const cleaned = title
    .replace(/^[A-Z]{2,6}\d{2,4}[A-Z]?_/, "")
    .replace(/_\d{1,2}_\d{1,2}_\d{4}(_.*)?$/, "")
    .replace(/_+/g, " ")
    .trim();
  return cleaned || title;
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
