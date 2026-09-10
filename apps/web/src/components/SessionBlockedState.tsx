import { Icon } from "./Icon";
import { RUNTIME_STATES, type RuntimeState } from "../state/runtime-state";
import type { ContextOption } from "../state/types";

export function SessionBlockedState({ runtimeState, contexts, context, onContextChange, onReset }: { runtimeState: RuntimeState; contexts: ContextOption[]; context: ContextOption | null; onContextChange: (context: ContextOption) => void; onReset: () => void }) {
  const reauth = runtimeState === RUNTIME_STATES.REAUTH_REQUIRED;
  const permission = runtimeState === RUNTIME_STATES.PERMISSION_DENIED;
  const hasAlternateContext = permission && contexts.length > 1 && context !== null;
  const label = reauth ? RUNTIME_STATES.REAUTH_REQUIRED : permission ? RUNTIME_STATES.PERMISSION_DENIED : RUNTIME_STATES.CONTEXT_INVALID;
  const title = reauth ? "Sua sessão expirou." : permission ? "Acesso não autorizado." : "Contexto invalidado.";
  const body = reauth ? "A sessão não pôde ser confirmada. Entre novamente para resolver um espaço autorizado." : permission ? "Esta operação foi recusada pela policy atual. O CVG manteve os dados ocultos e não repetirá a solicitação automaticamente." : "O espaço autorizado mudou ou deixou de responder. O CVG ocultou os dados até uma nova resolução segura.";
  const action = permission ? "Revalidar acesso" : "Voltar ao login";
  return <main className="context-loading" aria-labelledby="session-blocked-title"><section className="offline-state"><div className="offline-state-icon"><Icon name={reauth ? "refresh" : "lock"} size={22} /></div><span className="eyebrow">{label}</span><h1 id="session-blocked-title">{title}</h1><p>{body}</p>{hasAlternateContext && context && <label className="blocked-context-picker" htmlFor="blocked-context">Espaço autorizado<select id="blocked-context" value={`${context.unit.id}:${context.workspace.id}`} onChange={(event) => { const next = contexts.find((candidate) => `${candidate.unit.id}:${candidate.workspace.id}` === event.target.value); if (next) onContextChange(next); }}>{contexts.map((candidate) => <option key={`${candidate.unit.id}:${candidate.workspace.id}`} value={`${candidate.unit.id}:${candidate.workspace.id}`}>{candidate.unit.name} · {candidate.workspace.name}</option>)}</select></label>}<p className="offline-state-note">Nenhuma escrita crítica foi executada. {permission ? hasAlternateContext ? "Escolha outro espaço ou revalide o contexto atual antes de tentar outra operação." : "Revalide o contexto antes de tentar outra operação." : "Volte ao login para iniciar uma nova sessão."}</p><button className="button button-primary" type="button" onClick={onReset}>{action} <Icon name={permission ? "refresh" : "arrow"} size={16} /></button></section></main>;
}
