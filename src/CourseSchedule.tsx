import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import type { CourseResource } from "./CourseSections";
import { scheduleEntries, scheduleTime, scheduleTitle, sharedScheduleDetails, type ScheduleEntry } from "./course-schedule";
import { weeklySchedule } from "./weekly-schedule";

const weekdayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const dateMonthFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const fullDateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
const monthKey = (date: Date | null) => date ? `${date.getFullYear()}-${date.getMonth()}` : "undated";

export function CourseSchedule({ items, courseTitle }: { items: CourseResource[]; courseTitle: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const events = scheduleEntries(items, now);
  if (!events.length) return <p className="course-section-notice">No upcoming classes.</p>;
  const weekly = weeklySchedule(items, events, now);
  if (weekly) return <WeeklyCourseSchedule model={weekly} events={events} courseTitle={courseTitle} />;
  const shared = sharedScheduleDetails(events);
  const titles = events.map(({ item }) => scheduleTitle(item.title, courseTitle));
  const sharedTitle = titles.every((title) => title === titles[0]) && /^(Vorlesung|Lecture|Лекция|Übung|Seminar|Семинар)$/i.test(titles[0]) ? titles[0] : null;

  return <div className="course-schedule">
    {sharedTitle && <span className="visually-hidden">{sharedTitle}</span>}
    {(shared.time || shared.location) && <dl className="course-schedule-shared" aria-label="Shared class details">
      {shared.time && <div className="course-schedule-shared-field">
        <dt>Time</dt><dd className="course-schedule-shared-time">{shared.time}</dd>
      </div>}
      {shared.location && <div className="course-schedule-shared-field">
        <dt>Room</dt><dd className="course-schedule-shared-location">{shared.location}</dd>
      </div>}
    </dl>}
    <ScheduleTimeline events={events} courseTitle={courseTitle} shared={shared} sharedTitle={sharedTitle} />
  </div>;
}

function ScheduleTimeline({ events, courseTitle, shared = { time: null, location: null }, sharedTitle = null }: {
  events: ScheduleEntry[]; courseTitle: string;
  shared?: { time: string | null; location: string | null }; sharedTitle?: string | null;
}) {
  const months = new Map<string, typeof events>();
  for (const entry of events) {
    const key = monthKey(entry.start);
    const group = months.get(key);
    if (group) group.push(entry);
    else months.set(key, [entry]);
  }

  return <div className="course-schedule-months">
      {[...months].map(([key, entries]) => {
        const monthStart = entries[0].start;
        const monthLabel = monthStart ? monthFormat.format(monthStart) : "No date";
        return <section className="course-schedule-month" aria-label={monthLabel} key={key}>
          <div className="course-timeline-month"><h3>{monthLabel}</h3></div>
          <ol className="course-timeline">
            {entries.map((entry) => {
              const { item, start, isNext, status } = entry;
              const title = scheduleTitle(item.title, courseTitle);
              const time = scheduleTime(entry);
              const location = item.location?.trim() || null;
              return <li className={`course-timeline-entry${item.cancelled ? " is-cancelled" : ""}${isNext ? " is-next" : ""}`} key={item.id}>
                <article className="course-timeline-event" aria-label={start ? fullDateFormat.format(start) : "No date specified"}>
                  {start ? <time className="course-timeline-date" dateTime={start.toISOString()} aria-label={fullDateFormat.format(start)}>
                    <span>{start.toLocaleDateString("en-GB", { day: "2-digit" })}</span>
                  </time> : <div className="course-timeline-date"><span aria-hidden="true">?</span><small>No date</small></div>}
                  <div className="course-timeline-details">
                    <div className="course-timeline-date-label">
                      <span>{start ? dateMonthFormat.format(start).replace(/^\d+\s+/, "") : "No date specified"}</span>
                      <div className="course-timeline-date-secondary">
                        {start && <span>{weekdayFormat.format(start)}</span>}
                        {(isNext || item.cancelled || status === "In progress") && <>
                          {start && <span aria-hidden="true">·</span>}
                          <span className="course-timeline-status">{item.cancelled && <X size={12} aria-hidden="true" />}{status.toLocaleLowerCase("en-GB")}</span>
                        </>}
                      </div>
                    </div>
                    {(!shared.time || time !== shared.time) && <div className="course-timeline-time">{time || "No time specified"}</div>}
                    {(!shared.location || location !== shared.location) && <div className="course-timeline-location">{location ? `Room ${location}` : "No room specified"}</div>}
                    {title && title !== sharedTitle && <h4 className="course-timeline-title">{title}</h4>}
                    {item.description && <p className="course-timeline-description">{item.description}</p>}
                  </div>
                </article>
              </li>;
            })}
          </ol>
        </section>;
      })}
    </div>;
}

const recurringWeekdays = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const shortDateFormat = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" });
const genericTitle = /^(Vorlesung|Lecture|Лекция|Übung|Seminar|Семинар)$/i;

function WeeklyCourseSchedule({ model, events, courseTitle }: {
  model: NonNullable<ReturnType<typeof weeklySchedule>>; events: ScheduleEntry[]; courseTitle: string;
}) {
  const weekdays = [...new Set(model.slots.map(({ weekday }) => weekday))];
  const next = model.next;
  return <div className="course-schedule course-weekly-schedule">
    {weekdays.map((weekday, index) => <section className="course-weekly-day" aria-label={`On ${recurringWeekdays[weekday]}`} key={weekday}>
      <h2>On {recurringWeekdays[weekday]}</h2>
      {index === 0 && <p className="course-weekly-period">{dateMonthFormat.format(model.start)} – {fullDateFormat.format(model.end)}</p>}
      <dl className="course-weekly-slots" aria-label="Usual times and rooms">
        {model.slots.filter((slot) => slot.weekday === weekday).map((slot) => {
          const title = scheduleTitle(slot.title, courseTitle);
          return <div className="course-weekly-slot" key={slot.time}>
            <dt>{slot.time}{title && !genericTitle.test(title) && <span className="course-weekly-slot-title">{title}</span>}</dt>
            <dd><span className="visually-hidden">Room </span>{slot.location || "Not specified"}</dd>
          </div>;
        })}
      </dl>
    </section>)}
    {next?.start && <p className={`course-weekly-next${next.status === "In progress" ? " is-ongoing" : ""}`}>
      {next.status === "In progress" ? "In progress" : "Next class"} · <time dateTime={next.start.toISOString()}>
        {dateMonthFormat.format(next.start)}, {next.start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
      </time>
    </p>}
    {model.exceptions.length > 0 && <section className="course-weekly-changes" aria-label="Schedule changes">
      <h3>Changes</h3>
      <ol className="course-weekly-exceptions">
        {model.exceptions.map(({ start, entry, slot }) => {
          const title = entry ? scheduleTitle(entry.item.title, courseTitle) : "";
          const time = entry ? scheduleTime(entry) : slot?.time;
          const room = entry?.item.location?.trim() || null;
          const changedTime = slot && time !== slot.time;
          const changedRoom = slot && room !== slot.location;
          return <li key={entry?.item.id ?? `missing-${start.toISOString()}`}>
            <time className="course-weekly-exception-date" dateTime={start.toISOString()} aria-label={fullDateFormat.format(start)}>{shortDateFormat.format(start).replace(/\.$/, "")}</time>
            <div className="course-weekly-exception-content">
              {time && <span className="course-weekly-exception-time">{time}</span>}
              {!entry ? <span className="course-weekly-exception-note">{slot ? "· no class scheduled" : "No classes scheduled"}</span>
                : entry.item.cancelled ? <span className="course-weekly-cancelled">· cancelled</span>
                : <>
                  {(changedRoom || !slot) && <span className="course-weekly-exception-room">· {room ? `room ${room}` : "no room specified"}</span>}
                  {changedTime && <span className="course-weekly-exception-note">instead of {slot.time}</span>}
                </>}
              {entry && title && (!slot || entry.item.title.trim() !== slot.title) && <span className="course-weekly-exception-title">{title}</span>}
              {entry?.item.description && entry.item.description.trim() !== slot?.description && <p className="course-weekly-exception-description">{entry.item.description}</p>}
            </div>
          </li>;
        })}
      </ol>
    </section>}
    <details className="course-weekly-all-dates">
      <summary><ChevronRight size={14} aria-hidden="true" />All dates</summary>
      <ScheduleTimeline events={events} courseTitle={courseTitle} />
    </details>
  </div>;
}
