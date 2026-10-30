/* core/privileges.ts: el backend deja de ser root al arrancar (0.9.12). Con un
   sistema de ficheros falso en memoria: en Windows y en la CI no se es root. */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dropRoot, parseRunAs, type PrivilegeOps } from './privileges.js';

interface FakeEntry {
  uid: number;
  gid: number;
  dir: boolean;
}

function fakeOps(
  options: { uid?: number; files?: Record<string, FakeEntry>; failSetuid?: boolean } = {},
) {
  const files = new Map(
    Object.entries(options.files ?? {}).map(([k, v]) => [path.normalize(k), { ...v }]),
  );
  const calls: string[] = [];
  let uid = options.uid ?? 0;
  const ops: PrivilegeOps = {
    getuid: () => uid,
    setgroups: (groups) => void calls.push(`setgroups ${groups.join(',')}`),
    setgid: (gid) => void calls.push(`setgid ${gid}`),
    setuid: (next) => {
      if (options.failSetuid) throw new Error('EPERM');
      calls.push(`setuid ${next}`);
      uid = next;
    },
    lstat: (file) => {
      const entry = files.get(path.normalize(file));
      if (!entry) throw Object.assign(new Error(`ENOENT ${file}`), { code: 'ENOENT' });
      return { uid: entry.uid, gid: entry.gid, isDirectory: () => entry.dir };
    },
    lchown: (file, nextUid, nextGid) => {
      const entry = files.get(path.normalize(file)) as FakeEntry;
      entry.uid = nextUid;
      entry.gid = nextGid;
      calls.push(`lchown ${path.normalize(file)}`);
    },
    readdir: (dir) => {
      const prefix = path.normalize(dir) + path.sep;
      return [...files.keys()]
        .filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes(path.sep))
        .map((file) => file.slice(prefix.length));
    },
  };
  return { ops, files, calls };
}

const ON = { ACE_RUN_AS: '1000:1000' };

describe('parseRunAs', () => {
  it('acepta uid:gid y rechaza root, vacíos y basura', () => {
    expect(parseRunAs('1000:1000')).toEqual({ uid: 1000, gid: 1000 });
    expect(parseRunAs(' 1001:100 ')).toEqual({ uid: 1001, gid: 100 });
    for (const bad of [undefined, '', '0:0', '1000:0', 'node', '1000', '-1:1000', '1000:1000:1']) {
      expect(parseRunAs(bad)).toBeNull();
    }
  });
});

describe('dropRoot', () => {
  it('sin ACE_RUN_AS no hace nada', () => {
    const { ops, calls } = fakeOps();
    expect(dropRoot({}, '/data', ops)).toEqual({ status: 'off' });
    expect(calls).toEqual([]);
  });

  it('si ya no es root no toca nada', () => {
    const { ops, calls } = fakeOps({ uid: 1000 });
    expect(dropRoot(ON, '/data', ops)).toEqual({ status: 'not-root' });
    expect(calls).toEqual([]);
  });

  it('pasa a ser dueño de lo que no es suyo y luego suelta grupos, gid y uid, en ese orden', () => {
    const { ops, files, calls } = fakeOps({
      files: {
        '/data': { uid: 1000, gid: 1000, dir: true },
        '/data/state.json': { uid: 0, gid: 0, dir: false },
        '/data/v2': { uid: 0, gid: 0, dir: true },
        '/data/v2/devices.json': { uid: 0, gid: 0, dir: false },
        '/data/v2/settings.json': { uid: 1000, gid: 1000, dir: false },
      },
    });
    expect(dropRoot(ON, '/data', ops)).toEqual({
      status: 'dropped',
      uid: 1000,
      gid: 1000,
      chowned: 3,
    });
    for (const entry of files.values()) expect([entry.uid, entry.gid]).toEqual([1000, 1000]);
    expect(calls.slice(-3)).toEqual(['setgroups 1000', 'setgid 1000', 'setuid 1000']);
    expect(calls.filter((call) => call.startsWith('lchown'))).toHaveLength(3);
  });

  it('el segundo arranque ya no cambia ningún dueño', () => {
    const { ops } = fakeOps({ files: { '/data': { uid: 1000, gid: 1000, dir: true } } });
    expect(dropRoot(ON, '/data', ops)).toMatchObject({ status: 'dropped', chowned: 0 });
  });

  it('sin carpeta de datos (primera instalación) suelta el root igual', () => {
    const { ops, calls } = fakeOps();
    expect(dropRoot(ON, '/data', ops)).toMatchObject({ status: 'dropped', chowned: 0 });
    expect(calls).toContain('setuid 1000');
  });

  it('un fallo no lanza: lo devuelve y el proceso sigue como estaba', () => {
    const { ops } = fakeOps({
      failSetuid: true,
      files: { '/data': { uid: 1000, gid: 1000, dir: true } },
    });
    expect(dropRoot(ON, '/data', ops)).toEqual({ status: 'failed', reason: 'EPERM' });
    expect(ops.getuid()).toBe(0);
  });

  it('un ACE_RUN_AS mal escrito o con root no se aplica', () => {
    const { ops, calls } = fakeOps();
    expect(dropRoot({ ACE_RUN_AS: '0:0' }, '/data', ops)).toMatchObject({ status: 'failed' });
    expect(dropRoot({ ACE_RUN_AS: 'node' }, '/data', ops)).toMatchObject({ status: 'failed' });
    expect(calls).toEqual([]);
  });

  it('sin las llamadas de POSIX (Windows) avisa y no hace nada', () => {
    expect(dropRoot(ON, '/data', null)).toMatchObject({ status: 'failed' });
  });
});
