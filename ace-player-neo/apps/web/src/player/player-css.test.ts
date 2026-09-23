/* Reglas de player.css que deciden comportamiento (jsdom no aplica CSS; la
   medida en Chrome, 16:9 exacto en móvil y escritorio, está en
   docs/verificacion-web.md). */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'player.css'),
  'utf8',
);

function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return CSS.slice(start, CSS.indexOf('}', start));
}

describe('player.css', () => {
  it('el vídeo en grande va en un marco 16:9 (B-067) que solo se suelta a pantalla completa', () => {
    expect(block(".player[data-presentation='stage'] .player-frame")).toMatch(
      /aspect-ratio:\s*16\s*\/\s*9/,
    );
    expect(
      block(".player[data-presentation='stage'][data-immersive='true'] .player-frame"),
    ).toMatch(/aspect-ratio:\s*auto/);
  });

  it('en el móvil el vídeo baja la zona segura (muesca, B-256)', () => {
    expect(block(".player[data-presentation='stage']")).toMatch(/padding-top:\s*var\(--safe-top\)/);
  });

  it('sin rayas ni texturas encima del vídeo (B-257)', () => {
    expect(CSS).not.toMatch(/repeating-(linear|radial)-gradient/);
  });
});
