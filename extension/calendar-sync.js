// Puts deadlines on a "Deadlines" calendar in your Google Calendar.
//   syncToGoogle: makes the calendar the first time, then adds new deadlines and updates changed ones.
// It remembers which Google event belongs to which deadline (by the deadline's id), so a deadline
// that moves gets its event updated instead of a second copy. It never deletes events: if a reader
// fails, its deadlines would look removed, and a wrong delete is worse than a leftover event.

import { toGoogleEvent } from "./calendar.js";
import { forgetToken } from "./google.js";

export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
export const CALENDAR_NAME = "Deadlines";

// What gets saved in chrome.storage.local: the calendar's id, and deadline id -> { eventId, fingerprint }
const CALENDAR_KEY = "googleCalendarId";
const EVENTS_KEY = "googleEvents";

// getToken: where the Google token comes from (google.js getToken, interactive or not)
export async function syncToGoogle(deadlines, { getToken }) {
  const api = makeApi(getToken);
  const saved = await chrome.storage.local.get([CALENDAR_KEY, EVENTS_KEY]);
  const events = saved[EVENTS_KEY] || {};
  const result = { added: 0, updated: 0, unchanged: 0, failed: 0, errors: [] };

  let calendarId = await savedCalendar(api, saved[CALENDAR_KEY]);
  if (!calendarId) {
    calendarId = await createCalendar(api);
    // A new calendar has none of the old events, so the old event ids are useless
    for (const id of Object.keys(events)) delete events[id];
  }

  try {
    for (const deadline of deadlines) {
      try {
        const outcome = await syncOne(api, calendarId, deadline, events);
        result[outcome] += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push(`"${deadline.title}": ${error.message}`);
      }
    }
  } finally {
    // Saved even if something went wrong part way, so finished events aren't added twice next time
    await chrome.storage.local.set({ [CALENDAR_KEY]: calendarId, [EVENTS_KEY]: events });
  }
  return result;
}

// One deadline: add it, update it, or leave it alone. Returns which one happened.
async function syncOne(api, calendarId, deadline, events) {
  const body = toGoogleEvent(deadline);
  // The event exactly as it would be sent; if it matches last time, there's nothing to change
  const fingerprint = JSON.stringify(body);
  const saved = events[deadline.id];

  if (saved && saved.fingerprint === fingerprint) {
    return "unchanged";
  }
  if (saved) {
    try {
      await api("PUT", eventPath(calendarId, saved.eventId), body);
      events[deadline.id] = { eventId: saved.eventId, fingerprint };
      return "updated";
    } catch (error) {
      // 404 or 410: the event was deleted on Google, so add it again below
      if (error.status !== 404 && error.status !== 410) throw error;
    }
  }
  const created = await api("POST", `/calendars/${encodeURIComponent(calendarId)}/events`, body);
  events[deadline.id] = { eventId: created.id, fingerprint };
  return "added";
}

// The saved calendar's id if it still exists on Google, otherwise null.
async function savedCalendar(api, calendarId) {
  if (!calendarId) return null;
  try {
    await api("GET", `/calendars/${encodeURIComponent(calendarId)}`);
    return calendarId;
  } catch (error) {
    if (error.status === 404 || error.status === 410) return null;
    throw error;
  }
}

async function createCalendar(api) {
  const calendar = await api("POST", "/calendars", {
    summary: CALENDAR_NAME,
    description: "Deadlines from Learn and Crowdmark",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return calendar.id;
}

function eventPath(calendarId, eventId) {
  return `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

// Makes the function that sends one Calendar request. The token only lives inside it.
// If Google says the token is no good (401), Chrome forgets it and the request is tried once more.
function makeApi(getToken) {
  return async function api(method, path, body) {
    let token = await getToken();
    let response = await send(method, path, body, token);
    if (response.status === 401) {
      await forgetToken(token);
      token = await getToken();
      response = await send(method, path, body, token);
    }
    if (!response.ok) {
      const error = new Error(`Google Calendar said no (error ${response.status})`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  };
}

async function send(method, path, body, token) {
  try {
    return await fetch(CALENDAR_API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Couldn't reach Google Calendar: no connection");
  }
}
