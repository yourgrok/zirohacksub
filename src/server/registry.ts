import type { Express } from "express";

/** Modules (onboarding) register their public routes here; app.ts mounts them before the authenticated API. */
export const publicRouteMounts: ((app: Express) => void)[] = [];
export function registerPublicRoutes(fn: (app: Express) => void) { publicRouteMounts.push(fn); }
