import { useCallback, useEffect, useRef, useState } from "react";

export function useMobileMenu() {
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuToggleRef = useRef<HTMLButtonElement | null>(null);

  const closeMobileMenu = useCallback(() => {
    setMobileMenu(false);
    if (mobileViewport) window.setTimeout(() => menuToggleRef.current?.focus(), 0);
  }, [mobileViewport]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const update = () => setMobileViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const managed = sidebar as HTMLElement & { inert?: boolean };
    managed.inert = mobileViewport && !mobileMenu;
    if (mobileViewport) sidebar.setAttribute("aria-hidden", String(!mobileMenu));
    else sidebar.removeAttribute("aria-hidden");
    if (mobileViewport && mobileMenu) closeButtonRef.current?.focus();
  }, [mobileMenu, mobileViewport]);

  useEffect(() => {
    if (!mobileViewport || !mobileMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobileMenu();
        return;
      }
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const focusable = [...sidebarRef.current.querySelectorAll<HTMLElement>("button, select, input, [href]")].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileMenu, mobileMenu, mobileViewport]);

  return { mobileMenu, setMobileMenu, sidebarRef, closeButtonRef, menuToggleRef, closeMobileMenu };
}
