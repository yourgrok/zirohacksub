import React from "react";
import type { Me } from "./api";

export type TabId = "details" | "sites" | "approvals" | "consistency" | "edit" | "changelog" | "trace" | "holidays" | "add";

export const TAB_DEFS: { id: TabId; label: string; icon: string; hint: string }[] = [
  { id: "details", label: "My Details", icon: "🏠", hint: "Your current business details and settings" },
  { id: "sites", label: "Listings & Sites", icon: "🌐", hint: "Where your business is listed" },
  { id: "approvals", label: "Approvals", icon: "✅", hint: "Review and approve pending changes" },
  { id: "consistency", label: "Consistency", icon: "📊", hint: "Before / after table" },
  { id: "edit", label: "Edit & Ask", icon: "✏️", hint: "Change your details, or ask a question" },
  { id: "changelog", label: "Change Log", icon: "🕘", hint: "What changed, and when" },
  { id: "trace", label: "Agent Trace", icon: "🤖", hint: "Every step the agent took" },
  { id: "holidays", label: "Holidays", icon: "📅", hint: "Upcoming holidays and special days" },
  { id: "add", label: "Add Business", icon: "➕", hint: "Set up another business" },
];

export type Row = {
  fieldId: number; platform: string; platformId: string; field: string; fieldKey: string; original: string; intended: string;
  approval: string; verified: string; state: string; reason: string; current: string; currentNorm: string;
};

export interface Ctx {
  st: any;
  me: Me;
  /** run an action, show its error, then reload the shared state */
  act: (fn: () => Promise<unknown>) => Promise<void>;
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

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode }) {
  return <div className="empty"><div className="empty-ic" aria-hidden>{icon}</div><b>{title}</b>{children && <div className="muted">{children}</div>}</div>;
}

export const useReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
