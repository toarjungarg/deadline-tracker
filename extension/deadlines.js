// The shape every deadline and event has, plus helpers to sort and group them.
// Learn, Crowdmark and anything added later all turn their data into this one shape,
// so the rest of the extension only has to understand one thing.

export const TYPES = ["assignment", "quiz", "event", "lecture"];

// Makes one deadline record and checks it has everything it needs.
//   source, sourceId: where it came from ("learn", "crowdmark") and that site's own id for it
//   type:   "assignment", "quiz", "event" or "lecture" (a dated Learn page, video or file: not something to hand in)
//   start:  the due time for assignments and quizzes, the start time for events and lectures
//   end:    only for events with an end time (null otherwise)
//   allDay: true for events with no set time, like a class event day
export function makeDeadline({
  source,
  sourceId,
  type,
  course = "",
  title,
  start,
  end = null,
  allDay = false,
  link = "",
}) {
  if (!source || !sourceId) {
    throw new Error("A deadline needs a source and a sourceId");
  }
  if (!TYPES.includes(type)) {
    throw new Error(`Unknown deadline type: ${type}`);
  }
  if (!title) {
    throw new Error("A deadline needs a title");
  }
  if (!isValidDate(start)) {
    throw new Error(`Bad start date for "${title}"`);
  }
  if (end !== null && !(isValidDate(end) && end >= start)) {
    throw new Error(`Bad end date for "${title}"`);
  }

  return {
    // The same assignment gets the same id every time.
    // This is how the calendar will know to update an event instead of adding a copy.
    id: `${source}:${sourceId}`,
    source,
    type,
    course,
    title,
    start,
    end,
    allDay,
    link,
  };
}

// Earliest first. Returns a new list and leaves the original alone.
export function sortByStart(deadlines) {
  return [...deadlines].sort((a, b) => a.start - b.start);
}

// Keeps today's and future deadlines, drops anything from before today.
export function upcoming(deadlines, now = new Date()) {
  const today = startOfDay(now);
  return deadlines.filter((deadline) => (deadline.end || deadline.start) >= today);
}

// Groups a sorted list by day: [{ day, items: [...] }, ...]
export function groupByDay(deadlines) {
  const groups = [];
  for (const deadline of deadlines) {
    const day = startOfDay(deadline.start);
    const last = groups[groups.length - 1];
    if (last && last.day.getTime() === day.getTime()) {
      last.items.push(deadline);
    } else {
      groups.push({ day, items: [deadline] });
    }
  }
  return groups;
}

// Midnight at the start of the same day.
export function startOfDay(date) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

// Whole days from today: 0 is today, 1 is tomorrow, -1 is yesterday.
export function daysUntil(date, now = new Date()) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(date) - startOfDay(now)) / msPerDay);
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
