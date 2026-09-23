/* Contraste con la 0.6.59 ORIGINAL (plan E1.4): mismas entradas contra las
   dos implementaciones de los parsers y de las funciones puras de IPFS. */

import { describe, expect, it } from 'vitest';
import { loadLegacyServer } from '../../../../../packages/shared/scripts/lib/legacy-0659.js';
import { alternateGatewayUrl } from './fetcher.js';
import { HASHES, HTML_AGREGADOR, M3U_CRLF, M3U_NEW_ERA } from './fixtures.js';
import {
  ipfsCarBlocks,
  ipfsCbor,
  ipfsCidFromText,
  ipfsProtobuf,
  ipfsReadFile,
  ipfsUrlParts,
  ipfsWalk,
  type IpfsCid,
} from './ipfs.js';
import { parseHtml, parseM3u } from './parsers.js';
import {
  campoPb,
  carDe,
  directorioIpfsDePrueba,
  registroIpnsV1,
  registroIpnsV2,
} from './test-support.js';

interface LegacyDirectories {
  parseM3u(text: string): unknown;
  parseHtml(text: string): unknown;
  alternateGatewayUrl(url: string): string | null;
  ipfsUrlParts(url: string): unknown;
  ipfsCidFromText(text: string): unknown;
  ipfsCbor(buffer: Buffer): unknown;
  ipfsProtobuf(buffer: Buffer): unknown;
  ipfsCarBlocks(car: Buffer): Map<string, Buffer>;
  ipfsWalk(blocks: Map<string, Buffer>, root: unknown, segments: string[]): unknown;
  ipfsReadFile(blocks: Map<string, Buffer>, cid: unknown, limit: number): Buffer;
}

const legacy = loadLegacyServer() as unknown as LegacyDirectories;

