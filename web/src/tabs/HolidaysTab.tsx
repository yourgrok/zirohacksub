import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Ctx } from "../shared";

export default function HolidaysTab({ st, act, rev }: Ctx) {
  const [fs, setFs] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api("/api/foresight").then(setFs).catch((e) => setErr(e.message)); }, [rev]);
  if (err) return <section className="card"><p className="err">{err}</p></section>;
  if (!fs) return <section className="card"><h2>Upcoming holidays</h2><p className="muted">Checking your listing sites…</p></section>;
  const r = fs.next?.readiness;
  return (
    <section className="card">
      <h2>Upcoming holidays <span className="muted">(next {fs.windowDays} days)</span></h2>
      {fs.alerts.map((a: any) => (
        <div key={a.holidayId} className={`alert ${a.milestone === 7 ? "a-red" : a.milestone === 14 ? "a-clay" : "a-soft"}`}><b>{a.milestone}-day alert:</b> {a.message}</div>
      ))}
      {fs.next && (
        <div className="ready" title={fs.formula}>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r ?? 0}><div style={{ width: `${r ?? 0}%` }} /></div>
          <span><b>Readiness for {fs.next.holiday.name}: {r}/100</b> <span className="info" tabIndex={0} aria-label={fs.formula} title={fs.formula}>How is this worked out?</span></span>
        </div>
      )}
      <ul className="hol tall">
        {fs.holidays.map((h: any) => (
          <li key={h.holiday.id}>
            <div className="hl">
              <b>{h.holiday.name}</b> <span className="muted">{h.holiday.date} · {h.daysAway === 0 ? "today" : `in ${h.daysAway}d`} · {h.holiday.region}</span>
              {!h.holiday.verified && <span className="tag warn" title={h.holiday.note}>verify date</span>}
            </div>
            <div className="hr">
              <span className={`chip c-${h.chip}`}>{h.chipText}</span>
              {h.chip === "NOT_SET" && (
                <button className="btn tiny" disabled={st.busy} title="Saves a draft on your record only. You still approve every site change." onClick={() => act(async () => { await api(`/api/foresight/${h.holiday.id}/accept`, {}); await api("/api/runs/scan", {}); })}>
                  Accept draft: {h.suggestion.kind === "closed" ? "Closed" : "Special hours 10–14"}
                </button>
              )}
            </div>
          </li>
        ))}
        {fs.holidays.length === 0 && <li className="muted">No holidays in the window.</li>}
      </ul>
      <p className="muted small">Festival dates shift each year — confirm each date before accepting a draft. Drafts never change a listing by themselves.</p>
    </section>
  );
}
