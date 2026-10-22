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
        <div className="top-title">
          <h1>{me.business?.name}</h1>
          <p className="sub">Listing Consistency Agent: keeps your details the same everywhere, and asks before changing anything.</p>
        </div>
        <div className="top-right">
        <div className="busy-slot" aria-live="polite">
          {st.busy && (
            <button type="button" className="busy-pill" onClick={() => go("trace")} title="Open the Agent Trace to see each step as it happens">
              <span className="emo" aria-hidden>🤖</span>
              <span className="busy-text">
                <b>Agent is working<span className="dots" aria-hidden /></b>
                <span className="busy-sub">{tab === "trace" ? "You're watching it live below" : "Click here to check progress"}</span>
              </span>
            </button>
          )}
        </div>
        <button className="btn small ghost" onClick={onLogout}>Log out</button>
        </div>
      </header>

      <div className="sticky">
        <div className="actionbar" role="region" aria-label="Run the agent">
          <button className="btn primary small" disabled={st.busy} onClick={() => act(() => api("/api/runs/scan", {}))} title="Reads every listing site and compares meaning, not formatting"><span className="stepno">1</span>Scan listings</button>
          <button className="btn small" disabled={st.busy || waiting === 0} onClick={() => go("approvals")} title="Review what the agent found"><span className="stepno">2</span>Review{waiting > 0 ? ` (${waiting})` : ""}</button>
          <button className="btn small" disabled={st.busy} onClick={() => act(() => api("/api/runs/execute", {}))} title="Sends only what you approved, then reloads each page to check"><span className="stepno">3</span>Apply approved &amp; verify</button>
          {st.busy && <button type="button" className="spin linkish-btn" onClick={() => go("trace")} title="Open the Agent Trace">🤖 Working… view progress</button>}
        </div>
        <div className="tabs" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
          {TAB_DEFS.map((t, i) => (
            <React.Fragment key={t.id}>
              {t.more && !TAB_DEFS[i - 1]?.more && <span className="tabsep" aria-hidden />}
              <button
                id={`tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
                className={`tab ${t.more ? "more" : ""} ${tab === t.id ? "on" : ""}`} title={t.hint} onClick={() => go(t.id)}
              >
                {t.label}
                {t.id === "approvals" && waiting > 0 && <span className="tabcount" aria-label={`${waiting} waiting`}>{waiting}</span>}
              </button>
            </React.Fragment>
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
