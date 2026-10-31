/* Columna de la agenda junto al vídeo del partido (el armazón la monta en
   .app-column desde 1024 px; rediseño de escritorio, pantalla 1): la misma
   lista compacta por competición que la Agenda (DeskList), con el partido
   abierto resaltado. Comparte día y chip con la vista (state.ts). Tocar otro
   partido lo abre aquí al lado. */

import type { FootballMatch } from '@ace/shared';
import type { ViewProps } from '../../app/contracts.ts';
import { useNavigate } from '../../app/router.tsx';
import { DeskList } from './DeskList.tsx';

export default function AgendaColumn({ route, active }: ViewProps) {
  const navigate = useNavigate();
  const currentId = route.vista === 'partido' ? route.id : null;
  const open = (match: FootballMatch) => {
    if (match.id === currentId) return;
    navigate({ vista: 'partido', id: match.id, canal: null });
  };
  return (
    <div className="agenda-col">
      <h2 className="sr-only">Agenda</h2>
      <DeskList selectedId={currentId} active={active} onOpen={open} />
    </div>
  );
}
