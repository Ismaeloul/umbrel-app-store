/* IPFS sin pasarela pública (server.js:1440-1770, B-196).

   Desde septiembre de 2026 ipfs.io, dweb.link y w3s.link ya no sirven
   ficheros. Un directorio en /ipns/<nombre>/<ruta> se baja como lo hace el
   service worker de IPFS en el navegador:
   1. el enrutado delegado da el registro IPNS -> /ipfs/<cid>[/ruta] (o el
      TXT `_dnslink.` si el nombre es un dominio);
   2. la pasarela trustless entrega en un CAR los bloques de esa ruta, y aquí
      se recorre el directorio y se junta el fichero.
   Cada bloque se comprueba contra su huella, así que un CAR alterado no
   cuela. La firma del registro IPNS no se verifica (backend-modulos §8.7.33):
   se confía en el enrutado delegado igual que antes en ipfs.io.

   Portado tal cual, con tres endurecimientos (docs/compat.md):
   - un bloque con hash identidad también se comprueba (su contenido tiene
     que ser la propia huella), no solo los sha2-256;
   - `ipfsReadFile` aplica el límite también a un bloque suelto o al
     contenido en línea del nodo, no solo al sumar trozos;
   - `ipfsCbor` guarda la clave `__proto__` como una clave más. */

import { createHash } from 'node:crypto';
import { AppError } from '../../core/errors.js';

export interface IpfsCid {
  /** 0x70 dag-pb, 0x55 raw… */
  readonly codec: number;
  /** 0x12 sha2-256, 0x00 identidad. */
  readonly hash: number;
  readonly digest: Buffer;
  /** Posición siguiente al CID dentro del búfer leído. */
  readonly end: number;
}

export type ProtobufField = [number, number | Buffer];

export interface IpfsUrlParts {
  readonly kind: 'ipfs' | 'ipns';
  readonly name: string;
  readonly segments: string[];
}

