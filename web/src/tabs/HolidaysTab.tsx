import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Ctx } from "../shared";

const SHOW_FIRST = 3;
const DATE_SHIFT_DAYS = 30; // keep in step with the server: how far a festival may be moved from the calendar date

const niceDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const away = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);
const shift = (d: string, days: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + days); return x.toISOString().slice(0, 10); };

type Mode = "closed" | "special" | null;
type DateAnswer = "yes" | "no" | null;

function HolidayRow({ h, today, st, act, go, expanded, onToggle }: { h: any; today: string; st: any; act: Ctx["act"]; go: Ctx["go"]; expanded: boolean; onToggle: () => void }) {
  const ex = h.exception;
  const [mode, setMode] = useState<Mode>(null);
  const [open, setOpen] = useState("10:00");
  const [close, setClose] = useState("14:00");
  const [dateAnswer, setDateAnswer] = useState<DateAnswer>(null);
  const [otherDate, setOtherDate] = useState("");
  const needsDateCheck = !h.holiday.verified; // calendar dates for festivals are not guaranteed
  const minDate = [today, shift(h.holiday.date, -DATE_SHIFT_DAYS)].sort().pop() as string; // the later of today and (calendar − 30 days)
  const maxDate = shift(h.holiday.date, DATE_SHIFT_DAYS);
  const otherOk = otherDate !== "" && otherDate !== h.date && otherDate >= minDate && otherDate <= maxDate;
  const bad = mode === "special" && (!open || !close || open >= close);
  const dateBlocked = needsDateCheck && (dateAnswer === null || (dateAnswer === "no" && !otherOk));
  const current: Mode = mode ?? (ex ? ex.kind : null);
  const finalDate = dateAnswer === "no" && otherOk ? otherDate : h.date;

  const pick = (m: "closed" | "special") => {
    setMode(m);
    // something already saved for this holiday counts as checked; a new choice has to be checked
    setDateAnswer(ex ? "yes" : null);
    setOtherDate("");
    if (m === "special") {
      // start from what is already saved, else from the suggestion for this holiday
      setOpen(ex?.kind === "special" && ex.open ? ex.open : h.suggestion.open ?? "10:00");
      setClose(ex?.kind === "special" && ex.close ? ex.close : h.suggestion.close ?? "14:00");
    }
  };
  const cancel = () => { setMode(null); setDateAnswer(null); setOtherDate(""); };
  const save = async () => {
    let ok = false;
    const body: any = mode === "closed" ? { kind: "closed" } : { kind: "special", open, close };
    if (dateAnswer === "no") body.date = otherDate;
    await act(async () => {
      await api(`/api/foresight/${h.holiday.id}/accept`, body);
      await api("/api/runs/scan", {});
      ok = true;
    });
    if (ok) cancel();
  };
  const clear = () => act(async () => { await api(`/api/foresight/${h.holiday.id}/clear`, {}); await api("/api/runs/scan", {}); });

  return (
    <li className="hcard">
      <div className="hhead">
        <div className="hname">
          <b>{h.holiday.name}</b>
          <div className="muted small">
            {niceDate(h.date)} · {away(h.daysAway)} · {h.holiday.region}
            {h.dateChanged && <span className="tag warn" title="You told us the calendar date is different">your date · calendar says {niceDate(h.holiday.date)}</span>}
          </div>
        </div>
        <div className="hstat">
          <span className={`chip c-${h.chip}`}>{h.chipText}</span>
          {h.setText && <span className="hset">{h.setText}</span>}
          <button className="linkish-btn small" aria-expanded={expanded} onClick={onToggle}>{expanded ? "Hide" : h.exception ? "Change" : "Set hours"}</button>
        </div>
      </div>

      {expanded && !h.editable && (
        <p className="note clay">This day is part of a longer closure you set. Change it in <button className="linkish-btn" onClick={() => go("edit")}>Edit &amp; Ask</button>.</p>
      )}

      {expanded && h.editable && (
        <div className="hbody">
          <div className="seg" role="group" aria-label={`Hours for ${h.holiday.name}`}>
            <button type="button" className={`segbtn ${current === "closed" ? "on" : ""}`} aria-pressed={current === "closed"} disabled={st.busy} onClick={() => pick("closed")}>Closed all day</button>
            <button type="button" className={`segbtn ${current === "special" ? "on" : ""}`} aria-pressed={current === "special"} disabled={st.busy} onClick={() => pick("special")}>Special hours</button>
            <button type="button" className="segbtn" disabled={st.busy || !ex} title={ex ? "Cancel the saved hours for this day" : "Nothing is set for this day, so you are already open as usual"} onClick={clear}>Open as usual</button>
          </div>

          {mode && (
            <div className="editor">
              {mode === "special" ? (
                <div className="times">
                  <label>Opens <input type="time" value={open} onChange={(e) => setOpen(e.target.value)} /></label>
                  <label>Closes <input type="time" value={close} onChange={(e) => setClose(e.target.value)} /></label>
                </div>
              ) : (
                <p className="small">{h.holiday.name} will be marked closed all day.</p>
              )}
              {bad && <p className="err small">The closing time must be after the opening time.</p>}

              {needsDateCheck && (
                <fieldset className="dateq">
                  <legend>Is {h.holiday.name} on {niceDate(h.date)} this year?</legend>
                  <div className="seg">
                    <button type="button" className={`segbtn ${dateAnswer === "yes" ? "on" : ""}`} aria-pressed={dateAnswer === "yes"} onClick={() => setDateAnswer("yes")}>Yes, {niceDate(h.date)}</button>
                    <button type="button" className={`segbtn ${dateAnswer === "no" ? "on" : ""}`} aria-pressed={dateAnswer === "no"} onClick={() => setDateAnswer("no")}>No, it's on another date</button>
                  </div>
                  {dateAnswer === "no" && (
                    <div className="newdate">
                      <label>Correct date <input type="date" value={otherDate} min={minDate} max={maxDate} onChange={(e) => setOtherDate(e.target.value)} /></label>
                      {otherDate !== "" && !otherOk && (
                        <p className="err small">{otherDate === h.date ? `That is the date shown above. Choose "Yes" instead.` : `Pick a date between ${niceDate(minDate)} and ${niceDate(maxDate)}.`}</p>
                      )}
                      {ex && otherOk && <p className="muted small">Your saved hours for {niceDate(h.date)} will be moved to {niceDate(otherDate)}. The old day will be proposed for removal from listing sites that show it.</p>}
                    </div>
                  )}
                </fieldset>
              )}

              <div className="actions">
                <button className="btn primary small" disabled={st.busy || bad || dateBlocked} onClick={save}>
                  {dateAnswer === "no" && otherOk ? `Save for ${niceDate(finalDate)}` : "Save to my record"}
                </button>
                <button className="btn ghost small" disabled={st.busy} onClick={cancel}>Cancel</button>
              </div>
              <p className="muted small">This only saves it on your record. You approve every listing-site change in Approvals.</p>
            </div>
          )}

          {!mode && h.chip === "SET_PARTIAL" && (
            <p className="muted small">Saved on your record, but not every listing site shows it yet. <button className="linkish-btn" onClick={() => go("approvals")}>Check Approvals</button></p>
          )}
        </div>
      )}
    </li>
  );
}

