import test from "node:test";
import assert from "node:assert/strict";
import { scheduleEntries } from "./course-schedule.ts";
import { weeklySchedule } from "./weekly-schedule.ts";

process.env.TZ = "Europe/Berlin";
const now = new Date(2026, 9, 18);
const times = [[10, 0, "A210"], [12, 15, "A113"], [14, 0, "B204"]];
function semester(weeks = 6) {
  return Array.from({ length: weeks }, (_, week) => times.map(([hour, minute, location], slot) => {
    const start = new Date(2026, 9, 20 + week * 7, hour, minute);
    return { id: `${week}-${slot}`, title: "Vorlesung", description: "", kind: "schedule", courseId: "test",
      start: start.toISOString(), end: new Date(start.getTime() + 90 * 60000).toISOString(), location };
  })).flat();
}
const model = (items, at = now) => weeklySchedule(items, scheduleEntries(items, at), at);
const change = (items, id, fields) => items.map((item) => item.id === id ? { ...item, ...fields } : item);

test("summarizes distinct time/room pairs across the autumn clock change", () => {
  const result = model(semester());
  assert.deepEqual(result.slots.map(({ weekday, time, location }) => [weekday, time, location]), [
    [2, "10:00 – 11:30", "A210"], [2, "12:15 – 13:45", "A113"], [2, "14:00 – 15:30", "B204"],
  ]);
  assert.deepEqual(result.exceptions, []);
  assert.equal(result.next.item.id, "0-0");
});

test("single-time, short, sparse and entirely irregular schedules keep the date list", () => {
  assert.equal(model(semester().filter((item) => item.id.endsWith("-0"))), null);
  assert.equal(model(semester(2)), null);
  assert.equal(model(semester().filter((item) => ["0", "2", "4"].includes(item.id[0]))), null);
  const irregular = semester().map((item, i) => {
    const start = new Date(item.start);
    start.setMinutes(start.getMinutes() + i);
    return { ...item, start: start.toISOString(), end: null };
  });
  assert.equal(model(irregular), null);
});

test("reports a changed room, shifted time and cancellation only once each", () => {
  let items = change(semester(), "2-1", { location: "B312" });
  const start = new Date(2026, 10, 10, 14, 30);
  items = change(items, "3-2", { start: start.toISOString(), end: new Date(start.getTime() + 90 * 60000).toISOString() });
  items = change(items, "4-0", { cancelled: true });
  const result = model(items);
  assert.deepEqual(result.exceptions.map(({ entry }) => entry.item.id), ["2-1", "3-2", "4-0"]);
  assert.equal(result.exceptions[0].slot.location, "A113");
  assert.equal(result.exceptions[1].slot.time, "14:00 – 15:30");
  assert.equal(result.exceptions[2].entry.status, "Отменено");
  assert.equal(result.slots[0].time, "10:00 – 11:30");
});

test("a missing room stays explicit instead of inheriting the usual room", () => {
  const result = model(change(semester(), "2-1", { location: " " }));
  assert.equal(result.exceptions.length, 1);
  assert.equal(result.exceptions[0].slot.location, "A113");
  assert.equal(result.exceptions[0].entry.item.location, " ");
});

test("absent sessions remain explicit without inventing a cancellation", () => {
  const result = model(semester().filter((item) => item.id !== "2-1"));
  assert.equal(result.exceptions.length, 1);
  const missing = result.exceptions[0];
  assert.equal(missing.entry, null);
  assert.equal(missing.slot.time, "12:15 – 13:45");
  assert.equal(missing.start.getDate(), 3);
});

test("a break week is explicit without losing the normal weekly pattern", () => {
  const result = model(semester().filter((item) => !item.id.startsWith("3-")));
  assert.equal(result.slots.length, 3);
  assert.equal(result.exceptions.length, 1);
  const gap = result.exceptions[0];
  assert.equal(gap.entry, null);
  assert.equal(gap.slot, null);
  assert.equal(gap.start.getMonth(), 10);
  assert.equal(gap.start.getDate(), 10);
});

test("an isolated distant date does not create years of inferred weekly lessons", () => {
  const items = semester();
  const start = new Date(items[0].start);
  start.setDate(start.getDate() + 7 * 10000);
  assert.equal(model([...items, { ...items[0], id: "distant", start: start.toISOString(), end: null }]), null);
});

test("elapsed lessons still define the pattern and do not become missing sessions today", () => {
  const items = change(semester(), "5-1", { location: "B312" });
  const at = new Date(2026, 10, 24, 11, 45);
  const result = model(items, at);
  assert.equal(result.slots[1].location, "A113");
  assert.equal(result.next.item.id, "5-1");
  assert.deepEqual(result.exceptions.map(({ entry }) => entry.item.id), ["5-1"]);
});

test("keeps the ongoing lesson and ignores changes whose lessons have ended", () => {
  const items = change(semester(), "0-0", { location: "Changed in the past" });
  const result = model(items, new Date(2026, 10, 3, 10, 45));
  assert.equal(result.next.status, "Идёт сейчас");
  assert.deepEqual(result.exceptions, []);
});

test("one-off dates, distinctive titles and new descriptions stay visible as exceptions", () => {
  let items = change(semester(), "2-1", { title: "Prüfung" });
  items = change(items, "3-1", { description: "Bring a laptop" });
  items.push({ ...items[0], id: "exam", title: "Exam", start: new Date(2026, 10, 7, 9).toISOString(), end: null });
  const result = model(items);
  assert.deepEqual(result.exceptions.map(({ entry }) => entry.item.id), ["2-1", "exam", "3-1"]);
  assert.equal(result.exceptions[1].slot, null);
});

test("unknown dates, overnight sessions and concurrent groups keep the detailed date list", () => {
  assert.equal(model([...semester(), { ...semester()[0], id: "undated", start: null }]), null);
  assert.equal(model(change(semester(), "0-0", { end: new Date(2026, 9, 21, 1).toISOString() })), null);
  assert.equal(model([...semester(), { ...semester()[0], id: "parallel", location: "C100" }]), null);
});

test("supports multiple recurring weekdays without conflating their rooms", () => {
  const items = semester();
  const thursdays = items.filter((item) => item.id.endsWith("-0")).map((item) => {
    const start = new Date(item.start);
    start.setDate(start.getDate() + 2);
    return { ...item, id: `thu-${item.id}`, start: start.toISOString(), end: new Date(start.getTime() + 90 * 60000).toISOString(), location: "D100" };
  });
  const result = model([...items, ...thursdays]);
  assert.equal(result.slots.length, 4);
  assert.equal(result.slots[3].weekday, 4);
  assert.equal(result.slots[3].location, "D100");
  assert.deepEqual(result.exceptions, []);
});

test("ambiguous changes preserve every unmatched lesson and missing slot", () => {
  let items = semester();
  for (const slot of [0, 1]) {
    const start = new Date(2026, 10, 3, 16 + slot * 2);
    items = change(items, `2-${slot}`, { start: start.toISOString(), end: null });
  }
  const result = model(items);
  assert.equal(result.exceptions.length, 4);
  assert.equal(result.exceptions.filter(({ entry }) => entry === null).length, 2);
  assert.equal(result.exceptions.filter(({ entry }) => entry !== null).length, 2);
});
