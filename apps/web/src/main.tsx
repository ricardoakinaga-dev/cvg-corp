import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type IconName = "grid" | "calendar" | "paw" | "stethoscope" | "box" | "wallet" | "spark" | "settings" | "search" | "bell" | "arrow" | "lock" | "check" | "alert" | "close" | "plus" | "refresh";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
    grid: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
    calendar: "M6 3v3m12-3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
    paw: "M8 11c-2 0-4 1.8-4 4 0 1.8 1.2 3 3 3 1.2 0 2-.7 3-1 1 .3 1.8 1 3 1 1.8 0 3-1.2 3-3 0-2.2-2-4-4-4-1.1 0-1.8.4-2 1-.2-.6-.9-1-2-1zM7 8c1 0 1.5-1 1.2-2.1C8 4.8 7.2 4 6.3 4S5 4.8 5.3 5.9C5.5 7 6 8 7 8zm10 0c1 0 1.5-1 1.7-2.1C19 4.8 18.2 4 17.3 4s-1.7.8-1.2 1.9C16.3 7 17 8 17 8zm-6-1c1 0 1.7-1 1.7-2.2S12 2.5 11 2.5 9.3 3.6 9.3 4.8 10 7 11 7z",
    stethoscope: "M6 3v5a5 5 0 0010 0V3M4 3h4M14 3h4M16 13v2a4 4 0 004 4h0M20 19a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0",
    box: "M4 7l8-4 8 4-8 4-8-4zm0 0v10l8 4 8-4V7M12 11v10M8 5l8 4",
    wallet: "M4 6a2 2 0 012-2h12v4H6a2 2 0 000 4h14v6H6a2 2 0 01-2-2V6zm14 6h2v3h-2a1.5 1.5 0 010-3z",
    spark: "M12 2l1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5L12 2zm7 14l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16z",
    settings: "M12 8a4 4 0 100 8 4 4 0 000-8zm8.5 4a6.5 6.5 0 01-.1 1l1.7 1.3-2 3.4-2-.8a7.4 7.4 0 01-1.8 1l-.3 2.1h-4l-.3-2.1a7.4 7.4 0 01-1.8-1l-2 .8-2-3.4L5.6 13a6.5 6.5 0 010-2L3.9 9.7l2-3.4 2 .8a7.4 7.4 0 011.8-1L10 4h4l.3 2.1a7.4 7.4 0 011.8 1l2-.8 2 3.4-1.7 1.3c.1.3.1.7.1 1z",
    search: "M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM16 16l5 5",
    bell: "M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    arrow: "M5 12h14m-6-6l6 6-6 6",
    lock: "M6 10V8a6 6 0 0112 0v2M5 10h14v10H5V10z",
    check: "M5 12l4 4L19 6",
    alert: "M12 4l9 16H3L12 4zm0 5v5m0 3h.01",
    close: "M6 6l12 12M18 6L6 18",
    plus: "M12 5v14M5 12h14",
    refresh: "M20 11a8 8 0 00-14.9-3M4 5v4h4M4 13a8 8 0 0014.9 3M20 19v-4h-4"
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

type ContextOption = { organization: { id: string; name: string; slug: string }; unit: { id: string; name: string; code: string }; workspace: { id: string; name: string; purpose: string }; roles: string[] };
type User = { id: string; displayName: string; email: string; status: string };
type ApiEnvelope<T> = { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; correlationId: string };
type View = "overview" | "agenda" | "patients" | "clinical" | "stock" | "finance" | "copilot" | "admin";

const API = import.meta.env.VITE_API_URL ?? "";

async function api<T>(path: string, init: RequestInit = {}, context: ContextOption | null = null): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (context) {
    headers.set("X-CVG-Unit-Id", context.unit.id);
    headers.set("X-CVG-Workspace-Id", context.workspace.id);
  }
  const csrf = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("cvg_csrf="))?.split("=")[1];
  if (["POST", "PUT", "PATCH", "DELETE"].includes((init.method ?? "GET").toUpperCase()) && csrf) headers.set("X-CSRF-Token", decodeURIComponent(csrf));
  const response = await fetch(`${API}/api/v1${path}`, { ...init, headers, credentials: "include" });
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? "Não foi possível concluir a operação.");
  return payload.data as T;
}

