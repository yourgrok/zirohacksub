import express from "express";
import { mockRouter } from "../mock/sites.js";

export function createApp() {
  const app = express();
  app.use("/mock", mockRouter());
  return app;
}
