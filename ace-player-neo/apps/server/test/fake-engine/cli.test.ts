/* Tests de la línea de órdenes del motor falso: el análisis de opciones, el
   arranque en el mismo proceso y el empaquetado con esbuild tal y como lo hace
   deploy/local/prepare.mjs para el perfil "falso" de docker compose. */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

import { contentIdToInfohash } from './catalog.js';
import { parseCliArgs, runCli, USAGE } from './cli-options.js';
import { getJson, loopbackHost } from './test-utils.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(path.join(tmpdir(), 'motor-falso-cli-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('opciones de la línea de órdenes', () => {
  it('valores por defecto: puerto 6878, solo loopback, sin catálogo ni modo', () => {
    expect(parseCliArgs([])).toEqual({
      help: false,
      host: '127.0.0.1',
      port: 6878,
      catalogPath: null,
      publicUrl: null,
      controlPort: null,
      idleTimeoutMs: null,
      unknownContent: 'play',
      mode: null,
    });
  });

  it('variables de entorno del compose (FAKE_ENGINE_* antes que HOST/PORT) y los argumentos mandan', () => {
    expect(parseCliArgs([], { HOST: '0.0.0.0', PORT: '7000' })).toMatchObject({
      host: '0.0.0.0',
      port: 7000,
    });
    expect(
      parseCliArgs([], {
        HOST: '1.1.1.1',
        PORT: '7000',
        FAKE_ENGINE_HOST: '0.0.0.0',
        FAKE_ENGINE_PORT: '6878',
      }),
    ).toMatchObject({ host: '0.0.0.0', port: 6878 });
    expect(
      parseCliArgs(['--port', '9000', '--host=::1'], { FAKE_ENGINE_PORT: '6878' }),
    ).toMatchObject({
      host: '::1',
      port: 9000,
    });
  });

  it('el resto de opciones, en las dos formas', () => {
    const options = parseCliArgs([
      '--catalog',
      'canales.json',
      '--public-url=http://acestream:6878',
      '--control-port',
      '6879',
      '--idle-timeout-ms',
      '30000',
      '--unknown',
      'fail',
      '--mode',
      'noPeers',
    ]);
    expect(options).toMatchObject({
      catalogPath: 'canales.json',
      publicUrl: 'http://acestream:6878',
      controlPort: 6879,
      idleTimeoutMs: 30000,
      unknownContent: 'fail',
      mode: { kind: 'noPeers' },
    });
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
  });

  it('falla al arrancar con opciones desconocidas o valores malos', () => {
    expect(() => parseCliArgs(['--puerto', '1'])).toThrow(/desconocida/);
    expect(() => parseCliArgs(['suelto'])).toThrow(/desconocida/);
    expect(() => parseCliArgs(['--port'])).toThrow(/falta el valor/);
    expect(() => parseCliArgs(['--port', '70000'])).toThrow(/puerto/);
    expect(() => parseCliArgs(['--port', 'abc'])).toThrow(/puerto/);
    expect(() => parseCliArgs(['--idle-timeout-ms', '0'])).toThrow(/idle/);
    expect(() => parseCliArgs(['--unknown', 'quizá'])).toThrow(/unknown/);
    expect(() => parseCliArgs(['--mode', 'explota'])).toThrow(/modo/);
  });
});

describe('arranque', () => {
  it('--help solo imprime la ayuda', async () => {
    const lines: string[] = [];
    const run = await runCli(['--help'], {}, (line) => lines.push(line));
    expect(run.engine).toBeNull();
    expect(lines.join('\n')).toBe(USAGE);
  });

  it('con catálogo propio, modo global y puerto de control aparte', async () => {
    const catalogFile = path.join(work, 'canales.json');
    const id = 'a1'.repeat(20);
    writeFileSync(
      catalogFile,
      JSON.stringify({ contents: [{ id, title: 'Canal Solo --> PRUEBA', bitrateKbps: 2000 }] }),
    );
    const host = await loopbackHost();
    const lines: string[] = [];
    const { engine } = await runCli(
      [
        '--port',
        '0',
        '--host',
        host,
        '--catalog',
        catalogFile,
        '--mode',
        'noPeers',
        '--control-port',
        '0',
      ],
      {},
      (line) => lines.push(line),
    );
    if (!engine) throw new Error('no arrancó');
    try {
      expect(lines[0]).toBe(`motor falso escuchando en ${engine.url} (host ${host})`);
      expect(lines.some((l) => l.includes(`${engine.controlUrl}/__fake/status`))).toBe(true);
      expect(lines.some((l) => l.includes(id) && l.includes('Canal Solo'))).toBe(true);
      const search = await getJson<{ result: { total: number } }>(
        `${engine.url}/search?query=canal`,
      );
      expect(search.result.total).toBe(1);
      const meta = await getJson<{ response: { stat_url: string; infohash: string } }>(
        `${engine.url}/ace/manifest.m3u8?id=${id}&format=json`,
      );
      expect(meta.response.infohash).toBe(contentIdToInfohash(id));
      const stat = await getJson<{ response: { status: string } }>(meta.response.stat_url);
      expect(stat.response.status).toBe('prebuf'); // el modo global noPeers
    } finally {
      await engine.close();
    }
  });

  it('un catálogo ilegible o inválido para el arranque con un mensaje claro', async () => {
    const bad = path.join(work, 'malo.json');
    writeFileSync(bad, '{ esto no es json');
    await expect(runCli(['--port', '0', '--catalog', bad], {}, () => undefined)).rejects.toThrow(
      /catálogo/,
    );
    const invalid = path.join(work, 'invalido.json');
    writeFileSync(invalid, JSON.stringify([{ id: 'corto' }]));
    await expect(
      runCli(['--port', '0', '--catalog', invalid], {}, () => undefined),
    ).rejects.toThrow(/id/);
  });
});

describe('empaquetado para docker compose', () => {
  it('cli.ts empaquetado con esbuild como prepare.mjs arranca, responde y sale con la señal', async () => {
    const outfile = path.join(work, 'fake-engine.mjs');
    // mismas opciones que deploy/local/prepare.mjs
    await build({
      entryPoints: [path.join(HERE, 'cli.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'esm',
      banner: {
        js: 'import { createRequire as __aceCreateRequire } from "node:module"; const require = __aceCreateRequire(import.meta.url);',
      },
      logLevel: 'silent',
    });
    const host = await loopbackHost();
    const child = spawn(process.execPath, [outfile, '--port', '0'], {
      env: { ...process.env, FAKE_ENGINE_HOST: host },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let out = '';
        const timer = setTimeout(() => reject(new Error(`no arrancó: ${out}`)), 15_000);
        child.stdout.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8');
          const match = /motor falso escuchando en (http:\/\/\S+)/.exec(out);
          if (match?.[1]) {
            clearTimeout(timer);
            resolve(match[1]);
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8');
        });
        child.once('exit', (code) => {
          clearTimeout(timer);
          reject(new Error(`salió con ${String(code)}: ${out}`));
        });
      });
      const version = await getJson<{ result: { version: string } }>(
        `${url}/webui/api/service?method=get_version`,
      );
      expect(version.result.version).toBe('3.2.3');
    } finally {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
  });
});
