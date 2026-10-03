/* Reglas de base.css que dependen de la zona segura (B-256): jsdom no pinta,
   así que se lee la hoja. La comprobación visual con la muesca emulada está
   en docs/verificacion-web.md. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'base.css'),
  'utf8',
);

function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return CSS.slice(start, CSS.indexOf('}', start));
}

describe('base.css con muesca (B-256)', () => {
  it('«Saltar al contenido» se esconde del todo aunque haya zona segura arriba', () => {
    const rule = block('.skip-link');
    // Baja con la zona segura...
    expect(rule).toMatch(/top:\s*calc\(var\(--safe-top\)\s*\+\s*8px\)/);
    // ...y al esconderse sube también lo que bajó (si no, asoma bajo la barra de estado).
    expect(rule).toMatch(
      /transform:\s*translateY\(calc\(-100%\s*-\s*var\(--safe-top\)\s*-\s*\d+px\)\)/,
    );
    expect(block('.skip-link:focus-visible')).toMatch(/transform:\s*none/);
  });
});

describe('base.css: el apretón de .press (0.9.0)', () => {
  it('es la propiedad `scale`, que se suma al transform propio en vez de pisarlo', () => {
    const rule = block('.press:active:not(:disabled)');
    expect(rule).toMatch(/\bscale:\s*0\.975/);
    // Con `transform: scale()`, una flecha centrada con translate(-50%) bajaba al pulsarla.
    expect(rule).not.toMatch(/transform:/);
    expect(block('.press')).toMatch(/transition:\s*scale\b/);
  });

  it('las flechas de los carruseles se centran con `translate`, no con `transform`', () => {
    const rail = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../ui/PosterRail.css'),
      'utf8',
    );
    const start = rail.indexOf('.prail .prail__arrow {');
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = rail.slice(start, rail.indexOf('}', start));
    expect(rule).toMatch(/translate:\s*0\s+-50%/);
    expect(rule).not.toMatch(/transform:/);
  });
});