function useOnlineStatus(): { online: boolean; reconnectVersion: number } {
  const initialOnline = typeof navigator === "undefined" || navigator.onLine;
  const [online, setOnline] = useState(initialOnline);
  const [reconnectVersion, setReconnectVersion] = useState(0);
  const onlineRef = useRef(initialOnline);
  useEffect(() => {
    const markOnline = () => {
      if (!onlineRef.current) setReconnectVersion((version) => version + 1);
      onlineRef.current = true;
      setOnline(true);
    };
    const markOffline = () => {
      onlineRef.current = false;
      setOnline(false);
    };
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);
  return { online, reconnectVersion };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)).replace(" de ", " ");
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function Login({ onLogin }: { onLogin: (user: User, contexts: ContextOption[]) => void }) {
  const [login, setLogin] = useState("admin@cvg.local");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<{ status: string; demoOnly: boolean } | null>(null);

  useEffect(() => { void api<{ status: string; capabilities: { demoOnly: boolean } }>("/health").then((data) => setHealth({ status: data.status, demoOnly: data.capabilities.demoOnly })).catch(() => setHealth(null)); }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const result = await api<{ user: User; contexts: ContextOption[] }>("/auth/login", { method: "POST", body: JSON.stringify({ login, password }) });
      onLogin(result.user, result.contexts);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Login não concluído."); }
    finally { setLoading(false); }
  };

  const demo = async () => {
    setLoading(true); setError("");
    try { const result = await api<{ user: User; contexts: ContextOption[] }>("/auth/demo", { method: "POST" }); onLogin(result.user, result.contexts); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Demonstração indisponível."); }
    finally { setLoading(false); }
  };

  return <div className="login-shell"><div className="login-orbit orbit-one" /><div className="login-orbit orbit-two" /><main className="login-card" aria-labelledby="login-title"><div className="brand-lockup"><div className="brand-mark">CVG<span>•</span></div><span className="brand-caption">CARE OPERATIONS</span></div><div className="login-kicker"><span className="pulse-dot" /> ambiente local protegido</div><h1 id="login-title">O cuidado em foco.</h1><p className="login-intro">Um ponto de clareza para cada decisão clínica, operacional e humana.</p><form onSubmit={submit} className="login-form"><label htmlFor="login">Identificação<input id="login" value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" /></label><label htmlFor="password">Senha<input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>{error && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</div>}<button className="button button-primary button-wide" type="submit" disabled={loading}>{loading ? "Validando…" : "Entrar no CVG"}<Icon name="arrow" size={17} /></button></form>{health?.demoOnly && <><div className="login-divider"><span>ou</span></div><button className="button button-ghost button-wide" type="button" onClick={() => void demo()} disabled={loading}>Abrir demonstração sintética <Icon name="spark" size={16} /></button><p className="demo-note">Dados descartáveis · providers reais bloqueados</p></>}<footer className="login-footer"><span className="status-chip"><span className="status-dot status-teal" />{health?.status === "READY" ? "Serviços prontos" : "Verificando serviços"}</span><span>v0.1 · loopback</span></footer></main><aside className="login-aside"><div className="aside-topline">SINAL OPERACIONAL <span>01 — 06</span></div><div className="signal-graphic"><div className="signal-grid" /><div className="signal-wave wave-one" /><div className="signal-wave wave-two" /><div className="signal-ring" /><div className="signal-label label-a">CONTEXTO</div><div className="signal-label label-b">CUIDADO</div><div className="signal-label label-c">CONTINUIDADE</div></div><div className="aside-copy"><p>Menos ruído.<br /><strong>Mais presença.</strong></p><span>Feito para as pessoas que sustentam o cuidado todos os dias.</span></div></aside></div>;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [contexts, setContexts] = useState<ContextOption[]>([]);
  const [context, setContext] = useState<ContextOption | null>(null);
  const [view, setView] = useState<View>("overview");
  const [toast, setToast] = useState("");
  const [composerBuffer, setComposerBuffer] = useState("");
  const { online, reconnectVersion } = useOnlineStatus();
  const [revalidating, setRevalidating] = useState(false);

  useEffect(() => {
    let active = true;
    void api<{ user: User; context: { unit: { id: string }; workspace: { id: string } } }>("/me")
      .then(async (result) => {
        const items = await api<ContextOption[]>("/contexts");
        if (!active) return;
        const selected = items.find((item) => item.unit.id === result.context.unit.id && item.workspace.id === result.context.workspace.id) ?? items[0] ?? null;
        setUser(result.user);
        setContexts(items);
        setContext(selected);
      })
      .catch(() => {
        if (!active) return;
        setUser(null);
        setContexts([]);
        setContext(null);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!reconnectVersion || !user || !context) return;
    let active = true;
    setRevalidating(true);
    void api<{ user: User; context: { unit: { id: string }; workspace: { id: string } } }>("/me", {}, context)
      .then((result) => {
        if (!active) return;
        setUser(result.user);
        setRevalidating(false);
      })
      .catch(() => {
        if (!active) return;
        setComposerBuffer("");
        setUser(null);
        setContext(null);
        setContexts([]);
        setRevalidating(false);
      });
    return () => { active = false; };
  }, [reconnectVersion]);

  const onLogin = (loggedUser: User, availableContexts: ContextOption[]) => { setComposerBuffer(""); setRevalidating(false); setUser(loggedUser); setContexts(availableContexts); setContext(availableContexts[0] ?? null); setView("overview"); };
  const onContextChange = (next: ContextOption) => { setComposerBuffer(""); setContext(next); };
  const logout = async () => { try { if (online) await api("/auth/logout", { method: "POST" }, context); } finally { setComposerBuffer(""); setUser(null); setContext(null); setContexts([]); } };
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3500); };

  if (!user) return <Login onLogin={onLogin} />;
  if (!context) return <main className="context-loading" aria-live="polite"><span className="spinner" /><strong>Resolvendo seu espaço de trabalho…</strong><p>A sessão foi validada. O CVG está carregando o contexto autorizado antes de abrir os dados.</p></main>;
  return <Shell user={user} contexts={contexts} context={context} onContextChange={onContextChange} view={view} onViewChange={setView} onLogout={() => void logout()} toast={toast} notify={notify} online={online && !revalidating} composerBuffer={composerBuffer} onComposerBufferChange={setComposerBuffer} />;
}

function OfflineReadOnlyState({ hasComposerBuffer }: { hasComposerBuffer: boolean }) {
  return <section className="offline-state" aria-labelledby="offline-title"><div className="offline-state-icon"><Icon name="lock" size={22} /></div><span className="eyebrow">OFFLINE_READ_ONLY</span><h1 id="offline-title">Conexão interrompida.</h1><p>Este contexto não possui cache offline autorizado para exibição. O CVG ocultou os dados até revalidar sessão, escopo e policy.</p><div className="offline-state-grid"><div><span>Leitura</span><strong>Somente cache D0–D2 autorizado</strong></div><div><span>Ações</span><strong>Bloqueadas sem sincronização explícita</strong></div><div><span>Buffer do composer</span><strong>{hasComposerBuffer ? "Preservado em memória, oculto" : "Nenhum buffer local"}</strong></div></div><p className="offline-state-note">Ao reconectar, a aplicação revalida o contexto antes de mostrar qualquer conteúdo. Recarregar, sair ou perder a sessão descarta o buffer volátil.</p></section>;
}

