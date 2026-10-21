import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, Pill } from "./api";

type Row = { fieldId: number; platform: string; platformId: string; field: string; fieldKey: string; original: string; intended: string; approval: string; verified: string; state: string; reason: string; current: string; currentNorm: string };
const HIDE_CARD = new Set(["MATCH", "FORMAT_ONLY_EQUIVALENT"]);

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
function hoursText(h: any): string {
  const key = (d: string) => (h[d] ? `${h[d].open}–${h[d].close}` : "Closed");
  const out: string[] = [];
  for (let i = 0; i < 7; ) {
    let j = i;
    while (j + 1 < 7 && key(DAYS[j + 1]) === key(DAYS[i])) j++;
    const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
    out.push(`${i === j ? cap(DAYS[i]) : cap(DAYS[i]) + "–" + cap(DAYS[j])} ${key(DAYS[i])}`);
    i = j + 1;
  }
  return out.join(" · ");
}

export default function App() {
  const [st, setSt] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [trace, setTrace] = useState<any[]>([]);
  const [fs, setFs] = useState<any>(null);
  const [allRuns, setAllRuns] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api("/api/state");
      setSt(s);
      const t = await api(`/api/trace${allRuns ? "?all=1" : ""}`);
      setTrace(t.rows);
      setFs(await api("/api/foresight"));
    } catch (e: any) { setErr(e.message); }
  }, [allRuns]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!st?.busy) return;
    const t = setInterval(load, 1200);
    return () => clearInterval(t);
  }, [st?.busy, load]);

  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); } catch (e: any) { setErr(e.message); } await load(); };

  if (!st) return <div className="wrap"><p>Loading…</p>{err && <p className="err">{err}</p>}</div>;
  const rows: Row[] = st.rows;

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <h1>Business Listing Consistency Agent</h1>
          <p className="sub">Keeps your address, phone and hours the same on every listing site — and asks you before changing anything.</p>
        </div>
        <div className="badges">
          <span className="badge" title={st.demoNow ? "Date fixed with DEMO_NOW" : "Real current date"}>Today: {st.today} IST{st.demoNow ? " (demo date)" : ""}</span>
          <span className={`badge ${st.plannerMode === "gemini" ? "b-gem" : ""}`}>Planner: {st.plannerMode === "gemini" ? "Gemini" : "Deterministic"}</span>
          <span className="badge">Reader: {st.readerMode}</span>
          <a className="btn small" href="/tests">Tests</a>
          <a className="btn small" href="/mock/" target="_blank" rel="noreferrer">Mock sites</a>
          <a className="btn small" href="/mock/admin" target="_blank" rel="noreferrer">Mock admin</a>
          <button className="btn small ghost" disabled={st.busy} onClick={() => act(async () => { if (confirm("Reset all demo data to the seeded state?")) await api("/api/reset", {}); })}>Reset demo data</button>
        </div>
      </header>

      {err && <div className="alert a-red" role="alert">{err}</div>}
      {st.lastError && <div className="alert a-red">Last run failed: {st.lastError}</div>}

      <div className="grid2">
        <BusinessCard st={st} />
        <Holidays fs={fs} act={act} />
      </div>

      <div className="grid2">
        <ChangeBox st={st} act={act} />
        <section className="card">
          <h2>Run the agent</h2>
          <p className="muted">1. Scan reads every listing page and dashboard and compares meaning, not formatting. 2. You approve each change below. 3. Apply sends only what you approved, then reloads each public page to check.</p>
          <div className="actions">
            <button className="btn primary" disabled={st.busy} onClick={() => act(() => api("/api/runs/scan", {}))}>① Scan listings</button>
            <button className="btn primary" disabled={st.busy} onClick={() => act(() => api("/api/runs/execute", {}))}>③ Apply approved &amp; verify</button>
            {st.busy && <span className="spin" aria-live="polite">Agent is working…</span>}
          </div>
          <p className="summary" aria-live="polite">{st.summary ?? "No scan yet — press “Scan listings”."}</p>
        </section>
      </div>

      <Approvals st={st} rows={rows} act={act} />
      <Report st={st} rows={rows} />
      <Trace trace={trace} allRuns={allRuns} setAllRuns={setAllRuns} />
      <footer className="foot">Mock listing sites and synthetic data only. SQLite is temporary on free hosts; the app reseeds on boot.</footer>
    </div>
  );
}

