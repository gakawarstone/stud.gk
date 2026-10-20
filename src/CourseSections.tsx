import { ChevronDown } from "lucide-react";
import { courseTabs } from "./CourseSidebar";
import type { ExtraCourseTab } from "./course-tabs";
import { CourseSchedule } from "./CourseSchedule";
import { resourceDate as date } from "./course-schedule";

import type { CourseDetails, CourseResource } from "../shared/studip";
export type { CourseDetails, CourseResource } from "../shared/studip";

function ResourceDate({ value }: { value: string | number | null | undefined }) {
  const parsed = date(value);
  return parsed ? <time dateTime={parsed.toISOString()}>{parsed.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</time> : null;
}

export function CourseSections({ course, tab, resources, unavailable, onRead }: {
  course: CourseDetails;
  tab: Exclude<ExtraCourseTab, "nextcloud">;
  resources: CourseResource[];
  unavailable: boolean;
  onRead: (id: string) => void;
}) {
  const items = resources.filter((item) => item.courseId === course.id && item.kind === tab);
  const news = [...items].sort((a, b) => (date(b.createdAt || b.updatedAt)?.getTime() ?? 0) - (date(a.createdAt || a.updatedAt)?.getTime() ?? 0));
  return <section className={`course-section${tab === "schedule" ? " course-section-schedule" : ""}`} aria-label={courseTabs[tab].label}>
    {tab !== "schedule" && <h2 className="course-section-title">{courseTabs[tab].label}</h2>}
    {unavailable && <p className="course-section-notice" role="status">Нет доступа к этому разделу в Stud.IP.</p>}
    {tab === "news" && (news.length ? news.map((item) => <details className="course-news" key={item.id}
      onToggle={(event) => { if (event.currentTarget.open) onRead(item.id); }}>
      <summary><div><h3>{item.title}</h3><ResourceDate value={item.createdAt || item.updatedAt} /></div><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="course-resource-body">{item.description || "Текст объявления отсутствует."}</div>
    </details>) : !unavailable && <p className="course-section-notice">Объявлений пока нет.</p>)}
    {tab === "schedule" && (items.length ? <CourseSchedule items={items} courseTitle={course.title} />
      : !unavailable && <p className="course-section-notice">Занятий пока нет.</p>)}
    {tab === "course" && <div className="course-info">
      <h3>{course.title}</h3>
      {(course.code || course.semester || course.location) && <p className="course-event-meta">{[course.code, course.semester, course.location].filter(Boolean).map((value, i) => <span key={i}>{value}</span>)}</p>}
      {(course.description || items[0]?.description) && <p className="course-resource-body">{course.description || items[0]?.description}</p>}
      {course.url && <a className="course-original-link" href={course.url} target="_blank" rel="noreferrer">Открыть в Stud.IP ↗</a>}
    </div>}
  </section>;
}