function Shell({ user, contexts, context, onContextChange, view, onViewChange, onLogout, toast, notify, online, composerBuffer, onComposerBufferChange }: { user: User; contexts: ContextOption[]; context: ContextOption | null; onContextChange: (context: ContextOption) => void; view: View; onViewChange: (view: View) => void; onLogout: () => void; toast: string; notify: (message: string) => void; online: boolean; composerBuffer: string; onComposerBufferChange: (value: string) => void }) {
  const [mobileMenu, setMobileMenu] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuToggleRef = useRef<HTMLButtonElement | null>(null);
  const closeMobileMenu = useCallback(() => {
    setMobileMenu(false);
    if (mobileViewport) window.setTimeout(() => menuToggleRef.current?.focus(), 0);
  }, [mobileViewport]);
  const nav = useMemo(() => [{ id: "overview" as const, label: "Visão geral", icon: "grid" as const }, { id: "agenda" as const, label: "Agenda", icon: "calendar" as const, count: 2 }, { id: "patients" as const, label: "Pacientes", icon: "paw" as const }, { id: "clinical" as const, label: "Atendimento", icon: "stethoscope" as const }, { id: "stock" as const, label: "Farmácia", icon: "box" as const }, { id: "finance" as const, label: "Financeiro", icon: "wallet" as const }, { id: "copilot" as const, label: "Copiloto", icon: "spark" as const }], []);
  const title = nav.find((item) => item.id === view)?.label ?? (view === "admin" ? "Administração" : "Visão geral");
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
      if (event.key === "Escape") { event.preventDefault(); closeMobileMenu(); return; }
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const focusable = [...sidebarRef.current.querySelectorAll<HTMLElement>("button, select, input, [href]")].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeMobileMenu, mobileMenu, mobileViewport]);
  return <div className="app-shell"><aside id="cvg-mobile-nav" ref={sidebarRef} className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}><div className="sidebar-head"><div className="brand-mark">CVG<span>•</span></div><span className="brand-caption">CARE OPS</span><button ref={closeButtonRef} className="icon-button mobile-close" aria-label="Fechar menu" onClick={closeMobileMenu}><Icon name="close" /></button></div><div className="workspace-switcher"><span className="eyebrow">ESPAÇO ATIVO</span><button className="workspace-button" type="button"><span className="workspace-icon"><Icon name="stethoscope" size={17} /></span><span><strong>{context?.workspace.name ?? "Selecionar workspace"}</strong><small>{context?.unit.name ?? "Nenhum contexto"}</small></span><span className="chevron">⌄</span></button>{contexts.length > 1 && <select aria-label="Selecionar unidade e workspace" value={context ? `${context.unit.id}:${context.workspace.id}` : ""} onChange={(event) => { const next = contexts.find((item) => `${item.unit.id}:${item.workspace.id}` === event.target.value); if (next) { onContextChange(next); closeMobileMenu(); } }}><option value="">Trocar espaço</option>{contexts.map((item) => <option key={`${item.unit.id}:${item.workspace.id}`} value={`${item.unit.id}:${item.workspace.id}`}>{item.unit.name} · {item.workspace.name}</option>)}</select>}</div><nav className="primary-nav" aria-label="Navegação principal"><span className="eyebrow nav-label">TRABALHO</span>{nav.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => { onViewChange(item.id); closeMobileMenu(); }}><Icon name={item.icon} /><span>{item.label}</span>{item.count && <span className="nav-count">{item.count}</span>}</button>)}</nav><div className="sidebar-bottom"><button className={`nav-item ${view === "admin" ? "active" : ""}`} onClick={() => { onViewChange("admin"); closeMobileMenu(); }}><Icon name="settings" /><span>Administração</span></button><div className="sidebar-help"><div className="help-spark"><Icon name="spark" size={15} /></div><div><strong>Precisa de foco?</strong><span>Veja a fila de hoje</span></div><Icon name="arrow" size={15} /></div><div className="user-mini"><span className="avatar avatar-small">{initials(user.displayName)}</span><span><strong>{user.displayName}</strong><small>{user.email}</small></span><button className="icon-button" aria-label="Sair" onClick={onLogout}><Icon name="arrow" size={16} /></button></div></div></aside><div className="sidebar-scrim" aria-hidden="true" onClick={closeMobileMenu} /><div className="main-shell"><header className="topbar"><button ref={menuToggleRef} className="icon-button menu-toggle" aria-label="Abrir menu" aria-expanded={mobileMenu} aria-controls="cvg-mobile-nav" onClick={() => setMobileMenu(true)}><span /><span /><span /></button><div className="breadcrumbs"><span>CVG</span><Icon name="arrow" size={13} /><strong>{title}</strong></div><div className="top-actions"><div className="global-search"><Icon name="search" size={17} /><input aria-label="Busca rápida" placeholder="Buscar paciente, tutor…" /></div><button className="icon-button notification-button" aria-label="Notificações"><Icon name="bell" size={19} /><span /></button><div className="top-divider" /><span className="avatar">{initials(user.displayName)}</span></div></header><div className="environment-banner"><span className="banner-mark"><span className={`status-dot ${online ? "status-amber" : "status-coral"}`} />{online ? "LOCAL SINTÉTICO" : "OFFLINE_READ_ONLY"}</span><span>{online ? "Dados descartáveis · caminho manual disponível · providers externos bloqueados" : "Sem cache autorizado para este contexto · nenhum efeito ou sincronização será executado"}</span>{online && <button aria-label="Ocultar aviso" onClick={(event) => event.currentTarget.parentElement?.remove()}><Icon name="close" size={14} /></button>}</div>{!online && <div className="offline-live-banner" role="status" aria-live="polite"><Icon name="alert" size={16} /><span><strong>Modo somente leitura.</strong> Sessão, escopo e policy serão revalidados antes de exibir dados novamente.</span></div>}<main className="content" key={view}>{online ? <>{view === "overview" && <Overview context={context} onViewChange={onViewChange} notify={notify} />}{view === "agenda" && <Agenda context={context} notify={notify} />}{view === "patients" && <Patients context={context} notify={notify} />}{view === "clinical" && <Clinical context={context} notify={notify} />}{view === "stock" && <Stock context={context} notify={notify} />}{view === "finance" && <Finance context={context} notify={notify} />}{view === "copilot" && <Copilot context={context} notify={notify} online={online} prompt={composerBuffer} onPromptChange={onComposerBufferChange} />}{view === "admin" && <Admin actorId={user.id} context={context} notify={notify} />}</> : <OfflineReadOnlyState hasComposerBuffer={Boolean(composerBuffer)} />}</main></div>{toast && <div className="toast" role="status"><span className="toast-icon"><Icon name="check" size={15} /></span>{toast}</div>}</div>;
}

function PageHeader({ eyebrow, title, description, action, actionIcon = "plus", onAction, actionDisabled = false }: { eyebrow: string; title: string; description: string; action?: string | undefined; actionIcon?: IconName | undefined; onAction?: (() => void) | undefined; actionDisabled?: boolean | undefined }) { return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <button className="button button-primary" onClick={onAction} disabled={actionDisabled}><Icon name={actionIcon} size={16} />{action}</button>}</div>; }
function StatePanel({ kind, title, body, action, onAction }: { kind: "loading" | "empty" | "error"; title: string; body: string; action?: string; onAction?: () => void }) { return <div className={`state-panel state-${kind}`} role={kind === "error" ? "alert" : undefined}><div className="state-symbol">{kind === "loading" ? <span className="spinner" /> : <Icon name={kind === "error" ? "alert" : "spark"} size={22} />}</div><strong>{title}</strong><p>{body}</p>{action && <button className="button button-ghost" onClick={onAction}>{action}</button>}</div>; }
function StatusBadge({ children, tone = "teal" }: { children: React.ReactNode; tone?: "teal" | "amber" | "coral" | "slate" }) { return <span className={`status-badge badge-${tone}`}><span className="status-dot" />{children}</span>; }
function Kpi({ label, value, meta, tone, icon }: { label: string; value: string; meta: string; tone: string; icon: IconName }) { return <article className={`kpi-card kpi-${tone}`}><div className="kpi-top"><span>{label}</span><span className="kpi-icon"><Icon name={icon} size={17} /></span></div><strong>{value}</strong><small>{meta}</small></article>; }

