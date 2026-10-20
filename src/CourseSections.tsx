import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { courseTabs } from "./CourseSidebar";
import type { ExtraCourseTab } from "./course-tabs";
import { CourseSchedule } from "./CourseSchedule";
import { resourceDate as date } from "./course-schedule";

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

function ResourceDate({ value }: { value: string | number | null | undefined }) {
  const parsed = date(value);
  return parsed ? <time dateTime={parsed.toISOString()}>{parsed.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</time> : null;
}

function NewsPost({ item, onRead }: { item: CourseResource; onRead: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  const read = useRef(onRead);
  read.current = onRead;
  const id = useId();
  const text = item.description || "Текст объявления отсутствует.";
  const isLong = text.length > 420;
  let remaining = expanded || !isLong ? text.length : 420;

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        read.current(item.id);
      }
    });
    if (heading.current) observer.observe(heading.current);
    return () => observer.disconnect();
  }, [item.id, item.updatedAt, item.description]);

  return <article className="course-news" aria-labelledby={`${id}-title`}>
    <div className="course-news-heading" ref={heading}>
      <h3 id={`${id}-title`}>{item.title}</h3>
      <ResourceDate value={item.createdAt || item.updatedAt} />
    </div>
    <div className="course-resource-body" id={`${id}-body`}>
      {text.split(/(https?:\/\/[^\s<>"']+)/gi).map((part, index) => {
        const visible = part.slice(0, Math.max(0, remaining));
        remaining -= part.length;
        if (!visible) return null;
        if (!/^https?:\/\//i.test(part)) return visible;
        let url = part.replace(/[.,!?;:]+$/, "");
        for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
          while (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1);
        }
        return <span key={index}><a href={url} target="_blank" rel="noopener noreferrer">{visible.slice(0, url.length)}</a>{visible.slice(url.length)}</span>;
      })}
      {isLong && !expanded && "…"}
    </div>
    {isLong && <button type="button" className="course-news-more" aria-expanded={expanded} aria-controls={`${id}-body`}
      onClick={() => setExpanded((value) => !value)}>
      {expanded ? "Weniger anzeigen" : "Weiterlesen"}<ChevronDown size={14} aria-hidden="true" />
    </button>}
  </article>;
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
  return <section className={`course-section${tab === "schedule" ? " course-section-schedule" : tab === "news" ? " course-section-news" : ""}`} aria-label={courseTabs[tab].label}>
    {tab === "course" && <h2 className="course-section-title">{courseTabs[tab].label}</h2>}
    {unavailable && <p className="course-section-notice" role="status">Нет доступа к этому разделу в Stud.IP.</p>}
    {tab === "news" && (news.length ? news.map((item) => <NewsPost item={item} onRead={onRead} key={item.id} />)
      : !unavailable && <p className="course-section-notice">Объявлений пока нет.</p>)}
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
