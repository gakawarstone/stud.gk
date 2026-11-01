import { Router } from "express";
import { createMoodleClient, moodleUrl, MoodleError } from "./moodle.js";
import { moodleDemo } from "../shared/moodle.js";
import { call } from "./session-calls.js";

export function moodleRoutes(requireLogin, client = createMoodleClient()) {
  const router = Router();
  router.get("/demo", (req, res) => res.json(moodleDemo));
  router.use(requireLogin);
  router.post("/connect", async (req, res) => {
    const url = moodleUrl(req.body?.url).href;
    const token = req.body?.token;
    if (typeof token !== "string" || !/^[a-zA-Z0-9]{16,128}$/.test(token)) throw new MoodleError("Enter a valid Moodle web service token.", 400);
    const connection = { url, token };
    const result = await client.courses(connection);
    req.session.moodle = connection;
    await call(req.session, "save");
    res.json(result);
  });
  router.get("/courses", async (req, res) => {
    if (!req.session.moodle) return res.json({ site: "", courses: [], connected: false });
    res.json({ ...await client.courses(req.session.moodle), connected: true });
  });
  router.get("/courses/:id", async (req, res) => {
    if (!req.session.moodle) throw new MoodleError("Connect to Moodle first.", 409);
    res.json(await client.contents(req.session.moodle, Number(req.params.id)));
  });
  router.post("/disconnect", async (req, res) => {
    delete req.session.moodle;
    await call(req.session, "save");
    res.json({ ok: true });
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error instanceof MoodleError ? error.status : 502).json({ error: error instanceof MoodleError ? error.message : "Could not complete the Moodle request.", code: "MOODLE_ERROR" });
  });
  return router;
}