function Overview({ context, onViewChange, notify }: { context: ContextOption | null; onViewChange: (view: View) => void; notify: (message: string) => void }) {
  const [summary, setSummary] = useState<{ appointmentsToday: number; waitingPatients: number; lowStockItems: number; openCharges: number; ai: { provider: string; tools: number }; unit: string } | null>(null);
  const [appointments, setAppointments] = useState<Array<{ id: string; startsAt: string; purpose: string; status: string; patient: { name: string } | null; provider: string | null }>>([]);
  const [patients, setPatients] = useState<Array<{ id: string; name: string; species: string; breed: string | null; guardian: { displayName: string } | null }>>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setError(""); try { const [nextSummary, nextAppointments, nextPatients] = await Promise.all([api<typeof summary>("/operations/summary", {}, context), api<{ items: typeof appointments }>("/appointments", {}, context), api<{ items: typeof patients }>("/patients", {}, context)]); setSummary(nextSummary); setAppointments(nextAppointments.items); setPatients(nextPatients.items); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar a operação."); } }, [context]);
  useEffect(() => { void load(); }, [load]);
  return <><PageHeader eyebrow="TERÇA · 08 DE SETEMBRO" title="Bom dia, Ricardo." description={`Aqui está o pulso da ${context?.unit.name ?? "sua operação"}.`} action="Novo atendimento" onAction={() => onViewChange("agenda")} /><section className="signal-strip"><div className="signal-strip-main"><span className="signal-strip-icon"><Icon name="spark" size={19} /></span><div><span className="eyebrow">LEITURA DO MOMENTO</span><strong>{summary ? `${summary.waitingPatients} paciente${summary.waitingPatients === 1 ? "" : "s"} aguardando atenção` : "Lendo a operação…"}</strong></div></div><div className="signal-strip-detail"><span className="strip-line" /><span>Próxima janela crítica em <strong>00:32</strong></span><button className="text-button" onClick={() => onViewChange("agenda")}>Ver fila <Icon name="arrow" size={14} /></button></div></section>{error ? <StatePanel kind="error" title="A operação está indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : !summary ? <StatePanel kind="loading" title="Preparando seu espaço" body="Conectando aos dados sintéticos da unidade." /> : <><section className="kpi-grid"><Kpi label="Hoje na agenda" value={String(summary.appointmentsToday).padStart(2, "0")} meta="+2 vs. média do turno" tone="teal" icon="calendar" /><Kpi label="Na fila agora" value={String(summary.waitingPatients).padStart(2, "0")} meta="1 prioridade alta" tone="coral" icon="paw" /><Kpi label="Atenção no estoque" value={String(summary.lowStockItems).padStart(2, "0")} meta="Revisar antes das 14h" tone="amber" icon="box" /><Kpi label="Em aberto" value={formatMoney(summary.openCharges * 22000)} meta="Financeiro · visão da unidade" tone="slate" icon="wallet" /></section><div className="dashboard-grid"><section className="surface surface-wide"><div className="surface-head"><div><span className="eyebrow">FLUXO DE HOJE</span><h2>Próximos atendimentos</h2></div><button className="text-button" onClick={() => onViewChange("agenda")}>Abrir agenda <Icon name="arrow" size={14} /></button></div>{appointments.length ? <div className="appointment-list">{appointments.slice(0, 4).map((appointment, index) => <div className="appointment-row" key={appointment.id}><div className={`time-rail ${index === 0 ? "now" : ""}`}><strong>{new Date(appointment.startsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong><span>{index === 0 ? "agora" : "em breve"}</span></div><div className="appointment-avatar">{appointment.patient?.name.slice(0, 1) ?? "?"}</div><div className="appointment-info"><strong>{appointment.patient?.name ?? "Paciente"}</strong><span>{appointment.purpose} · {appointment.provider ?? "Equipe clínica"}</span></div><StatusBadge tone={appointment.status === "CONFIRMED" ? "teal" : "slate"}>{appointment.status === "CONFIRMED" ? "Confirmado" : "Agendado"}</StatusBadge><button className="icon-button row-arrow" aria-label={`Abrir atendimento de ${appointment.patient?.name ?? "paciente"}`} onClick={() => onViewChange("clinical")}><Icon name="arrow" size={16} /></button></div>)}</div> : <StatePanel kind="empty" title="Agenda livre" body="Nenhum atendimento encontrado para este contexto." action="Abrir agenda" onAction={() => onViewChange("agenda")} />}</section><section className="surface copilot-card"><div className="copilot-orb"><Icon name="spark" size={20} /></div><span className="eyebrow">CVG COPILOTO</span><h2>Clareza para o próximo passo.</h2><p>Resuma a fila, organize um rascunho ou encontre uma fonte aprovada — sempre com revisão humana.</p><button className="button button-dark" onClick={() => onViewChange("copilot")}>Abrir copiloto <Icon name="arrow" size={15} /></button><div className="copilot-foot"><span className="status-dot status-teal" />provider local sintético<span className="divider-dot" />sem envio externo</div></section><section className="surface surface-wide"><div className="surface-head"><div><span className="eyebrow">PACIENTES RECENTES</span><h2>Relações em cuidado</h2></div><button className="text-button" onClick={() => onViewChange("patients")}>Ver todos <Icon name="arrow" size={14} /></button></div><div className="patient-grid">{patients.slice(0, 4).map((patient) => <button className="patient-card" key={patient.id} onClick={() => onViewChange("patients")}><span className="patient-avatar">{patient.name.slice(0, 1)}</span><span><strong>{patient.name}</strong><small>{patient.species} · {patient.breed ?? "sem raça"}</small><em>{patient.guardian?.displayName ?? "Responsável não informado"}</em></span><Icon name="arrow" size={15} /></button>)}</div></section><section className="surface insight-card"><div className="insight-top"><span className="eyebrow">RITMO DA UNIDADE</span><span className="status-badge badge-teal"><span className="status-dot" />estável</span></div><div className="mini-chart" aria-label="Ritmo da unidade estável"><span style={{ height: "var(--space-pct-36)" }} /><span style={{ height: "var(--space-pct-48)" }} /><span style={{ height: "var(--space-pct-42)" }} /><span style={{ height: "var(--space-pct-67)" }} /><span style={{ height: "var(--space-pct-58)" }} /><span style={{ height: "var(--space-pct-76)" }} /><span style={{ height: "var(--space-pct-70)" }} /><span style={{ height: "var(--space-pct-88)" }} /></div><div className="insight-number"><strong>86<span>%</span></strong><small>capacidade acompanhada</small></div><button className="text-button" onClick={() => notify("Métricas detalhadas permanecem no escopo administrativo.")}>Ver sinais <Icon name="arrow" size={14} /></button></section></div></>}</>;
}

function Agenda({ context, notify }: { context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Array<{ id: string; startsAt: string; endsAt: string; purpose: string; status: string; patient: { name: string } | null; provider: string | null }>>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); try { setItems((await api<{ items: typeof items }>("/appointments", {}, context)).items); } catch (reason) { setError(reason instanceof Error ? reason.message : "Agenda indisponível."); } finally { setLoading(false); } }, [context]);
  useEffect(() => { void load(); }, [load]);
  return <><PageHeader eyebrow="CAPACIDADE & FLUXO" title="Agenda" description="O que precisa acontecer, na hora certa e no lugar certo." action="Novo horário" onAction={() => notify("A criação de horário será aberta após selecionar um serviço.")} /><div className="toolbar"><div className="segmented"><button className="selected">Hoje</button><button>Próximos 7 dias</button><button>Visão de fila</button></div><button className="button button-ghost" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={15} />Atualizar</button></div><section className="surface agenda-surface"><div className="surface-head"><div><span className="eyebrow">08 SET · UNIDADE CENTRO</span><h2>Terça-feira</h2></div><StatusBadge tone="teal">{items.length} janelas</StatusBadge></div>{loading ? <StatePanel kind="loading" title="Abrindo a agenda" body="Carregando slots autorizados." /> : error ? <StatePanel kind="error" title="Não foi possível abrir a agenda" body={error} action="Tentar novamente" onAction={() => void load()} /> : items.length === 0 ? <StatePanel kind="empty" title="Nenhuma janela encontrada" body="Ajuste o período ou cadastre um serviço para começar." /> : <div className="agenda-table-wrap"><table className="data-table"><caption className="sr-only">Atendimentos agendados</caption><thead><tr><th>Horário</th><th>Paciente</th><th>Motivo</th><th>Responsável</th><th>Status</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{formatDate(item.startsAt)}</strong><span className="table-sub">até {new Date(item.endsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></td><td><div className="table-person"><span className="patient-avatar mini">{item.patient?.name.slice(0, 1) ?? "?"}</span><span><strong>{item.patient?.name ?? "Paciente"}</strong><span className="table-sub agenda-mobile-meta">{item.purpose} · {item.provider ?? "Equipe"}</span></span></div></td><td>{item.purpose}</td><td>{item.provider ?? "Equipe"}</td><td><StatusBadge tone={item.status === "CONFIRMED" ? "teal" : item.status === "CANCELLED" ? "coral" : "slate"}>{item.status === "CONFIRMED" ? "Confirmado" : item.status === "CANCELLED" ? "Cancelado" : "Agendado"}</StatusBadge></td><td><button className="icon-button row-arrow" aria-label="Abrir item" onClick={() => notify("Detalhes do atendimento em preparação.")}><Icon name="arrow" size={15} /></button></td></tr>)}</tbody></table></div>}</section></>;
}

