/* El audio del fichero en la ficha (docs/vod.md §4.11), de punta a punta
   contra el proveedor falso (en 127.0.0.1, sin red de verdad): la ficha de un
   título «sin indicar» lee el índice por el relé VOD, lo enseña, lo guarda y
   el filtro de idiomas lo usa; con una sesión IPTV abierta no lee. */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VodTitleSchema, type VodSeries } from '@ace/shared';
import { buildMkv } from '../../../../test/fake-vod/ebml.js';
import { FAKE_IPTV_PASSWORD, FAKE_IPTV_USER } from '../../../../test/fake-iptv/provider.js';
import { createIptvTestRig, type IptvTestRig } from '../test-support.js';

const rigs: IptvTestRig[] = [];
afterEach(async () => {
  while (rigs.length) await rigs.pop()?.close();
});

/** Un MKV con una pista de audio en inglés (como Mr. Robot) y subtítulos en español. */
function englishMkv(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vod-audio-mkv-'));
  const file = path.join(dir, 'pelicula.mkv');
  writeFileSync(
    file,
    buildMkv({
      tracks: [
        { number: 1, type: 'video', codecId: 'V_MPEG4/ISO/AVC', language: 'und' },
        { number: 2, type: 'audio', codecId: 'A_AC3', language: 'eng', channels: 6 },
        { number: 3, type: 'subtitle', codecId: 'S_TEXT/UTF8', language: 'spa' },
      ],
      cues: [{ time: 0, track: 1 }],
      clusterBytes: 200_000,
    }),
  );
  return file;
}

async function ready(): Promise<IptvTestRig> {
  const mkv = englishMkv();
  const rig = await createIptvTestRig({
    /* «Película adulta de prueba» (2006) y el primer episodio de «東京物語» (3003) no dicen su idioma. */
    fake: { vodFiles: { '2006.mp4': mkv, '30031.mkv': mkv, '2004.mp4': mkv } },
  });
  rigs.push(rig);
  await rig.service.save(
    {
      kind: 'xtream',
      server: rig.fake.server,
      username: FAKE_IPTV_USER,
      password: FAKE_IPTV_PASSWORD,
    },
    new AbortController().signal,
  );
  await rig.service.idle();
  await rig.service.vod.home();
  await rig.service.vod.idle();
  return rig;
}

/** Espera una promesa moviendo el reloj falso (la cola de fichas va a 300 ms). */
async function settle<T>(rig: IptvTestRig, promise: Promise<T>): Promise<T> {
  let done = false;
  const result = promise.finally(() => {
    done = true;
  });
  result.catch(() => undefined);
  for (let round = 0; round < 200 && !done; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await rig.core.clock.advanceAsync(300);
  }
  return result;
}

/** Espera a la lectura del audio con pasos cortos del reloj falso (la ficha se cierra a los 8 s sin pedirla). */
async function heard(rig: IptvTestRig): Promise<void> {
  let done = false;
  const idle = rig.service.vod.audio.idle().finally(() => {
    done = true;
  });
  for (let round = 0; round < 60 && !done; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await rig.core.clock.advanceAsync(100);
  }
  await idle;
}

async function idOf(rig: IptvTestRig, kind: 'movie' | 'series', q: string): Promise<string> {
  const page = await rig.service.vod.browse({ kind, cat: 'all', q, sort: 'added', limit: 60 });
  const id = page.items[0]?.id;
  if (!id) throw new Error(`sin ${q}`);
  return id;
}

describe('el audio que dice el fichero en la ficha', () => {
  it('película «sin indicar»: «Comprobando…», luego «Audio: Inglés», guardado y en el filtro de idiomas', async () => {
    const rig = await ready();
    const vod = rig.service.vod;
    const id = await idOf(rig, 'movie', 'adulta');
    const english = { kind: 'movie' as const, cat: 'all', sort: 'added' as const, limit: 60 };
    const before = await vod.browse({ ...english, langs: 'ingles', unknown: '0' });
    expect(before.items.map((card) => card.id)).not.toContain(id);

    const first = VodTitleSchema.parse(await settle(rig, vod.title(id)));
    expect(first.langs).toEqual([]);
    expect(first.audioPending).toBe(true);
    expect(first.detectedAudio).toBeUndefined();
    await heard(rig);

    const second = VodTitleSchema.parse(await settle(rig, vod.title(id)));
    expect(second.detectedAudio).toEqual({ audio: ['Inglés'], subtitles: ['Español'] });
    expect(second.audioPending).toBeUndefined();
    /* El filtro: ya no es «sin indicar», es inglés (con subtítulos en español, VOSE). */
    expect(second.langs).toEqual(['vose', 'ingles']);
    const after = await vod.browse({ ...english, langs: 'ingles', unknown: '0' });
    expect(after.items.map((card) => card.id)).toContain(id);
    const home = await vod.home();
    expect(home.noLang?.movies).toBe(0);
    expect(rig.logs.join('')).toContain('VOD: audio del fichero comprobado');
    /* La precarga no lee nada, y un título con idioma del proveedor tampoco. */
    const known = await idOf(rig, 'movie', 'oppenheimer');
    const withLang = await settle(rig, vod.title(known));
    expect(withLang.audioPending).toBeUndefined();
  });

  it('serie «sin indicar»: el primer episodio de la temporada que se mira, en la serie y en ese episodio', async () => {
    const rig = await ready();
    const vod = rig.service.vod;
    const id = await idOf(rig, 'series', '東京物語');
    const first = (await settle(rig, vod.title(id))) as VodSeries;
    expect(first.audioPending).toBe(true);
    await heard(rig);
    const second = VodTitleSchema.parse(await settle(rig, vod.title(id))) as VodSeries;
    expect(second.detectedAudio).toEqual({ audio: ['Inglés'], subtitles: ['Español'] });
    const season1 = second.seasons.find((season) => season.n === 1);
    expect(season1?.episodes[0]?.detectedAudio).toEqual({
      audio: ['Inglés'],
      subtitles: ['Español'],
    });
    expect(season1?.episodes[1]?.detectedAudio).toBeUndefined();
  });

  it('con una sesión IPTV abierta no lee (para luego); la reproducción rellena la caché', async () => {
    const rig = await ready();
    const vod = rig.service.vod;
    const unknown = await idOf(rig, 'movie', 'adulta');
    const other = await idOf(rig, 'movie', 'spiderman');
    const input = await settle(
      rig,
      rig.service.openVod(other, { signal: new AbortController().signal }),
    );
    try {
      const title = await settle(rig, vod.title(unknown));
      expect(title.audioPending).toBeUndefined();
      expect(title.detectedAudio).toBeUndefined();
      expect(vod.audio.pending(`m:2006`)).toBe(false);
      /* Lo que lee el productor al reproducir va a la misma caché. */
      input.noteTracks?.({
        audio: [{ lang: 'spa', name: null }],
        subtitles: [],
      });
    } finally {
      await input.close();
    }
    const played = await settle(rig, vod.title(other));
    expect(played.detectedAudio).toEqual({ audio: ['Castellano'], subtitles: [] });
  });
});
