import test from "node:test";
import assert from "node:assert/strict";
import { resourceDate, scheduleEntries, scheduleTime, scheduleTitle, sharedScheduleDetails } from "./course-schedule.ts";

process.env.TZ = "Europe/Berlin";
const event = (id, start, extra = {}) => ({ id, start, title: "Vorlesung", kind: "schedule", courseId: "web", description: "", ...extra });

test("schedule accepts Stud.IP timestamps in seconds, milliseconds and ISO dates", () => {
  const expected = "2026-10-21T08:00:00.000Z";
  const ms = Date.parse(expected);
  for (const value of [ms, ms / 1000, String(ms / 1000), expected]) {
    assert.equal(resourceDate(value).toISOString(), expected);
  }
  for (const value of [null, undefined, "", "invalid", NaN]) assert.equal(resourceDate(value), null);
});

test("hides past events and cancellations, keeps upcoming cancellations and undated entries", () => {
  const now = new Date("2026-10-16T12:00:00+02:00");
  const entries = scheduleEntries([
    event("undated", "invalid"),
    event("future", "2026-10-21T10:00:00+02:00"),
    event("past", "2026-10-14T10:00:00+02:00"),
    event("past-cancelled", "2026-09-30T10:00:00+02:00", { cancelled: true }),
    event("earlier-today", "2026-10-16T10:00:00+02:00", { end: "2026-10-16T11:30:00+02:00" }),
    event("cancelled", "2026-10-20T10:00:00+02:00", { cancelled: true }),
  ], now);
  assert.deepEqual(entries.map(({ item }) => item.id), ["cancelled", "future", "undated"]);
  assert.deepEqual(entries.map(({ status }) => status), ["Отменено", "Через 5 дней", "Дата не указана"]);
  assert.deepEqual(entries.filter(({ isNext }) => isNext).map(({ item }) => item.id), ["future"]);
});

test("an event disappears when it ends and a past-only schedule is empty", () => {
  const entries = scheduleEntries([
    event("just-ended", "2026-10-16T10:00:00+02:00", { end: "2026-10-16T11:30:00+02:00" }),
    event("past", "2026-10-14T10:00:00+02:00"),
  ], new Date("2026-10-16T11:30:00+02:00"));
  assert.deepEqual(entries, []);
});

test("an ongoing event stays highlighted until its end, including across midnight", () => {
  const entries = scheduleEntries([
    event("ongoing", "2026-10-15T23:30:00+02:00", { end: "2026-10-16T01:00:00+02:00" }),
    event("later", "2026-10-16T10:00:00+02:00"),
  ], new Date("2026-10-16T00:30:00+02:00"));
  assert.equal(entries[0].status, "Идёт сейчас");
  assert.equal(entries[0].isNext, true);
  assert.equal(entries[1].status, "Сегодня");
  assert.equal(entries[1].isNext, false);
});

test("relative days follow calendar dates through daylight-saving changes", () => {
  const [entry] = scheduleEntries([event("next", "2026-10-26T10:00:00+01:00")], new Date("2026-10-24T23:30:00+02:00"));
  assert.equal(entry.status, "Послезавтра");
});

test("only removes the repeated course suffix and preserves distinctive event titles", () => {
  const course = "Web-/Mobile-Technologien (WPF AI-5)";
  assert.equal(scheduleTitle(`Vorlesung: ${course}`, course), "Vorlesung");
  assert.equal(scheduleTitle(course, course), "");
  assert.equal(scheduleTitle("Prüfung: Projektpräsentation", course), "Prüfung: Projektpräsentation");
  assert.equal(scheduleTitle("TypeScript", "Script"), "TypeScript");
});

test("common details follow local clock time across daylight-saving changes", () => {
  const entries = scheduleEntries([
    event("october", "2026-10-21T10:00:00+02:00", { end: "2026-10-21T11:30:00+02:00", location: "A224" }),
    event("november", "2026-11-04T10:00:00+01:00", { end: "2026-11-04T11:30:00+01:00", location: "A224" }),
  ], new Date("2026-10-16T12:00:00+02:00"));
  assert.deepEqual(sharedScheduleDetails(entries), { time: "10:00 – 11:30", location: "A224" });
});

test("changed times and missing rooms remain explicit exceptions to common details", () => {
  const entries = scheduleEntries([
    event("one", "2026-10-21T10:00:00+02:00", { location: "A224" }),
    event("two", "2026-10-22T10:00:00+02:00", { location: "A224" }),
    event("different", "2026-10-23T12:00:00+02:00"),
    event("cancelled", "2026-10-24T16:00:00+02:00", { location: "B100", cancelled: true }),
  ], new Date("2026-10-16T12:00:00+02:00"));
  assert.deepEqual(sharedScheduleDetails(entries), { time: "10:00", location: "A224" });
  assert.equal(scheduleTime(entries[2]), "12:00");
  assert.equal(entries[2].item.location, undefined);
  assert.equal(scheduleTime(entries[3]), "16:00");
});

test("no common time or room is implied when there is no majority", () => {
  const entries = scheduleEntries([
    event("one", "2026-10-21T10:00:00+02:00", { location: "A224" }),
    event("two", "2026-10-22T12:00:00+02:00", { location: "B100" }),
  ], new Date("2026-10-16T12:00:00+02:00"));
  assert.deepEqual(sharedScheduleDetails(entries), { time: null, location: null });
  assert.deepEqual(sharedScheduleDetails([]), { time: null, location: null });
});
