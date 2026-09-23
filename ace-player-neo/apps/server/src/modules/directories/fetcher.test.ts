/* Descarga de directorios (server.js:1426-1436, 1719-1798): T-117, el orden
   IPFS directo → pasarela de T-121 y la resolución IPNS/DNSLink. Todo con el
   cliente saliente de verdad sobre DNS y transporte falsos. */

import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../core/errors.js';
import { createSilentLogger } from '../../core/logger.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { createNetClient } from '../net/index.js';
import { fakeTransport, tableResolver, type FakeHandler, type FakeReply } from '../net/testing.js';
import { alternateGatewayUrl, createDirectoryFetcher, esFalloDePasarela } from './fetcher.js';
import {
  autoSyncWeb,
  fetchDirectoryText as legacyFetchDirectoryText,
  fetchIpfsDirectory as legacyFetchIpfsDirectory,
} from './legacy-exports.js';
import {
  PUBLIC_HOSTS,
  carDe,
  createHarness,
  directorioIpfsDePrueba,
  registroIpnsV1,
  registroIpnsV2,
  seedPrincipal,
} from './test-support.js';

const ROUTING = 'https://delegated-ipfs.dev/routing/v1/ipns';
const GATEWAY = 'https://trustless-gateway.link/ipfs';
const { esperado, raizTexto, bloques } = directorioIpfsDePrueba();
const CAR_URL = `${GATEWAY}/${raizTexto}/data/lista.m3u?format=car&dag-scope=entity`;

function setup(
  routes: Record<string, FakeReply | FakeHandler>,
  resolveTxt: (hostname: string) => Promise<string[][]> = async () => [],
) {
  const core = createTestCore();
  const transport = fakeTransport(routes);
  const net = createNetClient({ ...core, resolver: tableResolver(PUBLIC_HOSTS), transport });
  const logger = createSilentLogger();
  const warn = vi.spyOn(logger, 'warn');
  const fetcher = createDirectoryFetcher({
    net,
    logger,
    resolveTxt,
    delegatedRouting: 'https://delegated-ipfs.dev',
    trustlessGateway: 'https://trustless-gateway.link',
  });
  return {
    fetcher,
    warn,
    requested: () => transport.requests.map((request) => request.url.href),
    transport,
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : String((error as Error).message);
  }
  return 'ok';
}

describe('T-117 · si ipfs.io se satura se prueba la misma ruta en dweb.link, y a la inversa (B-197)', () => {
  it('T-117 · si ipfs.io se satura se prueba la misma ruta en dweb.link, y a la inversa', async () => {
    expect(alternateGatewayUrl('https://ipfs.io/ipns/k51abc/hashes.m3u')).toBe(
      'https://dweb.link/ipns/k51abc/hashes.m3u',
    );
    expect(alternateGatewayUrl('https://dweb.link/ipfs/Qm123/lista.m3u')).toBe(
      'https://ipfs.io/ipfs/Qm123/lista.m3u',
    );
    expect(alternateGatewayUrl('https://example.com/ipns/x')).toBeNull();
    expect(alternateGatewayUrl('https://ipfs.io/otra/cosa')).toBeNull();
    expect(alternateGatewayUrl('http://ipfs.io/ipns/x')).toBeNull();
    expect(typeof legacyFetchDirectoryText).toBe('function');
    // la sincronización automática usa el descargador de directorios (IPFS
    // primero), no el cliente genérico: el espía es el transporte
    const { service, state, requested } = createHarness({
      env: { AUTO_SYNC: 'true' },
      routes: {
        [`${ROUTING}/k51abc`]: { body: registroIpnsV2(`/ipfs/${raizTexto}`) },
        [CAR_URL]: { body: carDe(bloques) },
      },
    });
    seedPrincipal(state, { url: 'https://ipfs.io/ipns/k51abc/data/lista.m3u' });
    await service.autoSync('periodic');
    expect(requested()).toEqual([`${ROUTING}/k51abc`, CAR_URL]);
    expect(state.get().webSources[0]?.streams.map((item) => item.title)).toEqual(['Canal A']);
  });

  it('URL rota, mayúsculas en el host y esFalloDePasarela', () => {
    expect(alternateGatewayUrl('no es url')).toBeNull();
    expect(alternateGatewayUrl('https://IPFS.IO/ipfs/x')).toBe('https://dweb.link/ipfs/x');
    expect(esFalloDePasarela(new AppError('http_429'))).toBe(true);
    expect(esFalloDePasarela(new AppError('http_502'))).toBe(true);
    expect(esFalloDePasarela(new AppError('http_404'))).toBe(false);
    expect(esFalloDePasarela('http_429')).toBe(false);
  });
});

