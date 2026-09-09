import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type Encounter = { id: string; patient: { name: string } | null; chiefComplaint: string; urgency: string; status: string; openedAt: string };

export function Clinical({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems((await client.get<{ items: Encounter[] }>("/encounters", context)).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Atendimento indisponível."); }
    finally { setLoading(false); }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);

  return <><PageHeader eyebrow="CUIDADO CLÍNICO" title="Atendimento" description="Da triagem à assinatura, cada fato tem autoria e contexto." action="Abrir atendimento" onAction={() => notify("Novo atendimento exige paciente e contexto clínico.")} /><section className="clinical-hero"><div className="clinical-hero-copy"><span className="eyebrow">CAMINHO MANUAL DISPONÍVEL</span><h2>O copiloto sugere.<br /><em>O veterinário decide.</em></h2><p>Rascunhos de IA nunca entram no prontuário sem revisão e assinatura explícitas.</p><button className="button button-dark" type="button" onClick={() => notify("O caminho manual continua disponível mesmo com o copiloto desligado.")}>Ver protocolo <Icon name="arrow" size={15} /></button></div><div className="clinical-hero-mark"><Icon name="stethoscope" size={54} /><span>D3<br />SENSÍVEL</span></div></section><section className="surface"><div className="surface-head"><div><span className="eyebrow">EPISÓDIOS ABERTOS</span><h2>Atendimentos em andamento</h2></div><StatusBadge tone="coral">revisão humana</StatusBadge></div>{loading ? <StatePanel kind="loading" title="Lendo atendimentos" body="Resolvendo escopo clínico." /> : error ? <StatePanel kind="error" title="Atendimentos indisponíveis" body={error} action="Tentar novamente" onAction={() => void load()} /> : items.length ? <div className="encounter-grid">{items.map((item) => <article className="encounter-card" key={item.id}><div className="encounter-top"><span className="patient-avatar mini">{item.patient?.name.slice(0, 1) ?? "?"}</span><StatusBadge tone={item.urgency === "EMERGENCY" ? "coral" : item.urgency === "URGENT" ? "amber" : "teal"}>{item.urgency === "URGENT" ? "Prioridade" : item.urgency === "EMERGENCY" ? "Emergência" : "Rotina"}</StatusBadge></div><h3>{item.patient?.name ?? "Paciente"}</h3><p>{item.chiefComplaint}</p><span className="table-sub">Aberto em {formatDate(item.openedAt)}</span><button className="text-button" type="button" onClick={() => notify("A ficha clínica exige role veterinário no escopo atual.")}>Abrir ficha <Icon name="arrow" size={14} /></button></article>)}</div> : <StatePanel kind="empty" title="Nenhum atendimento aberto" body="A fila clínica está limpa neste workspace." />}</section></>;
}
