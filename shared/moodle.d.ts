export type MoodleCourses = { site: string; courses: { id: number; title: string; shortname: string }[] };
export type MoodleContents = { sections: { id: number; title: string; summary: string; modules: { id: number; title: string; kind: string; description: string; url: string | null }[] }[] };
export const moodleDemo: MoodleCourses & MoodleContents;
