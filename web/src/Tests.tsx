import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type Check = { name: string; pass: boolean; detail: string };
type Result = { id: string; title: string; mode: string; input: string; expected: string; actual: string; pass: boolean; explanation: string; checks: Check[]; durationMs: number; trace: any[]; fallbacks: any[]; blocked: any[]; screenshots: string[]; testDate: string };

export default function TestsPage() {
  const [info, setInfo] = useState<any>(null);
  const [mode, setMode] = useState<"deterministic" | "llm">("deterministic");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [guard, setGuard] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const i = await api("/api/tests");
    setInfo(i);
    const m: Record<string, Result> = {};
    for (const [k, v] of Object.entries(i.results as Record<string, Result>)) if (k.startsWith(mode + ":")) m[k.split(":")[1]] = v;
    setResults((prev) => ({ ...m, ...prev }));
  }, [mode]);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  const run = async (id: string) => {
    setErr(null); setRunning(id);
    try {
      const r = await api("/api/tests/run", { id, mode });
      setResults((p) => { const n = { ...p }; for (const x of r.results as Result[]) n[x.id] = x; return n; });
      if (id !== "all") setOpen(id);
    } catch (e: any) { setErr(e.message); }
    setRunning(null);
  };

  if (!info) return <div className="wrap"><p>Loading…</p>{err && <p className="err">{err}</p>}</div>;
  const done = Object.values(results).filter((r) => r.mode === mode);
  return (
    <div className="wrap">
      <header className="top">
        <div><h1>Test cases TC1–TC6</h1><p className="sub">One click each, or run all. Every run starts from a fresh reset, records input, expected, actual and evidence. Running a test resets the demo data.</p></div>
        <div className="badges"><a className="btn small" href="/">← Console</a><a className="btn small" href="/api/evidence/summary" target="_blank" rel="noreferrer">evidence/SUMMARY.md</a></div>
      </header>
      <section className="card">
        <div className="actions">
          <button className="btn primary" disabled={!!running} onClick={() => run("all")}>{running === "all" ? "Running all…" : "Run all"}</button>
          <label className="radio inline"><input type="radio" checked={mode === "deterministic"} onChange={() => setMode("deterministic")} /> Deterministic (no LLM)</label>
          <label className="radio inline" title={info.llmAvailable ? "" : "No GEMINI_API_KEY on the server"}><input type="radio" disabled={!info.llmAvailable} checked={mode === "llm"} onChange={() => setMode("llm")} /> With Gemini{!info.llmAvailable && " (no key configured)"}</label>
          <span className="muted small">Tests run with the date pinned to {info.testDate} (IST) so results never change day to day.</span>
        </div>
        {err && <div className="alert a-red">{err}</div>}
        <p className="summary">{done.length ? `${done.filter((r) => r.pass).length} of ${done.length} run test(s) passed.` : "No results yet."}</p>
      </section>

      {info.tests.map((t: any) => {
        const r = results[t.id];
        return (
          <section key={t.id} className={`card tc ${r ? (r.pass ? "tc-pass" : "tc-fail") : ""}`}>
            <div className="plat-h">
              <h2>{t.id} — {t.title} {r && <span className={`pill ${r.pass ? "s-VERIFIED" : "s-FLAGGED_NOT_OWNER"}`}>{r.pass ? "PASS" : "FAIL"}</span>}</h2>
              <button className="btn small primary" disabled={!!running} onClick={() => run(t.id)}>{running === t.id ? "Running…" : "Run"}</button>
            </div>
            <dl className="kv"><dt>Input</dt><dd>{t.input}</dd><dt>Expected</dt><dd>{t.expected}</dd>{r && <><dt>Actual</dt><dd>{r.actual}</dd><dt>Explanation</dt><dd>{r.explanation}</dd></>}</dl>
            {r && (
              <>
                <button className="btn tiny ghost" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Hide" : "Show"} evidence ({r.checks.length} checks, {r.trace.length} tool calls, {r.durationMs} ms)</button>
                {open === t.id && (
                  <div>
                    <table className="mini"><thead><tr><th>Check</th><th></th><th>Detail</th></tr></thead>
                      <tbody>{r.checks.map((c, i) => <tr key={i}><td>{c.name}</td><td>{c.pass ? "✅" : "❌"}</td><td>{c.detail}</td></tr>)}</tbody></table>
                    {(r.fallbacks.length > 0 || r.blocked.length > 0) && <p className="note amber">{r.fallbacks.length} fallback(s), {r.blocked.length} guardrail block(s) in this run.</p>}
                    <div className="trace">{r.trace.map((x) => <div key={x.id} className={`tr tr-${x.decider}`}><span className={`dbadge d-${x.decider}`}>{x.decider}</span><code className="tool">{x.tool}</code><span className="tout">{x.output_summary}</span></div>)}</div>
                    {r.screenshots.length > 0 && <p className="muted small">Screenshots saved: {r.screenshots.join(", ")}</p>}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}

      <section className="card">
        <div className="plat-h"><h2>Guardrail demo</h2>
          <button className="btn small primary" disabled={!!running} onClick={async () => { setRunning("guard"); try { setGuard(await api("/api/tests/guardrail-demo", {})); } catch (e: any) { setErr(e.message); } setRunning(null); }}>{running === "guard" ? "Running…" : "Run guardrail demo"}</button></div>
        <p className="muted">A <b>simulated</b> rogue planner (scripted, not an LLM) tries to apply without approval, apply unapproved fields, verify without applying, edit the look-alike decoy and flag an editable listing. The code blocks every attempt.</p>
        {guard && (<><p className="summary">{guard.attempts} attempts blocked · {guard.writesAfter} writes sent · unapproved change still only PROPOSED: {String(guard.unapprovedStillProposed)} · {guard.verifiedCount} fields marked VERIFIED</p>
          <div className="trace">{guard.blocked.map((x: any) => <div key={x.id} className="tr tr-Blocked"><span className="dbadge d-Blocked">⛔ Blocked</span><code className="tool">{x.tool}</code><span className="tout">{x.output_summary}</span></div>)}</div></>)}
      </section>
    </div>
  );
}
