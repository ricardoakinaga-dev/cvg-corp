import { Icon } from "./Icon";
import { runtimeStatePresentation, RUNTIME_STATES, type RuntimeState } from "../state/runtime-state";

export function OfflineReadOnlyState({ runtimeState, hasComposerBuffer }: { runtimeState: RuntimeState; hasComposerBuffer: boolean }) {
  const presentation = runtimeStatePresentation(runtimeState);
  const title = runtimeState === RUNTIME_STATES.DEGRADED ? "Conectividade parcial." : "Conexão interrompida.";
  const body = runtimeState === RUNTIME_STATES.DEGRADED
    ? "O CVG mantém o contexto protegido enquanto dependências se recuperam. Leituras podem falhar e nenhuma escrita crítica será enviada."
    : "Este contexto não possui cache offline autorizado para exibição. O CVG ocultou os dados até revalidar sessão, escopo e policy.";
  return <section className="offline-state" aria-labelledby="offline-title"><div className="offline-state-icon"><Icon name="lock" size={22} /></div><span className="eyebrow">{presentation.label}</span><h1 id="offline-title">{title}</h1><p>{body}</p><div className="offline-state-grid"><div><span>Leitura</span><strong>{runtimeState === RUNTIME_STATES.DEGRADED ? "Disponível enquanto a dependência responder" : "Somente cache D0–D2 autorizado"}</strong></div><div><span>Ações</span><strong>Bloqueadas até sincronização explícita</strong></div><div><span>Buffer do composer</span><strong>{hasComposerBuffer ? "Preservado em memória, oculto" : "Nenhum buffer local"}</strong></div></div><p className="offline-state-note">Ao reconectar, a aplicação chama /me e /contexts antes de confirmar o conteúdo. Recarregar, sair ou perder a sessão descarta o buffer volátil.</p></section>;
}
