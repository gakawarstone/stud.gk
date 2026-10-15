import { ChevronDown } from "lucide-react";
import { courseTabs } from "./CourseSidebar";
import type { ExtraCourseTab } from "./course-tabs";

export type CourseDetails = {
  id: string;
  title: string;
  code?: string;
  semester?: string;
  description?: string;
  location?: string;
  url: string | null;
};
export type CourseResource = {
  id: string;
  kind: string;
  courseId: string;
  title: string;
  description: string;
  location?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  start?: string | number | null;
  end?: string | number | null;
  cancelled?: boolean;
};

function date(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" || /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
  const parsed = new Date(numeric !== null ? numeric < 1e12 ? numeric * 1000 : numeric : value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function ResourceDate({ value }: { value: string | number | null | undefined }) {
  const parsed = date(value);
  return parsed ? <time dateTime={parsed.toISOString()}>{parsed.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</time> : null;
}

export function CourseSections({ course, tab, resources, unavailable, onRead }: {
  course: CourseDetails;
  tab: ExtraCourseTab;
  resources: CourseResource[];
  unavailable: boolean;
  onRead: (id: string) => void;
}) {
  const items = resources.filter((item) => item.courseId === course.id && item.kind === tab);
  const news = [...items].sort((a, b) => (date(b.createdAt || b.updatedAt)?.getTime() ?? 0) - (date(a.createdAt || a.updatedAt)?.getTime() ?? 0));
  const events = [...items].sort((a, b) => (date(a.start)?.getTime() ?? Infinity) - (date(b.start)?.getTime() ?? Infinity));
  return <section className="course-section" aria-label={courseTabs[tab].label}>
    <h2 className="course-section-title">{courseTabs[tab].label}</h2>
    {unavailable && <p className="course-section-notice" role="status">Нет доступа к этому разделу в Stud.IP.</p>}
    {tab === "news" && (news.length ? news.map((item) => <details className="course-news" key={item.id}
      onToggle={(event) => { if (event.currentTarget.open) onRead(item.id); }}>
      <summary><div><h3>{item.title}</h3><ResourceDate value={item.createdAt || item.updatedAt} /></div><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className="course-resource-body">{item.description || "Текст объявления отсутствует."}</div>
    </details>) : !unavailable && <p className="course-section-notice">Объявлений пока нет.</p>)}
    {tab === "schedule" && (events.length ? events.map((item) => {
      const start = date(item.start), end = date(item.end);
      return <article className={`course-event ${item.cancelled ? "cancelled" : ""}`} key={item.id}>
        <h3>{item.title}</h3>
        <div className="course-event-meta"><ResourceDate value={item.start} />
          {start && <span>{start.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}{end ? ` – ${end.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>}
          {item.location && <span>{item.location}</span>}{item.cancelled && <span>Отменено</span>}
        </div>
        {item.description && <p className="course-resource-body">{item.description}</p>}
      </article>;
    }) : !unavailable && <p className="course-section-notice">Занятий пока нет.</p>)}
    {tab === "course" && <div className="course-info">
      <h3>{course.title}</h3>
      {(course.code || course.semester || course.location) && <p className="course-event-meta">{[course.code, course.semester, course.location].filter(Boolean).map((value, i) => <span key={i}>{value}</span>)}</p>}
      {(course.description || items[0]?.description) && <p className="course-resource-body">{course.description || items[0]?.description}</p>}
      {course.url && <a className="course-original-link" href={course.url} target="_blank" rel="noreferrer">Открыть в Stud.IP ↗</a>}
    </div>}
  </section>;
}
