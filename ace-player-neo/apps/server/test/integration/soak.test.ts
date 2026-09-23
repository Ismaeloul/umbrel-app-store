/* Soak (paso 1.3): 2 horas SIMULADAS de reproducción con el backend entero
   (createServices) contra el motor AceStream falso, con cortes, silencios,
   motor colgado, caídas y reinicios del motor al azar (semilla fija, así cada
   ejecución es la misma). Comprueba que:

   - después de cada fallo la reproducción se recupera SOLA: el visor sigue
     con su sesión, la URL que tiene es la de la sesión viva del motor y
     nunca hay dos sesiones abiertas;
   - al terminar no queda ninguna sesión en el motor ni en sessions.json,
     ningún visor, ninguna cola y, tras el apagado, ningún temporizador;
   - la memoria no crece (heapUsed con gc entre medias).

   El cliente se porta como el reproductor: late cada 15 s; si el latido da
   410 o le llega `stream.closed`, vuelve a pedir el canal (eso contaría como
   "no se ha recuperado solo"). Un segundo visor entra y sale del mismo canal
   (compartir → HLS → vuelta). Arquitectura §5.5, §5.6; B-001 a B-013. */

import { appendFileSync } from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { TIMEOUTS, type StreamGrant } from '@ace/shared';
import { demoContentId } from '../fake-engine/catalog.js';
import { createHarness, WEB, type Harness } from './harness.js';

const X = demoContentId(1);
const MINUTE = 60_000;
const SOAK_MS = 2 * 60 * MINUTE;
const STEP_MS = 1000;
/** Tras el final de cada fallo, margen para que todo vuelva a su sitio. */
const RECOVERY_MS = 3 * MINUTE;

/** PRNG determinista (mulberry32): la misma semilla da siempre el mismo soak. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/* gc de verdad aunque vitest no arranque Node con --expose-gc. */
function collectGarbage(): () => void {
  v8.setFlagsFromString('--expose_gc');
  return vm.runInNewContext('gc') as () => void;
}

type FaultKind = 'restart' | 'down' | 'stall' | 'silence' | 'cut' | 'forget';

interface Fault {
  readonly kind: FaultKind;
  readonly at: number;
  readonly durationMs: number;
}

/** Un visor como el reproductor: pide el canal, late cada 15 s y, si lo pierde, lo vuelve a pedir. */
class Viewer {
  sid: string | null = null;
  url: string | null = null;
  lastBeat = 0;
  reacquires = 0;
  lost = false;

  constructor(
    private readonly h: Harness,
    readonly viewer: string,
    readonly device: string,
  ) {
    h.core.bus.on('stream.closed', (event) => {
      if (event.viewerIds.includes(this.viewer) && event.sessionId === this.sid) this.lost = true;
    });
    for (const type of ['stream.reopened', 'stream.modeChanged'] as const) {
      h.core.bus.on(type, (event) => {
        if (event.viewerIds.includes(this.viewer) && event.sessionId === this.sid) {
          this.url = event.url;
        }
      });
    }
  }

  async acquire(): Promise<boolean> {
    const res = await this.h.app.inject({
      method: 'GET',
      url: `/api/v1/channels/${X}/stream?client=web&viewer=${this.viewer}&device=${this.device}`,
      headers: WEB,
    });
    if (res.statusCode !== 200) return false;
    const grant = res.json() as StreamGrant;
    this.sid = grant.session.id;
    this.url = grant.url;
    this.lastBeat = this.h.clock.now();
    this.lost = false;
    return true;
  }

