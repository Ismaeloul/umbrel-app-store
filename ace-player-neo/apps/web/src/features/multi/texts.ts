/* Textos de varios dispositivos a la vez (docs/multidispositivo.md §2.5 y
   §3.4): la pregunta al cambiar de canal, el aviso en el otro dispositivo,
   el panel «otra cosa en casa» y la cápsula. Todos aquí, como funciones
   puras que devuelven la cadena, para que la app nativa los saque de un solo
   fichero (generar-textos.mjs).

   Los textos entre «comillas» del documento son literales: si cambias uno,
   cambia también el documento y texts.test.ts.

   Solo tipos de @ace/shared (sin zod): lo importa el JS inicial. */

import type { ClientKind } from '@ace/shared';
import { deviceKind } from '../where-playing/model.ts';

/** Lo que hace falta de un visor para nombrar su dispositivo. */
export interface DeviceRef {
  readonly platform: ClientKind;
  readonly deviceName: string;
  readonly deviceId: string | null;
}

interface Noun {
  /** «el» o «la». */
  readonly article: 'el' | 'la';
  /** «PC», «iPhone», «tele», «app antigua». */
  readonly noun: string;
}

const UNKNOWN_DEVICE = 'otro dispositivo';
export const OTHER_TAB = 'otra pestaña';

/** El sustantivo del dispositivo según la tabla de §2.5. */
function nounOf(ref: Pick<DeviceRef, 'platform' | 'deviceName'>): Noun {
  const name = ref.deviceName;
  if (ref.platform === 'ios') {
    if (/\biPad\b/i.test(name)) return { article: 'el', noun: 'iPad' };
    if (/\b(?:Mac|MacBook|iMac)\b/i.test(name)) return { article: 'el', noun: 'Mac' };
    return { article: 'el', noun: 'iPhone' };
  }
  if (ref.platform === 'legacy') return { article: 'la', noun: 'app antigua' };
  if (deviceKind(ref) === 'tele') return { article: 'la', noun: 'tele' };
  if (/\biPhone\b|\biPod\b/i.test(name)) return { article: 'el', noun: 'iPhone' };
  if (/\biPad\b/i.test(name)) return { article: 'el', noun: 'iPad' };
  if (/\bAndroid\b/i.test(name)) return { article: 'el', noun: 'móvil' };
  if (/\bMac\b/i.test(name)) return { article: 'el', noun: 'Mac' };
  return { article: 'el', noun: 'PC' };
}

/**
 * Nombre corto de un dispositivo (§2.5): «el PC», «el iPhone», «la tele»,
 * «la app antigua»; «otra pestaña» si es este mismo navegador y «otro
 * dispositivo» si no se sabe (un servidor sin `byDeviceName`).
 */
export function deviceShortLabel(
  ref: Partial<DeviceRef> | null | undefined,
  myDeviceId?: string | null,
): string {
  if (ref?.deviceId && myDeviceId && ref.deviceId === myDeviceId) return OTHER_TAB;
  if (!ref?.deviceName || !ref.platform) return UNKNOWN_DEVICE;
  const { article, noun } = nounOf({ platform: ref.platform, deviceName: ref.deviceName });
  return `${article} ${noun}`;
}

/** Clave de un dispositivo: su id o, sin él, su nombre (dos visores del mismo navegador son uno). */
export function deviceKey(ref: Pick<DeviceRef, 'deviceId' | 'deviceName'>): string {
  return ref.deviceId ?? `nombre:${ref.deviceName}`;
}

/**
 * Nombres cortos de los OTROS dispositivos, sin repetir y con las reglas de
 * choque de §2.5: «el otro PC» si coincide con este; «el iPhone (iPhone de
 * Isma)» si dos otros comparten nombre corto con nombres distintos; «otro
 * PC» para el segundo si también el nombre es igual («el PC y otro PC»).
 */