function Patients({ context, notify }: { context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Array<{ id: string; name: string; species: string; breed: string | null; guardian: { displayName: string; phone: string } | null; status: string }>>([]); const [query, setQuery] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const load = useCallback(async () => { setLoading(true); try { setItems((await api<{ items: typeof items }>(`/patients${query ? `?q=${encodeURIComponent(query)}` : ""}`, {}, context)).items); } catch (reason) { setError(reason instanceof Error ? reason.message : "Pacientes indisponíveis."); } finally { setLoading(false); } }, [context, query]); useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);
  return <><PageHeader eyebrow="RELAÇÕES EM CUIDADO" title="Pacientes" description="Histórico vivo de pacientes, responsáveis e vínculos de cuidado." action="Novo paciente" onAction={() => notify("Para criar um paciente, cadastre primeiro o responsável.")} /><div className="toolbar"><label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, espécie ou raça" aria-label="Buscar pacientes" /></label><span className="toolbar-result">{items.length} encontrados</span></div><section className="surface"><div className="surface-head"><div><span className="eyebrow">REGISTRO ATIVO</span><h2>Todos os pacientes</h2></div><button className="button button-ghost" onClick={() => notify("Exportação permanece bloqueada neste ambiente.")}><Icon name="lock" size={14} />Exportar</button></div>{loading ? <StatePanel kind="loading" title="Buscando pacientes" body="Aplicando escopo da unidade e classificação de dados." /> : error ? <StatePanel kind="error" title="Busca indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : items.length === 0 ? <StatePanel kind="empty" title="Nenhum paciente encontrado" body={query ? "Tente outro termo de busca." : "O registro ainda está vazio neste contexto."} /> : <div className="patient-list">{items.map((patient) => <div className="patient-list-row" key={patient.id}><span className="patient-avatar">{patient.name.slice(0, 1)}</span><div className="patient-primary"><strong>{patient.name}</strong><span>{patient.species} · {patient.breed ?? "sem raça definida"}</span></div><div className="patient-secondary"><span>Responsável</span><strong>{patient.guardian?.displayName ?? "Não informado"}</strong></div><div className="patient-secondary"><span>Contato</span><strong>{patient.guardian?.phone ?? "—"}</strong></div><StatusBadge tone="teal">Ativo</StatusBadge><button className="icon-button row-arrow" aria-label={`Abrir ficha de ${patient.name}`} onClick={() => notify(`Ficha de ${patient.name}: histórico clínico segue protegido por escopo.`)}><Icon name="arrow" size={16} /></button></div>)}</div>}</section></>;
}

