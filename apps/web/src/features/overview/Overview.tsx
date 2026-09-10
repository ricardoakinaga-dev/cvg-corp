import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { Kpi, PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatMoney } from "../../state/formatters";
import type { ContextOption, View } from "../../state/types";

type OverviewSummary = { appointmentsToday: number; waitingPatients: number; lowStockItems: number; openCharges: number; ai: { provider: string; tools: number }; unit: string };
type Appointment = { id: string; startsAt: string; purpose: string; status: string; patient: { name: string } | null; provider: string | null };
type Patient = { id: string; name: string; species: string; breed: string | null; guardian: { displayName: string } | null };

function todayLabel(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("weekday").toUpperCase()} · ${value("day")} DE ${value("month").toUpperCase()}`;
}

function appointmentTime(appointment: Appointment | undefined): string {
  if (!appointment) return "sem janela";
  const date = new Date(appointment.startsAt);
  return Number.isNaN(date.getTime()) ? "indisponível" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function Overview({ client, context, onViewChange, notify }: { client: ApiClient; context: ContextOption | null; onViewChange: (view: View) => void; notify: (message: string) => void }) {
  const [summary, setSummary] = useState<OverviewSummary | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const [nextSummary, nextAppointments, nextPatients] = await Promise.all([
        client.get<OverviewSummary>("/operations/summary", context),
        client.get<{ items: Appointment[] }>("/appointments", context),
        client.get<{ items: Patient[] }>("/patients", context)
      ]);
      setSummary(nextSummary);
      setAppointments(nextAppointments.items);
      setPatients(nextPatients.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar a operação.");
    }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);
  const nextAppointment = appointments[0];

  return (
    <>
      <PageHeader eyebrow={todayLabel()} title="Bom dia, Ricardo." description={`Aqui está o pulso da ${context?.unit.name ?? "sua operação"}.`} action="Novo atendimento" onAction={() => onViewChange("agenda")} />
      <section className="signal-strip">
        <div className="signal-strip-main"><span className="signal-strip-icon"><Icon name="spark" size={19} /></span><div><span className="eyebrow">LEITURA DO MOMENTO</span><strong>{summary ? `${summary.waitingPatients} paciente${summary.waitingPatients === 1 ? "" : "s"} aguardando atenção` : "Lendo a operação…"}</strong></div></div>
        <div className="signal-strip-detail"><span className="strip-line" /><span>Próximo atendimento <strong>{appointmentTime(nextAppointment)}</strong></span><button className="text-button" type="button" onClick={() => onViewChange("agenda")}>Ver fila <Icon name="arrow" size={14} /></button></div>
      </section>
      {error ? <StatePanel kind="error" title="A operação está indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : !summary ? <StatePanel kind="loading" title="Preparando seu espaço" body="Conectando aos dados sintéticos da unidade." /> : (
        <>
          <section className="kpi-grid">
            <Kpi label="Hoje na agenda" value={String(summary.appointmentsToday).padStart(2, "0")} meta="Agendamentos no contexto" tone="teal" icon="calendar" />
            <Kpi label="Na fila agora" value={String(summary.waitingPatients).padStart(2, "0")} meta={summary.waitingPatients ? "Fila ativa" : "Sem pacientes aguardando"} tone="coral" icon="paw" />
            <Kpi label="Atenção no estoque" value={String(summary.lowStockItems).padStart(2, "0")} meta={summary.lowStockItems ? "Revisar disponibilidade" : "Sem alertas ativos"} tone="amber" icon="box" />
            <Kpi label="Em aberto" value={formatMoney(summary.openCharges * 22000)} meta="Financeiro · visão da unidade" tone="slate" icon="wallet" />
          </section>
          <div className="dashboard-grid">
            <section className="surface surface-wide">
              <div className="surface-head"><div><span className="eyebrow">FLUXO DE HOJE</span><h2>Próximos atendimentos</h2></div><button className="text-button" type="button" onClick={() => onViewChange("agenda")}>Abrir agenda <Icon name="arrow" size={14} /></button></div>
              {appointments.length ? <div className="appointment-list">{appointments.slice(0, 4).map((appointment, index) => <div className="appointment-row" key={appointment.id}><div className={`time-rail ${index === 0 ? "now" : ""}`}><strong>{appointmentTime(appointment)}</strong><span>{index === 0 ? "próximo" : "em seguida"}</span></div><div className="appointment-avatar">{appointment.patient?.name.slice(0, 1) ?? "?"}</div><div className="appointment-info"><strong>{appointment.patient?.name ?? "Paciente"}</strong><span>{appointment.purpose} · {appointment.provider ?? "Equipe clínica"}</span></div><StatusBadge tone={appointment.status === "CONFIRMED" ? "teal" : "slate"}>{appointment.status === "CONFIRMED" ? "Confirmado" : "Agendado"}</StatusBadge><button className="icon-button row-arrow" type="button" aria-label={`Abrir atendimento de ${appointment.patient?.name ?? "paciente"}`} onClick={() => onViewChange("clinical")}><Icon name="arrow" size={16} /></button></div>)}</div> : <StatePanel kind="empty" title="Agenda livre" body="Nenhum atendimento encontrado para este contexto." action="Abrir agenda" onAction={() => onViewChange("agenda")} />}
            </section>
            <section className="surface copilot-card"><div className="copilot-orb"><Icon name="spark" size={20} /></div><span className="eyebrow">CVG COPILOTO</span><h2>Clareza para o próximo passo.</h2><p>Resuma a fila, organize um rascunho ou encontre uma fonte aprovada — sempre com revisão humana.</p><button className="button button-dark" type="button" onClick={() => onViewChange("copilot")}>Abrir copiloto <Icon name="arrow" size={15} /></button><div className="copilot-foot"><span className="status-dot status-teal" />provider local sintético<span className="divider-dot" />sem envio externo</div></section>
            <section className="surface surface-wide"><div className="surface-head"><div><span className="eyebrow">PACIENTES RECENTES</span><h2>Relações em cuidado</h2></div><button className="text-button" type="button" onClick={() => onViewChange("patients")}>Ver todos <Icon name="arrow" size={14} /></button></div><div className="patient-grid">{patients.slice(0, 4).map((patient) => <button className="patient-card" type="button" key={patient.id} onClick={() => onViewChange("patients")}><span className="patient-avatar">{patient.name.slice(0, 1)}</span><span><strong>{patient.name}</strong><small>{patient.species} · {patient.breed ?? "sem raça"}</small><em>{patient.guardian?.displayName ?? "Responsável não informado"}</em></span><Icon name="arrow" size={15} /></button>)}</div></section>
            <section className="surface insight-card"><div className="insight-top"><span className="eyebrow">PROFILE DO COPILOTO</span><span className="status-badge badge-amber"><span className="status-dot" />sintético</span></div><div className="mini-chart-caption" aria-hidden="true"><span>Atividade recente</span><span>últimas 8 interações</span></div><div className="mini-chart" role="img" aria-label="Atividade recente do Copiloto em oito interações sintéticas"><span className="chart-bar-36" /><span className="chart-bar-48" /><span className="chart-bar-42" /><span className="chart-bar-67" /><span className="chart-bar-58" /><span className="chart-bar-76" /><span className="chart-bar-70" /><span className="chart-bar-88" /></div><div className="insight-number"><strong>{summary.ai.tools}</strong><small>tools governadas no profile</small></div><button className="text-button" type="button" onClick={() => notify("Métricas externas permanecem indisponíveis no ambiente sintético.")}>Ver sinais <Icon name="arrow" size={14} /></button></section>
          </div>
        </>
      )}
    </>
  );
}
