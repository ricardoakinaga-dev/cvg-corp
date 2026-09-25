import { useMemo, type RefObject } from "react";
import { Icon, type IconName } from "../components/Icon";
import { RUNTIME_STATES, runtimeStatePresentation, type RuntimeState } from "../state/runtime-state";
import { initials } from "../state/formatters";
import type { ContextOption, User, View } from "../state/types";

export type NavigationItem = { id: Exclude<View, "admin">; label: string; icon: IconName; count?: number };

export const primaryNavigation: NavigationItem[] = [
  { id: "overview", label: "Visão geral", icon: "grid" },
  { id: "agenda", label: "Agenda", icon: "calendar" },
  { id: "patients", label: "Pacientes", icon: "paw" },
  { id: "clinical", label: "Atendimento", icon: "stethoscope" },
  { id: "stock", label: "Farmácia", icon: "box" },
  { id: "finance", label: "Financeiro", icon: "wallet" },
  { id: "copilot", label: "Copiloto", icon: "spark" }
];

export const journeyNavigation: NavigationItem[] = [
  { id: "exams", label: "Exames", icon: "check" },
  { id: "hospital", label: "Internação", icon: "box" },
  { id: "communications", label: "Comunicações", icon: "arrow" },
  { id: "knowledge", label: "Conhecimento", icon: "grid" },
  { id: "reports", label: "Relatórios", icon: "refresh" }
];

export const navigationItems = [...primaryNavigation, ...journeyNavigation];

type SidebarProps = {
  user: User;
  contexts: ContextOption[];
  context: ContextOption;
  view: View;
  mobileMenu: boolean;
  onContextChange: (context: ContextOption) => void;
  onViewChange: (view: View) => void;
  onLogout: () => void;
  sidebarRef: RefObject<HTMLElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  closeMobileMenu: (restoreFocus?: boolean) => void;
};

