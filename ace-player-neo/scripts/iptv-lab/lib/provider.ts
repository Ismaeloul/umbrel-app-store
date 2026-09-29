/* Proveedor IPTV del laboratorio.

   Delante del proveedor falso de las pruebas (apps/server/test/fake-iptv,
   que ya hace de panel Xtream y de lista M3U con los canales de siempre) se
   pone este servidor, que:
   - atiende él los STREAMS (`/live/<u>/<p>/<id>.ts`, `/<u>/<p>/<id>` y
     `/live/<u>/<p>/<id>.m3u8` con sus segmentos) con una emisión de verdad:
     ffmpeg lee un clip de clips.ts en bucle a velocidad de directo (`-re`,
     `-c copy`) y aquí se reparte;
   - reenvía todo lo demás (player_api.php, get.php, la guía…) al proveedor
     falso tal cual.

   TS continuo (como Xtream `/live/…/<id>.ts`): el ffmpeg emisor escribe
   MPEG-TS por su salida y se guarda un anillo con los últimos segundos; cada
   conexión recibe primero `burstS` segundos de golpe (el colchón de los
   paneles) y luego el directo. Mandos por conexión (ver `TsNet`): tope de
   caudal (1,2× el del canal, por ejemplo), parones periódicos con ráfaga
   después (red irregular), corte a los N s (y opcionalmente otra base de
   tiempos al volver, reiniciando el emisor con `-output_ts_offset`) y
   «ocupado» (458) en las N reconexiones siguientes al corte.

   HLS (como muchos proveedores `.m3u8`): otro ffmpeg emisor con el muxer hls
   (segmentos TS de `segmentS`, ventana de `listSize`); se sirven la lista y los
   segmentos con mandos de retraso de la lista, caudal por segmento y retraso
   antes del primer byte.

   Todo lo que pasa queda en `events` (conexiones, cortes, parones, bytes)
   para la línea de tiempo del informe. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const TS = 188;

export interface TsNet {
  /** Segundos que se mandan de golpe al conectar (el colchón del panel). */
  readonly burstS: number;
  /** Tope de caudal, en veces el del canal (1,2 = un 20 % más que lo que ocupa). Sin él, sin tope. */
  readonly capFactor?: number;
  /** Parones periódicos: cada `everyS` (aleatorio en el rango) se deja de mandar `pauseS` segundos. */
  readonly jitter?: { readonly everyS: readonly [number, number]; readonly pauseS: readonly [number, number] };
  /** Corte de la conexión a los `afterS` segundos (la primera, o todas con `every`). */
  readonly cut?: {
    readonly afterS: number;
    readonly every?: boolean;
    /** Al volver, la emisión tiene otra base de tiempos (se reinicia el emisor con otro desfase). */
    readonly ptsJumpS?: number;
    /** Reconexiones que reciben 458 («ocupado») después del corte (el panel aún cuenta la plaza). */
    readonly busyAfter?: number;
    /** Tras el corte, el emisor se queda parado estos segundos (el canal «se cae» en origen). */
    readonly sourceGapS?: number;
  };
}

export interface HlsNet {
  readonly segmentS: number;
  readonly listSize: number;
  /** Retraso (ms, aleatorio en el rango) antes de contestar la lista. */
  readonly playlistDelayMs?: readonly [number, number];
  /** Tope de caudal de cada segmento, en veces el del canal. */
  readonly capFactor?: number;
  /** Retraso (ms, aleatorio en el rango) antes del primer byte de cada segmento. */
  readonly segmentDelayMs?: readonly [number, number];
  /** Cada `everyS` la lista se congela `staleS` segundos (el CDN sirve una vieja). */
  readonly stale?: { readonly everyS: number; readonly staleS: number };
}

