import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Ctx, TabId } from "../shared";

const EXAMPLES = ["change my phone to 98765 43210", "closed on 26th December", "we are closed on Sundays", "what are my hours?"];

export default function EditTab(ctx: Ctx) {
  return (
    <div className="stack">
      <AskBox {...ctx} />
      <DetailsForm {...ctx} />
      <SavedDays {...ctx} />
    </div>
  );
}

/* ───────────── one box: change details, set closures, or ask a question ───────────── */
function AskBox({ st, act, go }: Ctx) {
  const [text, setText] = useState("");
  const [pv, setPv] = useState<any>(null);
  const [ref, setRef] = useState<any>(null);
  const [pick, setPick] = useState<"deterministic" | "gemini">("deterministic");
  const [msg, setMsg] = useState<{ text: string; tab?: TabId } | null>(null);
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
        // a model only double-checks dates, and only after the rule-based reading exists; edits and questions stay local
        if (st.llmAvailable && p.status === "ok") {
          const r = await api("/api/nl/refine", { text });
          if (my === seq.current) { setRef(r); setPick("deterministic"); }
        }
      } catch (e: any) { setMsg({ text: e.message }); }
    }, 300);
    return () => clearTimeout(t);
  }, [text, st.llmAvailable]);

  const intent = pv?.status === "ok" ? (ref?.verdict === "conflict" && pick === "gemini" ? ref.gemini : pv.intent) : pv?.status === "detail" ? pv.intent : null;
  const confirm = () => act(async () => {
    const res: any = await api("/api/nl/confirm", { intent });
    const wasDetail = pv?.status === "detail";
    setText(""); setPv(null); setRef(null);
    setMsg(wasDetail
      ? { text: res.changed?.length ? `Saved: ${res.changed.map((c: any) => c.label.toLowerCase()).join(", ")}. Checking every site now — your approval cards will appear in Approvals.` : "Nothing needed to change.", tab: "approvals" }
      : { text: "Saved on your record. Checking every site now — your approval cards will appear in Approvals.", tab: "approvals" });
    await api("/api/runs/scan", {});
  });

  return (
    <section className="card">
      <h2>Tell me what to change — or ask me something</h2>
      <label htmlFor="nl" className="muted">Change your phone, address, name or hours, set a closure, or ask a question.</label>
      <textarea id="nl" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type here, for example: closed on 26th December" />
      <div className="examples">{EXAMPLES.map((x) => <button key={x} type="button" className="ex" onClick={() => setText(x)}>{x}</button>)}</div>

      {pv?.status === "ok" && <Chips chips={pv.chips} />}
      {pv?.status === "detail" && (<><Chips chips={pv.chips} /><p className="muted small">{pv.sentence}</p></>)}
      {pv?.status === "answer" && (
        <div className="answer" aria-live="polite">
          <b>{pv.title}</b>
          <ul>{pv.lines.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul>
          {pv.links?.length > 0 && <div className="actions">{pv.links.map((l: any) => <button key={l.tab} className="btn tiny" onClick={() => go(l.tab)}>{l.label}</button>)}</div>}
        </div>
      )}
      {pv?.status === "ask" && <div className="alert a-amber" aria-live="polite">{pv.question}</div>}
      {ref?.verdict === "agree" && <p className="muted small">{ref.note}</p>}
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

      {(pv?.status === "ok" || pv?.status === "detail") && (
        <div className="actions">
          <button className="btn primary" disabled={!intent || st.busy} onClick={confirm}>{pv.status === "detail" ? "Save this change" : "Confirm"}</button>
          <span className="muted small">Nothing is saved until you press the button, and nothing reaches a listing until you approve it.</span>
        </div>
      )}
      {msg && <p className={msg.tab ? "ok" : "err"}>{msg.text} {msg.tab && <button className="linkish" onClick={() => go(msg.tab!)}>Open Approvals</button>}</p>}
    </section>
  );
}

