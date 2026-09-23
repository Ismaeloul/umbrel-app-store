/* Estado del motor en la navegación (B-011, inventario §1): la palabra y el
   tono que enseña el indicador. La histéresis (2 fallos con alguien viendo)
   es del servidor desde la v2 (compat 2.2): aquí llega ya decidida por SSE. */

import { describe, expect, it } from 'vitest';
import { summarizeEngine } from './hooks.ts';

describe('indicador del motor (B-011)', () => {
  it('comprobando al principio; en línea, arrancando o apagado después', () => {
    expect(summarizeEngine(undefined)).toMatchObject({ text: 'Motor: comprobando…', tone: 'idle' });
    expect(summarizeEngine('unknown')).toMatchObject({ text: 'Motor: comprobando…', tone: 'idle' });
    expect(summarizeEngine('online')).toMatchObject({ text: 'Motor en línea', tone: 'ok' });
    expect(summarizeEngine('restarting')).toMatchObject({
      text: 'Motor arrancando…',
      tone: 'weak',
    });
    expect(summarizeEngine('offline')).toMatchObject({ text: 'Motor apagado', tone: 'fail' });
  });

  it('si ni siquiera se puede preguntar, lo dice en rojo', () => {
    expect(summarizeEngine(undefined, true)).toMatchObject({
      state: 'error',
      text: 'Motor sin respuesta',
      tone: 'fail',
    });
  });
});