export interface LabProviderOptions {
  readonly clip: string;
  readonly kind: 'ts' | 'hls';
  readonly ts?: TsNet;
  readonly hls?: HlsNet;
  /** Dónde está el proveedor falso (el panel Xtream y la M3U). */
  readonly upstream: { readonly host: string; readonly port: number };
  readonly host?: string;
  readonly workDir: string;
  readonly onEvent?: (event: ProviderEvent) => void;
}

export interface ProviderEvent {
  readonly at: number;
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface LabProvider {
  readonly port: number;
  readonly bytesPerSecond: number;
  readonly events: ProviderEvent[];
  /** Corta ahora todas las conexiones de stream abiertas. */
  cutNow(): void;
  /** Deja de mandar (TS) durante `seconds`. */
  pauseNow(seconds: number): void;
  close(): Promise<void>;
}

const rand = (range: readonly [number, number]): number =>
  range[0] + Math.random() * (range[1] - range[0]);

/** Duración de un clip TS según ffprobe (para el caudal medio). */
function clipBytesPerSecond(clip: string): number {
  const size = statSync(clip).size;
  const probe = spawnSyncText('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    clip,
  ]);
  const seconds = Number(probe.trim()) || 1;
  return size / seconds;
}

function spawnSyncText(cmd: string, args: string[]): string {
  const out = spawnSync(cmd, args, { encoding: 'utf8' });
  return out.stdout ?? '';
}

/* ---------- Emisor TS (ffmpeg -re en bucle, reparto con anillo) ---------- */

interface Chunk {
  readonly at: number;
  readonly buf: Buffer;
}

class TsEmitter {
  private child: ChildProcess | null = null;
  private carry: Buffer = Buffer.alloc(0);
  private ring: Chunk[] = [];
  private readonly listeners = new Set<(chunk: Buffer) => void>();
  private offsetS = 0;
  private stopped = false;
  private paused = false;

  constructor(
    private readonly clip: string,
    private readonly keepS: number,
    private readonly event: (type: string, data?: Record<string, unknown>) => void,
  ) {}

  start(offsetS = 0): void {
    this.offsetS = offsetS;
    this.carry = Buffer.alloc(0);
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-stream_loop',
      '-1',
      '-i',
      this.clip,
      '-map',
      '0',
      '-c',
      'copy',
      ...(offsetS ? ['-output_ts_offset', String(offsetS)] : []),
      '-f',
      'mpegts',
      'pipe:1',
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    this.event('emisor.start', { offsetS });
    child.stdout?.on('data', (data: Buffer) => this.onData(data));
    child.stderr?.on('data', (data: Buffer) =>
      this.event('emisor.stderr', { text: data.toString().slice(0, 300) }),
    );
    child.once('exit', (code) => {
      if (this.child === child) this.child = null;
      this.event('emisor.exit', { code });
    });
  }

  /** Para el emisor (el canal «se cae» en origen) y, si se pide, lo arranca con otro desfase. */
  restart(offsetS: number, gapS = 0): void {
    const old = this.child;
    this.child = null;
    old?.kill('SIGKILL');
    this.ring = [];
    this.paused = true;
    setTimeout(() => {
      this.paused = false;
      if (!this.stopped) this.start(offsetS);
    }, gapS * 1000);
  }

  private onData(data: Buffer): void {
    if (this.paused) return;
    let buf = this.carry.length ? Buffer.concat([this.carry, data]) : data;
    /* Alinear a paquetes de 188 con su 0x47. */
    let start = 0;
    while (start < buf.length && buf[start] !== 0x47) start += 1;
    buf = buf.subarray(start);
    const usable = buf.length - (buf.length % TS);
    this.carry = Buffer.from(buf.subarray(usable));
    if (!usable) return;
    const chunk = Buffer.from(buf.subarray(0, usable));
    const now = Date.now();
    this.ring.push({ at: now, buf: chunk });
    while (this.ring.length && now - (this.ring[0] as Chunk).at > this.keepS * 1000) this.ring.shift();
    for (const listener of [...this.listeners]) listener(chunk);
  }

