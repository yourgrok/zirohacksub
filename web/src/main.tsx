import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Gate from "./Gate";
import TestsPage from "./Tests";
import { api, type Me } from "./api";
import "./styles.css";

function Root() {
  const [me, setMe] = useState<Me | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const refresh = useCallback(async () => {
    try { setMe(await api<Me>("/api/auth/me")); } catch { setMe({ authenticated: false }); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const h = () => { setNotice("Your session ended. Please log in again."); setMe({ authenticated: false }); };
    window.addEventListener("session-expired", h);
    return () => window.removeEventListener("session-expired", h);
  }, []);

  if (!me) return <div className="wrap"><p className="muted">Loading…</p></div>;
  if (!me.authenticated) return <Gate notice={notice} onLoggedIn={() => { setNotice(undefined); refresh(); }} />;
  const logout = async () => { try { await api("/api/auth/logout", {}); } catch { /* already gone */ } setNotice(undefined); setMe({ authenticated: false }); };
  const isTests = window.location.pathname.replace(/\/+$/, "") === "/tests";
  return isTests ? <TestsPage me={me} onLogout={logout} /> : <App key={me.business?.id} me={me} onLogout={logout} onSwitched={refresh} />;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Root /></React.StrictMode>);
