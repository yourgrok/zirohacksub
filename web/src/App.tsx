import React, { useCallback, useEffect, useState } from "react";
import { api, type Me } from "./api";
import { Ctx, Row, TAB_DEFS, TabId } from "./shared";
import DetailsTab from "./tabs/DetailsTab";
import SitesTab from "./tabs/SitesTab";
import ApprovalsTab from "./tabs/ApprovalsTab";
import ConsistencyTab from "./tabs/ConsistencyTab";
import EditTab from "./tabs/EditTab";
import ChangeLogTab from "./tabs/ChangeLogTab";
import TraceTab from "./tabs/TraceTab";
import HolidaysTab from "./tabs/HolidaysTab";
import AddBusinessTab from "./tabs/AddBusinessTab";

const PANELS: Record<TabId, React.ComponentType<Ctx>> = {
  details: DetailsTab, sites: SitesTab, approvals: ApprovalsTab, consistency: ConsistencyTab, edit: EditTab,
  changelog: ChangeLogTab, trace: TraceTab, holidays: HolidaysTab, add: AddBusinessTab,
};

const tabFromHash = (): TabId => {
  const h = window.location.hash.replace(/^#\/?/, "");
  return (TAB_DEFS.some((t) => t.id === h) ? h : "details") as TabId;
};

export default function App({ me, onLogout, onSwitched }: { me: Me; onLogout: () => void; onSwitched: () => void }) {
  const [st, setSt] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [tab, setTab] = useState<TabId>(tabFromHash);

  useEffect(() => {
    const h = () => setTab(tabFromHash());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const go = useCallback((t: TabId) => { window.location.hash = `#/${t}`; setTab(t); }, []);

  const load = useCallback(async () => {
    try { setSt(await api("/api/state")); setRev((r) => r + 1); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!st?.busy) return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [st?.busy, load]);

  const act = useCallback(async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); } catch (e: any) { setErr(e.message); } await load(); }, [load]);

  if (!st) return <div className="wrap"><p>Loading…</p>{err && <p className="err">{err}</p>}</div>;

  const rows: Row[] = st.rows;
  const waiting = rows.filter((r) => r.state === "PROPOSED" || r.state === "APPROVED").length;
  const ctx: Ctx = { st, me, act, go, rev, onSwitched };
  const Panel = PANELS[tab];

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TAB_DEFS.findIndex((t) => t.id === tab);
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TAB_DEFS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = TAB_DEFS[(to + TAB_DEFS.length) % TAB_DEFS.length].id;
    go(next);
    setTimeout(() => document.getElementById(`tab-${next}`)?.focus(), 0);
  };

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Business Listing Consistency Agent</h1>
          <p className="sub">{me.business?.name} — keeps your details the same on every listing site, and asks before changing anything.</p>
        </div>
        <div className="badges">
          <span className="badge" title={st.demoNow ? "Date fixed with DEMO_NOW" : "Real current date"}>Today: {st.today} IST{st.demoNow ? " (demo date)" : ""}</span>
          <span className={`badge ${st.plannerMode === "gemini" ? "b-gem" : ""}`}>Planner: {st.plannerMode === "gemini" ? "Gemini" : "Deterministic"}</span>
          {me.business?.isDemo && <a className="btn small" href="/tests">Tests</a>}
          <a className="btn small" href="/mock/" target="_blank" rel="noreferrer">Mock sites</a>
          <a className="btn small" href="/mock/admin" target="_blank" rel="noreferrer">Mock admin</a>
          {me.business?.isDemo && <button className="btn small ghost" disabled={st.busy} onClick={() => act(async () => { if (confirm("Reset ALL demo data (every business) to the seeded state?")) await api("/api/reset", {}); })}>Reset demo data</button>}
          <button className="btn small ghost" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <div className="sticky">
        <div className="actionbar" role="region" aria-label="Run the agent">
          <button className="btn primary small" disabled={st.busy} onClick={() => act(() => api("/api/runs/scan", {}))} title="Reads every listing page and dashboard and compares meaning, not formatting">① Scan listings</button>
          <button className="btn small" disabled={st.busy || waiting === 0} onClick={() => go("approvals")} title="Review what the agent found">② Review{waiting > 0 ? ` (${waiting})` : ""}</button>
          <button className="btn primary small" disabled={st.busy} onClick={() => act(() => api("/api/runs/execute", {}))} title="Sends only what you approved, then reloads each page to check">③ Apply approved &amp; verify</button>
          {st.busy && <span className="spin" aria-live="polite">🤖 Agent is working…</span>}
          <span className="ab-summary" title={st.summary ?? ""} aria-live="polite">{st.summary ?? "No scan yet — press “Scan listings”."}</span>
        </div>
        <div className="tabs" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
          {TAB_DEFS.map((t) => (
            <button
              key={t.id} id={`tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              className={`tab ${tab === t.id ? "on" : ""}`} title={t.hint} onClick={() => go(t.id)}
            >
              <span aria-hidden>{t.icon}</span> {t.label}
              {t.id === "approvals" && waiting > 0 && <span className="tabcount" aria-label={`${waiting} waiting`}>{waiting}</span>}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="alert a-red" role="alert">{err}</div>}
      {st.lastError && <div className="alert a-red">Last run failed: {st.lastError}</div>}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="panel">
        <Panel {...ctx} />
      </div>
      <footer className="foot">Mock listing sites and synthetic data only. SQLite is temporary on free hosts; the app reseeds on boot.</footer>
    </div>
  );
}
