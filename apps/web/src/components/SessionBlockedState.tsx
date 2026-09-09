import { Icon } from "./Icon";
import { RUNTIME_STATES, type RuntimeState } from "../state/runtime-state";

export function SessionBlockedState({ runtimeState, onReset }: { runtimeState: RuntimeState; onReset: () => void }) {
  const reauth = runtimeState === RUNTIME_STATES.REAUTH_REQUIRED;
  return <main className="context-loading" aria-labelledby="session-blocked-title"><section className="offline-state"><div className="offline-state-icon"><Icon name={reauth ? "refresh" : "lock"} size={22} /></div><span className="eyebrow">{reauth ? RUNTIME_STATES.REAUTH_REQUIRED : RUNTIME_STATES.CONTEXT_INVALID}</span><h1 id="session-blocked-title">{reauth ? "Sua sessão precisa voltar ao foco." : "Contexto invalidado."}</h1><p>{reauth ? "A sessão não pôde ser confirmada. Entre novamente para resolver um espaço autorizado." : "O espaço autorizado mudou ou deixou de responder. O CVG ocultou os dados até uma nova resolução segura."}</p><p className="offline-state-note">Nenhuma escrita crítica foi executada. Volte ao login para iniciar uma nova sessão.</p><button className="button button-primary" type="button" onClick={onReset}>Voltar ao login <Icon name="arrow" size={16} /></button></section></main>;
}