  /** Los últimos `seconds` segundos del anillo. */
  recent(seconds: number): Buffer[] {
    const since = Date.now() - seconds * 1000;
    return this.ring.filter((chunk) => chunk.at >= since).map((chunk) => chunk.buf);
  }

  subscribe(listener: (chunk: Buffer) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get currentOffset(): number {
    return this.offsetS;
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill('SIGKILL');
    this.child = null;
  }
}

/* ---------- Emisor HLS (ffmpeg -re -f hls) ---------- */

class HlsEmitter {
  private child: ChildProcess | null = null;
  private stopped = false;

  constructor(
    private readonly clip: string,
    readonly dir: string,
    private readonly net: HlsNet,
    private readonly event: (type: string, data?: Record<string, unknown>) => void,
  ) {}

  start(): void {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-stream_loop',
      '-1',
      '-i',
      this.clip,
      '-map',
      '0',
      '-c',
      'copy',
      '-f',
      'hls',
      '-hls_time',
      String(this.net.segmentS),
      '-hls_list_size',
      String(this.net.listSize),
      '-hls_flags',
      'delete_segments+omit_endlist+temp_file',
      '-hls_segment_filename',
      path.join(this.dir, 'seg%d.ts'),
      path.join(this.dir, 'live.m3u8'),
    ];
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.child = child;
    this.event('emisor.start', { kind: 'hls' });
    child.stderr?.on('data', (data: Buffer) =>
      this.event('emisor.stderr', { text: data.toString().slice(0, 300) }),
    );
    child.once('exit', (code) => this.event('emisor.exit', { code }));
  }

  stop(): void {
    this.stopped = true;
    this.child?.kill('SIGKILL');
  }

  get running(): boolean {
    return !this.stopped && this.child !== null;
  }
}

/* ---------- Servidor ---------- */

