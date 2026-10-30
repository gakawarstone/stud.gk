/** @returns {import('../shared/studip.js').AccountState} */
export function createDemo(now = new Date()) {
  const at = (minutes) =>
    new Date(now.getTime() - minutes * 60000).toISOString();
  const courses = [
    {
      id: "web",
      title: "Web technologies",
      code: "B-INF 230",
      description: "Modern web applications and their architecture.",
      color: "mauve",
      location: "B 201",
    },
    {
      id: "algo",
      title: "Algorithms & data structures",
      code: "B-INF 210",
      description: "Algorithms, data structures, and complexity analysis.",
      color: "blue",
      location: "H 14",
    },
    {
      id: "math",
      title: "Mathematics II",
      code: "B-INF 120",
      description: "Linear algebra and calculus.",
      color: "peach",
      location: "A 103",
    },
    {
      id: "design",
      title: "Human-computer interaction",
      code: "B-INF 340",
      description: "Interface design and research.",
      color: "green",
      location: "B 205",
    },
  ].map((c) => ({ ...c, semester: "WS 2026/27", url: null }));
  /** @type {[string, import('../shared/studip.js').ResourceKind, string, string, number, import('../shared/studip.js').Change['action'], number?][]} */
  const entries = [
    [
      "web",
      "file",
      "03 — CSS Layouts.pdf",
      "Lecture materials · 24 pages",
      12,
      "added",
      2400000,
    ],
    [
      "algo",
      "news",
      "Friday exercise group",
      "The Friday exercise starts at 10:15 in room H 14. Please bring your laptops.",
      48,
      "added",
    ],
    [
      "math",
      "file",
      "Exercise sheet 02.pdf",
      "Exercises for next week · 4 pages",
      95,
      "added",
      380000,
    ],
    [
      "design",
      "schedule",
      "New room for the seminar",
      "The seminar has moved from B 201 to B 205. The start time is unchanged.",
      155,
      "updated",
    ],
    [
      "web",
      "file",
      "Project requirements.pdf",
      "Semester project requirements have been updated.",
      210,
      "updated",
      820000,
    ],
    [
      "algo",
      "file",
      "01 — Introduction.pdf",
      "Introduction to algorithms and data structures.",
      1500,
      "added",
      1700000,
    ],
    [
      "design",
      "news",
      "Welcome to the new semester!",
      "You can find all course information here. We look forward to your projects!",
      1590,
      "added",
    ],
    [
      "math",
      "file",
      "Lecture 01 — Vector spaces.pdf",
      "Lecture 1 · vector spaces",
      1650,
      "added",
      3100000,
    ],
  ];
  const changes = entries.map(
    ([courseId, kind, title, description, minutes, action, size], i) => ({
      id: `demo-${i}`,
      resourceId: `demo-resource-${i}`,
      remoteId: `demo-${i}`,
      courseId,
      kind,
      title,
      description,
      size: size ?? 0,
      mime: kind === "file" ? "application/pdf" : "",
      action,
      occurredAt: at(minutes),
      createdAt: at(minutes),
      updatedAt: at(minutes),
      read: i >= 5,
      starred: i === 4,
      ...(kind === "schedule"
        ? {
            location: "B 205",
            start: new Date(now.getTime() + 86400000).toISOString(),
            cancelled: false,
          }
        : {}),
    }),
  );
  return {
    courses,
    changes,
    resources: [
      ...changes.map((c) => ({ ...c, id: c.resourceId })),
      ...courses.map((course) => ({
        id: `course:${course.id}`, remoteId: course.id, kind: /** @type {const} */ ("course"), courseId: course.id,
        title: course.title, description: course.description, location: course.location,
      })),
    ],
    lastSync: at(2),
    semester: "WS 2026/27",
  };
}

export function createDemoFolders(courseId, resources) {
  const rootId = `demo-root-${courseId}`;
  const lectures = `demo-lectures-${courseId}`;
  const exercises = `demo-exercises-${courseId}`;
  const projects = `demo-projects-${courseId}`;
  return {
    rootId,
    folders: [
      { id: rootId, title: "Course files", parentId: null, readable: true },
      { id: lectures, title: "Lectures", parentId: rootId, readable: true },
      { id: exercises, title: "Exercises", parentId: rootId, readable: true },
      { id: projects, title: "Project", parentId: exercises, readable: true },
    ],
    fileFolders: resources.filter((file) => file.kind === "file" && file.courseId === courseId)
      .map((file) => ({
        fileRefId: file.remoteId,
        folderId: /Project/i.test(file.title) ? projects
          : /Exercise/i.test(file.title) ? exercises : lectures,
      })),
  };
}
