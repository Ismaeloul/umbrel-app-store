/* La demo del centro de partido: respuestas con la forma exacta de la API
   (zod de @ace/shared) y guiones que enseñan cada caso. */

import { BindResponseSchema, ReportResponseSchema, ResolutionSchema, ScanJobSchema } from '@ace/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_STEP_MS, demoBind, demoHash, demoReport, demoResolve, demoScan, resetDemoJobs } from './demo-data.ts';

beforeEach(() => resetDemoJobs());

describe('demo del centro de partido', () => {
  it('hashes de 40 hex y deterministas', () => {
    expect(demoHash('a')).toMatch(/^[a-f0-9]{40}$/);
    expect(demoHash('a')).toBe(demoHash('a'));
    expect(demoHash('a')).not.toBe(demoHash('b'));
  });

  it('demo-1: seis fuentes, comprobador que avanza y termina', () => {
    const data = ResolutionSchema.parse(demoResolve({ match: 'demo-1', channel: ['DAZN'] }));
    expect(data.status).toBe('found');
    expect(data.candidates).toHaveLength(6);
    expect(data.candidates[0]?.title).toBe('DAZN --> Elcano');
    const id = data.scan!.id;
    const start = Date.parse(ScanJobSchema.parse(demoScan(id)).createdAt);
    const first = ScanJobSchema.parse(demoScan(id, start));
    expect(first.status).toBe('running');
    expect(first.checked).toBe(0);
    const later = ScanJobSchema.parse(demoScan(id, start + 3 * DEMO_STEP_MS));
    expect(later.candidates[0]?.state).toBe('working');
    const end = ScanJobSchema.parse(demoScan(id, start + 20 * DEMO_STEP_MS));
    expect(end.status).toBe('complete');
    expect(end.candidates.map((c) => c.state)).toEqual(['working', 'working', 'weak', 'working', 'failed', 'failed']);
    expect(end.candidates[4]?.retryAt).not.toBeNull();
  });

  it('demo-12: ninguna da señal y el comprobador queda en reposo con hora', () => {
    const data = demoResolve({ match: 'demo-12', channel: 'DAZN 1' });
    const id = data.scan!.id;
    const start = Date.parse(demoScan(id).createdAt);
    const end = ScanJobSchema.parse(demoScan(id, start + 10 * DEMO_STEP_MS));
    expect(end.status).toBe('waiting');
    expect(end.retryAt).not.toBeNull();
  });

  it('demo-2 da a elegir y demo-3 no encuentra nada', () => {
    expect(ResolutionSchema.parse(demoResolve({ match: 'demo-2', channel: 'Zapping' }))).toMatchObject({
      status: 'choices',
      scan: null,
    });
    expect(ResolutionSchema.parse(demoResolve({ match: 'demo-3', channel: 'La 1 HD' }))).toMatchObject({
      status: 'not_found',
      candidates: [],
    });
  });

  it('rebuscar añade dos más; un trabajo desconocido sale cancelado', () => {
    expect(demoResolve({ match: 'demo-1', channel: 'DAZN', research: '1' }).candidates).toHaveLength(8);
    expect(ScanJobSchema.parse(demoScan('ffffffffffffffffffffffff')).status).toBe('cancelled');
  });

  it('reportes y vínculos con su forma', () => {
    const data = demoResolve({ match: 'demo-1', channel: 'DAZN' });
    const report = ReportResponseSchema.parse(demoReport({ id: data.candidates[0]!.id, reason: 'stuttering', matchId: 'demo-1' }));
    expect(report.report.reason).toBe('stuttering');
    expect(report.scan).not.toBeNull();
    const bound = BindResponseSchema.parse(demoBind({ channel: 'DAZN', id: data.candidates[0]!.id, title: 'DAZN HD' }));
    expect(bound.binding.channelKey).toBeTruthy();
  });
});
