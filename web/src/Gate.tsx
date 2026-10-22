import React, { useEffect, useRef, useState } from "react";
import { api } from "./api";

type Screen = "login" | "details" | "match" | "pin";
const SITE_WORD = (name: string) => name.replace(/ \(.*\)/, "");

export default function Gate({ onLoggedIn, notice }: { onLoggedIn: () => void; notice?: string }) {
  const [screen, setScreen] = useState<Screen>("login");
  const [draft, setDraft] = useState<any>(null);
  const [created, setCreated] = useState<{ pin: string; businessName: string; hoursAssumed: boolean; confirmed: number } | null>(null);

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">Business Listing Consistency Agent</div>
        {screen === "login" && <Login onLoggedIn={onLoggedIn} onNew={() => setScreen("details")} notice={notice} />}
        {screen === "details" && <Details onBack={() => setScreen("login")} onFound={(d) => { setDraft(d); setScreen("match"); }} />}
        {screen === "match" && draft && <Matches draft={draft} onBack={() => setScreen("details")} onDone={(c) => { setCreated(c); setDraft(null); setScreen("pin"); }} />}
        {screen === "pin" && created && <PinReveal created={created} onLoggedIn={() => { setCreated(null); onLoggedIn(); }} />}
      </div>
    </div>
  );
}

/* ───────────── screen 1: PIN ───────────── */
function Login({ onLoggedIn, onNew, notice }: { onLoggedIn: () => void; onNew: () => void; notice?: string }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await api("/api/auth/login", { pin }); setPin(""); onLoggedIn(); }
    catch (x: any) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit}>
      <h1>Log in</h1>
      {notice && <p className="muted">{notice}</p>}
      <label htmlFor="pin">Your PIN</label>
      <input id="pin" className="pin-input" value={pin} onChange={(e) => setPin(e.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus placeholder="XXXXX-XXXXX" maxLength={14} />
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary wide" disabled={busy || pin.replace(/[\s-]/g, "").length < 8}>{busy ? "Checking…" : "Log in"}</button>
      <p className="gate-alt">New here? <button type="button" className="linkish" onClick={onNew}>Set up my business</button></p>
    </form>
  );
}

/* ───────────── screen 2: details ───────────── */
export function Details({ onBack, onFound, backLabel = "← Back to log in" }: { onBack: () => void; onFound: (d: any) => void; backLabel?: string }) {
  const [f, setF] = useState({ name: "", address: "", phone: "", hours: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { onFound(await api("/api/onboarding/start", { ...f, hours: f.hours.trim() || undefined })); }
    catch (x: any) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit}>
      <p className="step">Step 1 of 3</p>
      <h1>About your business</h1>
      <label htmlFor="n">Business name</label><input id="n" value={f.name} onChange={set("name")} required autoFocus />
      <label htmlFor="a">Address</label><input id="a" value={f.address} onChange={set("address")} required placeholder="Street, area, city, pincode" />
      <label htmlFor="p">Phone</label><input id="p" value={f.phone} onChange={set("phone")} required inputMode="tel" />
      <label htmlFor="h">Opening hours <span className="muted">(optional)</span></label>
      <input id="h" value={f.hours} onChange={set("hours")} placeholder="Mon-Sat 9am-9pm; Sun 10am-2pm" />
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary wide" disabled={busy}>{busy ? "Checking the listing sites…" : "Find my listings"}</button>
      <p className="gate-alt"><button type="button" className="linkish" onClick={onBack}>{backLabel}</button></p>
    </form>
  );
}

/* ───────────── screen 3: is this you? ───────────── */
type Choice = { action: "confirm" | "reject"; listingId?: string };

export function Matches({ draft, onBack, onDone }: { draft: any; onBack: () => void; onDone: (c: any) => void }) {
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const need: string[] = draft.needsDecision;
  const ready = need.every((id) => choice[id]);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { onDone(await api(`/api/onboarding/${draft.draftId}/confirm`, { decisions: choice })); }
    catch (x: any) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <div>
      <p className="step">Step 2 of 3</p>
      <h1>Is this you?</h1>
      <p className="muted">Nothing is linked until you say yes.</p>
      {draft.sites.map((m: any) => <SiteCard key={m.platformId} m={m} choice={choice[m.platformId]} onChoose={(c) => setChoice({ ...choice, [m.platformId]: c })} />)}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary wide" disabled={!ready || busy} onClick={submit}>{busy ? "Setting up…" : ready ? "Continue" : `Answer ${need.filter((id) => !choice[id]).length} more`}</button>
      <p className="gate-alt"><button type="button" className="linkish" onClick={onBack}>← Change my details</button></p>
    </div>
  );
}

function Why({ c }: { c: any }) {
  const b = c.breakdown;
  return (
    <details className="why"><summary>Why {c.score}/100?</summary>
      <ul>{(["phone", "address", "name"] as const).map((k) => <li key={k}><b>{k}</b> {b[k].points}/{b[k].max} — {b[k].why}</li>)}</ul>
    </details>
  );
}

