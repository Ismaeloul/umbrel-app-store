/* Análisis de una grabación del laboratorio IPTV.

   Lee lo que dejó lab.ts en la carpeta de salida y saca:
   - SALTOS del cabezal: adelante (currentTime avanza más de 1,5 s de lo que
     toca entre dos muestras de 250 ms) y atrás (retrocede más de 0,5 s), con
     QUIÉN lo hizo (la pila del setter de currentTime: hls.js, controller.ts,
     runtime.ts…) y lo que pasaba alrededor;
   - PARONES: el cabezal sin avanzar más de 1 s, separando «congelado» (el
     <video> no está en pausa pero no avanza: sin datos) de «retenido» (en
     pausa porque la web lo retiene: rebuffer/colchón) y de «buscando»;
   - SALTOS DE CONTENIDO: con la tira de código del clip se sabe qué
     fotograma de la emisión se ve; si el contenido salta distinto que el
     cabezal (el remux empalmó mal o repitió) sale aquí; y el RETRASO real
     respecto a la emisión del proveedor;
   - la lista del remux (secuencia, TARGETDURATION, EXTINF raros, lista
     parada), el registro del backend (avisos, relé, remux) y lo que hizo el
     proveedor (parones, cortes, reconexiones);
   - el patrón que describe Isma: «se adelanta, a los pocos segundos se para y
     se echa para atrás».

   Escribe informe.txt (resumen y cada salto con su contexto),
   linea-de-tiempo.txt (todo junto, ordenado) y resumen.json. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Scenario } from './scenarios.ts';

interface Sample {
  at: number;
  ct: number;
  paused: boolean;
  rs: number;
  seeking: boolean;
  rate: number;
  buf: [number, number][];
  sk: [number, number][];
  dur: number | string;
  code: number | null;
  hls: {
    lsp: number | null;
    lat: number;
    tl: number | null;
    ml: number;
    drift: number;
    edge: number | null;
    fstart: number | null;
    td: number | null;
    seq: number | null;
    endSN: number | null;
    age: number | null;
  } | null;
  app: {
    phase: string;
    conn: string;
    msg: string | null;
    reb: number | null;
    live: { at: boolean; behind: number; delay: number | null } | null;
    ahead: number;
    follow: boolean;
    want: boolean;
    sid: string | null;
    attempt: unknown;
  } | null;
  q: [number, number] | null;
}

interface Ev {
  at: number;
  type: string;
  [key: string]: unknown;
}

export interface AnalyzeInput {
  readonly dir: string;
  readonly scenario: Scenario;
  readonly recordStart: number;
  readonly sessionId: string | null;
}

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {}
  }
  return out;
}

const f1 = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(1);
const f2 = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '-' : n.toFixed(2);

function bufferAhead(s: Sample): number {
  for (const [a, b] of s.buf) if (s.ct >= a - 0.1 && s.ct <= b + 0.1) return Math.max(0, b - s.ct);
  return 0;
}

function bufStr(buf: [number, number][]): string {
  return buf.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(',') || '∅';
}

/** Quién movió el cabezal, por la pila del setter. */
function who(stack: string): string {
  const s = stack || '';
  const parts: string[] = [];
  if (/hls__js|__lab_hls|hls\.mjs/.test(s)) {
    const fn =
      /(synchronizeToLiveEdge|_trySkipBufferHole|tryFixBufferStall|_tryNudgeBuffer|tryNudgeBuffer|trySkipBufferHole|seekToStartPos|onMediaSeeking|checkBuffer|_reportStall|skipHole|nudge\w*|poll|tick|onLevelUpdated|playlistLoaded|[A-Za-z_$]*[Ss]tart[A-Za-z]*)/.exec(
        s,
      );
    parts.push(`hls.js${fn ? ` (${fn[1]})` : ''}`);
  }
  if (/controller\.ts/.test(s)) {
    const fn = /(seekTo|goLive)/.exec(s);
    parts.push(`controller.ts${fn ? ` (${fn[1]})` : ''}`);
  }
  if (/runtime\.ts/.test(s)) {
    const fn = /(pushToLive|goLive|back|startRebuffer|endRebuffer|tick|reattach)/.exec(s);
    parts.push(`runtime.ts${fn ? ` (${fn[1]})` : ''}`);
  }
  if (!parts.length) parts.push(s.slice(0, 160) || '¿?');
  return parts.join(' ← ');
}

