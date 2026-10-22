import type { Request, Response } from "express";
import { WindowLimiter } from "../auth/limiter.js";
import { OnboardingError, activateBusiness, confirmOnboarding, getDraft, startOnboarding } from "../onboarding/service.js";
import { clientKey, setActivator } from "./auth.js";
import { registerPublicRoutes } from "./registry.js";

setActivator(activateBusiness);

/** Starting onboarding reads every mock site, so it is throttled per client. */
export let startLimiter = new WindowLimiter(10, 10 * 60_000);
export function resetStartLimiter() { startLimiter = new WindowLimiter(10, 10 * 60_000); }

const safe = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => async (req: Request, res: Response) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof OnboardingError) return res.status(e.status).json({ error: e.message });
    console.error("onboarding error:", (e as Error).message); // never log request bodies: they can contain a PIN or personal details
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
};

registerPublicRoutes((app) => {
  app.post("/api/onboarding/start", safe(async (req, res) => {
    if (!startLimiter.hit(clientKey(req))) return res.status(429).json({ error: "Too many set-up attempts. Please wait a few minutes." });
    res.json(await startOnboarding(req.body));
  }));
  app.get("/api/onboarding/:draftId", safe((req, res) => {
    const d = getDraft(String(req.params.draftId));
    if (!d) return res.status(404).json({ error: "This set-up has expired. Please start again." });
    res.json(d);
  }));
  app.post("/api/onboarding/:draftId/confirm", safe((req, res) => {
    const created = confirmOnboarding(String(req.params.draftId), req.body?.decisions);
    res.setHeader("Cache-Control", "no-store"); // the PIN is shown exactly once and must not be cached anywhere
    res.json(created);
  }));
});
