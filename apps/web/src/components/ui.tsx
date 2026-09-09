import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function PageHeader({ eyebrow, title, description, action, actionIcon = "plus", onAction, actionDisabled = false }: { eyebrow: string; title: string; description: string; action?: string | undefined; actionIcon?: IconName | undefined; onAction?: (() => void) | undefined; actionDisabled?: boolean | undefined }) {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <button className="button button-primary" type="button" onClick={onAction} disabled={actionDisabled}><Icon name={actionIcon} size={16} />{action}</button>}</div>;
}

export function StatePanel({ kind, title, body, action, onAction }: { kind: "loading" | "empty" | "error"; title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className={`state-panel state-${kind}`} role={kind === "error" ? "alert" : undefined}><div className="state-symbol">{kind === "loading" ? <span className="spinner" /> : <Icon name={kind === "error" ? "alert" : "spark"} size={22} />}</div><strong>{title}</strong><p>{body}</p>{action && <button className="button button-ghost" type="button" onClick={onAction}>{action}</button>}</div>;
}

export function StatusBadge({ children, tone = "teal" }: { children: ReactNode; tone?: "teal" | "amber" | "coral" | "slate" }) {
  return <span className={`status-badge badge-${tone}`}><span className="status-dot" />{children}</span>;
}

export function Kpi({ label, value, meta, tone, icon }: { label: string; value: string; meta: string; tone: string; icon: IconName }) {
  return <article className={`kpi-card kpi-${tone}`}><div className="kpi-top"><span>{label}</span><span className="kpi-icon"><Icon name={icon} size={17} /></span></div><strong>{value}</strong><small>{meta}</small></article>;
}