describe('IPFS directo antes que la pasarela (T-121, B-196)', () => {
  it('con IPFS bien, la pasarela pública ni se toca', async () => {
    const { fetcher, requested } = setup({
      [`${ROUTING}/k51abc`]: { body: registroIpnsV2(`/ipfs/${raizTexto}`) },
      [CAR_URL]: { body: carDe(bloques) },
    });
    expect(await fetcher.fetchDirectoryText('https://ipfs.io/ipns/k51abc/data/lista.m3u')).toBe(
      esperado,
    );
    expect(requested()).toEqual([`${ROUTING}/k51abc`, CAR_URL]);
  });

  it('pide el registro IPNS y el CAR con su Accept y sus topes', async () => {
    const { fetcher, transport } = setup({
      [`${ROUTING}/k51abc`]: { body: registroIpnsV2(`/ipfs/${raizTexto}`) },
      [CAR_URL]: { body: carDe(bloques) },
    });
    await fetcher.fetchIpfsDirectory('https://ipfs.io/ipns/k51abc/data/lista.m3u');
    expect(transport.requests.map((request) => request.headers.Accept)).toEqual([
      'application/vnd.ipfs.ipns-record',
      'application/vnd.ipld.car',
    ]);
  });

  it('un registro IPNS de más de 64 KiB y un CAR de más de 4 MiB → response_too_large', async () => {
    const big = setup({ [`${ROUTING}/k51abc`]: { body: Buffer.alloc(64 * 1024 + 1) } });
    expect(await codeOf(big.fetcher.fetchIpfsDirectory('https://ipfs.io/ipns/k51abc/x'))).toBe(
      'response_too_large',
    );
    const car = setup({
      [`${GATEWAY}/${raizTexto}?format=car&dag-scope=entity`]: {
        body: Buffer.alloc(4 * 1024 * 1024 + 1),
      },
    });
    expect(await codeOf(car.fetcher.fetchIpfsDirectory(`https://ipfs.io/ipfs/${raizTexto}`))).toBe(
      'response_too_large',
    );
  });

  it('un CAR alterado no cuela: se prueba la pasarela y, si responde, vale lo suyo', async () => {
    const alterados = bloques.map((b, i) => (i === 4 ? { ...b, bloque: Buffer.from('x') } : b));
    const { fetcher, requested, warn } = setup({
      [`${ROUTING}/k51abc`]: { body: registroIpnsV2(`/ipfs/${raizTexto}`) },
      [CAR_URL]: { body: carDe(alterados) },
      'https://ipfs.io/ipns/k51abc/data/lista.m3u': { body: '#EXTM3U de la pasarela' },
    });
    expect(await fetcher.fetchDirectoryText('https://ipfs.io/ipns/k51abc/data/lista.m3u')).toBe(
      '#EXTM3U de la pasarela',
    );
    expect(requested()).toEqual([
      `${ROUTING}/k51abc`,
      CAR_URL,
      'https://ipfs.io/ipns/k51abc/data/lista.m3u',
    ]);
    expect(warn).toHaveBeenCalledWith(
      { errorCode: 'ipfs_bad_block' },
      expect.stringContaining('IPFS'),
    );
  });

  it('si también fallan las dos pasarelas, llega el error del camino IPFS (server.js:1780)', async () => {
    const { fetcher, requested } = setup({
      [`${ROUTING}/k51abc`]: { body: registroIpnsV2(`/ipfs/${raizTexto}`) },
      [CAR_URL]: { body: carDe(bloques.slice(0, 3)) },
      'https://ipfs.io/ipns/k51abc/data/lista.m3u': { status: 429 },
      'https://dweb.link/ipns/k51abc/data/lista.m3u': { status: 503 },
    });
    expect(
      await codeOf(fetcher.fetchDirectoryText('https://ipfs.io/ipns/k51abc/data/lista.m3u')),
    ).toBe('ipfs_missing_block');
    expect(requested().slice(2)).toEqual([
      'https://ipfs.io/ipns/k51abc/data/lista.m3u',
      'https://dweb.link/ipns/k51abc/data/lista.m3u',
    ]);
  });

  it('un CID raíz que no vale no sale a la red IPFS y va a la pasarela', async () => {
    const { fetcher, requested } = setup({
      'https://example.com/ipfs/no-es-cid/lista.m3u': { body: 'texto' },
    });
    expect(await fetcher.fetchDirectoryText('https://example.com/ipfs/no-es-cid/lista.m3u')).toBe(
      'texto',
    );
    expect(requested()).toEqual(['https://example.com/ipfs/no-es-cid/lista.m3u']);
  });

  it('una URL cancelada no prueba la pasarela', async () => {
    const { fetcher, requested } = setup({});
    const controller = new AbortController();
    controller.abort(new Error('apagando'));
    expect(
      await codeOf(fetcher.fetchDirectoryText('https://ipfs.io/ipns/k51abc/x', controller.signal)),
    ).toBe('apagando');
    expect(requested()).toEqual([]);
  });
});

