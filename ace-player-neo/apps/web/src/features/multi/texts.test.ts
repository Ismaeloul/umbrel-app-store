/* Textos literales de varios dispositivos (docs/multidispositivo.md §2.5 y
   §3.4). La app nativa los saca de texts.ts y los compara: si uno cambia
   aquí, cambia también en el documento. */

import { describe, expect, it } from 'vitest';
import {
  answeredText,
  capitalize,
  capsuleTexts,
  channelName,
  deviceLabels,
  deviceShortLabel,
  elsewhereText,
  followedText,
  goneText,
  handoffTexts,
  joiningText,
  listText,
  nothingToFollowTexts,
  questionTexts,
  SAME_CHANNEL_HELP,
  type DeviceRef,
} from './texts.ts';

const web = (deviceName: string, deviceId: string | null = `id_${deviceName}`): DeviceRef => ({
  platform: 'web',
  deviceName,
  deviceId,
});
const ios = (deviceName: string, deviceId = `id_${deviceName}`): DeviceRef => ({
  platform: 'ios',
  deviceName,
  deviceId,
});

describe('deviceShortLabel (§2.5)', () => {
  it.each([
    [web('Chrome · Windows'), 'el PC'],
    [web('Chrome · Linux'), 'el PC'],
    [web('Firefox · ChromeOS'), 'el PC'],
    [web('Navegador'), 'el PC'],
    [web('Safari · iPhone'), 'el iPhone'],
    [web('Safari · iPad'), 'el iPad'],
    [web('Chrome · Android'), 'el móvil'],
    [web('Safari · Mac'), 'el Mac'],
    [web('Navegador · Smart TV'), 'la tele'],
    [ios('iPhone de Isma'), 'el iPhone'],
    [ios('iPad del salón'), 'el iPad'],
    [ios('MacBook de Isma'), 'el Mac'],
    [
      { platform: 'legacy', deviceName: 'App antigua (0.6)', deviceId: 'x' } as DeviceRef,
      'la app antigua',
    ],
  ])('%o → %s', (ref, label) => {
    expect(deviceShortLabel(ref)).toBe(label);
  });

  it('sin nombre, «otro dispositivo»; el mismo navegador, «otra pestaña»', () => {
    expect(deviceShortLabel(null)).toBe('otro dispositivo');
    expect(deviceShortLabel({ platform: 'web', deviceId: 'web_1' })).toBe('otro dispositivo');
    expect(deviceShortLabel(web('Chrome · Windows', 'web_1'), 'web_1')).toBe('otra pestaña');
  });
});

describe('choques de nombre (§2.5)', () => {
  it('el otro PC con este PC; la otra tele', () => {
    expect(deviceLabels([web('Chrome · Windows')], web('Edge · Windows'))).toEqual(['el otro PC']);
    expect(deviceLabels([web('Navegador · Smart TV')], web('Navegador · Smart TV', 'yo'))).toEqual([
      'la otra tele',
    ]);
  });

  it('dos iPhone con nombres distintos: entre paréntesis', () => {
    expect(
      deviceLabels([ios('iPhone de Isma'), ios('iPhone de Ana')], web('Chrome · Windows')),
    ).toEqual(['el iPhone (iPhone de Isma)', 'el iPhone (iPhone de Ana)']);
  });

  it('dos «Chrome · Windows»: el PC y otro PC; con la tele, el PC, otro PC y la tele', () => {
    const labels = deviceLabels(
      [web('Chrome · Windows', 'a'), web('Chrome · Windows', 'b')],
      ios('iPhone de Isma'),
    );
    expect(listText(labels)).toBe('el PC y otro PC');
    const three = deviceLabels(
      [web('Chrome · Windows', 'a'), web('Chrome · Windows', 'b'), web('Navegador · Smart TV')],
      ios('iPhone de Isma'),
    );
    expect(listText(three)).toBe('el PC, otro PC y la tele');
  });

  it('dos visores del mismo dispositivo cuentan uno', () => {
    expect(deviceLabels([ios('iPhone de Isma', 'x'), ios('iPhone de Isma', 'x')], null)).toEqual([
      'el iPhone',
    ]);
  });

  it('listas y mayúsculas', () => {
    expect(listText(['el iPhone'])).toBe('el iPhone');
    expect(listText(['el iPhone', 'el PC'])).toBe('el iPhone y el PC');
    expect(listText(['el iPhone', 'el PC', 'la tele'])).toBe('el iPhone, el PC y la tele');
    expect(capitalize('el PC')).toBe('El PC');
    expect(capitalize('otra pestaña')).toBe('Otra pestaña');
    expect(channelName('', 'a1b2c3d4e5f6')).toBe('Canal a1b2c3d4');
  });
});

