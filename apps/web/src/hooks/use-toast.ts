import { useCallback, useEffect, useRef, useState } from "react";

export function useToast(): { toast: string; notify: (message: string) => void } {
  const [toast, setToast] = useState("");
  const timerRef = useRef<number | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setToast(""), 3500);
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return { toast, notify };
}
