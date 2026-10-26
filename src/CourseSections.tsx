import { ChevronDown } from "lucide-solid";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js";
import type { CourseDetails, CourseResource } from "../shared/studip";
import { CourseSchedule } from "./CourseSchedule";
import { courseTabs } from "./CourseSidebar";
import { resourceDate as date } from "./course-schedule";
import type { ExtraCourseTab } from "./course-tabs";
import { newsParts } from "./news-text";
export type { CourseDetails, CourseResource } from "../shared/studip";
function ResourceDate(props: { value: string | number | null | undefined }) {
  const parsed = createMemo(() => date(props.value));
  return (
    <>
      {parsed() ? (
        <time datetime={parsed()!.toISOString()}>
          {parsed()!.toLocaleDateString("de-DE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })}
        </time>
      ) : null}
    </>
  );
}
function NewsPost(props: {
  item: CourseResource;
  onRead: (id: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  let heading: HTMLDivElement | null = null;
  const id = createUniqueId();
  const text = createMemo(
    () => props.item.description || "Текст объявления отсутствует.",
  );
  const isLong = createMemo(() => text().length > 420);
  const parts = createMemo(() => newsParts(text(), expanded()));
  createEffect(
    on(
      () => [props.item.id, props.item.updatedAt, props.item.description],
      () => {
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            props.onRead(props.item.id);
          }
        });
        if (heading) observer.observe(heading);
        onCleanup(() => observer.disconnect());
      },
    ),
  );
  return (
    <article class="course-news" aria-labelledby={`${id}-title`}>
      <div class="course-news-heading" ref={(element) => (heading = element)}>
        <h3 id={`${id}-title`}>{props.item.title}</h3>
        <ResourceDate value={props.item.createdAt || props.item.updatedAt} />
      </div>
      <div class="course-resource-body" id={`${id}-body`}>
        <For each={parts()}>
          {(part) =>
            part.url ? (
              <span>
                <a href={part.url} target="_blank" rel="noopener noreferrer">
                  {part.visible.slice(0, part.url.length)}
                </a>
                {part.visible.slice(part.url.length)}
              </span>
            ) : (
              part.visible
            )
          }
        </For>
        {isLong() && !expanded() && "…"}
      </div>
      {isLong() && (
        <button
          type="button"
          class="course-news-more"
          aria-expanded={expanded()}
          aria-controls={`${id}-body`}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded() ? "Weniger anzeigen" : "Weiterlesen"}
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    </article>
  );
}
export function CourseSections(props: {
  course: CourseDetails;
  tab: Exclude<ExtraCourseTab, "nextcloud">;
  resources: CourseResource[];
  unavailable: boolean;
  onRead: (id: string) => void;
}) {
  const items = createMemo(() =>
    props.resources.filter(
      (item) => item.courseId === props.course.id && item.kind === props.tab,
    ),
  );
  const news = createMemo(() =>
    [...items()].sort(
      (a, b) =>
        (date(b.createdAt || b.updatedAt)?.getTime() ?? 0) -
        (date(a.createdAt || a.updatedAt)?.getTime() ?? 0),
    ),
  );
  return (
    <section
      class={`course-section${props.tab === "schedule" ? " course-section-schedule" : props.tab === "news" ? " course-section-news" : ""}`}
      aria-label={courseTabs[props.tab].label}
    >
      {props.tab === "course" && (
        <h2 class="course-section-title">{courseTabs[props.tab].label}</h2>
      )}
      {props.unavailable && (
        <p class="course-section-notice" role="status">
          Нет доступа к этому разделу в Stud.IP.
        </p>
      )}
      {props.tab === "news" &&
        (news().length ? (
          <For each={news()}>
            {(item) => (
              <Show when={item.id} keyed>
                {(_key) => <NewsPost item={item} onRead={props.onRead} />}
              </Show>
            )}
          </For>
        ) : (
          !props.unavailable && (
            <p class="course-section-notice">Объявлений пока нет.</p>
          )
        ))}
      {props.tab === "schedule" &&
        (items().length ? (
          <CourseSchedule items={items()} courseTitle={props.course.title} />
        ) : (
          !props.unavailable && (
            <p class="course-section-notice">Занятий пока нет.</p>
          )
        ))}
      {props.tab === "course" && (
        <div class="course-info">
          <h3>{props.course.title}</h3>
          {(props.course.code ||
            props.course.semester ||
            props.course.location) && (
            <p class="course-event-meta">
              {
                <For
                  each={[
                    props.course.code,
                    props.course.semester,
                    props.course.location,
                  ].filter(Boolean)}
                >
                  {(value, i) => <span>{value}</span>}
                </For>
              }
            </p>
          )}
          {(props.course.description || items()[0]?.description) && (
            <p class="course-resource-body">
              {props.course.description || items()[0]?.description}
            </p>
          )}
          {props.course.url && (
            <a
              class="course-original-link"
              href={props.course.url}
              target="_blank"
              rel="noreferrer"
            >
              Открыть в Stud.IP ↗
            </a>
          )}
        </div>
      )}
    </section>
  );
}
