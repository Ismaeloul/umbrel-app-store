/* Teclas del receptor bajo la pantalla: play/pausa, −30 s, Directo con tres
   estados, silencio, PiP, AirPlay, pantalla completa y detener. */

import { goLive, seekBack, setFullscreen, setMuted, stop, toast, togglePlay, useSim } from '../../../core/store';
import { IconKey, Key } from './Key';
import { IcAirplay, IcBack30, IcFull, IcLive, IcMute, IcPause, IcPip, IcPlay, IcShrink, IcSound, IcStop } from './icons';

export interface PlayerControlsProps {
  phone?: boolean;
  /** Compacto: sin etiquetas largas. */
  compact?: boolean;
  /** Sobre el vídeo (pantalla completa). */
  onVideo?: boolean;
  className?: string;
}

export function PlayerControls({ phone, compact, onVideo, className }: PlayerControlsProps) {
  const player = useSim((s) => s.player);
  const active = player.conn === 'activa';
  const engaged = player.conn !== 'idle' && player.conn !== 'error';
  const behind = Math.round(player.behindS);
  const atLive = active && player.media === 'playing' && player.behindS < 1.25;
  const paused = active && player.media === 'paused';

  let liveLabel = 'Directo';
  let liveVariant: 'orange' | 'paper' = 'orange';
  let liveAction = goLive;
  if (paused) {
    liveLabel = 'Reanudar';
    liveVariant = 'paper';
    liveAction = togglePlay;
  } else if (active && !atLive) {
    liveLabel = compact ? `−${behind} s` : `Ir al directo · −${behind} s`;
    liveVariant = 'paper';
  }

  const size = phone ? 44 : 40;
  const variant = onVideo ? 'ink' : 'paper';

  return (
    <div className={`tr-controls${onVideo ? ' is-onvideo' : ''}${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
      <div className="tr-controls-group">
        <IconKey
          label={player.media === 'playing' && active ? 'Pausa' : 'Reproducir'}
          icon={player.media === 'playing' && active ? <IcPause /> : <IcPlay />}
          size={size}
          variant={variant}
          disabled={!engaged && player.conn !== 'error'}
          onClick={togglePlay}
        />
        <IconKey label="Retroceder 30 segundos" icon={<IcBack30 />} size={size} variant={variant} disabled={!active} onClick={() => seekBack(30)} />
        <Key variant={active ? liveVariant : 'paper'} size={phone ? 'md' : 'sm'} pressed={atLive} icon={<IcLive size={16} />} disabled={!active} onClick={liveAction} className="tr-controls-live" title={active && !atLive && !paused ? `Vas ${behind} s por detrás del directo` : undefined}>
          {liveLabel}
        </Key>
      </div>
      <div className="tr-controls-group">
        <IconKey label={player.muted ? 'Quitar silencio' : 'Silencio'} icon={player.muted ? <IcMute /> : <IcSound />} size={size} variant={variant} pressed={player.muted} onClick={() => setMuted(!player.muted)} />
        <IconKey label="Imagen en imagen" icon={<IcPip />} size={size} variant={variant} disabled={!active} onClick={() => toast('Imagen en imagen (simulada en el prototipo)')} />
        {phone && <IconKey label="AirPlay" icon={<IcAirplay />} size={size} variant={variant} disabled={!active} onClick={() => toast('AirPlay (simulado en el prototipo)')} />}
        <IconKey label={player.fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} icon={player.fullscreen ? <IcShrink /> : <IcFull />} size={size} variant={variant} disabled={!engaged} onClick={() => setFullscreen(!player.fullscreen)} />
        <IconKey label="Detener" icon={<IcStop />} size={size} variant={variant} onClick={() => stop('usuario')} />
      </div>
    </div>
  );
}
