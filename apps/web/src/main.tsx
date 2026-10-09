import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app-shell/App";
import { RootErrorBoundary } from "./app-shell/ErrorBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>
);
