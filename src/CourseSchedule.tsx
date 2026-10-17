import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CourseResource } from "./CourseSections";
import { scheduleEntries, scheduleTime, scheduleTitle, sharedScheduleDetails } from "./course-schedule";

const weekdayFormat = new Intl.DateTimeFormat("ru-RU", { weekday: "long" });
const dateMonthFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
const fullDateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const monthKey = (date: Date | null) => date ? `${date.getFullYear()}-${date.getMonth()}` : "undated";

export function CourseSchedule({ items, courseTitle }: { items: CourseResource[]; courseTitle: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const events = scheduleEntries(items, now);
  if (!events.length) return <p className="course-section-notice">Предстоящих занятий нет.</p>;
  const shared = sharedScheduleDetails(events);
  const titles = events.map(({ item }) => scheduleTitle(item.title, courseTitle));
  const sharedTitle = titles.every((title) => title === titles[0]) && /^(Vorlesung|Lecture|Лекция|Übung|Seminar|Семинар)$/i.test(titles[0]) ? titles[0] : null;
  const months = new Map<string, typeof events>();
  for (const entry of events) {
    const key = monthKey(entry.start);
    const group = months.get(key);
    if (group) group.push(entry);
    else months.set(key, [entry]);
  }

  return <div className="course-schedule">
    {sharedTitle && <span className="visually-hidden">{sharedTitle}</span>}
    {(shared.time || shared.location) && <dl className="course-schedule-shared" aria-label="Общие детали занятий">
      {shared.time && <div className="course-schedule-shared-field">
        <dt>Время</dt><dd className="course-schedule-shared-time">{shared.time}</dd>
      </div>}
      {shared.location && <div className="course-schedule-shared-field">
        <dt>Аудитория</dt><dd className="course-schedule-shared-location">{shared.location}</dd>
      </div>}
    </dl>}
    <div className="course-schedule-months">
      {[...months].map(([key, entries]) => {
        const monthStart = entries[0].start;
        const monthLabel = monthStart ? monthFormat.format(monthStart).replace(/\s*г\.$/, "") : "Без даты";
        return <section className="course-schedule-month" aria-label={monthLabel} key={key}>
          <div className="course-timeline-month"><h3>{monthLabel}</h3></div>
          <ol className="course-timeline">
            {entries.map((entry) => {
              const { item, start, isNext, status } = entry;
              const title = scheduleTitle(item.title, courseTitle);
              const time = scheduleTime(entry);
              const location = item.location?.trim() || null;
              return <li className={`course-timeline-entry${item.cancelled ? " is-cancelled" : ""}${isNext ? " is-next" : ""}`} key={item.id}>
                <article className="course-timeline-event" aria-label={start ? fullDateFormat.format(start) : "Дата не указана"}>
                  {start ? <time className="course-timeline-date" dateTime={start.toISOString()} aria-label={fullDateFormat.format(start)}>
                    <span>{start.toLocaleDateString("ru-RU", { day: "2-digit" })}</span>
                  </time> : <div className="course-timeline-date"><span aria-hidden="true">?</span><small>Без даты</small></div>}
                  <div className="course-timeline-details">
                    <div className="course-timeline-date-label">
                      <span>{start ? dateMonthFormat.format(start).replace(/^\d+\s+/, "") : "Дата не указана"}</span>
                      <div className="course-timeline-date-secondary">
                        {start && <span>{weekdayFormat.format(start)}</span>}
                        {(isNext || item.cancelled || status === "Идёт сейчас") && <>
                          {start && <span aria-hidden="true">·</span>}
                          <span className="course-timeline-status">{item.cancelled && <X size={12} aria-hidden="true" />}{status.toLocaleLowerCase("ru-RU")}</span>
                        </>}
                      </div>
                    </div>
                    {(!shared.time || time !== shared.time) && <div className="course-timeline-time">{time || "Время не указано"}</div>}
                    {(!shared.location || location !== shared.location) && <div className="course-timeline-location">{location ? `Аудитория ${location}` : "Аудитория не указана"}</div>}
                    {title && title !== sharedTitle && <h4 className="course-timeline-title">{title}</h4>}
                    {item.description && <p className="course-timeline-description">{item.description}</p>}
                  </div>
                </article>
              </li>;
            })}
          </ol>
        </section>;
      })}
    </div>
  </div>;
}
