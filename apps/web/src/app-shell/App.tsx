import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createApiClient } from "../api/client";
import { Login } from "../components/Login";
import { SessionBlockedState } from "../components/SessionBlockedState";
import { useRuntimeState } from "../hooks/use-runtime-state";
import { useSession } from "../hooks/use-session";
import { useToast } from "../hooks/use-toast";
import { RUNTIME_STATES } from "../state/runtime-state";
import type { View } from "../state/types";
import { Shell } from "./Shell";

const ROUTABLE_VIEWS: readonly View[] = ["overview", "agenda", "patients", "clinical", "stock", "finance", "copilot", "admin"];

function viewFromLocation(): View {
  if (typeof window === "undefined") return "overview";
  const candidate = window.location.pathname.replace(/^\/+|\/+$/g, "") as View;
  return ROUTABLE_VIEWS.includes(candidate) ? candidate : "overview";
}

function queryFromLocation(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q")?.slice(0, 120) ?? "";
}

export function App() {
  const runtime = useRuntimeState();
  const runtimeStateRef = useRef(runtime.state);
  runtimeStateRef.current = runtime.state;
  const client = useMemo(() => createApiClient(() => runtimeStateRef.current, runtime.reportFailure), [runtime.reportFailure]);
  const session = useSession(client, runtime);
  const { toast, notify } = useToast();
  const [view, setView] = useState<View>(viewFromLocation);
  const [patientSearchQuery, setPatientSearchQuery] = useState(queryFromLocation);
  const [composerBuffer, setComposerBuffer] = useState("");

  const changeView = useCallback((nextView: View) => {
    setView(nextView);
    const nextQuery = nextView === "patients" ? patientSearchQuery : "";
    if (nextView !== "patients") setPatientSearchQuery("");
    if (typeof window !== "undefined") {
      const path = nextView === "overview" ? "/" : `/${nextView}`;
      window.history.pushState({}, "", `${path}${nextQuery ? `?q=${encodeURIComponent(nextQuery)}` : ""}`);
    }
  }, [patientSearchQuery]);

  useEffect(() => {
    const handlePopState = () => {
      setView(viewFromLocation());
      setPatientSearchQuery(queryFromLocation());
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (runtime.state === RUNTIME_STATES.CONTEXT_INVALID || runtime.state === RUNTIME_STATES.REAUTH_REQUIRED) setComposerBuffer("");
  }, [runtime.state]);

  const handleLogin = (user: Parameters<typeof session.signIn>[0], contexts: Parameters<typeof session.signIn>[1]) => {
    setComposerBuffer("");
    setView("overview");
    setPatientSearchQuery("");
    window.history.replaceState({}, "", "/");
    session.signIn(user, contexts);
  };

  const handleContextChange = (nextContext: NonNullable<typeof session.context>) => {
    setComposerBuffer("");
    session.changeContext(nextContext);
  };

  const handleReset = () => {
    setComposerBuffer("");
    setView("overview");
    setPatientSearchQuery("");
    window.history.replaceState({}, "", "/");
    session.reset();
  };

  if (!session.user) return <Login client={client} onLogin={handleLogin} />;
  if (runtime.state === RUNTIME_STATES.REAUTH_REQUIRED || runtime.state === RUNTIME_STATES.CONTEXT_INVALID || !session.context) return <SessionBlockedState runtimeState={runtime.state} onReset={handleReset} />;

  return <Shell client={client} user={session.user} contexts={session.contexts} context={session.context} onContextChange={handleContextChange} view={view} onViewChange={changeView} globalSearchQuery={patientSearchQuery} onGlobalSearchQueryChange={setPatientSearchQuery} patientSearchQuery={patientSearchQuery} onLogout={() => void session.signOut()} toast={toast} notify={notify} runtimeState={runtime.state} composerBuffer={composerBuffer} onComposerBufferChange={setComposerBuffer} />;
}