/* Resultado o mensaje de error, para comparar las dos. */
function outcome(fn: () => unknown): unknown {
  try {
    return { ok: fn() };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

const M3U_EXTRA = [
  '',
  '#EXTM3U',
  `#EXTINF:-1 tvg-id="X" group-title="A,B",Título, con, comas\nacestream://${HASHES.dazn1}`,
  `#EXTINF:-1,Uno\n#EXTINF:-1,Dos\n${HASHES.dazn2}`,
  `https://visor.example/?content_id=${HASHES.m1}&x=1`,
  `#EXTINF:-1 tvg-id="  Muchos   espacios  ",<i>Cursiva</i>&nbsp;y&amp;más\n${HASHES.laliga}`,
  `#EXTINF:-1 group-title="${'g'.repeat(130)}",${'t'.repeat(130)}\n${HASHES.eurosport}`,
  `\t  acestream://${HASHES.mayusculas}  \r\n#EXTINF:-1,Final\r\n`,
];

const HTML_EXTRA = [
  '',
  `<A HREF="acestream://${HASHES.html1}">Mayúsculas</A>`,
  `<a data-x="1" href="https://x.example/p?id=${HASHES.html2}">A</a><a href="https://x.example/p?id=${HASHES.html2}">B</a>`,
  `<a href="acestream://${HASHES.html3}"><img src="x.png"></a>`,
  `texto acestream://${HASHES.suelto} y <a href="acestream://${HASHES.suelto}">tarde</a>`,
  `<a href='https://x.example/?content_id=${HASHES.query}'>Simple</a>`,
];

describe('contraste de los parsers con la 0.6.59 (server.js:2751-2812)', () => {
  it('parseM3u da lo mismo con las listas inventadas y casos raros', () => {
    for (const text of [M3U_NEW_ERA, M3U_CRLF, HTML_AGREGADOR, ...M3U_EXTRA]) {
      expect(parseM3u(text), JSON.stringify(text).slice(0, 60)).toEqual(legacy.parseM3u(text));
    }
  });

  it('parseHtml da lo mismo', () => {
    for (const text of [HTML_AGREGADOR, M3U_NEW_ERA, ...HTML_EXTRA]) {
      expect(parseHtml(text), JSON.stringify(text).slice(0, 60)).toEqual(legacy.parseHtml(text));
    }
  });
});

const URLS = [
  'https://ipfs.io/ipns/k51abc/hashes.m3u',
  'https://dweb.link/ipfs/Qm123/lista.m3u',
  'https://IPFS.IO/ipfs/x',
  'https://ipfs.io/ipfs/x?y=1#z',
  'https://ipfs.io:8443/ipns/x',
  'https://example.com/ipns/x',
  'https://ipfs.io/otra/cosa',
  'http://ipfs.io/ipns/x',
  'https://k51abc.ipns.dweb.link/hashes.m3u',
  'https://bafy.ipfs.w3s.link/a/b%20c.m3u',
  'https://ipfs.io/ipns/k51/%E0%A4%A',
  'https://ipfs.io/ipns/k51',
  'https://ipfs.io/ipfs//doble',
  'no es url',
  '',
];

describe('contraste de las funciones puras de IPFS (server.js:1426-1717)', () => {
  it('alternateGatewayUrl e ipfsUrlParts', () => {
    for (const url of URLS) {
      expect(alternateGatewayUrl(url), url).toEqual(legacy.alternateGatewayUrl(url));
      expect(ipfsUrlParts(url), url).toEqual(legacy.ipfsUrlParts(url));
    }
  });

  it('ipfsCidFromText', () => {
    const { raizTexto } = directorioIpfsDePrueba();
    for (const text of [
      raizTexto,
      'QmUwSbXZoAgFyZmN9vUmAwxKb4JUwR5EtFpQF2z77XBLGH',
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      'z11111111',
      'bafy',
      'Qm0000',
      'no-es-un-cid',
      '',
    ]) {
      expect(
        outcome(() => ipfsCidFromText(text)),
        text,
      ).toEqual(outcome(() => legacy.ipfsCidFromText(text)));
    }
  });

  it('ipfsCbor e ipfsProtobuf', () => {
    const samples = [
      Buffer.from([0x17]),
      Buffer.from([0x1b, 0, 0, 0, 1, 0, 0, 0, 0]),
      Buffer.from([0x38, 0x63]),
      Buffer.from([0x83, 1, 0x62, 0x61, 0x62, 0xf5]),
      Buffer.from([0xa1, 0x01, 0x02]),
      Buffer.from([0xc2, 0x41, 0xff]),
      Buffer.from([0x5f]),
      Buffer.alloc(0),
      registroIpnsV2('/ipfs/bafyabc'),
      registroIpnsV1('/ipns/x.example'),
      campoPb(9, Buffer.from([0xa1, 0x65, 0x56, 0x61, 0x6c, 0x75, 0x65, 0x61, 0x78])),
    ];
    for (const sample of samples) {
      expect(
        outcome(() => ipfsCbor(sample)),
        sample.toString('hex'),
      ).toEqual(outcome(() => legacy.ipfsCbor(sample)));
      expect(
        outcome(() => ipfsProtobuf(sample)),
        sample.toString('hex'),
      ).toEqual(outcome(() => legacy.ipfsProtobuf(sample)));
    }
  });

  it('ipfsCarBlocks, ipfsWalk e ipfsReadFile sobre el CAR de T-121 (y uno alterado)', () => {
    const { raizTexto, bloques } = directorioIpfsDePrueba();
    const car = carDe(bloques);
    const mine = ipfsCarBlocks(car);
    const theirs = legacy.ipfsCarBlocks(car);
    expect([...mine.entries()]).toEqual([...theirs.entries()]);
    const root = ipfsCidFromText(raizTexto);
    for (const segments of [['data', 'lista.m3u'], ['data'], ['nada'], []]) {
      expect(
        outcome(() => ipfsWalk(mine, root, segments)),
        segments.join('/'),
      ).toEqual(outcome(() => legacy.ipfsWalk(theirs, root, segments)));
    }
    const file = ipfsWalk(mine, root, ['data', 'lista.m3u']) as IpfsCid;
    for (const limit of [1024, 60, 37, 10]) {
      expect(
        outcome(() => ipfsReadFile(mine, file, limit)),
        String(limit),
      ).toEqual(outcome(() => legacy.ipfsReadFile(theirs, file, limit)));
    }
    const altered = carDe(
      bloques.map((b, i) => (i === 1 ? { ...b, bloque: Buffer.from('x') } : b)),
    );
    expect(outcome(() => ipfsCarBlocks(altered))).toEqual(
      outcome(() => legacy.ipfsCarBlocks(altered)),
    );
  });
});
