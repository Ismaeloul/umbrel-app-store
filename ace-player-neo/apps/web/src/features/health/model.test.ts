import type { DiagnosticEntry, EngineStatus, HealthResponse } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { fixture } from '../../test/fetch.ts';
import {
  CAUSES,
  describeEntry,
  engineNote,
  formatUptime,
  formatWhen,
  groupBySource,
  healthSummary,
  metricsSentence,
  seconds,
  serviceRows,
  statusLabel,
  statusSignal,
} from './model.ts';

const NOW = Date.parse('2026-09-23T18:30:00.000Z');
const health = () => fixture<HealthResponse>('health');

function entry(over: Partial<DiagnosticEntry>): DiagnosticEntry {
  return {
    id: `diag_${Math.random().toString(36).slice(2, 10)}`,
    at: new Date(NOW - 60_000).toISOString(),
    cause: 'source',
    code: 'source_no_peers',
    message: 'La fuente no tiene pares.',
    ...over,
  };
}

describe('palabras y formas de cada estado', () => {
  it('las diez etiquetas de la 0.6.59 (index.html:4271) y las nuevas', () => {
    expect(
      [
        'ready',
        'warming',
        'discovered',
        'scanning',
        'degraded',
        'stale',
        'model_missing',
        'offline',
        'disabled',
        'empty',
      ].map(statusLabel),
    ).toEqual([
      'Listo',
      'Preparando',
      'Preparado',
      'Comprobando',
      'Con avisos',
      'Copia anterior',
      'Falta el modelo',
      'Sin conexión',
      'Desactivado',
      'Vacío',
    ]);
    expect(statusLabel('restarting')).toBe('Reiniciándose');
    expect(statusLabel('lo-que-sea')).toBe('Desconocido');
  });

  it('colores de la 0.6.59 como forma: verde listo, ámbar avisos, rojo caído o vacío, gris el resto', () => {
    expect(statusSignal('ready')).toBe('ok');
    for (const s of ['degraded', 'warming', 'model_missing', 'stale', 'restarting']) {
      expect(statusSignal(s)).toBe('weak');
    }
    for (const s of ['offline', 'failed', 'empty']) expect(statusSignal(s)).toBe('fail');
    expect(statusSignal('disabled')).toBe('pending');
    expect(statusSignal('unknown')).toBe('checking');
  });
});

