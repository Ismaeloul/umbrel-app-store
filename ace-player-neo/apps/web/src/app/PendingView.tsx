/* Marcador para una vista cuyo src/features/<vista>/index.tsx aún no existe
   (las construyen otros agentes a la vez). La app arranca y navega igual. */

import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { SkeletonRows } from '../ui/Skeleton.tsx';
import type { ViewProps } from './contracts.ts';
import { useNavigate } from './router.tsx';
import { VISTA_TITLE } from './routes.ts';
import { ViewHeader } from './ViewHeader.tsx';

export function PendingView({ route }: ViewProps) {
  const navigate = useNavigate();
  const title = VISTA_TITLE[route.vista];
  return (
    <div className="view-pending">
      <ViewHeader title={title} />
      <EmptyState
        title={`${title}: en construcción`}
        actions={
          route.vista === 'agenda' ? (
            <Button
              variant="quiet"
              icon="biblioteca"
              onClick={() => navigate({ vista: 'biblioteca' })}
            >
              Ir a la biblioteca
            </Button>
          ) : (
            <Button variant="quiet" icon="agenda" onClick={() => navigate({ vista: 'agenda' })}>
              Ir a la agenda
            </Button>
          )
        }
      >
        Esta vista llega en la siguiente entrega de la Fase 2. El armazón, la navegación y los datos
        ya funcionan.
      </EmptyState>
      <SkeletonRows rows={3} label={`${title} en construcción`} />
    </div>
  );
}