function BusinessCard({ st }: { st: any }) {
  const b = st.business;
  return (
    <section className="card">
      <h2>Your approved record</h2>
      <p className="big">{b.name}</p>
      <dl className="kv">
        <dt>Business ID</dt><dd><code>{b.id}</code></dd>
        <dt>Address</dt><dd>{b.address}</dd>
        <dt>Phone</dt><dd>{b.phone}</dd>
        <dt>Normal hours</dt><dd>{hoursText(b.hours)}</dd>
      </dl>
      <h3>Holiday exceptions on record</h3>
      {st.exceptions.length === 0 && <p className="muted">None yet.</p>}
      <ul className="plain">
        {st.exceptions.map((e: any) => (
          <li key={e.id} className={e.status === "removed" ? "struck" : ""}>
            <b>{e.start === e.end ? e.start : `${e.start} → ${e.end}`}</b> {e.kind === "closed" ? "Closed" : `${e.open}–${e.close}`} {e.reason ? `(${e.reason})` : ""}
            <span className="tag">{e.source}</span>{e.status === "removed" && <span className="tag">cancelled</span>}
          </li>
        ))}
      </ul>
      <h3>Listings (stable IDs)</h3>
      <ul className="plain small">
        {st.platforms.map((p: any) => (
          <li key={p.id}><b>{p.name}</b> — <a href={p.listing.publicPath} target="_blank" rel="noreferrer"><code>{p.listing.listingId}</code></a>
            <span className="muted"> · look-alike “Sunrise Sweet House” (<code>{p.listing.listingId.replace("1001", "2002")}</code>) exists here and is never touched</span></li>
        ))}
      </ul>
    </section>
  );
}

