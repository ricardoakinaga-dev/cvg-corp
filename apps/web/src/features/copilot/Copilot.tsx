import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import { Knowledge } from "../knowledge/Knowledge";
import type { ContextOption } from "../../state/types";

type TurnReference = { title: string; source: string };
type TurnProvenance = {
  provider: string;
  engineCommit: string;
  manifestVersion: string;
  profileDigest: string;
  policyRevision: string;
  references: TurnReference[];
  correlationId: string;
};
type AiTurn = { id: string; sessionId: string; prompt: string; response: string | null; status: string; model: string; inputTokens: number; outputTokens: number; references: TurnReference[]; createdAt: string; provenance?: TurnProvenance };
type AiSessionRead = { id: string; purpose: string; createdAt: string; turns: number };
type TurnResult = { session?: { id: string } | null; turn: AiTurn; approval: { id: string; toolName: string } | null; provenance: TurnProvenance | null; receiptId: string };
type Patient = { id: string; name: string; species: string };
type Encounter = { id: string; patientId: string; patient: { name: string } | null };
type CopilotResponse = { text: string; approval: { id: string; toolName: string } | null; quarantined: boolean; status: string; model: string | null; createdAt: string | null; references: TurnReference[]; provenance: TurnProvenance | null; usage: { inputTokens: number; outputTokens: number } | null };

const TURN_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  COMPLETED: { label: "derivado", tone: "teal" },
  QUARANTINED: { label: "quarentena", tone: "amber" },
  DENIED: { label: "negado", tone: "coral" },
  OUTCOME_UNKNOWN: { label: "indeterminado", tone: "amber" },
  RECEIVED: { label: "recebido", tone: "slate" }
};

function provenanceValue(value: string | null | undefined): string {
  return value && value.length ? value : "não informado";
}

function toResponse(result: TurnResult): CopilotResponse {
  return {
    text: result.turn.response ?? "Aguardando uma decisão contextual.",
    approval: result.approval,
    quarantined: result.turn.status === "QUARANTINED",
    status: result.turn.status,
    model: result.turn.model ?? null,
    createdAt: result.turn.createdAt ?? null,
    references: result.turn.references ?? result.provenance?.references ?? [],
    provenance: result.provenance ?? null,
    usage: { inputTokens: result.turn.inputTokens, outputTokens: result.turn.outputTokens }
  };
}

