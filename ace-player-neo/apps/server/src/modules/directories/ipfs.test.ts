/* IPFS sin pasarela (server.js:1440-1770): T-121 y los casos de cada
   función. CAR, nodos dag-pb, CID y registros se construyen en el test. */

import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import {
  ipfsBase32,
  ipfsBase58,
  ipfsBlock,
  ipfsCarBlocks,
  ipfsCbor,
  ipfsCidFromText,
  ipfsNode,
  ipfsProtobuf,
  ipfsReadCid,
  ipfsReadFile,
  ipfsUrlParts,
  ipfsVarint,
  ipfsWalk,
  ipnsRecordValue,
} from './ipfs.js';
import {
  base58De,
  campoPb,
  carDe,
  cidDe,
  directorioIpfsDePrueba,
  nodoPb,
  registroIpnsV1,
  registroIpnsV2,
  varintDe,
} from './test-support.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : String((error as Error).message);
  }
  return 'ok';
}

describe('T-121 · los directorios de IPFS se bajan sin pasarela publica y cada bloque se comprueba (B-196)', () => {
  it('T-121 · los directorios de IPFS se bajan sin pasarela publica y cada bloque se comprueba', () => {
    const { esperado, raizTexto, bloques } = directorioIpfsDePrueba();
    const mapa = ipfsCarBlocks(carDe(bloques));
    const raizCid = ipfsCidFromText(raizTexto);
    expect(raizCid.codec).toBe(0x70);
    const fichero = ipfsWalk(mapa, raizCid, ['data', 'lista.m3u']);
    expect(ipfsReadFile(mapa, fichero, 1024 * 1024).toString('utf8')).toBe(esperado);
    expect(() => ipfsWalk(mapa, raizCid, ['data', 'otra.m3u'])).toThrow(/ipfs_not_found/);
    expect(() => ipfsReadFile(mapa, fichero, 10)).toThrow(/response_too_large/);
    // un bloque alterado no cuela: el que no coincide con su huella se rechaza
    const alterados = bloques.map((b, i) =>
      i === 3 ? { ...b, bloque: Buffer.from('otra cosa') } : b,
    );
    expect(() => ipfsCarBlocks(carDe(alterados))).toThrow(/ipfs_bad_block/);
    // CIDv0 (Qm...) y CIDv1 (bafy...) reales
    const v0 = ipfsCidFromText('QmUwSbXZoAgFyZmN9vUmAwxKb4JUwR5EtFpQF2z77XBLGH');
    expect([v0.codec, v0.hash, v0.digest.length]).toEqual([0x70, 0x12, 32]);
    const v1 = ipfsCidFromText('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
    expect([v1.codec, v1.hash, v1.digest.length]).toEqual([0x70, 0x12, 32]);
    expect(() => ipfsCidFromText('no-es-un-cid')).toThrow(/ipfs_bad_cid/);
    // registro IPNS v2: el valor viaja en un mapa CBOR
    const valor = Buffer.from('/ipfs/QmUwSbXZoAgFyZmN9vUmAwxKb4JUwR5EtFpQF2z77XBLGH');
    const cbor = Buffer.concat([
      Buffer.from([0xa2, 0x65]),
      Buffer.from('Value'),
      Buffer.from([0x58, valor.length]),
      valor,
      Buffer.from([0x68]),
      Buffer.from('Sequence'),
      Buffer.from([0x05]),
    ]);
    const datos = ipfsCbor(cbor) as { Value: Buffer; Sequence: number };
    expect(datos.Value.toString('utf8')).toBe(valor.toString('utf8'));
    expect(datos.Sequence).toBe(5);
    // qué URLs se tratan como IPFS
    expect(ipfsUrlParts('https://ipfs.io/ipns/k51abc/data/lista%20x.m3u')).toEqual({
      kind: 'ipns',
      name: 'k51abc',
      segments: ['data', 'lista x.m3u'],
    });
    expect(ipfsUrlParts('https://k51abc.ipns.dweb.link/hashes.m3u')).toEqual({
      kind: 'ipns',
      name: 'k51abc',
      segments: ['hashes.m3u'],
    });
    expect(ipfsUrlParts('https://example.com/lista.m3u')).toBeNull();
    expect(ipfsUrlParts('http://ipfs.io/ipns/k51abc/x')).toBeNull();
    // el orden IPFS directo → pasarela se prueba en fetcher.test.ts; el texto
    // de `ipfs_not_found` en la web es de la Fase 2 (E2.3)
  });
});

describe('ipfsCarBlocks: cada bloque contra su huella (server.js:1613-1633)', () => {
  const { bloques } = directorioIpfsDePrueba();

  it('guarda los bloques por hash:huella', () => {
    const mapa = ipfsCarBlocks(carDe(bloques));
    expect(mapa.size).toBe(5);
    for (const key of mapa.keys()) expect(key).toMatch(/^18:[0-9a-f]{64}$/);
  });

  it('cualquier bloque alterado (el primero, uno intermedio o el último) se rechaza', () => {
    for (const index of [0, 2, 4]) {
      const alterados = bloques.map((b, i) =>
        i === index ? { ...b, bloque: Buffer.concat([b.bloque, Buffer.from([0])]) } : b,
      );
      expect(
        codeOf(() => ipfsCarBlocks(carDe(alterados))),
        String(index),
      ).toBe('ipfs_bad_block');
    }
  });

  it('un CID con la huella cambiada también se rechaza', () => {
    const cid = Buffer.from(bloques[3]!.cid);
    cid.writeUInt8(cid.readUInt8(cid.length - 1) ^ 0xff, cid.length - 1);
    expect(codeOf(() => ipfsCarBlocks(carDe([{ cid, bloque: bloques[3]!.bloque }])))).toBe(
      'ipfs_bad_block',
    );
  });

  it('hash identidad: el bloque tiene que ser la propia huella (0.7.0)', () => {
    const datos = Buffer.from('hola');
    const cid = Buffer.concat([varintDe(1), varintDe(0x55), varintDe(0x00), varintDe(4), datos]);
    expect(ipfsCarBlocks(carDe([{ cid, bloque: datos }])).size).toBe(1);
    expect(codeOf(() => ipfsCarBlocks(carDe([{ cid, bloque: Buffer.from('adiós') }])))).toBe(
      'ipfs_bad_block',
    );
  });

  it('un hash que no es sha2-256 ni identidad → ipfs_unsupported_hash', () => {
    const cid = Buffer.concat([
      varintDe(1),
      varintDe(0x55),
      varintDe(0x13),
      varintDe(1),
      Buffer.from([1]),
    ]);
    expect(codeOf(() => ipfsCarBlocks(carDe([{ cid, bloque: Buffer.from('x') }])))).toBe(
      'ipfs_unsupported_hash',
    );
  });

  it('una sección que se sale del CAR → ipfs_bad_data', () => {
    const car = carDe(bloques);
    expect(codeOf(() => ipfsCarBlocks(car.subarray(0, car.length - 3)))).toBe('ipfs_bad_data');
    expect(codeOf(() => ipfsCarBlocks(Buffer.from([0x80])))).toBe('ipfs_bad_data');
  });

  it('un CIDv0 binario (0x12 0x20 + sha256) se acepta', () => {
    const bloque = nodoPb([], 1);
    const cid = cidDe(0x70, bloque).subarray(2); // 0x12 0x20 <huella>
    const mapa = ipfsCarBlocks(carDe([{ cid, bloque }]));
    expect(mapa.size).toBe(1);
  });
});

describe('ipfsWalk e ipfsReadFile (server.js:1660-1698)', () => {
  const { raizTexto, bloques } = directorioIpfsDePrueba();
  const mapa = ipfsCarBlocks(carDe(bloques));
  const raiz = ipfsCidFromText(raizTexto);

  it('sin segmentos devuelve la raíz; un bloque que falta → ipfs_missing_block', () => {
    expect(ipfsWalk(mapa, raiz, [])).toBe(raiz);
    const incompleto = ipfsCarBlocks(carDe(bloques.slice(0, 2)));
    const fichero = ipfsWalk(incompleto, raiz, ['data', 'lista.m3u']);
    expect(codeOf(() => ipfsReadFile(incompleto, fichero, 1024))).toBe('ipfs_missing_block');
    expect(codeOf(() => ipfsWalk(new Map(), raiz, ['data']))).toBe('ipfs_missing_block');
  });

  it('no se puede bajar por un bloque raw ni por un HAMT', () => {
    const rawCid = ipfsReadCid(bloques[3]!.cid);
    expect(codeOf(() => ipfsWalk(mapa, rawCid, ['x']))).toBe('ipfs_not_found');
    const hamt = nodoPb([], 5);
    const hamtCid = cidDe(0x70, hamt);
    const conHamt = ipfsCarBlocks(carDe([{ cid: hamtCid, bloque: hamt }]));
    expect(codeOf(() => ipfsWalk(conHamt, ipfsReadCid(hamtCid), ['x']))).toBe(
      'ipfs_hamt_unsupported',
    );
  });

  it('un directorio no es un fichero; un codec raro no se lee', () => {
    expect(codeOf(() => ipfsReadFile(mapa, raiz, 1024))).toBe('ipfs_not_file');
    const raro = Buffer.from('x');
    const cid = cidDe(0x71, raro);
    const conRaro = ipfsCarBlocks(carDe([{ cid, bloque: raro }]));
    expect(codeOf(() => ipfsReadFile(conRaro, ipfsReadCid(cid), 1024))).toBe(
      'ipfs_unsupported_codec',
    );
  });

  it('un fichero con datos en línea (UnixFS tipo 2 con campo 2) y el tipo 0 (raw de UnixFS)', () => {
    const enLinea = nodoPb([], 2, Buffer.from('#EXTM3U\n'));
    const cid = cidDe(0x70, enLinea);
    const tipo0 = nodoPb([], 0, Buffer.from('cero'));
    const cid0 = cidDe(0x70, tipo0);
    const blocks = ipfsCarBlocks(
      carDe([
        { cid, bloque: enLinea },
        { cid: cid0, bloque: tipo0 },
      ]),
    );
    expect(ipfsReadFile(blocks, ipfsReadCid(cid), 100).toString()).toBe('#EXTM3U\n');
    expect(ipfsReadFile(blocks, ipfsReadCid(cid0), 100).toString()).toBe('cero');
    // 0.7.0: el límite vale también sin trozos
    expect(codeOf(() => ipfsReadFile(blocks, ipfsReadCid(cid), 3))).toBe('response_too_large');
  });

  it('un bloque raw suelto respeta el límite (0.7.0)', () => {
    const rawCid = ipfsReadCid(bloques[3]!.cid);
    expect(ipfsReadFile(mapa, rawCid, 1024).length).toBe(bloques[3]!.bloque.length);
    expect(codeOf(() => ipfsReadFile(mapa, rawCid, 5))).toBe('response_too_large');
  });

  it('más de 16 niveles → ipfs_bad_data', () => {
    let hoja: Buffer = Buffer.from('x');
    let cid = cidDe(0x55, hoja);
    const all = [{ cid, bloque: hoja }];
    for (let depth = 0; depth < 18; depth += 1) {
      hoja = nodoPb([{ cid }], 2);
      cid = cidDe(0x70, hoja);
      all.push({ cid, bloque: hoja });
    }
    const blocks = ipfsCarBlocks(carDe(all));
    expect(codeOf(() => ipfsReadFile(blocks, ipfsReadCid(cid), 1024))).toBe('ipfs_bad_data');
  });

  it('ipfsBlock de un CID identidad devuelve su huella sin mirar el mapa', () => {
    const cid = { codec: 0x55, hash: 0, digest: Buffer.from('dentro'), end: 0 };
    expect(ipfsBlock(new Map(), cid).toString()).toBe('dentro');
  });
});

describe('CID, varint, base58 y base32 (server.js:1452-1608)', () => {
  it('CIDv1 en base58 (z…) y errores de cada formato', () => {
    const cid = cidDe(0x55, Buffer.from('x'));
    const z = ipfsCidFromText(`z${base58De(cid)}`);
    expect([z.codec, z.hash, z.digest.length]).toEqual([0x55, 0x12, 32]);
    const v0 = ipfsBase58('QmUwSbXZoAgFyZmN9vUmAwxKb4JUwR5EtFpQF2z77XBLGH');
    expect(v0.subarray(0, 2)).toEqual(Buffer.from([0x12, 0x20]));
    expect(codeOf(() => ipfsBase58('0OIl'))).toBe('ipfs_bad_cid');
    expect(codeOf(() => ipfsBase32('ABC'))).toBe('ipfs_bad_cid');
    expect(ipfsBase58('11').equals(Buffer.from([0, 0, 0]))).toBe(true);
    expect(codeOf(() => ipfsCidFromText('z11111111'))).toBe('ipfs_bad_cid');
    expect(codeOf(() => ipfsCidFromText('bafy'))).toBe('ipfs_bad_cid');
  });

  it('un CID de versión distinta de 1 o que se sale del búfer → ipfs_bad_cid', () => {
    expect(codeOf(() => ipfsReadCid(Buffer.from([2, 0x55, 0x12, 1, 0])))).toBe('ipfs_bad_cid');
    expect(codeOf(() => ipfsReadCid(Buffer.from([1, 0x55, 0x12, 32, 0])))).toBe('ipfs_bad_cid');
  });

  it('varint: multibyte, se sale del búfer o es demasiado largo → ipfs_bad_data', () => {
    expect(ipfsVarint(varintDe(300), 0)).toEqual([300, 2]);
    expect(ipfsVarint(varintDe(2 ** 40), 0)[0]).toBe(2 ** 40);
    expect(codeOf(() => ipfsVarint(Buffer.from([0x80, 0x80]), 0))).toBe('ipfs_bad_data');
    expect(codeOf(() => ipfsVarint(Buffer.alloc(9, 0xff), 0))).toBe('ipfs_bad_data');
  });
});

describe('ipfsProtobuf (server.js:1467-1494)', () => {
  it('varint y bytes; los de 64 y 32 bits se saltan', () => {
    const mensaje = Buffer.concat([
      campoPb(1, 150),
      campoPb(2, Buffer.from('abc')),
      Buffer.from([(3 << 3) | 1]),
      Buffer.alloc(8),
      Buffer.from([(4 << 3) | 5]),
      Buffer.alloc(4),
      campoPb(5, 1),
    ]);
    expect(ipfsProtobuf(mensaje)).toEqual([
      [1, 150],
      [2, Buffer.from('abc')],
      [5, 1],
    ]);
  });

  it('un tipo de cable desconocido o bytes que se salen → ipfs_bad_data', () => {
    expect(codeOf(() => ipfsProtobuf(Buffer.from([(1 << 3) | 3])))).toBe('ipfs_bad_data');
    expect(codeOf(() => ipfsProtobuf(Buffer.from([(1 << 3) | 2, 5, 1])))).toBe('ipfs_bad_data');
  });

  it('ipfsNode lee enlaces con nombre y el tipo UnixFS', () => {
    const { bloques } = directorioIpfsDePrueba();
    const raiz = ipfsNode(bloques[0]!.bloque);
    expect(raiz.type).toBe(1);
    expect(raiz.links.map((link) => link.name)).toEqual(['data']);
    const sinCid = Buffer.concat([
      campoPb(2, campoPb(2, Buffer.from('solo nombre'))),
      campoPb(1, campoPb(1, 2)),
    ]);
    expect(ipfsNode(sinCid).links).toEqual([]);
  });
});

describe('ipfsCbor (server.js:1497-1539)', () => {
  it('enteros, negativos, textos, listas, etiquetas y simples', () => {
    expect(ipfsCbor(Buffer.from([0x17]))).toBe(23);
    expect(ipfsCbor(Buffer.from([0x18, 0xff]))).toBe(255);
    expect(ipfsCbor(Buffer.from([0x19, 0x01, 0x00]))).toBe(256);
    expect(ipfsCbor(Buffer.from([0x1a, 0, 1, 0, 0]))).toBe(65536);
    expect(ipfsCbor(Buffer.from([0x1b, 0, 0, 0, 1, 0, 0, 0, 0]))).toBe(2 ** 32);
    expect(ipfsCbor(Buffer.from([0x20]))).toBe(-1);
    expect(ipfsCbor(Buffer.from([0x63, 0x61, 0x62, 0x63]))).toBe('abc');
    expect(ipfsCbor(Buffer.from([0x83, 1, 2, 3]))).toEqual([1, 2, 3]);
    expect(ipfsCbor(Buffer.from([0xc1, 0x05]))).toBe(5);
    expect(ipfsCbor(Buffer.from([0xf4]))).toBe(false);
    expect(ipfsCbor(Buffer.from([0xf5]))).toBe(true);
    expect(ipfsCbor(Buffer.from([0xf6]))).toBeNull();
    expect(ipfsCbor(Buffer.from([0xfb, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it('errores: vacío, longitud indefinida, texto que se sale y más de 8 niveles', () => {
    expect(codeOf(() => ipfsCbor(Buffer.alloc(0)))).toBe('ipfs_bad_record');
    expect(codeOf(() => ipfsCbor(Buffer.from([0x5f])))).toBe('ipfs_bad_record');
    expect(codeOf(() => ipfsCbor(Buffer.from([0x19, 0x01])))).toBe('ipfs_bad_record');
    expect(codeOf(() => ipfsCbor(Buffer.from([0x65, 0x61])))).toBe('ipfs_bad_record');
    expect(codeOf(() => ipfsCbor(Buffer.alloc(10, 0x81)))).toBe('ipfs_bad_record');
  });

  it('la clave __proto__ es una clave más (0.7.0)', () => {
    const cbor = Buffer.concat([
      Buffer.from([0xa1, 0x69]),
      Buffer.from('__proto__'),
      Buffer.from([0xa1, 0x65]),
      Buffer.from('Value'),
      Buffer.from([0x61, 0x78]),
    ]);
    const map = ipfsCbor(cbor) as Record<string, unknown>;
    expect(Object.getPrototypeOf(map)).toBe(Object.prototype);
    expect(Object.keys(map)).toEqual(['__proto__']);
    expect((map as { Value?: unknown }).Value).toBeUndefined();
  });
});

describe('ipnsRecordValue (server.js:1728-1745)', () => {
  it('v2 (campo 9, CBOR) manda sobre v1 (campo 1)', () => {
    expect(ipnsRecordValue(registroIpnsV2('/ipfs/bafyraiz/data'))).toBe('/ipfs/bafyraiz/data');
  });

  it('solo v1', () => {
    expect(ipnsRecordValue(registroIpnsV1('/ipns/otro.example'))).toBe('/ipns/otro.example');
  });

  it('sin valor → ipfs_bad_record', () => {
    expect(codeOf(() => ipnsRecordValue(campoPb(3, 1)))).toBe('ipfs_bad_record');
    const sinValue = campoPb(9, Buffer.from([0xa1, 0x61, 0x78, 0x01]));
    expect(codeOf(() => ipnsRecordValue(sinValue))).toBe('ipfs_bad_record');
  });
});

describe('ipfsUrlParts (server.js:1703-1717)', () => {
  it.each([
    ['https://ipfs.io/ipfs/bafyabc', { kind: 'ipfs', name: 'bafyabc', segments: [] }],
    [
      'https://dweb.link/ipns/k51abc/a/b.m3u',
      { kind: 'ipns', name: 'k51abc', segments: ['a', 'b.m3u'] },
    ],
    ['https://bafyabc.ipfs.w3s.link/x.m3u', { kind: 'ipfs', name: 'bafyabc', segments: ['x.m3u'] }],
    [
      'https://example.com/ipfs/cualquiera/x',
      { kind: 'ipfs', name: 'cualquiera', segments: ['x'] },
    ],
    ['https://ipfs.io/ipns/k51/%E0%A4%A', { kind: 'ipns', name: 'k51', segments: ['%E0%A4%A'] }],
  ])('%s', (url, parts) => {
    expect(ipfsUrlParts(url)).toEqual(parts);
  });

  it('no son IPFS: otra ruta, http, URL rota', () => {
    expect(ipfsUrlParts('https://ipfs.io/otra/cosa')).toBeNull();
    expect(ipfsUrlParts('no es una url')).toBeNull();
    expect(ipfsUrlParts('https://sub.ipfs')).toBeNull();
  });
});
