import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function PageHeader({ eyebrow, title, description, action, actionIcon = "plus", onAction, actionDisabled = false }: { eyebrow: string; title: string; description: string; action?: string | undefined; actionIcon?: IconName | undefined; onAction?: (() => void) | undefined; actionDisabled?: boolean | undefined }) {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <button className="button button-primary" type="button" onClick={onAction} disabled={actionDisabled}><Icon name={actionIcon} size={16} />{action}</button>}</div>;
}

export function StatePanel({ kind, title, body, action, onAction }: { kind: "loading" | "empty" | "error"; title: string; body: string; action?: string; onAction?: () => void }) {
  const bodyId = useId();
  return <section className={`state-panel state-${kind}`} data-state={kind} role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined} aria-live={kind === "error" ? "assertive" : kind === "loading" ? "polite" : undefined} aria-atomic={kind !== "empty"} aria-busy={kind === "loading" ? true : undefined}><div className="state-symbol" aria-hidden="true">{kind === "loading" ? <span className="spinner" /> : <Icon name={kind === "error" ? "alert" : "spark"} size={22} />}</div><strong>{title}</strong><p id={bodyId}>{body}</p>{action && <button className="button button-ghost" type="button" onClick={onAction} aria-describedby={bodyId}>{action}</button>}</section>;
}

export function Dialog({ titleId, title, description, eyebrow = "JORNADA", onClose, closeDisabled = false, children }: { titleId: string; title: string; description: string; eyebrow?: string; onClose: () => void; closeDisabled?: boolean; children: ReactNode }) {
  const cardRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = cardRef.current?.querySelector<HTMLElement>("input, select, textarea") ?? cardRef.current?.querySelector<HTMLElement>("button");
    target?.focus();
    return () => {
      if (returnFocusRef.current && document.contains(returnFocusRef.current)) returnFocusRef.current.focus();
    };
  }, []);

  useEffect(() => {
    const focusable = () => Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button, select, input, textarea, [href]") ?? []).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (!cardRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !closeDisabled) onClose();
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={closeOnBackdrop}><section ref={cardRef} className="dialog-card" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">{eyebrow}</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

export function StatusBadge({ children, tone = "teal" }: { children: ReactNode; tone?: "teal" | "amber" | "coral" | "slate" }) {
  return <span className={`status-badge badge-${tone}`}><span className="status-dot" />{children}</span>;
}

export function Kpi({ label, value, meta, tone, icon }: { label: string; value: string; meta: string; tone: string; icon: IconName }) {
  return <article className={`kpi-card kpi-${tone}`}><div className="kpi-top"><span>{label}</span><span className="kpi-icon"><Icon name={icon} size={17} /></span></div><strong>{value}</strong><small>{meta}</small></article>;
}
