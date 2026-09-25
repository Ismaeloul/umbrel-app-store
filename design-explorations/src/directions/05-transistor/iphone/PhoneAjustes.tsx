/* Ajustes (iPhone): lista agrupada en papel; cada sección se empuja. */

import { navigate } from '../../../core/router';
import { useSim } from '../../../core/store';
import { AppearancePanel, DevicesPanel, FootballPanel, HealthPanel, ListsPanel, PlaybackPanel, WherePanel } from '../components/Settings';
import { IcBall, IcChevronRight, IcHeart, IcList, IcPhone, IcPlay, IcSwap, IcTv } from '../components/icons';
import { engineWord, playbackModeLabel, prefsSummary } from '../components/text';
import { Dot } from '../components/Key';
import { NavBar, PageHead } from './NavBar';

const SECTIONS = {
  donde: { label: 'Dónde se está reproduciendo', Icon: IcTv },
  dispositivos: { label: 'Dispositivos', Icon: IcPhone },
  listas: { label: 'Listas', Icon: IcList },
  reproduccion: { label: 'Reproducción', Icon: IcPlay },
  apariencia: { label: 'Apariencia', Icon: IcSwap },
  salud: { label: 'Salud', Icon: IcHeart },
} as const;
type SectionId = keyof typeof SECTIONS;

export function PhoneAjustes() {
  const sessions = useSim((s) => s.sessions);
  const devices = useSim((s) => s.devices.filter((d) => !d.revokedAt).length);
  const dirs = useSim((s) => s.directories);
  const mode = useSim((s) => s.playbackMode);
  const theme = useSim((s) => s.theme);
  const engine = useSim((s) => s.engine.status);
  const prefs = useSim((s) => s.preferences);
  const target = useSim((s) => s.player.target);
  const hints: Record<SectionId, string> = {
    donde: sessions.length || target ? `${sessions.length + (target ? 1 : 0)} ${sessions.length + (target ? 1 : 0) === 1 ? 'sesión' : 'sesiones'} ahora` : 'Nada sonando',
    dispositivos: `${devices} ${devices === 1 ? 'emparejado' : 'emparejados'}`,
    listas: `${dirs.length} · en uso: ${dirs.find((d) => d.id === useSimActive(dirs))?.name ?? ''}`,
    reproduccion: playbackModeLabel(mode),
    apariencia: theme === 'sistema' ? 'Sistema' : theme === 'claro' ? 'Claro' : 'Oscuro',
    salud: engineWord(engine),
  };
  const row = (id: SectionId) => {
    const { label, Icon } = SECTIONS[id];
    return (
      <button key={id} type="button" className="tr-setrow" onClick={() => navigate('ajustes', id)}>
        <span className="tr-setrow-ic">
          <Icon size={20} />
        </span>
        <span className="tr-setrow-text">
          <span>{label}</span>
          <small>
            {id === 'salud' && <Dot tone={engine === 'online' ? 'green' : engine === 'restarting' ? 'yellow' : 'red'} />} {hints[id]}
          </small>
        </span>
        <IcChevronRight size={18} className="tr-setrow-chev" />
      </button>
    );
  };
  return (
    <div className="tr-ph-ajustes">
      <PageHead title="Ajustes" />
      <div className="tr-ph-body">
        <div className="tr-setgroup">{row('donde')}{row('dispositivos')}</div>
        <div className="tr-setgroup">
          <button type="button" className="tr-setrow" onClick={() => navigate('gustos')}>
            <span className="tr-setrow-ic">
              <IcBall size={20} />
            </span>
            <span className="tr-setrow-text">
              <span>Tu fútbol</span>
              <small>{prefsSummary(prefs.leagues, prefs.teams, prefs.nationalities)}</small>
            </span>
            <IcChevronRight size={18} className="tr-setrow-chev" />
          </button>
          {row('listas')}
          {row('reproduccion')}
          {row('apariencia')}
        </div>
        <div className="tr-setgroup">{row('salud')}</div>
        <p className="tr-ph-foot">Ace Player Neo · versión 0.7.1 · prototipo «Transistor»</p>
      </div>
    </div>
  );
}

function useSimActive(dirs: { id: string }[]): string {
  const active = useSim((s) => s.activeDirectoryId);
  return dirs.some((d) => d.id === active) ? active : dirs[0]?.id ?? '';
}

export function PhoneAjustesSection({ section }: { section: string }) {
  const id = (section in SECTIONS ? section : 'donde') as SectionId;
  const { label } = SECTIONS[id];
  return (
    <div className="tr-ph-ajsec">
      <NavBar title={label} backLabel="Ajustes" fallback="ajustes" />
      <div className="tr-ph-body">
        {id === 'donde' && <WherePanel onOpenAgenda={() => navigate('agenda')} />}
        {id === 'dispositivos' && <DevicesPanel mode="phone" />}
        {id === 'listas' && <ListsPanel mode="phone" />}
        {id === 'reproduccion' && <PlaybackPanel />}
        {id === 'apariencia' && <AppearancePanel />}
        {id === 'salud' && <HealthPanel />}
      </div>
    </div>
  );
}

export { FootballPanel };
