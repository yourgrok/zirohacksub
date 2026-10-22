import React from "react";
import type { Me } from "./api";

export type TabId = "details" | "sites" | "approvals" | "consistency" | "edit" | "changelog" | "trace" | "holidays" | "add";

/** The four everyday tabs come first; the rest sit after a thin divider and are visually quieter. */
export const TAB_DEFS: { id: TabId; label: string; hint: string; more?: boolean }[] = [
  { id: "details", label: "My Details", hint: "Your current business details" },
  { id: "sites", label: "Listings & Sites", hint: "Where your business is listed" },
  { id: "approvals", label: "Approvals", hint: "Review and approve pending changes" },
  { id: "edit", label: "Edit & Ask", hint: "Change your details, or ask a question" },
  { id: "consistency", label: "Consistency", hint: "Before / after table", more: true },
  { id: "changelog", label: "Change Log", hint: "What changed, and when", more: true },
  { id: "trace", label: "Agent Trace", hint: "Every step the agent took", more: true },
  { id: "holidays", label: "Holidays", hint: "Upcoming holidays and special days", more: true },
  { id: "add", label: "Add Business", hint: "Set up another business", more: true },
];

export type Row = {
  fieldId: number; platform: string; platformId: string; field: string; fieldKey: string; original: string; intended: string;
  approval: string; verified: string; state: string; reason: string; current: string; currentNorm: string;
  why?: string; whySource?: "agent" | "Gemini";
};

export interface Ctx {
  st: any;
  me: Me;
  /** run an action, show its error, then reload the shared state */
  act: (fn: () => Promise<unknown>) => Promise<boolean>;
  go: (tab: TabId) => void;
  /** increases every time the shared state is reloaded; tabs that fetch their own data refetch when it changes */
  rev: number;
  /** switch to another business (after adding one) */
  onSwitched: () => void;
}

export const siteShort = (name: string) => name.replace(/ \(.*\)/, "");

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAME: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
export const weekRows = (h: any) => DAYS.map((d) => ({ day: DAY_NAME[d], text: h[d] ? `${h[d].open} – ${h[d].close}` : "Closed" }));

/** "22 Oct, 2:14 pm" in Indian time. */
export const whenIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const timeIST = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" });

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <div className="muted">{children}</div>}</div>;
}

export const useReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
