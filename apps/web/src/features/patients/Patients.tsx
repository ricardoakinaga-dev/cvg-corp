import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import type { ContextOption } from "../../state/types";

type Patient = { id: string; name: string; species: string; breed: string | null; guardian: { displayName: string; phone: string } | null; status: string };

export function Patients({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Patient[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems((await client.get<{ items: Patient[] }>(`/patients${query ? `?q=${encodeURIComponent(query)}` : ""}`, context)).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Pacientes indisponíveis."); }
    finally { setLoading(false); }
  }, [client, context, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  return <><PageHeader eyebrow="RELAÇÕES EM CUIDADO" title="Pacientes" description="Histórico vivo de pacientes, responsáveis e vínculos de cuidado." action="Novo paciente" onAction={() => notify("Para criar um paciente, cadastre primeiro o responsável.")} /><div className="toolbar"><label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, espécie ou raça" aria-label="Buscar pacientes" /></label><span className="toolbar-result">{items.length} encontrados</span></div><section className="surface"><div className="surface-head"><div><span className="eyebrow">REGISTRO ATIVO</span><h2>Todos os pacientes</h2></div><button className="button button-ghost" type="button" onClick={() => notify("Exportação permanece bloqueada neste ambiente.")}><Icon name="lock" size={14} />Exportar</button></div>{loading ? <StatePanel kind="loading" title="Buscando pacientes" body="Aplicando escopo da unidade e classificação de dados." /> : error ? <StatePanel kind="error" title="Busca indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : items.length === 0 ? <StatePanel kind="empty" title="Nenhum paciente encontrado" body={query ? "Tente outro termo de busca." : "O registro ainda está vazio neste contexto."} /> : <div className="patient-list">{items.map((patient) => <div className="patient-list-row" key={patient.id}><span className="patient-avatar">{patient.name.slice(0, 1)}</span><div className="patient-primary"><strong>{patient.name}</strong><span>{patient.species} · {patient.breed ?? "sem raça definida"}</span></div><div className="patient-secondary"><span>Responsável</span><strong>{patient.guardian?.displayName ?? "Não informado"}</strong></div><div className="patient-secondary"><span>Contato</span><strong>{patient.guardian?.phone ?? "—"}</strong></div><StatusBadge tone="teal">Ativo</StatusBadge><button className="icon-button row-arrow" type="button" aria-label={`Abrir ficha de ${patient.name}`} onClick={() => notify(`Ficha de ${patient.name}: histórico clínico segue protegido por escopo.`)}><Icon name="arrow" size={16} /></button></div>)}</div>}</section></>;
}
