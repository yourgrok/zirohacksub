import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import TestsPage from "./Tests";
import "./styles.css";

const isTests = window.location.pathname.replace(/\/+$/, "") === "/tests";
createRoot(document.getElementById("root")!).render(<React.StrictMode>{isTests ? <TestsPage /> : <App />}</React.StrictMode>);
