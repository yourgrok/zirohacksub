import React, { useState } from "react";
import { api, Pill } from "../api";
import { Ctx, EmptyState, Row } from "../shared";

const CALM = new Set(["MATCH", "FORMAT_ONLY_EQUIVALENT", "VERIFIED"]);
type Filter = "action" | "pending" | "flagged" | "done" | "all";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "action", label: "Needs my approval" }, { id: "pending", label: "Pending site" }, { id: "flagged", label: "Not yours" }, { id: "done", label: "Done" }, { id: "all", label: "All" },
];
const inFilter = (f: Filter, r: Row) =>
  f === "all" ? true
  : f === "action" ? ["PROPOSED", "APPROVED", "REJECTED", "APPLIED"].includes(r.state)
  : f === "pending" ? r.state === "PENDING_MODERATION"
  : f === "flagged" ? r.state === "FLAGGED_NOT_OWNER"
  : r.state === "VERIFIED";

export default function ApprovalsTab({ st, act }: Ctx) {
  const rows = (st.rows as Row[]).filter((r) => !["MATCH", "FORMAT_ONLY_EQUIVALENT"].includes(r.state));
  const [f, setF] = useState<Filter>("action");
  const count = (id: Filter) => rows.filter((r) => inFilter(id, r)).length;
  const shown = rows.filter((r) => inFilter(f, r));
  const proposed = rows.filter((r) => r.state === "PROPOSED");
  const platforms = [...new Set(shown.map((r) => r.platformId))];

  return (
    <section className="card">
      <div className="plat-h">
        <h2>Approvals</h2>
        {proposed.length > 0 && <button className="btn small primary" disabled={st.busy} onClick={() => act(async () => { for (const pid of new Set(proposed.map((r) => r.platformId))) await api(`/api/platforms/${pid}/approve-all`, {}); })}>Approve all {proposed.length} waiting</button>}
      </div>
      <p className="muted">Nothing is sent to a site until you approve it here and press “Apply approved &amp; verify”.</p>
      <div className="chipbar" role="tablist" aria-label="Filter approvals">
        {FILTERS.map((x) => <button key={x.id} role="tab" aria-selected={f === x.id} className={`fchip ${f === x.id ? "on" : ""}`} onClick={() => setF(x.id)}>{x.label} <span className="cnt">{count(x.id)}</span></button>)}
      </div>

      {shown.length === 0 && (
        <EmptyState title={f === "action" ? "Nothing needs your approval" : "Nothing here"}>
          {rows.length === 0 ? "Press “Scan listings” to check every site." : "Try another filter above."}
        </EmptyState>
      )}

      {platforms.map((pid) => {
        const mine = shown.filter((r) => r.platformId === pid);
        const waiting = mine.filter((r) => r.state === "PROPOSED").length;
        return (
          <div key={pid} className="plat">
            <div className="plat-h">
              <h3>{mine[0].platform}</h3>
              {waiting > 0 && <button className="btn small" disabled={st.busy} onClick={() => act(() => api(`/api/platforms/${pid}/approve-all`, {}))}>Approve all for this site ({waiting})</button>}
            </div>
            {mine.map((r) => <Card key={r.fieldId} r={r} busy={st.busy} act={act} />)}
          </div>
        );
      })}
    </section>
  );
}

function Card({ r, busy, act }: { r: Row; busy: boolean; act: Ctx["act"] }) {
  return (
    <div className={`fcard f-${r.state}`}>
      <div className="fc-top"><b>{r.field}</b><Pill state={r.state} /></div>
      {r.fieldKey === "listing:create"
        ? <div className="fc-create"><span className="lbl">Exactly what will be sent</span><div className="pre">{r.intended}</div></div>
        : <div className="fc-diff"><div><span className="lbl">Listing shows</span><div>{r.original || "—"}</div></div><div className="arrow">→</div><div><span className="lbl">Your record says</span><div>{r.intended}</div></div></div>}
      <p className="reason">{r.reason}</p>
      {r.state === "PROPOSED" && (
        <div className="actions">
          <button className="btn primary small" disabled={busy} onClick={() => act(() => api(`/api/fields/${r.fieldId}/approve`, {}))}>Approve</button>
          <button className="btn small ghost" disabled={busy} onClick={() => act(() => api(`/api/fields/${r.fieldId}/reject`, {}))}>Reject</button>
        </div>
      )}
      {r.state === "REJECTED" && <div className="actions"><span className="muted">You rejected this change; nothing will be sent.</span><button className="btn small ghost" disabled={busy} onClick={() => act(() => api(`/api/fields/${r.fieldId}/approve`, {}))}>Approve after all</button></div>}
      {r.state === "APPROVED" && <div className="actions"><span className={busy ? "applying" : "muted"}>{busy ? "Applying now… sending it, then reloading the page to check" : "Approved — it is sent when you press “Apply approved & verify” (step 3 at the top)."}</span><button className="btn small ghost" disabled={busy} onClick={() => act(() => api(`/api/fields/${r.fieldId}/reject`, {}))}>Reject instead</button></div>}
      {r.state === "FLAGGED_NOT_OWNER" && <p className="note red">Manual step for you: this listing is claimed by another account, so the agent did not try to edit it. Ask the owner of that account to release it, or claim it on the site yourself (any OTP/CAPTCHA is yours to complete), then scan again.</p>}
      {r.state === "PENDING_MODERATION" && <p className="note clay">The site accepted the edit but its moderator has not approved it yet, so the public page still shows the old value. (Demo: approve it at <a href="/mock/admin" target="_blank" rel="noreferrer">/mock/admin</a>, then press “Apply approved &amp; verify” to re-check.)</p>}
    </div>
  );
}
