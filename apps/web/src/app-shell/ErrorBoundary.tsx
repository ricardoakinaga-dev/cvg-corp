import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { currentCorrelationId } from "../api/correlation";
import { emitRootErrorTelemetry } from "../api/telemetry";

interface RootErrorBoundaryProps {
  children: ReactNode;
}

interface RootErrorBoundaryState {
  failed: boolean;
  attempt: number;
  errorCorrelationId: string | null;
}

/**
 * CVG-AUD19-019: root error boundary.  An unexpected render error never leaves
 * a blank screen, never exposes a stack or clinical data, announces itself
 * through an assertive live region, moves focus to the recovery panel and
 * offers a retry plus a safe route back to the start.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  override state: RootErrorBoundaryState = { failed: false, attempt: 0, errorCorrelationId: null };

  static getDerivedStateFromError(): Partial<RootErrorBoundaryState> {
    return { failed: true };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (typeof window !== "undefined") delete (window as Window & { __CVG_TEST_ROOT_ERROR__?: boolean }).__CVG_TEST_ROOT_ERROR__;
    const event = emitRootErrorTelemetry(error);
    this.setState({ errorCorrelationId: event.correlationId });
  }

  private retry = (): void => {
    this.setState((current) => ({ failed: false, attempt: current.attempt + 1, errorCorrelationId: null }));
  };

  private goHome = (): void => {
    if (typeof window !== "undefined") window.location.assign("/");
  };

  private focusPanel = (node: HTMLDivElement | null): void => {
    node?.focus();
  };

  override render(): ReactNode {
    if (!this.state.failed) return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
    const correlationId = this.state.errorCorrelationId ?? currentCorrelationId() ?? "indisponível";
    return (
      <div className="app-shell error-boundary" role="alert" aria-live="assertive" tabIndex={-1} ref={this.focusPanel} data-testid="root-error-boundary">
        <main className="content">
          <h1>Algo saiu do previsto.</h1>
          <p>Não foi possível exibir esta tela. Nenhum dado foi alterado. Tente novamente ou volte ao início.</p>
          <p>
            Referência para suporte: <code>{correlationId}</code>
          </p>
          <div className="error-boundary-actions">
             <button className="button button-primary" type="button" onClick={this.retry}>Tentar novamente</button>
             <button className="button button-ghost" type="button" onClick={this.goHome}>Voltar ao início</button>
          </div>
        </main>
      </div>
    );
  }
}
