export const extraCourseTabs = ["news", "schedule", "course", "nextcloud", "gitlab"] as const;
export type ExtraCourseTab = (typeof extraCourseTabs)[number];
export type CourseTab = "files" | ExtraCourseTab;

export function isExtraCourseTab(value: unknown): value is ExtraCourseTab {
  return extraCourseTabs.some((tab) => tab === value);
}

export function courseTabFromHash(hash = window.location.hash): CourseTab {
  const tab = new URLSearchParams(hash.replace(/^#/, "")).get("tab");
  return isExtraCourseTab(tab) ? tab : "files";
}

export function courseTabLink(courseId: string, tab: CourseTab, folderId?: string | null) {
  return `#${new URLSearchParams({
    course: courseId,
    ...(folderId ? { folder: folderId } : {}),
    ...(tab !== "files" ? { tab } : {}),
  })}`;
}
