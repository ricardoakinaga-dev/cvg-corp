import { useMemo, useRef, useState } from "react";
import { createApiClient } from "../api/client";
import { Login } from "../components/Login";
import { SessionBlockedState } from "../components/SessionBlockedState";
import { useRuntimeState } from "../hooks/use-runtime-state";
import { useSession } from "../hooks/use-session";
import { useToast } from "../hooks/use-toast";
import { RUNTIME_STATES } from "../state/runtime-state";
import type { View } from "../state/types";
import { Shell } from "./Shell";

export function App() {
  const runtime = useRuntimeState();
  const runtimeStateRef = useRef(runtime.state);
  runtimeStateRef.current = runtime.state;
  const client = useMemo(() => createApiClient(() => runtimeStateRef.current, runtime.reportFailure), [runtime.reportFailure]);
  const session = useSession(client, runtime);
  const { toast, notify } = useToast();
  const [view, setView] = useState<View>("overview");
  const [composerBuffer, setComposerBuffer] = useState("");

  const handleLogin = (user: Parameters<typeof session.signIn>[0], contexts: Parameters<typeof session.signIn>[1]) => {
    setComposerBuffer("");
    setView("overview");
    session.signIn(user, contexts);
  };

  const handleContextChange = (nextContext: NonNullable<typeof session.context>) => {
    setComposerBuffer("");
    session.changeContext(nextContext);
  };

  const handleReset = () => {
    setComposerBuffer("");
    setView("overview");
    session.reset();
  };

  if (!session.user) return <Login client={client} onLogin={handleLogin} />;
  if (runtime.state === RUNTIME_STATES.REAUTH_REQUIRED || runtime.state === RUNTIME_STATES.CONTEXT_INVALID || !session.context) return <SessionBlockedState runtimeState={runtime.state} onReset={handleReset} />;

  return <Shell client={client} user={session.user} contexts={session.contexts} context={session.context} onContextChange={handleContextChange} view={view} onViewChange={setView} onLogout={() => void session.signOut()} toast={toast} notify={notify} runtimeState={runtime.state} composerBuffer={composerBuffer} onComposerBufferChange={setComposerBuffer} />;
}
