/* Guarda contra un fallo que solo se ve en producción.

   package.json declara `sideEffects` (solo el CSS, main.tsx y los demo.ts)
   para que importar de un barril como src/ui/index.ts no arrastre todos los
   componentes. La otra cara: un fichero importado SOLO por sus efectos
   (`import './demo.ts';`, que registra respuestas de la demo) desaparece del
   build si no casa con esa lista. En desarrollo funciona y en producción no:
   pasó con la demo de la agenda (salía el ejemplo genérico de un partido en
   vez de la agenda de muestra).

   Este test busca en src/ cada `import '…';` sin nombres y exige que el
   fichero importado case con algún patrón de `sideEffects`. */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(WEB, 'src');

/** Glob de package.json → expresión regular sobre rutas `./src/...` con `/`. */
function globToRegExp(glob: string): RegExp {
  const normalized = glob.startsWith('./') || glob.startsWith('**') ? glob : `./${glob}`;
  let out = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i] as string;
    if (char === '*' && normalized[i + 1] === '*') {
      // `**/` = cero o más carpetas.
      out += normalized[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += normalized[i + 2] === '/' ? 2 : 1;
    } else if (char === '*') out += '[^/]*';
    else out += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${normalized.startsWith('**') ? '(?:\\./)?' : ''}${out}$`);
}

const BARE_IMPORT = /^\s*import\s+['"](\.[^'"]+)['"];?\s*$/gm;

describe('sideEffects de package.json', () => {
  it('los patrones se leen como los lee el empaquetador', () => {
    expect(globToRegExp('**/*.css').test('./src/ui/Button.css')).toBe(true);
    expect(globToRegExp('./src/**/demo.ts').test('./src/features/agenda/demo.ts')).toBe(true);
    expect(globToRegExp('./src/**/demo.ts').test('./src/features/agenda/data.ts')).toBe(false);
    expect(globToRegExp('./src/main.tsx').test('./src/main.tsx')).toBe(true);
  });

  it('todo fichero importado solo por sus efectos está en la lista (si no, el build lo quita)', () => {
    const pkg = JSON.parse(readFileSync(path.join(WEB, 'package.json'), 'utf8')) as {
      sideEffects?: string[] | boolean;
    };
    // `sideEffects: true` o ausente: el empaquetador no quita nada y no hay riesgo.
    if (!Array.isArray(pkg.sideEffects)) return;
    const patterns = pkg.sideEffects.map(globToRegExp);
    const missing: string[] = [];
    const files = readdirSync(SRC, { recursive: true }).filter(
      (file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file),
    );
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const full = path.join(SRC, file);
      const code = readFileSync(full, 'utf8');
      for (const match of code.matchAll(BARE_IMPORT)) {
        const spec = match[1] as string;
        const target = path.resolve(path.dirname(full), spec);
        const relative = `./${path
          .join('src', target.slice(SRC.length + 1))
          .split('\\')
          .join('/')}`;
        if (!patterns.some((re) => re.test(relative)))
          missing.push(`${file.split('\\').join('/')} → ${spec}`);
      }
    }
    expect(missing, 'Añádelos a "sideEffects" de apps/web/package.json').toEqual([]);
  });
});