interface Jump {
  t: number;
  at: number;
  kind: 'adelante' | 'atras' | 'reinicio';
  from: number;
  to: number;
  delta: number;
  cause: string;
  context: string;
}

interface Episode {
  kind: 'congelado' | 'retenido' | 'buscando' | 'sin-video';
  start: number;
  end: number;
  ctFrom: number;
  ctTo: number;
  note: string;
}

export function analyze(input: AnalyzeInput): { text: string; summary: Record<string, unknown> } {
  const { dir, scenario, recordStart } = input;
  const fps = scenario.clip.fps;
  const clipFrames = scenario.clip.seconds * fps;
  const samples = readJsonl<Sample>(path.join(dir, 'muestras.jsonl')).sort((a, b) => a.at - b.at);
  const pageEvents = readJsonl<Ev>(path.join(dir, 'eventos.jsonl'));
  const remux = readJsonl<Ev>(path.join(dir, 'remux.jsonl'));
  const provider = readJsonl<Ev>(path.join(dir, 'proveedor.jsonl'));
  const consoleLines = readJsonl<Ev>(path.join(dir, 'consola.jsonl'));
  const backendLines: Ev[] = [];
  const backendFile = path.join(dir, 'backend.log');
  if (existsSync(backendFile)) {
    for (const line of readFileSync(backendFile, 'utf8').split('\n')) {
      if (!line.startsWith('{')) continue;
      try {
        const j = JSON.parse(line) as {
          time?: number;
          level?: number;
          msg?: string;
          module?: string;
          [k: string]: unknown;
        };
        const at = typeof j.time === 'number' ? j.time : Date.parse(String(j.time));
        const msg = String(j.msg ?? '');
        const interesting =
          (j.level ?? 30) >= 40 ||
          /remux|relé|rele|iptv|IPTV|reabiert|reinicio|ffmpeg|sesión|session|traspaso|handoff/i.test(
            msg,
          ) ||
          /remux|iptv|playback/.test(String(j.module ?? ''));
        if (!interesting) continue;
        if (/petición|request completed|incoming request/i.test(msg) && (j.level ?? 30) < 40)
          continue;
        const { time: _t, level, msg: _m, pid: _p, hostname: _h, version: _v, ...rest } = j;
        backendLines.push({ at, type: `backend.${level ?? 30}`, msg, ...rest });
      } catch {}
    }
  }
  const t = (at: number): number => (at - recordStart) / 1000;

  // --- Emisión del proveedor: cuándo arrancó cada emisor (para el retraso real).
  /* El emisor sigue el mismo directo aunque se reinicie (entra con -ss donde iba): cuenta el primer arranque.
     Grabaciones antiguas (sin `seekS`) volvían al principio del clip: se usa el último arranque. */
  const starts = provider.filter((e) => e.type === 'emisor.start');
  const continuous = starts.some((e) => typeof e.seekS === 'number');
  const emitterStarts = (continuous ? starts.slice(0, 1) : starts).map((e) => e.at);
  const liveContentAt = (at: number): number | null => {
    let start: number | null = null;
    for (const s of emitterStarts) if (s <= at) start = s;
    if (start === null) return null;
    return (
      ((((at - start) / 1000) % scenario.clip.seconds) + scenario.clip.seconds) %
      scenario.clip.seconds
    );
  };

  // --- Saltos del cabezal.
  const seeks = pageEvents.filter((e) => e.type === 'seek.set');
  const hlsInstances = pageEvents.filter((e) => e.type === 'hls.instance');
  const emptied = pageEvents.filter(
    (e) => e.type === 'media.emptied' || e.type === 'media.loadstart',
  );
  const jumps: Jump[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1] as Sample;
    const b = samples[i] as Sample;
    const dt = (b.at - a.at) / 1000;
    const dct = b.ct - a.ct;
    const expected = a.paused ? 0 : dt * (a.rate || 1);
    const reset =
      emptied.some((e) => e.at > a.at && e.at <= b.at) ||
      hlsInstances.some((e) => e.at > a.at && e.at <= b.at);
    let kind: Jump['kind'] | null = null;
    if (reset && Math.abs(dct - expected) > 1) kind = 'reinicio';
    else if (dct - expected > 1.5) kind = 'adelante';
    else if (dct < -0.5) kind = 'atras';
    if (!kind) continue;
    const near = seeks.filter((e) => e.at > a.at - 400 && e.at <= b.at + 50);
    const cause = near.length
      ? near
          .map((e) => `${who(String(e.by ?? ''))} ${f2(e.from as number)}→${f2(e.to as number)}`)
          .join(' ; ')
      : reset
        ? 'nuevo MediaSource / nueva instancia de hls.js (reenganche)'
        : 'sin seek explícito (¿el navegador saltó un hueco o se quitó búfer?)';
    /* El salto a la posición de arranque de hls.js (con el <video> aún sin empezar) no es un salto que se vea. */
    if (near.length && near.every((e) => /seekToStartPos/.test(String(e.by ?? ''))) && a.ct === 0)
      continue;
    jumps.push({
      t: t(b.at),
      at: b.at,
      kind,
      from: a.ct,
      to: b.ct,
      delta: dct - expected,
      cause,
      context: '',
    });
  }

  // --- Parones (episodios de más de 1 s sin avanzar).
  const episodes: Episode[] = [];
  let cur: Episode | null = null;
  const started = samples.findIndex(
    (s, i) => i > 0 && !s.paused && s.ct > (samples[i - 1] as Sample).ct + 0.05,
  );
  for (let i = Math.max(1, started); i < samples.length && started >= 0; i += 1) {
    const a = samples[i - 1] as Sample;
    const b = samples[i] as Sample;
    const moved = b.ct - a.ct;
    let kind: Episode['kind'] | null = null;
    if (Math.abs(moved) < 0.05 || (!b.paused && moved < 0.05 && moved > -0.5)) {
      if (b.seeking) kind = 'buscando';
      else if (b.paused) kind = b.app && !b.app.want ? null : 'retenido';
      else kind = 'congelado';
    }
    if (kind && cur && cur.kind === kind) {
      cur.end = b.at;
      cur.ctTo = b.ct;
      continue;
    }
    if (cur) {
      if (cur.end - cur.start >= 1000) episodes.push(cur);
      cur = null;
    }
    if (kind) {
      const note = b.app
        ? `fase=${b.app.phase} conn=${b.app.conn} reb=${b.app.reb ?? '-'} msg=${b.app.msg ?? ''}`
        : '';
      cur = { kind, start: a.at, end: b.at, ctFrom: a.ct, ctTo: b.ct, note };
    }
  }
  if (cur && cur.end - cur.start >= 1000) episodes.push(cur);

  // --- Contenido (tira de código).
  const contentJumps: {
    t: number;
    at: number;
    dContent: number;
    dct: number;
    codeA: number;
    codeB: number;
  }[] = [];
  const latencies: { t: number; lat: number }[] = [];
  let lastValid: Sample | null = null;
  for (const s of samples) {
    if (s.code === null || s.code < 0) continue;
    const live = liveContentAt(s.at);
    const shown = s.code / fps;
    if (live !== null) {
      let lat = live - shown;
      while (lat < -scenario.clip.seconds / 2) lat += scenario.clip.seconds;
      while (lat > scenario.clip.seconds / 2) lat -= scenario.clip.seconds;
      latencies.push({ t: t(s.at), lat });
    }
    if (lastValid && lastValid.code !== null && lastValid.code >= 0) {
      let dFrames = s.code - lastValid.code;
      if (dFrames < -clipFrames / 2) dFrames += clipFrames;
      if (dFrames > clipFrames / 2) dFrames -= clipFrames;
      const dContent = dFrames / fps;
      const dct = s.ct - lastValid.ct;
      if (Math.abs(dContent - dct) > 1.0 && s.at - lastValid.at < 2000) {
        contentJumps.push({
          t: t(s.at),
          at: s.at,
          dContent,
          dct,
          codeA: lastValid.code,
          codeB: s.code,
        });
      }
    }
    lastValid = s;
  }

  // --- Lista del remux.
  const playlists = remux.filter((e) => e.type === 'remux.playlist');
  const remuxNotes: Ev[] = [];
  let prevPl: Ev | null = null;
  for (const p of playlists) {
    const durs = (p.durs as number[]) ?? [];
    const lastDur = durs.at(-1) ?? 0;
    if (prevPl) {
      if ((p.td as number) !== (prevPl.td as number))
        remuxNotes.push({ at: p.at, type: 'remux.targetduration', from: prevPl.td, to: p.td });
      if ((p.seq as number) < (prevPl.seq as number))
        remuxNotes.push({ at: p.at, type: 'remux.seq-atras', from: prevPl.seq, to: p.seq });
      const gap = (p.at - prevPl.at) / 1000;
      if (gap > 4.5) remuxNotes.push({ at: p.at, type: 'remux.lista-parada', s: +gap.toFixed(1) });
    }
    if (lastDur > scenario.clip.gopS * 1.6 + 2.1 && lastDur > 3)
      remuxNotes.push({ at: p.at, type: 'remux.extinf-raro', dur: lastDur, last: p.last });
    prevPl = p;
  }
  const segProbes = remux.filter((e) => e.type === 'remux.seg');
  const segIssues: Ev[] = [];
  for (const e of segProbes) {
    const holes = (e.holes as { track: string; from: number; to: number }[]) ?? [];
    const gapV = e.gapV as number | null;
    const gapA = e.gapA as number | null;
    if (
      holes.length ||
      (gapV !== null && Math.abs(gapV) > 0.1) ||
      (gapA !== null && Math.abs(gapA) > 0.1) ||
      e.keyFirst === false
    ) {
      segIssues.push({
        at: e.at,
        type: 'remux.seg-raro',
        name: e.name,
        v: e.v,
        a: e.a,
        gapV,
        gapA,
        holes,
        keyFirst: e.keyFirst,
      });
    }
  }
  for (const e of segIssues) remuxNotes.push(e);
  for (const e of remux)
    if (e.type !== 'remux.playlist' && e.type !== 'remux.seg') remuxNotes.push(e);

  // --- Línea de tiempo combinada.
  const skipPage = new Set([
    'hls.FragBuffered',
    'hls.LevelLoaded',
    'media.durationchange',
    'media.canplaythrough',
    'media.loadeddata',
    'media.canplay',
  ]);
  const line = (e: Ev, src: string): string => {
    const { at, type, ...rest } = e;
    let body = JSON.stringify(rest);
    if (body.length > 400) body = `${body.slice(0, 400)}…`;
    return `${t(at).toFixed(2).padStart(8)}  ${src.padEnd(5)} ${type.padEnd(26)} ${body === '{}' ? '' : body}`;
  };
  const timeline: { at: number; text: string }[] = [];
  for (const e of pageEvents)
    if (!skipPage.has(e.type)) timeline.push({ at: e.at, text: line(e, 'web') });
  for (const e of provider)
    if (e.type !== 'ts.progress' && e.type !== 'hls.playlist')
      timeline.push({ at: e.at, text: line(e, 'prov') });
  for (const e of remuxNotes) timeline.push({ at: e.at, text: line(e, 'remux') });
  for (const e of playlists)
    timeline.push({
      at: e.at,
      text: line(
        {
          at: e.at,
          type: 'remux.lista',
          seq: e.seq,
          td: e.td,
          n: e.n,
          ult: (e.durs as number[]).slice(-3),
          disc: e.disc,
        },
        'remux',
      ),
    });
  for (const e of backendLines) timeline.push({ at: e.at, text: line(e, 'back') });
  for (const e of consoleLines) timeline.push({ at: e.at, text: line(e, 'cons') });
  for (const j of jumps)
    timeline.push({
      at: j.at,
      text: `${j.t.toFixed(2).padStart(8)}  >>>>> SALTO ${j.kind.toUpperCase()} ${f2(j.from)} → ${f2(j.to)} (${j.delta >= 0 ? '+' : ''}${f2(j.delta)} s) por: ${j.cause}`,
    });
  for (const ep of episodes)
    timeline.push({
      at: ep.start,
      text: `${t(ep.start).toFixed(2).padStart(8)}  >>>>> PARADO (${ep.kind}) ${((ep.end - ep.start) / 1000).toFixed(1)} s en ct=${f2(ep.ctFrom)} ${ep.note}`,
    });
  for (const c of contentJumps)
    timeline.push({
      at: c.at,
      text: `${t(c.at).toFixed(2).padStart(8)}  >>>>> CONTENIDO salta ${f2(c.dContent)} s con el cabezal a ${f2(c.dct)} s (código ${c.codeA}→${c.codeB})`,
    });
  // Muestras cada segundo (resumidas).
  let lastSampleLine = 0;
  for (const s of samples) {
    if (s.at - lastSampleLine < 1000) continue;
    lastSampleLine = s.at;
    const h = s.hls;
    const lat = latencies.find((l) => Math.abs(l.t - t(s.at)) < 0.2)?.lat;
    timeline.push({
      at: s.at,
      text: `${t(s.at).toFixed(2).padStart(8)}  ·     ct=${f2(s.ct)} ${s.paused ? 'PAUSA' : 'suena'} rs=${s.rs}${s.seeking ? ' SEEKING' : ''} rate=${s.rate} buf=${bufStr(s.buf)} ahead=${f1(bufferAhead(s))} ${h ? `edge=${f1(h.edge)} lsp=${f1(h.lsp)} lat=${f1(h.lat)} tl=${f1(h.tl)} td=${h.td} seq=${h.seq}-${h.endSN} age=${f1(h.age)}` : ''} code=${s.code ?? '-'} retraso=${f1(lat)}${s.app ? ` | ${s.app.phase}/${s.app.conn}${s.app.reb ? ` reb→${s.app.reb}` : ''}${s.app.live ? ` detrás=${s.app.live.behind}` : ''}${s.app.msg ? ` «${s.app.msg}»` : ''}` : ''}`,
    });
  }
  timeline.sort((a, b) => a.at - b.at);
  const timelineText = timeline.map((x) => x.text).join('\n');
  writeFileSync(path.join(dir, 'linea-de-tiempo.txt'), `${timelineText}\n`);

  // Contexto de cada salto (±6 s, sin las muestras de cada segundo).
  const contextOf = (at: number, before = 8000, after = 4000): string =>
    timeline
      .filter((x) => x.at >= at - before && x.at <= at + after && !x.text.includes('  ·     '))
      .map((x) => `      ${x.text}`)
      .join('\n');
  for (const j of jumps) j.context = contextOf(j.at);

  // --- Patrón de Isma: «se para, se echa para atrás y se adelanta» (en cualquier orden, en 30 s).
  /* Atrás = el cabezal retrocede (salto «atrás») o el CONTENIDO retrocede más de 1 s (se repite lo visto).
     Adelante = salto «adelante» del cabezal, o el contenido avanza más de 1 s de golpe, o un reenganche
     (instancia nueva de hls.js) que deja el contenido más adelante. */
  interface Mark {
    at: number;
    what: string;
  }
  const backs: Mark[] = [
    ...jumps
      .filter((j) => j.kind === 'atras')
      .map((j) => ({ at: j.at, what: `cabezal ${f1(j.delta)} s (${j.cause})` })),
    ...contentJumps
      .filter((c) => c.dContent - c.dct < -1)
      .map((c) => ({ at: c.at, what: `contenido ${f1(c.dContent - c.dct)} s` })),
  ].sort((a, b) => a.at - b.at);
  const fwds: Mark[] = [
    ...jumps
      .filter((j) => j.kind === 'adelante')
      .map((j) => ({ at: j.at, what: `cabezal +${f1(j.delta)} s (${j.cause})` })),
    ...contentJumps
      .filter((c) => c.dContent - c.dct > 1)
      .map((c) => ({ at: c.at, what: `contenido +${f1(c.dContent - c.dct)} s` })),
    ...jumps
      .filter((j) => j.kind === 'reinicio')
      .map((j) => ({ at: j.at, what: `reenganche (${j.cause.slice(0, 60)})` })),
  ].sort((a, b) => a.at - b.at);
  const patterns: string[] = [];
  const usedBacks = new Set<number>();
  for (const back of backs) {
    if (usedBacks.has(back.at)) continue;
    const stall = episodes.find((e) => e.end >= back.at - 15_000 && e.start <= back.at + 5_000);
    const fwd = fwds.find((f) => Math.abs(f.at - back.at) <= 30_000 && f.at !== back.at);
    const frozen = !stall && byFrozenFrames(back.at);
    if (stall || frozen) {
      usedBacks.add(back.at);
      patterns.push(
        `t=${f1(t(back.at))}: ${stall ? `parado ${f1((stall.end - stall.start) / 1000)} s (${stall.kind}) a t=${f1(t(stall.start))}` : `imagen congelada (${frozen})`} · atrás: ${back.what}${fwd ? ` · adelante a t=${f1(t(fwd.at))}: ${fwd.what}` : ''}`,
      );
    }
  }
  /** Imagen congelada con el cabezal avanzando (no hay fotogramas nuevos) cerca de `at`: el <video> no lo cuenta como parón. */
  function byFrozenFrames(at: number): string | false {
    let run = 0;
    let best = 0;
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1] as Sample;
      const b = samples[i] as Sample;
      if (b.at < at - 15_000 || b.at > at + 5_000) continue;
      const framesMoved = a.q && b.q ? b.q[0] - a.q[0] : 1;
      if (!b.paused && framesMoved === 0 && b.ct > a.ct) run += b.at - a.at;
      else run = 0;
      best = Math.max(best, run);
    }
    return best >= 1000 ? `${f1(best / 1000)} s sin fotogramas nuevos` : false;
  }

  // --- Resumen.
  const firstPlay = samples.find(
    (s, i) => i > 0 && !s.paused && s.ct > (samples[i - 1] as Sample).ct + 0.05,
  );
  const stopped = episodes.reduce((sum, e) => sum + (e.end - e.start), 0) / 1000;
  const byKind = (k: Episode['kind']): Episode[] => episodes.filter((e) => e.kind === k);
  const lats = latencies.map((l) => l.lat).sort((a, b) => a - b);
  const pct = (p: number): number | null =>
    lats.length ? (lats[Math.min(lats.length - 1, Math.floor(p * lats.length))] as number) : null;
  const lastSample = samples.at(-1);
  const dropped = lastSample?.q ? lastSample.q[1] : null;
  const hlsErrors = pageEvents.filter((e) => e.type === 'hls.Error');
  const errorCounts: Record<string, number> = {};
  for (const e of hlsErrors)
    errorCounts[String(e.details)] = (errorCounts[String(e.details)] ?? 0) + 1;
  const sse = pageEvents.filter((e) => e.type === 'sse').map((e) => String(e.event));
  const sseCounts: Record<string, number> = {};
  for (const e of sse) sseCounts[e] = (sseCounts[e] ?? 0) + 1;
  const notices = [
    ...new Set(
      pageEvents
        .filter((e) => e.type === 'notice')
        .map((e) => String(e.text))
        .filter(Boolean),
    ),
  ];
  const tdChanges = remuxNotes.filter((e) => e.type === 'remux.targetduration');
  const summary = {
    escenario: scenario.name,
    segundosGrabados: samples.length
      ? +(((samples.at(-1) as Sample).at - (samples[0] as Sample).at) / 1000).toFixed(1)
      : 0,
    primeraImagenS: firstPlay ? +t(firstPlay.at).toFixed(1) : null,
    saltosAdelante: jumps.filter((j) => j.kind === 'adelante').length,
    saltosAtras: jumps.filter((j) => j.kind === 'atras').length,
    reinicios: jumps.filter((j) => j.kind === 'reinicio').length,
    paronesMas1s: episodes.length,
    paronesCongelado: byKind('congelado').length,
    paronesRetenido: byKind('retenido').length,
    paronesBuscando: byKind('buscando').length,
    segundosParado: +stopped.toFixed(1),
    saltosDeContenido: contentJumps.length,
    retrasoS: { min: pct(0), p50: pct(0.5), p90: pct(0.9), max: pct(0.999) },
    instanciasHls: hlsInstances.length,
    erroresHls: errorCounts,
    sse: sseCounts,
    cambiosTargetDuration: tdChanges.length,
    segmentosRaros: segIssues.length,
    fotogramasPerdidos: dropped,
    patronAdelantaParaAtras: patterns.length,
    avisos: notices.slice(0, 30),
  };

  const out: string[] = [];
  out.push(`== Laboratorio IPTV · ${scenario.name} ==`);
  out.push(scenario.description);
  out.push('');
  out.push(
    `Grabado ${summary.segundosGrabados} s · primera imagen a los ${summary.primeraImagenS ?? '-'} s · instancias de hls.js ${summary.instanciasHls}`,
  );
  out.push(
    `Saltos: ${summary.saltosAdelante} adelante, ${summary.saltosAtras} atrás, ${summary.reinicios} reinicios (reenganche)`,
  );
  out.push(
    `Parones >1 s: ${summary.paronesMas1s} (congelado ${summary.paronesCongelado}, retenido por la web ${summary.paronesRetenido}, buscando ${summary.paronesBuscando}); ${summary.segundosParado} s parado en total`,
  );
  out.push(
    `Saltos de contenido (lo que se ve ≠ lo que avanza el cabezal): ${summary.saltosDeContenido}`,
  );
  out.push(
    `Retraso real respecto a la emisión: min ${f1(summary.retrasoS.min)} · mediana ${f1(summary.retrasoS.p50)} · p90 ${f1(summary.retrasoS.p90)} · max ${f1(summary.retrasoS.max)} s`,
  );
  out.push(
    `TARGETDURATION del remux cambió ${summary.cambiosTargetDuration} veces · segmentos con huecos ${segIssues.length} · fotogramas perdidos ${dropped ?? '-'}`,
  );
  out.push(`Errores de hls.js: ${JSON.stringify(errorCounts)}`);
  out.push(`SSE: ${JSON.stringify(sseCounts)}`);
  if (notices.length) out.push(`Avisos vistos: ${notices.slice(0, 12).join(' || ')}`);
  out.push('');
  out.push(
    `Patrón «se para y se echa para atrás» (y si luego se adelanta, en 30 s): ${patterns.length}`,
  );
  for (const p of patterns) out.push(`  - ${p}`);
  out.push('');
  if (episodes.length) {
    out.push('Parones:');
    for (const e of episodes)
      out.push(
        `  - t=${f1(t(e.start))} ${e.kind} ${f1((e.end - e.start) / 1000)} s (ct ${f2(e.ctFrom)}→${f2(e.ctTo)}) ${e.note}`,
      );
    out.push('');
  }
  if (contentJumps.length) {
    out.push('Saltos de contenido:');
    for (const c of contentJumps.slice(0, 40))
      out.push(
        `  - t=${f1(c.t)} contenido ${f2(c.dContent)} s, cabezal ${f2(c.dct)} s (código ${c.codeA}→${c.codeB})`,
      );
    out.push('');
  }
  if (segIssues.length) {
    out.push(
      'Segmentos del remux con huecos (dentro o entre segmentos) o sin fotograma clave al principio:',
    );
    for (const e of segIssues.slice(0, 30))
      out.push(
        `  - t=${f1(t(e.at))} ${e.name} v=${JSON.stringify(e.v)} a=${JSON.stringify(e.a)} huecoV=${e.gapV} huecoA=${e.gapA} internos=${JSON.stringify(e.holes)} clave=${e.keyFirst}`,
      );
    out.push('');
  }
  if (tdChanges.length) {
    out.push('Cambios de TARGETDURATION del remux:');
    for (const c of tdChanges.slice(0, 20)) out.push(`  - t=${f1(t(c.at))} ${c.from} → ${c.to}`);
    out.push('');
  }
  for (const j of jumps) {
    out.push(
      `--- SALTO ${j.kind.toUpperCase()} a t=${f1(j.t)} s: ${f2(j.from)} → ${f2(j.to)} (${j.delta >= 0 ? '+' : ''}${f2(j.delta)} s)`,
    );
    out.push(`    causa: ${j.cause}`);
    out.push(j.context);
    out.push('');
  }
  return { text: out.join('\n'), summary };
}