function Listing({ c }: { c: any }) {
  return (
    <div className="lst">
      <div><b>{c.name}</b> <code>{c.listingId}</code></div>
      <div className="muted">{c.address}</div>
      <div className="muted">{c.phone}</div>
      <Why c={c} />
    </div>
  );
}

function SiteCard({ m, choice, onChoose }: { m: any; choice?: Choice; onChoose: (c: Choice) => void }) {
  const name = SITE_WORD(m.platformName);
  if (m.readError) return <div className="scard s-off"><h3>{name}</h3><p className="muted">Couldn't read this site, so nothing was matched here.</p></div>;
  if (m.status === "none") return <div className="scard s-off"><h3>{name}</h3><p className="muted">No listing of yours found. You can add your business here later.</p></div>;
  if (m.status === "claimed") {
    return (
      <div className="scard s-flag"><h3>{name} <span className="pill s-FLAGGED_NOT_OWNER">Claimed by someone else</span></h3>
        <Listing c={m.pick} />
        <p className="note red">This looks like your listing, but another account owns it. We won't link or edit it. To fix this yourself: ask its owner to release it, or claim it on the site (any code or OTP is yours to enter).</p>
      </div>
    );
  }
  if (m.status === "auto") {
    return (
      <div className="scard"><h3>{name} <span className="pill s-VERIFIED">Strong match</span></h3>
        <Listing c={m.pick} />
        <Choose a={choice?.action === "confirm"} b={choice?.action === "reject"} onYes={() => onChoose({ action: "confirm", listingId: m.pick.listingId })} onNo={() => onChoose({ action: "reject" })} />
      </div>
    );
  }
  // ask: let the owner pick one of the top candidates, or none
  return (
    <div className="scard"><h3>{name} <span className="pill s-PENDING_MODERATION">Not sure</span></h3>
      <p className="muted">{m.reason}</p>
      {m.candidates.filter((c: any) => !c.claimed && c.score >= 45).map((c: any) => (
        <label key={c.listingId} className={`pick ${choice?.listingId === c.listingId ? "on" : ""}`}>
          <input type="radio" name={m.platformId} checked={choice?.listingId === c.listingId} onChange={() => onChoose({ action: "confirm", listingId: c.listingId })} />
          <Listing c={c} />
        </label>
      ))}
      <label className={`pick ${choice?.action === "reject" ? "on" : ""}`}>
        <input type="radio" name={m.platformId} checked={choice?.action === "reject"} onChange={() => onChoose({ action: "reject" })} /> <span>None of these is me</span>
      </label>
    </div>
  );
}

function Choose({ a, b, onYes, onNo }: { a: boolean; b: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="actions">
      <button type="button" className={`btn small ${a ? "primary" : ""}`} aria-pressed={a} onClick={onYes}>Yes, that's me</button>
      <button type="button" className={`btn small ${b ? "primary" : ""}`} aria-pressed={b} onClick={onNo}>Not me</button>
    </div>
  );
}

/* ───────────── screen 4: view-once PIN ───────────── */
export function PinReveal({ created, onLoggedIn, adding = false }: { created: { pin: string; businessName: string; hoursAssumed: boolean; confirmed: number }; onLoggedIn: () => void; adding?: boolean }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<HTMLDivElement>(null);

  // leaving this page now would lose the PIN for good
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(created.pin); setCopied(true); }
    catch {
      const r = document.createRange(); r.selectNodeContents(pinRef.current!);
      const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
    }
  };
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api("/api/auth/login", { pin: created.pin }); onLoggedIn(); } // the PIN only lives in this component's memory
    catch (x: any) { setErr(x.message); setBusy(false); }
  };
  return (
    <div>
      <p className="step">Step 3 of 3</p>
      <h1>Your PIN</h1>
      <p className="muted">This is how <b>{created.businessName}</b> logs in. There is no username or password.</p>
      <div className="pin-show" ref={pinRef} aria-label="Your PIN">{created.pin}</div>
      <button type="button" className="btn small" onClick={copy}>{copied ? "Copied" : "Copy PIN"}</button>
      <div className="alert a-red"><b>This PIN will not be shown again.</b> We only keep a scrambled version, so nobody can look it up for you. Don't refresh this page.</div>
      {created.hoursAssumed && <p className="muted small">You didn't enter opening hours, so we used typical hours (Mon–Sat 9am–6pm, Sun closed).</p>}
      <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my PIN</label>
      {adding && <p className="muted small">When you continue you are switched to <b>{created.businessName}</b>. To come back to your other business, log out and use its own PIN.</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary wide" disabled={!saved || busy} onClick={go}>{busy ? "Opening…" : adding ? `Open ${created.businessName}` : "Continue"}</button>
    </div>
  );
}
