import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import type { ContextOption } from "../../state/types";

type StockItem = {
  id: string;
  lotNumber: string;
  quantity: number;
  expiresOn: string;
  product: { name: string; unit: string; reorderPoint: number } | null;
  location: { name: string } | null;
};

function progressClass(item: StockItem): string {
  const percent = Math.min(100, Math.max(6, item.quantity / Math.max(1, (item.product?.reorderPoint ?? 1) * 2) * 100));
  const bucket = Math.min(100, Math.max(5, Math.round(percent / 5) * 5));
  return `stock-progress-${bucket}`;
}

export function Stock({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems((await client.get<{ items: StockItem[] }>("/stock", context)).items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Estoque indisponível.");
    } finally {
      setLoading(false);
    }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);
  const low = items.filter((item) => (item.product?.reorderPoint ?? 0) >= item.quantity);

  return (
    <>
      <PageHeader eyebrow="SUPRIMENTOS & FARMÁCIA" title="Estoque" description="Lotes, validade e movimentos sem saldo negativo." action="Registrar entrada" onAction={() => notify("Toda entrada exige lote, validade e motivo de auditoria.")} />
      {loading ? <StatePanel kind="loading" title="Abrindo a farmácia" body="Carregando lotes e validade do contexto autorizado." /> : error ? <StatePanel kind="error" title="Estoque indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : (
        <>
          <div className="stock-alert">
            <div className="alert-icon"><Icon name="alert" size={18} /></div>
            <div>
              <strong>{low.length ? `${low.length} item${low.length > 1 ? "ns" : ""} pede atenção` : "Estoque dentro do ponto de reposição"}</strong>
              <span>{low.length ? "Revise o saldo antes de confirmar novos atendimentos." : "Nenhuma exceção aberta no contexto atual."}</span>
            </div>
            <button className="text-button" type="button" onClick={() => notify("O inventário exige alçada de estoque.")}>Abrir inventário <Icon name="arrow" size={14} /></button>
          </div>
          <section className="surface">
            <div className="surface-head">
              <div><span className="eyebrow">SALDO POR LOTE</span><h2>Visão da farmácia</h2></div>
              <span className="toolbar-result">{items.length} lotes</span>
            </div>
            {items.length ? <div className="stock-grid">{items.map((item) => {
              const isLow = low.includes(item);
              return <article className={`stock-card ${isLow ? "stock-low" : ""}`} key={item.id}>
                <div className="stock-card-head"><span className="stock-icon"><Icon name="box" size={17} /></span><StatusBadge tone={isLow ? "amber" : "teal"}>{isLow ? "Repor" : "Disponível"}</StatusBadge></div>
                <h3>{item.product?.name ?? "Produto"}</h3>
                <span className="table-sub">Lote {item.lotNumber} · vence {new Date(item.expiresOn).toLocaleDateString("pt-BR")}</span>
                <div className="stock-quantity"><strong>{item.quantity}</strong><span>{item.product?.unit ?? "unidades"}</span></div>
                <div className="stock-progress" aria-label={`Saldo relativo de ${item.product?.name ?? "produto"}`}><span className={progressClass(item)} /></div>
                <small>{item.location?.name ?? "Local não informado"}</small>
              </article>;
            })}</div> : <StatePanel kind="empty" title="Sem lotes neste contexto" body="Cadastre o primeiro produto para acompanhar validade e saldo." />}
          </section>
        </>
      )}
    </>
  );
}