export function deviceLabels(
  others: readonly DeviceRef[],
  me: Pick<DeviceRef, 'platform' | 'deviceName'> | null,
): string[] {
  const unique: DeviceRef[] = [];
  const seen = new Set<string>();
  for (const ref of others) {
    const key = deviceKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  const mine = me ? nounOf(me) : null;
  const nouns = unique.map(nounOf);
  const labels: string[] = [];
  unique.forEach((ref, index) => {
    const noun = nouns[index] as Noun;
    const sameNoun = unique
      .map((other, i) => ({ other, noun: nouns[i] as Noun, i }))
      .filter((entry) => entry.noun.noun === noun.noun);
    const earlier = sameNoun.filter((entry) => entry.i < index);
    const other = noun.article === 'el' ? 'otro' : 'otra';
    /* Tercero y siguientes con el mismo nombre que otro de antes: «otro PC». */
    if (earlier.some((entry) => entry.other.deviceName === ref.deviceName)) {
      labels.push(`${other} ${noun.noun}`);
      return;
    }
    let label =
      mine && mine.noun === noun.noun
        ? `${noun.article} ${other} ${noun.noun}`
        : `${noun.article} ${noun.noun}`;
    /* Dos (o más) con el mismo nombre corto y nombres distintos: entre paréntesis. */
    if (sameNoun.some((entry) => entry.i !== index && entry.other.deviceName !== ref.deviceName))
      label = `${label} (${ref.deviceName})`;
    labels.push(label);
  });
  return labels;
}

/** «a», «a y b», «a, b y c». */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** Mayúscula al empezar frase: «El PC…», «La tele…», «Otra pestaña…». */
export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Título de un canal: el que manda el servidor o «Canal {8 primeros del hash}». */
export function channelName(title: string | null | undefined, hash: string): string {
  return title?.trim() || `Canal ${hash.slice(0, 8)}`;
}

// ---- A · La pregunta (§2.5.1) --------------------------------------------------------

/** Cuántos de los otros pueden seguir el cambio solos. */
export type FollowAbility = 'all' | 'some' | 'none';

export interface QuestionTexts {
  title: string;
  sentence: string;
  note: string;
  /** Botón principal («Cambiar en los dos», «Cambiar en todos» o «Cambiar aquí»). */
  primary: string;
  /** «Solo aquí», o null si no se ofrece (nadie puede seguir). */
  secondary: string | null;
  cancel: string;
}

export function questionTexts(input: {
  /** Nombres cortos de los otros dispositivos (ya con las reglas de choque). */
  labels: readonly string[];
  /** Los que no pueden seguir (nombres cortos). */
  cannotFollow: readonly string[];
  ability: FollowAbility;
  /** Este dispositivo veía esa misma sesión. */
  together: boolean;
  title: string;
}): QuestionTexts {
  const { labels, cannotFollow, ability, together, title } = input;
  const many = labels.length > 1;
  const who = listText(labels);
  const sentence = together
    ? `En ${who} también se está viendo ${title}.`
    : `En ${who} se está viendo ${title}.`;
  if (ability === 'none') {
    const them = listText(cannotFollow.length ? cannotFollow : labels);
    const plural = (cannotFollow.length || labels.length) > 1;
    return {
      title: '¿Cambiar solo aquí?',
      sentence,
      note: plural
        ? `${capitalize(them)} tienen una versión de la app que no puede cambiar sola: si cambias, dejan de verlo.`
        : `${capitalize(them)} tiene una versión de la app que no puede cambiar sola: si cambias, deja de verlo.`,
      primary: 'Cambiar aquí',
      secondary: null,
      cancel: 'Cancelar',
    };
  }
  if (ability === 'some') {
    const them = listText(cannotFollow);
    return {
      title: '¿Cambiar en todos o solo aquí?',
      sentence,
      note:
        cannotFollow.length > 1
          ? `${capitalize(them)} no pueden cambiar solos con su versión de la app: dejarán de verlo.`
          : `${capitalize(them)} no puede cambiar solo con su versión de la app: dejará de verlo.`,
      primary: 'Cambiar en todos',
      secondary: 'Solo aquí',
      cancel: 'Cancelar',
    };
  }
  return {
    title: many ? '¿Cambiar en todos o solo aquí?' : '¿Cambiar en los dos o solo aquí?',
    sentence,
    note: many
      ? 'Tu Umbrel pone un canal a la vez para toda la casa: si cambias solo aquí, los demás dejan de verlo.'
      : `Tu Umbrel pone un canal a la vez para toda la casa: si cambias solo aquí, ${who} deja de verlo.`,
    primary: many ? 'Cambiar en todos' : 'Cambiar en los dos',
    secondary: 'Solo aquí',
    cancel: 'Cancelar',
  };
}

/** Línea de estado de este dispositivo después de contestar. */
export function answeredText(
  answer: 'both' | 'here',
  input: { labels: readonly string[]; title: string },
): string {
  const many = input.labels.length > 1;
  if (answer === 'both')
    return many ? `Cambiado en todos: ${input.title}` : `Cambiado en los dos: ${input.title}`;
  return many
    ? 'Cambiado solo aquí: los demás dejan de verlo'
    : `Cambiado solo aquí: ${listText(input.labels)} deja de verlo`;
}

/** Panel «otra cosa en casa» (§2.4.5 y §2.5.1). */
export function elsewhereText(labels: readonly string[], title: string): string {
  return `En ${listText(labels)} se está viendo ${title}.`;
}

export const PUT_HERE = 'Poner aquí';
export const NOTHING_CHANGED = 'No has cambiado nada';

/** «Te unes a lo que se ve en {el iPhone}» (§2.4.5). */
export function joiningText(labels: readonly string[]): string {
  return `Te unes a lo que se ve en ${listText(labels)}`;
}

// ---- A · El otro dispositivo (§2.5.2) -------------------------------------------------

export interface HandoffTexts {
  title: string;
  text: string;
  /** Línea de estado o toast. */
  status: string;
  /** «Ver {Antena 3} aquí», «Pasar aquí»…, o null si no se ofrece. */
  here: string | null;
  /** Lo mismo, corto, para el toast («Ver aquí» / «Pasar aquí»). */
  hereShort: string | null;
  /** «Volver a {DAZN LaLiga}», o null. */
  back: string | null;
}

export function handoffTexts(input: {
  /** Nombre corto de quien cambió («el PC», «otra pestaña», «otro dispositivo»). */
  by: string;
  reason: 'other_channel' | 'same_channel';
  /** Título del canal nuevo (o null si no se sabe). */
  title: string | null;
  /** Lo que se estaba viendo aquí. */
  previous: string;
  /** Política del ajuste «Un solo dispositivo a la vez». */
  policy: 'share' | 'handoff';
}): HandoffTexts {
  const { by, reason, title, previous, policy } = input;
  const tab = by === OTHER_TAB;
  const verb = policy === 'handoff' ? 'Pasar' : 'Ver';
  if (reason === 'same_channel') {
    return {
      title: `Ahora en ${by}`,
      text: `Un solo dispositivo a la vez: ${previous} sigue en ${by}.`,
      status: `${previous} sigue en ${by}`,
      here: 'Pasar aquí',
      hereShort: 'Pasar aquí',
      back: null,
    };
  }
  if (tab) {
    return {
      title: `Ahora en ${OTHER_TAB}`,
      text: title
        ? `En ${OTHER_TAB} han cambiado a ${title}.`
        : `En ${OTHER_TAB} han cambiado de canal.`,
      status: title
        ? `En ${OTHER_TAB} han cambiado a ${title}`
        : `En ${OTHER_TAB} han cambiado de canal`,
      here: null,
      hereShort: null,
      back: `Volver a ${previous}`,
    };
  }
  if (!title) {
    return {
      title: `Ahora en ${by}`,
      text: `En ${by} han cambiado de canal.`,
      status: `En ${by} han cambiado de canal`,
      here: `${verb} aquí`,
      hereShort: `${verb} aquí`,
      back: `Volver a ${previous}`,
    };
  }
  return {
    title: `Ahora en ${by}`,
    text: `En ${by} han cambiado a ${title}.`,
    status: `En ${by} han cambiado a ${title}`,
    here: `${verb} ${title} aquí`,
    hereShort: `${verb} aquí`,
    back: `Volver a ${previous}`,
  };
}

/** Seguir («Cambiar en los dos»): «{El PC} ha cambiado a {Antena 3} en los dos». */
export function followedText(by: string, title: string): string {
  return `${capitalize(by)} ha cambiado a ${title} en los dos`;
}

/** Seguir sin nada que seguir (el otro ha parado mientras este se unía). */
export function nothingToFollowTexts(
  by: string,
  previous: string,
): { title: string; text: string; status: string; back: string } {
  return {
    title: `Nada en ${by}`,
    text: `${capitalize(by)} ya no está viendo nada: no hay nada que seguir.`,
    status: `${capitalize(by)} ya no está viendo nada`,
    back: `Volver a ${previous}`,
  };
}

/** «Ver … aquí», la cápsula o «Te unes…» llegan tarde (`join` → `session_expired`). */
export function goneText(title: string, by: string): string {
  return `${title} ya no se está viendo en ${by}.`;
}

// ---- B · La cápsula (§3.4) -----------------------------------------------------------

export interface CapsuleTexts {
  text: string;
  action: string;
  label: string;
  announce: string;
  hide: string;
}

export function capsuleTexts(input: {
  labels: readonly string[];
  title: string;
  /** En pausa en todos los que lo ven. */
  paused: boolean;
  policy: 'share' | 'handoff';
}): CapsuleTexts {
  const who = listText(input.labels);
  const action = input.policy === 'handoff' ? 'Pasar aquí' : 'Ver aquí';
  return {
    text: input.paused ? `En pausa en ${who} · ${input.title}` : `En ${who} · ${input.title}`,
    action,
    label: `${action} ${input.title}, que se está viendo en ${who}`,
    announce: `Se está viendo ${input.title} en ${who}`,
    hide: 'Ocultar este aviso',
  };
}

// ---- Ajustes (§2.5.4) ----------------------------------------------------------------

export const SAME_CHANNEL_HELP =
  'Al dar al play en otro dispositivo, este se para (como hasta la 0.6.59). Desactivado, dos dispositivos pueden ver el mismo canal a la vez y, si uno cambia de canal, te preguntamos si cambiar en los dos o solo en ese.';
