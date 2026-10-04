/* El cartel elegido no crece ni tapa al de al lado (Isma, 0.9.0, punto 9).

   Pasaba en el build: la tesela y «En pantalla» se colocan pisando reglas de
   ui/ (`.dorsal` y `.capsule`: position: relative, ancho y alto propios) y,
   con la MISMA especificidad, ganaba la hoja que llegara la última. Si los
   trozos de ui/ llegaban después que sources.css, el dibujo y la cápsula
   volvían al flujo: la tesela crecía, perdía el 16:9 y se comía la de al lado
   (docs/capturas/pendiente/fuentes-carteles-solapados.png). Vitest no aplica
   CSS, así que se vigila la hoja: lo que coloca algo de ui/ dentro del cartel
   va con dos clases y la tesela no crece con su contenido. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(HERE, 'sources.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Las reglas (selector → cuerpo) cuyo selector nombra `name`. */
function rulesFor(name: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? '').trim();
    if (selector.split(',').some((part) => part.includes(name)))
      out.push({ selector, body: match[2] ?? '' });
  }
  return out;
}

/** Número de clases y atributos del selector (la parte que manda en la especificidad aquí). */
function classWeight(selector: string): number {
  return (selector.match(/\.[A-Za-z_-][\w-]*|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
}

describe('carteles de fuentes: geometría que no depende del orden de las hojas', () => {
  it('el dibujo del canal y «En pantalla» se colocan con más peso que .dorsal y .capsule', () => {
    for (const name of ['.src-poster__mark', '.src-poster__onair', '.src-poster__iptv']) {
      const placing = rulesFor(name).filter(({ body }) =>
        /(^|[;\s])(position|width|height|inset)\s*:/.test(body),
      );
      expect(placing.length, name).toBeGreaterThan(0);
      for (const { selector, body } of placing) {
        expect(classWeight(selector), `${selector} { ${body.trim()} }`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('la tesela es 16:9 siempre: no crece con lo de dentro ni se estira con la fila', () => {
    const tile = rulesFor('.src-poster__tile').find(
      ({ selector }) => selector === '.src-poster__tile',
    );
    expect(tile?.body).toMatch(/aspect-ratio:\s*16 \/ 9/);
    expect(tile?.body).toMatch(/min-height:\s*0/);
    expect(tile?.body).toMatch(/align-self:\s*start/);
  });

  it('cada cartel cabe en su celda y el filo más gordo no se corta en el borde', () => {
    const poster = rulesFor('.src-poster').find(({ selector }) => selector === '.src-poster');
    expect(poster?.body).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    const rows = rulesFor('.src-list__rows').find(({ selector }) => selector === '.src-list__rows');
    const room = Number(rows?.body.match(/--ring-room:\s*(\d+)px/)?.[1] ?? 0);
    // Filo de «En pantalla» (3 px) + su separación (outline-offset 2 px).
    expect(room).toBeGreaterThanOrEqual(3 + 2);
    expect(rows?.body).toMatch(/padding:\s*var\(--ring-room\) var\(--ring-room\) 0/);
    // El elegido solo cambia el filo: nada de escalas.
    for (const { selector, body } of rulesFor('is-onscreen'))
      expect(body, selector).not.toMatch(/scale|zoom|transform/);
  });
});
