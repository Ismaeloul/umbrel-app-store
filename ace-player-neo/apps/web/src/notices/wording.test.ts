/* B-268 (CL-245 de la 0.6.58): los avisos hablan de la señal, no de buffers
   ni de infohashes. Se leen todos los textos que la web pasa a notify() y a
   toast() (y los de la línea de estado del reproductor) directamente del
   código, así que un aviso nuevo con esas palabras hace fallar este test. */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JERGA = /\b(buffer|búfer|infohash|stash|mpegts|hls\.js)\b/i;

/** Rutas relativas a src/ del código de la app (sin tests). */
function ficheros(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).filter(
    (file) => /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file) && !/\.d\.ts$/.test(file),
  );
}

/**
 * Los textos de cada llamada notify(...)/toast(...) (también `this.notify`):
 * todos los literales de la llamada entera, así entran los de un ternario
 * (`notify(ok ? 'A' : 'B', …)`) y los trozos fijos de una plantilla.
 */
function avisos(codigo: string): string[] {
  const out: string[] = [];
  const inicio = /\b(?:notify|toast)\(/g;
  for (let m = inicio.exec(codigo); m; m = inicio.exec(codigo)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < codigo.length && depth > 0; i++) {
      const c = codigo[i];
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        while (j < codigo.length && codigo[j] !== c) j += codigo[j] === '\\' ? 2 : 1;
        // Solo el texto fijo de una plantilla: fuera lo que va entre ${…}.
        const literal = codigo.slice(i + 1, j).replace(/\$\{[^}]*\}/g, '…');
        if (/[a-záéíóúñ]{3}/i.test(literal)) out.push(literal);
        i = j;
      } else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
  }
  return out;
}

describe('avisos en lenguaje de la señal (B-268)', () => {
  const todos = ficheros(SRC).flatMap((file) =>
    avisos(readFileSync(path.join(SRC, file), 'utf8')).map((texto) => ({ file, texto })),
  );

  it('se encuentran los avisos de la app (el lector no se ha quedado ciego)', () => {
    expect(todos.length).toBeGreaterThan(80);
    expect(
      todos.some((a) => a.texto === 'Fuente apartada; el segundo motor ya la está comprobando'),
    ).toBe(true);
  });

  it('ninguno habla de buffers, infohashes ni de las librerías de vídeo', () => {
    expect(todos.filter((a) => JERGA.test(a.texto))).toEqual([]);
  });

  it('tampoco la línea de estado ni el panel del reproductor', () => {
    const status = readFileSync(path.join(SRC, 'player', 'status.ts'), 'utf8');
    // Las frases (con espacios) entre comillas simples: las de `text:`, `title:` y sus `??`.
    const textos = [...status.matchAll(/'([^'\n]*\s[^'\n]*)'/g)].map((m) => m[1] ?? '');
    expect(textos.length).toBeGreaterThan(10);
    expect(textos.filter((t) => JERGA.test(t))).toEqual([]);
  });
});
