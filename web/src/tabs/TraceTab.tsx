import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import { Ctx, EmptyState, timeIST, useReducedMotion } from "../shared";

type Dec = "all" | "Gemini" | "Deterministic" | "Fallback" | "Blocked";

export default function TraceTab({ rev }: Ctx) {
  const [rows, setRows] = useState<any[]>([]);
  const [all, setAll] = useState(false);
  const [dec, setDec] = useState<Dec>("all");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { api(`/api/trace${all ? "?all=1" : ""}`).then((t) => { setRows(t.rows); setLoaded(true); }).catch(() => setLoaded(true)); }, [rev, all]);

  const shown = rows.filter((r) => dec === "all" || r.decider === dec);
  const count = (d: Dec) => rows.filter((r) => d === "all" || r.decider === d).length;

  /* the little agent that walks from step to step */
  const reduced = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const els = useRef<(HTMLDivElement | null)[]>([]);
  const [at, setAt] = useState<number | null>(null);        // where the walker is (follows the pointer; moves on by itself while "playing")
  const [pinned, setPinned] = useState<number | null>(null); // the step the pointer / keyboard is on
  const [playing, setPlaying] = useState(false);              // the pointer has rested a moment: the agent walks on through the steps
  const [y, setY] = useState(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cur = playing ? at : pinned ?? at;

  useEffect(() => { setAt(null); setPinned(null); setPlaying(false); }, [all, dec, shown.length]);
  // pointer moves => the walker stays with the pointer; pointer rests ~1 s => the walker walks on from step to step
  const wake = () => {
    if (idle.current) clearTimeout(idle.current);
    setPlaying(false);
    if (!reduced && shown.length > 1) idle.current = setTimeout(() => setPlaying(true), 1000);
  };
  const stop = () => { if (idle.current) clearTimeout(idle.current); setPlaying(false); };
  useEffect(() => () => { if (idle.current) clearTimeout(idle.current); }, []);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setAt((a) => ((a ?? 0) + 1) % shown.length), 650);
    return () => clearInterval(t);
  }, [playing, shown.length]);
  useLayoutEffect(() => {
    if (cur === null) return;
    const el = els.current[cur], box = scroller.current;
    if (!el || !box) return;
    setY(el.offsetTop + 13);
    const top = el.offsetTop, bottom = top + el.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = Math.max(0, top - 8);
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight + 8;
  }, [cur, shown.length]);

  return (
    <section className="card">
      <div className="plat-h">
        <h2>Agent trace</h2>
        <label className="muted small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> include login and older runs</label>
      </div>
      <p className="muted">Each step the agent took. The badge shows who decided: Gemini, Deterministic (fixed rules), Fallback (rules took over) or Blocked (stopped by a safety rule).</p>
      <div className="chipbar">{(["all", "Gemini", "Deterministic", "Fallback", "Blocked"] as Dec[]).map((d) => <button key={d} className={`fchip ${dec === d ? "on" : ""}`} onClick={() => setDec(d)}>{d === "all" ? "All steps" : d} <span className="cnt">{count(d)}</span></button>)}</div>
      {shown.length > 1 && <p className="muted small hint">{reduced ? "Hover or focus a step to see where the agent is." : "Hover over the steps: the little agent follows your pointer, and walks on by itself when you rest."}</p>}

      {loaded && shown.length === 0 && <EmptyState title="No steps yet">Press “Scan listings” and the agent’s steps will appear here.</EmptyState>}

      {shown.length > 0 && (
        <div className="trace-scroll" ref={scroller} onMouseMove={wake} onMouseLeave={() => { stop(); setPinned(null); }}>
          <div className="rail" aria-hidden />
          {cur !== null && <div className="rail-done" style={{ height: y }} aria-hidden />}
          {cur !== null && (
            <div className={`walker ${reduced ? "still" : ""}`} style={{ top: y }} aria-hidden>
              <span className="walker-emoji">🤖</span>
            </div>
          )}
          {shown.map((t, i) => (
            <div
              key={t.id} ref={(el) => { els.current[i] = el; }} tabIndex={0}
              className={`tstep tr-${t.decider} ${cur !== null && i < cur ? "passed" : ""} ${cur === i ? "now" : ""}`}
              onMouseEnter={() => { setPinned(i); setAt(i); wake(); }} onMouseLeave={() => setPinned(null)}
              onFocus={() => { setPinned(i); setAt(i); wake(); }} onBlur={() => { setPinned(null); stop(); }}
            >
              <span className={`dot d-${t.decider}`} aria-hidden />
              <div className="tbody">
                <div className="thead">
                  <span className="tno">#{i + 1}</span>
                  <code className="tool">{t.tool}</code>
                  <span className={`dbadge d-${t.decider}`}>{t.decider}</span>
                  <span className="time">{timeIST(t.at)}</span>
                  <span className="dur">{t.duration_ms} ms</span>
                </div>
                <div className="tout">{t.output_summary}</div>
                {t.input && t.input !== "{}" && <div className="tin" title={t.input}>{t.input.length > 110 ? t.input.slice(0, 110) + "…" : t.input}</div>}
                {t.note && <div className="tnote">{t.note}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
