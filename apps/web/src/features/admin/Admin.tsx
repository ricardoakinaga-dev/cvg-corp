import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate, initials } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type Assignment = { id: string; role: string; scopeType: string; unitId: string | null; workspaceId: string | null; revokedAt: string | null };
type AdminUser = { id: string; displayName: string; email: string; status: string; roles: Assignment[] };
type AuditItem = { id: string; action: string; resourceType: string; result: string; reason: string | null; correlationId: string; unitId: string | null; workspaceId: string | null; createdAt: string };
type Capability = { id: string; label: string; status: string; roles: string[] };

export function Admin({ client, actorId, context, notify, canWrite }: { client: ApiClient; actorId: string; context: ContextOption | null; notify: (message: string) => void; canWrite: boolean }) {
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
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
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const loadInFlightRef = useRef(false);
  const canManage = context?.roles.includes("admin") ?? false;

  const load = useCallback(async () => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    setLoading(true);
    setError("");
    try {
      const cap = await client.get<{ items: Capability[] }>("/capabilities", context);
      setCapabilities(cap.items);
      if (!canManage) {
        setUsers([]);
        setAuditRecords([]);
        return;
      }
      const [userList, auditList] = await Promise.all([client.get<{ items: AdminUser[]; revision: string }>("/users", context), client.get<{ items: AuditItem[] }>("/audit?limit=8", context)]);
      setUsers(userList.items);
      setAuditRecords(auditList.items);
      setRevision(userList.revision);
      setTargetUserId((current) => userList.items.some((item) => item.status === "ACTIVE" && item.id === current && item.id !== actorId) ? current : userList.items.find((item) => item.status === "ACTIVE" && item.id !== actorId)?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Administração indisponível.");
    } finally {
      setLoading(false);
      loadInFlightRef.current = false;
    }
  }, [actorId, canManage, client, context]);

  useEffect(() => { void load(); }, [load]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    window.setTimeout(() => restoreFocusRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button, select, input, textarea, [href]") ?? []).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
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
  }, [closeDialog, dialogOpen]);

  const openDialog = () => {
    setError("");
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDialogOpen(true);
  };

  const grant = async (event: FormEvent) => {
    event.preventDefault();
    if (!context || !targetUserId) return;
    if (!canWrite) {
      notify("Escritas críticas estão bloqueadas enquanto o contexto não estiver ONLINE.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await client.request<{ revision: string }>("/role-assignments", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ userId: targetUserId, role, scopeType, unitId: context.unit.id, workspaceId: scopeType === "WORKSPACE" ? context.workspace.id : null, expectedRevision: revision }) }, context);
      setRevision(result.revision);
      closeDialog();
      notify("Acesso concedido e registrado na trilha de auditoria.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível conceder o acesso.");
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (assignment: Assignment) => {
    if (!context) return;
    if (!canWrite) {
      notify("Escritas críticas estão bloqueadas enquanto o contexto não estiver ONLINE.");
      return;
    }
    try {
      const result = await client.request<{ revision: string }>(`/role-assignments/${encodeURIComponent(assignment.id)}?expectedRevision=${encodeURIComponent(revision)}`, { method: "DELETE", headers: { "Idempotency-Key": crypto.randomUUID() } }, context);
      setRevision(result.revision);
      notify("Vínculo revogado; o histórico foi preservado.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível revogar o vínculo.");
    }
  };

  const scopeLabel = (item: AuditItem): string => item.workspaceId ? "Workspace" : item.unitId ? "Unidade" : "Organização";

  return <><PageHeader eyebrow="CONTROLE & EVIDÊNCIA" title="Administração" description="Identidade, capacidades e trilha de auditoria no mesmo contexto." action={canManage ? "Conceder acesso" : undefined} onAction={openDialog} actionDisabled={!canManage || loading || !canWrite} />{error && <StatePanel kind="error" title="Administração indisponível" body={error} action="Tentar novamente" onAction={() => void load()} />}{loading ? <StatePanel kind="loading" title="Lendo autorizações" body="Revalidando pessoas, capabilities e revisão da policy." /> : !canManage ? <StatePanel kind="error" title="Acesso administrativo necessário" body="Seu perfil não pode consultar pessoas, vínculos ou auditoria organizacional." /> : <div className="admin-grid"><section className="surface"><div className="surface-head"><div><span className="eyebrow">PESSOAS COM ACESSO</span><h2>Equipe da organização</h2></div><StatusBadge tone="teal">{users.length} pessoas</StatusBadge></div><div className="admin-users">{users.map((item) => <div className="admin-user" key={item.id}><span className="avatar avatar-small">{initials(item.displayName)}</span><div><strong>{item.displayName}</strong><span>{item.email}</span></div><div className="role-stack">{item.roles.slice(0, 3).map((assignment) => <span key={assignment.id} title={`${assignment.scopeType === "WORKSPACE" ? "Workspace" : "Unidade"} · vínculo ativo`}>{assignment.role}</span>)}</div><div className="admin-user-actions">{item.roles.filter((assignment) => ["recepcao", "veterinario"].includes(assignment.role) && assignment.revokedAt === null && item.id !== actorId).map((assignment) => <button className="text-button" type="button" key={`revoke-${assignment.id}`} onClick={() => void revoke(assignment)} disabled={!canWrite}>Revogar</button>)}</div><span className="status-dot status-teal" /></div>)}</div></section><section className="surface"><div className="surface-head"><div><span className="eyebrow">CAPABILITY MAP</span><h2>O que está disponível</h2></div><Icon name="lock" size={17} /></div><div className="capability-list">{capabilities.map((item) => <div className="capability-row" key={item.id}><span className={`capability-icon ${item.status === "BLOCKED" ? "blocked" : ""}`}><Icon name={item.status === "BLOCKED" ? "lock" : "check"} size={14} /></span><div><strong>{item.label}</strong><span>{item.status === "BLOCKED" ? "Bloqueado por autoridade/ambiente" : `${item.roles.length} perfis elegíveis`}</span></div><StatusBadge tone={item.status === "BLOCKED" ? "amber" : "teal"}>{item.status === "BLOCKED" ? "Bloqueado" : "Ativo"}</StatusBadge></div>)}</div></section><section className="surface admin-audit"><div className="surface-head"><div><span className="eyebrow">TRILHA RECENTE</span><h2>Auditoria de negócio</h2></div><span className="table-sub">Policy revision {revision}</span></div>{auditRecords.length ? <div className="audit-list">{auditRecords.map((item) => <div className="audit-row" key={item.id}><span className={`audit-result audit-${item.result.toLowerCase()}`} aria-label={`Resultado ${item.result}`}>{item.result === "ALLOWED" ? "✓" : item.result === "DENIED" ? "!" : "·"}</span><div><strong>{item.action}</strong><span>{item.resourceType} · {scopeLabel(item)} · {formatDate(item.createdAt)}</span></div><div className="audit-meta"><span>{item.reason ?? "operação concluída"}</span><small>corr. {item.correlationId.slice(0, 12)}…</small></div></div>)}</div> : <StatePanel kind="empty" title="Nenhum evento recente" body="As decisões administrativas aparecerão aqui após a primeira ação." />}</section></div>}{dialogOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}><section ref={dialogRef} className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="grant-title" aria-describedby="grant-description"><div className="dialog-head"><div><span className="eyebrow">NOVO VÍNCULO</span><h2 id="grant-title">Conceder acesso</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={closeDialog}><Icon name="close" size={17} /></button></div><p id="grant-description" className="dialog-description">A concessão fica vinculada à revisão atual e ao workspace selecionado.</p><form onSubmit={grant} className="dialog-form"><label htmlFor="grant-user">Pessoa<select id="grant-user" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} required>{users.filter((item) => item.status === "ACTIVE" && item.id !== actorId).map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.email}</option>)}</select></label><label htmlFor="grant-role">Perfil<select id="grant-role" value={role} onChange={(event) => setRole(event.target.value as "recepcao" | "veterinario")}><option value="recepcao">Recepção</option><option value="veterinario">Veterinário</option></select></label><label htmlFor="grant-scope">Escopo<select id="grant-scope" value={scopeType} onChange={(event) => setScopeType(event.target.value as "UNIT" | "WORKSPACE")}><option value="WORKSPACE">Workspace atual</option><option value="UNIT">Unidade atual</option></select></label><div className="dialog-foot"><span className="table-sub">Policy revision {revision} · mudança auditada</span><button className="button button-ghost" type="button" onClick={closeDialog}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting || !targetUserId || !canWrite}>{submitting ? "Concedendo…" : "Confirmar acesso"}</button></div></form></section></div>}</>;
}
