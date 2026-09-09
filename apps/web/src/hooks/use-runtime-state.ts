import { useCallback, useEffect, useReducer } from "react";
import { isAuthenticationError, isDegradedRequestError } from "../api/client";
import { initialRuntimeState, runtimeStateReducer, type RuntimeEvent, type RuntimeSnapshot } from "../state/runtime-state";

export type RuntimeController = RuntimeSnapshot & {
  transition: (event: RuntimeEvent) => void;
  reportFailure: (error: unknown) => void;
};

export function useRuntimeState(): RuntimeController {
  const [snapshot, dispatch] = useReducer(runtimeStateReducer, undefined, initialRuntimeState);
  const transition = useCallback((event: RuntimeEvent) => dispatch(event), []);
  const reportFailure = useCallback((error: unknown) => {
    if (isAuthenticationError(error)) {
      transition({ type: "AUTH_REQUIRED", reason: error instanceof Error ? error.message : "A sessão precisa ser confirmada novamente." });
      return;
    }
    if (isDegradedRequestError(error)) transition({ type: "REQUEST_DEGRADED", reason: error instanceof Error ? error.message : "Uma dependência do CVG está indisponível." });
  }, [transition]);

  useEffect(() => {
    const markOffline = () => transition({ type: "NETWORK_OFFLINE" });
    const markOnline = () => transition({ type: "NETWORK_ONLINE" });
    window.addEventListener("offline", markOffline);
    window.addEventListener("online", markOnline);
    return () => {
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", markOnline);
    };
  }, [transition]);

  return { ...snapshot, transition, reportFailure };
}