export function Copilot({ client, context, notify, canWrite, prompt, onPromptChange }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void; canWrite: boolean; prompt: string; onPromptChange: (value: string) => void }) {
  const [section, setSection] = useState<"copilot" | "knowledge">("copilot");
  const [purpose, setPurpose] = useState("SUMMARY");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CopilotResponse | null>(null);
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AiSessionRead[]>([]);
  const [history, setHistory] = useState<AiTurn[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [patientId, setPatientId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [replaying, setReplaying] = useState(false);
  const submissionKey = useRef<string | null>(null);
  const approvalKey = useRef<string | null>(null);

  const loadSessions = useCallback(async () => {
    try { setSessions((await client.get<{ items: AiSessionRead[] }>("/ai/sessions", context)).items); }
    catch { setSessions([]); }
  }, [client, context]);

  const loadBindings = useCallback(async () => {
    try {
      const [patientList, encounterList] = await Promise.all([
        client.get<{ items: Patient[] }>("/patients", context).catch(() => ({ items: [] as Patient[] })),
        client.get<{ items: Encounter[] }>("/encounters", context).catch(() => ({ items: [] as Encounter[] }))
      ]);
      setPatients(patientList.items);
      setEncounters(encounterList.items);
    } catch {
      setPatients([]);
      setEncounters([]);
    }
  }, [client, context]);

  useEffect(() => { void loadSessions(); void loadBindings(); }, [loadSessions, loadBindings]);

  const idempotencyKey = (): string => {
    submissionKey.current ??= crypto.randomUUID();
    return submissionKey.current;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canWrite || !prompt.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await client.request<TurnResult>("/ai/turns", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          prompt,
          purpose,
          patientId: patientId || null,
          encounterId: encounterId || null,
          requestedTool: null,
          approvalId: null,
          resourceId: null,
          idempotencyKey: idempotencyKey()
        })
      }, context);
      submissionKey.current = null;
      setSessionId(result.session?.id ?? result.turn.sessionId ?? null);
      setHistory((current) => [...current, result.turn]);
      setResponse(toResponse(result));
      onPromptChange("");
      await loadSessions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Copiloto indisponível.");
    } finally {
      setLoading(false);
    }
  };

  const approve = async (decision: "allowed-once" | "rejected") => {
    if (!canWrite || !response?.approval) return;
    approvalKey.current ??= crypto.randomUUID();
    try {
      await client.request(`/ai/approvals/${response.approval.id}`, { method: "POST", headers: { "Idempotency-Key": approvalKey.current }, body: JSON.stringify({ decision, reason: decision === "allowed-once" ? "Confirmação explícita no cockpit local" : "Ação não autorizada pelo usuário" }) }, context);
      approvalKey.current = null;
      setResponse({ ...response, approval: null, text: decision === "allowed-once" ? "Aprovação registrada. A execução ainda exige um novo turno explícito para evitar disparo silencioso." : "Ação rejeitada e não executada." });
      await loadSessions();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Aprovação indisponível.");
    }
  };

  const loadHistory = async (targetSessionId: string) => {
    setReplaying(true);
    setError("");
    try {
      const replay = await client.get<{ session: { id: string; purpose: string }; turns: AiTurn[]; digest: string }>(`/ai/sessions/${encodeURIComponent(targetSessionId)}/replay`, context);
      setSessionId(replay.session.id);
      setHistory(replay.turns);
      const last = replay.turns.at(-1);
      setResponse(last ? {
        text: last.response ?? "Turno sem resposta persistida.",
        approval: null,
        quarantined: last.status === "QUARANTINED",
        status: last.status,
        model: last.model ?? null,
        createdAt: last.createdAt ?? null,
        references: last.references ?? [],
        provenance: last.provenance ?? null,
        usage: { inputTokens: last.inputTokens, outputTokens: last.outputTokens }
      } : null);
      notify(`Histórico reconstruído (${replay.turns.length} turno${replay.turns.length === 1 ? "" : "s"})`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Replay indisponível.");
    } finally {
      setReplaying(false);
    }
  };

  const newSession = () => {
    submissionKey.current = null;
    setSessionId(null);
    setHistory([]);
    setResponse(null);
    setError("");
  };

  const turnPresentation = response ? TURN_STATUS[response.status] ?? { label: response.status, tone: "slate" as const } : { label: "recebido", tone: "slate" as const };
  const encounterOptions = encounters.filter((encounter) => !patientId || encounter.patientId === patientId);

  return (
    <>
      <PageHeader eyebrow="INTELIGÊNCIA GOVERNADA" title="Copiloto" description="Contexto mínimo, resposta rastreável e nenhuma ação silenciosa." />
      <div className="segmented" role="group" aria-label="Seção de IA">
        <button className={section === "copilot" ? "selected" : undefined} aria-pressed={section === "copilot"} type="button" onClick={() => setSection("copilot")}>Sessões e turnos</button>
        <button className={section === "knowledge" ? "selected" : undefined} aria-pressed={section === "knowledge"} type="button" onClick={() => setSection("knowledge")}>Conhecimento</button>
      </div>
      {section === "knowledge" ? <section className="surface"><Knowledge client={client} context={context} notify={notify} /></section> : <><div className="copilot-layout">
        <section className="surface composer-surface">
          <div className="composer-head"><div className="copilot-orb small"><Icon name="spark" size={17} /></div><div><span className="eyebrow">SESSÃO {sessionId ? sessionId.slice(0, 8) : "NOVA"}</span><h2>Qual é o próximo foco?</h2></div><StatusBadge tone="teal">sem egress</StatusBadge></div>
          <form onSubmit={submit} className="composer-label">
            <label htmlFor="purpose">Finalidade<select id="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} disabled={!canWrite}><option value="SUMMARY">Resumo operacional</option><option value="DRAFT_CLINICAL">Rascunho clínico</option><option value="KNOWLEDGE_QUERY">Buscar fonte aprovada</option><option value="OPERATIONS">Próximo passo operacional</option></select></label>
            <label htmlFor="copilot-patient">Paciente (opcional)<select id="copilot-patient" value={patientId} onChange={(event) => { setPatientId(event.target.value); setEncounterId(""); }} disabled={!canWrite}><option value="">Sem paciente</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.species}</option>)}</select></label>
            <label htmlFor="copilot-encounter">Atendimento (opcional)<select id="copilot-encounter" value={encounterId} onChange={(event) => setEncounterId(event.target.value)} disabled={!canWrite}><option value="">Sem atendimento</option>{encounterOptions.map((encounter) => <option key={encounter.id} value={encounter.id}>{encounter.patient?.name ?? "Atendimento"} · {encounter.id.slice(0, 8)}</option>)}</select></label>
            <label htmlFor="prompt">Pedido<textarea id="prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Ex.: organize os pontos de atenção da fila desta manhã…" rows={5} maxLength={8000} disabled={!canWrite} /></label>
            {error && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</div>}
            <div className="composer-foot"><span className="table-sub">Buffer volátil · sem autoenvio · sessão reutilizada</span><button className="button button-primary" type="submit" disabled={!canWrite || loading || !prompt.trim()}>{loading ? "Processando…" : "Processar turno"}<Icon name="arrow" size={15} /></button></div>
          </form>
          <div className="composer-foot">
            <label className="composer-label" htmlFor="copilot-session" style={{ margin: 0, flex: 1 }}>Retomar sessão<select id="copilot-session" value={sessionId ?? ""} onChange={(event) => { const next = event.target.value; if (next) void loadHistory(next); else newSession(); }} disabled={replaying}><option value="">Nova sessão</option>{sessions.map((session) => <option key={session.id} value={session.id}>{session.id.slice(0, 8)} · {session.purpose} · {session.turns} turno(s)</option>)}</select></label>
            <button className="button button-ghost" type="button" onClick={() => sessionId ? void loadHistory(sessionId) : newSession()} disabled={replaying || !sessionId}>Recarregar histórico</button>
          </div>
        </section>
        <aside className="surface governance-panel">
          <div className="surface-head"><div><span className="eyebrow">GUARDRAILS ATIVOS</span><h2>O que fica protegido</h2></div><Icon name="lock" size={17} /></div>
          <ul className="guardrail-list">
            <li><span><Icon name="check" size={14} /></span><div><strong>Provider local</strong><small>Nenhum conteúdo sai desta máquina.</small></div></li>
            <li><span><Icon name="check" size={14} /></span><div><strong>Rascunho ≠ fato</strong><small>O veterinário assina antes de publicar.</small></div></li>
            <li><span><Icon name="check" size={14} /></span><div><strong>Approval contextual</strong><small>Escritas de impacto pedem confirmação.</small></div></li>
            <li><span><Icon name="check" size={14} /></span><div><strong>Replay verificável</strong><small>Engine, profile e referências ficam registrados.</small></div></li>
          </ul>
          <div className="governance-foot"><span className="status-dot status-amber" /><span>DeepSeek Harness real não está conectado nesta etapa.</span></div>
        </aside>
      </div>
      {response && <section className={`surface copilot-response ${response.quarantined ? "response-quarantined" : ""}`}>
        <div className="surface-head"><div><span className="eyebrow">RESULTADO DO TURNO</span><h2>{response.quarantined ? "Conteúdo retido" : "Resposta para revisão"}</h2></div><StatusBadge tone={turnPresentation.tone}>{turnPresentation.label}</StatusBadge></div>
        <p>{response.text}</p>
        {response.approval && <div className="approval-card"><div className="approval-icon"><Icon name="alert" size={18} /></div><div><strong>Confirmação necessária · {response.approval.toolName}</strong><span>Esta capability não executará nada sem sua decisão explícita.</span></div><button className="button button-dark" type="button" onClick={() => void approve("allowed-once")} disabled={!canWrite}>Permitir uma vez</button><button className="button button-ghost" type="button" onClick={() => void approve("rejected")} disabled={!canWrite}>Negar</button></div>}
        <div className="provenance-row">
          <span><Icon name="check" size={14} />modelo: {provenanceValue(response.model)}</span>
          <span><Icon name="check" size={14} />provider: {provenanceValue(response.provenance?.provider)}</span>
          <span><Icon name="check" size={14} />engine: {provenanceValue(response.provenance?.engineCommit ? response.provenance.engineCommit.slice(0, 12) : null)}</span>
          <span><Icon name="check" size={14} />profile: {provenanceValue(response.provenance?.manifestVersion)} · policy {provenanceValue(response.provenance?.policyRevision)}</span>
          <span><Icon name="check" size={14} />timestamp: {response.createdAt ? formatDate(response.createdAt) : "não informado"}</span>
          <span><Icon name="check" size={14} />fontes: {response.references.length}</span>
          {response.usage && <span><Icon name="check" size={14} />tokens: {response.usage.inputTokens}/{response.usage.outputTokens}</span>}
        </div>
        {response.references.length > 0 && <ul className="provenance-references">{response.references.map((reference) => <li key={`${reference.source}:${reference.title}`}><strong>{reference.title}</strong><span>{reference.source}</span></li>)}</ul>}
      </section>}
      <section className="surface">
        <div className="surface-head"><div><span className="eyebrow">HISTÓRICO DA SESSÃO</span><h2>Turnos reconstruíveis</h2></div><StatusBadge tone="slate">{history.length} turnos</StatusBadge></div>
        {history.length === 0 ? <StatePanel kind="empty" title="Nenhum turno nesta sessão" body="Processe um turno ou retome uma sessão existente; o replay reconstrói a linha do tempo." /> : <div className="audit-list">{history.map((turn) => {
          const presentation = TURN_STATUS[turn.status] ?? { label: turn.status, tone: "slate" as const };
          return <div className="audit-row" key={turn.id}><span className="audit-result" aria-label={`Turno ${presentation.label}`}>•</span><div><strong>{turn.prompt.slice(0, 120)}</strong><span>{turn.response ?? "sem resposta persistida"}</span><span>{turn.model} · {formatDate(turn.createdAt)} · {turn.references?.length ?? 0} referência(s)</span></div><div className="audit-meta"><StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge><small>tokens {turn.inputTokens}/{turn.outputTokens}</small></div></div>;
        })}</div>}
      </section>
      </>}
    </>
  );
}
