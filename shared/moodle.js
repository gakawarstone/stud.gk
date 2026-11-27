export const moodleDemo = {
  site: "Campus Moodle · Demo",
  courses: [{ id: 42, title: "Software Engineering", shortname: "SE-2026" }],
  sections: [
    { id: 1, title: "General", summary: "Course materials, announcements and useful links.", modules: [
      { id: 1, title: "Course announcements", kind: "forum", description: "Updates from the teaching team.", url: null },
      { id: 2, title: "Module handbook", kind: "resource", description: "Learning objectives and assessment criteria.", url: null },
    ] },
    { id: 2, title: "Week 1 · Requirements and design", summary: "Start with the lecture notes, then work through the first assignment.", modules: [
      { id: 3, title: "Lecture 01 · Requirements engineering.pdf", kind: "resource", description: "Lecture slides and reading material.", url: null },
      { id: 4, title: "Assignment 1 · Model a course planner", kind: "assign", description: "Identify user stories and sketch the domain model.", url: null },
      { id: 5, title: "Check your understanding", kind: "quiz", description: "Review the key concepts from this week.", url: null },
    ] },
  ],
};
