import React, { useEffect, useMemo, useRef, useState } from "react";
import { timeIST, useReducedMotion } from "../shared";

/** A winding "map" of the agent's steps. The agent mascot follows the pointer; when the pointer rests it walks the route by itself. */
const PAD = 64, DX = 128, H = 300, R = 28, YS = [96, 212];
const ICON: Record<string, string> = {
  read_listing: "📄", normalise: "🔧", compare: "⚖️", propose: "📝", flag_listing: "🚩", apply_approved: "✅",
  reload_and_verify: "🔄", ask_owner: "❓", done: "🏁", summarise_report: "📋", create_listing: "🆕",
};
const icon = (tool: string) => ICON[tool] ?? "•";
/** One or two plain words for each tool, for people who don't read code. */
const SAY: Record<string, string> = {
  read_listing: "Reading…", normalise: "Tidying up", compare: "Comparing", propose: "Suggesting", flag_listing: "Not yours!",
  apply_approved: "Applying", reload_and_verify: "Double-checking", ask_owner: "Your turn", done: "All done", summarise_report: "Summing up", create_listing: "Adding a listing",
};
export const say = (r: { tool: string; decider?: string }) => (r.decider === "Blocked" ? "Stopped!" : SAY[r.tool] ?? "Working…");

export default function TraceMap({ rows }: { rows: any[] }) {
  const reduced = useReducedMotion();
  const n = rows.length;
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const bot = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLImageElement>(null);
  const pos = useRef({ x: PAD, y: YS[0] });
  const target = useRef({ x: PAD, y: YS[0] });
  const raf = useRef<number | null>(null);
  const idx = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walker = useRef<ReturnType<typeof setInterval> | null>(null);
  const [focus, setFocus] = useState(0);
  const pts = useMemo(() => rows.map((_, i) => ({ x: PAD + i * DX, y: YS[i % 2] })), [n]); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = () => {
    const k = reduced ? 1 : 0.16;
    const dx = target.current.x - pos.current.x, dy = target.current.y - pos.current.y;
    if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) { pos.current = { ...target.current }; raf.current = null; } else {
      pos.current = { x: pos.current.x + dx * k, y: pos.current.y + dy * k };
      if (face.current && Math.abs(dx) > 2) face.current.style.transform = `scaleX(${dx < 0 ? -1 : 1})`;
      raf.current = requestAnimationFrame(draw);
    }
    if (bot.current) bot.current.style.transform = `translate(${pos.current.x - 27}px, ${pos.current.y - 44}px)`;
  };
  const kick = () => { if (raf.current === null) raf.current = requestAnimationFrame(draw); };
  const goTo = (i: number) => { idx.current = i; setFocus(i); if (pts[i]) { target.current = { ...pts[i] }; kick(); } };
  const stopTimers = () => { if (idle.current) clearTimeout(idle.current); if (walker.current) clearInterval(walker.current); idle.current = null; walker.current = null; };
  useEffect(() => () => { stopTimers(); if (raf.current !== null) cancelAnimationFrame(raf.current); }, []);

  // new run / filter: park the agent on the latest step
  useEffect(() => {
    stopTimers();
    if (n === 0) return;
    const last = n - 1;
    idx.current = last; setFocus(last);
    target.current = { ...pts[last] }; pos.current = { ...pts[last] };
    if (bot.current) bot.current.style.transform = `translate(${pts[last].x - 27}px, ${pts[last].y - 44}px)`;
    box.current?.scrollTo({ left: Math.max(0, pts[last].x - (box.current?.clientWidth ?? 600) / 2) });
  }, [n, pts]);

  const startWalking = () => {
    if (reduced || n < 2) return;
    walker.current = setInterval(() => {
      const i = (idx.current + 1) % n;
      goTo(i);
      const b = box.current;
      if (b) b.scrollTo({ left: Math.max(0, pts[i].x - b.clientWidth / 2), behavior: "smooth" });
    }, 850);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || !inner.current) return;
    stopTimers();
    const r = inner.current.getBoundingClientRect();
    const x = e.clientX - r.left, y = Math.min(H - 20, Math.max(74, e.clientY - r.top));
    target.current = { x, y }; kick();
    let best = -1, bd = 70;
    pts.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) { idx.current = best; setFocus(best); }
    idle.current = setTimeout(startWalking, 1400);
  };
  const onLeave = () => { stopTimers(); goTo(idx.current); };

  if (n === 0) return null;
  const t = rows[Math.min(focus, n - 1)];
  const width = PAD * 2 + DX * (n - 1);
  const seg = (i: number) => {
    const a = pts[i], b = pts[i + 1], m = DX / 2;
    return `M${a.x},${a.y} C${a.x + m},${a.y} ${b.x - m},${b.y} ${b.x},${b.y}`;
  };

  return (
    <div className="tmap">
      <p className="muted small hint">{reduced ? "Select a step on the map to see what the agent did." : "Move your pointer over the map: the little agent follows it. Rest the pointer and it walks the route by itself."}</p>
      <div className="mapbox" ref={box}>
        <div className="mapinner" ref={inner} style={{ width, height: H }} onPointerMove={onMove} onPointerLeave={onLeave}>
          <svg className="mapsvg" width={width} height={H} aria-hidden>
            {pts.slice(0, -1).map((_, i) => <path key={i} d={seg(i)} className={`mseg ${i < focus ? "passed" : ""}`} />)}
          </svg>
          {rows.map((r, i) => {
            const p = pts[i], top = i % 2 === 0;
            return (
              <React.Fragment key={r.id}>
                <button
                  type="button" className={`mnode r-${r.decider} ${i === focus ? "now" : ""} ${i < focus ? "passed" : ""}`}
                  style={{ left: p.x - R, top: p.y - R, width: R * 2, height: R * 2 }}
                  aria-label={`Step ${i + 1}: ${r.tool}, decided by ${r.decider}. ${r.output_summary}`} aria-current={i === focus}
                  onClick={() => goTo(i)} onFocus={() => goTo(i)}
                >{icon(r.tool)}</button>
                <span className={`mlabel ${top ? "above" : "below"}`} style={{ left: p.x - 58, top: top ? p.y - R - 40 : p.y + R + 6 }} aria-hidden>
                  <b>#{i + 1}</b> <span className="say-word">{say(r)}</span>
                </span>
              </React.Fragment>
            );
          })}
          <div className="mbot" ref={bot} aria-hidden>
            <span className="mspeech" key={`${focus}-${say(t)}`}>{say(t)}</span><img ref={face} className="mbot-img" src="/agent.png" alt="" draggable={false} /></div>
        </div>
      </div>
      {t && (
        <div className={`mdetail tr-${t.decider}`} aria-live="polite">
          <div className="thead">
            <span className="tno">#{Math.min(focus, n - 1) + 1}</span><code className="tool">{t.tool}</code>
            <span className={`dbadge d-${t.decider}`}>{t.decider}</span>
            <span className="time">{timeIST(t.at)}</span><span className="dur">{t.duration_ms} ms</span>
          </div>
          <div className="tout">{t.output_summary}</div>
          {t.note && <div className="tnote">{t.note}</div>}
        </div>
      )}
    </div>
  );
}
