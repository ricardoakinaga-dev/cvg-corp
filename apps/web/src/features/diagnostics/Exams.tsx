import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type DiagnosticRequest = { id: string; patientId: string; encounterId: string | null; testName: string; priority: string; status: string; requestedBy: string; createdAt: string };
type Specimen = { id: string; requestId: string; patientId: string; label: string; collectedAt: string; status: string };
type DiagnosticResult = { id: string; requestId: string; specimenId: string; patientId: string; value: string; source: string; sourceVersion: string; status: string; createdAt: string };
type Encounter = { id: string; patientId: string; patient: { name: string } | null };
type Patient = { id: string; name: string; species: string };
type DialogState = { kind: "request" } | { kind: "specimen"; request: DiagnosticRequest } | { kind: "result"; request: DiagnosticRequest } | null;

const REQUEST_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  REQUESTED: { label: "Solicitado", tone: "slate" },
  SPECIMEN_COLLECTED: { label: "Amostra coletada", tone: "amber" },
  RESULTED: { label: "Resultado registrado", tone: "amber" },
  REVIEWED: { label: "Revisado", tone: "teal" },
  CANCELLED: { label: "Cancelado", tone: "coral" }
};
const RESULT_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  RECEIVED: { label: "Recebido", tone: "amber" },
  VALID: { label: "Válido", tone: "teal" },
  QUARANTINED: { label: "Quarentena", tone: "coral" },
  REJECTED: { label: "Rejeitado", tone: "coral" }
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
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><section ref={cardRef} className="dialog-card" style={{ maxHeight: "min(88vh, 760px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">EXAMES</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

export function Exams({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [requests, setRequests] = useState<DiagnosticRequest[]>([]);
  const [specimens, setSpecimens] = useState<Specimen[]>([]);
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [receipt, setReceipt] = useState<{ label: string; receiptId: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [testName, setTestName] = useState("");
  const [priority, setPriority] = useState<"ROUTINE" | "URGENT" | "STAT">("ROUTINE");
  const [specimenLabel, setSpecimenLabel] = useState("");
  const [specimenId, setSpecimenId] = useState("");
  const [resultValue, setResultValue] = useState("");
  const [resultSource, setResultSource] = useState("laboratório autorizado");
  const [resultVersion, setResultVersion] = useState("synthetic-1");
  const submissionKey = useRef<string | null>(null);
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const [requestList, specimenList, resultList, patientList, encounterList] = await Promise.all([
        client.get<{ items: DiagnosticRequest[] }>("/diagnostics/requests", context),
        client.get<{ items: Specimen[] }>("/diagnostics/specimens", context),
        client.get<{ items: DiagnosticResult[] }>("/diagnostics/results", context),
        client.get<{ items: Patient[] }>("/patients", context),
        client.get<{ items: Encounter[] }>("/encounters", context)
      ]);
      if (requestId !== loadRequestRef.current) return;
      setRequests(requestList.items);
      setSpecimens(specimenList.items);
      setResults(resultList.items);
      setPatients(patientList.items);
      setEncounters(encounterList.items);
    } catch (reason) {
      if (requestId === loadRequestRef.current) setError(reason instanceof Error ? reason.message : "Diagnóstico indisponível.");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);

  const openDialog = (next: Exclude<DialogState, null>) => {
    submissionKey.current = null;
    setFormError("");
    setDialog(next);
    if (next.kind === "request") { setPatientId(""); setEncounterId(""); setTestName(""); setPriority("ROUTINE"); }
    if (next.kind === "specimen") setSpecimenLabel("");
    if (next.kind === "result") {
      const firstSpecimen = specimens.find((specimen) => specimen.requestId === next.request.id);
      setSpecimenId(firstSpecimen?.id ?? "");
      setResultValue("");
      setResultSource("laboratório autorizado");
      setResultVersion("synthetic-1");
    }
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

  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!encounterId) { setFormError("Selecione o atendimento vinculado ao pedido."); return; }
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ request: DiagnosticRequest; receiptId: string }>("/diagnostics/requests", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ patientId, encounterId, testName, priority })
      }, context);
      finish(`Pedido ${result.request.testName} criado`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Pedido não criado."); }
    finally { setSubmitting(false); }
  };

  const submitSpecimen = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "specimen") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ specimen: Specimen; receiptId: string }>(`/diagnostics/requests/${encodeURIComponent(dialog.request.id)}/specimens`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ label: specimenLabel })
      }, context);
      finish(`Amostra ${result.specimen.label} registrada`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Amostra não registrada."); }
    finally { setSubmitting(false); }
  };

  const submitResult = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "result") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ result: DiagnosticResult; receiptId: string }>("/diagnostics/results", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ requestId: dialog.request.id, specimenId, value: resultValue, source: resultSource, sourceVersion: resultVersion, externalOrderId: null })
      }, context);
      finish(`Resultado registrado com origem ${result.result.source}`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Resultado não registrado."); }
    finally { setSubmitting(false); }
  };

  const review = async (request: DiagnosticRequest) => {
    submissionKey.current = null;
    try {
      const result = await client.request<{ request: DiagnosticRequest; receiptId: string }>(`/diagnostics/requests/${encodeURIComponent(request.id)}/review`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({})
      }, context);
      setReceipt({ label: `${result.request.testName} revisado`, receiptId: result.receiptId });
      submissionKey.current = null;
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Revisão não concluída.");
    }
  };

  const patientName = (id: string): string => patients.find((patient) => patient.id === id)?.name ?? "Paciente";
  const encounterOptions = encounters.filter((encounter) => !patientId || encounter.patientId === patientId);
  const requestSpecimens = (requestId: string) => specimens.filter((specimen) => specimen.requestId === requestId);
  const requestResults = (requestId: string) => results.filter((result) => result.requestId === requestId);

  return (
    <>
      <PageHeader eyebrow="DIAGNÓSTICO" title="Pedidos, amostras e resultados" description="Pedidos, amostras e resultados vinculados ao atendimento e à cadeia de custódia." action="Novo pedido" onAction={() => openDialog({ kind: "request" })} />
      {receipt && <p className="table-sub" role="status">Recibo {receipt.receiptId} · {receipt.label}</p>}
      {loading ? <StatePanel kind="loading" title="Lendo diagnóstico" body="Resolvendo pedidos, amostras e resultados do escopo." /> : error ? <StatePanel kind="error" title="Diagnóstico indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : requests.length === 0 ? <StatePanel kind="empty" title="Nenhum pedido de exame" body="Crie um pedido vinculado a um atendimento para começar a cadeia." /> : <div className="audit-list">{requests.map((request) => {
        const status = REQUEST_STATUS[request.status] ?? { label: request.status, tone: "slate" as const };
        const requestSpecimenList = requestSpecimens(request.id);
        const requestResultList = requestResults(request.id);
        return <div className="audit-row" key={request.id}>
          <span className="audit-result" aria-label={`Estado ${status.label}`}>{request.status === "REVIEWED" ? "✓" : "•"}</span>
          <div>
            <strong>{request.testName}</strong>
            <span>{patientName(request.patientId)} · {request.priority} · {formatDate(request.createdAt)}</span>
            {requestSpecimenList.length > 0 && <span>Amostras: {requestSpecimenList.map((specimen) => specimen.label).join(", ")}</span>}
            {requestResultList.map((result) => <span key={result.id}>Resultado: {result.value} · {result.source} v{result.sourceVersion} · {RESULT_STATUS[result.status]?.label ?? result.status}</span>)}
          </div>
          <div className="audit-meta">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            <div className="audit-actions">
              {(request.status === "REQUESTED" || request.status === "SPECIMEN_COLLECTED" || request.status === "RESULTED") && <button className="text-button" type="button" onClick={() => openDialog({ kind: "specimen", request })}>Registrar amostra</button>}
              {(request.status === "SPECIMEN_COLLECTED" || request.status === "RESULTED") && <button className="text-button" type="button" onClick={() => openDialog({ kind: "result", request })}>Registrar resultado</button>}
              {request.status === "RESULTED" && <button className="text-button" type="button" onClick={() => void review(request)}>Revisar</button>}
            </div>
          </div>
        </div>;
      })}</div>}

      {dialog?.kind === "request" && <Dialog titleId="exam-request-title" title="Novo pedido de exame" description="O pedido exige paciente e atendimento vinculados; a amostra e o resultado herdam esse vínculo." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitRequest} className="dialog-form">
          <label htmlFor="exam-patient">Paciente<select id="exam-patient" value={patientId} onChange={(event) => { setPatientId(event.target.value); setEncounterId(""); }} required><option value="">Selecione…</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.species}</option>)}</select></label>
          <label htmlFor="exam-encounter">Atendimento<select id="exam-encounter" value={encounterId} onChange={(event) => setEncounterId(event.target.value)} required><option value="">Selecione…</option>{encounterOptions.map((encounter) => <option key={encounter.id} value={encounter.id}>{encounter.patient?.name ?? "Atendimento"} · {encounter.id.slice(0, 8)}</option>)}</select></label>
          <label htmlFor="exam-name">Exame<input id="exam-name" value={testName} onChange={(event) => setTestName(event.target.value)} required minLength={2} maxLength={180} /></label>
          <label htmlFor="exam-priority">Prioridade<select id="exam-priority" value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="ROUTINE">Rotina</option><option value="URGENT">Urgente</option><option value="STAT">Imediato</option></select></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Escrita idempotente · auditada</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Criando…" : "Criar pedido"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "specimen" && <Dialog titleId="exam-specimen-title" title={`Amostra de ${dialog.request.testName}`} description="A amostra precisa pertencer ao pedido e ao paciente; incompatibilidades são quarentenadas pelo servidor." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitSpecimen} className="dialog-form">
          <label htmlFor="exam-specimen-label">Identificador da amostra<input id="exam-specimen-label" value={specimenLabel} onChange={(event) => setSpecimenLabel(event.target.value)} required minLength={2} maxLength={160} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Cadeia de custódia registrada na trilha</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar amostra"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "result" && <Dialog titleId="exam-result-title" title={`Resultado de ${dialog.request.testName}`} description="Resultado duplicado da mesma fonte/versão ou vínculo inválido é negado/quarentenado; a revisão humana é obrigatória." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitResult} className="dialog-form">
          <label htmlFor="exam-result-specimen">Amostra<select id="exam-result-specimen" value={specimenId} onChange={(event) => setSpecimenId(event.target.value)} required><option value="">Selecione…</option>{requestSpecimens(dialog.request.id).map((specimen) => <option key={specimen.id} value={specimen.id}>{specimen.label}</option>)}</select></label>
          <label htmlFor="exam-result-value">Resultado<input id="exam-result-value" value={resultValue} onChange={(event) => setResultValue(event.target.value)} required maxLength={2000} /></label>
          <label htmlFor="exam-result-source">Fonte<input id="exam-result-source" value={resultSource} onChange={(event) => setResultSource(event.target.value)} required maxLength={160} /></label>
          <label htmlFor="exam-result-version">Versão da fonte<input id="exam-result-version" value={resultVersion} onChange={(event) => setResultVersion(event.target.value)} required maxLength={80} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Origem e versão preservadas no resultado</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar resultado"}</button></div>
        </form>
      </Dialog>}
    </>
  );
}