/** `ipfsVarint` (server.js:1452-1463). */
export function ipfsVarint(buffer: Buffer, position: number): [number, number] {
  let value = 0;
  let shift = 0;
  let byte: number;
  do {
    if (position >= buffer.length || shift > 49) throw new AppError('ipfs_bad_data');
    byte = buffer[position++]!;
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return [value, position];
}

/**
 * `ipfsProtobuf` (server.js:1467-1494): campos `[número, valor]` de un
 * mensaje protobuf. Solo varint y bytes, que es lo que usan dag-pb, UnixFS
 * y el registro IPNS; los de 64 y 32 bits se saltan.
 */
export function ipfsProtobuf(buffer: Buffer): ProtobufField[] {
  const fields: ProtobufField[] = [];
  let position = 0;
  while (position < buffer.length) {
    let key: number;
    [key, position] = ipfsVarint(buffer, position);
    const wire = key & 7;
    const field = Math.floor(key / 8);
    if (wire === 0) {
      let value: number;
      [value, position] = ipfsVarint(buffer, position);
      fields.push([field, value]);
    } else if (wire === 2) {
      let length: number;
      [length, position] = ipfsVarint(buffer, position);
      if (position + length > buffer.length) throw new AppError('ipfs_bad_data');
      fields.push([field, buffer.subarray(position, position + length)]);
      position += length;
    } else if (wire === 1) {
      position += 8;
    } else if (wire === 5) {
      position += 4;
    } else {
      throw new AppError('ipfs_bad_data');
    }
  }
  return fields;
}

const CBOR_SIZES: Readonly<Record<number, number>> = { 24: 1, 25: 2, 26: 4, 27: 8 };

/** `ipfsCbor` (server.js:1497-1539): CBOR mínimo (el campo `data` del registro IPNS v2). */
export function ipfsCbor(buffer: Buffer): unknown {
  let position = 0;
  const argument = (info: number): number => {
    if (info < 24) return info;
    const size = CBOR_SIZES[info];
    if (!size || position + size > buffer.length) throw new AppError('ipfs_bad_record');
    let value = 0;
    for (let index = 0; index < size; index += 1) value = value * 256 + buffer[position++]!;
    return value;
  };
  const item = (depth: number): unknown => {
    if (depth > 8 || position >= buffer.length) throw new AppError('ipfs_bad_record');
    const first = buffer[position++]!;
    const major = first >> 5;
    const info = first & 31;
    if (major === 7) {
      const size = CBOR_SIZES[info];
      if (size) position += size;
      return info === 20 ? false : info === 21 ? true : null;
    }
    const value = argument(info);
    if (major === 0) return value;
    if (major === 1) return -1 - value;
    if (major === 2 || major === 3) {
      if (position + value > buffer.length) throw new AppError('ipfs_bad_record');
      const bytes = buffer.subarray(position, position + value);
      position += value;
      return major === 3 ? bytes.toString('utf8') : bytes;
    }
    if (major === 4) return Array.from({ length: value }, () => item(depth + 1));
    if (major === 5) {
      const map: Record<string, unknown> = {};
      for (let index = 0; index < value; index += 1) {
        const key = String(item(depth + 1));
        Object.defineProperty(map, key, {
          value: item(depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return map;
    }
    if (major === 6) return item(depth + 1);
    throw new AppError('ipfs_bad_record');
  };
  return item(0);
}

const IPFS_BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** `ipfsBase58` (server.js:1543-1564). */
export function ipfsBase58(text: string): Buffer {
  const bytes = [0];
  for (const char of text) {
    let carry = IPFS_BASE58.indexOf(char);
    if (carry < 0) throw new AppError('ipfs_bad_cid');
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index]! * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of text) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

/** `ipfsBase32` (server.js:1565-1581), sin relleno y en minúsculas. */
export function ipfsBase32(text: string): Buffer {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of text) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new AppError('ipfs_bad_cid');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * `ipfsReadCid` (server.js:1585-1601): CID binario → `{ codec, hash, digest, end }`.
 * Un CIDv0 es solo el multihash sha2-256 de un nodo dag-pb.
 */
export function ipfsReadCid(buffer: Buffer, start = 0): IpfsCid {
  if (buffer[start] === 0x12 && buffer[start + 1] === 0x20) {
    return {
      codec: 0x70,
      hash: 0x12,
      digest: buffer.subarray(start + 2, start + 34),
      end: start + 34,
    };
  }
  const [version, afterVersion] = ipfsVarint(buffer, start);
  if (version !== 1) throw new AppError('ipfs_bad_cid');
  const [codec, afterCodec] = ipfsVarint(buffer, afterVersion);
  const [hash, afterHash] = ipfsVarint(buffer, afterCodec);
  const [length, position] = ipfsVarint(buffer, afterHash);
  if (position + length > buffer.length) throw new AppError('ipfs_bad_cid');
  return {
    codec,
    hash,
    digest: buffer.subarray(position, position + length),
    end: position + length,
  };
}

/** `ipfsCidFromText` (server.js:1603-1608): CIDv0 `Qm…`, CIDv1 en base32 (`b…`) o base58 (`z…`). */
export function ipfsCidFromText(text: string): IpfsCid {
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(text)) return ipfsReadCid(ipfsBase58(text));
  if (/^b[a-z2-7]{8,}$/.test(text)) return ipfsReadCid(ipfsBase32(text.slice(1)));
  if (/^z[1-9A-HJ-NP-Za-km-z]{8,}$/.test(text)) return ipfsReadCid(ipfsBase58(text.slice(1)));
  throw new AppError('ipfs_bad_cid');
}

/** `ipfsBlockKey` (server.js:1610). */
export const ipfsBlockKey = (cid: Pick<IpfsCid, 'hash' | 'digest'>): string =>
  `${cid.hash}:${cid.digest.toString('hex')}`;

/**
 * `ipfsCarBlocks` (server.js:1613-1633): bloques de un CAR v1, comprobados
 * uno a uno contra su huella. Uno que no coincide → `ipfs_bad_block`; un
 * hash que no es sha2-256 ni identidad → `ipfs_unsupported_hash`.
 */
export function ipfsCarBlocks(car: Buffer): Map<string, Buffer> {
  const [headerLength, afterHeader] = ipfsVarint(car, 0);
  let position = afterHeader + headerLength;
  const blocks = new Map<string, Buffer>();
  while (position < car.length) {
    let length: number;
    [length, position] = ipfsVarint(car, position);
    if (position + length > car.length) throw new AppError('ipfs_bad_data');
    const section = car.subarray(position, position + length);
    position += length;
    const cid = ipfsReadCid(section);
    const block = section.subarray(cid.end);
    if (cid.hash === 0x12) {
      if (!createHash('sha256').update(block).digest().equals(cid.digest)) {
        throw new AppError('ipfs_bad_block', { detail: ipfsBlockKey(cid) });
      }
    } else if (cid.hash === 0x00) {
      // 0.7.0: el bloque de un CID identidad es la propia huella
      if (!block.equals(cid.digest)) throw new AppError('ipfs_bad_block', { detail: 'identidad' });
    } else {
      throw new AppError('ipfs_unsupported_hash', { detail: String(cid.hash) });
    }
    blocks.set(ipfsBlockKey(cid), block);
  }
  return blocks;
}

interface IpfsLink {
  cid?: IpfsCid;
  name?: string;
}

interface IpfsNode {
  readonly links: { readonly cid: IpfsCid; readonly name?: string }[];
  readonly type: number | Buffer | null;
  readonly content: Buffer;
}

/** `ipfsNode` (server.js:1636-1658): nodo dag-pb con su UnixFS. */
export function ipfsNode(block: Buffer): IpfsNode {
  const links: { cid: IpfsCid; name?: string }[] = [];
  let data: Buffer = Buffer.alloc(0);
  for (const [field, value] of ipfsProtobuf(block)) {
    if (field === 2 && Buffer.isBuffer(value)) {
      const link: IpfsLink = {};
      for (const [linkField, linkValue] of ipfsProtobuf(value)) {
        if (linkField === 1 && Buffer.isBuffer(linkValue)) link.cid = ipfsReadCid(linkValue);
        else if (linkField === 2 && Buffer.isBuffer(linkValue))
          link.name = linkValue.toString('utf8');
      }
      if (link.cid) links.push({ ...link, cid: link.cid });
    } else if (field === 1 && Buffer.isBuffer(value)) {
      data = value;
    }
  }
  let type: number | Buffer | null = null;
  let content: Buffer = Buffer.alloc(0);
  for (const [field, value] of ipfsProtobuf(data)) {
    if (field === 1) type = value;
    else if (field === 2 && Buffer.isBuffer(value)) content = value;
  }
  return { links, type, content };
}

/** `ipfsBlock` (server.js:1660-1665). */
export function ipfsBlock(blocks: Map<string, Buffer>, cid: IpfsCid): Buffer {
  if (cid.hash === 0x00) return cid.digest;
  const block = blocks.get(ipfsBlockKey(cid));
  if (!block) throw new AppError('ipfs_missing_block');
  return block;
}

/** `ipfsWalk` (server.js:1667-1680): baja por los nombres de la ruta. */
export function ipfsWalk(blocks: Map<string, Buffer>, root: IpfsCid, segments: string[]): IpfsCid {
  let cid = root;
  for (const segment of segments) {
    if (cid.codec !== 0x70) throw new AppError('ipfs_not_found');
    const node = ipfsNode(ipfsBlock(blocks, cid));
    /* Los directorios enormes van repartidos en un HAMT: no es el caso de
       ningún directorio conocido y se deja al respaldo de la pasarela. */
    if (node.type === 5) throw new AppError('ipfs_hamt_unsupported');
    const link = node.links.find((entry) => entry.name === segment);
    if (!link) throw new AppError('ipfs_not_found', { detail: segment });
    cid = link.cid;
  }
  return cid;
}

/** `ipfsReadFile` (server.js:1682-1698): junta los trozos de un fichero UnixFS. */
export function ipfsReadFile(
  blocks: Map<string, Buffer>,
  cid: IpfsCid,
  limit: number,
  depth = 0,
): Buffer {
  if (depth > 16) throw new AppError('ipfs_bad_data');
  const block = ipfsBlock(blocks, cid);
  if (cid.codec === 0x55) {
    // 0.7.0: también un bloque suelto respeta el límite
    if (block.length > limit) throw new AppError('response_too_large');
    return block;
  }
  if (cid.codec !== 0x70) throw new AppError('ipfs_unsupported_codec');
  const node = ipfsNode(block);
  if (node.type !== 2 && node.type !== 0) throw new AppError('ipfs_not_file');
  const parts = [node.content];
  let total = node.content.length;
  if (total > limit) throw new AppError('response_too_large');
  for (const link of node.links) {
    const part = ipfsReadFile(blocks, link.cid, limit - total, depth + 1);
    total += part.length;
    if (total > limit) throw new AppError('response_too_large');
    parts.push(part);
  }
  return Buffer.concat(parts);
}

/**
 * `ipfsUrlParts` (server.js:1703-1717): `{ kind, name, segments }` si la URL
 * es de una pasarela IPFS, estilo ruta (`https://ipfs.io/ipns/<n>/lista.m3u`)
 * o subdominio (`https://<n>.ipns.dweb.link/lista.m3u`); `null` si no. Solo https.
 */
export function ipfsUrlParts(url: string): IpfsUrlParts | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const segmentsOf = (pathname: string): string[] =>
    pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
  const byPath = parsed.pathname.match(/^\/(ipfs|ipns)\/([^/]+)(\/.*)?$/);
  if (byPath) {
    return {
      kind: byPath[1] as 'ipfs' | 'ipns',
      name: byPath[2]!,
      segments: segmentsOf(byPath[3] || ''),
    };
  }
  const bySubdomain = parsed.hostname
    .toLowerCase()
    .match(/^([a-z0-9]+)\.(ipfs|ipns)\.[a-z0-9.-]+$/);
  if (bySubdomain) {
    return {
      kind: bySubdomain[2] as 'ipfs' | 'ipns',
      name: bySubdomain[1]!,
      segments: segmentsOf(parsed.pathname),
    };
  }
  return null;
}

/**
 * Valor de un registro IPNS (server.js:1728-1745): el campo 9 (datos CBOR de
 * la v2) manda sobre el 1, que es el de la v1. Lanza `ipfs_bad_record` si
 * no hay valor.
 */
export function ipnsRecordValue(record: Buffer): string {
  let value: unknown = null;
  for (const [field, content] of ipfsProtobuf(record)) {
    if (field === 9 && Buffer.isBuffer(content)) {
      const data = ipfsCbor(content);
      if (
        data !== null &&
        typeof data === 'object' &&
        (data as { Value?: unknown }).Value !== undefined
      ) {
        value = (data as { Value: unknown }).Value;
      }
    } else if (field === 1 && value === null && Buffer.isBuffer(content)) {
      value = content;
    }
  }
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  if (!text) throw new AppError('ipfs_bad_record');
  return text;
}
