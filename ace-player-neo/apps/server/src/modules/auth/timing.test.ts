/* Comparación en tiempo constante (arquitectura §5.12): el código de
   emparejamiento, el secreto del token y la firma de las URLs de vídeo se
   comparan SIEMPRE con `timingSafeEqual` y con dos buffers de la misma
   longitud, también cuando lo que manda el cliente mide otra cosa. Medir
   tiempos en un test sería frágil: se espía la función de node:crypto. */

import type * as NodeCrypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spy = vi.hoisted(() => ({ calls: [] as [number, number][] }));

vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof NodeCrypto>();
  return {
    ...original,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      spy.calls.push([a.byteLength, b.byteLength]);
      return original.timingSafeEqual(a, b);
    },
  };
});

const { createTestCore } = await import('../../../test/helpers/index.js');
const { createAuth } = await import('./service.js');
const { equalDigests, equalStrings, sha256 } = await import('./crypto.js');
const { fakeState, memoryDevicesStore, sequenceRandom } = await import('./test-support.js');

const SID = 's_SesionDePrueba01';

function setup() {
  const core = createTestCore();
  const auth = createAuth(
    { ...core, state: fakeState(memoryDevicesStore()) },
    { random: sequenceRandom([123456]) },
  );
  return { core, auth };
}

describe('auth · comparación en tiempo constante', () => {
  beforeEach(() => {
    spy.calls.length = 0;
  });

  it('equalStrings compara resúmenes de 32 bytes sea cual sea la longitud', () => {
    expect(equalStrings('abc', 'abc')).toBe(true);
    expect(equalStrings('abc', 'abcd')).toBe(false);
    expect(equalStrings('', 'x'.repeat(1000))).toBe(false);
    expect(spy.calls).toEqual([
      [32, 32],
      [32, 32],
      [32, 32],
    ]);
  });

  it('equalDigests con longitudes distintas no sale antes: compara igual y da false', () => {
    expect(equalDigests(sha256('a'), Buffer.alloc(3))).toBe(false);
    expect(spy.calls).toEqual([[32, 32]]);
  });

  it('el canje del código compara HMAC de 32 bytes, acierte o no', async () => {
    const { auth } = setup();
    const pairing = await auth.createPairing({}, 'http://umbrel.local');
    await expect(
      auth.claimPairing({ code: '000000', name: 'X', platform: 'ios' }),
    ).rejects.toMatchObject({ code: 'pairing_invalid' });
    await auth.claimPairing({ code: pairing.code, name: 'X', platform: 'ios' });
    expect(spy.calls).toEqual([
      [32, 32],
      [32, 32],
    ]);
  });

  it('el Bearer compara sha256 del secreto con timingSafeEqual, exista o no el dispositivo', async () => {
    const { auth } = setup();
    const pairing = await auth.createPairing({}, 'http://umbrel.local');
    const { token } = await auth.claimPairing({ code: pairing.code, name: 'X', platform: 'ios' });
    spy.calls.length = 0;
    await auth.authenticateBearer(token);
    await expect(
      auth.authenticateBearer(`dev_NoExiste0000000.${'A'.repeat(43)}`),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(spy.calls).toEqual([
      [32, 32],
      [32, 32],
    ]);
  });

  it('la firma de la URL de vídeo se compara en tiempo constante', async () => {
    const { auth } = setup();
    const pairing = await auth.createPairing({}, 'http://umbrel.local');
    const { deviceId } = await auth.claimPairing({
      code: pairing.code,
      name: 'X',
      platform: 'ios',
    });
    const token = auth.signVideoToken({ sessionId: SID, deviceId });
    spy.calls.length = 0;
    await auth.verifyVideoToken(token, SID, () => false);
    await expect(auth.verifyVideoToken(`${token}A`, SID, () => false)).rejects.toMatchObject({
      code: 'video_token_invalid',
    });
    expect(spy.calls).toEqual([
      [32, 32],
      [32, 32],
    ]);
  });
});
