import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type Episode = { id: string; patientId: string; encounterId: string | null; bedId: string | null; status: string; admittedAt: string | null; dischargedAt: string | null };
type Bed = { id: string; name: string; status: string };
type MedicationOrder = { id: string; patientId: string; encounterId: string | null; productId: string; dose: string; route: string; frequency: string; status: string; prescribedBy: string };
type Dispensation = { id: string; medicationOrderId: string; lotId: string; quantity: number; createdAt: string };
type Administration = { id: string; medicationOrderId: string; administeredAt: string; status: string; note: string | null };
type StockItem = { id: string; lotNumber: string; quantity: number; product: { id: string; name: string; unit: string } | null };
type Patient = { id: string; name: string; species: string };
type Encounter = { id: string; patientId: string; patient: { name: string } | null };
type DialogState =
  | { kind: "admit" }
  | { kind: "prescribe"; episode: Episode }
  | { kind: "dispense"; order: MedicationOrder }
  | { kind: "administer"; order: MedicationOrder }
  | { kind: "discharge"; episode: Episode }
  | null;

const EPISODE_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  PLANNED: { label: "Planejada", tone: "slate" },
  ADMITTED: { label: "Internado", tone: "teal" },
  PROCEDURE: { label: "Em procedimento", tone: "amber" },
  RECOVERY: { label: "Em recuperação", tone: "amber" },
  DISCHARGED: { label: "Alta registrada", tone: "slate" }
};
const ORDER_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  DRAFT: { label: "Rascunho", tone: "slate" },
  ACTIVE: { label: "Ativa", tone: "amber" },
  SUSPENDED: { label: "Suspensa", tone: "coral" },
  COMPLETED: { label: "Concluída", tone: "teal" }
};
const ADMIN_STATUS: Record<string, string> = { ADMINISTERED: "Administrada", OMITTED: "Omitida", REFUSED: "Recusada" };

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
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><section ref={cardRef} className="dialog-card" style={{ maxHeight: "min(88vh, 760px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">INTERNAÇÃO</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

export function Internacao({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const roles = context?.roles ?? [];
  const canStatus = roles.includes("admin") || roles.includes("veterinario");
  const canPrescribe = roles.includes("veterinario");
  const canAdminister = roles.includes("veterinario");
  const canDispense = roles.includes("admin") || roles.includes("estoque");
  const canDischarge = roles.includes("veterinario");

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [orders, setOrders] = useState<MedicationOrder[]>([]);
  const [dispensations, setDispensations] = useState<Dispensation[]>([]);
  const [administrations, setAdministrations] = useState<Administration[]>([]);
  const [stock, setStock] = useState<StockItem[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [receipt, setReceipt] = useState<{ label: string; receiptId: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [bedId, setBedId] = useState("");
  const [productId, setProductId] = useState("");
  const [dose, setDose] = useState("");
  const [route, setRoute] = useState("");
  const [frequency, setFrequency] = useState("");
  const [lotId, setLotId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [administrationStatus, setAdministrationStatus] = useState<"ADMINISTERED" | "OMITTED" | "REFUSED">("ADMINISTERED");
  const [administrationNote, setAdministrationNote] = useState("");
  const submissionKey = useRef<string | null>(null);
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const [episodeList, bedList, orderList, dispensationList, administrationList, stockList, patientList, encounterList] = await Promise.all([
        client.get<{ items: Episode[] }>("/hospitalization/episodes", context),
        client.get<{ items: Bed[] }>("/hospitalization/beds", context),
        client.get<{ items: MedicationOrder[] }>("/medications/orders", context),
        client.get<{ items: Dispensation[] }>("/medications/dispensations", context),
        client.get<{ items: Administration[] }>("/medications/administrations", context),
        client.get<{ items: StockItem[] }>("/stock", context),
        client.get<{ items: Patient[] }>("/patients", context),
        client.get<{ items: Encounter[] }>("/encounters", context)
      ]);
      if (requestId !== loadRequestRef.current) return;
      setEpisodes(episodeList.items);
      setBeds(bedList.items);
      setOrders(orderList.items);
      setDispensations(dispensationList.items);
      setAdministrations(administrationList.items);
      setStock(stockList.items);
      setPatients(patientList.items);
      setEncounters(encounterList.items);
    } catch (reason) {
      if (requestId === loadRequestRef.current) setError(reason instanceof Error ? reason.message : "Internação indisponível.");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);

  const productName = (id: string): string => stock.find((item) => item.product?.id === id)?.product?.name ?? "Produto";
  const bedName = (id: string | null): string => (id ? beds.find((bed) => bed.id === id)?.name ?? "Leito" : "sem leito");
  const patientName = (id: string): string => patients.find((patient) => patient.id === id)?.name ?? "Paciente";
  const availableBeds = beds.filter((bed) => bed.status === "AVAILABLE");
  const encounterOptions = encounters.filter((encounter) => !patientId || encounter.patientId === patientId);
  const episodeOrders = (episode: Episode) => orders.filter((order) => order.encounterId !== null && order.encounterId === episode.encounterId);
  const orderDispensations = (orderId: string) => dispensations.filter((dispensation) => dispensation.medicationOrderId === orderId);
  const orderAdministrations = (orderId: string) => administrations.filter((administration) => administration.medicationOrderId === orderId);

  const openDialog = (next: Exclude<DialogState, null>) => {
    submissionKey.current = null;
    setFormError("");
    setDialog(next);
    if (next.kind === "admit") { setPatientId(""); setEncounterId(""); setBedId(""); }
    if (next.kind === "prescribe") { setProductId(""); setDose(""); setRoute(""); setFrequency(""); }
    if (next.kind === "dispense") {
      const firstLot = stock.find((item) => item.product?.id === next.order.productId && item.quantity > 0);
      setLotId(firstLot?.id ?? "");
      setQuantity("1");
    }
    if (next.kind === "administer") { setAdministrationStatus("ADMINISTERED"); setAdministrationNote(""); }
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

  const submitAdmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ episode: Episode; receiptId: string }>("/hospitalization/episodes", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ patientId, encounterId: encounterId || null, bedId: bedId || null })
      }, context);
      finish(`Internação ${result.episode.status === "ADMITTED" ? "admitida" : "planejada"}`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Internação não registrada."); }
    finally { setSubmitting(false); }
  };

  const submitPrescribe = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "prescribe") return;
    if (!dialog.episode.encounterId) { setFormError("Prescrição exige atendimento vinculado ao episódio."); return; }
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ order: MedicationOrder; receiptId: string }>("/medications/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ patientId: dialog.episode.patientId, encounterId: dialog.episode.encounterId, productId, dose, route, frequency })
      }, context);
      finish(`Prescrição de ${productName(result.order.productId)} criada`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Prescrição não criada."); }
    finally { setSubmitting(false); }
  };

  const submitDispense = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "dispense") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ dispensation: Dispensation; receiptId: string }>(`/medications/orders/${encodeURIComponent(dialog.order.id)}/dispense`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ lotId, quantity: Number(quantity) })
      }, context);
      finish(`Dispensação de ${result.dispensation.quantity} unidade(s) registrada`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Dispensação não registrada."); }
    finally { setSubmitting(false); }
  };

  const submitAdminister = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "administer") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ occurrence: Administration; receiptId: string }>(`/medications/orders/${encodeURIComponent(dialog.order.id)}/administer`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ status: administrationStatus, note: administrationNote.trim() ? administrationNote.trim() : null })
      }, context);
      finish(`Administração registrada como ${ADMIN_STATUS[result.occurrence.status] ?? result.occurrence.status}`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Administração não registrada."); }
    finally { setSubmitting(false); }
  };

  const submitDischarge = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "discharge") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ episode: Episode; receiptId: string }>(`/hospitalization/episodes/${encodeURIComponent(dialog.episode.id)}/discharge`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({})
      }, context);
      finish("Alta registrada com pendências decididas", result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Alta não registrada."); }
    finally { setSubmitting(false); }
  };

  const changeOrderStatus = async (order: MedicationOrder, status: "ACTIVE" | "SUSPENDED" | "COMPLETED") => {
    submissionKey.current = null;
    try {
      const result = await client.request<{ order: MedicationOrder; receiptId: string }>(`/medications/orders/${encodeURIComponent(order.id)}/status`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ status })
      }, context);
      setReceipt({ label: `Prescrição ${ORDER_STATUS[result.order.status]?.label ?? result.order.status}`, receiptId: result.receiptId });
      submissionKey.current = null;
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Status da prescrição não alterado.");
    }
  };

  const changeEpisodeStatus = async (episode: Episode, status: "ADMITTED" | "PROCEDURE" | "RECOVERY") => {
    submissionKey.current = null;
    try {
      const result = await client.request<{ episode: Episode; receiptId: string }>(`/hospitalization/episodes/${encodeURIComponent(episode.id)}/status`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ status })
      }, context);
      setReceipt({ label: `Episódio em ${EPISODE_STATUS[result.episode.status]?.label ?? result.episode.status}`, receiptId: result.receiptId });
      submissionKey.current = null;
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Status do episódio não alterado.");
    }
  };

  return (
    <>
      <PageHeader eyebrow="LEITOS & MEDICAÇÃO" title="Internações em andamento" description="Leitos, episódios e medicação com autoria, estado e sequência operacional explícitos." action="Nova internação" onAction={() => openDialog({ kind: "admit" })} />
      {receipt && <p className="table-sub" role="status">Recibo {receipt.receiptId} · {receipt.label}</p>}
      {loading ? <StatePanel kind="loading" title="Lendo internações" body="Resolvendo leitos, episódios e prescrições." /> : error ? <StatePanel kind="error" title="Internação indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : episodes.length === 0 ? <StatePanel kind="empty" title="Nenhuma internação" body="Admita um paciente em leito para iniciar o episódio." /> : <div className="audit-list">{episodes.map((episode) => {
        const status = EPISODE_STATUS[episode.status] ?? { label: episode.status, tone: "slate" as const };
        return <div className="audit-row" key={episode.id}><span className="audit-result" aria-label={`Estado ${status.label}`}>{episode.status === "DISCHARGED" ? "✓" : "•"}</span><div><strong>{patientName(episode.patientId)} · {bedName(episode.bedId)}</strong><span>{episode.admittedAt ? `admitido ${formatDate(episode.admittedAt)}` : "aguardando leito"}{episode.dischargedAt ? ` · alta ${formatDate(episode.dischargedAt)}` : ""}</span>{episodeOrders(episode).map((order) => <span key={order.id}>{productName(order.productId)} · {order.dose} · {order.route} · {order.frequency} · {ORDER_STATUS[order.status]?.label ?? order.status}{orderDispensations(order.id).length > 0 ? ` · ${orderDispensations(order.id).length} dispensação(ões)` : ""}{orderAdministrations(order.id).length > 0 ? ` · ${orderAdministrations(order.id).map((administration) => ADMIN_STATUS[administration.status] ?? administration.status).join(", ")}` : ""}</span>)}</div><div className="audit-meta"><StatusBadge tone={status.tone}>{status.label}</StatusBadge><small>
          {episode.status !== "DISCHARGED" && canStatus && <>{episode.status === "ADMITTED" && <button className="text-button" type="button" onClick={() => void changeEpisodeStatus(episode, "PROCEDURE")}>Procedimento</button>}{" "}{episode.status === "PROCEDURE" && <button className="text-button" type="button" onClick={() => void changeEpisodeStatus(episode, "RECOVERY")}>Recuperação</button>}{" "}{episode.status === "RECOVERY" && <button className="text-button" type="button" onClick={() => void changeEpisodeStatus(episode, "ADMITTED")}>Retornar ao leito</button>}{" "}</>}
          {episode.status !== "DISCHARGED" && <button className="text-button" type="button" onClick={() => openDialog({ kind: "prescribe", episode })} disabled={!canPrescribe} aria-describedby={canPrescribe ? undefined : "prescribe-restriction"}>Prescrever</button>}{" "}
          {episode.status !== "DISCHARGED" && <button className="text-button" type="button" onClick={() => openDialog({ kind: "discharge", episode })} disabled={!canDischarge} aria-describedby={canDischarge ? undefined : "discharge-restriction"}>Alta</button>}
        </small>
        {!canPrescribe && <small id="prescribe-restriction">Prescrição exige role veterinário.</small>}
        {!canDischarge && <small id="discharge-restriction">Alta exige role veterinário.</small>}
        {episodeOrders(episode).map((order) => <small key={order.id}>
          {order.status === "ACTIVE" && <><button className="text-button" type="button" onClick={() => openDialog({ kind: "dispense", order })} disabled={!canDispense} aria-describedby={canDispense ? undefined : "dispense-restriction"}>Dispensar</button>{" "}<button className="text-button" type="button" onClick={() => openDialog({ kind: "administer", order })} disabled={!canAdminister} aria-describedby={canAdminister ? undefined : "administer-restriction"}>Administrar</button>{" "}</>}
          {canPrescribe && order.status !== "COMPLETED" && <>{order.status !== "SUSPENDED" && <button className="text-button" type="button" onClick={() => void changeOrderStatus(order, "SUSPENDED")}>Suspender</button>}{" "}{order.status === "SUSPENDED" && <button className="text-button" type="button" onClick={() => void changeOrderStatus(order, "ACTIVE")}>Reativar</button>}{" "}<button className="text-button" type="button" onClick={() => void changeOrderStatus(order, "COMPLETED")}>Concluir</button></>}
          {!canDispense && order.status === "ACTIVE" && <span id="dispense-restriction">Dispensação exige role admin/estoque.</span>}
          {!canAdminister && order.status === "ACTIVE" && <span id="administer-restriction">Administração exige role veterinário.</span>}
        </small>)}
        </div></div>;
      })}</div>}

      {dialog?.kind === "admit" && <Dialog titleId="hospital-admit-title" title="Nova internação" description="Leito disponível admite imediatamente; sem leito o episódio fica planejado e não avança." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitAdmit} className="dialog-form">
          <label htmlFor="hospital-patient">Paciente<select id="hospital-patient" value={patientId} onChange={(event) => { setPatientId(event.target.value); setEncounterId(""); }} required><option value="">Selecione…</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.species}</option>)}</select></label>
          <label htmlFor="hospital-encounter">Atendimento<select id="hospital-encounter" value={encounterId} onChange={(event) => setEncounterId(event.target.value)} required><option value="">Selecione…</option>{encounterOptions.map((encounter) => <option key={encounter.id} value={encounter.id}>{encounter.patient?.name ?? "Atendimento"} · {encounter.id.slice(0, 8)}</option>)}</select></label>
          <label htmlFor="hospital-bed">Leito<select id="hospital-bed" value={bedId} onChange={(event) => setBedId(event.target.value)}><option value="">Sem leito (planejada)</option>{availableBeds.map((bed) => <option key={bed.id} value={bed.id}>{bed.name}</option>)}</select></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Escrita idempotente · auditada</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Internar"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "prescribe" && <Dialog titleId="hospital-prescribe-title" title={`Prescrever para ${patientName(dialog.episode.patientId)}`} description="Prescrição, dispensação e administração são fatos distintos com autoria e horário." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitPrescribe} className="dialog-form">
          <label htmlFor="hospital-product">Produto<select id="hospital-product" value={productId} onChange={(event) => setProductId(event.target.value)} required><option value="">Selecione…</option>{[...new Map(stock.filter((item) => item.product).map((item) => [item.product!.id, item.product!])).values()].map((product) => <option key={product.id} value={product.id}>{product.name} · {product.unit}</option>)}</select></label>
          <label htmlFor="hospital-dose">Dose<input id="hospital-dose" value={dose} onChange={(event) => setDose(event.target.value)} required minLength={1} maxLength={120} /></label>
          <label htmlFor="hospital-route">Via<input id="hospital-route" value={route} onChange={(event) => setRoute(event.target.value)} required minLength={2} maxLength={80} /></label>
          <label htmlFor="hospital-frequency">Frequência<input id="hospital-frequency" value={frequency} onChange={(event) => setFrequency(event.target.value)} required minLength={2} maxLength={120} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Ordem inválida ou produto ausente são negados</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Prescrevendo…" : "Criar prescrição"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "dispense" && <Dialog titleId="hospital-dispense-title" title={`Dispensar ${productName(dialog.order.productId)}`} description="A dispensação baixa o lote do estoque e registra quem dispensou; lote de outro produto ou saldo insuficiente são negados." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitDispense} className="dialog-form">
          <label htmlFor="hospital-lot">Lote<select id="hospital-lot" value={lotId} onChange={(event) => setLotId(event.target.value)} required><option value="">Selecione…</option>{stock.filter((item) => item.product?.id === dialog.order.productId && item.quantity > 0).map((item) => <option key={item.id} value={item.id}>{item.lotNumber} · saldo {item.quantity}</option>)}</select></label>
          <label htmlFor="hospital-quantity">Quantidade<input id="hospital-quantity" type="number" min={1} step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Movimento de estoque auditado</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Dispensando…" : "Confirmar dispensação"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "administer" && <Dialog titleId="hospital-administer-title" title={`Administrar ${productName(dialog.order.productId)}`} description="Cada administração é um fato com autor e horário; duplo envio no mesmo minuto é negado pelo servidor." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitAdminister} className="dialog-form">
          <label htmlFor="hospital-admin-status">Resultado da administração<select id="hospital-admin-status" value={administrationStatus} onChange={(event) => setAdministrationStatus(event.target.value as typeof administrationStatus)}><option value="ADMINISTERED">Administrada</option><option value="OMITTED">Omitida</option><option value="REFUSED">Recusada</option></select></label>
          <label htmlFor="hospital-admin-note">Nota (opcional)<input id="hospital-admin-note" value={administrationNote} onChange={(event) => setAdministrationNote(event.target.value)} maxLength={500} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Dose, ordem e horário preservados</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando…" : "Registrar administração"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "discharge" && <Dialog titleId="hospital-discharge-title" title={`Alta de ${patientName(dialog.episode.patientId)}`} description="A alta exige documento de alta assinado e nenhuma prescrição ativa sem administração registrada." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitDischarge} className="dialog-form">
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">{bedName(dialog.episode.bedId)} · pendências são negadas com razão</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Registrando alta…" : "Confirmar alta"}</button></div>
        </form>
      </Dialog>}
    </>
  );
}
