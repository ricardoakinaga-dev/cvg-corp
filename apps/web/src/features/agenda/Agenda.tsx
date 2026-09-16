import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type Appointment = { id: string; startsAt: string; endsAt: string; purpose: string; status: string; version: number; patientId: string; providerId: string; resourceId: string | null; serviceId: string; patient: { name: string } | null; provider: string | null };
type QueueItem = { id: string; checkedInAt: string; priority: string; status: string; patient: { name: string } | null };
type SchedulingOptions = {
  providers: Array<{ id: string; displayName: string; specialty: string }>;
  services: Array<{ id: string; name: string; durationMinutes: number; priceCents: number }>;
  resources: Array<{ id: string; name: string; kind: string }>;
};
type AgendaMode = "today" | "week" | "queue";
type DialogState =
  | { kind: "create" }
  | { kind: "confirm"; appointment: Appointment }
  | { kind: "reschedule"; appointment: Appointment }
  | { kind: "cancel"; appointment: Appointment }
  | { kind: "triage"; item: QueueItem }
  | { kind: "handoff"; item: QueueItem }
  | null;

const PRIORITY_LABELS: Record<string, string> = { ROUTINE: "Rotina", URGENT: "Prioridade", EMERGENCY: "Emergência" };

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
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><section ref={cardRef} className="dialog-card" style={{ maxHeight: "min(88vh, 760px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">JORNADA DE AGENDA</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

function formatDayLabel(date: Date): string {
  const day = new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(date);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(date).replace(".", "").toUpperCase();
  return `${day} ${month}`;
}

function weekdayLabel(date: Date): string {
  const name = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(date);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function dateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function windowFromInputs(date: string, time: string, durationMinutes: number): { startsAt: string; endsAt: string } | null {
  const start = new Date(`${date}T${time}:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

export function Agenda({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Appointment[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<AgendaMode>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const [dialog, setDialog] = useState<DialogState>(null);
  const [options, setOptions] = useState<SchedulingOptions | null>(null);
  const [patients, setPatients] = useState<Array<{ id: string; name: string; species: string }>>([]);
  const [receipt, setReceipt] = useState<{ label: string; receiptId: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [date, setDate] = useState(() => dateInputValue(new Date()));
  const [time, setTime] = useState(() => timeInputValue(new Date(Date.now() + 60 * 60_000)));
  const [priority, setPriority] = useState<"ROUTINE" | "URGENT" | "EMERGENCY">("ROUTINE");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [urgency, setUrgency] = useState<"ROUTINE" | "URGENT" | "EMERGENCY">("ROUTINE");
  const [cancelReason, setCancelReason] = useState("");
  const submissionKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setClock(new Date());
    try {
      if (mode === "queue") {
        setQueue((await client.get<{ items: QueueItem[] }>("/queue", context)).items);
        setItems([]);
      } else {
        setItems((await client.get<{ items: Appointment[] }>(`/appointments?range=${mode}`, context)).items);
        setQueue([]);
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Agenda indisponível."); }
    finally { setLoading(false); }
  }, [client, context, mode]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loadOptions = useCallback(async () => {
    try {
      const [scheduling, patientList] = await Promise.all([
        client.get<SchedulingOptions>("/scheduling/options", context),
        client.get<{ items: Array<{ id: string; name: string; species: string }> }>("/patients", context)
      ]);
      setOptions(scheduling);
      setPatients(patientList.items);
    } catch (reason) {
      setOptions(null);
      setFormError(reason instanceof Error ? reason.message : "Recursos de agenda indisponíveis.");
    }
  }, [client, context]);

  const openDialog = (next: Exclude<DialogState, null>) => {
    submissionKey.current = null;
    setFormError("");
    setDialog(next);
    if (next.kind === "create") {
      setPatientId("");
      setServiceId("");
      setProviderId("");
      setResourceId("");
      setPurpose("");
      setDate(dateInputValue(new Date()));
      setTime(timeInputValue(new Date(Date.now() + 60 * 60_000)));
      void loadOptions();
    }
    if (next.kind === "triage") setPriority(next.item.priority as typeof priority);
    if (next.kind === "handoff") { setChiefComplaint(""); setUrgency("ROUTINE"); }
    if (next.kind === "cancel") setCancelReason("");
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

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    const service = options?.services.find((candidate) => candidate.id === serviceId);
    const window = windowFromInputs(date, time, service?.durationMinutes ?? 30);
    if (!window) { setFormError("Data ou horário inválidos."); return; }
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ appointment: Appointment; receiptId: string }>("/appointments", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ patientId, providerId, resourceId: resourceId || null, serviceId, startsAt: window.startsAt, endsAt: window.endsAt, purpose })
      }, context);
      finish(`Reserva de ${result.appointment.id.slice(0, 8)} criada`, result.receiptId);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Reserva não criada.");
    } finally { setSubmitting(false); }
  };

  const submitConfirm = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "confirm") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ appointment: Appointment; receiptId: string }>(`/appointments/${encodeURIComponent(dialog.appointment.id)}/confirm`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ expectedVersion: dialog.appointment.version })
      }, context);
      finish("Reserva confirmada", result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Confirmação não concluída."); }
    finally { setSubmitting(false); }
  };

  const submitReschedule = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "reschedule") return;
    const service = options?.services.find((candidate) => candidate.id === dialog.appointment.serviceId);
    const duration = service?.durationMinutes ?? Math.max(15, Math.round((Date.parse(dialog.appointment.endsAt) - Date.parse(dialog.appointment.startsAt)) / 60_000));
    const window = windowFromInputs(date, time, duration);
    if (!window) { setFormError("Data ou horário inválidos."); return; }
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ appointment: Appointment; receiptId: string }>(`/appointments/${encodeURIComponent(dialog.appointment.id)}/reschedule`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ startsAt: window.startsAt, endsAt: window.endsAt, expectedVersion: dialog.appointment.version })
      }, context);
      finish("Reserva remarcada", result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Remarcação não concluída."); }
    finally { setSubmitting(false); }
  };

  const submitCancel = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "cancel") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ appointment: Appointment; receiptId: string }>(`/appointments/${encodeURIComponent(dialog.appointment.id)}/cancel`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ reason: cancelReason, expectedVersion: dialog.appointment.version })
      }, context);
      finish("Reserva cancelada com motivo registrado", result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Cancelamento não concluído."); }
    finally { setSubmitting(false); }
  };

  const checkIn = async (appointment: Appointment) => {
    submissionKey.current ??= crypto.randomUUID();
    try {
      const result = await client.request<{ queueEntry: QueueItem; receiptId: string }>(`/appointments/${encodeURIComponent(appointment.id)}/check-in`, {
        method: "POST",
        headers: { "Idempotency-Key": submissionKey.current }
      }, context);
      setReceipt({ label: "Check-in registrado na fila", receiptId: result.receiptId });
      submissionKey.current = null;
      await load();
    } catch (reason) { notify(reason instanceof Error ? reason.message : "Check-in não concluído."); }
  };

  const submitTriage = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "triage") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ queueEntry: QueueItem; receiptId: string }>(`/queue/${encodeURIComponent(dialog.item.id)}/triage`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ priority })
      }, context);
      finish(`Triagem registrada como ${PRIORITY_LABELS[priority] ?? priority}`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Triagem não concluída."); }
    finally { setSubmitting(false); }
  };

  const submitHandoff = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "handoff") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ encounter: { id: string }; queueEntry: QueueItem; receiptId: string }>(`/queue/${encodeURIComponent(dialog.item.id)}/handoff`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ chiefComplaint, urgency })
      }, context);
      finish(`Handoff concluído; atendimento ${result.encounter.id.slice(0, 8)} aberto`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Handoff não concluído."); }
    finally { setSubmitting(false); }
  };

  const unitLabel = context ? context.unit.name.toUpperCase() : "SEM UNIDADE";
  const weekEnd = new Date(clock.getTime() + 6 * 86_400_000);
  const periodLabel = mode === "today" ? `${formatDayLabel(clock)} · ${unitLabel}` : mode === "week" ? `${formatDayLabel(clock)}–${formatDayLabel(weekEnd)} · ${unitLabel}` : `ATENDIMENTO EM FILA · ${unitLabel}`;
  const heading = mode === "today" ? weekdayLabel(clock) : mode === "week" ? "Próximos 7 dias" : "Fila de atendimento";
  const count = mode === "queue" ? queue.length : items.length;
  const currentService = options?.services.find((candidate) => candidate.id === serviceId);

  return (
    <>
      <PageHeader eyebrow="CAPACIDADE & FLUXO" title="Agenda" description="O que precisa acontecer, na hora certa e no lugar certo." action="Novo horário" onAction={() => openDialog({ kind: "create" })} />
      {receipt && <p className="table-sub" role="status">Recibo {receipt.receiptId} · {receipt.label}</p>}
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Período da agenda">
          <button className={mode === "today" ? "selected" : undefined} aria-pressed={mode === "today"} type="button" onClick={() => setMode("today")}>Hoje</button>
          <button className={mode === "week" ? "selected" : undefined} aria-pressed={mode === "week"} type="button" onClick={() => setMode("week")}>Próximos 7 dias</button>
          <button className={mode === "queue" ? "selected" : undefined} aria-pressed={mode === "queue"} type="button" onClick={() => setMode("queue")}>Visão de fila</button>
        </div>
        <button className="button button-ghost" type="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={15} />Atualizar</button>
      </div>
      <section className="surface agenda-surface">
        <div className="surface-head"><div><span className="eyebrow">{periodLabel}</span><h2>{heading}</h2></div><StatusBadge tone="teal">{count} {mode === "queue" ? "na fila" : "janelas"}</StatusBadge></div>
        {loading ? <StatePanel kind="loading" title="Abrindo a agenda" body="Carregando slots autorizados." /> : error ? <StatePanel kind="error" title="Não foi possível abrir a agenda" body={error} action="Tentar novamente" onAction={() => void load()} /> : mode === "queue" ? queue.length === 0 ? <StatePanel kind="empty" title="Fila vazia" body="Nenhum paciente aguardando atendimento neste contexto." /> : <div className="agenda-table-wrap"><table className="data-table agenda-queue-table"><caption className="sr-only">Pacientes na fila</caption><thead><tr><th scope="col">Entrada</th><th scope="col">Paciente</th><th scope="col">Prioridade</th><th scope="col">Status</th><th scope="col">Ações</th></tr></thead><tbody>{queue.map((item) => <tr key={item.id}><td><strong>{formatDate(item.checkedInAt)}</strong></td><td><div className="table-person"><span className="patient-avatar mini">{item.patient?.name.slice(0, 1) ?? "?"}</span><strong>{item.patient?.name ?? "Paciente"}</strong></div></td><td><StatusBadge tone={item.priority === "EMERGENCY" ? "coral" : item.priority === "URGENT" ? "amber" : "slate"}>{PRIORITY_LABELS[item.priority] ?? item.priority}</StatusBadge></td><td>{item.status === "WAITING" ? "Aguardando" : item.status === "TRIAGE" ? "Em triagem" : item.status === "IN_SERVICE" ? "Em atendimento" : item.status}</td><td>{item.status === "WAITING" || item.status === "TRIAGE" ? <><button className="text-button" type="button" onClick={() => openDialog({ kind: "triage", item })}>Triagem</button>{" "}<button className="text-button" type="button" onClick={() => openDialog({ kind: "handoff", item })}>Handoff</button></> : null}</td></tr>)}</tbody></table></div> : items.length === 0 ? <StatePanel kind="empty" title="Nenhuma janela encontrada" body="Ajuste o período ou cadastre um serviço para começar." /> : <div className="agenda-table-wrap"><table className="data-table agenda-appointments-table"><caption className="sr-only">Atendimentos agendados</caption><thead><tr><th scope="col">Horário</th><th scope="col">Paciente</th><th scope="col">Motivo</th><th scope="col">Responsável</th><th scope="col">Status</th><th scope="col">Ações</th></tr></thead><tbody>{items.map((item) => {
          const active = item.status === "SCHEDULED" || item.status === "CONFIRMED";
          return <tr key={item.id}><td><strong>{formatDate(item.startsAt)}</strong><span className="table-sub">até {new Date(item.endsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></td><td><div className="table-person"><span className="patient-avatar mini">{item.patient?.name.slice(0, 1) ?? "?"}</span><span><strong>{item.patient?.name ?? "Paciente"}</strong><span className="table-sub agenda-mobile-meta">{item.purpose} · {item.provider ?? "Equipe"}</span></span></div></td><td>{item.purpose}</td><td>{item.provider ?? "Equipe"}</td><td><StatusBadge tone={item.status === "CONFIRMED" ? "teal" : item.status === "CANCELLED" ? "coral" : item.status === "CHECKED_IN" || item.status === "COMPLETED" ? "slate" : "amber"}>{item.status === "CONFIRMED" ? "Confirmado" : item.status === "CANCELLED" ? "Cancelado" : item.status === "CHECKED_IN" ? "Na fila" : item.status === "COMPLETED" ? "Concluído" : "Agendado"}</StatusBadge></td><td>{active ? <><button className="text-button" type="button" onClick={() => openDialog({ kind: "confirm", appointment: item })}>{item.status === "CONFIRMED" ? "Confirmar de novo" : "Confirmar"}</button>{" "}<button className="text-button" type="button" onClick={() => { setDate(dateInputValue(new Date(item.startsAt))); setTime(timeInputValue(new Date(item.startsAt))); openDialog({ kind: "reschedule", appointment: item }); }}>Reagendar</button>{" "}<button className="text-button" type="button" onClick={() => openDialog({ kind: "cancel", appointment: item })}>Cancelar</button>{" "}<button className="text-button" type="button" onClick={() => void checkIn(item)}>Check-in</button></> : null}</td></tr>;
        })}</tbody></table></div>}
      </section>

      {dialog?.kind === "create" && <Dialog titleId="agenda-create-title" title="Novo horário" description="A reserva ocupa profissional e recurso na janela escolhida; conflitos são negados pelo servidor." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitCreate} className="dialog-form">
          <label htmlFor="agenda-patient">Paciente<select id="agenda-patient" value={patientId} onChange={(event) => setPatientId(event.target.value)} required><option value="">Selecione…</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.species}</option>)}</select></label>
          <label htmlFor="agenda-service">Serviço<select id="agenda-service" value={serviceId} onChange={(event) => setServiceId(event.target.value)} required><option value="">Selecione…</option>{(options?.services ?? []).map((service) => <option key={service.id} value={service.id}>{service.name} · {service.durationMinutes} min</option>)}</select></label>
          <label htmlFor="agenda-provider">Profissional<select id="agenda-provider" value={providerId} onChange={(event) => setProviderId(event.target.value)} required><option value="">Selecione…</option>{(options?.providers ?? []).map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName} · {provider.specialty}</option>)}</select></label>
          <label htmlFor="agenda-resource">Recurso (opcional)<select id="agenda-resource" value={resourceId} onChange={(event) => setResourceId(event.target.value)}><option value="">Sem recurso dedicado</option>{(options?.resources ?? []).map((resource) => <option key={resource.id} value={resource.id}>{resource.name} · {resource.kind}</option>)}</select></label>
          <label htmlFor="agenda-date">Data<input id="agenda-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label htmlFor="agenda-time">Início<input id="agenda-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label>
          <label htmlFor="agenda-purpose">Motivo<input id="agenda-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} required minLength={3} maxLength={200} /></label>
          {currentService && <p className="table-sub">Duração do serviço: {currentService.durationMinutes} minutos</p>}
          {!options && !formError && <p className="table-sub" role="status">Carregando recursos autorizados…</p>}
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Escrita idempotente · conflito de janela é 409</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting || !options}>{submitting ? "Reservando…" : "Criar reserva"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "confirm" && <Dialog titleId="agenda-confirm-title" title="Confirmar reserva" description="A confirmação marca a reserva como confirmada e registra o receipt; repetir a mesma chave não duplica." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitConfirm} className="dialog-form">
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">{dialog.appointment.patient?.name ?? "Paciente"} · {formatDate(dialog.appointment.startsAt)}</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Confirmando…" : "Confirmar reserva"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "reschedule" && <Dialog titleId="agenda-reschedule-title" title="Reagendar reserva" description="A nova janela é validada contra profissional e recurso; conflitos são negados com o estado atual preservado." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitReschedule} className="dialog-form">
          <label htmlFor="agenda-reschedule-date">Nova data<input id="agenda-reschedule-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
          <label htmlFor="agenda-reschedule-time">Novo início<input id="agenda-reschedule-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} required /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">{dialog.appointment.patient?.name ?? "Paciente"} · versão {dialog.appointment.version}</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Remarcando…" : "Confirmar nova janela"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "cancel" && <Dialog titleId="agenda-cancel-title" title="Cancelar reserva" description="O cancelamento é auditado com motivo. Se o paciente já estiver em triagem ou atendimento, a fila deve ser concluída antes." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitCancel} className="dialog-form">
          <label htmlFor="agenda-cancel-reason">Motivo<input id="agenda-cancel-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} required minLength={3} maxLength={300} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">{dialog.appointment.patient?.name ?? "Paciente"} · {formatDate(dialog.appointment.startsAt)}</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Voltar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Cancelando…" : "Confirmar cancelamento"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "triage" && <Dialog titleId="agenda-triage-title" title="Triagem" description="A prioridade fica registrada com autoria e pode ser revista enquanto o paciente está na fila." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitTriage} className="dialog-form">
          <label htmlFor="agenda-priority">Prioridade<select id="agenda-priority" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="ROUTINE">Rotina</option><option value="URGENT">Prioridade</option><option value="EMERGENCY">Emergência</option></select></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">{dialog.item.patient?.name ?? "Paciente"} · entrada {formatDate(dialog.item.checkedInAt)}</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar triagem"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "handoff" && <Dialog titleId="agenda-handoff-title" title="Handoff para atendimento" description="Abre o atendimento clínico vinculado à reserva e move a fila para em atendimento; repetir a chave devolve o mesmo atendimento." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitHandoff} className="dialog-form">
          <label htmlFor="agenda-chief">Queixa principal<input id="agenda-chief" value={chiefComplaint} onChange={(event) => setChiefComplaint(event.target.value)} required minLength={3} maxLength={500} /></label>
          <label htmlFor="agenda-urgency">Urgência<select id="agenda-urgency" value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)}><option value="ROUTINE">Rotina</option><option value="URGENT">Prioridade</option><option value="EMERGENCY">Emergência</option></select></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">{dialog.item.patient?.name ?? "Paciente"}</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Abrindo…" : "Abrir atendimento"}</button></div>
        </form>
      </Dialog>}
    </>
  );
}
