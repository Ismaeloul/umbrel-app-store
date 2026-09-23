/* Movimiento solo con transform y opacity (sistema.md §Movimiento; revisión
   visual de la Fase 2, docs/accesibilidad.md). Animar width, height, top,
   margin… obliga al navegador a recalcular la maquetación en cada fotograma
   (tirones en el móvil); transform y opacity van en el compositor.

   jsdom no pinta, así que se leen TODAS las hojas de src/: cada `transition`
   (o `transition-property`) y cada `@keyframes` solo pueden tocar transform
   (y sus hermanas translate/scale/rotate) y opacity. */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Propiedades que no recalculan la maquetación. */
const COMPOSITED = new Set(['transform', 'translate', 'scale', 'rotate', 'opacity']);
/** Lo que puede ir dentro de un fotograma clave sin ser una propiedad animada. */
const KEYFRAME_TIMING = new Set(['animation-timing-function', 'offset']);

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Las propiedades que anima cada declaración `transition` / `transition-property`. */
function transitionedProperties(css: string): { line: string; props: string[] }[] {
  const out: { line: string; props: string[] }[] = [];
  const re = /(?:^|[;{\s])transition(-property)?\s*:\s*([^;}]+)/g;
  for (const match of stripComments(css).matchAll(re)) {
    const value = match[2]!.trim();
    if (value === 'none' || /^(?:inherit|initial|unset|revert)$/.test(value)) continue;
    const props = value
      // Las comas dentro de cubic-bezier(…) o var(…, …) no separan transiciones.
      .split(/,(?![^(]*\))/)
      .map((part) => part.trim().split(/\s+/)[0]!)
      .filter(Boolean);
    out.push({ line: `transition${match[1] ?? ''}: ${value}`, props });
  }
  return out;
}

/** Las propiedades de cada `@keyframes`. */
function keyframeProperties(css: string): { name: string; props: string[] }[] {
  const out: { name: string; props: string[] }[] = [];
  const text = stripComments(css);
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    let index = match.index + match[0].length;
    let depth = 1;
    while (depth > 0 && index < text.length) {
      if (text[index] === '{') depth += 1;
      else if (text[index] === '}') depth -= 1;
      index += 1;
    }
    const body = text.slice(match.index + match[0].length, index - 1);
    const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((found) => found[1]!);
    out.push({ name: match[1]!, props: [...new Set(props)] });
  }
  return out;
}

describe('movimiento solo con transform y opacity', () => {
  const files = cssFiles(SRC);

  it('encuentra las hojas de la web', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('ninguna transición anima algo que recalcule la maquetación', () => {
    const wrong: string[] = [];
    for (const file of files) {
      for (const { line, props } of transitionedProperties(readFileSync(file, 'utf8'))) {
        // Un var(--…) suelto es una duración o una curva de los tokens, no una propiedad.
        const bad = props.filter((prop) => !COMPOSITED.has(prop) && !prop.startsWith('var('));
        if (bad.length > 0) wrong.push(`${path.relative(SRC, file)}: ${line}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('ningún @keyframes anima algo que recalcule la maquetación', () => {
    const wrong: string[] = [];
    for (const file of files) {
      for (const { name, props } of keyframeProperties(readFileSync(file, 'utf8'))) {
        const bad = props.filter((prop) => !COMPOSITED.has(prop) && !KEYFRAME_TIMING.has(prop));
        if (bad.length > 0)
          wrong.push(`${path.relative(SRC, file)}: @keyframes ${name} (${bad.join(', ')})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('el detector distingue lo bueno de lo malo', () => {
    expect(transitionedProperties('.a { transition: width 200ms ease; }')[0]!.props).toEqual([
      'width',
    ]);
    expect(
      transitionedProperties(
        '.a { transition: transform 1s cubic-bezier(0.2, 0, 0, 1), opacity var(--dur, 1s); }',
      )[0]!.props,
    ).toEqual(['transform', 'opacity']);
    expect(transitionedProperties('.a { transition: none; }')).toEqual([]);
    expect(
      keyframeProperties('@keyframes x { from { top: 0 } to { top: 4px; opacity: 1 } }'),
    ).toEqual([{ name: 'x', props: ['top', 'opacity'] }]);
  });
});