function Holidays({ fs, act }: { fs: any; act: (f: () => Promise<unknown>) => Promise<void> }) {
  if (!fs) return <section className="card"><h2>Upcoming holidays</h2><p>Loading…</p></section>;
  const r = fs.next?.readiness;
  return (
    <section className="card">
      <h2>Upcoming holidays <span className="muted">(next {fs.windowDays} days)</span></h2>
      {fs.alerts.map((a: any) => (
        <div key={a.holidayId} className={`alert ${a.milestone === 7 ? "a-red" : a.milestone === 14 ? "a-amber" : "a-blue"}`}>
          <b>{a.milestone}-day alert:</b> {a.message}
        </div>
      ))}
      {fs.next && (
        <div className="ready" title={fs.formula}>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r ?? 0}><div style={{ width: `${r ?? 0}%` }} /></div>
          <span><b>Readiness for {fs.next.holiday.name}: {r}/100</b> <span className="info" tabIndex={0} aria-label={fs.formula} title={fs.formula}>ⓘ formula</span></span>
        </div>
      )}
      <ul className="hol">
        {fs.holidays.map((h: any) => (
          <li key={h.holiday.id}>
            <div className="hl">
              <b>{h.holiday.name}</b> <span className="muted">{h.holiday.date} · {h.daysAway === 0 ? "today" : `in ${h.daysAway}d`} · {h.holiday.region}</span>
              {!h.holiday.verified && <span className="tag warn" title={h.holiday.note}>verify date</span>}
            </div>
            <div className="hr">
              <span className={`chip c-${h.chip}`}>{h.chipText}</span>
              {h.chip === "NOT_SET" && (
                <button className="btn tiny" title="Creates a draft on your record only. You still approve every site change." onClick={() => act(() => api(`/api/foresight/${h.holiday.id}/accept`, {}))}>
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

function ChangeBox({ st, act }: { st: any; act: (f: () => Promise<unknown>) => Promise<void> }) {
  const [text, setText] = useState("");
  const [pv, setPv] = useState<any>(null);
  const [ref, setRef] = useState<any>(null);
  const [pick, setPick] = useState<"deterministic" | "gemini">("deterministic");
  const [msg, setMsg] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    setRef(null);
    if (!text.trim()) { setPv(null); return; }
    setMsg(null);
    const my = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const p = await api("/api/nl/preview", { text });
        if (my !== seq.current) return;
        setPv(p);
        // the LLM refines only AFTER the deterministic parser has produced a result; it never blocks the preview
        if (st.llmAvailable && p.status !== "empty") {
          const r = await api("/api/nl/refine", { text });
          if (my === seq.current) { setRef(r); setPick("deterministic"); }
        }
      } catch (e: any) { setMsg(e.message); }
    }, 300);
    return () => clearTimeout(t);
  }, [text, st.llmAvailable]);

  const intent = pv?.status === "ok" ? (ref?.verdict === "conflict" && pick === "gemini" ? ref.gemini : pv.intent) : null;
  const confirm = () => act(async () => {
    await api("/api/nl/confirm", { intent });
    setText(""); setPv(null); setRef(null);
    setMsg("Saved on your record. Scanning the listings now — you will approve each change below.");
    await api("/api/runs/scan", {});
  });

  return (
    <section className="card">
      <h2>Tell me about a change</h2>
      <label htmlFor="nl" className="muted">e.g. “we are closed on 26th December”, “closing early at 3pm this Friday”, “open 10 to 2 on Diwali”</label>
      <textarea id="nl" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a closure or special hours in plain English" />
      {pv?.status === "ok" && (
        <div className="chips" aria-live="polite">
          {pv.chips.map((c: any) => <span key={c.label} className="chip c-info"><b>{c.label}:</b> {c.value}</span>)}
        </div>
      )}
      {pv?.status === "ask" && <div className="alert a-amber" aria-live="polite">❓ {pv.question}</div>}
      {ref?.verdict === "agree" && <p className="muted small">✓ {ref.note}</p>}
      {ref?.verdict === "conflict" && (
        <div className="alert a-amber">
          <b>The two readers disagree — which is right?</b>
          {(["deterministic", "gemini"] as const).map((k) => (
            <label key={k} className="radio">
              <input type="radio" name="pick" checked={pick === k} onChange={() => setPick(k)} />
              <span><b>{k === "deterministic" ? "Rule-based parser" : "Gemini"}:</b> {(k === "deterministic" ? ref.deterministicChips : ref.geminiChips).map((c: any) => `${c.label}: ${c.value}`).join(" · ")}</span>
            </label>
          ))}
        </div>
      )}
      {ref?.verdict === "unavailable" && <p className="muted small">{ref.note}</p>}
      <div className="actions">
        <button className="btn primary" disabled={!intent || st.busy} onClick={confirm}>Confirm</button>
        <span className="muted small">Nothing is saved until you press Confirm — and nothing reaches a listing until you approve it below.</span>
      </div>
      {msg && <p className="ok">{msg}</p>}
    </section>
  );
}

function Approvals({ st, rows, act }: { st: any; rows: Row[]; act: (f: () => Promise<unknown>) => Promise<void> }) {
  return (
    <section className="card">
      <h2>Approval cards</h2>
      {rows.length === 0 && <p className="muted">Run a scan to see what needs your attention.</p>}
      {st.platforms.map((p: any) => {
        const mine = rows.filter((r) => r.platformId === p.id);
        if (!mine.length) return null;
        const cards = mine.filter((r) => !HIDE_CARD.has(r.state));
        const calm = mine.filter((r) => HIDE_CARD.has(r.state));
        const proposed = mine.filter((r) => r.state === "PROPOSED").length;
        return (
          <div key={p.id} className="plat">
            <div className="plat-h">
              <h3>{p.name} <code>{p.listing.listingId}</code></h3>
              {proposed > 0 && <button className="btn small primary" disabled={st.busy} onClick={() => act(() => api(`/api/platforms/${p.id}/approve-all`, {}))}>Approve all for this platform ({proposed})</button>}
            </div>
            {cards.length === 0 && <p className="muted">✓ Everything on this listing already matches your record.</p>}
            {cards.map((r) => (
              <div key={r.fieldId} className={`fcard f-${r.state}`}>
                <div className="fc-top"><b>{r.field}</b><Pill state={r.state} /></div>
                <div className="fc-diff"><div><span className="lbl">Listing shows</span><div>{r.original || "—"}</div></div><div className="arrow">→</div><div><span className="lbl">Your record says</span><div>{r.intended}</div></div></div>
                <p className="reason">{r.reason}</p>
                {r.state === "PROPOSED" && (
                  <div className="actions">
                    <button className="btn primary small" disabled={st.busy} onClick={() => act(() => api(`/api/fields/${r.fieldId}/approve`, {}))}>Approve</button>
                    <button className="btn small ghost" disabled={st.busy} onClick={() => act(() => api(`/api/fields/${r.fieldId}/reject`, {}))}>Reject</button>
                  </div>
                )}
                {r.state === "REJECTED" && <div className="actions"><span className="muted">You rejected this change; nothing will be sent.</span><button className="btn small ghost" disabled={st.busy} onClick={() => act(() => api(`/api/fields/${r.fieldId}/approve`, {}))}>Approve after all</button></div>}
                {r.state === "APPROVED" && <div className="actions"><span className="muted">Approved — it is sent on “Apply approved &amp; verify”.</span><button className="btn small ghost" onClick={() => act(() => api(`/api/fields/${r.fieldId}/reject`, {}))}>Reject instead</button></div>}
                {r.state === "FLAGGED_NOT_OWNER" && <p className="note red">Manual step for you: this listing is claimed by another account, so the agent did not try to edit it. Ask the owner of that account to release it, or claim it on the site yourself (any OTP/CAPTCHA is yours to complete), then scan again.</p>}
                {r.state === "PENDING_MODERATION" && <p className="note amber">The site accepted the edit but its moderator has not approved it yet, so the public page still shows the old value. (Demo: approve it at <a href="/mock/admin" target="_blank" rel="noreferrer">/mock/admin</a>, then press “Apply approved &amp; verify” to re-check.)</p>}
              </div>
            ))}
            {calm.length > 0 && (
              <details className="calm"><summary>{calm.length} field(s) need no change</summary>
                <table className="mini"><thead><tr><th>Field</th><th>Listing shows (raw)</th><th>Normalised</th><th>Result</th></tr></thead>
                  <tbody>{calm.map((r) => <tr key={r.fieldId}><td>{r.field}</td><td>{r.original}</td><td><code>{r.currentNorm}</code></td><td><Pill state={r.state} /></td></tr>)}</tbody></table>
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Report({ st, rows }: { st: any; rows: Row[] }) {
  return (
    <section className="card printable">
      <div className="plat-h">
        <h2>Before / after consistency table</h2>
        <div className="actions noprint">
          <a className="btn small" href="/api/report.csv">Export CSV</a>
          <button className="btn small" onClick={() => window.print()}>Printable view</button>
        </div>
      </div>
      <p className="summary">{st.summary ?? "No scan yet."}</p>
      <div className="tablewrap">
        <table className="rep">
          <thead><tr><th>Platform</th><th>Field</th><th>Original value</th><th>Intended value</th><th>Approval status</th><th>Verified status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.fieldId} className={`row-${r.state}`}>
                <td>{r.platform}</td><td>{r.field}</td><td>{r.original}</td><td>{r.intended}</td><td>{r.approval}</td><td><Pill state={r.state} /> <span className="muted small">{r.verified}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">Nothing scanned yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Trace({ trace, allRuns, setAllRuns }: { trace: any[]; allRuns: boolean; setAllRuns: (b: boolean) => void }) {
  const icon = useMemo(() => ({ Gemini: "🤖", Deterministic: "⚙️", Fallback: "↩️", Blocked: "⛔" }) as Record<string, string>, []);
  return (
    <section className="card noprint">
      <div className="plat-h"><h2>Agent trace</h2>
        <label className="muted small"><input type="checkbox" checked={allRuns} onChange={(e) => setAllRuns(e.target.checked)} /> show all runs</label></div>
      <p className="muted small">Every real tool call, timestamped. The badge says who decided: Gemini, Deterministic, Fallback (Gemini failed, so rules took over) or Blocked (a code guardrail refused the action).</p>
      <div className="trace">
        {trace.length === 0 && <p className="muted">No tool calls yet.</p>}
        {trace.map((t) => (
          <div key={t.id} className={`tr tr-${t.decider}`}>
            <span className="time">{new Date(t.at).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })}</span>
            <span className={`dbadge d-${t.decider}`}>{icon[t.decider]} {t.decider}</span>
            <code className="tool">{t.tool}</code>
            <span className="tin" title={t.input}>{t.input.length > 70 ? t.input.slice(0, 70) + "…" : t.input}</span>
            <span className="tout">{t.output_summary}</span>
            <span className="dur">{t.duration_ms} ms</span>
            {t.note && <span className="tnote">{t.note}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

