import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { SESSION_LIFETIME } from "./sessions.js";
import { call } from "./session-calls.js";

/** @param {{
 * authenticate: NonNullable<import('./types.js').AppOptions['authenticate']>,
 * contexts: Map<string, import('./types.js').Context>,
 * contextFor: (id: string, auth: import('./types.js').Auth) => import('./types.js').Context,
 * sync: (context: import('./types.js').Context) => Promise<void>, sessionName: string
 * }} options */
export function authRoutes({ authenticate, contexts, contextFor, sync, sessionName }) {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
      error: "Слишком много попыток входа. Подожди 15 минут и попробуй снова.",
    },
  });
  router.post("/login", loginLimiter, async (req, res) => {
    const result = await authenticate(req.body.username, req.body.password);
    const previous = contexts.get(req.sessionID);
    await call(req.session, "regenerate");
    if (previous) {
      previous.revoked = true;
      contexts.delete(previous.sessionId);
    }
    req.session.auth = {
      user: result.user,
      jar: result.jar.toJSON(),
      expiresAt: Date.now() + SESSION_LIFETIME,
    };
    await call(req.session, "save");
    const context = contextFor(req.sessionID, req.session.auth);
    void sync(context).catch(() => {});
    res.json({ ok: true, user: { name: result.user.name } });
  });
  router.post("/logout", async (req, res) => {
    const context = req.context;
    if (context) {
      context.revoked = true;
      contexts.delete(context.sessionId);
    }
    await call(req.session, "destroy");
    res.clearCookie(sessionName, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
    });
    res.json({ ok: true });
  });
  return router;
}
