/* Contraste con la 0.6.59 ORIGINAL (plan E1.4): las mismas entradas contra
   las dos. Las únicas diferencias permitidas son las ampliaciones de la
   0.7.0, y tienen que ser SIEMPRE en el sentido de bloquear más. */

import { describe, expect, it } from 'vitest';
import { loadLegacyServer } from '../../../../../packages/shared/scripts/lib/legacy-0659.js';
import { isPrivateAddress, isPrivateHostname } from './ssrf.js';

interface LegacyNet {
  isPrivateAddress(value: string): boolean;
  isPrivateHostname(value: string): boolean;
}

const legacy = loadLegacyServer() as unknown as LegacyNet;

const ADDRESSES = [
  '0.0.0.0',
  '1.1.1.1',
  '8.8.8.8',
  '9.255.255.255',
  '10.0.0.1',
  '11.0.0.1',
  '100.63.1.1',
  '100.64.0.0',
  '100.100.100.100',
  '100.128.0.0',
  '126.255.255.255',
  '127.0.0.1',
  '128.0.0.1',
  '169.253.1.1',
  '169.254.1.1',
  '172.15.255.255',
  '172.16.0.0',
  '172.31.1.1',
  '172.32.0.0',
  '192.0.0.1',
  '192.0.1.1',
  '192.0.2.1',
  '192.88.98.1',
  '192.88.99.1',
  '192.167.1.1',
  '192.168.1.1',
  '198.17.1.1',
  '198.18.1.1',
  '198.19.1.1',
  '198.20.1.1',
  '198.51.100.1',
  '203.0.113.1',
  '203.0.114.1',
  '223.1.1.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  '::2',
  '::7f00:1',
  '::ffff:127.0.0.1',
  '::ffff:1.1.1.1',
  '::ffff:7f00:1',
  '64:ff9b::1',
  '100::1',
  '2001::1',
  '2001:db8::1',
  '2001:4860:4860::8888',
  '2002:c0a8:101::1',
  '2400:cb00::1',
  '2606:4700:4700::1111',
  '3fff::1',
  '4000::1',
  '5f00::1',
  'fc00::1',
  'fd12:3456::1',
  'fe80::1',
  'fec0::1',
  'ff02::1',
  '[::1]',
  'fe80::1%eth0',
  'example.com',
  '',
  '999.1.1.1',
];

/* Lo que la 0.7.0 bloquea y la 0.6.59 dejaba pasar (docs/compat.md). */
const ADDRESSES_0700 = new Set([
  '::2',
  '::7f00:1',
  '100::1',
  '192.88.99.1',
  '2001::1',
  '2002:c0a8:101::1',
  '3fff::1',
  '4000::1',
  '5f00::1',
]);

const HOSTNAMES = [
  'localhost',
  'LOCALHOST',
  'a.localhost',
  'umbrel.local',
  'umbrel.local.',
  'x.internal',
  'home.arpa',
  'nas.home.arpa',
  'example.com',
  'ipfs.io',
  'dweb.link',
  'no-existe.invalid',
  'router.lan',
  'nas.localdomain',
  'acestream',
  'localhost.example.com',
  '127.0.0.1',
  '::1',
];

const HOSTNAMES_0700 = new Set(['router.lan', 'nas.localdomain', 'acestream']);

describe('contraste del filtro anti-SSRF con la 0.6.59 (server.js:1276-1308)', () => {
  it('isPrivateAddress coincide salvo las ampliaciones, que solo bloquean más', () => {
    const differences: string[] = [];
    for (const address of ADDRESSES) {
      const before = legacy.isPrivateAddress(address);
      const now = isPrivateAddress(address);
      if (before !== now) {
        differences.push(address);
        expect(now, address).toBe(true);
      }
    }
    expect(new Set(differences)).toEqual(ADDRESSES_0700);
  });

  it('isPrivateHostname coincide salvo las ampliaciones, que solo bloquean más', () => {
    const differences: string[] = [];
    for (const hostname of HOSTNAMES) {
      const before = legacy.isPrivateHostname(hostname);
      const now = isPrivateHostname(hostname);
      if (before !== now) {
        differences.push(hostname);
        expect(now, hostname).toBe(true);
      }
    }
    expect(new Set(differences)).toEqual(HOSTNAMES_0700);
  });
});
