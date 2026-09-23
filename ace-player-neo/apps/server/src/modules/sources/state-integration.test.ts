/* Fuentes con el módulo `state` DE VERDAD (state.json en un temporal):
   informes, correcciones y estadísticas se persisten con las normas de la
   0.6.59 y sobreviven a una recarga; lo que quedó en `checking` se suelta al
   arrancar (backend-modulos §8.2.11). */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTestCore } from '../../../test/helpers/index.js';
import { createTestScanner, scriptedTransport, tick } from '../scanner/test-support.js';
import { createStateService } from '../state/index.js';
import { createSourcesService } from './index.js';

const ID_A = 'a'.repeat(40);
const ID_B = 'b'.repeat(40);

describe('fuentes sobre el estado real', () => {
  it('informe, corrección y resultado quedan en state.json y se recargan', async () => {
    const core = createTestCore({ env: { ACESTREAM_SCANNER_HOST: 'scanner' } });
    const state = createStateService(core);
    await state.load();
    const scanner = createTestScanner(core, scriptedTransport({ [ID_B]: 'failed' }).transport);
    const sources = createSourcesService({ ...core, state, scanner });
    await sources.start();

    const wrong = await sources.report({ id: ID_A, reason: 'wrong_channel', channel: 'M+ Liga' });
    expect(wrong.report.state).toBe('checking');
    await sources.report({ id: ID_B, reason: 'not_starting', channel: 'DAZN 1' });
    await sources.outcome({ id: ID_A, resultado: 'arranco', title: 'X --> ELCANO' });
    await tick(core.clock, 5000, 100);
    await state.flush();

    let saved = state.get();
    const byId = Object.fromEntries(saved.sourceReports.map((report) => [report.id, report]));
    expect(byId[ID_A]).toMatchObject({ reason: 'wrong_channel', state: 'reported' });
    /* El de ID_B espera su reintento: sigue en checking. */
    expect(byId[ID_B]?.state).toBe('checking');
    expect(saved.channelFeedback[0]).toMatchObject({ id: ID_A, verdict: 'incorrect' });
    expect(saved.sourceStats.proveedores.elcano?.exitos).toBe(1);

    const confirmed = await sources.feedback({ id: ID_A, channel: 'M+ Liga', verdict: 'correct' });
    expect(confirmed.learningCount).toBe(1);
    await state.flush();
    const file = JSON.parse(readFileSync(core.config.paths.stateFile, 'utf8')) as {
      sourceReports: { id: string; state: string; quarantineUntil: string | null }[];
      channelFeedback: { verdict: string }[];
    };
    expect(file.channelFeedback[0]?.verdict).toBe('correct');
    expect(file.sourceReports.find((report) => report.id === ID_A)).toMatchObject({
      state: 'working',
      quarantineUntil: null,
    });

    /* Reinicio: el trabajo de ID_B no sobrevive y su informe se suelta. */
    await sources.stop();
    await scanner.stop();
    await state.stop();
    const reloaded = createStateService(core);
    await reloaded.load();
    const after = createSourcesService({
      ...core,
      state: reloaded,
      scanner: createTestScanner(core, scriptedTransport().transport),
    });
    await after.start();
    await reloaded.flush();
    saved = reloaded.get();
    expect(saved.sourceReports.find((report) => report.id === ID_B)?.state).toBe('reported');
    expect(after.counts()).toMatchObject({ total: 2, learningCount: 1 });
    await after.stop();
    await reloaded.stop();
  });
});
