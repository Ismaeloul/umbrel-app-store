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
