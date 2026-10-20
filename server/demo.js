/** @returns {import('../shared/studip.js').AccountState} */
export function createDemo(now = new Date()) {
  const at = (minutes) =>
    new Date(now.getTime() - minutes * 60000).toISOString();
  const courses = [
    {
      id: "web",
      title: "Web-Technologien",
      code: "B-INF 230",
      description: "Современные веб-приложения и их архитектура.",
      color: "mauve",
      location: "B 201",
    },
    {
      id: "algo",
      title: "Algorithmen & Datenstrukturen",
      code: "B-INF 210",
      description: "Алгоритмы, структуры данных и оценка сложности.",
      color: "blue",
      location: "H 14",
    },
    {
      id: "math",
      title: "Mathematik II",
      code: "B-INF 120",
      description: "Линейная алгебра и математический анализ.",
      color: "peach",
      location: "A 103",
    },
    {
      id: "design",
      title: "Mensch-Computer-Interaktion",
      code: "B-INF 340",
      description: "Проектирование и исследование интерфейсов.",
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
      "Материалы к лекции · 24 страницы",
      12,
      "added",
      2400000,
    ],
    [
      "algo",
      "news",
      "Übungsgruppe am Freitag",
      "Die Übung am Freitag beginnt um 10:15 Uhr in Raum H 14. Bitte bringt eure Laptops mit.",
      48,
      "added",
    ],
    [
      "math",
      "file",
      "Übungsblatt 02.pdf",
      "Задания на следующую неделю · 4 страницы",
      95,
      "added",
      380000,
    ],
    [
      "design",
      "schedule",
      "Новая аудитория для семинара",
      "Семинар перенесён из B 201 в B 205. Время начала не изменилось.",
      155,
      "updated",
    ],
    [
      "web",
      "file",
      "Projektanforderungen.pdf",
      "Обновлены требования к семестровому проекту.",
      210,
      "updated",
      820000,
    ],
    [
      "algo",
      "file",
      "01 — Einführung.pdf",
      "Введение в алгоритмы и структуры данных.",
      1500,
      "added",
      1700000,
    ],
    [
      "design",
      "news",
      "Willkommen im neuen Semester!",
      "Alle Informationen zum Kurs findet ihr hier. Wir freuen uns auf eure Projekte!",
      1590,
      "added",
    ],
    [
      "math",
      "file",
      "Vorlesung 01 — Vektorräume.pdf",
      "Лекция 1 · векторные пространства",
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
      { id: rootId, title: "Файлы курса", parentId: null, readable: true },
      { id: lectures, title: "Vorlesungen", parentId: rootId, readable: true },
      { id: exercises, title: "Übungen", parentId: rootId, readable: true },
      { id: projects, title: "Projekt", parentId: exercises, readable: true },
    ],
    fileFolders: resources.filter((file) => file.kind === "file" && file.courseId === courseId)
      .map((file) => ({
        fileRefId: file.remoteId,
        folderId: /Projekt/i.test(file.title) ? projects
          : /Übung/i.test(file.title) ? exercises : lectures,
      })),
  };
}