describe('la pregunta (§2.5.1)', () => {
  const base = { cannotFollow: [], title: 'DAZN LaLiga' };
  it('un dispositivo, este lo veía también', () => {
    expect(
      questionTexts({ ...base, labels: ['el iPhone'], ability: 'all', together: true }),
    ).toEqual({
      title: '¿Cambiar en los dos o solo aquí?',
      sentence: 'En el iPhone también se está viendo DAZN LaLiga.',
      note: 'Tu Umbrel pone un canal a la vez para toda la casa: si cambias solo aquí, el iPhone deja de verlo.',
      primary: 'Cambiar en los dos',
      secondary: 'Solo aquí',
      cancel: 'Cancelar',
    });
  });

  it('un dispositivo, este no lo veía', () => {
    expect(
      questionTexts({ ...base, labels: ['el iPhone'], ability: 'all', together: false }).sentence,
    ).toBe('En el iPhone se está viendo DAZN LaLiga.');
  });

  it('dos o más', () => {
    const texts = questionTexts({
      ...base,
      labels: ['el iPhone', 'el PC'],
      ability: 'all',
      together: true,
    });
    expect(texts).toMatchObject({
      title: '¿Cambiar en todos o solo aquí?',
      sentence: 'En el iPhone y el PC también se está viendo DAZN LaLiga.',
      note: 'Tu Umbrel pone un canal a la vez para toda la casa: si cambias solo aquí, los demás dejan de verlo.',
      primary: 'Cambiar en todos',
    });
  });

  it('ninguno puede seguir', () => {
    expect(
      questionTexts({
        ...base,
        labels: ['el iPhone'],
        cannotFollow: ['el iPhone'],
        ability: 'none',
        together: false,
      }),
    ).toMatchObject({
      title: '¿Cambiar solo aquí?',
      note: 'El iPhone tiene una versión de la app que no puede cambiar sola: si cambias, deja de verlo.',
      primary: 'Cambiar aquí',
      secondary: null,
      cancel: 'Cancelar',
    });
  });

  it('unos sí y otros no', () => {
    expect(
      questionTexts({
        ...base,
        labels: ['el iPhone', 'el PC'],
        cannotFollow: ['el iPhone'],
        ability: 'some',
        together: true,
      }),
    ).toMatchObject({
      title: '¿Cambiar en todos o solo aquí?',
      note: 'El iPhone no puede cambiar solo con su versión de la app: dejará de verlo.',
      primary: 'Cambiar en todos',
      secondary: 'Solo aquí',
    });
  });

  it('después de contestar y el panel «otra cosa en casa»', () => {
    expect(answeredText('both', { labels: ['el iPhone'], title: 'Antena 3' })).toBe(
      'Cambiado en los dos: Antena 3',
    );
    expect(answeredText('both', { labels: ['a', 'b'], title: 'Antena 3' })).toBe(
      'Cambiado en todos: Antena 3',
    );
    expect(answeredText('here', { labels: ['el iPhone'], title: 'Antena 3' })).toBe(
      'Cambiado solo aquí: el iPhone deja de verlo',
    );
    expect(answeredText('here', { labels: ['a', 'b'], title: 'Antena 3' })).toBe(
      'Cambiado solo aquí: los demás dejan de verlo',
    );
    expect(elsewhereText(['el iPhone'], 'DAZN LaLiga')).toBe(
      'En el iPhone se está viendo DAZN LaLiga.',
    );
    expect(elsewhereText(['el iPhone', 'el PC'], 'DAZN LaLiga')).toBe(
      'En el iPhone y el PC se está viendo DAZN LaLiga.',
    );
    expect(joiningText(['el iPhone'])).toBe('Te unes a lo que se ve en el iPhone');
  });
});

