import { useState } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatusBadge } from "../../components/ui";
import type { ContextOption } from "../../state/types";

type CopilotResponse = { text: string; approval: { id: string; toolName: string } | null; quarantined: boolean };

export function Copilot({ client, context, notify, canWrite, prompt, onPromptChange }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void; canWrite: boolean; prompt: string; onPromptChange: (value: string) => void }) {
  const [purpose, setPurpose] = useState("SUMMARY");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CopilotResponse | null>(null);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!canWrite || !prompt.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await client.request<{ turn: { response: string | null; status: string }; approval: { id: string; toolName: string } | null }>("/ai/turns", { method: "POST", body: JSON.stringify({ sessionId: null, prompt, purpose, patientId: null, encounterId: null, requestedTool: null, idempotencyKey: crypto.randomUUID() }) }, context);
      setResponse({ text: result.turn.response ?? "Aguardando uma decisão contextual.", approval: result.approval, quarantined: result.turn.status === "QUARANTINED" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Copiloto indisponível.");
    } finally {
      setLoading(false);
    }
  };

  const approve = async (decision: "allowed-once" | "rejected") => {
    if (!canWrite || !response?.approval) return;
    try {
      await client.request(`/ai/approvals/${response.approval.id}`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision, reason: decision === "allowed-once" ? "Confirmação explícita no cockpit local" : "Ação não autorizada pelo usuário" }) }, context);
      setResponse({ ...response, approval: null, text: decision === "allowed-once" ? "Aprovação registrada. A execução ainda exige um novo turno explícito para evitar disparo silencioso." : "Ação rejeitada e não executada." });
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Aprovação indisponível.");
    }
  };

  return <><PageHeader eyebrow="INTELIGÊNCIA GOVERNADA" title="Copiloto" description="Contexto mínimo, resposta rastreável e nenhuma ação silenciosa." /><div className="copilot-layout"><section className="surface composer-surface"><div className="composer-head"><div className="copilot-orb small"><Icon name="spark" size={17} /></div><div><span className="eyebrow">CVG LOCAL STUB</span><h2>Qual é o próximo foco?</h2></div><StatusBadge tone="teal">sem egress</StatusBadge></div><label className="composer-label" htmlFor="purpose">Finalidade<select id="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} disabled={!canWrite}> <option value="SUMMARY">Resumo operacional</option><option value="DRAFT_CLINICAL">Rascunho clínico</option><option value="KNOWLEDGE_QUERY">Buscar fonte aprovada</option><option value="OPERATIONS">Próximo passo operacional</option></select></label><label className="composer-label" htmlFor="prompt">Pedido<textarea id="prompt" value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Ex.: organize os pontos de atenção da fila desta manhã…" rows={6} maxLength={8000} disabled={!canWrite} /></label>{error && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{error}</div>}<div className="composer-foot"><span className="table-sub">Buffer volátil · não persiste rascunho local</span><button className="button button-primary" type="button" onClick={() => void submit()} disabled={!canWrite || loading || !prompt.trim()}>{loading ? "Processando…" : "Processar turno"}<Icon name="arrow" size={15} /></button></div></section><aside className="surface governance-panel"><div className="surface-head"><div><span className="eyebrow">GUARDRAILS ATIVOS</span><h2>O que fica protegido</h2></div><Icon name="lock" size={17} /></div><ul className="guardrail-list"><li><span><Icon name="check" size={14} /></span><div><strong>Provider local</strong><small>Nenhum conteúdo sai desta máquina.</small></div></li><li><span><Icon name="check" size={14} /></span><div><strong>Rascunho ≠ fato</strong><small>O veterinário assina antes de publicar.</small></div></li><li><span><Icon name="check" size={14} /></span><div><strong>Approval contextual</strong><small>Escritas de impacto pedem confirmação.</small></div></li><li><span><Icon name="check" size={14} /></span><div><strong>Replay verificável</strong><small>Engine, profile e referências ficam registrados.</small></div></li></ul><div className="governance-foot"><span className="status-dot status-amber" /><span>DeepSeek Harness real não está conectado nesta etapa.</span></div></aside></div>{response && <section className={`surface copilot-response ${response.quarantined ? "response-quarantined" : ""}`}><div className="surface-head"><div><span className="eyebrow">RESULTADO DO TURNO</span><h2>{response.quarantined ? "Conteúdo retido" : "Resposta para revisão"}</h2></div><StatusBadge tone={response.quarantined ? "amber" : "teal"}>{response.quarantined ? "quarentena" : "derivado"}</StatusBadge></div><p>{response.text}</p>{response.approval && <div className="approval-card"><div className="approval-icon"><Icon name="alert" size={18} /></div><div><strong>Confirmação necessária · {response.approval.toolName}</strong><span>Esta capability não executará nada sem sua decisão explícita.</span></div><button className="button button-dark" type="button" onClick={() => void approve("allowed-once")} disabled={!canWrite}>Permitir uma vez</button><button className="button button-ghost" type="button" onClick={() => void approve("rejected")} disabled={!canWrite}>Negar</button></div>}<div className="provenance-row"><span><Icon name="check" size={14} />local-stub</span><span><Icon name="check" size={14} />profile governado</span><span><Icon name="check" size={14} />auditado</span></div></section>}</>;
}
