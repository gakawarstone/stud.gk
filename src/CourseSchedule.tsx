import { ChevronRight, X } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import type { CourseResource } from "./CourseSections";
import {
  scheduleEntries,
  scheduleTime,
  scheduleTitle,
  sharedScheduleDetails,
  type ScheduleEntry,
} from "./course-schedule";
import { weeklySchedule } from "./weekly-schedule";
const weekdayFormat = new Intl.DateTimeFormat("ru-RU", { weekday: "long" });
const dateMonthFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});
const monthFormat = new Intl.DateTimeFormat("ru-RU", {
  month: "long",
  year: "numeric",
});
const fullDateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const monthKey = (date: Date | null) =>
  date ? `${date.getFullYear()}-${date.getMonth()}` : "undated";
export function CourseSchedule(props: {
  items: CourseResource[];
  courseTitle: string;
}) {
  const [now, setNow] = createSignal((() => new Date())());
  onMount(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    onCleanup(() => window.clearInterval(timer));
  });
  const events = createMemo(() => scheduleEntries(props.items, now()));
  const view = () => {
    if (!events().length)
      return <p class="course-section-notice">Предстоящих занятий нет.</p>;
    const weekly = createMemo(() =>
      weeklySchedule(props.items, events(), now()),
    );
    if (weekly())
      return (
        <WeeklyCourseSchedule
          model={weekly()!}
          events={events()}
          courseTitle={props.courseTitle}
        />
      );
    const shared = createMemo(() => sharedScheduleDetails(events()));
    const titles = createMemo(() =>
      events().map(({ item }) => scheduleTitle(item.title, props.courseTitle)),
    );
    const sharedTitle = createMemo(() =>
      titles().every((title) => title === titles()[0]) &&
      /^(Vorlesung|Lecture|Лекция|Übung|Seminar|Семинар)$/i.test(titles()[0])
        ? titles()[0]
        : null,
    );
    return (
      <div class="course-schedule">
        {sharedTitle() && <span class="visually-hidden">{sharedTitle()}</span>}
        {(shared().time || shared().location) && (
          <dl class="course-schedule-shared" aria-label="Общие детали занятий">
            {shared().time && (
              <div class="course-schedule-shared-field">
                <dt>Время</dt>
                <dd class="course-schedule-shared-time">{shared().time}</dd>
              </div>
            )}
            {shared().location && (
              <div class="course-schedule-shared-field">
                <dt>Аудитория</dt>
                <dd class="course-schedule-shared-location">
                  {shared().location}
                </dd>
              </div>
            )}
          </dl>
        )}
        <ScheduleTimeline
          events={events()}
          courseTitle={props.courseTitle}
          shared={shared()}
          sharedTitle={sharedTitle()}
        />
      </div>
    );
  };
  return <>{view()}</>;
}
function ScheduleTimeline(props: {
  events: ScheduleEntry[];
  courseTitle: string;
  shared?: {
    time: string | null;
    location: string | null;
  };
  sharedTitle?: string | null;
}) {
  const months = createMemo(() => {
    const result = new Map<string, ScheduleEntry[]>();
    for (const entry of props.events) {
      const key = monthKey(entry.start);
      const group = result.get(key);
      if (group) group.push(entry);
      else result.set(key, [entry]);
    }
    return [...result];
  });
  return (
    <div class="course-schedule-months">
      {
        <For each={months()}>
          {([key, entries]) => {
            const monthStart = entries[0].start;
            const monthLabel = monthStart
              ? monthFormat.format(monthStart).replace(/\s*г\.$/, "")
              : "Без даты";
            return (
              <section class="course-schedule-month" aria-label={monthLabel}>
                <div class="course-timeline-month">
                  <h3>{monthLabel}</h3>
                </div>
                <ol class="course-timeline">
                  {
                    <For each={entries}>
                      {(entry) => {
                        const { item, start, isNext, status } = entry;
                        const title = createMemo(() =>
                          scheduleTitle(item.title, props.courseTitle),
                        );
                        const time = scheduleTime(entry);
                        const location = item.location?.trim() || null;
                        return (
                          <li
                            class={`course-timeline-entry${item.cancelled ? " is-cancelled" : ""}${isNext ? " is-next" : ""}`}
                          >
                            <article
                              class="course-timeline-event"
                              aria-label={
                                start
                                  ? fullDateFormat.format(start)
                                  : "Дата не указана"
                              }
                            >
                              {start ? (
                                <time
                                  class="course-timeline-date"
                                  datetime={start.toISOString()}
                                  aria-label={fullDateFormat.format(start)}
                                >
                                  <span>
                                    {start.toLocaleDateString("ru-RU", {
                                      day: "2-digit",
                                    })}
                                  </span>
                                </time>
                              ) : (
                                <div class="course-timeline-date">
                                  <span aria-hidden="true">?</span>
                                  <small>Без даты</small>
                                </div>
                              )}
                              <div class="course-timeline-details">
                                <div class="course-timeline-date-label">
                                  <span>
                                    {start
                                      ? dateMonthFormat
                                          .format(start)
                                          .replace(/^\d+\s+/, "")
                                      : "Дата не указана"}
                                  </span>
                                  <div class="course-timeline-date-secondary">
                                    {start && (
                                      <span>{weekdayFormat.format(start)}</span>
                                    )}
                                    {(isNext ||
                                      item.cancelled ||
                                      status === "Идёт сейчас") && (
                                      <>
                                        {start && (
                                          <span aria-hidden="true">·</span>
                                        )}
                                        <span class="course-timeline-status">
                                          {item.cancelled && (
                                            <X size={12} aria-hidden="true" />
                                          )}
                                          {status.toLocaleLowerCase("ru-RU")}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                {(!(
                                  props.shared ?? { time: null, location: null }
                                ).time ||
                                  time !==
                                    (
                                      props.shared ?? {
                                        time: null,
                                        location: null,
                                      }
                                    ).time) && (
                                  <div class="course-timeline-time">
                                    {time || "Время не указано"}
                                  </div>
                                )}
                                {(!(
                                  props.shared ?? { time: null, location: null }
                                ).location ||
                                  location !==
                                    (
                                      props.shared ?? {
                                        time: null,
                                        location: null,
                                      }
                                    ).location) && (
                                  <div class="course-timeline-location">
                                    {location
                                      ? `Аудитория ${location}`
                                      : "Аудитория не указана"}
                                  </div>
                                )}
                                {title() &&
                                  title() !== (props.sharedTitle ?? null) && (
                                    <h4 class="course-timeline-title">
                                      {title()}
                                    </h4>
                                  )}
                                {item.description && (
                                  <p class="course-timeline-description">
                                    {item.description}
                                  </p>
                                )}
                              </div>
                            </article>
                          </li>
                        );
                      }}
                    </For>
                  }
                </ol>
              </section>
            );
          }}
        </For>
      }
    </div>
  );
}
const recurringWeekdays = [
  "воскресеньям",
  "понедельникам",
  "вторникам",
  "средам",
  "четвергам",
  "пятницам",
  "субботам",
];
const shortDateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
});
const genericTitle = /^(Vorlesung|Lecture|Лекция|Übung|Seminar|Семинар)$/i;
function WeeklyCourseSchedule(props: {
  model: NonNullable<ReturnType<typeof weeklySchedule>>;
  events: ScheduleEntry[];
  courseTitle: string;
}) {
  const weekdays = createMemo(() => [
    ...new Set(props.model.slots.map(({ weekday }) => weekday)),
  ]);
  const next = createMemo(() => props.model.next);
  return (
    <div class="course-schedule course-weekly-schedule">
      {
        <For each={weekdays()}>
          {(weekday, index) => (
            <section
              class="course-weekly-day"
              aria-label={`По ${recurringWeekdays[weekday]}`}
            >
              <h2>По {recurringWeekdays[weekday]}</h2>
              {index() === 0 && (
                <p class="course-weekly-period">
                  {dateMonthFormat.format(props.model.start)} –{" "}
                  {fullDateFormat
                    .format(props.model.end)
                    .replace(/\s*г\.$/, "")}
                </p>
              )}
              <dl
                class="course-weekly-slots"
                aria-label="Обычное время и аудитории"
              >
                {
                  <For
                    each={props.model.slots.filter(
                      (slot) => slot.weekday === weekday,
                    )}
                  >
                    {(slot) => {
                      const title = createMemo(() =>
                        scheduleTitle(slot.title, props.courseTitle),
                      );
                      return (
                        <div class="course-weekly-slot">
                          <dt>
                            {slot.time}
                            {title() && !genericTitle.test(title()) && (
                              <span class="course-weekly-slot-title">
                                {title()}
                              </span>
                            )}
                          </dt>
                          <dd>
                            <span class="visually-hidden">Аудитория </span>
                            {slot.location || "Не указана"}
                          </dd>
                        </div>
                      );
                    }}
                  </For>
                }
              </dl>
            </section>
          )}
        </For>
      }
      {next()?.start && (
        <p
          class={`course-weekly-next${next()!.status === "Идёт сейчас" ? " is-ongoing" : ""}`}
        >
          {next()!.status === "Идёт сейчас"
            ? "Идёт сейчас"
            : "Ближайшее занятие"}{" "}
          ·{" "}
          <time datetime={next()!.start!.toISOString()}>
            {dateMonthFormat.format(next()!.start!)},{" "}
            {next()!.start!.toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </p>
      )}
      {props.model.exceptions.length > 0 && (
        <section
          class="course-weekly-changes"
          aria-label="Изменения расписания"
        >
          <h3>Изменения</h3>
          <ol class="course-weekly-exceptions">
            {
              <For each={props.model.exceptions}>
                {({ start, entry, slot }) => {
                  const title = createMemo(() =>
                    entry
                      ? scheduleTitle(entry.item.title, props.courseTitle)
                      : "",
                  );
                  const time = entry ? scheduleTime(entry) : slot?.time;
                  const room = entry?.item.location?.trim() || null;
                  const changedTime = slot && time !== slot.time;
                  const changedRoom = slot && room !== slot.location;
                  return (
                    <li>
                      <time
                        class="course-weekly-exception-date"
                        datetime={start.toISOString()}
                        aria-label={fullDateFormat.format(start)}
                      >
                        {shortDateFormat.format(start).replace(/\.$/, "")}
                      </time>
                      <div class="course-weekly-exception-content">
                        {time && (
                          <span class="course-weekly-exception-time">
                            {time}
                          </span>
                        )}
                        {!entry ? (
                          <span class="course-weekly-exception-note">
                            {slot
                              ? "· нет занятия в расписании"
                              : "Занятий нет в расписании"}
                          </span>
                        ) : entry.item.cancelled ? (
                          <span class="course-weekly-cancelled">
                            · отменено
                          </span>
                        ) : (
                          <>
                            {(changedRoom || !slot) && (
                              <span class="course-weekly-exception-room">
                                ·{" "}
                                {room
                                  ? `аудитория ${room}`
                                  : "аудитория не указана"}
                              </span>
                            )}
                            {changedTime && (
                              <span class="course-weekly-exception-note">
                                вместо {slot.time}
                              </span>
                            )}
                          </>
                        )}
                        {entry &&
                          title() &&
                          (!slot || entry.item.title.trim() !== slot.title) && (
                            <span class="course-weekly-exception-title">
                              {title()}
                            </span>
                          )}
                        {entry?.item.description &&
                          entry.item.description.trim() !==
                            slot?.description && (
                            <p class="course-weekly-exception-description">
                              {entry.item.description}
                            </p>
                          )}
                      </div>
                    </li>
                  );
                }}
              </For>
            }
          </ol>
        </section>
      )}
      <details class="course-weekly-all-dates">
        <summary>
          <ChevronRight size={14} aria-hidden="true" />
          Все даты
        </summary>
        <ScheduleTimeline
          events={props.events}
          courseTitle={props.courseTitle}
        />
      </details>
    </div>
  );
}
