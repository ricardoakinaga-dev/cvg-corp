import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate, formatMoney } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type Charge = { id: string; description: string; amountCents: number; status: string; createdAt: string; patientId: string | null };
type Payment = { id: string; chargeId: string; amountCents: number; method: string; externalReference: string | null; status: string; createdAt: string };
type LedgerEntry = { id: string; kind: string; referenceId: string; amountCents: number; currency: string; description: string; createdAt: string };
type Patient = { id: string; name: string; species: string };
type Balance = {
  currency: string;
  chargedCents: number;
  settledPaymentCents: number;
  pendingCents: number | null;
  state: string;
  refunds: { status: string; amountCents: number | null };
  observedAt: string;
};
type DialogState = { kind: "charge" } | { kind: "payment"; charge: Charge } | { kind: "refund"; charge: Charge } | null;

const CHARGE_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  PAID: { label: "Pago", tone: "teal" },
  PARTIALLY_PAID: { label: "Parcial", tone: "amber" },
  OPEN: { label: "Em aberto", tone: "amber" },
  REFUNDED: { label: "Estornado", tone: "coral" }
};
const PAYMENT_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  SETTLED: { label: "Liquidado", tone: "teal" },
  PENDING: { label: "Pendente", tone: "amber" },
  UNKNOWN: { label: "Indeterminado", tone: "amber" },
  REFUNDED: { label: "Estornado", tone: "coral" }
};
const LEDGER_LABELS: Record<string, string> = { CHARGE: "Cobrança", PAYMENT: "Pagamento", REFUND: "Estorno", ADJUSTMENT: "Ajuste" };
const UNCERTAIN_BALANCE_STATES = new Set(["REQUIRES_POLICY", "UNKNOWN"]);

