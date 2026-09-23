/* Todo sale de la propia app (B-235, B-272): ni React, ni hls.js, ni
   mpegts.js, ni las tipografías vienen de un CDN. El Umbrel reproduce sin
   internet y la primera pantalla no espera a nadie de fuera. El build lo
   empaqueta Vite; aquí se vigila que nadie cuele una dependencia remota. */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(WEB, 'src');

describe('autoalojada (B-235, B-272)', () => {
  it('index.html no pide scripts, hojas ni fuentes a otro sitio', () => {
    const html = readFileSync(path.join(WEB, 'index.html'), 'utf8');
    const remote = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1] as string)
      .filter((url) => /^(?:https?:)?\/\//i.test(url));
    expect(remote).toEqual([]);
  });

  it('hls.js, mpegts.js y las fuentes son dependencias del paquete, no URLs', () => {
    const pkg = JSON.parse(readFileSync(path.join(WEB, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    for (const name of [
      'hls.js',
      'mpegts.js',
      'react',
      'react-dom',
      '@fontsource-variable/mona-sans',
      '@fontsource-variable/martian-mono',
    ])
      expect(pkg.dependencies[name], name).toMatch(/^\d/);
    const fonts = readFileSync(path.join(SRC, 'styles', 'fonts.css'), 'utf8');
    const urls = [...fonts.matchAll(/url\(\s*['"]?([^'")]+)/g)].map((match) => match[1] as string);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(/node_modules\/@fontsource-variable\//);
  });

  it('ningún fichero de src/ importa ni carga código de una URL remota', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(SRC, { recursive: true })) {
      const name = String(file).replace(/\\/g, '/');
      if (!/\.(tsx?|css)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
      const text = readFileSync(path.join(SRC, name), 'utf8');
      if (/\bimport\s*(?:\(|[^;]*?from\s*)\s*['"](?:https?:)?\/\//.test(text)) offenders.push(name);
      if (/@import\s+(?:url\()?['"]?(?:https?:)?\/\//.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
