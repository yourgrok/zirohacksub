import React from "react";
import { api, Pill } from "../api";
import { Ctx, Row, siteShort } from "../shared";

const STATUS: Record<string, { text: string; cls: string }> = {
  listed: { text: "Listed", cls: "s-VERIFIED" }, missing: { text: "Not listed", cls: "s-MISMATCH" }, proposed: { text: "Waiting for approval", cls: "s-PROPOSED" },
  pending: { text: "Pending site", cls: "s-PENDING_MODERATION" }, flagged: { text: "Not yours", cls: "s-FLAGGED_NOT_OWNER" }, unreadable: { text: "Unreadable", cls: "s-REJECTED" },
};

export default function SitesTab({ st, act, go }: Ctx) {
  const rows = st.rows as Row[];
  const per = (pid: string) => {
    const mine = rows.filter((r) => r.platformId === pid);
    const n = (...s: string[]) => mine.filter((r) => s.includes(r.state)).length;
    return { total: mine.length, ok: n("MATCH", "FORMAT_ONLY_EQUIVALENT", "VERIFIED"), todo: n("PROPOSED", "APPROVED", "MISMATCH", "APPLIED"), pend: n("PENDING_MODERATION"), flag: n("FLAGGED_NOT_OWNER") };
  };
  const match = (pid: string) => (st.matches as any[]).find((m) => m.platformId === pid);
  const listed = st.coverage.filter((c: any) => c.status === "listed").length;
  return (
    <div className="stack">
      <section className="card">
        <h2>Listings &amp; sites <span className="muted">— listed on {listed} of {st.coverage.length}</span></h2>
        <div className="tablewrap">
          <table className="rep compact">
            <thead><tr><th>Site</th><th>Status</th><th>Listing ID</th><th>Checks</th><th>How it was linked</th><th></th></tr></thead>
            <tbody>
              {st.coverage.map((c: any) => {
                const s = STATUS[c.status] ?? STATUS.missing;
                const k = per(c.platformId);
                const m = match(c.platformId);
                const slug = c.platformId.replace("site_", "");
                return (
                  <tr key={c.platformId}>
                    <td><b>{siteShort(c.name)}</b><div className="muted small">{c.name.match(/\((.*)\)/)?.[1]}</div></td>
                    <td><span className={`pill ${s.cls}`}>{s.text}</span><div className="muted small">{c.status === "listed" ? "" : c.note}</div></td>
                    <td>{c.listingId ? <a href={`/mock/${slug}/listing/${c.listingId}`} target="_blank" rel="noreferrer"><code>{c.listingId}</code></a> : <span className="muted">—</span>}</td>
                    <td>{k.total === 0 ? <span className="muted">not checked</span> : <span className="chk"><span title="fine or verified">✓ {k.ok}</span> <span title="need action">⚠ {k.todo}</span> <span title="pending moderation">⏳ {k.pend}</span> <span title="flagged">⛔ {k.flag}</span></span>}</td>
                    <td className="small">{m ? <>{m.confirmation}{m.score != null && <span className="muted"> · score {m.score}</span>}</> : c.status === "listed" ? <span className="muted">linked at setup</span> : <span className="muted">—</span>}</td>
                    <td className="right">
                      {c.canAdd && <button className="btn tiny primary" disabled={st.busy} onClick={() => act(async () => { await api(`/api/listings/${c.platformId}/propose`, {}); go("approvals"); })}>Add my business here</button>}
                      {c.status === "listed" && <a className="btn tiny" href={`/mock/${slug}/listing/${c.listingId}`} target="_blank" rel="noreferrer">View public page</a>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Each site also lists look-alike businesses (similar name, different address and phone). The agent only ever opens the listing IDs above and never touches the look-alikes.</p>
      </section>

      {(st.matches as any[]).length > 0 && (
        <section className="card">
          <div className="plat-h"><h2>How your listings were matched</h2><a className="btn small" href="/api/report-matches.csv">Export CSV</a></div>
          <div className="tablewrap">
            <table className="rep compact">
              <thead><tr><th>Site</th><th>Matched listing</th><th>Score</th><th>Owner confirmation</th><th>Created listing</th></tr></thead>
              <tbody>
                {(st.matches as any[]).map((m) => (
                  <tr key={m.platformId}>
                    <td>{siteShort(m.platform)}</td><td><code>{m.listingId}</code></td><td title={m.why}>{m.score ?? "—"}</td><td>{m.confirmation}</td>
                    <td>{m.created ? <><Pill state={m.created.state} /> <span className="muted small">{m.created.approval}</span></> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Score = phone 40 + address 35 + name 25 (hover a score for the breakdown).</p>
        </section>
      )}
    </div>
  );
}
