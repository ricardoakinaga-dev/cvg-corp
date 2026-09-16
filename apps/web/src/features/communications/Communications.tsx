import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type Message = { id: string; patientId: string | null; channel: string; recipient: string; template: string; body: string; status: string; createdBy: string; createdAt: string; decidedBy: string | null; decidedAt: string | null; approvedBy: string | null; approvedAt: string | null; decisionReason: string | null };
type Patient = { id: string; name: string; species: string };
type DialogState = { kind: "compose" } | { kind: "review"; message: Message } | null;

const MESSAGE_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  APPROVAL_REQUIRED: { label: "Aguardando aprovação", tone: "amber" },
  QUEUED: { label: "Aprovada · na outbox", tone: "teal" },
  APPROVED: { label: "Aprovada · na outbox", tone: "teal" },
  REJECTED: { label: "Rejeitada", tone: "coral" },
  SENT: { label: "Enviada", tone: "teal" },
  FAILED: { label: "Falhou", tone: "coral" }
};

function Dialog({ titleId, title, description, onClose, closeDisabled = false, children }: { titleId: string; title: string; description: string; onClose: () => void; closeDisabled?: boolean; children: ReactNode }) {
  const cardRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = cardRef.current?.querySelector<HTMLElement>("input, select, textarea") ?? cardRef.current?.querySelector<HTMLElement>("button");
    target?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);
  useEffect(() => {
    const focusable = () => Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button, select, input, textarea, [href]") ?? []).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (!closeDisabled) onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (!cardRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDisabled, onClose]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><section ref={cardRef} className="dialog-card" style={{ maxHeight: "min(88vh, 760px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">COMUNICAÇÃO</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

export function Communications({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [receipt, setReceipt] = useState<{ label: string; receiptId: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [channel, setChannel] = useState<"SMS" | "EMAIL" | "WHATSAPP">("SMS");
  const [recipient, setRecipient] = useState("");
  const [template, setTemplate] = useState("");
  const [body, setBody] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const submissionKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [messageList, patientList] = await Promise.all([
        client.get<{ items: Message[] }>("/communications", context),
        client.get<{ items: Patient[] }>("/patients", context)
      ]);
      setMessages(messageList.items);
      setPatients(patientList.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Comunicação indisponível.");
    } finally { setLoading(false); }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);

  const openDialog = (next: Exclude<DialogState, null>) => {
    submissionKey.current = null;
    setFormError("");
    setDialog(next);
    if (next.kind === "compose") { setPatientId(""); setChannel("SMS"); setRecipient(""); setTemplate(""); setBody(""); }
    if (next.kind === "review") setDecisionReason("");
  };

  const closeDialog = () => {
    submissionKey.current = null;
    setFormError("");
    setSubmitting(false);
    setDialog(null);
  };

  const idempotencyKey = (): string => {
    submissionKey.current ??= crypto.randomUUID();
    return submissionKey.current;
  };

  const finish = (label: string, receiptId: string) => {
    setReceipt({ label, receiptId });
    setDialog(null);
    submissionKey.current = null;
    void load();
  };

  const submitCompose = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ message: Message; receiptId: string }>("/communications", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ patientId: patientId || null, channel, recipient, template, body })
      }, context);
      finish(`Mensagem preparada (${MESSAGE_STATUS[result.message.status]?.label ?? result.message.status})`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Mensagem não preparada."); }
    finally { setSubmitting(false); }
  };

  const decide = async (decision: "approved" | "rejected") => {
    if (dialog?.kind !== "review") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ message: Message; receiptId: string; queued: boolean }>(`/communications/${encodeURIComponent(dialog.message.id)}/approve`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ decision, reason: decisionReason.trim() ? decisionReason.trim() : null })
      }, context);
      finish(decision === "approved" ? "Mensagem aprovada e enfileirada na outbox durável" : "Mensagem rejeitada sem envio", result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Decisão não registrada."); }
    finally { setSubmitting(false); }
  };

  const patientName = (id: string | null): string => (id ? patients.find((patient) => patient.id === id)?.name ?? "Paciente" : "sem paciente");

  return (
    <>
      <PageHeader eyebrow="COMUNICAÇÃO GOVERNADA" title="Mensagens e aprovações" description="Mensagens preparadas, aprovadas e enfileiradas com egress explícito e rastreável." action="Preparar mensagem" onAction={() => openDialog({ kind: "compose" })} />
      {receipt && <p className="table-sub" role="status">Recibo {receipt.receiptId} · {receipt.label}</p>}
      <p className="table-sub" role="status">Nenhuma rota envia diretamente: a aprovação por um segundo ator enfileira o efeito na outbox durável; falha permanece explícita.</p>
      {loading ? <StatePanel kind="loading" title="Lendo mensagens" body="Carregando comunicações do escopo autorizado." /> : error ? <StatePanel kind="error" title="Comunicação indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : messages.length === 0 ? <StatePanel kind="empty" title="Nenhuma mensagem" body="Prepare uma mensagem para revisão; nada é enviado sem aprovação independente." /> : <div className="audit-list">{messages.map((message) => {
        const rejectedByDecision = message.status === "FAILED" && Boolean(message.decidedBy) && !message.approvedBy;
        const status = rejectedByDecision ? { label: "Rejeitada", tone: "coral" as const } : MESSAGE_STATUS[message.status] ?? { label: message.status, tone: "slate" as const };
        return <div className="audit-row" key={message.id}><span className="audit-result" aria-label={`Estado ${status.label}`}>{message.status === "QUEUED" || message.status === "SENT" ? "✓" : rejectedByDecision ? "!" : "•"}</span><div><strong>{message.template} · {message.channel}</strong><span>{patientName(message.patientId)} · {message.recipient} · criada {formatDate(message.createdAt)}</span><span>{message.body}</span>{message.decisionReason && <span>Motivo: {message.decisionReason}</span>}</div><div className="audit-meta"><StatusBadge tone={status.tone}>{status.label}</StatusBadge><small>{message.status === "APPROVAL_REQUIRED" ? <button className="text-button" type="button" onClick={() => openDialog({ kind: "review", message })}>Revisar</button> : message.approvedAt ? `aprovada ${formatDate(message.approvedAt)}` : message.decidedAt ? `decidida ${formatDate(message.decidedAt)}` : "sem decisão"}</small></div></div>;
      })}</div>}

      {dialog?.kind === "compose" && <Dialog titleId="comm-compose-title" title="Preparar mensagem" description="A mensagem nasce aguardando aprovação de um segundo ator; nenhuma rota envia diretamente." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitCompose} className="dialog-form">
          <label htmlFor="comm-patient">Paciente (opcional)<select id="comm-patient" value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">Sem paciente</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.species}</option>)}</select></label>
          <label htmlFor="comm-channel">Canal<select id="comm-channel" value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option value="SMS">SMS</option><option value="EMAIL">E-mail</option><option value="WHATSAPP">WhatsApp</option></select></label>
          <label htmlFor="comm-recipient">Destinatário<input id="comm-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} required minLength={5} maxLength={200} /></label>
          <label htmlFor="comm-template">Modelo<input id="comm-template" value={template} onChange={(event) => setTemplate(event.target.value)} required minLength={2} maxLength={120} /></label>
          <label htmlFor="comm-body">Conteúdo<textarea id="comm-body" value={body} onChange={(event) => setBody(event.target.value)} required rows={5} maxLength={4000} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Escrita idempotente · auditada</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Preparando…" : "Preparar mensagem"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "review" && <Dialog titleId="comm-review-title" title={`Revisar · ${dialog.message.template}`} description="Aprovar exige um segundo ator autorizado e persistência durável; negar encerra sem envio. Nenhuma rota dispara egress direto." onClose={closeDialog} closeDisabled={submitting}>
        <div className="dialog-form">
          <p className="table-sub">Para {dialog.message.recipient} via {dialog.message.channel}</p>
          <p>{dialog.message.body}</p>
          <label htmlFor="comm-reason">Motivo da decisão<input id="comm-reason" value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} maxLength={300} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Aprovação independente · outbox durável</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-ghost" type="button" onClick={() => void decide("rejected")} disabled={submitting}>Negar e não enviar</button><button className="button button-primary" type="button" onClick={() => void decide("approved")} disabled={submitting}>{submitting ? "Registrando…" : "Aprovar e enfileirar"}</button></div>
        </div>
      </Dialog>}
    </>
  );
}
