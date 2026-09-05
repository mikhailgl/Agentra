import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const SurvivalView = lazy(() => import("./survival/SurvivalView"));
const isSurvival = window.location.pathname.replace(/\/$/, "") === "/survival";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isSurvival ? <Suspense fallback={<p style={{ padding: 32 }}>Opening the island…</p>}><SurvivalView /></Suspense> : <App />}
  </StrictMode>,
);