  /** Lo que hace el reproductor cada segundo: latir si toca y recuperar si lo ha perdido. */
  async step(): Promise<void> {
    const now = this.h.clock.now();
    if (this.sid && this.lost) {
      this.sid = null;
    }
    if (!this.sid) {
      if (await this.acquire()) this.reacquires += 1;
      return;
    }
    if (now - this.lastBeat < TIMEOUTS.viewerHeartbeatMs) return;
    this.lastBeat = now;
    const res = await this.h.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${this.sid}/heartbeat`,
      headers: { ...WEB, 'content-type': 'application/json' },
      payload: { viewer: this.viewer, playing: true },
    });
    if (res.statusCode === 200) this.url = (res.json() as { url: string }).url;
    else this.sid = null;
  }

  async release(): Promise<void> {
    if (!this.sid) return;
    await this.h.app.inject({
      method: 'POST',
      url: `/api/v1/sessions/${this.sid}/release`,
      headers: { ...WEB, 'content-type': 'application/json' },
      payload: { viewer: this.viewer, reason: 'user' },
    });
    this.sid = null;
    this.url = null;
  }
}

describe('soak · 2 h simuladas con fallos al azar (semilla fija)', () => {
  it(
    'siempre se recupera sola, sin sesiones ni temporizadores colgados y sin crecer en memoria',
    { timeout: 300_000 },
    async () => {
      const gc = collectGarbage();
      const random = prng(20_260_923);
      /* Sin caducidad por falta de lectores: aquí nadie lee el vídeo de verdad. */
      const h = await createHarness({ idleTimeoutMs: 24 * 60 * MINUTE });
      const start = h.clock.now();
      const main = new Viewer(h, 'visor-pc-1', 'pc-salon');
      const guest = new Viewer(h, 'visor-tv-1', 'tele-salon');
      expect(await main.acquire()).toBe(true);

      /* El guion de fallos: uno cada 6-12 min, del tipo y la duración que toquen. */
      const kinds: FaultKind[] = ['restart', 'down', 'stall', 'silence', 'cut', 'forget'];
      const faults: Fault[] = [];
      for (let at = start + 5 * MINUTE; at < start + SOAK_MS - 10 * MINUTE;) {
        const kind = kinds[Math.floor(random() * kinds.length)] as FaultKind;
        const durationMs =
          kind === 'restart'
            ? 5000 + Math.floor(random() * 35_000)
            : kind === 'down'
              ? 15_000 + Math.floor(random() * 35_000)
              : kind === 'stall'
                ? 20_000 + Math.floor(random() * 25_000)
                : kind === 'forget'
                  ? 0
                  : 30_000 + Math.floor(random() * 60_000);
        faults.push({ kind, at, durationMs });
        at += 6 * MINUTE + Math.floor(random() * 6 * MINUTE);
      }
      /* El invitado entra y sale del mismo canal (compartir ↔ progresivo). */
      const guestToggles = new Set<number>();
      for (let at = start + 3 * MINUTE; at < start + SOAK_MS - 5 * MINUTE;) {
        guestToggles.add(Math.round((at - start) / STEP_MS));
        at += 4 * MINUTE + Math.floor(random() * 10 * MINUTE);
      }

      const checks: string[] = [];
      const heap: number[] = [];
      let active: { fault: Fault; end: () => Promise<void>; endsAt: number } | null = null;
      let nextFault = 0;
      let checkAt: number | null = null;

      const verify = (label: string): void => {
        const metrics = h.fake.control.metrics();
        const engineSession = h.fake.control.activeSession(X);
        const sessions = h.playback.inspect().sessions;
        const problems: string[] = [];
        if (!main.sid) problems.push('el visor no tiene sesión');
        if (metrics.sessionsOpen !== 1)
          problems.push(`sesiones en el motor: ${metrics.sessionsOpen}`);
        if (sessions.length !== 1) problems.push(`sesiones en playback: ${sessions.length}`);
        if (!engineSession) problems.push('el motor no tiene sesión del canal');
        else if (!main.url?.includes(engineSession.id))
          problems.push('la URL del visor no es la viva');
        if (h.services.engine.status().status !== 'online') problems.push('motor no online');
        if (problems.length) checks.push(`${label}: ${problems.join(', ')}`);
      };

      for (let tick = 1; h.clock.now() - start < SOAK_MS; tick += 1) {
        const now = h.clock.now();
        /* ¿Empieza un fallo? */
        const fault = faults[nextFault];
        if (!active && fault && now >= fault.at) {
          nextFault += 1;
          const endsAt = now + fault.durationMs;
          switch (fault.kind) {
            case 'restart': {
              const restarted = h.fake.control.restart({ downMs: fault.durationMs });
              active = {
                fault,
                endsAt,
                end: async () => {
                  h.engineClock.advance(fault.durationMs);
                  await restarted;
                },
              };
              break;
            }
            case 'forget':
              await h.fake.control.reset({ sessions: true });
              active = { fault, endsAt, end: async () => undefined };
              break;
            case 'down':
            case 'stall':
              await h.fake.control.setMode('*', fault.kind);
              active = { fault, endsAt, end: () => h.fake.control.clearMode('*') };
              break;
            default:
              await h.fake.control.setMode(X, fault.kind);
              active = { fault, endsAt, end: () => h.fake.control.clearMode(X) };
          }
        }
        if (active && now >= active.endsAt) {
          await active.end();
          checkAt = now + RECOVERY_MS;
          const label = `${active.fault.kind} de ${Math.round(active.fault.durationMs / 1000)} s a los ${Math.round((active.fault.at - start) / MINUTE)} min`;
          active = null;
          checks.push(`#${label}`);
        }
        if (checkAt !== null && now >= checkAt && !active) {
          verify(checks.at(-1)?.slice(1) ?? '¿?');
          checkAt = null;
        }
        if (guestToggles.has(tick)) {
          if (guest.sid) await guest.release();
          else await guest.acquire();
        }
        await main.step();
        if (guest.sid) await guest.step();
        /* Con el motor colgado hay peticiones que solo acaban al avanzar el reloj: tope corto. */
        await h.advance(STEP_MS, STEP_MS, { maxRealMs: 25 });
        /* Una línea por minuto simulado con SOAK_LOG=<fichero> (para depurar). */
        if (tick % 60 === 0 && process.env.SOAK_LOG) {
          const line = [
            tick / 60,
            Math.round(performance.now()),
            active?.fault.kind ?? '-',
            h.services.engine.status().status,
            main.sid ? 'ok' : 'sin',
          ];
          appendFileSync(process.env.SOAK_LOG, JSON.stringify(line) + '\n');
        }
        if (tick % (20 * 60) === 0) {
          h.bus.clear();
          gc();
          heap.push(process.memoryUsage().heapUsed);
        }
      }

      const problems = checks.filter((line) => !line.startsWith('#'));
      const executed = checks.filter((line) => line.startsWith('#')).map((line) => line.slice(1));
      expect(executed.length).toBeGreaterThanOrEqual(8);
      expect(new Set(executed.map((line) => line.split(' ')[0])).size).toBeGreaterThanOrEqual(4);
      expect(problems).toEqual([]);
      /* Todo lo arregló el servidor: el visor nunca tuvo que volver a pedir el canal. */
      expect(main.reacquires).toBe(0);
      verify('final');
      expect(checks.filter((line) => !line.startsWith('#'))).toEqual([]);

      await guest.release();
      await main.release();
      await h.settle();
      expect(h.fake.control.metrics().sessionsOpen).toBe(0);
      expect(h.playback.inspect()).toEqual({
        sessions: [],
        viewers: [],
        viewerQueues: 0,
        background: 0,
        ticking: false,
      });
      await h.services.state.flush();
      expect(h.services.state.sessions().read().sessions).toEqual([]);
      expect(h.remux.service.stats().sessions).toBe(0);

      /* Memoria: de la primera medida (20 min) a la última, casi plana. */
      expect(heap.length).toBeGreaterThanOrEqual(5);
      const growth = (heap.at(-1) ?? 0) - (heap[0] ?? 0);
      expect(growth).toBeLessThan(8 * 1024 * 1024);

      await h.close();
      expect(h.clock.pendingTimers()).toBe(0);
      expect(h.engineClock.pendingTimers()).toBe(0);
      /* Resumen para el informe (SOAK_LOG=<fichero> para verlo). */
      const summary = `[soak] ${executed.length} fallos: ${executed.join('; ')} · heap ${heap
        .map((bytes) => `${(bytes / 1048576).toFixed(1)}`)
        .join(' → ')} MiB · crecimiento ${(growth / 1048576).toFixed(2)} MiB`;
      if (process.env.SOAK_LOG) appendFileSync(process.env.SOAK_LOG, summary + '\n');
    },
  );
});
