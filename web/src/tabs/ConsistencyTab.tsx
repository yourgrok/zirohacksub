import React, { useMemo, useState } from "react";
import { Pill } from "../api";
import { Ctx, Row, siteShort } from "../shared";

type F = "all" | "attention" | "verified" | "fine";
const group = (s: string): F => (["MATCH", "FORMAT_ONLY_EQUIVALENT"].includes(s) ? "fine" : s === "VERIFIED" ? "verified" : "attention");
const SHORT_APPROVAL: Record<string, string> = {
  "Awaiting your approval": "Awaiting you", "Approved": "Approved", "Rejected": "Rejected", "Not needed": "—", "Not editable — flagged": "Not editable", "Not proposed yet": "—",
};
const cut = (s: string, n = 46) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, " · ");

export default function ConsistencyTab({ st }: Ctx) {
  const rows = st.rows as Row[];
  const [f, setF] = useState<F>("all");
  const [site, setSite] = useState("all");
  const sites = useMemo(() => [...new Set(rows.map((r) => r.platformId))].map((id) => ({ id, name: siteShort(rows.find((r) => r.platformId === id)!.platform) })), [rows]);
  const shown = rows.filter((r) => (f === "all" || group(r.state) === f) && (site === "all" || r.platformId === site));
  const n = (g: F) => rows.filter((r) => g === "all" || group(r.state) === g).length;

  return (
    <section className="card printable">
      <div className="plat-h">
        <h2>Before / after consistency table</h2>
        <div className="actions noprint"><a className="btn small" href="/api/report.csv">Export CSV</a><button className="btn small" onClick={() => window.print()}>Printable view</button></div>
      </div>
      <p className="summary slim">{st.summary ?? "No scan yet."}</p>
      <div className="filters noprint">
        <div className="chipbar">
          {(["all", "attention", "verified", "fine"] as F[]).map((x) => <button key={x} className={`fchip ${f === x ? "on" : ""}`} onClick={() => setF(x)}>{{ all: "All", attention: "Needs attention", verified: "Verified", fine: "Already fine" }[x]} <span className="cnt">{n(x)}</span></button>)}
        </div>
        <select aria-label="Filter by site" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="all">All sites</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="tablewrap">
        <table className="rep compact">
          <thead><tr><th>Site</th><th>Field</th><th>Original value</th><th>Intended value</th><th>Approval</th><th>Verified status</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.fieldId} className={`row-${r.state}`}>
                <td>{siteShort(r.platform)}</td>
                <td>{r.field}</td>
                <td title={r.original}>{cut(oneLine(r.original))}</td>
                <td title={r.intended}>{cut(oneLine(r.intended))}</td>
                <td>{SHORT_APPROVAL[r.approval] ?? r.approval}</td>
                <td title={r.verified}><Pill state={r.state} /></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="muted">{rows.length ? "Nothing matches this filter." : "Nothing scanned yet — press “Scan listings”."}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted small noprint">{shown.length} of {rows.length} rows. Hover a cell to see the full text or the verification note.</p>
    </section>
  );
}
