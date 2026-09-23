/* La regla de `scannerEnginePath` (server.js:2842-2860, T-072) aplicada a
   las URL del motor principal (arquitectura §5.5). T-072 en sí lo porta el
   módulo scanner; aquí se prueba la misma regla en la copia del motor. */

import { describe, expect, it } from 'vitest';
import { engineRelativePath, engineStopPath, hostForUrl } from './paths.js';

describe('URL del motor reducidas a ruta relativa (regla de T-072)', () => {
  it('se queda con la ruta y la consulta de /ace/ y /content/, sin host', () => {
    expect(engineRelativePath('http://127.0.0.1:6878/ace/getstream?id=abc')).toBe(
      '/ace/getstream?id=abc',
    );
    expect(engineRelativePath('http://motor:6878/content/ih/tok')).toBe('/content/ih/tok');
    expect(engineRelativePath('/ace/stat/ih/1')).toBe('/ace/stat/ih/1');
    expect(engineRelativePath('  http://[::1]:1234/ace/r/ih/s  ')).toBe('/ace/r/ih/s');
  });

  it('descarta todo lo demás', () => {
    expect(engineRelativePath('http://servidor-ajeno.invalid/otra/ruta')).toBe('');
    expect(engineRelativePath('')).toBe('');
    expect(engineRelativePath(null)).toBe('');
    expect(engineRelativePath('/acex/nada')).toBe('');
    expect(engineRelativePath(`/ace/${'x'.repeat(4096)}`)).toBe('');
    expect(engineRelativePath('http://[mal')).toBe('');
  });

  it('command_url con method=stop (scannerStopPath)', () => {
    expect(engineStopPath('http://motor:6878/ace/cmd/ih/s1')).toBe('/ace/cmd/ih/s1?method=stop');
    expect(engineStopPath('/ace/cmd/ih/s1?method=play&x=1')).toBe('/ace/cmd/ih/s1?method=stop&x=1');
    expect(engineStopPath('http://ajeno/cmd')).toBe('');
  });

  it('los IPv6 literales van entre corchetes', () => {
    expect(hostForUrl('::1')).toBe('[::1]');
    expect(hostForUrl('[::1]')).toBe('[::1]');
    expect(hostForUrl('ismaeloul-ace-player-neo_acestream_1')).toBe(
      'ismaeloul-ace-player-neo_acestream_1',
    );
  });
});
