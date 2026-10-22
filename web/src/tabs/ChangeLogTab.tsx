import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Ctx, EmptyState, whenIST } from "../shared";

type Kind = "all" | "details" | "holiday" | "approval" | "site" | "verified" | "setup";
const KINDS: { id: Kind; label: string }[] = [
  { id: "all", label: "Everything" }, { id: "details", label: "Business details" }, { id: "holiday", label: "Holidays" },
  { id: "approval", label: "Approvals" }, { id: "site", label: "Sent to sites" }, { id: "verified", label: "Verified" }, { id: "setup", label: "Set-up" },
];

export default function ChangeLogTab({ rev }: Ctx) {
  const [entries, setEntries] = useState<any[] | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api("/api/changelog").then((r) => setEntries(r.entries)).catch((e) => setErr(e.message)); }, [rev]);

  const shown = (entries ?? []).filter((e) => kind === "all" || e.kind === kind);
  const n = (k: Kind) => (entries ?? []).filter((e) => k === "all" || e.kind === k).length;
  return (
    <section className="card">
      <h2>Change log</h2>
      <p className="muted small">What changed in your business record and on your listings, who did it, and when (Indian time). Newest first.</p>
      <div className="chipbar">{KINDS.map((k) => <button key={k.id} className={`fchip ${kind === k.id ? "on" : ""}`} onClick={() => setKind(k.id)}>{k.label} <span className="cnt">{n(k.id)}</span></button>)}</div>
      {err && <p className="err">{err}</p>}
      {entries && shown.length === 0 && <EmptyState title="No changes here yet">Edit your details or approve a fix and it will show up here.</EmptyState>}
      {shown.length > 0 && (
        <div className="tablewrap">
          <table className="rep compact log">
            <thead><tr><th>When</th><th>Who</th><th>Type</th><th>What changed</th><th>From</th><th>To</th><th>Site</th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap" title={e.at}>{whenIST(e.at)}</td>
                  <td>{e.who}</td>
                  <td><span className={`kind k-${e.kind}`}>{e.kindLabel}</span></td>
                  <td>{e.what}</td>
                  <td className="cell" title={e.from ?? ""}>{e.from ?? <span className="muted">—</span>}</td>
                  <td className="cell" title={e.to ?? ""}>{e.to ?? <span className="muted">—</span>}</td>
                  <td>{e.site ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
