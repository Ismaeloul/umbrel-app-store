/* El panel lateral de fuentes del reproductor de escritorio (rediseño,
   pantalla 2): la píldora de la fuente que suena lo abre (player/
   source-panel.ts) y aquí se pintan todas las fuentes en filas, como en la
   pestaña Fuentes. Al salir del partido se cierra. */

import { useEffect } from 'react';
import { setSourcePanelOpen, useSourcePanelOpen } from '../../player/source-panel.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { SourcesPanel } from '../sources/SourcesPanel.tsx';

export function SourcesSheet() {
  const open = useSourcePanelOpen();
  useEffect(() => () => setSourcePanelOpen(false), []);
  return (
    <Sheet
      open={open}
      onClose={() => setSourcePanelOpen(false)}
      title="Fuentes"
      placement="side"
      size="md"
      className="mc-sources-sheet"
    >
      {open ? <SourcesPanel variant="line" className="mc-sources" /> : null}
    </Sheet>
  );
}
