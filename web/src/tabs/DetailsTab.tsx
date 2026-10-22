import React from "react";
import { Ctx, siteShort, weekRows } from "../shared";

export default function DetailsTab({ st, go }: Ctx) {
  const b = st.business;
  const listed = st.coverage.filter((c: any) => c.status === "listed").length;
  const rows = st.rows as any[];
  const n = (s: string) => rows.filter((r) => r.state === s).length;
  return (
    <div className="tabgrid">
      <section className="card">
        <div className="plat-h"><h2>My current details</h2><button className="btn small primary" onClick={() => go("edit")}>✏️ Edit details</button></div>
        <p className="big">{b.name}</p>
        <dl className="kv">
          <dt>Business ID</dt><dd><code>{b.id}</code></dd>
          <dt>Address</dt><dd>{b.address}</dd>
          <dt>Phone</dt><dd>{b.phone}</dd>
        </dl>
        <h3>Normal opening hours</h3>
        <table className="mini hours"><tbody>{weekRows(b.hours).map((r) => <tr key={r.day} className={r.text === "Closed" ? "closed" : ""}><td>{r.day}</td><td>{r.text}</td></tr>)}</tbody></table>
        <p className="muted small">These are the details the agent treats as correct. Every listing site is compared with them.</p>
      </section>

      <div className="stack">
        <section className="card">
          <h2>Configuration</h2>
          <dl className="kv">
            <dt>Today</dt><dd>{st.today} ({st.tz}){st.demoNow ? " — fixed demo date" : ""}</dd>
            <dt>Planner</dt><dd>{st.plannerMode === "gemini" ? "Gemini (with safety rules in code)" : "Deterministic (no AI key needed)"}</dd>
            <dt>Page reader</dt><dd>{st.readerMode}</dd>
            <dt>Login</dt><dd>PIN only · {b.isDemo ? "demo business" : "your business"}</dd>
          </dl>
        </section>

        <section className="card">
          <h2>At a glance</h2>
          <div className="stats">
            <button className="stat" onClick={() => go("sites")}><b>{listed}/{st.coverage.length}</b><span>sites listed</span></button>
            <button className="stat" onClick={() => go("approvals")}><b>{n("PROPOSED") + n("APPROVED")}</b><span>need approval</span></button>
            <button className="stat" onClick={() => go("consistency")}><b>{n("VERIFIED")}</b><span>verified</span></button>
            <button className="stat" onClick={() => go("approvals")}><b>{n("PENDING_MODERATION") + n("FLAGGED_NOT_OWNER")}</b><span>pending / flagged</span></button>
          </div>
          <p className="summary" aria-live="polite">{st.summary ?? "No scan yet — press “Scan listings” above."}</p>
        </section>
      </div>

      <section className="card wide">
        <h2>Holidays and special days on record</h2>
        {st.exceptions.length === 0 && <p className="muted">None yet. Add one in <button className="linkish" onClick={() => go("edit")}>Edit &amp; Ask</button>, for example “closed on 26th December”.</p>}
        <ul className="plain">
          {st.exceptions.map((e: any) => (
            <li key={e.id} className={e.status === "removed" ? "struck" : ""}>
              <b>{e.start === e.end ? e.start : `${e.start} → ${e.end}`}</b> {e.kind === "closed" ? "Closed" : `${e.open}–${e.close}`} {e.reason ? `(${e.reason})` : ""}
              <span className="tag">{e.source}</span>{e.status === "removed" && <span className="tag">cancelled</span>}
            </li>
          ))}
        </ul>
        <p className="muted small">Listed on: {st.coverage.filter((c: any) => c.status === "listed").map((c: any) => siteShort(c.name)).join(", ") || "none yet"}.</p>
      </section>
    </div>
  );
}
