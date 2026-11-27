import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { createMoodleClient, MoodleError } from "./moodle.js";
import { validateCredentials } from "./login.js";
import { moodleDemo } from "../shared/moodle.js";
import { call } from "./session-calls.js";

export function moodleRoutes(requireLogin, client = createMoodleClient()) {
  const router = Router();
  router.get("/demo", (req, res) => res.json(moodleDemo));
  router.use(requireLogin);
  const signInLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many Moodle sign-in attempts. Try again in 15 minutes." },
  });
  router.post("/connect", signInLimiter, async (req, res) => {
    let credentials;
    try {
      credentials = validateCredentials(req.body?.username, req.body?.password);
    } catch {
      throw new MoodleError("Enter your university username and password.", 400);
    }
    const connection = await client.signIn(credentials.username, credentials.password);
    const result = await client.courses(connection);
    if (req.context.revoked || req.context.expiresAt <= Date.now())
      throw new MoodleError("Your Stud.IP session has expired. Sign in again.", 401);
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
