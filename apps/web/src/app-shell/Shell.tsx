import { useMemo } from "react";
import type { ApiClient } from "../api/client";
import { Icon, type IconName } from "../components/Icon";
import { OfflineReadOnlyState } from "../components/OfflineReadOnlyState";
import { AppRoutes } from "../routes/AppRoutes";
import { canRenderContextData, isWriteAllowed, runtimeStatePresentation, RUNTIME_STATES, type RuntimeState } from "../state/runtime-state";
import { initials } from "../state/formatters";
import type { ContextOption, User, View } from "../state/types";
import { useMobileMenu } from "../hooks/use-mobile-menu";

const primaryNavigation: Array<{ id: Exclude<View, "admin">; label: string; icon: IconName; count?: number }> = [
  { id: "overview", label: "Visão geral", icon: "grid" },
  { id: "agenda", label: "Agenda", icon: "calendar", count: 2 },
  { id: "patients", label: "Pacientes", icon: "paw" },
  { id: "clinical", label: "Atendimento", icon: "stethoscope" },
  { id: "stock", label: "Farmácia", icon: "box" },
  { id: "finance", label: "Financeiro", icon: "wallet" },
  { id: "copilot", label: "Copiloto", icon: "spark" }
];

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
  runtimeState: RuntimeState;
  composerBuffer: string;
  onComposerBufferChange: (value: string) => void;
  globalSearchQuery: string;
  onGlobalSearchQueryChange: (value: string) => void;
  patientSearchQuery: string;
};

export function Shell({ client, user, contexts, context, onContextChange, view, onViewChange, onLogout, toast, notify, runtimeState, composerBuffer, onComposerBufferChange, globalSearchQuery, onGlobalSearchQueryChange, patientSearchQuery }: ShellProps) {
  const { mobileMenu, setMobileMenu, sidebarRef, closeButtonRef, menuToggleRef, closeMobileMenu } = useMobileMenu();
  const title = primaryNavigation.find((item) => item.id === view)?.label ?? (view === "admin" ? "Administração" : "Visão geral");
  const presentation = runtimeStatePresentation(runtimeState);
  const canWrite = isWriteAllowed(runtimeState);

  const contextOptions = useMemo(() => contexts.map((item) => ({ key: `${item.unit.id}:${item.workspace.id}`, item })), [contexts]);

  return <div className="app-shell"><aside id="cvg-mobile-nav" ref={sidebarRef} className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`} aria-label="Navegação e contexto"><div className="sidebar-head"><div className="brand-mark">CVG<span>•</span></div><span className="brand-caption">CARE OPS</span><button ref={closeButtonRef} className="icon-button mobile-close" type="button" aria-label="Fechar menu" onClick={closeMobileMenu}><Icon name="close" /></button></div><div className="workspace-switcher"><span className="eyebrow">ESPAÇO ATIVO</span><div className="workspace-button" aria-hidden="true"><span className="workspace-icon"><Icon name="stethoscope" size={17} /></span><span><strong>{context.workspace.name}</strong><small>{context.unit.name}</small></span><span className="chevron">⌄</span></div>{contexts.length > 1 && <select aria-label="Selecionar unidade e workspace" value={`${context.unit.id}:${context.workspace.id}`} onChange={(event) => { const next = contextOptions.find((option) => option.key === event.target.value)?.item; if (next) { onContextChange(next); closeMobileMenu(); } }}><option value="">Trocar espaço</option>{contextOptions.map(({ key, item }) => <option key={key} value={key}>{item.unit.name} · {item.workspace.name}</option>)}</select>}</div><nav className="primary-nav" aria-label="Navegação principal"><span className="eyebrow nav-label">TRABALHO</span>{primaryNavigation.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} type="button" aria-current={view === item.id ? "page" : undefined} onClick={() => { onViewChange(item.id); closeMobileMenu(); }}><Icon name={item.icon} /><span>{item.label}</span>{item.count && <span className="nav-count">{item.count}</span>}</button>)}</nav><div className="sidebar-bottom"><button className={`nav-item ${view === "admin" ? "active" : ""}`} type="button" aria-current={view === "admin" ? "page" : undefined} onClick={() => { onViewChange("admin"); closeMobileMenu(); }}><Icon name="settings" /><span>Administração</span></button><div className="sidebar-help"><div className="help-spark"><Icon name="spark" size={15} /></div><div><strong>Precisa de foco?</strong><span>Veja a fila de hoje</span></div><Icon name="arrow" size={15} /></div><div className="user-mini"><span className="avatar avatar-small">{initials(user.displayName)}</span><span><strong>{user.displayName}</strong><small>{user.email}</small></span><button className="icon-button" type="button" aria-label="Sair" onClick={onLogout}><Icon name="arrow" size={16} /></button></div></div></aside><div className="sidebar-scrim" aria-hidden="true" onClick={closeMobileMenu} /><div className="main-shell"><header className="topbar"><button ref={menuToggleRef} className="icon-button menu-toggle" type="button" aria-label="Abrir menu" aria-expanded={mobileMenu} aria-controls="cvg-mobile-nav" onClick={() => setMobileMenu(true)}><span /><span /><span /></button><div className="breadcrumbs"><span>CVG</span><Icon name="arrow" size={13} /><strong>{title}</strong></div><div className="top-actions"><div className="global-search"><Icon name="search" size={17} /><input aria-label="Busca rápida" placeholder="Buscar paciente, tutor…" value={globalSearchQuery} onChange={(event) => onGlobalSearchQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onViewChange("patients"); } }} /></div><button className="icon-button notification-button" type="button" aria-label="Notificações" onClick={() => notify("Notificações detalhadas permanecem bloqueadas neste ambiente.")}><Icon name="bell" size={19} /><span /></button><div className="top-divider" /><span className="avatar">{initials(user.displayName)}</span></div></header><div className="environment-banner"><span className="banner-mark"><span className={`status-dot status-${presentation.tone}`} />{presentation.label}</span><span>{presentation.message}</span>{runtimeState === RUNTIME_STATES.ONLINE && <button type="button" aria-label="Ocultar aviso" onClick={(event) => event.currentTarget.parentElement?.remove()}><Icon name="close" size={14} /></button>}</div>{runtimeState !== RUNTIME_STATES.ONLINE && <div className="offline-live-banner" role="status" aria-live="polite"><Icon name="alert" size={16} /><span><strong>{runtimeState === RUNTIME_STATES.DEGRADED ? "Modo degradado." : runtimeState === RUNTIME_STATES.REVALIDATING ? "Revalidando contexto." : "Modo somente leitura."}</strong> {runtimeState === RUNTIME_STATES.DEGRADED ? "Leituras e escritas críticas permanecem bloqueadas até a dependência se recuperar." : "Sessão, escopo e policy serão revalidados antes de exibir dados novamente."}</span></div>}<main className="content" key={view}>{canRenderContextData(runtimeState) ? <AppRoutes client={client} actor={user} context={context} view={view} notify={notify} onViewChange={onViewChange} canWrite={canWrite} composerBuffer={composerBuffer} onComposerBufferChange={onComposerBufferChange} patientSearchQuery={patientSearchQuery} /> : <OfflineReadOnlyState runtimeState={runtimeState} hasComposerBuffer={Boolean(composerBuffer)} />}</main></div>{toast && <div className="toast" role="status"><span className="toast-icon"><Icon name="check" size={15} /></span>{toast}</div>}</div>;
}
