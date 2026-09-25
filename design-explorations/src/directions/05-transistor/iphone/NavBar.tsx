/* Cabeceras del iPhone: título grande de pestaña y barra de navegación de
   las pantallas empujadas (con tecla de volver). */

import type { ReactNode } from 'react';
import { back, type Screen } from '../../../core/router';
import { Key } from '../components/Key';
import { IcChevronLeft } from '../components/icons';

export function PageHead({ title, sub, aside }: { title: string; sub?: string; aside?: ReactNode }) {
  return (
    <header className="tr-ph-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="tr-ph-head-sub">{sub}</div>}
      </div>
      {aside && <div className="tr-ph-head-aside">{aside}</div>}
    </header>
  );
}

export function NavBar({ title, backLabel = 'Atrás', fallback = 'agenda', right }: { title?: string; backLabel?: string; fallback?: Screen; right?: ReactNode }) {
  return (
    <header className="tr-ph-nav">
      <Key variant="ghost" size="sm" icon={<IcChevronLeft size={16} />} onClick={() => back(fallback)} className="tr-ph-nav-back">
        {backLabel}
      </Key>
      <span className="tr-ph-nav-title">{title}</span>
      <div className="tr-ph-nav-right">{right}</div>
    </header>
  );
}
