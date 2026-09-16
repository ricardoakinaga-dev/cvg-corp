import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type StockItem = {
  id: string;
  lotNumber: string;
  quantity: number;
  expiresOn: string;
  status: string;
  product: { id: string; name: string; unit: string; reorderPoint: number } | null;
  location: { id: string; name: string } | null;
};
type StockLocation = { id: string; name: string };
type StockMovement = { id: string; productId: string; lotId: string; locationId: string; quantity: number; movementType: string; reason: string; createdBy: string; createdAt: string };
type DialogState = { kind: "entry" } | { kind: "movement"; item: StockItem } | { kind: "inventory"; item: StockItem } | null;

const MOVEMENT_TYPES: Record<string, string> = {
  RECEIPT: "Entrada",
  DISPENSE: "Dispensação/consumo",
  TRANSFER_IN: "Transferência (entrada)",
  TRANSFER_OUT: "Transferência (saída)",
  RETURN: "Devolução",
  ADJUSTMENT: "Ajuste compensatório",
  ADJUSTMENT_IN: "Ajuste de entrada",
  ADJUSTMENT_OUT: "Ajuste de baixa"
};
const PRODUCT_UNITS = ["comprimido", "frasco", "ampola", "ml", "g", "unidade"];

export function stockProgressValue(item: StockItem): number {
  return Math.min(100, Math.max(0, item.quantity / Math.max(1, (item.product?.reorderPoint ?? 1) * 2) * 100));
}

function progressPercent(item: StockItem): number {
  return Math.max(6, stockProgressValue(item));
}