function Dialog({ titleId, title, description, onClose, closeDisabled = false, children }: { titleId: string; title: string; description: string; onClose: () => void; closeDisabled?: boolean; children: ReactNode }) {
  const cardRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = cardRef.current?.querySelector<HTMLElement>("input, select, textarea") ?? cardRef.current?.querySelector<HTMLElement>("button");
    target?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);
  useEffect(() => {
    const focusable = () => Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button, select, input, textarea, [href]") ?? []).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (!closeDisabled) onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (!cardRef.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeDisabled, onClose]);
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><section ref={cardRef} className="dialog-card" style={{ maxHeight: "min(88vh, 760px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">FINANCEIRO</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

export function Finance({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const canOperate = (context?.roles ?? []).some((role) => role === "admin" || role === "financeiro");
  const [items, setItems] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [receipt, setReceipt] = useState<{ label: string; receiptId: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"PIX" | "CARD" | "CASH" | "TRANSFER">("PIX");
  const [paymentReference, setPaymentReference] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const submissionKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [chargeResult, paymentList, ledgerList, patientList] = await Promise.all([
        client.get<{ items: Charge[]; balance: Balance }>("/finance/charges", context),
        client.get<{ items: Payment[] }>("/finance/payments", context),
        client.get<{ items: LedgerEntry[] }>("/finance/ledger", context),
        client.get<{ items: Patient[] }>("/patients", context).catch(() => ({ items: [] as Patient[] }))
      ]);
      setItems(chargeResult.items);
      setBalance(chargeResult.balance);
      setPayments(paymentList.items);
      setLedger(ledgerList.items);
      setPatients(patientList.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Financeiro indisponível.");
    } finally {
      setLoading(false);
    }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);

  const openDialog = (next: Exclude<DialogState, null>) => {
    submissionKey.current = null;
    setFormError("");
    setDialog(next);
    if (next.kind === "charge") { setPatientId(""); setDescription(""); setAmount(""); }
    if (next.kind === "payment") { setPaymentAmount(String(next.charge.amountCents / 100)); setPaymentMethod("PIX"); setPaymentReference(""); }
    if (next.kind === "refund") {
      const settled = payments.filter((payment) => payment.chargeId === next.charge.id && payment.status === "SETTLED");
      setRefundPaymentId(settled[0]?.id ?? "");
      setRefundReason("");
    }
  };

  const closeDialog = () => {
    submissionKey.current = null;
    setFormError("");
    setSubmitting(false);
    setDialog(null);
  };

  const idempotencyKey = (): string => {
    submissionKey.current ??= crypto.randomUUID();
    return submissionKey.current;
  };

  const finish = (label: string, receiptId: string) => {
    setReceipt({ label, receiptId });
    setDialog(null);
    submissionKey.current = null;
    void load();
  };

  const submitCharge = async (event: FormEvent) => {
    event.preventDefault();
    const amountCents = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) { setFormError("Valor da cobrança inválido."); return; }
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ charge: Charge; receiptId: string }>("/finance/charges", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ patientId: patientId || null, description, amountCents, currency: "BRL" })
      }, context);
      finish(`Cobrança de ${formatMoney(result.charge.amountCents)} criada`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Cobrança não criada."); }
    finally { setSubmitting(false); }
  };

  const submitPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "payment") return;
    const amountCents = Math.round(Number(paymentAmount.replace(",", ".")) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) { setFormError("Valor do pagamento inválido."); return; }
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ payment: Payment; receiptId: string }>("/finance/payments", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ chargeId: dialog.charge.id, amountCents, method: paymentMethod, externalReference: paymentReference.trim() ? paymentReference.trim() : null })
      }, context);
      finish(`Pagamento de ${formatMoney(result.payment.amountCents)} liquidado`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Pagamento não registrado."); }
    finally { setSubmitting(false); }
  };

  const submitRefund = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "refund") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ payment: Payment; receiptId: string }>("/finance/refunds", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ paymentId: refundPaymentId, reason: refundReason })
      }, context);
      finish(`Estorno de ${formatMoney(result.payment.amountCents)} registrado no ledger`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Estorno não registrado."); }
    finally { setSubmitting(false); }
  };

  const patientName = (id: string | null): string => (id ? patients.find((patient) => patient.id === id)?.name ?? "Paciente" : "sem paciente");
  const chargePayments = (chargeId: string) => payments.filter((payment) => payment.chargeId === chargeId);
  const uncertain = balance !== null && UNCERTAIN_BALANCE_STATES.has(balance.state);
  const openLabel = uncertain ? "SALDO NÃO AFIRMADO · POLÍTICA DE ESTORNO PENDENTE" : "EM ABERTO · VISÃO LOCAL";

  return (
    <>
      <PageHeader eyebrow="LEDGER & CONCILIAÇÃO" title="Financeiro" description="Cada cobrança tem um movimento. Cada movimento deixa rastro." action={canOperate ? "Nova cobrança" : undefined} onAction={() => openDialog({ kind: "charge" })} actionDisabled={!canOperate} />
      {receipt && <p className="table-sub" role="status">Recibo {receipt.receiptId} · {receipt.label}</p>}
      {loading ? <StatePanel kind="loading" title="Abrindo o financeiro" body="Carregando cobranças do contexto autorizado." /> : error ? <StatePanel kind="error" title="Financeiro indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : (
        <>
          <section className="finance-summary">
            <div>
              <span className="eyebrow">{openLabel}</span>
              <strong>{balance === null ? "—" : uncertain ? "Em análise" : formatMoney(balance.pendingCents ?? 0)}</strong>
              <span>{balance === null ? "Saldo não disponível." : uncertain ? "Estorno observado sem regra financeira definida (D-01); nenhum valor em aberto é afirmado." : `Cobrado ${formatMoney(balance.chargedCents)} · Liquidado ${formatMoney(balance.settledPaymentCents)} · ${items.length} lançamentos`}</span>
            </div>
            <div className="finance-bars" aria-hidden="true"><span className="bar-35" /><span className="bar-50" /><span className="bar-45" /><span className="bar-78" /><span className="bar-62" /><span className="bar-90" /></div>
          </section>
          {!canOperate && <p className="table-sub" role="status">Cobranças, pagamentos e estornos exigem role admin/financeiro no escopo atual.</p>}
          <section className="surface">
            <div className="surface-head"><div><span className="eyebrow">MOVIMENTOS RECENTES</span><h2>Contas e pagamentos</h2></div><button className="button button-ghost" type="button" onClick={() => notify("Exportação permanece bloqueada até autoridade e retenção definidas.")}><Icon name="lock" size={14} />Exportar</button></div>
            {items.length ? <div className="ledger-list">{items.map((item) => {
              const presentation = CHARGE_STATUS[item.status] ?? { label: item.status, tone: "slate" as const };
              const settled = chargePayments(item.id).filter((payment) => payment.status === "SETTLED");
              return <div className="ledger-row" key={item.id}>
                <span className="ledger-icon"><Icon name="wallet" size={17} /></span>
                <div>
                  <strong>{item.description}</strong>
                  <span>{formatDate(item.createdAt)} · {patientName(item.patientId)} · movimento CHARGE</span>
                  {chargePayments(item.id).map((payment) => <span key={payment.id}>{PAYMENT_STATUS[payment.status]?.label ?? payment.status}: {formatMoney(payment.amountCents)} · {payment.method}{payment.externalReference ? ` · ref ${payment.externalReference}` : ""}</span>)}
                </div>
                <strong>{formatMoney(item.amountCents)}</strong>
                <StatusBadge tone={presentation.tone}>{presentation.label}</StatusBadge>
                <span className="ledger-actions">
                  {(item.status === "OPEN" || item.status === "PARTIALLY_PAID") && <button className="text-button" type="button" onClick={() => openDialog({ kind: "payment", charge: item })} disabled={!canOperate}>Pagamento</button>}{" "}
                  {settled.length > 0 && <button className="text-button" type="button" onClick={() => openDialog({ kind: "refund", charge: item })} disabled={!canOperate}>Estorno</button>}
                </span>
              </div>;
            })}</div> : <StatePanel kind="empty" title="Nenhuma cobrança encontrada" body="A visão financeira está vazia neste contexto." />}
          </section>
          <section className="surface">
            <div className="surface-head"><div><span className="eyebrow">LEDGER APPEND-ONLY</span><h2>Trilha de lançamentos</h2></div><StatusBadge tone="slate">{ledger.length} entradas</StatusBadge></div>
            {ledger.length === 0 ? <StatePanel kind="empty" title="Ledger vazio" body="Cobranças, pagamentos e estornos aparecem aqui sem apagar o histórico." /> : <div className="audit-list">{ledger.slice(-50).reverse().map((entry) => <div className="audit-row" key={entry.id}><span className="audit-result" aria-label={`Lançamento ${LEDGER_LABELS[entry.kind] ?? entry.kind}`}>{entry.amountCents < 0 ? "−" : "+"}</span><div><strong>{LEDGER_LABELS[entry.kind] ?? entry.kind} · {formatMoney(Math.abs(entry.amountCents))}</strong><span>{entry.description} · {entry.currency} · {formatDate(entry.createdAt)}</span></div><div className="audit-meta"><small>corr. {entry.referenceId.slice(0, 8)}…</small></div></div>)}</div>}
          </section>
        </>
      )}

      {dialog?.kind === "charge" && <Dialog titleId="finance-charge-title" title="Nova cobrança" description="A cobrança entra no ledger como movimento append-only; paciente é opcional e o valor é em reais." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitCharge} className="dialog-form">
          <label htmlFor="finance-patient">Paciente (opcional)<select id="finance-patient" value={patientId} onChange={(event) => setPatientId(event.target.value)}><option value="">Sem paciente</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.species}</option>)}</select></label>
          <label htmlFor="finance-description">Descrição<input id="finance-description" value={description} onChange={(event) => setDescription(event.target.value)} required minLength={2} maxLength={200} /></label>
          <label htmlFor="finance-amount">Valor (R$)<input id="finance-amount" value={amount} onChange={(event) => setAmount(event.target.value)} required inputMode="decimal" placeholder="220,00" /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Escrita idempotente · auditoria automática</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Criando…" : "Criar cobrança"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "payment" && <Dialog titleId="finance-payment-title" title={`Pagamento · ${dialog.charge.description}`} description="Pagamento acima do saldo é negado; repetir a mesma chave não duplica a liquidação." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitPayment} className="dialog-form">
          <p className="table-sub">Cobrança {formatMoney(dialog.charge.amountCents)} · saldo em aberto {formatMoney(Math.max(0, dialog.charge.amountCents - chargePayments(dialog.charge.id).filter((payment) => payment.status === "SETTLED").reduce((total, payment) => total + payment.amountCents, 0)))}</p>
          <label htmlFor="finance-payment-amount">Valor (R$)<input id="finance-payment-amount" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required inputMode="decimal" /></label>
          <label htmlFor="finance-payment-method">Método<select id="finance-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="PIX">PIX</option><option value="CARD">Cartão</option><option value="CASH">Dinheiro</option><option value="TRANSFER">Transferência</option></select></label>
          <label htmlFor="finance-payment-reference">Referência externa (opcional)<input id="finance-payment-reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={160} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Liquidação imediata no ledger local</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar pagamento"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "refund" && <Dialog titleId="finance-refund-title" title={`Estorno · ${dialog.charge.description}`} description="O estorno cria um lançamento compensatório negativo e preserva o original. A semântica de crédito/reabertura permanece REQUIRES_POLICY até decisão do responsável financeiro (D-01)." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitRefund} className="dialog-form">
          <label htmlFor="finance-refund-payment">Pagamento liquidado<select id="finance-refund-payment" value={refundPaymentId} onChange={(event) => setRefundPaymentId(event.target.value)} required><option value="">Selecione…</option>{payments.filter((payment) => payment.chargeId === dialog.charge.id && payment.status === "SETTLED").map((payment) => <option key={payment.id} value={payment.id}>{formatMoney(payment.amountCents)} · {payment.method} · {formatDate(payment.createdAt)}</option>)}</select></label>
          <label htmlFor="finance-refund-reason">Motivo<input id="finance-refund-reason" value={refundReason} onChange={(event) => setRefundReason(event.target.value)} required minLength={5} maxLength={500} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Ação auditada · saldo exibirá política pendente</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Estornando…" : "Confirmar estorno"}</button></div>
        </form>
      </Dialog>}
    </>
  );
}
