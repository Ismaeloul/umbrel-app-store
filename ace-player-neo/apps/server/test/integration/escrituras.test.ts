/* Integración: T-108 con los módulos de verdad (B-201).

   Por qué (verificación del backend, 23-09-2026): el T-108 portado en
   state/routes.test.ts monta un `POST /api/football/bind` de mentira que
   imita a `saveChannelBinding`, así que probaba la cola del estado pero no el
   módulo `football` que de verdad guarda el vínculo. Aquí el backend entero
   (createServices, como main.ts) escucha en ::1 y se repite el test original
   (tests/server.test.js:1885-1911): las cabeceras del bind llegan, entre
   medias entra un `POST /api/preferences` rápido y el cuerpo del bind llega
   después. Las dos escrituras tienen que quedar, en memoria y en disco. */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, WEB, type Harness } from './harness.js';

const ID_A = 'a'.repeat(40);

let current: Harness | null = null;

afterEach(async () => {
  await current?.close();
  current = null;
});

describe('integración · T-108: una petición lenta no pisa a la rápida (B-201)', () => {
  it('bind con el cuerpo retrasado + preferencias entre medias: quedan las dos', async () => {
    const h = await createHarness();
    current = h;
    /* Servidor real en ::1: en este PC 127.0.0.1 corta ~1 de cada 6 conexiones. */
    await h.app.listen({ host: '::1', port: 0 });
    const { port } = h.app.server.address() as AddressInfo;
    const agent = new http.Agent({ keepAlive: false });
    const body = Buffer.from(
      JSON.stringify({ channel: 'DAZN 1', id: ID_A, title: 'DAZN 1', ih: false }),
    );
    const slow = http.request({
      host: '::1',
      port,
      agent,
      method: 'POST',
      path: '/api/football/bind',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    });
    const slowResponse = new Promise<{ status: number; body: string }>((resolve, reject) => {
      slow.on('response', (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      slow.on('error', reject);
    });
    /* El original esperaba 120 ms tras mandar las cabeceras. Aquí se espera a
       que el servidor las haya RECIBIDO de verdad (su evento `request`), así
       la rápida entra siempre con la lenta ya dentro y sin cuerpo; sin esta
       espera la rápida podía adelantarse y el test no probaría nada. */
    const slowArrived = new Promise<void>((resolve) => {
      const onRequest = (req: http.IncomingMessage): void => {
        if (req.url !== '/api/football/bind') return;
        h.app.server.off('request', onRequest);
        resolve();
      };
      h.app.server.on('request', onRequest);
    });
    slow.flushHeaders(); // las cabeceras ya; el cuerpo, después
    await slowArrived;

    const fast = await h.app.inject({
      method: 'POST',
      url: '/api/preferences',
      headers: { ...WEB, 'content-type': 'application/json' },
      payload: {
        onboardingComplete: true,
        country: 'Spain',
        leagues: ['LaLiga'],
        teams: [],
        nationalities: [],
      },
    });
    expect(fast.statusCode).toBe(200);

    slow.end(body);
    const done = await slowResponse;
    agent.destroy();
    expect(done.status, done.body).toBe(200);
    expect(JSON.parse(done.body)).toMatchObject({ success: true, binding: { id: ID_A } });

    const state = h.services.state.get();
    expect(state.preferences.leagues).toEqual(['LaLiga']);
    expect(state.channelBindings[0]?.id).toBe(ID_A);
    /* Y en disco: lo que se lee al volver a arrancar. */
    await h.services.state.flush();
    const disk = JSON.parse(readFileSync(h.core.config.paths.stateFile, 'utf8')) as {
      preferences: { leagues: string[] };
      channelBindings: { id: string }[];
    };
    expect(disk.preferences.leagues).toEqual(['LaLiga']);
    expect(disk.channelBindings[0]?.id).toBe(ID_A);
  });
});