describe('el otro dispositivo (§2.5.2)', () => {
  const base = { by: 'el PC', previous: 'DAZN LaLiga' } as const;
  it('canal distinto, apagado y encendido', () => {
    expect(
      handoffTexts({ ...base, reason: 'other_channel', title: 'Antena 3', policy: 'share' }),
    ).toEqual({
      title: 'Ahora en el PC',
      text: 'En el PC han cambiado a Antena 3.',
      status: 'En el PC han cambiado a Antena 3',
      here: 'Ver Antena 3 aquí',
      hereShort: 'Ver aquí',
      back: 'Volver a DAZN LaLiga',
    });
    expect(
      handoffTexts({ ...base, reason: 'other_channel', title: 'Antena 3', policy: 'handoff' }),
    ).toMatchObject({ here: 'Pasar Antena 3 aquí', hereShort: 'Pasar aquí' });
  });

  it('mismo canal con el interruptor encendido', () => {
    expect(
      handoffTexts({ ...base, reason: 'same_channel', title: 'DAZN LaLiga', policy: 'handoff' }),
    ).toEqual({
      title: 'Ahora en el PC',
      text: 'Un solo dispositivo a la vez: DAZN LaLiga sigue en el PC.',
      status: 'DAZN LaLiga sigue en el PC',
      here: 'Pasar aquí',
      hereShort: 'Pasar aquí',
      back: null,
    });
  });

  it('sin título del canal nuevo', () => {
    expect(
      handoffTexts({ ...base, reason: 'other_channel', title: null, policy: 'share' }),
    ).toMatchObject({
      title: 'Ahora en el PC',
      text: 'En el PC han cambiado de canal.',
      status: 'En el PC han cambiado de canal',
      here: 'Ver aquí',
      back: 'Volver a DAZN LaLiga',
    });
  });

  it('otra pestaña: sin «Ver aquí»', () => {
    expect(
      handoffTexts({
        by: 'otra pestaña',
        previous: 'DAZN LaLiga',
        reason: 'other_channel',
        title: 'Antena 3',
        policy: 'share',
      }),
    ).toEqual({
      title: 'Ahora en otra pestaña',
      text: 'En otra pestaña han cambiado a Antena 3.',
      status: 'En otra pestaña han cambiado a Antena 3',
      here: null,
      hereShort: null,
      back: 'Volver a DAZN LaLiga',
    });
  });

  it('seguir, nada que seguir y llegar tarde', () => {
    expect(followedText('el PC', 'Antena 3')).toBe('El PC ha cambiado a Antena 3 en los dos');
    expect(nothingToFollowTexts('el PC', 'DAZN LaLiga')).toEqual({
      title: 'Nada en el PC',
      text: 'El PC ya no está viendo nada: no hay nada que seguir.',
      status: 'El PC ya no está viendo nada',
      back: 'Volver a DAZN LaLiga',
    });
    expect(goneText('Antena 3', 'el PC')).toBe('Antena 3 ya no se está viendo en el PC.');
  });
});

describe('la cápsula (§3.4) y Ajustes (§2.5.4)', () => {
  it('uno, varios, en pausa y con el interruptor encendido', () => {
    expect(
      capsuleTexts({ labels: ['el iPhone'], title: 'DAZN LaLiga', paused: false, policy: 'share' }),
    ).toEqual({
      text: 'En el iPhone · DAZN LaLiga',
      action: 'Ver aquí',
      label: 'Ver aquí DAZN LaLiga, que se está viendo en el iPhone',
      announce: 'Se está viendo DAZN LaLiga en el iPhone',
      hide: 'Ocultar este aviso',
    });
    expect(
      capsuleTexts({
        labels: ['el iPhone', 'el PC'],
        title: 'DAZN LaLiga',
        paused: false,
        policy: 'handoff',
      }),
    ).toMatchObject({
      text: 'En el iPhone y el PC · DAZN LaLiga',
      action: 'Pasar aquí',
      label: 'Pasar aquí DAZN LaLiga, que se está viendo en el iPhone y el PC',
    });
    expect(
      capsuleTexts({ labels: ['el iPhone'], title: 'DAZN LaLiga', paused: true, policy: 'share' })
        .text,
    ).toBe('En pausa en el iPhone · DAZN LaLiga');
  });

  it('ayuda del interruptor', () => {
    expect(SAME_CHANNEL_HELP).toBe(
      'Al dar al play en otro dispositivo, este se para (como hasta la 0.6.59). Desactivado, dos dispositivos pueden ver el mismo canal a la vez y, si uno cambia de canal, te preguntamos si cambiar en los dos o solo en ese.',
    );
  });
});
