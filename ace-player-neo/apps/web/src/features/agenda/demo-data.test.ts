import { FootballScheduleSchema, LiveScoreSchema, PreheatPublicSchema } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { demoPreheat, demoSchedule, demoScores, setDemoAnchor } from './demo-data.ts';
import { matchStatus } from './domain.ts';
import { NOW, TODAY } from './test-utils.tsx';

describe('agenda de la demo (inventario §3.8)', () => {
  it('tiene la forma exacta de la API y los 11 partidos de la 0.6.59 (más 2 de hoy)', () => {
    setDemoAnchor(NOW);
    const schedule = FootballScheduleSchema.parse(demoSchedule());
    expect(schedule.attribution).toBe('Datos de muestra');
    expect(schedule.demo).toBe(true);
    const ids = schedule.days.flatMap((day) => day.matches.map((match) => match.id));
    for (let i = 1; i <= 11; i += 1) expect(ids).toContain(`demo-${i}`);
    expect(ids).toHaveLength(13);
    expect(schedule.days.length).toBeGreaterThanOrEqual(5);
    // El alias que la regla de equipos NO debe confundir sigue ahí.
    const names = schedule.days.flatMap((day) => day.matches.map((m) => m.home));
    expect(names).toEqual(expect.arrayContaining(['FC Barcelona', 'Barcelona SC']));
  });

  it('hoy hay directos, uno en el descanso, próximos y uno terminado', () => {
    setDemoAnchor(NOW);
    const today = demoSchedule().days.find((day) => day.date === TODAY)?.matches ?? [];
    const scores = demoScores(NOW);
    const phases = today.map((match) => matchStatus(match, NOW, scores[match.id])?.phase);
    expect(phases).toEqual(expect.arrayContaining(['live', 'soon', 'next', 'done']));
    expect(scores['demo-4']?.detail).toBe('HT');
    expect(scores['demo-13']?.state).toBe('post');
    for (const score of Object.values(scores)) LiveScoreSchema.parse(score);
  });

  it('los goles caen en su minuto: el marcador avanza con el reloj', () => {
    setDemoAnchor(NOW);
    const before = demoScores(NOW)['demo-1'];
    const later = demoScores(NOW + 10 * 60_000)['demo-1'];
    expect(before).toMatchObject({ home: 1, away: 1, state: 'in' });
    expect(later).toMatchObject({ home: 2, away: 1 });
  });

  it('señal simulada por partido (precalentado)', () => {
    setDemoAnchor(NOW);
    const ready = demoPreheat('demo-1');
    expect(ready && PreheatPublicSchema.parse(ready)).toMatchObject({
      status: 'ready',
      playable: 3,
    });
    expect(demoPreheat('demo-8')).toBeNull();
  });
});
