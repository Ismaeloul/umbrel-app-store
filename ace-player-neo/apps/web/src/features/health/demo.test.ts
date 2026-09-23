import {
  DiagnosticsListResponseSchema,
  HealthResponseSchema,
} from '@ace/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { api } from '../../api/client.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { demoDiagnostics, demoHealth, registerHealthDemo } from './demo.ts';

afterEach(() => resetMode());

describe('salud en la demo', () => {
  it('cumple el contrato de la API y los recuentos cuadran con la lista', () => {
    const now = Date.parse('2026-09-23T18:30:00.000Z');
    const health = HealthResponseSchema.parse(demoHealth(now));
    const list = DiagnosticsListResponseSchema.parse(demoDiagnostics({}, now));
    expect(health.diagnostics.counts24h).toEqual(list.counts24h);
    // Uno de los de muestra tiene más de 24 h: está en la lista pero no cuenta.
    const counted = Object.values(list.counts24h).reduce((a, b) => a + b, 0);
    expect(list.entries.length).toBe(counted + 1);
    // Del más reciente al más antiguo, como el backend.
    const times = list.entries.map((e) => Date.parse(e.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filtra por causa y respeta el límite', () => {
    const engine = demoDiagnostics({ cause: 'engine' });
    expect(engine.entries.every((e) => e.cause === 'engine')).toBe(true);
    expect(engine.entries.length).toBeGreaterThan(0);
    // `total` cuenta los que casan con el filtro, como el backend.
    expect(engine.total).toBe(engine.entries.length);
    expect(demoDiagnostics({ limit: 2 }).entries).toHaveLength(2);
  });

  it('en modo demo, /health y /diagnostics contestan con la muestra', async () => {
    registerHealthDemo();
    setMode('demo', 'param');
    const list = await api('diagnosticsList', { query: { cause: 'source', limit: 50 } });
    expect(list.entries.length).toBeGreaterThan(1);
    expect(list.entries.every((e) => e.cause === 'source')).toBe(true);
    const health = await api('health');
    expect(health.components.scanner.busy).toBe(true);
  });
});
