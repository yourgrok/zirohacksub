import React, { useCallback, useEffect, useRef, useState } from "react";
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
  const [scanPrompt, setScanPrompt] = useState<"show" | null>(null);
  const [navOpen, setNavOpen] = useState<boolean>(() => { try { return localStorage.getItem("navOpen") !== "0"; } catch { return true; } });
  const toggleNav = () => setNavOpen((o) => { try { localStorage.setItem("navOpen", o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const [nudgeDismissedAt, setNudgeDismissedAt] = useState(-1); // approved-count the owner last chose "Later" for

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

  const act = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => { setErr(null); let ok = true; try { await fn(); } catch (e: any) { ok = false; setErr(e.message); } await load(); return ok; }, [load]);

  // Start a run and follow it until the agent is idle again (the run itself is fast; this keeps the page in step with it)
  const followRun = useCallback(async (path: string) => {
    await api(path, {});
    for (let i = 0; i < 300; i++) {
      const fresh = await api("/api/state");
      setSt(fresh);
      if (!fresh.busy) break;
      await new Promise((r) => setTimeout(r, 800));
    }
  }, []);
  // Coming back to this tab (e.g. after approving an edit in the mock moderation admin) re-checks sites that were waiting for a moderator
  const auto = useRef({ pending: 0, busy: true, awaySince: 0 });
  useEffect(() => {
    // only a real trip away (the owner switched tabs or windows for a few seconds) triggers it
    const leave = () => { if (!auto.current.awaySince) auto.current.awaySince = Date.now(); };
    const back = () => {
      const a = auto.current;
      const away = a.awaySince ? Date.now() - a.awaySince : 0;
      a.awaySince = 0;
      if (document.visibilityState !== "visible" || away < 3000 || a.pending === 0 || a.busy) return;
      followRun("/api/runs/execute").catch(() => load());
    };
    const onVis = () => (document.visibilityState === "hidden" ? leave() : back());
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("blur", leave); window.removeEventListener("focus", back); };
  }, [followRun, load]);

  // While an edit waits for a site's moderator, look again every few seconds so an approval OR a rejection shows up without any clicking
  const waitingMod = st ? (st.rows as Row[]).some((r) => r.state === "PENDING_MODERATION") : false;
  const busyNow = !!st?.busy;
  useEffect(() => {
    if (!waitingMod || busyNow) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") followRun("/api/runs/execute").catch(() => load()); }, 8000);
    return () => clearInterval(t);
  }, [waitingMod, busyNow, followRun, load]);

  if (!st) return <div className="wrap"><p>Loading…</p>{err && <p className="err">{err}</p>}</div>;

  const rows: Row[] = st.rows;
  const pendingMod = rows.filter((r) => r.state === "PENDING_MODERATION").length;
  const notOwner = rows.filter((r) => r.state === "FLAGGED_NOT_OWNER").length;
  auto.current.pending = pendingMod; auto.current.busy = !!st.busy;
  const proposedCount = rows.filter((r) => r.state === "PROPOSED").length;
  const approvedCount = rows.filter((r) => r.state === "APPROVED").length;
  const waiting = proposedCount + approvedCount;
  // which step the owner should press next, so it can be highlighted
  const next: 1 | 2 | 3 = proposedCount > 0 ? 2 : approvedCount > 0 || pendingMod > 0 ? 3 : 1;
  // reminder: everything reviewed, something approved, nothing applied yet
  const showNudge = !st.busy && proposedCount === 0 && approvedCount > 0 && nudgeDismissedAt !== approvedCount;
  const runScan = async () => { setScanPrompt(null); if (await act(() => followRun("/api/runs/scan"))) setScanPrompt("show"); }; // popup only after the page state is fully refreshed
  // Apply what was approved and/or re-check sites whose moderator had not approved yet (same run: the agent re-reads each page)
  const runExecute = () => act(() => followRun("/api/runs/execute"));
  const closeScan = () => setScanPrompt(null);
  const checkChanges = () => { setScanPrompt(null); go("approvals"); };
  const applyNow = () => { setNudgeDismissedAt(approvedCount); runExecute(); go("trace"); };
  const ctx: Ctx = { st, me, act, go, rev, onSwitched };
  const Panel = PANELS[tab];

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TAB_DEFS.findIndex((t) => t.id === tab);
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? i + 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TAB_DEFS.length - 1 : null;
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
              <img className="busy-robot" src="/robot.png" alt="" aria-hidden draggable={false} />
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
          <button className={`btn stepbtn ${next === 1 ? "primary next" : ""}`} disabled={st.busy} onClick={runScan} title="Reads every listing site and compares meaning, not formatting"><span className="stepno">1</span><span className="steptxt">Scan listings<small>find differences</small></span></button>
          <span className="steparrow" aria-hidden>›</span>
          <button className={`btn stepbtn ${next === 2 ? "primary next" : ""}`} disabled={st.busy || proposedCount === 0} onClick={() => go("approvals")} title={proposedCount === 0 ? "Nothing waiting for your review" : "Review what the agent found"}><span className="stepno">2</span><span className="steptxt">Review &amp; approve{proposedCount > 0 ? ` (${proposedCount})` : ""}<small>{proposedCount > 0 ? "your decision" : "nothing to review"}</small></span></button>
          <span className="steparrow" aria-hidden>›</span>
          <button className={`btn stepbtn ${next === 3 ? "primary next" : ""}`} disabled={st.busy || approvedCount + pendingMod === 0} onClick={runExecute} title={approvedCount > 0 ? "Sends only what you approved, then reloads each page to check" : pendingMod > 0 ? "Reloads the sites that were waiting for a moderator and checks whether the change is live now" : "Approve at least one change first"}><span className="stepno">3</span><span className="steptxt">{approvedCount > 0 ? `Apply approved & verify (${approvedCount})` : pendingMod > 0 ? `Re-check pending sites (${pendingMod})` : "Apply approved & verify"}<small>{approvedCount > 0 ? "press this to send" : pendingMod > 0 ? "did the site approve it?" : "approve something first"}</small></span></button>
          {st.busy && <button type="button" className="spin linkish-btn" onClick={() => go("trace")} title="Open the Agent Trace"><img className="spin-robot" src="/robot.png" alt="" aria-hidden draggable={false} /> Working… view progress</button>}
        </div>
      </div>

      <div className={`shell ${navOpen ? "" : "navclosed"}`}>
        <nav className="sidenav" aria-label="Sections">
          <button type="button" className="navtoggle" aria-expanded={navOpen} aria-controls="side-tabs" title={navOpen ? "Close the menu" : "Open the menu"} onClick={toggleNav}>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg>
            {navOpen && <span>Menu</span>}
          </button>
          <div id="side-tabs" hidden={!navOpen}>
      <div className="tabs vtabs" role="tablist" aria-orientation="vertical" aria-label="Sections" onKeyDown={onTabKey}>
        {TAB_DEFS.map((t, i) => (
          <React.Fragment key={t.id}>
            {t.more && !TAB_DEFS[i - 1]?.more && <span className="tabsep" aria-hidden />}
            <button
              id={`tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
              className={`tab ${t.more ? "more" : ""} ${tab === t.id ? "on" : ""} ${t.id === "approvals" && pendingMod > 0 ? "attn" : ""}`} title={t.hint} onClick={() => go(t.id)}
            >
              {t.label}
              {t.id === "approvals" && waiting > 0 && <span className="tabcount" aria-label={`${waiting} waiting`}>{waiting}</span>}
              {t.id === "approvals" && pendingMod > 0 && <span className="tabcount pend" title="Waiting for a site's moderator to approve" aria-label={`${pendingMod} waiting for site moderation`}>⏳ {pendingMod}</span>}
            </button>
          </React.Fragment>
        ))}
      </div>
          </div>
        </nav>
        <div className="mainpane">
      {err && <div className="alert a-red" role="alert">{err}</div>}
      {st.lastError && <div className="alert a-red">Last run failed: {st.lastError}</div>}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="panel">
        <Panel {...ctx} />
      </div>
      {scanPrompt === "show" && !st.busy && !showNudge && (
        <div className="nudge-back" onKeyDown={(e) => { if (e.key === "Escape") closeScan(); }}>
          <div className="nudge" role="dialog" aria-modal="true" aria-labelledby="scan-h">
            {proposedCount > 0 || pendingMod > 0 || notOwner > 0 ? (
              <>
                <h2 id="scan-h">{proposedCount > 0 ? `Scan finished: ${proposedCount} change${proposedCount === 1 ? "" : "s"} to review` : "Scan finished: nothing new to approve"}</h2>
                <ul className="scan-list">
                  {proposedCount > 0 && <li><b>{proposedCount}</b> listing detail{proposedCount === 1 ? " differs" : "s differ"} from your record. You decide whether to fix {proposedCount === 1 ? "it" : "them"}.</li>}
                  {pendingMod > 0 && <li><b>{pendingMod}</b> edit{pendingMod === 1 ? " is" : "s are"} waiting for a site's moderator (the public page still shows the old value).</li>}
                  {notOwner > 0 && <li><b>{notOwner}</b> listing{notOwner === 1 ? " is" : "s are"} claimed by someone else, so you need to reclaim {notOwner === 1 ? "it" : "them"} first.</li>}
                </ul>
                <div className="actions">
                  <button className="btn primary big" autoFocus onClick={checkChanges}>{proposedCount > 0 ? "Check changes" : "Open Approvals"}</button>
                  <button className="btn ghost" onClick={closeScan}>Later</button>
                </div>
              </>
            ) : (
              <>
                <h2 id="scan-h">Scan finished: no changes found</h2>
                <p>Your name, address, phone and hours match on every listing site, so there is nothing for you to approve.</p>
                <div className="actions"><button className="btn primary big" autoFocus onClick={closeScan}>OK</button></div>
              </>
            )}
          </div>
        </div>
      )}
      {showNudge && (
        <div className="nudge-back" onKeyDown={(e) => { if (e.key === "Escape") setNudgeDismissedAt(approvedCount); }}>
          <div className="nudge" role="dialog" aria-modal="true" aria-labelledby="nudge-h">
            <h2 id="nudge-h">One more step: apply your approved changes</h2>
            <p>You approved <b>{approvedCount}</b> change{approvedCount === 1 ? "" : "s"}, but <b>nothing has been sent to the listing sites yet</b>. Press the button below and the agent will send only what you approved, then reload each page to check it.</p>
            <div className="actions">
              <button className="btn primary big" autoFocus onClick={applyNow}>Apply approved &amp; verify ({approvedCount})</button>
              <button className="btn ghost" onClick={() => setNudgeDismissedAt(approvedCount)}>Later</button>
            </div>
          </div>
        </div>
      )}
        </div>
      </div>
      <footer className="foot">Mock listing sites and synthetic data only. SQLite is temporary on free hosts; the app reseeds on boot.</footer>
    </div>
  );
}
