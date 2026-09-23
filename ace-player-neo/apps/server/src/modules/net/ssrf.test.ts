/* Filtro anti-SSRF: T-004 y los casos que la 0.7.0 añade (B-227). */

import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../core/errors.js';
import {
  isPrivateAddress,
  isPrivateHostname,
  normalizedIp,
  pinnedLookup,
  resolveFetchAddresses,
} from './ssrf.js';
import type { NetResolver, ResolvedAddress } from './types.js';

describe('T-004 · detecta destinos privados usados en intentos SSRF (B-227)', () => {
  it('T-004 · detecta destinos privados usados en intentos SSRF', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.4.2',
      '192.168.1.10',
      '169.254.169.254',
      '::1',
      '0:0:0:0:0:0:0:1',
      '::ffff:7f00:1',
      'fd00::1',
      'fe80::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateHostname('umbrel.local')).toBe(true);
    expect(isPrivateHostname('example.com')).toBe(false);
  });
});

describe('isPrivateAddress: lista de la 0.6.59 (server.js:1280-1301)', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.254',
    '127.8.8.8',
    '169.254.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.168.0.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '239.255.255.250',
    '240.0.0.1',
    '255.255.255.255',
  ])('IPv4 privada o reservada: %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.0.1',
    '172.32.0.1',
    '192.0.1.1',
    '192.169.0.1',
    '198.20.0.1',
    '203.0.114.1',
    '223.255.255.255',
  ])('IPv4 pública: %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it.each([
    '::',
    '::1',
    '[::1]',
    'fe80::1%eth0',
    '[FE80::ABCD]',
    '::ffff:127.0.0.1',
    '::ffff:10.1.2.3',
    '::FFFF:192.168.1.1',
    '::ffff:a00:1',
    '64:ff9b::7f00:1',
    '64:ff9b:1::1',
    '2001:db8::1',
    'fc00::1',
    'fdff:ffff::1',
    'fe80::abcd',
    'febf::1',
    'fec0::1',
    'ff02::1',
  ])('IPv6 privada, mapeada o reservada: %s', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it('una IPv4 pública mapeada en IPv6 con puntos se comprueba como IPv4 (0.6.59)', () => {
    expect(isPrivateAddress('::ffff:1.1.1.1')).toBe(false);
  });

  it('lo que no es una IP no es una dirección privada (lo decide el nombre)', () => {
    expect(isPrivateAddress('example.com')).toBe(false);
    expect(isPrivateAddress('')).toBe(false);
    expect(isPrivateAddress(null)).toBe(false);
  });
});

