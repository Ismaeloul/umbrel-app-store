/* Las fuentes de la sala en directo (directo §14), con la misma lógica que la
   ficha del partido (sources/model.ts y `buildSourceRows`):

   - las entradas salen de `partyLiveSources` (la misma resolución que la ficha,
     con su propio trabajo del comprobador), sin repetidas y con lo que dice el
     comprobador;
   - se ven todas las IPTV (los gemelos de otro país, plegados), la que suena y
     las AceStream verificadas; las flojas y el resto, plegadas; las reportadas
     y las de cuarentena, fuera;
   - por canal, con la IPTV primero y el número estable de la lista entera.

   Sin estado ni React: lo pinta LivePanels.tsx y lo prueban los tests. */

import type {
  PartyLive,
  PartyLiveChoice,
  PartyRoom,
  ResolutionCandidate,
  ScanJob,
} from '@ace/shared';
import {
  applyScan,
  channelNameOf,
  channelNameWithoutProvider,
  dedupeEntries,
  entryFromCandidate,
  isForeignTwin,
  isIptv,
  manualEntry,
  qualityLabel,
  qualityTags,
  startScan,
  swarmMbit,
  type OnScreen,
  type SourceEntry,
} from '../sources/model.ts';
import { buildSourceRows, type SourceRow } from '../sources/useSources.ts';
import { LIVE_TEXT } from './liveTexts.ts';

/* Lo de quién puede cambiar la fuente vive en client.ts (la sala lo usa sin bajar Fuentes). */
export { canSwitchLive, liveSwitchers } from './client.ts';

const HASH_RE = /^[a-f0-9]{40}$/;

/** «DAZN 1 · 1080p» → «DAZN 1»: el canal de la sala sin la calidad. */
export function liveChannelName(channel: string): string {
  return channel.split(' · ')[0]?.trim() || channel.trim();
}

/** Las entradas de la sala: sin repetidas, con el comprobador y con la que suena aunque no esté. */
export function roomEntries(
  candidates: readonly ResolutionCandidate[],
  scan: ScanJob | null,
  live: Pick<PartyLive, 'hash' | 'channel'>,
  now = Date.now(),
): SourceEntry[] {
  let entries = dedupeEntries(
    candidates
      .filter((candidate) => HASH_RE.test(candidate.id.toLowerCase()))
      .map((candidate) =>
        entryFromCandidate({ ...candidate, id: candidate.id.toLowerCase() }, now),
      ),
  );
  if (scan) entries = applyScan(startScan(entries, scan.initialCount), scan);
  if (!entries.some((entry) => entry.id === live.hash)) {
    const name = liveChannelName(live.channel);
    entries = [manualEntry(live.hash, name, name), ...entries];
  }
  return entries;
}

/** Lo que la sala sabe de la que suena: va bien mientras no se haya cortado. */
export function roomScreen(room: Pick<PartyRoom, 'live' | 'interrupted'>): OnScreen {
  const hash = room.live?.hash ?? null;
  return { hash, playing: !!hash && room.interrupted === null, connecting: false };
}

export interface RoomSourceRow {
  readonly row: SourceRow;
  /** La que suena en la sala. */
  readonly here: boolean;
  readonly iptv: boolean;
  /**
   * La línea principal, como la maqueta (ver-juntos.html): la calidad y los Mb/s («1080p · 6,2
   * Mb/s»). Sin calidad conocida, el nombre sin el proveedor ni el canal del grupo (si sobra,
   * el proveedor).
   */
  readonly name: string;
  /**
   * La segunda línea, tras la etiqueta de origen: el nombre si no es el del grupo, el proveedor
   * (en IPTV, «tu lista» si no hay) y, en AceStream, los pares. Nada se repite con la principal.
   */
  readonly meta: string;
  readonly choice: PartyLiveChoice;
}

export interface RoomSourceGroup {
  readonly name: string;
  readonly rows: readonly RoomSourceRow[];
  /** Las conexiones del canal (sin las reportadas) y cuántas tienen señal. */
  readonly total: number;
  readonly live: number;
}

export interface RoomSourcesModel {
  readonly groups: readonly RoomSourceGroup[];
  /** Plegadas: las flojas. */
  readonly weak: readonly RoomSourceRow[];
  /** Plegadas: sin señal o comprobándose. */
  readonly rest: readonly RoomSourceRow[];
  readonly failed: number;
  readonly checking: number;
  /** Plegadas: los gemelos de otro país de la IPTV. */
  readonly foreign: readonly RoomSourceRow[];
  /** Todas las que se pueden poner (sin reportadas). */
  readonly count: number;
}

