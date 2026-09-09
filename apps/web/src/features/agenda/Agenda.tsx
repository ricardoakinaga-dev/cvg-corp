import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type Appointment = { id: string; startsAt: string; endsAt: string; purpose: string; status: string; patient: { name: string } | null; provider: string | null };
type QueueItem = { id: string; checkedInAt: string; priority: string; status: string; patient: { name: string } | null };
type AgendaMode = "today" | "week" | "queue";

export function Agenda({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Appointment[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<AgendaMode>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
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

  const periodLabel = mode === "today" ? "08 SET · UNIDADE CENTRO" : mode === "week" ? "08–15 SET · UNIDADE CENTRO" : "ATENDIMENTO EM FILA · UNIDADE CENTRO";
  const heading = mode === "today" ? "Terça-feira" : mode === "week" ? "Próximos 7 dias" : "Fila de atendimento";
  const count = mode === "queue" ? queue.length : items.length;
  return <><PageHeader eyebrow="CAPACIDADE & FLUXO" title="Agenda" description="O que precisa acontecer, na hora certa e no lugar certo." action="Novo horário" onAction={() => notify("A criação de horário será aberta após selecionar um serviço.")} /><div className="toolbar"><div className="segmented" role="group" aria-label="Período da agenda"><button className={mode === "today" ? "selected" : undefined} aria-pressed={mode === "today"} type="button" onClick={() => setMode("today")}>Hoje</button><button className={mode === "week" ? "selected" : undefined} aria-pressed={mode === "week"} type="button" onClick={() => setMode("week")}>Próximos 7 dias</button><button className={mode === "queue" ? "selected" : undefined} aria-pressed={mode === "queue"} type="button" onClick={() => setMode("queue")}>Visão de fila</button></div><button className="button button-ghost" type="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" size={15} />Atualizar</button></div><section className="surface agenda-surface"><div className="surface-head"><div><span className="eyebrow">{periodLabel}</span><h2>{heading}</h2></div><StatusBadge tone="teal">{count} {mode === "queue" ? "na fila" : "janelas"}</StatusBadge></div>{loading ? <StatePanel kind="loading" title="Abrindo a agenda" body="Carregando slots autorizados." /> : error ? <StatePanel kind="error" title="Não foi possível abrir a agenda" body={error} action="Tentar novamente" onAction={() => void load()} /> : mode === "queue" ? queue.length === 0 ? <StatePanel kind="empty" title="Fila vazia" body="Nenhum paciente aguardando atendimento neste contexto." /> : <div className="agenda-table-wrap"><table className="data-table"><caption className="sr-only">Pacientes na fila</caption><thead><tr><th>Entrada</th><th>Paciente</th><th>Prioridade</th><th>Status</th></tr></thead><tbody>{queue.map((item) => <tr key={item.id}><td><strong>{formatDate(item.checkedInAt)}</strong></td><td><div className="table-person"><span className="patient-avatar mini">{item.patient?.name.slice(0, 1) ?? "?"}</span><strong>{item.patient?.name ?? "Paciente"}</strong></div></td><td><StatusBadge tone={item.priority === "URGENT" ? "coral" : "amber"}>{item.priority === "URGENT" ? "Prioridade" : item.priority}</StatusBadge></td><td>{item.status === "WAITING" ? "Aguardando" : item.status}</td></tr>)}</tbody></table></div> : items.length === 0 ? <StatePanel kind="empty" title="Nenhuma janela encontrada" body="Ajuste o período ou cadastre um serviço para começar." /> : <div className="agenda-table-wrap"><table className="data-table"><caption className="sr-only">Atendimentos agendados</caption><thead><tr><th>Horário</th><th>Paciente</th><th>Motivo</th><th>Responsável</th><th>Status</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{formatDate(item.startsAt)}</strong><span className="table-sub">até {new Date(item.endsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></td><td><div className="table-person"><span className="patient-avatar mini">{item.patient?.name.slice(0, 1) ?? "?"}</span><span><strong>{item.patient?.name ?? "Paciente"}</strong><span className="table-sub agenda-mobile-meta">{item.purpose} · {item.provider ?? "Equipe"}</span></span></div></td><td>{item.purpose}</td><td>{item.provider ?? "Equipe"}</td><td><StatusBadge tone={item.status === "CONFIRMED" ? "teal" : item.status === "CANCELLED" ? "coral" : "slate"}>{item.status === "CONFIRMED" ? "Confirmado" : item.status === "CANCELLED" ? "Cancelado" : "Agendado"}</StatusBadge></td><td><button className="icon-button row-arrow" type="button" aria-label="Abrir item" onClick={() => notify("Detalhes do atendimento em preparação.")}><Icon name="arrow" size={15} /></button></td></tr>)}</tbody></table></div>}</section></>;
}
