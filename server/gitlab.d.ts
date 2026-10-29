export type GitlabProject = { id: string; url: string };
export function normalizeGitlabProject(value: unknown): { url: string };
export function gitlabProjectList(value: unknown): GitlabProject[];
