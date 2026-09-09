import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type Appointment = { id: string; startsAt: string; endsAt: string; purpose: string; status: string; patient: { name: string } | null; provider: string | null };

export function Agenda({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setItems((await client.get<{ items: Appointment[] }>("/appointments", context)).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Agenda indisponível."); }
    finally { setLoading(false); }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);

  return <><PageHeader eyebrow="CAPACIDADE & FLUXO" title="Agenda" description="O que precisa acontecer, na hora certa e no lugar certo." action="Novo horário" onAction={() => notify("A criação de horário será aberta após selecionar um serviço.")} /><div className="toolbar"><div className="segmented"><button className="selected" type="button">Hoje</button><button type="button">Próximos 7 dias</button><button type="button">Visão de fila</button></div><button className="button button-ghost" type="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={15} />Atualizar</button></div><section className="surface agenda-surface"><div className="surface-head"><div><span className="eyebrow">08 SET · UNIDADE CENTRO</span><h2>Terça-feira</h2></div><StatusBadge tone="teal">{items.length} janelas</StatusBadge></div>{loading ? <StatePanel kind="loading" title="Abrindo a agenda" body="Carregando slots autorizados." /> : error ? <StatePanel kind="error" title="Não foi possível abrir a agenda" body={error} action="Tentar novamente" onAction={() => void load()} /> : items.length === 0 ? <StatePanel kind="empty" title="Nenhuma janela encontrada" body="Ajuste o período ou cadastre um serviço para começar." /> : <div className="agenda-table-wrap"><table className="data-table"><caption className="sr-only">Atendimentos agendados</caption><thead><tr><th>Horário</th><th>Paciente</th><th>Motivo</th><th>Responsável</th><th>Status</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{formatDate(item.startsAt)}</strong><span className="table-sub">até {new Date(item.endsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></td><td><div className="table-person"><span className="patient-avatar mini">{item.patient?.name.slice(0, 1) ?? "?"}</span><span><strong>{item.patient?.name ?? "Paciente"}</strong><span className="table-sub agenda-mobile-meta">{item.purpose} · {item.provider ?? "Equipe"}</span></span></div></td><td>{item.purpose}</td><td>{item.provider ?? "Equipe"}</td><td><StatusBadge tone={item.status === "CONFIRMED" ? "teal" : item.status === "CANCELLED" ? "coral" : "slate"}>{item.status === "CONFIRMED" ? "Confirmado" : item.status === "CANCELLED" ? "Cancelado" : "Agendado"}</StatusBadge></td><td><button className="icon-button row-arrow" type="button" aria-label="Abrir item" onClick={() => notify("Detalhes do atendimento em preparação.")}><Icon name="arrow" size={15} /></button></td></tr>)}</tbody></table></div>}</section></>;
}
