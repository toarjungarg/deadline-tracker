// Made-up deadlines so the popup has something to show before Learn and Crowdmark
// are connected. Dates are worked out from today, so they're always upcoming.
// Delete this file once real deadlines come in.

import { makeDeadline } from "./deadlines.js";

export function sampleDeadlines(now = new Date()) {
  return [
    makeDeadline({
      source: "sample",
      sourceId: "1",
      type: "assignment",
      course: "MATH 101",
      title: "Assignment 5",
      start: daysFromNow(1, 23, 59, now),
    }),
    makeDeadline({
      source: "sample",
      sourceId: "2",
      type: "quiz",
      course: "PHYS 101",
      title: "Quiz 3",
      start: daysFromNow(2, 10, 0, now),
    }),
    makeDeadline({
      source: "sample",
      sourceId: "3",
      type: "assignment",
      course: "ENGR 101",
      title: "Lab report 2",
      start: daysFromNow(2, 23, 59, now),
    }),
    makeDeadline({
      source: "sample",
      sourceId: "4",
      type: "event",
      title: "Class event day",
      start: daysFromNow(4, 0, 0, now),
      allDay: true,
    }),
    makeDeadline({
      source: "sample",
      sourceId: "5",
      type: "assignment",
      course: "CHEM 101",
      title: "Problem set 4",
      start: daysFromNow(6, 21, 0, now),
    }),
  ];
}

// A date some days from now at a set time, like "2 days from now at 10:00".
function daysFromNow(days, hour, minute, now) {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}