export async function startLabProvider(options: LabProviderOptions): Promise<LabProvider> {
  const events: ProviderEvent[] = [];
  const event = (type: string, data: Record<string, unknown> = {}): void => {
    const entry = { at: Date.now(), type, ...data };
    events.push(entry);
    options.onEvent?.(entry);
  };
  const bytesPerSecond = clipBytesPerSecond(options.clip);
  const tsNet: TsNet = options.ts ?? { burstS: 2 };
  const hlsNet: HlsNet = options.hls ?? { segmentS: 6, listSize: 6 };
  const ts = options.kind === 'ts' ? new TsEmitter(options.clip, Math.max(30, tsNet.burstS + 5), event) : null;
  const hls =
    options.kind === 'hls'
      ? new HlsEmitter(options.clip, path.join(options.workDir, 'hls-origen'), hlsNet, event)
      : null;
  ts?.start(0);
  hls?.start();

  let connSeq = 0;
  let cutsDone = 0;
  let busyLeft = 0;
  const openTs = new Map<number, { res: http.ServerResponse; pauseUntil: number }>();
  let globalPauseUntil = 0;

  function serveTs(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!ts) {
      res.writeHead(404).end();
      return;
    }
    const id = ++connSeq;
    if (busyLeft > 0) {
      busyLeft -= 1;
      event('ts.busy', { conn: id, left: busyLeft });
      res.writeHead(458).end();
      return;
    }
    const net = tsNet;
    const queue: Buffer[] = [];
    let queued = 0;
    const opened = Date.now();
    let sent = 0;
    let lastSecondSent = 0;
    let closed = false;
    const state = { res, pauseUntil: 0 };
    openTs.set(id, state);
    res.writeHead(200, { 'content-type': 'video/mp2t', 'cache-control': 'no-store' });
    event('ts.open', { conn: id, burstS: net.burstS, offsetS: ts.currentOffset });
    for (const chunk of ts.recent(net.burstS)) {
      queue.push(chunk);
      queued += chunk.length;
    }
    const unsubscribe = ts.subscribe((chunk) => {
      queue.push(chunk);
      queued += chunk.length;
    });
    /* Parones periódicos. */
    let nextPauseAt = net.jitter ? opened + rand(net.jitter.everyS) * 1000 : Infinity;
    const cap = net.capFactor ? net.capFactor * bytesPerSecond : Infinity;
    let tokens = 0;
    let lastPump = Date.now();
    let waitingDrain = false;
    const cutAt =
      net.cut && (net.cut.every || cutsDone === 0) ? opened + net.cut.afterS * 1000 : Infinity;

    const finish = (why: string): void => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      unsubscribe();
      openTs.delete(id);
      event('ts.close', { conn: id, why, sentBytes: sent, openS: (Date.now() - opened) / 1000 });
    };

    const pump = (): void => {
      if (closed) return;
      const now = Date.now();
      if (now >= cutAt) {
        cutsDone += 1;
        event('ts.cut', { conn: id, afterS: (now - opened) / 1000 });
        const cut = net.cut;
        if (cut?.busyAfter) busyLeft = cut.busyAfter;
        if (cut?.ptsJumpS || cut?.sourceGapS) {
          ts.restart(ts.currentOffset + (cut.ptsJumpS ?? 0), cut.sourceGapS ?? 0);
        }
        res.destroy();
        finish('corte');
        return;
      }
      if (now >= nextPauseAt && net.jitter) {
        const pauseMs = rand(net.jitter.pauseS) * 1000;
        state.pauseUntil = now + pauseMs;
        nextPauseAt = now + pauseMs + rand(net.jitter.everyS) * 1000;
        event('ts.pause', { conn: id, ms: Math.round(pauseMs) });
      }
      if (now < state.pauseUntil || now < globalPauseUntil) {
        lastPump = now;
        return;
      }
      if (waitingDrain) return;
      if (cap !== Infinity) {
        tokens = Math.min(cap, tokens + ((now - lastPump) / 1000) * cap);
      }
      lastPump = now;
      while (queue.length) {
        const head = queue[0] as Buffer;
        let piece = head;
        if (cap !== Infinity) {
          if (tokens < TS) break;
          const allowed = Math.floor(tokens / TS) * TS;
          if (head.length > allowed) {
            piece = head.subarray(0, allowed);
            queue[0] = head.subarray(allowed);
          } else queue.shift();
          tokens -= piece.length;
        } else queue.shift();
        queued -= piece.length;
        sent += piece.length;
        if (!res.write(piece)) {
          waitingDrain = true;
          res.once('drain', () => {
            waitingDrain = false;
          });
          break;
        }
      }
      if (now - lastSecondSent >= 5000) {
        lastSecondSent = now;
        event('ts.progress', { conn: id, sentBytes: sent, queuedBytes: queued });
      }
    };
    const timer = setInterval(pump, 20);
    pump();
    res.once('close', () => finish('cliente'));
    req.once('close', () => finish('cliente'));
  }

  let hlsCache: { text: string; at: number } | null = null;
  let staleSince = 0;
  const hlsStartedAt = Date.now();

  async function serveHlsPlaylist(res: http.ServerResponse): Promise<void> {
    if (!hls) {
      res.writeHead(404).end();
      return;
    }
    const net = hlsNet;
    if (net.playlistDelayMs) await new Promise((r) => setTimeout(r, rand(net.playlistDelayMs as [number, number])));
    let text: string;
    const now = Date.now();
    const stale =
      net.stale && (now - hlsStartedAt) % (net.stale.everyS * 1000) < net.stale.staleS * 1000;
    if (stale && hlsCache) {
      if (!staleSince) {
        staleSince = now;
        event('hls.stale.start', {});
      }
      text = hlsCache.text;
    } else {
      if (staleSince) {
        event('hls.stale.end', { ms: now - staleSince });
        staleSince = 0;
      }
      try {
        text = await readFile(path.join(hls.dir, 'live.m3u8'), 'utf8');
      } catch {
        res.writeHead(404).end();
        return;
      }
      hlsCache = { text, at: now };
    }
    /* URIs absolutas a /lab/hls/: la lista se pide por /live/<u>/<p>/<id>.m3u8. */
    const body = text.replace(/^(seg\d+\.ts)$/gm, '/lab/hls/$1');
    const seq = /#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(body)?.[1];
    event('hls.playlist', { seq: Number(seq ?? -1), stale: Boolean(stale) });
    res.writeHead(200, {
      'content-type': 'application/vnd.apple.mpegurl',
      'cache-control': 'no-store',
      'content-length': String(Buffer.byteLength(body)),
    });
    res.end(body);
  }

  async function serveHlsSegment(name: string, res: http.ServerResponse): Promise<void> {
    if (!hls || !/^seg\d+\.ts$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    const net = hlsNet;
    let body: Buffer;
    try {
      body = readFileSync(path.join(hls.dir, name));
    } catch {
      event('hls.segment.404', { name });
      res.writeHead(404).end();
      return;
    }
    const started = Date.now();
    if (net.segmentDelayMs) await new Promise((r) => setTimeout(r, rand(net.segmentDelayMs as [number, number])));
    res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': String(body.length) });
    if (!net.capFactor) {
      res.end(body);
      event('hls.segment', { name, bytes: body.length, ms: Date.now() - started });
      return;
    }
    const rate = net.capFactor * bytesPerSecond;
    let offset = 0;
    await new Promise<void>((resolve) => {
      const step = (): void => {
        if (res.destroyed) {
          resolve();
          return;
        }
        const piece = Math.max(TS, Math.round((rate * 50) / 1000));
        const end = Math.min(body.length, offset + piece);
        res.write(body.subarray(offset, end));
        offset = end;
        if (offset >= body.length) {
          res.end();
          resolve();
          return;
        }
        setTimeout(step, 50);
      };
      step();
    });
    event('hls.segment', { name, bytes: body.length, ms: Date.now() - started });
  }

  function proxy(req: http.IncomingMessage, res: http.ServerResponse): void {
    const upstream = http.request(
      {
        host: options.upstream.host,
        port: options.upstream.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  }

  const server = http.createServer((req, res) => {
    res.on('error', () => undefined);
    const url = new URL(req.url ?? '/', 'http://lab');
    const p = url.pathname;
    const live = /^\/live\/[^/]+\/[^/]+\/(\d+)\.(ts|m3u8)$/.exec(p);
    const short = /^\/[^/]+\/[^/]+\/(\d+)$/.exec(p);
    if (p === '/__lab/cut') {
      provider.cutNow();
      res.end('{"ok":true}');
      return;
    }
    if (p === '/__lab/pause') {
      provider.pauseNow(Number(url.searchParams.get('s') ?? 5));
      res.end('{"ok":true}');
      return;
    }
    if ((live && live[2] === 'ts') || short) {
      serveTs(req, res);
      return;
    }
    if (live && live[2] === 'm3u8') {
      void serveHlsPlaylist(res);
      return;
    }
    const seg = /^\/lab\/hls\/(seg\d+\.ts)$/.exec(p);
    if (seg) {
      void serveHlsSegment(seg[1] as string, res);
      return;
    }
    proxy(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, options.host ?? '::1', resolve));
  const port = (server.address() as AddressInfo).port;
  event('provider.listen', { port, bytesPerSecond: Math.round(bytesPerSecond) });

  const provider: LabProvider = {
    port,
    bytesPerSecond,
    events,
    cutNow() {
      for (const [id, { res }] of openTs) {
        event('ts.cut', { conn: id, manual: true });
        res.destroy();
      }
    },
    pauseNow(seconds) {
      globalPauseUntil = Date.now() + seconds * 1000;
      event('ts.pause', { manual: true, ms: seconds * 1000 });
    },
    async close() {
      ts?.stop();
      hls?.stop();
      for (const { res } of openTs.values()) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  return provider;
}