export default function HolidaysTab({ st, act, go, rev }: Ctx) {
  const [fs, setFs] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [openIds, setOpenIds] = useState<Set<string> | null>(null);
  useEffect(() => { api("/api/foresight").then((f) => { setFs(f); setErr(null); }).catch((e) => setErr(e.message)); }, [rev]);
  if (err) return <section className="card"><p className="err">{err}</p></section>;
  if (!fs) return <section className="card"><h2>Upcoming holidays</h2><p className="muted">Checking your listing sites…</p></section>;

  const all: any[] = fs.holidays;
  // the first few holidays start expanded; the rest start collapsed until the owner opens them
  const expandedIds = openIds ?? new Set(all.slice(0, SHOW_FIRST).map((h) => h.holiday.id));
  const toggle = (id: string) => { const next = new Set(expandedIds); next.has(id) ? next.delete(id) : next.add(id); setOpenIds(next); };
  const visible = showAll ? all : all.slice(0, SHOW_FIRST);

  return (
    <section className="card">
      <h2>Upcoming holidays <span className="muted">(next {fs.windowDays} days)</span></h2>
      <p className="muted small">Choose whether you close, keep special hours, or stay open. Festival dates can shift each year, so we ask you to confirm the date, or give us the right one, before you save. Saving only updates your record; you approve every listing-site change in Approvals.</p>
      {fs.alerts.map((a: any) => (
        <div key={a.holidayId} className={`alert ${a.milestone === 7 ? "a-red" : a.milestone === 14 ? "a-clay" : "a-soft"}`}><b>{a.milestone}-day alert:</b> {a.message}</div>
      ))}
      <ul className="hlist">
        {visible.map((h) => (
          <HolidayRow key={h.holiday.id} h={h} today={fs.today} st={st} act={act} go={go} expanded={expandedIds.has(h.holiday.id)} onToggle={() => toggle(h.holiday.id)} />
        ))}
        {all.length === 0 && <li className="muted">No holidays in the window.</li>}
      </ul>
      {all.length > SHOW_FIRST && (
        <button className="btn small" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${all.length} upcoming holidays`}
        </button>
      )}
    </section>
  );
}
