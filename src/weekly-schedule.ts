import type { CourseResource } from "./CourseSections";
import { resourceDate, scheduleTime, type ScheduleEntry } from "./course-schedule.ts";

type DatedEntry = { item: CourseResource; start: Date; end: Date | null };
export type WeeklySlot = {
  weekday: number;
  time: string;
  location: string | null;
  title: string;
  description: string;
  startMinutes: number;
  endMinutes: number | null;
};
export type WeeklyException = { start: Date; entry: ScheduleEntry | null; slot: WeeklySlot | null };

const dayNumber = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
const minutes = (date: Date) => date.getHours() * 60 + date.getMinutes();
const location = (item: CourseResource) => item.location?.trim() || null;
function majority<T>(values: T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].find(([, count]) => count > values.length / 2);
}

/** Learn from the published semester, so elapsed lessons cannot change the usual time. */
export function weeklySchedule(items: CourseResource[], upcoming: ScheduleEntry[], now: Date) {
  if (!upcoming.length || upcoming.some(({ start, end }) => !start || (end && (end <= start || dayNumber(end) !== dayNumber(start))))) return null;
  const published: DatedEntry[] = items.flatMap((item) => {
    const start = resourceDate(item.start);
    const end = resourceDate(item.end);
    return start ? [{ item, start, end }] : [];
  });
  const seen = new Set<string>();
  for (const entry of published) {
    const key = `${dayNumber(entry.start)}-${scheduleTime(entry)}`;
    // Concurrent groups must remain separate in the detailed date list.
    if (seen.has(key)) return null;
    seen.add(key);
  }
  const byWeekday = new Map<number, DatedEntry[]>();
  for (const entry of published) {
    const weekday = entry.start.getDay();
    const group = byWeekday.get(weekday) ?? [];
    group.push(entry);
    byWeekday.set(weekday, group);
  }
  const slots: WeeklySlot[] = [];
  const gaps: Date[] = [];
  for (const [weekday, entries] of byWeekday) {
    const days = [...new Set(entries.map(({ start }) => dayNumber(start)))].sort((a, b) => a - b);
    // Sparse/fortnightly dates are not evidence of a weekly recurrence.
    const weeklyIntervals = days.filter((day, i) => i > 0 && day - days[i - 1] === 7).length;
    const weeks = (days[days.length - 1] - days[0]) / 7 + 1;
    if (days.length < 3 || weeklyIntervals <= (days.length - 1) / 2 || days.length < weeks * 0.6) continue;
    const times = new Map<string, DatedEntry[]>();
    for (const entry of entries) {
      if (entry.item.cancelled || (entry.end && (entry.end <= entry.start || dayNumber(entry.end) !== dayNumber(entry.start)))) continue;
      const time = scheduleTime(entry)!;
      const group = times.get(time) ?? [];
      group.push(entry);
      times.set(time, group);
    }
    for (const [time, occurrences] of times) {
      const dates = new Set(occurrences.map(({ start }) => dayNumber(start)));
      if (dates.size <= days.length / 2 || dates.size !== occurrences.length) continue;
      const room = majority(occurrences.map(({ item }) => location(item)));
      const title = majority(occurrences.map(({ item }) => item.title.trim()));
      if (!room || !title) continue;
      slots.push({
        weekday, time, location: room[0], title: title[0],
        description: majority(occurrences.map(({ item }) => item.description.trim()))?.[0] ?? "",
        startMinutes: minutes(occurrences[0].start),
        endMinutes: occurrences[0].end ? minutes(occurrences[0].end) : null,
      });
    }
    if (slots.some((slot) => slot.weekday === weekday)) {
      const date = new Date(entries.reduce((first, entry) => entry.start < first ? entry.start : first, entries[0].start));
      for (date.setDate(date.getDate() + 7); dayNumber(date) < days[days.length - 1]; date.setDate(date.getDate() + 7)) {
        if (!days.includes(dayNumber(date))) gaps.push(new Date(date));
      }
    }
  }
  if (new Set(slots.map(({ time }) => time)).size < 2) return null;
  slots.sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.startMinutes - b.startMinutes);

  const futureIds = new Map(upcoming.map((entry) => [entry.item.id, entry]));
  const exceptions: WeeklyException[] = [];
  // Keep holiday/break weeks explicit instead of implying that lessons exist there.
  for (const date of gaps) {
    const daySlots = slots.filter(({ weekday }) => weekday === date.getDay());
    const firstMinute = Math.min(...daySlots.map(({ startMinutes }) => startMinutes));
    const lastMinute = Math.max(...daySlots.map(({ startMinutes, endMinutes }) => endMinutes ?? startMinutes));
    const start = new Date(date);
    start.setHours(Math.floor(firstMinute / 60), firstMinute % 60, 0, 0);
    const end = new Date(date);
    end.setHours(Math.floor(lastMinute / 60), lastMinute % 60, 0, 0);
    if (end > now) exceptions.push({ start, entry: null, slot: null });
  }
  const byDay = new Map<number, DatedEntry[]>();
  for (const entry of published) {
    const key = dayNumber(entry.start);
    const day = byDay.get(key) ?? [];
    day.push(entry);
    byDay.set(key, day);
  }
  for (const entries of byDay.values()) {
    const daySlots = slots.filter(({ weekday }) => weekday === entries[0].start.getDay());
    const unmatched = [...entries];
    const missing: WeeklySlot[] = [];
    for (const slot of daySlots) {
      const index = unmatched.findIndex((entry) => scheduleTime(entry) === slot.time);
      if (index < 0) { missing.push(slot); continue; }
      const [actual] = unmatched.splice(index, 1);
      const entry = futureIds.get(actual.item.id);
      if (entry && (entry.item.cancelled || location(entry.item) !== slot.location || entry.item.title.trim() !== slot.title
        || (entry.item.description.trim() && entry.item.description.trim() !== slot.description))) {
        exceptions.push({ start: actual.start, entry, slot });
      }
    }
    // A lone unmatched lesson can replace a lone absent slot; ambiguous changes stay separate.
    const replacement = missing.length === 1 && unmatched.length === 1
      && unmatched[0].item.title.trim() === missing[0].title;
    for (const actual of unmatched) {
      const entry = futureIds.get(actual.item.id);
      if (entry) exceptions.push({ start: actual.start, entry, slot: replacement ? missing[0] : null });
    }
    if (!replacement) for (const slot of missing) {
      const start = new Date(entries[0].start);
      start.setHours(Math.floor(slot.startMinutes / 60), slot.startMinutes % 60, 0, 0);
      const end = new Date(start);
      const endMinutes = slot.endMinutes ?? slot.startMinutes;
      end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0);
      if (end > now) exceptions.push({ start, entry: null, slot });
    }
  }
  exceptions.sort((a, b) => a.start.getTime() - b.start.getTime());
  const period = published.filter(({ start }) => slots.some(({ weekday }) => weekday === start.getDay())).map(({ start }) => start);
  return {
    slots, exceptions,
    start: new Date(Math.min(...period.map(Number))),
    end: new Date(Math.max(...period.map(Number))),
    next: upcoming.find(({ isNext }) => isNext) ?? null,
  };
}