function progressClass(item: StockItem): string {
  const percent = progressPercent(item);
  const bucket = Math.min(100, Math.max(5, Math.round(percent / 5) * 5));
  return `stock-progress-${bucket}`;
}

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
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><section ref={cardRef} className="dialog-card" style={{ maxHeight: "min(88vh, 760px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">ESTOQUE</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

export function Stock({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const canWriteStock = (context?.roles ?? []).some((role) => role === "admin" || role === "estoque");
  const [items, setItems] = useState<StockItem[]>([]);
  const [locations, setLocations] = useState<StockLocation[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [receipt, setReceipt] = useState<{ label: string; receiptId: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [productMode, setProductMode] = useState<"existing" | "new">("existing");
  const [productId, setProductId] = useState("");
  const [sku, setSku] = useState("");
  const [productName, setProductName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("unidade");
  const [reorderPoint, setReorderPoint] = useState("10");
  const [lotNumber, setLotNumber] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [locationId, setLocationId] = useState("");
  const [movementType, setMovementType] = useState("DISPENSE");
  const [movementReason, setMovementReason] = useState("");
  const [countedQuantity, setCountedQuantity] = useState("0");
  const [countReason, setCountReason] = useState("");
  const submissionKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [stockList, locationList, movementList] = await Promise.all([
        client.get<{ items: StockItem[] }>("/stock", context),
        client.get<{ items: StockLocation[] }>("/stock/locations", context),
        client.get<{ items: StockMovement[] }>("/stock/movements", context)
      ]);
      setItems(stockList.items);
      setLocations(locationList.items);
      setMovements(movementList.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Estoque indisponível.");
    } finally {
      setLoading(false);
    }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);
  const low = items.filter((item) => (item.product?.reorderPoint ?? 0) >= item.quantity);
  const productOptions = [...new Map(items.filter((item) => item.product).map((item) => [item.product!.id, item.product!])).values()];

  const openDialog = (next: Exclude<DialogState, null>) => {
    submissionKey.current = null;
    setFormError("");
    setDialog(next);
    if (next.kind === "entry") {
      setProductMode(productOptions.length ? "existing" : "new");
      setProductId(productOptions[0]?.id ?? "");
      setSku("");
      setProductName("");
      setCategory("");
      setUnit("unidade");
      setReorderPoint("10");
      setLotNumber("");
      setExpiresOn("");
      setQuantity("1");
      setLocationId(locations[0]?.id ?? "");
    }
    if (next.kind === "movement") { setMovementType("DISPENSE"); setQuantity("1"); setMovementReason(""); setLocationId(next.item.location?.id ?? locations[0]?.id ?? ""); }
    if (next.kind === "inventory") { setCountedQuantity(String(next.item.quantity)); setCountReason(""); }
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

  const submitEntry = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      let resolvedProductId = productId;
      if (productMode === "new") {
        const productResult = await client.request<{ product: { id: string }; receiptId: string }>("/stock/products", {
          method: "POST",
          headers: { "Idempotency-Key": `${idempotencyKey()}:product` },
          body: JSON.stringify({ sku, name: productName, category, unit, reorderPoint: Number(reorderPoint) })
        }, context);
        resolvedProductId = productResult.product.id;
      }
      const result = await client.request<{ lot: { id: string; lotNumber: string; quantity: number }; movement: StockMovement | null; receiptId: string }>("/stock/lots", {
        method: "POST",
        headers: { "Idempotency-Key": `${idempotencyKey()}:lot` },
        body: JSON.stringify({ productId: resolvedProductId, lotNumber, expiresOn, quantity: Number(quantity), locationId })
      }, context);
      finish(`Lote ${result.lot.lotNumber} com saldo ${result.lot.quantity}`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Entrada não registrada."); }
    finally { setSubmitting(false); }
  };

  const submitMovement = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "movement") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ movement: StockMovement; receiptId: string }>("/stock/movements", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ productId: dialog.item.product?.id, lotId: dialog.item.id, locationId, quantity: Number(quantity), movementType, reason: movementReason, referenceId: null })
      }, context);
      finish(`${MOVEMENT_TYPES[result.movement.movementType] ?? result.movement.movementType} registrada`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Movimento não registrado."); }
    finally { setSubmitting(false); }
  };

  const submitInventory = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "inventory") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ lot: { quantity: number }; movement: StockMovement | null; delta: number; receiptId: string }>("/stock/inventory", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ lotId: dialog.item.id, countedQuantity: Number(countedQuantity), reason: countReason })
      }, context);
      if (result.delta === 0) finish("Contagem confere com o sistema; nenhum ajuste necessário", result.receiptId);
      else finish(`Inventário ajustado em ${result.delta > 0 ? "+" : ""}${result.delta}`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Inventário não registrado."); }
    finally { setSubmitting(false); }
  };

  const productNameOf = (id: string): string => items.find((item) => item.product?.id === id)?.product?.name ?? "Produto";
  const lotNumberOf = (id: string): string => items.find((item) => item.id === id)?.lotNumber ?? "lote";
  const locationNameOf = (id: string): string => locations.find((location) => location.id === id)?.name ?? "local";

  return (
    <>
      <PageHeader eyebrow="SUPRIMENTOS & FARMÁCIA" title="Estoque" description="Lotes, validade e movimentos sem saldo negativo." action="Registrar entrada" onAction={() => openDialog({ kind: "entry" })} />
      {receipt && <p className="table-sub" role="status">Recibo {receipt.receiptId} · {receipt.label}</p>}
      {loading ? <StatePanel kind="loading" title="Abrindo a farmácia" body="Carregando lotes e validade do contexto autorizado." /> : error ? <StatePanel kind="error" title="Estoque indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : (
        <>
          <div className="stock-alert">
            <div className="alert-icon"><Icon name="alert" size={18} /></div>
            <div>
              <strong>{low.length ? `${low.length} item${low.length > 1 ? "ns" : ""} pede atenção` : "Estoque dentro do ponto de reposição"}</strong>
              <span>{low.length ? "Revise o saldo antes de confirmar novos atendimentos." : "Nenhuma exceção aberta no contexto atual."}</span>
            </div>
            <button className="text-button" type="button" onClick={() => items[0] && openDialog({ kind: "inventory", item: items[0] })} disabled={!items.length}>Abrir inventário <Icon name="arrow" size={14} /></button>
          </div>
          {!canWriteStock && <p className="table-sub" role="status">Movimentos e inventário exigem role admin/estoque no escopo atual.</p>}
          <section className="surface">
            <div className="surface-head"><div><span className="eyebrow">LOTES & VALIDADE</span><h2>Saldo por lote</h2></div><StatusBadge tone={low.length ? "amber" : "teal"}>{items.length} lotes</StatusBadge></div>
            {items.length === 0 ? <StatePanel kind="empty" title="Nenhum lote no contexto" body="Registre uma entrada com lote e validade para iniciar o estoque." /> : <div className="stock-grid">{items.map((item) => <article className={`stock-card ${low.includes(item) ? "stock-low" : ""}`} key={item.id}><div className="stock-card-head"><span className="stock-icon"><Icon name="box" size={18} /></span><StatusBadge tone={item.status === "AVAILABLE" ? "teal" : "coral"}>{item.status === "AVAILABLE" ? "Disponível" : item.status}</StatusBadge></div><h3>{item.product?.name ?? "Produto"}</h3><span className="table-sub">Lote {item.lotNumber} · validade {item.expiresOn} · {item.location?.name ?? "local"}</span><div className="stock-quantity"><strong>{item.quantity}</strong><span>{item.product?.unit ?? "unidade"}(s)</span></div><div className="stock-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stockProgressValue(item))} aria-label={`Saldo relativo de ${item.product?.name ?? "produto"}`}><span className={progressClass(item)} /></div><small>Ponto de reposição {item.product?.reorderPoint ?? 0}</small><div className="stock-card-actions"><button className="text-button" type="button" onClick={() => openDialog({ kind: "movement", item })} disabled={!canWriteStock}>Movimento</button>{" "}<button className="text-button" type="button" onClick={() => openDialog({ kind: "inventory", item })} disabled={!canWriteStock}>Inventário</button></div></article>)}</div>}
          </section>
          <section className="surface">
            <div className="surface-head"><div><span className="eyebrow">TRILHA DE MOVIMENTOS</span><h2>Últimos movimentos</h2></div><StatusBadge tone="slate">{movements.length} registros</StatusBadge></div>
            {movements.length === 0 ? <StatePanel kind="empty" title="Nenhum movimento" body="Entradas, dispensações, devoluções e ajustes aparecem aqui." /> : <div className="audit-list">{movements.map((movement) => <div className="audit-row" key={movement.id}><span className="audit-result" aria-label={`Movimento ${MOVEMENT_TYPES[movement.movementType] ?? movement.movementType}`}>•</span><div><strong>{productNameOf(movement.productId)} · lote {lotNumberOf(movement.lotId)}</strong><span>{MOVEMENT_TYPES[movement.movementType] ?? movement.movementType} · {movement.quantity} unidade(s) · {locationNameOf(movement.locationId)} · {formatDate(movement.createdAt)}</span><span>{movement.reason}</span></div><div className="audit-meta"><small>autor {movement.createdBy.slice(0, 8)}…</small></div></div>)}</div>}
          </section>
        </>
      )}

      {dialog?.kind === "entry" && <Dialog titleId="stock-entry-title" title="Registrar entrada" description="Entrada exige produto, lote, validade futura e quantidade; SKU e lote duplicados são negados." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitEntry} className="dialog-form">
          <div className="segmented" role="group" aria-label="Origem do produto">
            <button className={productMode === "existing" ? "selected" : undefined} aria-pressed={productMode === "existing"} type="button" onClick={() => setProductMode("existing")} disabled={!productOptions.length}>Produto existente</button>
            <button className={productMode === "new" ? "selected" : undefined} aria-pressed={productMode === "new"} type="button" onClick={() => setProductMode("new")}>Novo produto</button>
          </div>
          {productMode === "existing" ? <label htmlFor="stock-product">Produto<select id="stock-product" value={productId} onChange={(event) => setProductId(event.target.value)} required><option value="">Selecione…</option>{productOptions.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.unit}</option>)}</select></label> : <>
            <label htmlFor="stock-sku">SKU<input id="stock-sku" value={sku} onChange={(event) => setSku(event.target.value)} required minLength={2} maxLength={40} /></label>
            <label htmlFor="stock-name">Nome<input id="stock-name" value={productName} onChange={(event) => setProductName(event.target.value)} required minLength={2} maxLength={160} /></label>
            <label htmlFor="stock-category">Categoria<input id="stock-category" value={category} onChange={(event) => setCategory(event.target.value)} required minLength={2} maxLength={80} /></label>
            <label htmlFor="stock-unit">Unidade<select id="stock-unit" value={unit} onChange={(event) => setUnit(event.target.value)}>{PRODUCT_UNITS.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}</select></label>
            <label htmlFor="stock-reorder">Ponto de reposição<input id="stock-reorder" type="number" min={0} step={1} value={reorderPoint} onChange={(event) => setReorderPoint(event.target.value)} required /></label>
          </>}
          <label htmlFor="stock-lot">Lote<input id="stock-lot" value={lotNumber} onChange={(event) => setLotNumber(event.target.value)} required minLength={2} maxLength={80} /></label>
          <label htmlFor="stock-expiry">Validade<input id="stock-expiry" type="date" value={expiresOn} onChange={(event) => setExpiresOn(event.target.value)} required /></label>
          <label htmlFor="stock-quantity">Quantidade<input id="stock-quantity" type="number" min={0} step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
          <label htmlFor="stock-location">Localização<select id="stock-location" value={locationId} onChange={(event) => setLocationId(event.target.value)} required><option value="">Selecione…</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Persistência única com receipt</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Confirmar entrada"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "movement" && <Dialog titleId="stock-movement-title" title={`Movimento · ${dialog.item.product?.name ?? "Produto"}`} description="Saldo insuficiente e lote vencido negam atomicamente; cada movimento tem motivo e autoria." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitMovement} className="dialog-form">
          <label htmlFor="stock-movement-type">Tipo<select id="stock-movement-type" value={movementType} onChange={(event) => setMovementType(event.target.value)}>{Object.entries(MOVEMENT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label htmlFor="stock-movement-location">Localização<select id="stock-movement-location" value={locationId} onChange={(event) => setLocationId(event.target.value)} required><option value="">Selecione…</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <label htmlFor="stock-movement-quantity">Quantidade<input id="stock-movement-quantity" type="number" min={1} step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
          <label htmlFor="stock-movement-reason">Motivo<input id="stock-movement-reason" value={movementReason} onChange={(event) => setMovementReason(event.target.value)} required minLength={3} maxLength={240} /></label>
          <p className="table-sub">Saldo atual do lote: {dialog.item.quantity}</p>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Movimento auditável</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar movimento"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "inventory" && <Dialog titleId="stock-inventory-title" title={`Inventário · ${dialog.item.product?.name ?? "Produto"}`} description="A contagem física gera ajuste compensatório com motivo; divergência zero não cria movimento." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitInventory} className="dialog-form">
          <p className="table-sub">Saldo do sistema: {dialog.item.quantity} · lote {dialog.item.lotNumber}</p>
          <label htmlFor="stock-count">Contagem física<input id="stock-count" type="number" min={0} step={1} value={countedQuantity} onChange={(event) => setCountedQuantity(event.target.value)} required /></label>
          <label htmlFor="stock-count-reason">Motivo<input id="stock-count-reason" value={countReason} onChange={(event) => setCountReason(event.target.value)} required minLength={5} maxLength={240} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Ajuste compensatório auditado</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Ajustando…" : "Confirmar contagem"}</button></div>
        </form>
      </Dialog>}
    </>
  );
}
