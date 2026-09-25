import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { OfflineReadOnlyState } from "../components/OfflineReadOnlyState";
import { AppRoutes } from "../routes/AppRoutes";
import { canRenderContextData, isWriteAllowed, type RuntimeState } from "../state/runtime-state";
import type { ContextOption, User, View } from "../state/types";
import { useMobileMenu } from "../hooks/use-mobile-menu";
import { EnvironmentBanner, navigationItems, OfflineLiveBanner, Sidebar, ToastNotice, Topbar } from "./ShellPrimitives";

type ShellProps = {
  client: ApiClient;
  user: User;
  contexts: ContextOption[];
  context: ContextOption;
  onContextChange: (context: ContextOption) => void;
  view: View;
  onViewChange: (view: View) => void;
  onLogout: () => void;
  toast: string;
  notify: (message: string) => void;
  onDismissToast: () => void;
  runtimeState: RuntimeState;
  composerBuffer: string;
  onComposerBufferChange: (value: string) => void;
  globalSearchQuery: string;
  onGlobalSearchQueryChange: (value: string) => void;
  patientSearchQuery: string;
  onRetry: () => void;
  autoFocusMain?: boolean;
};

export function Shell({ client, user, contexts, context, onContextChange, view, onViewChange, onLogout, toast, notify, onDismissToast, runtimeState, composerBuffer, onComposerBufferChange, globalSearchQuery, onGlobalSearchQueryChange, patientSearchQuery, onRetry, autoFocusMain = false }: ShellProps) {
  const { mobileMenu, setMobileMenu, sidebarRef, mainShellRef, closeButtonRef, menuToggleRef, closeMobileMenu } = useMobileMenu();
  const mainRef = useRef<HTMLElement | null>(null);
  const previousView = useRef(view);
  const [environmentBannerVisible, setEnvironmentBannerVisible] = useState(true);
  const title = navigationItems.find((item) => item.id === view)?.label ?? (view === "admin" ? "Administração" : "Visão geral");
  const canWrite = isWriteAllowed(runtimeState);

  const dismissToast = useCallback(() => {
    const active = typeof document === "undefined" ? null : document.activeElement;
    const fromToast = active instanceof HTMLElement && active.classList.contains("toast-dismiss");
    onDismissToast();
    if (fromToast) requestAnimationFrame(() => mainRef.current?.focus());
  }, [onDismissToast]);

  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    mainRef.current?.focus();
  }, [view]);

  useEffect(() => {
    if (autoFocusMain) mainRef.current?.focus();
  }, [autoFocusMain]);

  return <div className="app-shell"><a className="skip-link" href="#main-content">Pular para o conteúdo principal</a><Sidebar user={user} contexts={contexts} context={context} view={view} mobileMenu={mobileMenu} onContextChange={onContextChange} onViewChange={onViewChange} onLogout={onLogout} sidebarRef={sidebarRef} closeButtonRef={closeButtonRef} closeMobileMenu={closeMobileMenu} /><div className="sidebar-scrim" aria-hidden="true" onClick={() => closeMobileMenu()} /><div ref={mainShellRef} className="main-shell"><Topbar title={title} mobileMenu={mobileMenu} menuToggleRef={menuToggleRef} globalSearchQuery={globalSearchQuery} onGlobalSearchQueryChange={onGlobalSearchQueryChange} onViewChange={onViewChange} notify={notify} user={user} onOpenMenu={() => setMobileMenu(true)} /><EnvironmentBanner runtimeState={runtimeState} visible={environmentBannerVisible} onDismiss={() => setEnvironmentBannerVisible(false)} /><OfflineLiveBanner runtimeState={runtimeState} /><main id="main-content" ref={mainRef} className="content" key={view} tabIndex={-1} aria-label={`Página: ${title}`}>{canRenderContextData(runtimeState) ? <AppRoutes client={client} actor={user} context={context} view={view} notify={notify} onViewChange={onViewChange} canWrite={canWrite} composerBuffer={composerBuffer} onComposerBufferChange={onComposerBufferChange} patientSearchQuery={patientSearchQuery} /> : <OfflineReadOnlyState runtimeState={runtimeState} hasComposerBuffer={Boolean(composerBuffer)} onRetry={onRetry} />}</main></div>{toast && <ToastNotice message={toast} onDismiss={dismissToast} />}</div>;
}