export function Sidebar({ user, contexts, context, view, mobileMenu, onContextChange, onViewChange, onLogout, sidebarRef, closeButtonRef, closeMobileMenu }: SidebarProps) {
  const contextOptions = useMemo(() => contexts.map((item) => ({ key: `${item.unit.id}:${item.workspace.id}`, item })), [contexts]);
  const renderNavigationItem = (item: NavigationItem) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} type="button" aria-current={view === item.id ? "page" : undefined} onClick={() => { onViewChange(item.id); closeMobileMenu(false); }}><Icon name={item.icon} /><span>{item.label}</span>{item.count && <span className="nav-count">{item.count}</span>}</button>;

  return <aside id="cvg-mobile-nav" ref={sidebarRef} className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`} aria-label="Navegação e contexto">
    <div className="sidebar-head"><div className="brand-mark">CVG<span>•</span></div><span className="brand-caption">CARE OPS</span><button ref={closeButtonRef} className="icon-button mobile-close" type="button" aria-label="Fechar menu" onClick={() => closeMobileMenu()}><Icon name="close" /></button></div>
    <div className="workspace-switcher"><span className="eyebrow">ESPAÇO ATIVO</span><div className="workspace-button" role="group" aria-label={`Espaço ativo: ${context.workspace.name}, unidade ${context.unit.name}`}><span className="workspace-icon" aria-hidden="true"><Icon name="stethoscope" size={17} /></span><span aria-hidden="true"><strong>{context.workspace.name}</strong><small>{context.unit.name}</small></span><span className="chevron" aria-hidden="true">⌄</span></div>{contexts.length > 1 && <select aria-label="Selecionar unidade e workspace" value={`${context.unit.id}:${context.workspace.id}`} onChange={(event) => { const next = contextOptions.find((option) => option.key === event.target.value)?.item; if (next) { onContextChange(next); closeMobileMenu(); } }}><option value="">Trocar espaço</option>{contextOptions.map(({ key, item }) => <option key={key} value={key}>{item.unit.name} · {item.workspace.name}</option>)}</select>}</div>
    <nav className="primary-nav" aria-label="Navegação principal"><span className="eyebrow nav-label">TRABALHO</span>{primaryNavigation.map(renderNavigationItem)}<span className="eyebrow nav-label">JORNADAS OPERACIONAIS</span>{journeyNavigation.map(renderNavigationItem)}</nav>
    <div className="sidebar-bottom"><button className={`nav-item ${view === "admin" ? "active" : ""}`} type="button" aria-current={view === "admin" ? "page" : undefined} onClick={() => { onViewChange("admin"); closeMobileMenu(false); }}><Icon name="settings" /><span>Administração</span></button><div className="sidebar-help"><div className="help-spark"><Icon name="spark" size={15} /></div><div><strong>Precisa de foco?</strong><span>Veja a fila de hoje</span></div><Icon name="arrow" size={15} /></div><div className="user-mini"><span className="avatar avatar-small">{initials(user.displayName)}</span><span><strong>{user.displayName}</strong><small>{user.email}</small></span><button className="icon-button" type="button" aria-label="Sair" onClick={onLogout}><Icon name="arrow" size={16} /></button></div></div>
  </aside>;
}

type TopbarProps = {
  title: string;
  mobileMenu: boolean;
  menuToggleRef: RefObject<HTMLButtonElement | null>;
  globalSearchQuery: string;
  onGlobalSearchQueryChange: (value: string) => void;
  onViewChange: (view: View) => void;
  notify: (message: string) => void;
  user: User;
  onOpenMenu: () => void;
};

export function Topbar({ title, mobileMenu, menuToggleRef, globalSearchQuery, onGlobalSearchQueryChange, onViewChange, notify, user, onOpenMenu }: TopbarProps) {
  return <header className="topbar"><button ref={menuToggleRef} className="icon-button menu-toggle" type="button" aria-label="Abrir menu" aria-expanded={mobileMenu} aria-controls="cvg-mobile-nav" onClick={onOpenMenu}><span /><span /><span /></button><div className="breadcrumbs"><span>CVG</span><Icon name="arrow" size={13} /><strong>{title}</strong></div><div className="top-actions"><div className="global-search"><Icon name="search" size={17} /><input aria-label="Busca rápida" placeholder="Buscar paciente, tutor…" value={globalSearchQuery} onChange={(event) => onGlobalSearchQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onViewChange("patients"); } }} /></div><button className="icon-button notification-button" type="button" aria-label="Notificações" onClick={() => notify("Notificações detalhadas permanecem bloqueadas neste ambiente.")}><Icon name="bell" size={19} /><span /></button><div className="top-divider" /><span className="avatar">{initials(user.displayName)}</span></div></header>;
}

export function EnvironmentBanner({ runtimeState, visible, onDismiss }: { runtimeState: RuntimeState; visible: boolean; onDismiss: () => void }) {
  if (!visible && runtimeState === RUNTIME_STATES.ONLINE) return null;
  const presentation = runtimeStatePresentation(runtimeState);
  return <div className="environment-banner" role="region" aria-label="Estado do ambiente"><span className="banner-mark"><span className={`status-dot status-${presentation.tone}`} />{presentation.label}</span><span>{presentation.message}</span>{runtimeState === RUNTIME_STATES.ONLINE && <button type="button" aria-label="Ocultar aviso" onClick={onDismiss}><Icon name="close" size={14} /></button>}</div>;
}

export function OfflineLiveBanner({ runtimeState }: { runtimeState: RuntimeState }) {
  if (runtimeState === RUNTIME_STATES.ONLINE) return null;
  const title = runtimeState === RUNTIME_STATES.DEGRADED ? "Modo degradado." : runtimeState === RUNTIME_STATES.REVALIDATING ? "Revalidando contexto." : runtimeState === RUNTIME_STATES.STALE ? "Dados desatualizados." : "Modo somente leitura.";
  const message = runtimeState === RUNTIME_STATES.DEGRADED ? "Leituras e escritas críticas permanecem bloqueadas até a dependência se recuperar." : runtimeState === RUNTIME_STATES.STALE ? "A autoridade mudou; dados e ações aguardam uma revalidação explícita." : "Sessão, escopo e policy serão revalidados antes de exibir dados novamente.";
  return <div className="offline-live-banner" role="status" aria-live="polite"><Icon name="alert" size={16} /><span><strong>{title}</strong> {message}</span></div>;
}

export function ToastNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return <div className="toast"><span className="toast-icon" aria-hidden="true"><Icon name="check" size={15} /></span><span className="toast-message" role="status" aria-live="polite">{message}</span><button className="toast-dismiss" type="button" aria-label="Fechar aviso" onClick={onDismiss}><Icon name="close" size={14} /></button></div>;
}
