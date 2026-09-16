import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient } from "../../api/client";
import { Icon } from "../../components/Icon";
import { PageHeader, StatePanel, StatusBadge } from "../../components/ui";
import { formatDate } from "../../state/formatters";
import type { ContextOption } from "../../state/types";

type KnowledgeDocument = { id: string; title: string; source: string; dataClass: string; version: number; status: string; content?: string; createdAt: string };
type KnowledgeChunk = { index: number; text: string; checksum: string };
type KnowledgeIndex = { document: { id: string; title: string; source: string; version: number; dataClass: string; status: string; checksum: string }; chunks: KnowledgeChunk[] };
type KnowledgeSearchHit = KnowledgeIndex & { score: number };
type DialogState = { kind: "create" } | { kind: "quarantine"; document: KnowledgeDocument } | { kind: "index"; document: KnowledgeDocument } | null;

const DOC_STATUS: Record<string, { label: string; tone: "teal" | "amber" | "coral" | "slate" }> = {
  DRAFT: { label: "Rascunho", tone: "slate" },
  APPROVED: { label: "Aprovado", tone: "amber" },
  INDEXING: { label: "Indexando", tone: "amber" },
  INDEXED: { label: "Indexado", tone: "teal" },
  QUARANTINED: { label: "Quarentena", tone: "coral" }
};

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
  return <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !closeDisabled) onClose(); }}><section ref={cardRef} className="dialog-card" style={{ maxHeight: "min(88vh, 760px)", overflowY: "auto" }} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`}><div className="dialog-head"><div><span className="eyebrow">CONHECIMENTO</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled}><Icon name="close" size={17} /></button></div><p id={`${titleId}-description`} className="dialog-description">{description}</p>{children}</section></div>;
}

export function Knowledge({ client, context, notify }: { client: ApiClient; context: ContextOption | null; notify: (message: string) => void }) {
  const canManage = (context?.roles ?? []).some((role) => role === "admin" || role === "veterinario");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [indexView, setIndexView] = useState<KnowledgeIndex | null>(null);
  const [receipt, setReceipt] = useState<{ label: string; receiptId: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [dataClass, setDataClass] = useState("D1");
  const [content, setContent] = useState("");
  const [quarantineReason, setQuarantineReason] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const submissionKey = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const indexRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError("");
    try {
      const response = await client.get<{ items: KnowledgeDocument[] }>("/knowledge", context);
      if (requestId === loadRequestRef.current) setDocuments(response.items);
    } catch (reason) {
      if (requestId === loadRequestRef.current) setError(reason instanceof Error ? reason.message : "Conhecimento indisponível.");
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [client, context]);

  useEffect(() => { void load(); }, [load]);

  const openDialog = (next: Exclude<DialogState, null>) => {
    submissionKey.current = null;
    setFormError("");
    setDialog(next);
    if (next.kind === "create") { setTitle(""); setSource(""); setDataClass("D1"); setContent(""); }
    if (next.kind === "quarantine") setQuarantineReason("");
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

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ document: KnowledgeDocument; receiptId: string }>("/knowledge", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ title, source, dataClass, content })
      }, context);
      finish(`Rascunho ${result.document.title} criado (não recuperável até aprovação e indexação)`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Documento não criado."); }
    finally { setSubmitting(false); }
  };

  const transition = async (document: KnowledgeDocument, action: "approve" | "index") => {
    submissionKey.current = null;
    try {
      const result = await client.request<{ document: KnowledgeDocument; receiptId: string }>(`/knowledge/${encodeURIComponent(document.id)}/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ expectedVersion: document.version })
      }, context);
      setReceipt({ label: `${result.document.title} agora está ${DOC_STATUS[result.document.status]?.label ?? result.document.status}`, receiptId: result.receiptId });
      submissionKey.current = null;
      await load();
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Transição não concluída.");
    }
  };

  const submitQuarantine = async (event: FormEvent) => {
    event.preventDefault();
    if (dialog?.kind !== "quarantine") return;
    setSubmitting(true);
    setFormError("");
    try {
      const result = await client.request<{ document: KnowledgeDocument; receiptId: string }>(`/knowledge/${encodeURIComponent(dialog.document.id)}/quarantine`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ reason: quarantineReason, expectedVersion: dialog.document.version })
      }, context);
      finish(`${result.document.title} em quarentena e fora da recuperação`, result.receiptId);
    } catch (reason) { setFormError(reason instanceof Error ? reason.message : "Quarentena não registrada."); }
    finally { setSubmitting(false); }
  };

  const openIndex = async (document: KnowledgeDocument) => {
    const requestId = ++indexRequestRef.current;
    try {
      const index = await client.get<KnowledgeIndex>(`/knowledge/${encodeURIComponent(document.id)}/index`, context);
      if (requestId === indexRequestRef.current) setIndexView(index);
    } catch (reason) {
      if (requestId === indexRequestRef.current) notify(reason instanceof Error ? reason.message : "Índice indisponível.");
    }
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const requestId = ++searchRequestRef.current;
    setSearching(true);
    setError("");
    try {
      const response = await client.get<{ items: KnowledgeSearchHit[] }>(`/knowledge/search?q=${encodeURIComponent(query)}`, context);
      if (requestId === searchRequestRef.current) setHits(response.items);
    } catch (reason) {
      if (requestId === searchRequestRef.current) setError(reason instanceof Error ? reason.message : "Busca indisponível.");
    } finally {
      if (requestId === searchRequestRef.current) setSearching(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="BASE APROVADA" title="Conhecimento governado" description="Documentos aprovados, indexados e recuperados somente no escopo autorizado." action="Novo documento" onAction={() => openDialog({ kind: "create" })} actionDisabled={!canManage} />
      {receipt && <p className="table-sub" role="status">Recibo {receipt.receiptId} · {receipt.label}</p>}
      {!canManage && <p className="table-sub" role="status">Gestão de conhecimento exige role admin/veterinário; a busca permanece disponível.</p>}
      <form onSubmit={search} className="toolbar">
        <label className="search-field"><Icon name="search" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar em documentos aprovados e indexados" aria-label="Buscar conhecimento" /></label>
        <button className="button button-ghost" type="submit" disabled={searching || query.trim().length < 2}>{searching ? "Buscando…" : "Buscar"}</button>
        {hits !== null && <button className="button button-ghost" type="button" onClick={() => { setHits(null); setQuery(""); }}>Limpar</button>}
      </form>
      {hits !== null && <section className="surface">
        <div className="surface-head"><div><span className="eyebrow">RETRIEVAL COM ACL</span><h2>Trechos recuperados</h2></div><StatusBadge tone={hits.length ? "teal" : "slate"}>{hits.length} documento(s)</StatusBadge></div>
        {hits.length === 0 ? <StatePanel kind="empty" title="Nada recuperado" body="Somente documentos aprovados e indexados no escopo aparecem; rascunhos e quarentenados ficam fora." /> : <div className="audit-list">{hits.map((hit) => <div className="audit-row" key={hit.document.id}><span className="audit-result" aria-label="Documento indexado">✓</span><div><strong>{hit.document.title}</strong><span>{hit.document.source} · versão {hit.document.version} · {hit.document.dataClass} · checksum {hit.document.checksum.slice(0, 12)}…</span>{hit.chunks.map((chunk) => <span key={chunk.checksum}>[{chunk.index}] {chunk.text} · {chunk.checksum.slice(0, 10)}…</span>)}</div><div className="audit-meta"><small>{hit.chunks.length} trecho(s)</small></div></div>)}</div>}
      </section>}
      {loading ? <StatePanel kind="loading" title="Lendo conhecimento" body="Carregando documentos do escopo autorizado." /> : error ? <StatePanel kind="error" title="Conhecimento indisponível" body={error} action="Tentar novamente" onAction={() => void load()} /> : <section className="surface">
        <div className="surface-head"><div><span className="eyebrow">DOCUMENTOS</span><h2>Ingestão e admissão</h2></div><StatusBadge tone="slate">{documents.length} documentos</StatusBadge></div>
        {documents.length === 0 ? <StatePanel kind="empty" title="Nenhum documento" body="Crie um documento D0–D2; ele nasce como rascunho e não é recuperável." /> : <div className="audit-list">{documents.map((document) => {
          const status = DOC_STATUS[document.status] ?? { label: document.status, tone: "slate" as const };
          return <div className="audit-row" key={document.id}><span className="audit-result" aria-label={`Estado ${status.label}`}>{document.status === "INDEXED" ? "✓" : document.status === "QUARANTINED" ? "!" : "•"}</span><div><strong>{document.title}</strong><span>{document.source} · {document.dataClass} · versão {document.version} · {formatDate(document.createdAt)}</span></div><div className="audit-meta"><StatusBadge tone={status.tone}>{status.label}</StatusBadge><small>
            {canManage && document.status === "DRAFT" && <button className="text-button" type="button" onClick={() => void transition(document, "approve")}>Aprovar</button>}{" "}
            {canManage && document.status === "APPROVED" && <button className="text-button" type="button" onClick={() => void transition(document, "index")}>Indexar</button>}{" "}
            <button className="text-button" type="button" onClick={() => void openIndex(document)}>Ver índice</button>{" "}
            {canManage && document.status !== "QUARANTINED" && <button className="text-button" type="button" onClick={() => openDialog({ kind: "quarantine", document })}>Quarentenar</button>}
          </small></div></div>;
        })}</div>}
      </section>}

      {dialog?.kind === "create" && <Dialog titleId="knowledge-create-title" title="Novo documento" description="Conteúdo D0–D2 nasce como rascunho; só aprovação e indexação o tornam recuperável." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitCreate} className="dialog-form">
          <label htmlFor="knowledge-title">Título<input id="knowledge-title" value={title} onChange={(event) => setTitle(event.target.value)} required minLength={2} maxLength={180} /></label>
          <label htmlFor="knowledge-source">Origem<input id="knowledge-source" value={source} onChange={(event) => setSource(event.target.value)} required minLength={2} maxLength={200} /></label>
          <label htmlFor="knowledge-class">Classificação<select id="knowledge-class" value={dataClass} onChange={(event) => setDataClass(event.target.value)}><option value="D0">D0 · público</option><option value="D1">D1 · operacional</option><option value="D2">D2 · restrito</option></select></label>
          <label htmlFor="knowledge-content">Conteúdo<textarea id="knowledge-content" value={content} onChange={(event) => setContent(event.target.value)} required rows={8} maxLength={30000} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Origem e versão preservadas</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Criando…" : "Criar rascunho"}</button></div>
        </form>
      </Dialog>}

      {dialog?.kind === "quarantine" && <Dialog titleId="knowledge-quarantine-title" title={`Quarentenar ${dialog.document.title}`} description="A quarentena remove o documento da recuperação imediatamente e preserva o histórico." onClose={closeDialog} closeDisabled={submitting}>
        <form onSubmit={submitQuarantine} className="dialog-form">
          <label htmlFor="knowledge-quarantine-reason">Motivo<input id="knowledge-quarantine-reason" value={quarantineReason} onChange={(event) => setQuarantineReason(event.target.value)} required minLength={5} maxLength={300} /></label>
          {formError && <div className="inline-error" role="alert"><Icon name="alert" size={16} />{formError}</div>}
          <div className="dialog-foot"><span className="table-sub">Ação auditada</span><button className="button button-ghost" type="button" onClick={closeDialog} disabled={submitting}>Cancelar</button><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Quarentenando…" : "Confirmar quarentena"}</button></div>
        </form>
      </Dialog>}

      {indexView && <Dialog titleId="knowledge-index-title" title={`Índice derivado · ${indexView.document.title}`} description="Chunks e checksums derivados de conteúdo/versão; o mesmo documento sempre produz o mesmo índice." onClose={() => { indexRequestRef.current += 1; setIndexView(null); }}>
        <div className="dialog-form">
          <p className="table-sub">Documento checksum {indexView.document.checksum.slice(0, 20)}… · versão {indexView.document.version} · {indexView.chunks.length} chunks</p>
          <div className="audit-list">{indexView.chunks.map((chunk) => <div className="audit-row" key={chunk.checksum}><span className="audit-result" aria-label={`Chunk ${chunk.index}`}>{chunk.index}</span><div><strong>{chunk.text.slice(0, 120)}</strong><span>checksum {chunk.checksum.slice(0, 20)}…</span></div></div>)}</div>
          <div className="dialog-foot"><span className="table-sub">Derivado no momento da leitura</span><button className="button button-ghost" type="button" onClick={() => setIndexView(null)}>Fechar</button></div>
        </div>
      </Dialog>}
    </>
  );
}
