import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Course } from "../shared/studip";

export function useCourseOrder(courses: Course[]) {
  const [courseOrder, setCourseOrder] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("campus-course-order") || "[]",
      );
      return Array.isArray(saved)
        ? [
            ...new Set(
              saved.filter((id): id is string => typeof id === "string"),
            ),
          ]
        : [];
    } catch {
      return [];
    }
  });
  const [courseDrag, setCourseDrag] = useState<{
    id: string;
    targetId: string | null;
    x: number;
    y: number;
  } | null>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const suppressCardClickUntil = useRef(0);
  const ranks = new Map(courseOrder.map((id, index) => [id, index]));
  const orderedCourses = [...courses].sort(
    (a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity),
  );
  function moveCourse(id: string, targetId: string) {
    const ids = orderedCourses.map((c) => c.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    setCourseOrder(ids);
    try {
      localStorage.setItem("campus-course-order", JSON.stringify(ids));
    } catch { /* Reordering still works when browser storage is unavailable. */ }
  }
  function startCourseDrag(event: ReactPointerEvent<HTMLElement>, id: string) {
    if (event.button !== 0 || !event.isPrimary) return;
    const onHandle = (event.target as Element).closest(".course-drag-handle");
    if (event.pointerType !== "mouse" && !onHandle) return;
    dragCleanup.current?.();
    const { clientX: startX, clientY: startY, pointerId } = event;
    let started = false;
    let targetId: string | null = null;
    function move(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      if (!started && Math.hypot(e.clientX - startX, e.clientY - startY) < 6)
        return;
      started = true;
      e.preventDefault();
      targetId =
        document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>("[data-course-id]")?.dataset.courseId || null;
      setCourseDrag({ id, targetId, x: e.clientX, y: e.clientY });
      if (e.clientY < 60) window.scrollBy(0, -20);
      else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 20);
    }
    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      dragCleanup.current = null;
      setCourseDrag(null);
      if (started) suppressCardClickUntil.current = Date.now() + 400;
    }
    function end(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      if (started && targetId) moveCourse(id, targetId);
      cleanup();
    }
    function cancel() {
      cleanup();
    }
    function escape(e: KeyboardEvent) {
      if (e.key === "Escape") cleanup();
    }
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    dragCleanup.current = cleanup;
  }
  useEffect(() => () => dragCleanup.current?.(), []);
  const cancelCourseDrag = useCallback(() => dragCleanup.current?.(), []);
  return { orderedCourses, courseDrag, moveCourse, startCourseDrag, suppressCardClickUntil, cancelCourseDrag };
}
