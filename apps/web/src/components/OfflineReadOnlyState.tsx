import { Icon } from "./Icon";
import { runtimeStatePresentation, RUNTIME_STATES, type RuntimeState } from "../state/runtime-state";

export function OfflineReadOnlyState({ runtimeState, hasComposerBuffer, onRetry }: { runtimeState: RuntimeState; hasComposerBuffer: boolean; onRetry?: () => void }) {
  const presentation = runtimeStatePresentation(runtimeState);
  const revalidating = runtimeState === RUNTIME_STATES.REVALIDATING;
  const degraded = runtimeState === RUNTIME_STATES.DEGRADED;
  const title = revalidating ? "Confirmando seu contexto." : degraded ? "Conectividade parcial." : "Conexão interrompida.";
  const body = revalidating
    ? "A sessão, o escopo e a policy estão sendo confirmados. O CVG mantém dados e composer ocultos até concluir a revalidação."
    : degraded
      ? "O CVG mantém o contexto protegido enquanto dependências se recuperam. Leituras e escritas críticas permanecem bloqueadas."
    : "Este contexto não possui cache offline autorizado para exibição. O CVG ocultou os dados até revalidar sessão, escopo e policy.";
  return <section className="offline-state" aria-labelledby="offline-title"><div className="offline-state-icon"><Icon name={revalidating ? "refresh" : "lock"} size={22} /></div><span className="eyebrow">{presentation.label}</span><h1 id="offline-title">{title}</h1><p>{body}</p><div className="offline-state-grid"><div><span>Leitura</span><strong>{revalidating || degraded ? "Oculta até a autoridade responder" : "Somente cache D0–D2 autorizado"}</strong></div><div><span>Ações</span><strong>Bloqueadas até sincronização explícita</strong></div><div><span>Buffer do composer</span><strong>{hasComposerBuffer ? "Preservado em memória, oculto" : "Nenhum buffer local"}</strong></div></div>{degraded && onRetry && <button className="button button-primary" type="button" onClick={onRetry}><Icon name="refresh" size={16} />Tentar revalidar</button>}<p className="offline-state-note">Ao reconectar, a aplicação chama /me e /contexts antes de confirmar o conteúdo. Falha de revalidação, recarregamento, saída ou perda da sessão descarta o buffer volátil.</p></section>;
}
