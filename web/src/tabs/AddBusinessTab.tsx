import React, { useState } from "react";
import { Details, Matches, PinReveal } from "../Gate";
import { Ctx } from "../shared";

/** Adds another business: the same three steps as first-time set-up (details → "Is this you?" → view-once PIN). */
export default function AddBusinessTab({ st, onSwitched }: Ctx) {
  const [screen, setScreen] = useState<"intro" | "details" | "match" | "pin">("intro");
  const [draft, setDraft] = useState<any>(null);
  const [created, setCreated] = useState<any>(null);
  return (
    <section className="card narrow">
      {screen === "intro" && (
        <div>
          <h2>Add a business</h2>
          <p>Set up another business with its own PIN. The agent finds its listings on every site, you confirm which ones are yours, and you get a PIN that is shown once.</p>
          <ul className="plain small">
            <li>🔑 Each business has its own PIN and its own data. They never see each other.</li>
            <li>🔍 Nothing is linked until you confirm each match.</li>
            <li>↔️ When you finish you are switched to the new business. To come back to <b>{st.business.name}</b>, log out and log in with its PIN.</li>
          </ul>
          <button className="btn primary" onClick={() => setScreen("details")}>Start</button>
        </div>
      )}
      {screen === "details" && <Details backLabel="← Cancel" onBack={() => setScreen("intro")} onFound={(d) => { setDraft(d); setScreen("match"); }} />}
      {screen === "match" && draft && <Matches draft={draft} onBack={() => setScreen("details")} onDone={(c) => { setCreated(c); setDraft(null); setScreen("pin"); }} />}
      {screen === "pin" && created && <PinReveal adding created={created} onLoggedIn={() => { setCreated(null); window.location.hash = "#/details"; onSwitched(); }} />}
    </section>
  );
}
