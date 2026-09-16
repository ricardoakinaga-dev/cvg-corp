import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import type { ContextOption } from "../../state/types";

type ReportKind = "operation" | "quality" | "cost" | "audit" | "incidents";
type ReportValue = string | number | boolean | null | ReportValue[] | { [key: string]: ReportValue };
type ReportResponse = {
  kind: ReportKind;
  source: {
    boundary: "ReadApplicationService";
    storageMode: "memory" | "postgres";
    generatedAt: string;
    filters: { kind: string; from: string | null; to: string | null; limit: number };
    bounded: true;
  };
  report: Record<string, ReportValue>;
};

const kinds: Array<{ value: ReportKind; label: string; description: string }> = [
  { value: "operation", label: "Operação", description: "Agenda, fila, estoque, internação e comunicações" },
  { value: "quality", label: "Qualidade", description: "Prontuário, diagnóstico, auditoria e quarentena" },
  { value: "cost", label: "Custo", description: "Cobranças, pagamentos e saldo observado" },
  { value: "audit", label: "Auditoria", description: "Ações recentes e correlação operacional" },
  { value: "incidents", label: "Incidentes", description: "Negativas, fila, runtime e receipts incertos" }
];

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatValue(value: ReportValue): string {
  if (value === null) return "Não observado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return new Intl.NumberFormat("pt-BR").format(value);
  if (typeof value === "string") return value;
  return "Detalhes estruturados";
}

function isObject(value: ReportValue): value is { [key: string]: ReportValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ReportSection({ title, value }: { title: string; value: ReportValue }) {
  if (!isObject(value)) return <div className="report-fact"><span>{humanize(title)}</span><strong>{formatValue(value)}</strong></div>;
  return <section className="report-section" aria-labelledby={`report-section-${title}`}><h3 id={`report-section-${title}`}>{humanize(title)}</h3><div className="report-facts">{Object.entries(value).map(([key, child]) => <div className="report-fact" key={key}><span>{humanize(key)}</span>{isObject(child) ? <div className="report-nested">{Object.entries(child).map(([nestedKey, nestedValue]) => <span key={nestedKey}><b>{humanize(nestedKey)}</b>{formatValue(nestedValue)}</span>)}</div> : <strong>{formatValue(child)}</strong>}</div>)}</div></section>;
}

export function Reports({ client, context }: { client: ApiClient; context: ContextOption | null }) {
  const [draftKind, setDraftKind] = useState<ReportKind>("operation");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [filters, setFilters] = useState({ kind: "operation" as ReportKind, from: "", to: "" });
  const [result, setResult] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    if (!context) {
      setLoading(false);
      setError("Nenhum workspace autorizado foi selecionado.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ kind: filters.kind, limit: "50" });
    if (filters.from) params.set("from", new Date(`${filters.from}T00:00:00.000Z`).toISOString());
    if (filters.to) params.set("to", new Date(`${filters.to}T23:59:59.999Z`).toISOString());
    try {
      const report = await client.get<ReportResponse>(`/operations/reports?${params.toString()}`, context);
      if (requestId !== loadRequestRef.current) return;
      setResult(report);
    } catch (reason) {
      if (requestId !== loadRequestRef.current) return;
      setError(reason instanceof Error ? reason.message : "O relatório não está disponível.");
      setResult(null);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [client, context, filters]);

  useEffect(() => { void load(); }, [load]);

  const applyFilters = () => setFilters({ kind: draftKind, from: draftFrom, to: draftTo });

  return <><PageHeader eyebrow="OPERAÇÃO & EVIDÊNCIA" title="Relatórios" description="Leituras agregadas, filtráveis e vinculadas à fonte operacional atual." /><div className="report-toolbar" role="region" aria-label="Filtros do relatório"><label htmlFor="report-kind">Visão<select id="report-kind" value={draftKind} onChange={(event) => setDraftKind(event.target.value as ReportKind)}>{kinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label htmlFor="report-from">De<input id="report-from" type="date" value={draftFrom} onChange={(event) => setDraftFrom(event.target.value)} /></label><label htmlFor="report-to">Até<input id="report-to" type="date" value={draftTo} onChange={(event) => setDraftTo(event.target.value)} /></label><button className="button button-primary" type="button" onClick={applyFilters} disabled={loading}><Icon name="refresh" size={16} />{loading ? "Atualizando…" : "Aplicar filtros"}</button></div>{error && <StatePanel kind="error" title="Relatório indisponível" body={error} action="Tentar novamente" onAction={() => void load()} />}{loading && !result ? <StatePanel kind="loading" title="Lendo operação" body="Consultando os agregados autorizados do workspace atual." /> : result ? <div className="report-layout"><section className="surface report-source"><div className="surface-head"><div><span className="eyebrow">FONTE OBSERVADA</span><h2>{kinds.find((item) => item.value === result.kind)?.label ?? "Relatório"}</h2></div><StatusBadge tone={result.source.storageMode === "postgres" ? "teal" : "amber"}>{result.source.storageMode === "postgres" ? "PostgreSQL" : "Memória local"}</StatusBadge></div><p>{kinds.find((item) => item.value === result.kind)?.description}</p><div className="report-source-meta"><span><Icon name="check" size={14} />{result.source.boundary}</span><span><Icon name="calendar" size={14} />Atualizado {new Date(result.source.generatedAt).toLocaleString("pt-BR")}</span><span><Icon name="lock" size={14} />Escopo do workspace atual</span></div></section><section className="surface report-data"><div className="surface-head"><div><span className="eyebrow">RESULTADO</span><h2>Indicadores do período</h2></div><span className="table-sub">Sem conteúdo clínico ou gráfico fixo</span></div><div className="report-sections">{Object.entries(result.report).map(([key, value]) => <ReportSection key={key} title={key} value={value} />)}</div></section></div> : <StatePanel kind="empty" title="Sem dados para este recorte" body="A fonte autorizada não retornou registros para os filtros selecionados." />}</>;
}
