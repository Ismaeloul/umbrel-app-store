/* Si una vista revienta al pintarse, solo cae esa vista: el armazón, la
   navegación y el reproductor siguen. Se enseña un estado de error con dos
   salidas (reintentar y volver a la agenda) y se deja el detalle en la
   consola. Un chunk que no se pudo descargar (la release cambió mientras la
   pestaña estaba abierta) se arregla recargando. */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Qué se ha caído («la agenda»), para el mensaje. */
  what: string;
  onHome?: () => void;
}

interface State {
  error: Error | null;
}

export function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
      error.message,
    )
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[vista] Ha fallado ${this.props.what}`, error, info.componentStack);
  }

  private readonly reset = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <EmptyState
        tone="error"
        title={stale ? 'Hay una versión nueva de la app' : `No se pudo enseñar ${this.props.what}`}
        actions={
          <>
            <Button
              variant="primary"
              icon="refresh"
              onClick={stale ? () => globalThis.location.reload() : this.reset}
            >
              {stale ? 'Recargar' : 'Reintentar'}
            </Button>
            {this.props.onHome && !stale ? (
              <Button variant="quiet" icon="agenda" onClick={this.props.onHome}>
                Ir a la agenda
              </Button>
            ) : null}
          </>
        }
      >
        {stale
          ? 'Se actualizó mientras la tenías abierta. Recarga para seguir.'
          : 'Algo ha fallado al pintar esta parte. Lo demás sigue funcionando.'}
      </EmptyState>
    );
  }
}
