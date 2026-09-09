import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate, formatMoney } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type Charge = { id: string; description: string; amountCents: number; status: string; createdAt: string };

export function Finance({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const [items, setItems] = useState<Charge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems((await client.get<{ items: Charge[] }>("/finance/charges", context)).items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Financeiro indisponível.");
    } finally {
      setLoading(false);
    }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);
  const total = items.reduce((sum, item) => sum + item.amountCents, 0);

  return (
    <>
      <PageHeader eyebrow="LEDGER & CONCILIAÇÃO" title="Financeiro" description="Cada cobrança tem um movimento. Cada movimento deixa rastro." action="Nova cobrança" onAction={() => notify("Cobranças reais estão desabilitadas na demonstração sintética.")} />
      {loading ? <StatePanel kind="loading" title="Abrindo o financeiro" body="Carregando cobranças do contexto autorizado." /> : error ? <StatePanel kind="error" title="Financeiro indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : (
        <>
          <section className="finance-summary">
            <div><span className="eyebrow">EM ABERTO · VISÃO LOCAL</span><strong>{formatMoney(total)}</strong><span>Ledger append-only lógico · {items.length} lançamentos</span></div>
            <div className="finance-bars" aria-hidden="true"><span className="bar-35" /><span className="bar-50" /><span className="bar-45" /><span className="bar-78" /><span className="bar-62" /><span className="bar-90" /></div>
          </section>
          <section className="surface">
            <div className="surface-head"><div><span className="eyebrow">MOVIMENTOS RECENTES</span><h2>Contas em aberto</h2></div><button className="button button-ghost" type="button" onClick={() => notify("Exportação permanece bloqueada até autoridade e retenção definidas.")}><Icon name="lock" size={14} />Exportar</button></div>
            {items.length ? <div className="ledger-list">{items.map((item) => <div className="ledger-row" key={item.id}><span className="ledger-icon"><Icon name="wallet" size={17} /></span><div><strong>{item.description}</strong><span>{formatDate(item.createdAt)} · movimento CHARGE</span></div><strong>{formatMoney(item.amountCents)}</strong><StatusBadge tone={item.status === "PAID" ? "teal" : "amber"}>{item.status === "PAID" ? "Pago" : "Em aberto"}</StatusBadge></div>)}</div> : <StatePanel kind="empty" title="Nenhuma cobrança encontrada" body="A visão financeira está vazia neste contexto." />}
          </section>
        </>
      )}
    </>
  );
}
