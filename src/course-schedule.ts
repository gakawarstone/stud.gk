import type { CourseResource } from "./CourseSections";

export function resourceDate(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" || /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
  const parsed = new Date(numeric !== null ? numeric < 1e12 ? numeric * 1000 : numeric : value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function calendarDay(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

export function scheduleEntries(items: CourseResource[], now: Date) {
  const events = items.map((item) => ({ item, start: resourceDate(item.start), end: resourceDate(item.end) }))
    .filter(({ start, end }) => !start || (end ?? start) > now)
    .sort((a, b) => (a.start?.getTime() ?? Infinity) - (b.start?.getTime() ?? Infinity));
  const next = events.find(({ item, start }) => !item.cancelled && start);
  return events.map(({ item, start, end }) => {
    const isNext = item.id === next?.item.id;
    const ongoing = Boolean(start && end && start <= now && end > now);
    const days = start ? Math.round((calendarDay(start) - calendarDay(now)) / 86400000) : null;
    const status = item.cancelled ? "Отменено"
      : !start ? "Дата не указана"
      : ongoing ? "Идёт сейчас"
      : days === 0 ? "Сегодня"
      : isNext ? new Intl.RelativeTimeFormat("ru", { numeric: "auto" }).format(days!, "day")
      : "Запланировано";
    return { item, start, end, isNext, status: status.charAt(0).toUpperCase() + status.slice(1) };
  });
}

export type ScheduleEntry = ReturnType<typeof scheduleEntries>[number];

export function scheduleTime({ start, end }: Pick<ScheduleEntry, "start" | "end">) {
  if (!start) return null;
  const clock = (value: Date) => value.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (!end) return clock(start);
  const endDay = start.toDateString() === end.toDateString() ? ""
    : `${end.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })} · `;
  return `${clock(start)} – ${endDay}${clock(end)}`;
}

export function sharedScheduleDetails(entries: ScheduleEntry[]) {
  const active = entries.filter(({ item }) => !item.cancelled);
  const source = active.length ? active : entries;
  function majority(values: (string | null)[]) {
    const counts = new Map<string, number>();
    for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts].find(([, count]) => count > values.length / 2)?.[0] ?? null;
  }
  return {
    time: majority(source.map(scheduleTime)),
    location: majority(source.map(({ item }) => item.location?.trim() || null)),
  };
}

export function scheduleTitle(title: string, courseTitle: string) {
  const normalized = title.trim();
  if (!courseTitle.trim() || !normalized.toLocaleLowerCase().endsWith(courseTitle.trim().toLocaleLowerCase())) return normalized;
  const prefix = normalized.slice(0, normalized.length - courseTitle.trim().length);
  return !prefix || /[\s:·–—-]$/.test(prefix) ? prefix.replace(/[\s:·–—-]+$/, "") : normalized;
}
