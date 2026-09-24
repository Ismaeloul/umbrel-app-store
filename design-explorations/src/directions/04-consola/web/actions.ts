/* Consola · acciones del panel de comandos (web). Cada una lleva su tecla
   visible para que los atajos se descubran desde el propio panel. */

import { useMemo } from 'react';
import { navigate } from '../../../core/router';
import { createPairingCode, goLive, markCorrect, nextSource, research, seekBack, setFullscreen, setMuted, setTheme, stop, syncDirectory, togglePlay, useSim, getState, revealScore } from '../../../core/store';
import type { ActionDef } from '../components/search';
import { getUi, openSheet, setCollapsed, setHelp, useUi } from './state';

export function useActions(): ActionDef[] {
  const conn = useSim((s) => s.player.conn);
  const media = useSim((s) => s.player.media);
  const target = useSim((s) => s.player.target);
  const collapsed = useUi((u) => u.collapsed);
  const engaged = conn !== 'idle' && conn !== 'error';
  const hasTarget = !!target;
  return useMemo<ActionDef[]>(() => {
    const cur = () => {
      const t = getState().player.target;
      if (t) return { kind: t.kind, id: t.id };
      const s = getUi().selection;
      return s ? { kind: s.kind, id: s.id } : null;
    };
    return [
      { id: 'play', label: media === 'playing' ? 'Pausar' : 'Reanudar', icon: media === 'playing' ? 'pause' : 'play', keys: 'Espacio', run: () => togglePlay(), when: engaged },
      { id: 'back30', label: 'Retroceder 30 s', icon: 'back30', keys: 'J', run: () => seekBack(30), when: engaged },
      { id: 'live', label: 'Ir al directo', icon: 'live', keys: 'L', run: () => goLive(), when: engaged },
      { id: 'next', label: 'Siguiente fuente', icon: 'skip', keys: 'N', run: () => target && nextSource(target.kind, target.id, 1), when: hasTarget },
      { id: 'full', label: 'Pantalla completa', icon: 'fullscreen', keys: 'F', run: () => setFullscreen(true), when: engaged },
      { id: 'mute', label: 'Silencio', icon: 'mute', keys: 'M', run: () => setMuted(!getState().player.muted), when: engaged },
      { id: 'reveal', label: 'Ver marcador del partido en pantalla', icon: 'eye', run: () => target?.kind === 'match' && revealScore(target.id, true), when: target?.kind === 'match' },
      { id: 'stop', label: 'Detener la reproducción', icon: 'stop', run: () => stop('usuario'), when: hasTarget },
      {
        id: 'research',
        label: 'Rebuscar fuentes',
        icon: 'refresh',
        hint: 'busca señales nuevas sin cortar la que suena',
        run: () => {
          const c = cur();
          if (c) research(c.kind, c.id);
        },
      },
      {
        id: 'paste',
        label: 'Pegar Content ID',
        icon: 'clipboard',
        hint: 'reproduce una fuente externa',
        run: () => {
          const c = cur();
          if (c) openSheet({ type: 'paste', kind: c.kind, id: c.id });
          else navigate('buscar');
        },
      },
      {
        id: 'report',
        label: 'Reportar la fuente en pantalla',
        icon: 'flag',
        run: () => target?.sourceId && openSheet({ type: 'report', kind: target.kind, id: target.id, sourceId: target.sourceId }),
        when: !!target?.sourceId,
      },
      { id: 'correct', label: 'Es el canal correcto', icon: 'check', run: () => target?.sourceId && markCorrect(target.kind, target.id, target.sourceId, true), when: !!target?.sourceId },
      { id: 'go-agenda', label: 'Ir a Partidos', icon: 'ball', keys: 'G P', run: () => navigate('agenda') },
      { id: 'go-channels', label: 'Ir a Canales', icon: 'tv', keys: 'G C', run: () => navigate('biblioteca', 'favoritos') },
      { id: 'go-devices', label: 'Ir a Dispositivos', icon: 'phone', run: () => navigate('ajustes', 'dispositivos') },
      { id: 'go-system', label: 'Ir a Sistema', icon: 'activity', run: () => navigate('ajustes', 'salud') },
      { id: 'go-settings', label: 'Abrir Ajustes', icon: 'settings', keys: '⌘ ,', run: () => navigate('ajustes', 'apariencia') },
      { id: 'go-where', label: 'Dónde se está reproduciendo', icon: 'radio', run: () => navigate('ajustes', 'donde') },
      { id: 'pair', label: 'Emparejar un dispositivo', icon: 'qr', run: () => { navigate('ajustes', 'dispositivos'); if (getState().pairing.phase === 'idle') createPairingCode(); } },
      { id: 'sync', label: 'Actualizar la lista en uso', icon: 'refresh', run: () => syncDirectory(getState().activeDirectoryId) },
      { id: 'restart', label: 'Reiniciar el motor…', icon: 'zap', hint: 'te lleva a Sistema, donde se confirma', run: () => navigate('ajustes', 'salud') },
      { id: 'theme-light', label: 'Tema claro', icon: 'sun', run: () => setTheme('claro') },
      { id: 'theme-dark', label: 'Tema oscuro', icon: 'moon', run: () => setTheme('oscuro') },
      { id: 'theme-sys', label: 'Tema del sistema', icon: 'monitor', run: () => setTheme('sistema') },
      { id: 'sidebar', label: collapsed ? 'Desplegar la barra lateral' : 'Plegar la barra lateral', icon: 'sidebar', keys: '[', run: () => setCollapsed(!getUi().collapsed) },
      { id: 'gustos', label: 'Editar mis gustos', icon: 'heart', run: () => navigate('gustos') },
      { id: 'help', label: 'Atajos de teclado', icon: 'keyboard', keys: '?', run: () => setHelp(true) },
    ];
  }, [engaged, media, hasTarget, target?.kind, target?.id, target?.sourceId, collapsed]);
}
