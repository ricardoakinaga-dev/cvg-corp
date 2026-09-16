import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import type { ContextOption } from "../../state/types";

type GuardianRef = { id: string; displayName: string; phone: string };
type Guardian = GuardianRef & { email: string | null; status: string };
type Patient = {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  status: string;
  guardian: GuardianRef | null;
  sex?: string;
  reproductiveStatus?: string;
  birthDate?: string | null;
  identifiers?: string[];
};
type DialogState =
  | { kind: "create" }
  | { kind: "disable"; patient: Patient }
  | { kind: "merge"; patient: Patient }
  | null;

const SEX_LABELS: Record<string, string> = { FEMALE: "Fêmea", MALE: "Macho", UNKNOWN: "Não informado" };
const REPRODUCTIVE_LABELS: Record<string, string> = { INTACT: "Inteiro", NEUTERED: "Castrado", UNKNOWN: "Não informado" };

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
      if (items.length === 0) return;
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
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><section ref={cardRef} className="dialog-card" style={{ maxHeight: "min(88vh, 760px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">JORNADA DE CADASTRO</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

export function Patients({ client, context, notify, initialQuery = "" }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void; initialQuery?: string }) {
  const [items, setItems] = useState<Patient[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [detail, setDetail] = useState<Patient | null>(null);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [receipt, setReceipt] = useState<{ label: string; receiptId: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [guardianMode, setGuardianMode] = useState<"existing" | "new">("existing");
  const [guardianQuery, setGuardianQuery] = useState("");
  const [guardianId, setGuardianId] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [guardianEmail, setGuardianEmail] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientSpecies, setPatientSpecies] = useState("");
  const [patientBreed, setPatientBreed] = useState("");
  const [patientSex, setPatientSex] = useState<"FEMALE" | "MALE" | "UNKNOWN">("UNKNOWN");
  const [patientBirthDate, setPatientBirthDate] = useState("");
  const [patientIdentifier, setPatientIdentifier] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const [mergeConfirmed, setMergeConfirmed] = useState(false);
  const [mergeOptions, setMergeOptions] = useState<Patient[]>([]);
  const submissionKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems((await client.get<{ items: Patient[] }>(`/patients${query ? `?q=${encodeURIComponent(query)}` : ""}`, context)).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Pacientes indisponíveis."); }
    finally { setLoading(false); }
  }, [client, context, query]);

  const loadGuardians = useCallback(async () => {
    try { setGuardians((await client.get<{ items: Guardian[] }>("/guardians", context)).items); }
    catch { setGuardians([]); }
  }, [client, context]);

  const loadMergeOptions = useCallback(async () => {
    try { setMergeOptions((await client.get<{ items: Patient[] }>("/patients", context)).items); }
    catch { setMergeOptions([]); }
  }, [client, context]);

  useEffect(() => { setQuery(initialQuery); }, [initialQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openDialog = (next: Exclude<DialogState, null>) => {
    submissionKey.current = null;
    setFormError("");
    setDialog(next);
    if (next.kind === "create") {
      setGuardianMode("existing");
      setGuardianQuery("");
      setGuardianId("");
      setGuardianName("");
      setGuardianPhone("");
      setGuardianEmail("");
      setPatientName("");
      setPatientSpecies("");
      setPatientBreed("");
      setPatientSex("UNKNOWN");
      setPatientBirthDate("");
      setPatientIdentifier("");
      void loadGuardians();
    }
    if (next.kind === "merge") { setMergeTargetId(""); setMergeReason(""); setMergeConfirmed(false); void loadMergeOptions(); }
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

  const openDetail = async (patientId: string) => {
    setFormError("");
    try {
      const result = await client.get<Patient>(`/patients/${encodeURIComponent(patientId)}`, context);
      setDetail(result);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Ficha indisponível.");
    }
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      let resolvedGuardianId = guardianId;
      let receiptId = "";
      if (guardianMode === "new") {
        const guardianResult = await client.request<{ guardian: Guardian; receiptId: string }>("/guardians", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey() },
          body: JSON.stringify({ displayName: guardianName, phone: guardianPhone, email: guardianEmail.trim() ? guardianEmail.trim() : null })
        }, context);
        resolvedGuardianId = guardianResult.guardian.id;
        receiptId = guardianResult.receiptId;
      }
      const patientResult = await client.request<{ patient: Patient; receiptId: string }>("/patients", {
        method: "POST",
        headers: { "Idempotency-Key": `${idempotencyKey()}:patient` },
        body: JSON.stringify({
          guardianId: resolvedGuardianId,
          name: patientName,
          species: patientSpecies,
          breed: patientBreed.trim() ? patientBreed.trim() : null,
          sex: patientSex,
          reproductiveStatus: "UNKNOWN",
          birthDate: patientBirthDate || null,
          identifiers: patientIdentifier.trim() ? [patientIdentifier.trim()] : []
        })
      }, context);
      setReceipt({ label: `Paciente ${patientResult.patient.name} cadastrado`, receiptId: patientResult.receiptId || receiptId });
      setDialog(null);
      submissionKey.current = null;
      setGuardianId("");
      setGuardianName("");
      setGuardianPhone("");
      setGuardianEmail("");
      setPatientName("");
      setPatientSpecies("");
      setPatientBreed("");
      setPatientSex("UNKNOWN");
      setPatientBirthDate("");
      setPatientIdentifier("");
      await load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Cadastro não concluído.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitDisable = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "disable") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ patient: Patient; receiptId: string }>(`/patients/${encodeURIComponent(dialog.patient.id)}/disable`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() }
      }, context);
      setReceipt({ label: `Cadastro de ${result.patient.name} desativado com histórico preservado`, receiptId: result.receiptId });
      setDialog(null);
      setDetail(null);
      submissionKey.current = null;
      await load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Desativação não concluída.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitMerge = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "merge") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ targetPatient: Patient; sourcePatientId: string; receiptId: string }>("/patients/merge", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ sourcePatientId: dialog.patient.id, targetPatientId: mergeTargetId, reason: mergeReason, confirmation: "MERGE_PATIENTS" })
      }, context);
      setReceipt({ label: `Cadastro mesclado em ${result.targetPatient.name}; origem preservada na trilha`, receiptId: result.receiptId });
      setDialog(null);
      setDetail(null);
      submissionKey.current = null;
      setMergeReason("");
      setMergeConfirmed(false);
      await load();
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Mesclagem não concluída.");
    } finally {
      setSubmitting(false);
    }
  };

  const mergeTargets = dialog?.kind === "merge" ? mergeOptions.filter((patient) => patient.id !== dialog.patient.id) : [];
  const guardianOptions = guardianQuery.trim()
    ? guardians.filter((guardian) => `${guardian.displayName} ${guardian.phone}`.toLowerCase().includes(guardianQuery.trim().toLowerCase()))
    : guardians;

  return (
    <>
      <PageHeader eyebrow="RELAÇÕES EM CUIDADO" title="Pacientes" description="Histórico vivo de pacientes, responsáveis e vínculos de cuidado." action="Novo paciente" onAction={() => openDialog({ kind: "create" })} />
      {receipt && <p className="table-sub" role="status">Recibo {receipt.receiptId} · {receipt.label}</p>}
      <div className="toolbar">
        <label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, espécie ou raça" aria-label="Buscar pacientes" /></label>
        <span className="toolbar-result">{items.length} encontrados</span>
      </div>
      <section className="surface">
        <div className="surface-head"><div><span className="eyebrow">REGISTRO ATIVO</span><h2>Todos os pacientes</h2></div><button className="button button-ghost" type="button" onClick={() => notify("Exportação permanece bloqueada neste ambiente.")}><Icon name="lock" size={14} />Exportar</button></div>
        {loading ? <StatePanel kind="loading" title="Buscando pacientes" body="Aplicando escopo da unidade e classificação de dados." /> : error ? <StatePanel kind="error" title="Busca indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : items.length === 0 ? <StatePanel kind="empty" title="Nenhum paciente encontrado" body={query ? "Tente outro termo de busca." : "O registro ainda está vazio neste contexto."} /> : <div className="patient-list">{items.map((patient) => <div className="patient-list-row" key={patient.id}><span className="patient-avatar">{patient.name.slice(0, 1)}</span><div className="patient-primary"><strong>{patient.name}</strong><span>{patient.species} · {patient.breed ?? "sem raça definida"}</span></div><div className="patient-secondary"><span>Responsável</span><strong>{patient.guardian?.displayName ?? "Não informado"}</strong></div><div className="patient-secondary"><span>Contato</span><strong>{patient.guardian?.phone ?? "—"}</strong></div><StatusBadge tone={patient.status === "ACTIVE" ? "teal" : "slate"}>{patient.status === "ACTIVE" ? "Ativo" : patient.status}</StatusBadge><button className="icon-button row-arrow" type="button" aria-label={`Abrir ficha de ${patient.name}`} onClick={() => void openDetail(patient.id)}><Icon name="arrow" size={16} /></button></div>)}</div>}
      </section>

      {detail && !dialog && <Dialog titleId="patient-detail-title" title={`Ficha de ${detail.name}`} description="Dados do paciente no contexto autorizado; ações destrutivas exigem confirmação explícita." onClose={() => setDetail(null)}>
        <dl className="patient-detail">
          <div><dt>Espécie</dt><dd>{detail.species}</dd></div>
          <div><dt>Raça</dt><dd>{detail.breed ?? "sem raça definida"}</dd></div>
          <div><dt>Sexo</dt><dd>{detail.sex ? SEX_LABELS[detail.sex] ?? detail.sex : "não informado"}</dd></div>
          <div><dt>Reprodução</dt><dd>{detail.reproductiveStatus ? REPRODUCTIVE_LABELS[detail.reproductiveStatus] ?? detail.reproductiveStatus : "não informado"}</dd></div>
          <div><dt>Nascimento</dt><dd>{detail.birthDate ?? "não informado"}</dd></div>
          <div><dt>Identificadores</dt><dd>{detail.identifiers?.length ? detail.identifiers.join(", ") : "nenhum"}</dd></div>
          <div><dt>Responsável</dt><dd>{detail.guardian ? `${detail.guardian.displayName} · ${detail.guardian.phone}` : "não informado"}</dd></div>
          <div><dt>Status</dt><dd>{detail.status}</dd></div>
        </dl>
        <div className="dialog-foot">
          <span className="table-sub">Escopo {context?.unit.name ?? "—"} · histórico preservado</span>
          <button className="button button-ghost" type="button" onClick={() => openDialog({ kind: "disable", patient: detail })}>Desativar cadastro</button>
          <button className="button button-primary" type="button" onClick={() => openDialog({ kind: "merge", patient: detail })}>Mesclar cadastro</button>
        </div>
      </Dialog>}

      {dialog?.kind === "create" && <Dialog titleId="patient-create-title" title="Novo paciente" description="Cadastre o responsável e o paciente na mesma jornada; o recibo é exibido ao final." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitCreate} className="dialog-form">
          <div className="segmented" role="group" aria-label="Origem do responsável">
            <button className={guardianMode === "existing" ? "selected" : undefined} aria-pressed={guardianMode === "existing"} type="button" onClick={() => setGuardianMode("existing")}>Responsável existente</button>
            <button className={guardianMode === "new" ? "selected" : undefined} aria-pressed={guardianMode === "new"} type="button" onClick={() => setGuardianMode("new")}>Novo responsável</button>
          </div>
          {guardianMode === "existing" ? <><label htmlFor="guardian-search">Buscar responsável<input id="guardian-search" value={guardianQuery} onChange={(event) => setGuardianQuery(event.target.value)} placeholder="Nome ou telefone" /></label><label htmlFor="patient-guardian">Responsável<select id="patient-guardian" value={guardianId} onChange={(event) => setGuardianId(event.target.value)} required><option value="">Selecione…</option>{guardianOptions.map((guardian) => <option key={guardian.id} value={guardian.id}>{guardian.displayName} · {guardian.phone}</option>)}</select>{guardianQuery.trim() && guardianOptions.length === 0 && <span className="table-sub">Nenhum responsável corresponde à busca.</span>}</label></> : <>
            <label htmlFor="guardian-name">Nome do responsável<input id="guardian-name" value={guardianName} onChange={(event) => setGuardianName(event.target.value)} required minLength={2} maxLength={120} /></label>
            <label htmlFor="guardian-phone">Telefone<input id="guardian-phone" value={guardianPhone} onChange={(event) => setGuardianPhone(event.target.value)} required minLength={8} maxLength={40} /></label>
            <label htmlFor="guardian-email">E-mail (opcional)<input id="guardian-email" type="email" value={guardianEmail} onChange={(event) => setGuardianEmail(event.target.value)} /></label>
          </>}
          <label htmlFor="patient-name">Nome do paciente<input id="patient-name" value={patientName} onChange={(event) => setPatientName(event.target.value)} required maxLength={120} /></label>
          <label htmlFor="patient-species">Espécie<input id="patient-species" value={patientSpecies} onChange={(event) => setPatientSpecies(event.target.value)} required maxLength={80} /></label>
          <label htmlFor="patient-breed">Raça (opcional)<input id="patient-breed" value={patientBreed} onChange={(event) => setPatientBreed(event.target.value)} maxLength={100} /></label>
          <label htmlFor="patient-sex">Sexo<select id="patient-sex" value={patientSex} onChange={(event) => setPatientSex(event.target.value as typeof patientSex)}><option value="UNKNOWN">Não informado</option><option value="FEMALE">Fêmea</option><option value="MALE">Macho</option></select></label>
          <label htmlFor="patient-birth">Nascimento (opcional)<input id="patient-birth" type="date" value={patientBirthDate} onChange={(event) => setPatientBirthDate(event.target.value)} /></label>
          <label htmlFor="patient-identifier">Microchip/identificador (opcional)<input id="patient-identifier" value={patientIdentifier} onChange={(event) => setPatientIdentifier(event.target.value)} maxLength={80} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Escrita idempotente · auditoria automática</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Cadastrando…" : "Cadastrar paciente"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "disable" && <Dialog titleId="patient-disable-title" title={`Desativar ${dialog.patient.name}`} description="O cadastro sai do registro ativo, mas o histórico clínico e a trilha são preservados. Nada é apagado." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitDisable} className="dialog-form">
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Ação auditada · reversível apenas por novo cadastro/merge autorizado</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Desativando…" : "Confirmar desativação"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "merge" && <Dialog titleId="patient-merge-title" title={`Mesclar ${dialog.patient.name}`} description="O cadastro de origem é preservado na trilha e aponta para o destino; a operação exige motivo e confirmação explícita." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitMerge} className="dialog-form">
          <label htmlFor="merge-target">Cadastro de destino<select id="merge-target" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} required><option value="">Selecione…</option>{mergeTargets.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.species} · {patient.guardian?.displayName ?? "sem responsável"}</option>)}</select></label>
          <label htmlFor="merge-reason">Motivo<textarea id="merge-reason" value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} required minLength={5} maxLength={500} rows={3} /></label>
          <label htmlFor="merge-confirm"><input id="merge-confirm" type="checkbox" checked={mergeConfirmed} onChange={(event) => setMergeConfirmed(event.target.checked)} /> Confirmo que revisei os dois cadastros e o histórico será preservado.</label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Receipt 202 · origem reconciliavel</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting || !mergeConfirmed || !mergeTargetId}>{submitting ? "Mesclando…" : "Confirmar mesclagem"}</button></div>
        </form>
      </Dialog>}
    </>
  );
}
