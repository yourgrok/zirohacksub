import React from "react";
import { api } from "../api";
import { Ctx, siteShort, weekRows } from "../shared";

export default function DetailsTab({ st, me, act, go }: Ctx) {
  const b = st.business;
  const listed = st.coverage.filter((c: any) => c.status === "listed").length;
  const rows = st.rows as any[];
  const n = (s: string) => rows.filter((r) => r.state === s).length;
  const neverScanned = rows.length === 0;
  return (
    <div className="stack">
      {neverScanned && (
        <section className="card start">
          <h2>Start here</h2>
          <p>Your details below are the "source of truth". The agent compares every listing site with them.</p>
          <ol>
            <li><b>Scan listings</b>: the agent reads each site and shows what differs.</li>
            <li><b>Review</b>: you approve or reject every suggested fix.</li>
            <li><b>Apply approved &amp; verify</b>: only approved fixes are sent, then each page is reloaded to check.</li>
          </ol>
          <button className="btn primary" disabled={st.busy} onClick={() => act(() => api("/api/runs/scan", {}))}>Scan listings now</button>
        </section>
      )}

      <div className="tabgrid">
        <section className="card">
          <div className="plat-h"><h2>My current details</h2><button className="btn small" onClick={() => go("edit")}>Edit details</button></div>
          <p className="big">{b.name}</p>
          <dl className="kv">
            <dt>Address</dt><dd>{b.address}</dd>
            <dt>Phone</dt><dd>{b.phone}</dd>
            <dt>Business ID</dt><dd><code>{b.id}</code></dd>
          </dl>
          <h3>Normal opening hours</h3>
          <table className="hours"><tbody>{weekRows(b.hours).map((r) => <tr key={r.day} className={r.text === "Closed" ? "closed" : ""}><td>{r.day}</td><td>{r.text}</td></tr>)}</tbody></table>
        </section>

        <div className="stack">
          <section className="card">
            <h2>At a glance</h2>
            <div className="stats">
              <button className="stat" onClick={() => go("sites")}><b>{listed}/{st.coverage.length}</b><span>sites listed</span></button>
              <button className="stat" onClick={() => go("approvals")}><b>{n("PROPOSED") + n("APPROVED")}</b><span>need approval</span></button>
              <button className="stat" onClick={() => go("consistency")}><b>{n("VERIFIED")}</b><span>verified</span></button>
              <button className="stat" onClick={() => go("approvals")}><b>{n("PENDING_MODERATION") + n("FLAGGED_NOT_OWNER")}</b><span>pending or flagged</span></button>
            </div>
            {!neverScanned && <p className="summary" aria-live="polite">{st.summary}</p>}
          </section>

          <section className="card">
            <h2>Holidays and special days</h2>
            {st.exceptions.length === 0 && <p className="muted">None saved. You can add one in <button className="linkish" onClick={() => go("edit")}>Edit &amp; Ask</button>, for example "closed on 26th December".</p>}
            <ul className="plain">
              {st.exceptions.map((e: any) => (
                <li key={e.id} className={e.status === "removed" ? "struck" : ""}>
                  <b>{e.start === e.end ? e.start : `${e.start} to ${e.end}`}</b> {e.kind === "closed" ? "Closed" : `${e.open}–${e.close}`} {e.reason ? `(${e.reason})` : ""}
                  {e.status === "removed" && <span className="tag">cancelled</span>}
                </li>
              ))}
            </ul>
            <p className="muted small">Listed on: {st.coverage.filter((c: any) => c.status === "listed").map((c: any) => siteShort(c.name)).join(", ") || "no site yet"}.</p>
          </section>
        </div>
      </div>

      <details className="card tools">
        <summary>Settings{me.business?.isDemo ? " and demo tools" : ""}</summary>
        <dl className="kv">
          <dt>Today</dt><dd>{st.today} ({st.tz}){st.demoNow ? ", fixed demo date" : ""}</dd>
          <dt>Planner</dt><dd>{st.plannerMode === "gemini" ? "Gemini (experimental), with safety rules in code" : "Rules-driven (fixed steps, safety checks in code)"}</dd>
          <dt>Page reader</dt><dd>{st.readerMode}</dd>
          <dt>Login</dt><dd>PIN only{b.isDemo ? " (demo business)" : ""}</dd>
        </dl>
        <div className="actions">
          <a className="btn small" href="/mock/" target="_blank" rel="noreferrer">Open the mock listing sites</a>
          <a className="btn small" href="/mock/admin" target="_blank" rel="noreferrer">Mock moderator page</a>
          {me.business?.isDemo && <a className="btn small" href="/tests">Test cases</a>}
          {me.business?.isDemo && <button className="btn small ghost" disabled={st.busy} onClick={() => act(async () => { if (confirm("Reset ALL demo data (every business) to the seeded state?")) await api("/api/reset", {}); })}>Reset demo data</button>}
        </div>
      </details>
    </div>
  );
}