function Chips({ chips }: { chips: { label: string; value: string }[] }) {
  return <div className="chips" aria-live="polite">{chips.map((c, i) => <span key={i} className="chip c-info"><b>{c.label}:</b> {c.value}</span>)}</div>;
}

/* ───────────── the plain form ───────────── */
function DetailsForm({ st, act, go, rev }: Ctx) {
  const [f, setF] = useState({ name: "", address: "", phone: "", hours: "" });
  const [orig, setOrig] = useState(f);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return; // never overwrite what the person is typing
    api("/api/business").then((b) => { const v = { name: b.name, address: b.address, phone: b.phone, hours: b.hoursText }; setF(v); setOrig(v); }).catch(() => undefined);
  }, [rev, dirty]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setDirty(true); setF({ ...f, [k]: e.target.value }); };
  const changed = (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== orig[k]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    await act(async () => {
      try {
        const r: any = await api("/api/business", f, "PUT");
        setDirty(false);
        setOrig(f);
        if (!r.changed.length) { setMsg({ ok: true, text: "Nothing was different, so nothing changed." }); return; }
        setMsg({ ok: true, text: `Saved: ${r.changed.map((c: any) => c.label.toLowerCase()).join(", ")}.${r.reviewAgain ? ` ${r.reviewAgain} earlier approval(s) went back to review because the value changed.` : ""} Checking every site now…` });
        await api("/api/runs/scan", {});
      } catch (x: any) { setMsg({ ok: false, text: x.message }); }
    });
  };

  return (
    <section className="card">
      <h2>Edit my details</h2>
      <p className="muted small">Changing these updates your record only. The agent then compares every listing site with the new values and asks you to approve each fix.</p>
      <form onSubmit={submit} className="eform">
        <label htmlFor="e-name">Business name</label><input id="e-name" value={f.name} onChange={set("name")} required />
        <label htmlFor="e-addr">Address</label><input id="e-addr" value={f.address} onChange={set("address")} required />
        <label htmlFor="e-phone">Phone</label><input id="e-phone" value={f.phone} onChange={set("phone")} required inputMode="tel" />
        <label htmlFor="e-hours">Regular opening hours</label><input id="e-hours" value={f.hours} onChange={set("hours")} required />
        <p className="muted small">Hours example: <code>Mon-Sat 09:00-21:00; Sun 10:00-14:00</code> (9am or 21:00 both work; a day you leave out is closed).</p>
        <div className="actions">
          <button className="btn primary" disabled={!changed || st.busy}>Save changes</button>
          <button type="button" className="btn ghost" disabled={!changed} onClick={() => { setF(orig); setDirty(false); setMsg(null); }}>Undo my edits</button>
          {msg?.ok && <button type="button" className="linkish" onClick={() => go("approvals")}>Review the fixes</button>}
        </div>
        {msg && <p className={msg.ok ? "ok" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
      </form>
    </section>
  );
}

/* ───────────── holidays and special days already saved ───────────── */
function SavedDays({ st, act }: Ctx) {
  const active = (st.exceptions as any[]).filter((e) => e.status === "active");
  return (
    <section className="card">
      <h2>Saved holidays and special days</h2>
      {active.length === 0 && <p className="muted">None. Type one above, for example “closed on 26th December”.</p>}
      <ul className="plain">
        {active.map((e) => (
          <li key={e.id} className="row-between">
            <span><b>{e.start === e.end ? e.start : `${e.start} → ${e.end}`}</b> {e.kind === "closed" ? "Closed" : `${e.open}–${e.close}`} {e.reason ? `(${e.reason})` : ""} <span className="tag">{e.source}</span></span>
            <button className="btn tiny ghost" disabled={st.busy} onClick={() => act(async () => { await api(`/api/exceptions/${e.id}/cancel`, {}); await api("/api/runs/scan", {}); })}>Cancel this</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
