/* Ajustes (web): índice a la izquierda, un panel a la derecha. */

import { navigate } from '../../../core/router';
import { AppearancePanel, DevicesPanel, FootballPanel, HealthPanel, ListsPanel, PlaybackPanel, WherePanel } from '../components/Settings';
import { IcBall, IcHeart, IcList, IcPhone, IcPlay, IcSwap, IcTv } from '../components/icons';

export type SettingsSection = 'dispositivos' | 'donde' | 'listas' | 'reproduccion' | 'apariencia' | 'futbol' | 'salud';

export const SECTIONS: { id: SettingsSection; label: string; hint: string; Icon: typeof IcPhone }[] = [
  { id: 'dispositivos', label: 'Dispositivos', hint: 'Empareja un iPhone o revoca uno.', Icon: IcPhone },
  { id: 'donde', label: 'Dónde se está reproduciendo', hint: 'Qué suena y en qué dispositivos.', Icon: IcTv },
  { id: 'listas', label: 'Listas', hint: 'Tus listas de canales y cuál está en uso.', Icon: IcList },
  { id: 'reproduccion', label: 'Reproducción', hint: 'Modo y quién se queda el mando.', Icon: IcPlay },
  { id: 'apariencia', label: 'Apariencia', hint: 'Tema, transparencia y movimiento.', Icon: IcSwap },
  { id: 'futbol', label: 'Tu fútbol', hint: 'Lo que hace que un partido sea «para ti».', Icon: IcBall },
  { id: 'salud', label: 'Salud', hint: 'Motor, comprobador, agenda y listas.', Icon: IcHeart },
];

export function WebSettings({ section }: { section: string | null }) {
  const current: SettingsSection = (SECTIONS.find((s) => s.id === section)?.id ?? 'dispositivos') as SettingsSection;
  const meta = SECTIONS.find((s) => s.id === current)!;
  return (
    <div className="tr-settings">
      <nav className="tr-settings-nav" aria-label="Ajustes">
        <h1>Ajustes</h1>
        {SECTIONS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={id === current ? 'is-on' : ''} onClick={() => navigate('ajustes', id, null, { replace: true })} aria-current={id === current ? 'page' : undefined}>
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <section className="tr-settings-panel" aria-labelledby="tr-settings-title">
        <header className="tr-settings-head">
          <h2 id="tr-settings-title">{meta.label}</h2>
          <p>{meta.hint}</p>
        </header>
        {current === 'dispositivos' && <DevicesPanel mode="web" />}
        {current === 'donde' && <WherePanel onOpenAgenda={() => navigate('agenda')} />}
        {current === 'listas' && <ListsPanel mode="web" />}
        {current === 'reproduccion' && <PlaybackPanel />}
        {current === 'apariencia' && <AppearancePanel />}
        {current === 'futbol' && <FootballPanel onEdit={() => navigate('gustos')} />}
        {current === 'salud' && <HealthPanel />}
      </section>
    </div>
  );
}