function groupOf(entry: SourceEntry): string {
  return entry.matchedChannel || channelNameOf(entry) || entry.title;
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Las dos líneas de una fila (ver `RoomSourceRow`). */
function linesOf(row: SourceRow, group: string): { name: string; meta: string } {
  const { entry } = row;
  const provider = row.presentation.provider;
  const bare = channelNameWithoutProvider(channelNameOf(entry), [provider]);
  /* El nombre solo dice algo si no es el canal del grupo («DAZN 1» dentro de DAZN 1). */
  const own = bare && fold(bare) !== fold(group) ? bare : '';
  const quality = [...qualityTags(entry)];
  const mbit = swarmMbit(entry);
  if (mbit) quality.push(LIVE_TEXT.mbit(mbit));
  const name = quality.length ? quality.join(' · ') : own || row.presentation.short;
  const parts: string[] = [];
  if (own && own !== name) parts.push(own);
  /* De dónde sale: el proveedor (la lista de AceStream o el de la IPTV; «tu lista» si no hay). */
  const origin = provider || (isIptv(entry) ? LIVE_TEXT.yourList : '');
  if (origin && fold(origin) !== fold(name) && fold(origin) !== fold(own)) parts.push(origin);
  const peers = entry.probe?.peers ?? 0;
  if (!isIptv(entry) && peers > 0) parts.push(LIVE_TEXT.peers(peers));
  return { name, meta: parts.join(' · ') };
}

/** Lo que va a la sala al «Poner» una fuente: el partido sigue siendo el de la sala. */
export function choiceOfEntry(
  entry: SourceEntry,
  live: Pick<PartyLive, 'matchId' | 'match'>,
): PartyLiveChoice {
  const quality = qualityLabel(entry);
  const name = channelNameOf(entry) || 'Canal';
  return {
    hash: entry.id,
    channel: (quality ? `${name} · ${quality}` : name).slice(0, 120),
    source: isIptv(entry) ? 'iptv' : 'engine',
    matchId: live.matchId,
    match: live.match,
  };
}

/** Las filas de la sala, repartidas entre lo que se ve y los pliegues. */
export function roomSourcesModel(
  entries: readonly SourceEntry[],
  live: Pick<PartyLive, 'hash' | 'matchId' | 'match'>,
  screen: OnScreen,
  hasScan: boolean,
  now = Date.now(),
): RoomSourcesModel {
  const { rows } = buildSourceRows(entries, screen, now, live.hash, hasScan);
  const groups = new Map<
    string,
    { rows: RoomSourceRow[]; total: number; live: number; iptv: boolean; first: number }
  >();
  const weak: RoomSourceRow[] = [];
  const rest: RoomSourceRow[] = [];
  const foreign: RoomSourceRow[] = [];
  let failed = 0;
  let checking = 0;
  let count = 0;
  for (const row of rows) {
    const { entry } = row;
    const here = entry.id === live.hash;
    /* Fuera las reportadas y las de cuarentena (la que suena, nunca). */
    if (row.effective.reported && !here) continue;
    count += 1;
    const group = groupOf(entry);
    const iptv = isIptv(entry);
    const item: RoomSourceRow = {
      row,
      here,
      iptv,
      ...linesOf(row, group),
      choice: choiceOfEntry(entry, live),
    };
    const signal = row.signal.state;
    const slot = groups.get(group) ?? {
      rows: [],
      total: 0,
      live: 0,
      iptv: false,
      first: row.number,
    };
    slot.total += 1;
    if (signal === 'ok' || signal === 'weak') slot.live += 1;
    groups.set(group, slot);
    if (here) {
      slot.rows.push(item);
    } else if (iptv) {
      if (isForeignTwin(entry, entries)) foreign.push(item);
      else slot.rows.push(item);
    } else if (signal === 'ok') {
      slot.rows.push(item);
    } else if (signal === 'weak') {
      weak.push(item);
    } else {
      rest.push(item);
      if (signal === 'fail') failed += 1;
      else checking += 1;
    }
    if (iptv && slot.rows.includes(item)) slot.iptv = true;
  }
  const shown = [...groups]
    .filter(([, slot]) => slot.rows.length > 0)
    .sort(([, a], [, b]) => Number(b.iptv) - Number(a.iptv) || a.first - b.first)
    .map(([name, slot]) => ({ name, rows: slot.rows, total: slot.total, live: slot.live }));
  return { groups: shown, weak, rest, failed, checking, foreign, count };
}

/** ¿Sigue el comprobador con la lista? (se sondea mientras tanto). */
export function scanRunning(scan: Pick<ScanJob, 'status'> | null | undefined): boolean {
  return (
    !!scan && (scan.status === 'queued' || scan.status === 'running' || scan.status === 'waiting')
  );
}