describe('nombres IPNS y DNSLink (server.js:1719-1760)', () => {
  it('un nombre con punto va por el TXT _dnslink (y junta los trozos del TXT)', async () => {
    const resolveTxt = vi.fn(async () => [['v=spf1'], ['dnslink=/ipfs/', raizTexto]]);
    const { fetcher, requested } = setup({ [CAR_URL]: { body: carDe(bloques) } }, resolveTxt);
    expect(
      await fetcher.fetchIpfsDirectory('https://ipfs.io/ipns/lista.example/data/lista.m3u'),
    ).toBe(esperado);
    expect(resolveTxt).toHaveBeenCalledWith('_dnslink.lista.example');
    expect(requested()).toEqual([CAR_URL]);
  });

  it('DNSLink que falla → dns_failed; sin registro dnslink → ipfs_bad_record', async () => {
    const failing = setup({}, async () => {
      throw new Error('queryTxt ENOTFOUND');
    });
    expect(
      await codeOf(failing.fetcher.fetchIpfsDirectory('https://ipfs.io/ipns/x.example/a')),
    ).toBe('dns_failed');
    const empty = setup({}, async () => [['otra cosa']]);
    expect(await codeOf(empty.fetcher.fetchIpfsDirectory('https://ipfs.io/ipns/x.example/a'))).toBe(
      'ipfs_bad_record',
    );
  });

  it('IPNS que apunta a otro IPNS (con ruta) y después a /ipfs', async () => {
    const { fetcher, requested } = setup({
      [`${ROUTING}/k51a`]: { body: registroIpnsV1('/ipns/k51b/data') },
      [`${ROUTING}/k51b`]: { body: registroIpnsV2(`/ipfs/${raizTexto}`) },
      [CAR_URL]: { body: carDe(bloques) },
    });
    expect(await fetcher.fetchIpfsDirectory('https://k51a.ipns.dweb.link/lista.m3u')).toBe(
      esperado,
    );
    expect(requested()).toEqual([`${ROUTING}/k51a`, `${ROUTING}/k51b`, CAR_URL]);
  });

  it('más de tres saltos IPNS, o un valor que no es una ruta IPFS → ipfs_bad_record', async () => {
    const loop = setup({
      [`${ROUTING}/k51a`]: { body: registroIpnsV1('/ipns/k51b') },
      [`${ROUTING}/k51b`]: { body: registroIpnsV1('/ipns/k51c') },
      [`${ROUTING}/k51c`]: { body: registroIpnsV1('/ipns/k51a') },
    });
    expect(await codeOf(loop.fetcher.fetchIpfsDirectory('https://ipfs.io/ipns/k51a/x'))).toBe(
      'ipfs_bad_record',
    );
    expect(loop.requested()).toHaveLength(3);
    const raro = setup({ [`${ROUTING}/k51a`]: { body: registroIpnsV1('https://example.com/') } });
    expect(await codeOf(raro.fetcher.fetchIpfsDirectory('https://ipfs.io/ipns/k51a/x'))).toBe(
      'ipfs_bad_record',
    );
  });

  it('los segmentos se codifican en la URL del CAR', async () => {
    const url = `${GATEWAY}/${raizTexto}/data/lista%20x.m3u?format=car&dag-scope=entity`;
    const { fetcher, requested } = setup({ [url]: { status: 404 } });
    expect(
      await codeOf(
        fetcher.fetchIpfsDirectory(`https://ipfs.io/ipfs/${raizTexto}/data/lista%20x.m3u`),
      ),
    ).toBe('http_404');
    expect(requested()).toEqual([url]);
  });

  it('fetchIpfsDirectory de una URL que no es IPFS → bad_url', async () => {
    const { fetcher } = setup({});
    expect(await codeOf(fetcher.fetchIpfsDirectory('https://example.com/lista.m3u'))).toBe(
      'bad_url',
    );
  });
});