function Clinical({ context, notify }: { context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Array<{ id: string; patient: { name: string } | null; chiefComplaint: string; urgency: string; status: string; openedAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems((await api<{ items: typeof items }>("/encounters", {}, context)).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Atendimento indisponível."); }
    finally { setLoading(false); }
  }, [context]);
  useEffect(() => { void load(); }, [load]);
  return <><PageHeader eyebrow="CUIDADO CLÍNICO" title="Atendimento" description="Da triagem à assinatura, cada fato tem autoria e contexto." action="Abrir atendimento" onAction={() => notify("Novo atendimento exige paciente e contexto clínico.")} /><section className="clinical-hero"><div className="clinical-hero-copy"><span className="eyebrow">CAMINHO MANUAL DISPONÍVEL</span><h2>O copiloto sugere.<br /><em>O veterinário decide.</em></h2><p>Rascunhos de IA nunca entram no prontuário sem revisão e assinatura explícitas.</p><button className="button button-dark" onClick={() => notify("O caminho manual continua disponível mesmo com o copiloto desligado.")}>Ver protocolo <Icon name="arrow" size={15} /></button></div><div className="clinical-hero-mark"><Icon name="stethoscope" size={54} /><span>D3<br />SENSÍVEL</span></div></section><section className="surface"><div className="surface-head"><div><span className="eyebrow">EPISÓDIOS ABERTOS</span><h2>Atendimentos em andamento</h2></div><StatusBadge tone="coral">revisão humana</StatusBadge></div>{loading ? <StatePanel kind="loading" title="Lendo atendimentos" body="Resolvendo escopo clínico." /> : error ? <StatePanel kind="error" title="Atendimentos indisponíveis" body={error} action="Tentar novamente" onAction={() => void load()} /> : items.length ? <div className="encounter-grid">{items.map((item) => <article className="encounter-card" key={item.id}><div className="encounter-top"><span className="patient-avatar mini">{item.patient?.name.slice(0, 1) ?? "?"}</span><StatusBadge tone={item.urgency === "EMERGENCY" ? "coral" : item.urgency === "URGENT" ? "amber" : "teal"}>{item.urgency === "URGENT" ? "Prioridade" : item.urgency === "EMERGENCY" ? "Emergência" : "Rotina"}</StatusBadge></div><h3>{item.patient?.name ?? "Paciente"}</h3><p>{item.chiefComplaint}</p><span className="table-sub">Aberto em {formatDate(item.openedAt)}</span><button className="text-button" onClick={() => notify("A ficha clínica exige role veterinário no escopo atual.")}>Abrir ficha <Icon name="arrow" size={14} /></button></article>)}</div> : <StatePanel kind="empty" title="Nenhum atendimento aberto" body="A fila clínica está limpa neste workspace." />}</section></>;
}

function Stock({ context, notify }: { context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Array<{ id: string; lotNumber: string; quantity: number; expiresOn: string; product: { name: string; unit: string; reorderPoint: number } | null; location: { name: string } | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems((await api<{ items: typeof items }>("/stock", {}, context)).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Estoque indisponível."); }
    finally { setLoading(false); }
  }, [context]);
  useEffect(() => { void load(); }, [load]);
  const low = items.filter((item) => (item.product?.reorderPoint ?? 0) >= item.quantity);
  return <><PageHeader eyebrow="SUPRIMENTOS & FARMÁCIA" title="Estoque" description="Lotes, validade e movimentos sem saldo negativo." action="Registrar entrada" onAction={() => notify("Toda entrada exige lote, validade e motivo de auditoria.")} />{loading ? <StatePanel kind="loading" title="Abrindo a farmácia" body="Carregando lotes e validade do contexto autorizado." /> : error ? <StatePanel kind="error" title="Estoque indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : <><div className="stock-alert"><div className="alert-icon"><Icon name="alert" size={18} /></div><div><strong>{low.length ? `${low.length} item${low.length > 1 ? "ns" : ""} pede atenção` : "Estoque dentro do ponto de reposição"}</strong><span>{low.length ? "Revise o saldo antes de confirmar novos atendimentos." : "Nenhuma exceção aberta no contexto atual."}</span></div><button className="text-button" onClick={() => notify("O inventário exige alçada de estoque.")}>Abrir inventário <Icon name="arrow" size={14} /></button></div><section className="surface"><div className="surface-head"><div><span className="eyebrow">SALDO POR LOTE</span><h2>Visão da farmácia</h2></div><span className="toolbar-result">{items.length} lotes</span></div>{items.length ? <div className="stock-grid">{items.map((item) => <article className={`stock-card ${low.includes(item) ? "stock-low" : ""}`} key={item.id}><div className="stock-card-head"><span className="stock-icon"><Icon name="box" size={17} /></span><StatusBadge tone={low.includes(item) ? "amber" : "teal"}>{low.includes(item) ? "Repor" : "Disponível"}</StatusBadge></div><h3>{item.product?.name ?? "Produto"}</h3><span className="table-sub">Lote {item.lotNumber} · vence {new Date(item.expiresOn).toLocaleDateString("pt-BR")}</span><div className="stock-quantity"><strong>{item.quantity}</strong><span>{item.product?.unit ?? "unidades"}</span></div><div className="stock-progress"><span style={{ "--progress-width": `${Math.min(100, Math.max(6, item.quantity / Math.max(1, (item.product?.reorderPoint ?? 1) * 2) * 100))}%` } as CSSProperties} /></div><small>{item.location?.name ?? "Local não informado"}</small></article>)}</div> : <StatePanel kind="empty" title="Sem lotes neste contexto" body="Cadastre o primeiro produto para acompanhar validade e saldo." />}</section></>}</>;
}

function Finance({ context, notify }: { context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Array<{ id: string; description: string; amountCents: number; status: string; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems((await api<{ items: typeof items }>("/finance/charges", {}, context)).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Financeiro indisponível."); }
    finally { setLoading(false); }
  }, [context]);
  useEffect(() => { void load(); }, [load]);
  const total = items.reduce((sum, item) => sum + item.amountCents, 0);
  return <><PageHeader eyebrow="LEDGER & CONCILIAÇÃO" title="Financeiro" description="Cada cobrança tem um movimento. Cada movimento deixa rastro." action="Nova cobrança" onAction={() => notify("Cobranças reais estão desabilitadas na demonstração sintética.")} />{loading ? <StatePanel kind="loading" title="Abrindo o financeiro" body="Carregando cobranças do contexto autorizado." /> : error ? <StatePanel kind="error" title="Financeiro indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : <><section className="finance-summary"><div><span className="eyebrow">EM ABERTO · VISÃO LOCAL</span><strong>{formatMoney(total)}</strong><span>Ledger append-only lógico · {items.length} lançamentos</span></div><div className="finance-bars" aria-hidden="true"><span style={{ height: "var(--space-pct-35)" }} /><span style={{ height: "var(--space-pct-50)" }} /><span style={{ height: "var(--space-pct-45)" }} /><span style={{ height: "var(--space-pct-78)" }} /><span style={{ height: "var(--space-pct-62)" }} /><span style={{ height: "var(--space-pct-90)" }} /></div></section><section className="surface"><div className="surface-head"><div><span className="eyebrow">MOVIMENTOS RECENTES</span><h2>Contas em aberto</h2></div><button className="button button-ghost" onClick={() => notify("Exportação permanece bloqueada até autoridade e retenção definidas.")}><Icon name="lock" size={14} />Exportar</button></div>{items.length ? <div className="ledger-list">{items.map((item) => <div className="ledger-row" key={item.id}><span className="ledger-icon"><Icon name="wallet" size={17} /></span><div><strong>{item.description}</strong><span>{formatDate(item.createdAt)} · movimento CHARGE</span></div><strong>{formatMoney(item.amountCents)}</strong><StatusBadge tone={item.status === "PAID" ? "teal" : "amber"}>{item.status === "PAID" ? "Pago" : "Em aberto"}</StatusBadge></div>)}</div> : <StatePanel kind="empty" title="Nenhuma cobrança encontrada" body="A visão financeira está vazia neste contexto." />}</section></>}</>;
}

function Copilot({ context, notify, online, prompt, onPromptChange }: { context: ContextOption | null; notify: (message: string) => void; online: boolean; prompt: string; onPromptChange: (value: string) => void }) { const [purpose, setPurpose] = useState("SUMMARY"); const [loading, setLoading] = useState(false); const [response, setResponse] = useState<{ text: string; approval: { id: string; toolName: string } | null; quarantined: boolean } | null>(null); const [error, setError] = useState(""); const submit = async () => { if (!online || !prompt.trim()) return; setLoading(true); setError(""); try { const result = await api<{ turn: { response: string | null; status: string }; approval: { id: string; toolName: string } | null }>("/ai/turns", { method: "POST", body: JSON.stringify({ sessionId: null, prompt, purpose, patientId: null, encounterId: null, requestedTool: null, idempotencyKey: crypto.randomUUID() }) }, context); setResponse({ text: result.turn.response ?? "Aguardando uma decisão contextual.", approval: result.approval, quarantined: result.turn.status === "QUARANTINED" }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Copiloto indisponível."); } finally { setLoading(false); } }; const approve = async (decision: "allowed-once" | "rejected") => { if (!online || !response?.approval) return; try { await api(`/ai/approvals/${response.approval.id}`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision, reason: decision === "allowed-once" ? "Confirmação explícita no cockpit local" : "Ação não autorizada pelo usuário" }) }, context); setResponse({ ...response, approval: null, text: decision === "allowed-once" ? "Aprovação registrada. A execução ainda exige um novo turno explícito para evitar disparo silencioso." : "Ação rejeitada e não executada." }); } catch (reason) { notify(reason instanceof Error ? reason.message : "Aprovação indisponível."); } }; return <><PageHeader eyebrow="INTELIGÊNCIA GOVERNADA" title="Copiloto" description="Contexto mínimo, resposta rastreável e nenhuma ação silenciosa." /><div className="copilot-layout"><section className="surface composer-surface"><div className="composer-head"><div className="copilot-orb small"><Icon name="spark" size={17} /></div><div><span className="eyebrow">CVG LOCAL STUB</span><h2>Qual é o próximo foco?</h2></div><StatusBadge tone="teal">sem egress</StatusBadge></div><label className="composer-label" htmlFor="purpose">Finalidade<select id="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} disabled={!online}> <option value="SUMMARY">Resumo operacional</option><option value="DRAFT_CLINICAL">Rascunho clínico</option><option value="KNOWLEDGE_QUERY">Buscar fonte aprovada</option><option value="OPERATIONS">Próximo passo operacional</option></select></label><label className="composer-label" htmlFor="prompt">Pedido<textarea id="prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Ex.: organize os pontos de atenção da fila desta manhã…" rows={6} maxLength={8000} disabled={!online} /></label>{error && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</div>}<div className="composer-foot"><span className="table-sub">Buffer volátil · não persiste rascunho local</span><button className="button button-primary" onClick={() => void submit()} disabled={!online || loading || !prompt.trim()}>{loading ? "Processando…" : "Processar turno"}<Icon name="arrow" size={15} /></button></div></section><aside className="surface governance-panel"><div className="surface-head"><div><span className="eyebrow">GUARDRAILS ATIVOS</span><h2>O que fica protegido</h2></div><Icon name="lock" size={17} /></div><ul className="guardrail-list"><li><span><Icon name="check" size={14} /></span><div><strong>Provider local</strong><small>Nenhum conteúdo sai desta máquina.</small></div></li><li><span><Icon name="check" size={14} /></span><div><strong>Rascunho ≠ fato</strong><small>O veterinário assina antes de publicar.</small></div></li><li><span><Icon name="check" size={14} /></span><div><strong>Approval contextual</strong><small>Escritas de impacto pedem confirmação.</small></div></li><li><span><Icon name="check" size={14} /></span><div><strong>Replay verificável</strong><small>Engine, profile e referências ficam registrados.</small></div></li></ul><div className="governance-foot"><span className="status-dot status-amber" /><span>DeepSeek Harness real não está conectado nesta etapa.</span></div></aside></div>{response && <section className={`surface copilot-response ${response.quarantined ? "response-quarantined" : ""}`}><div className="surface-head"><div><span className="eyebrow">RESULTADO DO TURNO</span><h2>{response.quarantined ? "Conteúdo retido" : "Resposta para revisão"}</h2></div><StatusBadge tone={response.quarantined ? "amber" : "teal"}>{response.quarantined ? "quarentena" : "derivado"}</StatusBadge></div><p>{response.text}</p>{response.approval && <div className="approval-card"><div className="approval-icon"><Icon name="alert" size={18} /></div><div><strong>Confirmação necessária · {response.approval.toolName}</strong><span>Esta capability não executará nada sem sua decisão explícita.</span></div><button className="button button-dark" onClick={() => void approve("allowed-once")}>Permitir uma vez</button><button className="button button-ghost" onClick={() => void approve("rejected")}>Negar</button></div>}<div className="provenance-row"><span><Icon name="check" size={14} />local-stub</span><span><Icon name="check" size={14} />profile governado</span><span><Icon name="check" size={14} />auditado</span></div></section>}</>; }

function Admin({ actorId, context, notify }: { actorId: string; context: ContextOption | null; notify: (message: string) => void }) {
  type Assignment = { id: string; role: string; scopeType: string; unitId: string | null; workspaceId: string | null; revokedAt: string | null };
  type AdminUser = { id: string; displayName: string; email: string; status: string; roles: Assignment[] };
  type AuditItem = { id: string; action: string; resourceType: string; result: string; reason: string | null; correlationId: string; unitId: string | null; workspaceId: string | null; createdAt: string };
  const [capabilities, setCapabilities] = useState<Array<{ id: string; label: string; status: string; roles: string[] }>>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [auditRecords, setAuditRecords] = useState<AuditItem[]>([]);
  const [revision, setRevision] = useState("1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [role, setRole] = useState<"recepcao" | "veterinario">("recepcao");
  const [scopeType, setScopeType] = useState<"UNIT" | "WORKSPACE">("WORKSPACE");
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const canManage = context?.roles.includes("admin") ?? false;
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const cap = await api<{ items: typeof capabilities }>("/capabilities", {}, context);
      setCapabilities(cap.items);
      if (!canManage) {
        setUsers([]);
        setAuditRecords([]);
        return;
      }
      const [userList, auditList] = await Promise.all([api<{ items: AdminUser[]; revision: string }>("/users", {}, context), api<{ items: AuditItem[] }>("/audit?limit=8", {}, context)]);
      setUsers(userList.items);
      setAuditRecords(auditList.items);
      setRevision(userList.revision);
      setTargetUserId((current) => userList.items.some((item) => item.status === "ACTIVE" && item.id === current && item.id !== actorId) ? current : userList.items.find((item) => item.status === "ACTIVE" && item.id !== actorId)?.id || "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Administração indisponível."); }
    finally { setLoading(false); }
  }, [actorId, canManage, context]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dialogOpen) return;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button, select, input, textarea, [href]") ?? []).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setDialogOpen(false); return; }
      if (event.key !== "Tab" || !dialog) return;
      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) return;
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialogOpen]);
  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!context || !targetUserId) return;
    setSubmitting(true);
    try {
      const result = await api<{ revision: string }>("/role-assignments", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ userId: targetUserId, role, scopeType, unitId: context.unit.id, workspaceId: scopeType === "WORKSPACE" ? context.workspace.id : null, expectedRevision: revision }) }, context);
      setRevision(result.revision);
      setDialogOpen(false);
      notify("Acesso concedido e registrado na trilha de auditoria.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível conceder o acesso."); }
    finally { setSubmitting(false); }
  };
  const revoke = async (assignment: Assignment) => {
    if (!context) return;
    try {
      const result = await api<{ revision: string }>(`/role-assignments/${encodeURIComponent(assignment.id)}?expectedRevision=${encodeURIComponent(revision)}`, { method: "DELETE", headers: { "Idempotency-Key": crypto.randomUUID() } }, context);
      setRevision(result.revision);
      notify("Vínculo revogado; o histórico foi preservado.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível revogar o vínculo."); }
  };
  const scopeLabel = (item: AuditItem): string => item.workspaceId ? "Workspace" : item.unitId ? "Unidade" : "Organização";
  return <><PageHeader eyebrow="CONTROLE & EVIDÊNCIA" title="Administração" description="Identidade, capacidades e trilha de auditoria no mesmo contexto." action={canManage ? "Conceder acesso" : undefined} onAction={() => { setError(""); setDialogOpen(true); }} actionDisabled={!canManage || loading} />{error && <StatePanel kind="error" title="Administração indisponível" body={error} action="Tentar novamente" onAction={() => void load()} />}{loading ? <StatePanel kind="loading" title="Lendo autorizações" body="Revalidando pessoas, capabilities e revisão da policy." /> : !canManage ? <StatePanel kind="error" title="Acesso administrativo necessário" body="Seu perfil não pode consultar pessoas, vínculos ou auditoria organizacional." /> : <div className="admin-grid"><section className="surface"><div className="surface-head"><div><span className="eyebrow">PESSOAS COM ACESSO</span><h2>Equipe da organização</h2></div><StatusBadge tone="teal">{users.length} pessoas</StatusBadge></div><div className="admin-users">{users.map((item) => <div className="admin-user" key={item.id}><span className="avatar avatar-small">{initials(item.displayName)}</span><div><strong>{item.displayName}</strong><span>{item.email}</span></div><div className="role-stack">{item.roles.slice(0, 3).map((assignment) => <span key={assignment.id} title={`${assignment.scopeType === "WORKSPACE" ? "Workspace" : "Unidade"} · vínculo ativo`}>{assignment.role}</span>)}</div><div className="admin-user-actions">{item.roles.filter((assignment) => ["recepcao", "veterinario"].includes(assignment.role) && assignment.revokedAt === null && item.id !== actorId).map((assignment) => <button className="text-button" key={`revoke-${assignment.id}`} onClick={() => void revoke(assignment)}>Revogar</button>)}</div><span className="status-dot status-teal" /></div>)}</div></section><section className="surface"><div className="surface-head"><div><span className="eyebrow">CAPABILITY MAP</span><h2>O que está disponível</h2></div><Icon name="lock" size={17} /></div><div className="capability-list">{capabilities.map((item) => <div className="capability-row" key={item.id}><span className={`capability-icon ${item.status === "BLOCKED" ? "blocked" : ""}`}><Icon name={item.status === "BLOCKED" ? "lock" : "check"} size={14} /></span><div><strong>{item.label}</strong><span>{item.status === "BLOCKED" ? "Bloqueado por autoridade/ambiente" : `${item.roles.length} perfis elegíveis`}</span></div><StatusBadge tone={item.status === "BLOCKED" ? "amber" : "teal"}>{item.status === "BLOCKED" ? "Bloqueado" : "Ativo"}</StatusBadge></div>)}</div></section><section className="surface admin-audit"><div className="surface-head"><div><span className="eyebrow">TRILHA RECENTE</span><h2>Auditoria de negócio</h2></div><span className="table-sub">Policy revision {revision}</span></div>{auditRecords.length ? <div className="audit-list">{auditRecords.map((item) => <div className="audit-row" key={item.id}><span className={`audit-result audit-${item.result.toLowerCase()}`} aria-label={`Resultado ${item.result}`}>{item.result === "ALLOWED" ? "✓" : item.result === "DENIED" ? "!" : "·"}</span><div><strong>{item.action}</strong><span>{item.resourceType} · {scopeLabel(item)} · {formatDate(item.createdAt)}</span></div><div className="audit-meta"><span>{item.reason ?? "operação concluída"}</span><small>corr. {item.correlationId.slice(0, 12)}…</small></div></div>)}</div> : <StatePanel kind="empty" title="Nenhum evento recente" body="As decisões administrativas aparecerão aqui após a primeira ação." />}</section></div>}{dialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogOpen(false); }}><section ref={dialogRef} className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="grant-title" aria-describedby="grant-description"><div className="dialog-head"><div><span className="eyebrow">NOVO VÍNCULO</span><h2 id="grant-title">Conceder acesso</h2></div><button className="icon-button" aria-label="Fechar" onClick={() => setDialogOpen(false)}><Icon name="close" size={17} /></button></div><p id="grant-description" className="dialog-description">A concessão fica vinculada à revisão atual e ao workspace selecionado.</p><form onSubmit={grant} className="dialog-form"><label htmlFor="grant-user">Pessoa<select id="grant-user" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} required>{users.filter((item) => item.status === "ACTIVE" && item.id !== actorId).map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.email}</option>)}</select></label><label htmlFor="grant-role">Perfil<select id="grant-role" value={role} onChange={(event) => setRole(event.target.value as "recepcao" | "veterinario")}><option value="recepcao">Recepção</option><option value="veterinario">Veterinário</option></select></label><label htmlFor="grant-scope">Escopo<select id="grant-scope" value={scopeType} onChange={(event) => setScopeType(event.target.value as "UNIT" | "WORKSPACE")}><option value="WORKSPACE">Workspace atual</option><option value="UNIT">Unidade atual</option></select></label><div className="dialog-foot"><span className="table-sub">Policy revision {revision} · mudança auditada</span><button className="button button-ghost" type="button" onClick={() => setDialogOpen(false)}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting || !targetUserId}>{submitting ? "Concedendo…" : "Confirmar acesso"}</button></div></form></section></div>}</>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
