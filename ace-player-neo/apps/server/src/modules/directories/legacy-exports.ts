/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `directories`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre. En el esqueleto lanzan
   `not_implemented`; el agente del módulo las implementa o las reexporta de
   su servicio (mismas entradas y salidas que la 0.6.59). Las firmas son las
   de server.js con tipos de @ace/shared donde se conocen. */

import { notImplemented } from '../../core/errors.js';
import type { Item } from '@ace/shared';

/** `parseM3u` (server.js:2751). */
export function parseM3u(_text: string): Item[] {
  throw notImplemented('parseM3u');
}

/** `parseHtml` (server.js:2787). */
export function parseHtml(_text: string): Item[] {
  throw notImplemented('parseHtml');
}

/** `alternateGatewayUrl` (server.js:1426): ipfs.io ↔ dweb.link. T-117. */
export function alternateGatewayUrl(_url: string): string | null {
  throw notImplemented('alternateGatewayUrl');
}

/** `fetchDirectoryText` (server.js:1774). T-117. */
export async function fetchDirectoryText(_url: string): Promise<string> {
  throw notImplemented('fetchDirectoryText');
}

/** `fetchIpfsDirectory` (server.js:1748). */
export async function fetchIpfsDirectory(_url: string): Promise<string> {
  throw notImplemented('fetchIpfsDirectory');
}

/** `ipfsUrlParts` (server.js:1703). T-121. */
export function ipfsUrlParts(
  _url: string,
): { kind: 'ipfs' | 'ipns'; name: string; segments: string[] } | null {
  throw notImplemented('ipfsUrlParts');
}

/** `ipfsCidFromText` (server.js:1603): lanza `ipfs_bad_cid`. T-121. */
export function ipfsCidFromText(_text: string): { codec: number; hash: number; digest: Buffer } {
  throw notImplemented('ipfsCidFromText');
}

/** `ipfsCarBlocks` (server.js:1613): bloques comprobados; lanza `ipfs_bad_block`. T-121. */
export function ipfsCarBlocks(_car: Buffer): Map<string, Buffer> {
  throw notImplemented('ipfsCarBlocks');
}

/** `ipfsWalk` (server.js:1667): lanza `ipfs_not_found`. T-121. */
export function ipfsWalk(
  _blocks: Map<string, Buffer>,
  _rootCid: unknown,
  _segments: string[],
): unknown {
  throw notImplemented('ipfsWalk');
}

/** `ipfsReadFile` (server.js:1682): lanza `response_too_large`. T-121. */
export function ipfsReadFile(
  _blocks: Map<string, Buffer>,
  _cid: unknown,
  _limit: number,
  _depth?: number,
): Buffer {
  throw notImplemented('ipfsReadFile');
}

/** `ipfsCbor` (server.js:1497): registro IPNS v2. T-121. */
export function ipfsCbor(_buffer: Buffer): unknown {
  throw notImplemented('ipfsCbor');
}

/** `ipfsProtobuf` (server.js:1467). */
export function ipfsProtobuf(_buffer: Buffer): unknown {
  throw notImplemented('ipfsProtobuf');
}

/** `autoSyncWeb` (server.js:5091): con `AUTO_SYNC=false` no sale a internet. T-119. */
export async function autoSyncWeb(): Promise<void> {
  throw notImplemented('autoSyncWeb');
}