describe('isPrivateAddress: ampliaciones de la 0.7.0 (docs/compat.md)', () => {
  it.each([
    ['::7f00:1', 'IPv4 «compatible» con 127.0.0.1'],
    ['::a00:1', 'IPv4 «compatible» con 10.0.0.1'],
    ['100::1', 'descarte 100::/64'],
    ['2001::1', 'Teredo 2001::/32'],
    ['2001:2::1', 'benchmarking 2001:2::/48'],
    ['2001:10::1', 'ORCHID'],
    ['2002:7f00:1::1', '6to4 de 127.0.0.1'],
    ['2002:808:808::1', '6to4 de una pública (se bloquea igual)'],
    ['3fff::1', 'documentación 3fff::/20'],
    ['5f00::1', 'SRv6 5f00::/16'],
    ['4000::1', 'fuera del unicast global 2000::/3'],
    ['192.88.99.1', 'relé 6to4 IPv4'],
  ])('%s (%s) es privada', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(['2a00:1450:4001::200e', '2606:4700::6810:84e5', '2001:4860:4860::8888', '3ffe::1'])(
    'unicast global público: %s',
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe('isPrivateHostname (server.js:1303-1308, ampliada)', () => {
  it.each([
    'localhost',
    'LOCALHOST.',
    'api.localhost',
    'umbrel.local',
    'umbrel.local.',
    'metadata.google.internal',
    'home.arpa',
    'nas.home.arpa',
  ])('0.6.59: %s', (hostname) => {
    expect(isPrivateHostname(hostname)).toBe(true);
  });

  it.each([
    'router.lan',
    'nas.localdomain',
    'tv.home',
    'git.corp',
    'wiki.intranet',
    'algo.private',
    'acestream',
    'ismaeloul-ace-player-neo_acestream_1',
  ])('0.7.0: %s', (hostname) => {
    expect(isPrivateHostname(hostname)).toBe(true);
  });

  it.each([
    'example.com',
    'ipfs.io',
    'no-existe.invalid',
    'localhost.example.com',
    '::1',
    '8.8.8.8',
  ])('no es un nombre privado: %s', (hostname) => {
    expect(isPrivateHostname(hostname)).toBe(false);
  });

  it('normalizedIp quita corchetes y zona y pasa a minúsculas', () => {
    expect(normalizedIp('[FE80::1%25eth0]')).toBe('fe80::1');
    expect(normalizedIp('fe80::1%eth0')).toBe('fe80::1');
    expect(normalizedIp(undefined)).toBe('');
  });
});

function resolverOf(map: Record<string, readonly ResolvedAddress[] | Error>): NetResolver & {
  lookup: ReturnType<typeof vi.fn>;
} {
  return {
    lookup: vi.fn(async (hostname: string) => {
      const answer = map[hostname];
      if (!answer)
        throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
      if (answer instanceof Error) throw answer;
      return answer;
    }),
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

describe('resolveFetchAddresses (server.js:1310-1324)', () => {
  it('una IP literal privada da private_url sin preguntar al DNS', async () => {
    const resolver = resolverOf({});
    for (const url of [
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0177.0.0.1/',
      'http://127.1/',
      'http://0/',
      'http://[fd12::1]:8080/',
      'http://localhost:3000/',
      'http://umbrel.local/',
    ]) {
      expect(await codeOf(resolveFetchAddresses(new URL(url), resolver, false)), url).toBe(
        'private_url',
      );
    }
    expect(resolver.lookup).not.toHaveBeenCalled();
  });

  it('revisión de seguridad (docs/seguridad.md): más formas de escribir una IP interna', async () => {
    /* Todas pasan por el parser WHATWG de new URL(), que las normaliza antes
       del filtro: puntos anchos, dígitos rodeados, %XX en el host, v4
       "traducida" (::ffff:0:0/96), NAT64 y los nombres de contenedor de
       Docker (una sola etiqueta o con "_"). */
    const resolver = resolverOf({});
    for (const url of [
      'http://127。0。0。1/',
      'http://①②⑦.0.0.1/',
      'http://%31%32%37.0.0.1/',
      'http://0x7f.1/',
      'http://017700000001/',
      'http://0.0.0.0:3000/',
      'http://[::]/',
      'http://[0:0:0:0:0:ffff:127.0.0.1]/',
      'http://[::ffff:0:7f00:1]/',
      'http://[::ffff:a00:1]/',
      'http://[64:ff9b::a9fe:a9fe]/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.100.100.100/',
      'http://acestream:6878/',
      'http://ismaeloul-ace-player-neo_storage_1:3000/',
      'http://host.docker.internal:11434/',
      'http://localhost./',
    ]) {
      expect(await codeOf(resolveFetchAddresses(new URL(url), resolver, false)), url).toBe(
        'private_url',
      );
    }
    expect(resolver.lookup).not.toHaveBeenCalled();
  });

  it('una IP literal pública se usa tal cual (sin DNS)', async () => {
    const resolver = resolverOf({});
    await expect(
      resolveFetchAddresses(new URL('http://1.1.1.1/'), resolver, false),
    ).resolves.toEqual([{ address: '1.1.1.1', family: 4 }]);
    await expect(
      resolveFetchAddresses(new URL('http://[2606:4700::1111]/'), resolver, false),
    ).resolves.toEqual([{ address: '2606:4700::1111', family: 6 }]);
    expect(resolver.lookup).not.toHaveBeenCalled();
  });

  it('un nombre que resuelve a una privada (aunque sea una de varias) da private_url', async () => {
    const resolver = resolverOf({
      'rebind.example': [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
      'v6.example': [{ address: '::ffff:192.168.1.1', family: 6 }],
    });
    expect(
      await codeOf(resolveFetchAddresses(new URL('http://rebind.example/'), resolver, false)),
    ).toBe('private_url');
    expect(
      await codeOf(resolveFetchAddresses(new URL('http://v6.example/'), resolver, false)),
    ).toBe('private_url');
  });

  it('un nombre que no existe, una respuesta vacía o una que no es una IP da dns_failed', async () => {
    const resolver = resolverOf({
      'vacio.example': [],
      'raro.example': [{ address: 'x', family: 4 }],
    });
    for (const host of ['no-existe.invalid', 'vacio.example', 'raro.example']) {
      expect(
        await codeOf(resolveFetchAddresses(new URL(`https://${host}/`), resolver, false)),
      ).toBe('dns_failed');
    }
  });

  it('con ALLOW_PRIVATE_SYNC_URLS no filtra, pero sigue fijando lo resuelto', async () => {
    const resolver = resolverOf({ localhost: [{ address: '::1', family: 6 }] });
    await expect(
      resolveFetchAddresses(new URL('http://localhost/'), resolver, true),
    ).resolves.toEqual([{ address: '::1', family: 6 }]);
    await expect(
      resolveFetchAddresses(new URL('http://127.0.0.1/'), resolver, true),
    ).resolves.toEqual([{ address: '127.0.0.1', family: 4 }]);
    expect(
      await codeOf(resolveFetchAddresses(new URL('http://nada.example/'), resolver, true)),
    ).toBe('dns_failed');
  });
});

describe('pinnedLookup (server.js:1326-1335): la conexión solo va a lo comprobado', () => {
  const addresses: ResolvedAddress[] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1::1', family: 6 },
  ];

  function call(options: unknown): Promise<unknown[]> {
    return new Promise((resolve) => {
      pinnedLookup(addresses)('cualquier-nombre.example', options, (...args: unknown[]) =>
        resolve(args),
      );
    });
  }

  it('sin familia devuelve la primera; con `all`, todas', async () => {
    expect(await call({})).toEqual([null, '93.184.216.34', 4]);
    expect(await call({ all: true })).toEqual([
      null,
      [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1::1', family: 6 },
      ],
    ]);
  });

  it('filtra por familia (también si llega como número)', async () => {
    expect(await call({ family: 6 })).toEqual([null, '2606:2800:220:1::1', 6]);
    expect(await call(4)).toEqual([null, '93.184.216.34', 4]);
    expect(await call({ family: 6, all: true })).toEqual([
      null,
      [{ address: '2606:2800:220:1::1', family: 6 }],
    ]);
  });

  it('si no queda ninguna de esa familia, dns_failed (nunca otra resolución)', async () => {
    const [error] = await new Promise<unknown[]>((resolve) => {
      pinnedLookup([{ address: '93.184.216.34', family: 4 }])(
        'x',
        { family: 6 },
        (...args: unknown[]) => resolve(args),
      );
    });
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('dns_failed');
  });
});