describe('pasarela y URL normales (server.js:1788-1798)', () => {
  it('un directorio normal con 429 no tiene otra pasarela: http_429', async () => {
    const { fetcher, requested } = setup({ 'https://example.com/lista.m3u': { status: 429 } });
    expect(await codeOf(fetcher.fetchDirectoryText('https://example.com/lista.m3u'))).toBe(
      'http_429',
    );
    expect(requested()).toHaveLength(1);
  });

  it('dweb.link saturada → ipfs.io; si responde, vale; un 404 no prueba la otra', async () => {
    const ok = setup({
      'https://dweb.link/ipfs/no-cid/x': { status: 502 },
      'https://ipfs.io/ipfs/no-cid/x': { body: 'de ipfs.io' },
    });
    expect(await ok.fetcher.fetchDirectoryText('https://dweb.link/ipfs/no-cid/x')).toBe(
      'de ipfs.io',
    );
    const notFound = setup({ 'https://dweb.link/ipfs/no-cid/x': { status: 404 } });
    // y como la URL es de IPFS, el error que llega es el del camino IPFS
    expect(
      await codeOf(notFound.fetcher.fetchDirectoryText('https://dweb.link/ipfs/no-cid/x')),
    ).toBe('ipfs_bad_cid');
    expect(notFound.requested()).toHaveLength(1);
  });

  it('http:// de una pasarela no es IPFS (solo https) y va directo', async () => {
    const { fetcher, requested } = setup({ 'http://ipfs.io/ipns/k51abc/x': { body: 'plano' } });
    expect(await fetcher.fetchDirectoryText('http://ipfs.io/ipns/k51abc/x')).toBe('plano');
    expect(requested()).toEqual(['http://ipfs.io/ipns/k51abc/x']);
  });
});

describe('exportaciones antiguas del descargador', () => {
  it('filtro anti-SSRF siempre puesto y errores antes de salir a la red', async () => {
    await expect(legacyFetchDirectoryText('http://127.0.0.1/lista.m3u')).rejects.toThrow(
      /private_url/,
    );
    await expect(legacyFetchIpfsDirectory('https://example.com/lista.m3u')).rejects.toThrow(
      /bad_url/,
    );
    await expect(legacyFetchIpfsDirectory('https://ipfs.io/ipfs/no-es-cid/x')).rejects.toThrow(
      /ipfs_bad_cid/,
    );
  });

  it('autoSyncWeb necesita el servicio (sin globales) y con AUTO_SYNC=false no sale a internet', async () => {
    await expect(autoSyncWeb()).rejects.toThrow(/not_implemented/);
    const { service, requested } = createHarness();
    await autoSyncWeb(service);
    expect(requested()).toEqual([]);
  });
});
