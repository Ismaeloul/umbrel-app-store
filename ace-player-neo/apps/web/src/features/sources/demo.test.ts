/* Las fuentes de la sala en directo en la demo (`partyLiveSources`, directo
   §14): con la forma exacta de la ruta, y el sondeo (`job`) trae las mismas
   fuentes con el estado del comprobador. */

import { PartyLiveSourcesResponseSchema } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { registeredDemoHandler } from '../../api/demo-registry.ts';
import './demo.ts';

describe('demo de las fuentes de la sala en directo', () => {
  it('contesta la resolución del partido de ejemplo y su sondeo', async () => {
    const handler = registeredDemoHandler('partyLiveSources');
    expect(handler).not.toBeNull();
    const params = { code: 'd7R2vN8qLx4Tz6Wp' };
    const token = 'm_IsmaAnfitrion.c2VjcmV0b0RlRWplbXBsbzAx';
    const first = PartyLiveSourcesResponseSchema.parse(
      await handler!({ params, query: { t: token }, body: undefined as never }),
    );
    expect(first.candidates.length).toBeGreaterThan(3);
    expect(first.scan?.status).toBe('running');
    const polled = PartyLiveSourcesResponseSchema.parse(
      await handler!({
        params,
        query: { t: token, job: first.scan!.id },
        body: undefined as never,
      }),
    );
    expect(polled.scan?.id).toBe(first.scan?.id);
    expect(polled.candidates.map((candidate) => candidate.id)).toEqual(
      first.candidates.map((candidate) => candidate.id),
    );
  });
});
