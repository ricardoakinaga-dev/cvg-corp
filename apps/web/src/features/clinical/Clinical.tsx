import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import { Exams } from "../diagnostics/Exams";
import { Internacao } from "../hospital/Internacao";
import { Communications } from "../communications/Communications";
import type { ContextOption } from "../../state/types";

type Encounter = { id: string; patientId: string; patient: { name: string } | null; chiefComplaint: string; urgency: string; status: string; openedAt: string };
type ClinicalDocument = { id: string; encounterId: string; documentType: string; title: string; content?: string; dataClass: string; status: string; version: number; signedAt: string | null; signedBy: string | null; createdAt: string };
type Addendum = { id: string; documentId: string; authorId: string; reason: string; content: string; createdAt: string };
type DialogState =
  | { kind: "create" }
  | { kind: "editor"; document: ClinicalDocument }
  | { kind: "sign"; document: ClinicalDocument }
  | { kind: "addendum"; document: ClinicalDocument }
  | { kind: "attachments" }
  | null;

const DOCUMENT_TYPES: Record<string, string> = { EVOLUTION: "Evolução", TRIAGE: "Triagem", DISCHARGE: "Alta", PRESCRIPTION: "Prescrição", REPORT: "Laudo" };
const DOCUMENT_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  DRAFT: { label: "Rascunho", tone: "slate" },
  REVIEW: { label: "Em revisão", tone: "amber" },
  SIGNED: { label: "Assinado", tone: "teal" },
  PUBLISHED: { label: "Publicado", tone: "teal" }
};

