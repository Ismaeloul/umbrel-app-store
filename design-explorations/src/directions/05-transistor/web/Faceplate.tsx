/* Placa frontal del receptor: marca, cuatro teclas de navegación, luz del
   motor, reloj LCD y la tecla de ayuda. */

import { navigate, tabOf, type Screen } from '../../../core/router';
import { useSim } from '../../../core/store';
import { hhmm } from '../../../core/format';
import { IconKey, Key } from '../components/Key';
import { LcdTime } from '../components/Lcd';
import { IcAntenna, IcDial, IcKeyboard, IcPreset, IcSearch, IcSettings } from '../components/icons';
import { engineWord } from '../components/text';

const NAV: { id: 'agenda' | 'biblioteca' | 'buscar' | 'ajustes'; label: string; Icon: typeof IcDial }[] = [
  { id: 'agenda', label: 'Sintonía', Icon: IcDial },
  { id: 'biblioteca', label: 'Canales', Icon: IcPreset },
  { id: 'buscar', label: 'Buscar', Icon: IcSearch },
  { id: 'ajustes', label: 'Ajustes', Icon: IcSettings },
];

export function Faceplate({ screen, now, onHelp }: { screen: Screen; now: number; onHelp: () => void }) {
  const engine = useSim((s) => s.engine.status);
  const active = tabOf(screen);
  const tone = engine === 'online' ? 'green' : engine === 'restarting' ? 'yellow' : 'red';
  return (
    <header className="tr-face">
      <button type="button" className="tr-face-brand" onClick={() => navigate('agenda')} aria-label="Ace Player Neo · Sintonía">
        <IcAntenna size={22} />
        <b>ACE PLAYER</b>
        <span>NEO</span>
      </button>
      <nav className="tr-face-nav" aria-label="Secciones">
        {NAV.map(({ id, label, Icon }) => (
          <Key key={id} variant={active === id ? 'orange' : 'paper'} pressed={active === id} icon={<Icon size={18} />} onClick={() => navigate(id)} aria-current={active === id ? 'page' : undefined} className="tr-face-key">
            {label}
          </Key>
        ))}
      </nav>
      <div className="tr-face-right">
        <button type="button" className={`tr-engine tr-tone-${tone}`} onClick={() => navigate('ajustes', 'salud')} title="Salud del sistema">
          <i className={`tr-dot${engine === 'restarting' ? ' is-pulse' : ''}`} />
          <span>{engineWord(engine)}</span>
        </button>
        <span className="tr-face-clock" title="Hora">
          <LcdTime text={hhmm(now)} height={18} />
        </span>
        <IconKey label="Atajos de teclado (?)" icon={<IcKeyboard />} size={40} onClick={onHelp} />
      </div>
    </header>
  );
}
