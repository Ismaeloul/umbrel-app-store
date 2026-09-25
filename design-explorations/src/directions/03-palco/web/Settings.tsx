/* Ajustes (web): índice a la izquierda, una sección a la vez a la derecha. */

import { navigate } from '../../../core/router';
import { useSim } from '../../../core/store';
import { Icon } from '../components/icons';
import { Button } from '../components/primitives';
import { SETTINGS_SECTIONS, SettingsBody, type SettingsSectionId } from '../components/settings';

export function Settings({ sub, onHelp }: { sub: string | null; onHelp: () => void }) {
  const id = (SETTINGS_SECTIONS.some((s) => s.id === sub) ? sub : 'dispositivos') as SettingsSectionId;
  const engine = useSim((s) => s.engine.status);
  const sessions = useSim((s) => s.sessions);
  const current = SETTINGS_SECTIONS.find((s) => s.id === id)!;
  return (
    <div className="pl-page pl-settings">
      <header className="pl-page__head">
        <div>
          <span className="pl-eyebrow">Ace Player Neo</span>
          <h1 className="pl-page__title">Ajustes</h1>
        </div>
        <Button variant="quiet" size="sm" icon="keyboard" onClick={onHelp}>
          Atajos de teclado
        </Button>
      </header>
      <div className="pl-settings__grid">
        <nav className="pl-settings__nav" aria-label="Secciones">
          {SETTINGS_SECTIONS.map((s) => (
            <button key={s.id} type="button" className={`pl-settings__item${s.id === id ? ' is-on' : ''}`} onClick={() => navigate('ajustes', s.id, null, { replace: true })} aria-current={s.id === id ? 'page' : undefined}>
              <span className="pl-settings__icon">
                <Icon name={s.icon} size={18} />
              </span>
              <span className="pl-settings__text">
                <span>{s.label}</span>
                <span className="pl-settings__hint">{s.hint}</span>
              </span>
              {s.id === 'salud' && engine !== 'online' && <span className="pl-settings__badge is-warn" aria-label="Atención" />}
              {s.id === 'donde' && sessions.length > 0 && <span className="pl-settings__badge is-live" aria-label="Hay una sesión en marcha" />}
            </button>
          ))}
          <p className="pl-settings__version">Versión 0.7.1 · exploración «Palco»</p>
        </nav>
        <section className="pl-settings__body" aria-labelledby="pl-settings-h">
          <h2 id="pl-settings-h" className="pl-settings__h">
            {current.label}
          </h2>
          <SettingsBody id={id} onOpenAgenda={() => navigate('agenda')} onEditPrefs={() => navigate('gustos')} />
        </section>
      </div>
    </div>
  );
}