function Dialog({ titleId, title, description, onClose, closeDisabled = false, children }: { titleId: string; title: string; description: string; onClose: () => void; closeDisabled?: boolean; children: ReactNode }) {
  const cardRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusableSelector = "button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href]:not([aria-disabled=\"true\"]), [tabindex]:not([tabindex=\"-1\"])";
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = cardRef.current?.querySelector<HTMLElement>(focusableSelector);
    target?.focus();
    return () => returnFocusRef.current?.focus();
  }, [focusableSelector]);
  useEffect(() => {
    const focusable = () => Array.from(cardRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter((element) => element.getAttribute("aria-hidden") !== "true");
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
  }, [closeDisabled, focusableSelector, onClose]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><section ref={cardRef} className="dialog-card" style={{ maxHeight: "min(88vh, 760px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">PRONTUÁRIO</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

export function Clinical({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [section, setSection] = useState<"chart" | "exams" | "hospital" | "comm">("chart");
  const [items, setItems] = useState<Encounter[]>([]);
  const [documents, setDocuments] = useState<ClinicalDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addenda, setAddenda] = useState<Addendum[]>([]);
  const [addendaError, setAddendaError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [receipt, setReceipt] = useState<{ label: string; receiptId: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [documentType, setDocumentType] = useState("EVOLUTION");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [addendumReason, setAddendumReason] = useState("");
  const [addendumContent, setAddendumContent] = useState("");
  const submissionKey = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const addendaRequestRef = useRef(0);
  const canSign = context?.roles.includes("veterinario") ?? false;

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const [encounters, docs] = await Promise.all([
        client.get<{ items: Encounter[] }>("/encounters", context),
        client.get<{ items: ClinicalDocument[] }>("/clinical/documents", context)
      ]);
      if (requestId !== loadRequestRef.current) return;
      setItems(encounters.items);
      setDocuments(docs.items);
    } catch (reason) {
      if (requestId === loadRequestRef.current) setError(reason instanceof Error ? reason.message : "Atendimento indisponível.");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);

  const loadAddenda = useCallback(async (documentIds: string[]) => {
    const requestId = ++addendaRequestRef.current;
    setAddendaError("");
    if (documentIds.length === 0) { setAddenda([]); return; }
    try {
      const responses = await Promise.all(documentIds.map((documentId) => client.get<{ items: Addendum[] }>(`/clinical/documents/${encodeURIComponent(documentId)}/addenda`, context)));
      if (requestId === addendaRequestRef.current) setAddenda(responses.flatMap((response) => response.items));
    } catch {
      if (requestId === addendaRequestRef.current) setAddendaError("Não foi possível atualizar todos os adendos; mantendo a última leitura válida.");
    }
  }, [client, context]);

  useEffect(() => {
    if (selectedId) void load();
  }, [selectedId, load]);

  useEffect(() => {
    if (!selectedId) { addendaRequestRef.current += 1; setAddendaError(""); setAddenda([]); return; }
    const signedDocuments = documents.filter((document) => document.encounterId === selectedId && (document.status === "SIGNED" || document.status === "PUBLISHED"));
    void loadAddenda(signedDocuments.map((document) => document.id));
  }, [selectedId, documents, loadAddenda]);

  const selectedEncounter = items.find((item) => item.id === selectedId) ?? null;
  const selectedDocuments = documents.filter((document) => document.encounterId === selectedId).sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const openDialog = (next: Exclude<DialogState, null>) => {
    submissionKey.current = null;
    setFormError("");
    setDialog(next);
    if (next.kind === "create") { setDocumentType("EVOLUTION"); setTitle(""); setContent(""); }
    if (next.kind === "editor") { setTitle(next.document.title); setContent(next.document.content ?? ""); }
    if (next.kind === "addendum") { setAddendumReason(""); setAddendumContent(""); }
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

  const openEditor = async (document: ClinicalDocument) => {
    setFormError("");
    try {
      const detail = await client.get<{ document: ClinicalDocument }>(`/clinical/documents/${encodeURIComponent(document.id)}`, context);
      openDialog({ kind: "editor", document: detail.document });
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Documento indisponível.");
    }
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedId) return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ document: ClinicalDocument; receiptId: string }>("/clinical/documents", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ encounterId: selectedId, documentType, title, content, dataClass: "D3" })
      }, context);
      finish(`Rascunho ${result.document.title} criado`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Documento não criado."); }
    finally { setSubmitting(false); }
  };

  const submitEditor = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "editor") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ document: ClinicalDocument; receiptId: string }>(`/clinical/documents/${encodeURIComponent(dialog.document.id)}/update`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ title, content, expectedVersion: String(dialog.document.version) })
      }, context);
      finish(`Rascunho salvo na versão ${result.document.version}`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Edição não salva."); }
    finally { setSubmitting(false); }
  };

  const reviewDocument = async (document: ClinicalDocument) => {
    submissionKey.current = null;
    try {
      const result = await client.request<{ document: ClinicalDocument; receiptId: string }>(`/clinical/documents/${encodeURIComponent(document.id)}/review`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ expectedVersion: String(document.version) })
      }, context);
      setReceipt({ label: `Documento ${result.document.title} marcado para revisão`, receiptId: result.receiptId });
      submissionKey.current = null;
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Revisão não registrada.");
    }
  };

  const submitSign = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "sign") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ document: ClinicalDocument; receiptId: string }>(`/clinical/documents/${encodeURIComponent(dialog.document.id)}/sign`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ expectedVersion: String(dialog.document.version) })
      }, context);
      finish(`Documento ${result.document.title} assinado e imutável`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Assinatura não concluída."); }
    finally { setSubmitting(false); }
  };

  const submitAddendum = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "addendum") return;
    const addendumDocumentId = dialog.document.id;
    const addendumEncounterId = dialog.document.encounterId;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ addendum: Addendum; receiptId: string }>(`/clinical/documents/${encodeURIComponent(dialog.document.id)}/addenda`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ reason: addendumReason, content: addendumContent })
      }, context);
      setReceipt({ label: "Adendo registrado; documento original permanece imutável", receiptId: result.receiptId });
      setDialog(null);
      submissionKey.current = null;
      const signedDocumentIds = documents.filter((document) => document.encounterId === addendumEncounterId && (document.status === "SIGNED" || document.status === "PUBLISHED")).map((document) => document.id);
      if (!signedDocumentIds.includes(addendumDocumentId)) signedDocumentIds.push(addendumDocumentId);
      await loadAddenda(signedDocumentIds);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Adendo não registrado."); }
    finally { setSubmitting(false); }
  };

  return (
    <>
      <PageHeader eyebrow="CUIDADO CLÍNICO" title="Atendimento" description="Da triagem à assinatura, cada fato tem autoria e contexto." action={section === "chart" && selectedEncounter ? "Novo documento" : undefined} onAction={() => openDialog({ kind: "create" })} />
      <div className="segmented" role="group" aria-label="Seção clínica">
        <button className={section === "chart" ? "selected" : undefined} aria-pressed={section === "chart"} type="button" onClick={() => setSection("chart")}>Prontuário</button>
        <button className={section === "exams" ? "selected" : undefined} aria-pressed={section === "exams"} type="button" onClick={() => setSection("exams")}>Exames</button>
        <button className={section === "hospital" ? "selected" : undefined} aria-pressed={section === "hospital"} type="button" onClick={() => setSection("hospital")}>Internação</button>
        <button className={section === "comm" ? "selected" : undefined} aria-pressed={section === "comm"} type="button" onClick={() => setSection("comm")}>Comunicação</button>
      </div>
      {receipt && <p className="table-sub" role="status">Recibo {receipt.receiptId} · {receipt.label}</p>}
      {section === "exams" ? <section className="surface"><Exams client={client} context={context} notify={notify} /></section> : section === "hospital" ? <section className="surface"><Internacao client={client} context={context} notify={notify} /></section> : section === "comm" ? <section className="surface"><Communications client={client} context={context} notify={notify} /></section> : <>
      <section className="clinical-hero">
        <div className="clinical-hero-copy"><span className="eyebrow">CAMINHO MANUAL DISPONÍVEL</span><h2>O copiloto sugere.<br /><em>O veterinário decide.</em></h2><p>Rascunhos de IA nunca entram no prontuário sem revisão e assinatura explícitas. O registro manual continua concluível mesmo sem runtime de IA.</p><button className="button button-dark" type="button" onClick={() => notify("O caminho manual continua disponível mesmo com o copiloto desligado.")}>Ver protocolo <Icon name="arrow" size={15} /></button></div>
        <div className="clinical-hero-mark"><Icon name="stethoscope" size={54} /><span>D3<br />SENSÍVEL</span></div>
      </section>

      {selectedEncounter && <section className="surface">
        <div className="surface-head"><div><span className="eyebrow">LINHA DO TEMPO · {selectedEncounter.patient?.name ?? "PACIENTE"}</span><h2>Documentos do atendimento</h2></div><button className="button button-ghost" type="button" onClick={() => setSelectedId(null)}>Fechar prontuário</button></div>
        {addendaError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{addendaError}</div>}
        {selectedDocuments.length === 0 ? <StatePanel kind="empty" title="Nenhum documento neste atendimento" body="Crie um documento manual; a IA não é necessária para registrar e assinar." /> : <div className="audit-list">{selectedDocuments.map((document) => {
          const status = DOCUMENT_STATUS[document.status] ?? { label: document.status, tone: "slate" as const };
          const signed = document.status === "SIGNED" || document.status === "PUBLISHED";
          return [<div className="audit-row" key={document.id}><span className="audit-result" aria-label={`Estado ${status.label}`}>{signed ? "✓" : document.status === "REVIEW" ? "•" : "·"}</span><div><strong>{document.title}</strong><span>{DOCUMENT_TYPES[document.documentType] ?? document.documentType} · versão {document.version} · {signed && document.signedAt ? `assinado ${formatDate(document.signedAt)}` : "rascunho do autor"}</span></div><div className="audit-meta"><StatusBadge tone={status.tone}>{status.label}</StatusBadge><small>{signed ? <><button className="text-button" type="button" onClick={() => void openEditor(document)}>Ver conteúdo</button>{" "}<button className="text-button" type="button" onClick={() => openDialog({ kind: "addendum", document })}>Adicionar adendo</button></> : <><button className="text-button" type="button" onClick={() => void openEditor(document)}>Abrir editor</button>{" "}{document.status === "DRAFT" && <button className="text-button" type="button" onClick={() => void reviewDocument(document)}>Enviar para revisão</button>}{document.status === "REVIEW" && <button className="text-button" type="button" onClick={() => openDialog({ kind: "sign", document })} disabled={!canSign} aria-describedby={canSign ? undefined : "sign-restriction"}>Assinar</button>}</>}</small></div></div>, ...addenda.filter((addendum) => addendum.documentId === document.id).map((addendum) => <div className="audit-row" key={`addendum-${addendum.id}`}><span className="audit-result audit-allowed" aria-label="Adendo registrado">✓</span><div><strong>Adendo: {addendum.reason}</strong><span>{addendum.content}</span></div><div className="audit-meta"><small>corr. {addendum.id.slice(0, 8)}…</small></div></div>)];
        })}</div>}
        {!canSign && <p className="table-sub" id="sign-restriction">Assinatura exige role veterinário no escopo atual; o administrador revisa, mas não assina.</p>}
        <div className="surface-head"><div><span className="eyebrow">ANEXOS</span><h2>Arquivos do paciente</h2></div><button className="button button-ghost" type="button" onClick={() => openDialog({ kind: "attachments" })}><Icon name="lock" size={14} />Anexar arquivo</button></div>
      </section>}

      <section className="surface">
        <div className="surface-head"><div><span className="eyebrow">EPISÓDIOS ABERTOS</span><h2>Atendimentos em andamento</h2></div><StatusBadge tone="coral">revisão humana</StatusBadge></div>
        {loading ? <StatePanel kind="loading" title="Lendo atendimentos" body="Resolvendo escopo clínico." /> : error ? <StatePanel kind="error" title="Atendimentos indisponíveis" body={error} action="Tentar novamente" onAction={() => void load()} /> : items.length ? <div className="encounter-grid">{items.map((item) => <article className="encounter-card" key={item.id}><div className="encounter-top"><span className="patient-avatar mini">{item.patient?.name.slice(0, 1) ?? "?"}</span><StatusBadge tone={item.urgency === "EMERGENCY" ? "coral" : item.urgency === "URGENT" ? "amber" : "teal"}>{item.urgency === "URGENT" ? "Prioridade" : item.urgency === "EMERGENCY" ? "Emergência" : "Rotina"}</StatusBadge></div><h3>{item.patient?.name ?? "Paciente"}</h3><p>{item.chiefComplaint}</p><span className="table-sub">Aberto em {formatDate(item.openedAt)}</span><button className="text-button" type="button" onClick={() => setSelectedId(item.id)}>Abrir atendimento <Icon name="arrow" size={14} /></button></article>)}</div> : <StatePanel kind="empty" title="Nenhum atendimento aberto" body="A fila clínica está limpa neste workspace." />}
      </section>

      {dialog?.kind === "create" && <Dialog titleId="clinical-create-title" title="Novo documento" description="Registro manual em D3; o documento nasce como rascunho e só vira fato após revisão e assinatura." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitCreate} className="dialog-form">
          <label htmlFor="clinical-type">Tipo<select id="clinical-type" value={documentType} onChange={(event) => setDocumentType(event.target.value)}>{Object.entries(DOCUMENT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label htmlFor="clinical-title">Título<input id="clinical-title" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} maxLength={180} /></label>
          <label htmlFor="clinical-content">Conteúdo clínico<textarea id="clinical-content" value={content} onChange={(event) => setContent(event.target.value)} required rows={8} maxLength={30000} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Escrita idempotente · auditada</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Salvando…" : "Criar rascunho"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "editor" && <Dialog titleId="clinical-editor-title" title={dialog.document.status === "SIGNED" || dialog.document.status === "PUBLISHED" ? "Conteúdo assinado" : "Editor do documento"} description={dialog.document.status === "SIGNED" || dialog.document.status === "PUBLISHED" ? "Documento assinado é imutável; correções exigem adendo." : "Salvar mantém o documento em rascunho e incrementa a versão."} onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitEditor} className="dialog-form">
          <label htmlFor="clinical-edit-title">Título<input id="clinical-edit-title" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} maxLength={180} disabled={dialog.document.status === "SIGNED" || dialog.document.status === "PUBLISHED"} /></label>
          <label htmlFor="clinical-edit-content">Conteúdo clínico<textarea id="clinical-edit-content" value={content} onChange={(event) => setContent(event.target.value)} required rows={8} maxLength={30000} disabled={dialog.document.status === "SIGNED" || dialog.document.status === "PUBLISHED"} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Versão {dialog.document.version} · conflito devolve 409 explícito</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Fechar</button>{(dialog.document.status === "DRAFT" || dialog.document.status === "REVIEW") && <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Salvando…" : "Salvar rascunho"}</button>}</div>
        </form>
      </Dialog>}

      {dialog?.kind === "sign" && <Dialog titleId="clinical-sign-title" title={`Assinar ${dialog.document.title}`} description="A assinatura torna o documento imutável: qualquer correção posterior será um adendo vinculado." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitSign} className="dialog-form">
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Versão {dialog.document.version} · ator autorizado registrado na trilha</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Assinando…" : "Confirmar assinatura"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "addendum" && <Dialog titleId="clinical-addendum-title" title={`Adendo em ${dialog.document.title}`} description="O adendo preserva o original assinado e registra motivo, autor e horário." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitAddendum} className="dialog-form">
          <label htmlFor="clinical-addendum-reason">Motivo<input id="clinical-addendum-reason" value={addendumReason} onChange={(event) => setAddendumReason(event.target.value)} required minLength={5} maxLength={500} /></label>
          <label htmlFor="clinical-addendum-content">Conteúdo<textarea id="clinical-addendum-content" value={addendumContent} onChange={(event) => setAddendumContent(event.target.value)} required rows={6} maxLength={30000} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Somente documento assinado aceita adendo</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar adendo"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "attachments" && <Dialog titleId="clinical-attachments-title" title="Anexos do paciente" description="O armazenamento de binários clínicos depende de decisão de retenção/residência (D-03); o boundary não inventa storage nem grava anexo parcial." onClose={closeDialog}>
        <div className="dialog-form">
          <p className="table-sub" role="status">Anexos bloqueados com razão explícita: retenção/residência e autoridade de storage ainda não decididas (D-03). Nenhum arquivo é aceito, enviado ou gravado neste estado.</p>
          <label htmlFor="clinical-attachment-file">Arquivo<input id="clinical-attachment-file" type="file" disabled /></label>
          <div className="dialog-foot"><span className="table-sub">Gate: AUD13-14A após D-03</span><button className="button button-ghost" type="button" onClick={closeDialog}>Fechar</button><button className="button button-primary" type="button" disabled>Enviar anexo</button></div>
        </div>
      </Dialog>}
    </>}
    </>
  );
}