describe('cuadrícula por servicio', () => {
  it('los seis de la 0.6.59 con su detalle, más datos guardados y reproducción', () => {
    const rows = serviceRows(health(), null, NOW);
    expect(rows.map((r) => r.name)).toEqual([
      'Backend',
      'Motor principal',
      'Segundo motor',
      'IA local',
      'Agenda',
      'Directorios M3U',
      'Datos guardados',
      'Reproducción',
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.backend?.detail).toBe('v0.7.0 · 1 h activo');
    expect(by.engine?.detail).toBe('Aceptando reproducción · versión 3.2.3');
    expect(by.scanner?.detail).toBe('0 trabajos · 0 en cola');
    expect(by.ai?.detail).toBe('Sin configurar');
    expect(by.ai?.label).toBe('Desactivado');
    expect(by.agenda?.detail).toBe('120 partidos · 3 preparados');
    expect(by.directories?.detail).toBe('2 canales · 1 lista');
    expect(by.playback?.detail).toBe('1 sesión · 2 visores');
    expect(by.playback?.note).toBe('2 conexiones en tiempo real · 1 en remux (iPhone).');
    // Es un dato, no un aviso (no va en ámbar); el de las fugas del comprobador sí.
    expect(by.playback?.noteTone).toBe('info');
    expect(by.engine?.noteTone).toBe('warn');
  });

  it('el motor sale del estado EN VIVO (SSE) si lo hay, no de la foto de /health', () => {
    const live: EngineStatus = { ...health().components.engine, status: 'offline', online: false };
    const engine = serviceRows(health(), live, NOW).find((r) => r.id === 'engine');
    expect(engine).toMatchObject({ label: 'Sin conexión', signal: 'fail', detail: 'No responde' });
  });

  it('avisos del motor: reinicios automáticos y cupo agotado', () => {
    const base = health().components.engine;
    expect(engineNote(base, NOW)).toBeNull();
    expect(engineNote({ autoRestarts: { ...base.autoRestarts, lastHour: 2 } }, NOW)).toBe(
      '2 de 3 reinicios automáticos en la última hora.',
    );
    const next = new Date(NOW + 20 * 60_000);
    const note = engineNote(
      { autoRestarts: { lastHour: 3, max: 3, nextAllowedAt: next.toISOString(), exhausted: true } },
      NOW,
    );
    expect(note).toMatch(
      /^Ya se ha reiniciado solo 3 veces en una hora: no lo volverá a hacer hasta las \d\d:\d\d\.$/,
    );
  });

  it('segundo motor con fugas, IA sin modelo, agenda vieja y datos recuperados', () => {
    const h = health();
    h.components.scanner = {
      ...h.components.scanner,
      leakedSessionsLastHour: 2,
      activeJobs: 1,
      queue: 4,
    };
    h.components.ai = { status: 'model_missing', model: 'embeddinggemma' };
    h.components.agenda = { ...h.components.agenda, status: 'stale' };
    h.components.state = { status: 'recovered', recoveredFrom: 'state.json.bak' };
    const by = Object.fromEntries(serviceRows(h, null, NOW).map((r) => [r.id, r]));
    expect(by.scanner?.detail).toBe('1 trabajo · 4 en cola');
    expect(by.scanner?.note).toBe('2 sesiones sin cerrar en la última hora.');
    expect(by.ai?.detail).toBe('Falta embeddinggemma');
    expect(by.agenda?.label).toBe('Copia anterior');
    expect(by.agenda?.detail).toMatch(/ · de las \d\d:\d\d$/);
    expect(by.state).toMatchObject({
      label: 'Recuperado',
      detail: 'Se usó una copia (state.json.bak)',
    });
  });
});

describe('resumen', () => {
  it('la frase de arriba y los datos de la 0.6.59 (cuarentena, aprendidas y hora)', () => {
    const h = health();
    const summary = healthSummary(h, serviceRows(h, null, NOW));
    // La IA desactivada es gris: no es un aviso.
    expect(summary.tone).toBe('ok');
    expect(summary.headline).toBe('Todo funciona.');
    expect(summary.facts[0]).toBe('1 fuente en cuarentena');
    expect(summary.facts[1]).toBe('4 correcciones aprendidas');
    expect(summary.facts[2]).toMatch(/^comprobado \d\d:\d\d$/);
  });

  it('con avisos, con un servicio caído y con varios', () => {
    const h = health();
    h.warnings = [{ code: 'x', message: 'Algo' }];
    expect(healthSummary(h, serviceRows(h, null, NOW)).headline).toBe('Todo funciona, con avisos.');
    const offline: EngineStatus = { ...h.components.engine, status: 'offline', online: false };
    expect(healthSummary(h, serviceRows(h, offline, NOW))).toMatchObject({
      tone: 'fail',
      headline: 'Motor principal: sin conexión.',
    });
    h.components.directories = { status: 'empty', total: 0, channels: 0 };
    expect(healthSummary(h, serviceRows(h, offline, NOW)).headline).toBe(
      'Hay 2 servicios con problemas.',
    );
  });
});

describe('tiempos en claro', () => {
  it('tiempo activo, segundos y «cuándo»', () => {
    expect(formatUptime(59)).toBe('0 min');
    expect(formatUptime(3600)).toBe('1 h');
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
    expect(formatUptime(5 * 86400)).toBe('5 días');
    expect(seconds(2300)).toBe('2,3 s');
    const at = (ms: number) => new Date(NOW - ms).toISOString();
    expect(formatWhen(at(10_000), NOW).relative).toBe('ahora mismo');
    expect(formatWhen(at(5 * 60_000), NOW).relative).toBe('hace 5 min');
    expect(formatWhen(at(30 * 3600_000), NOW).relative).toMatch(/^(ayer|\d+ \w+)$/);
    expect(formatWhen(at(5 * 86400_000), NOW).relative).toMatch(
      /^\d+ (ene|feb|mar|abr|may|jun|jul|ago|sept|oct|nov|dic)$/,
    );
    expect(formatWhen('no-es-fecha', NOW)).toEqual({ time: '—', relative: '' });
  });
});

describe('registro de diagnóstico', () => {
  it('las seis causas de @ace/shared, en su orden', async () => {
    const { DIAGNOSTIC_CAUSES } = await import('@ace/shared');
    expect([...CAUSES]).toEqual([...DIAGNOSTIC_CAUSES]);
  });

  it('describe el fallo: su mensaje, el del código si viene vacío o el de la causa', () => {
    expect(describeEntry(entry({ message: 'el comprobador pudo dejar una sesión abierta' }))).toBe(
      'El comprobador pudo dejar una sesión abierta',
    );
    expect(
      describeEntry(entry({ message: '', code: 'engine_unavailable', cause: 'engine' })),
    ).not.toBe('');
    expect(describeEntry(entry({ message: '', code: 'raro', cause: 'client' }))).toMatch(
      /^Lo avisa un dispositivo/,
    );
    // Un informe de métricas no es un fallo.
    expect(
      describeEntry(
        entry({ message: '', code: 'player_metrics', cause: 'client', metrics: { rebuffers: 0 } }),
      ),
    ).toBe('Resumen de una reproducción en un dispositivo.');
  });

  it('métricas del reproductor en claro', () => {
    expect(metricsSentence(undefined)).toBeNull();
    expect(
      metricsSentence({
        timeToFirstFrameMs: 2300,
        rebuffers: 2,
        rebufferMs: 4100,
        reconnects: 1,
        liveLatencyS: 14.2,
      }),
    ).toBe(
      'Imagen en 2,3 s · 2 cortes (4,1 s en total) · 1 reconexión · 14 s por detrás del directo',
    );
  });

  it('por fuente: agrupa por hash (o canal), solo 24 h, de la que más falla a la que menos', () => {
    const groups = groupBySource(
      [
        entry({ hash: 'a'.repeat(40), channel: 'DAZN 1' }),
        entry({
          hash: 'a'.repeat(40),
          channel: 'DAZN 1 HD',
          cause: 'client',
          at: new Date(NOW - 30_000).toISOString(),
        }),
        entry({ channel: 'Teledeporte' }),
        entry({ hash: 'b'.repeat(40), at: new Date(NOW - 25 * 3600_000).toISOString() }),
        entry({ cause: 'engine' }),
      ],
      NOW,
    );
    expect(groups.map((g) => [g.name, g.count])).toEqual([
      ['DAZN 1 HD', 2],
      ['Teledeporte', 1],
    ]);
    expect(groups[0]?.causes).toEqual(['source', 'client']);
    expect(groupBySource([entry({ hash: 'c'.repeat(40) })], NOW)[0]?.name).toBe('Fuente cccccccc');
  });
});
