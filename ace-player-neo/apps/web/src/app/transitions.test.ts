import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  finishEntranceAnimations,
  playerSwapsByName,
  REPRODUCTOR_CAMBIA,
  REPRODUCTOR_FIJO,
  reproductorTransitionName,
  VISTA_CAMBIA,
  VISTA_ENTRA,
  VISTA_SALE,
} from './transitions.ts';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Los .tsx de src/ (sin pruebas), con su ruta relativa y `/`. */
function sources(): Array<{ file: string; text: string }> {
  return readdirSync(SRC, { recursive: true })
    .filter((file) => /\.tsx$/.test(file) && !/\.test\.tsx$/.test(file))
    .map((file) => ({
      file: file.replace(/\\/g, '/'),
      text: readFileSync(path.join(SRC, file), 'utf8'),
    }));
}

describe('sin elementos compartidos entre vistas (0.9.0)', () => {
  it('ninguna <ViewTransition> con nombre salvo la del reproductor', () => {
    // Abrir un partido es el mismo fundido que cambiar de pestaña: los escudos
    // que «viajaban» de la agenda a la cabecera (partido-<id>) no deben volver.
    const named = sources().flatMap(({ file, text }) =>
      [...text.matchAll(/<ViewTransition\b[^>]*?\bname=\{?([^\s>}]+)/g)].map(
        (match) => `${file}: ${match[1]}`,
      ),
    );
    expect(named).toEqual(['app/Shell.tsx: playerSwap']);
    const shell = sources().find(({ file }) => file === 'app/Shell.tsx')?.text ?? '';
    expect(shell).toContain(
      'name={playerSwap ? reproductorTransitionName(presentation) : REPRODUCTOR_FIJO}',
    );
    const all = sources()
      .map(({ text }) => text)
      .join('\n');
    expect(all).not.toMatch(/partidoTransitionName|canalTransitionName|transitionName=/);
  });

  it('en WebKit (y sin la API) el reproductor guarda su nombre fijo de siempre', () => {
    // Un elemento que solo entra recibe allí un ::view-transition-old con la
    // animación de salida y se queda pegado (fix/transicion-safari).
    const chrome = 'Google Inc.';
    const apple = 'Apple Computer, Inc.';
    expect(playerSwapsByName({ viewTransitions: true, vendor: chrome })).toBe(true);
    expect(playerSwapsByName({ viewTransitions: true, vendor: apple })).toBe(false);
    expect(playerSwapsByName({ viewTransitions: false, vendor: chrome })).toBe(false);
    expect(REPRODUCTOR_FIJO).toBe('ace-reproductor');
  });

  it('el reproductor lleva un nombre por presentación: de mini a grande no viaja', () => {
    expect(reproductorTransitionName('mini')).toBe('ace-reproductor-mini');
    expect(reproductorTransitionName('stage')).toBe('ace-reproductor-stage');
    expect(reproductorTransitionName('mini')).not.toBe(reproductorTransitionName('stage'));
    const css = rules(baseCss);
    // Sin pareja: el que se va se apaga y el que llega aparece, como las vistas.
    expect(css).toMatch(
      new RegExp(
        `::view-transition-old\\(\\.${REPRODUCTOR_CAMBIA}\\):only-child \\{[^}]*animation: ace-vt-sale var\\(--dur-rapido\\)`,
      ),
    );
    expect(css).toMatch(
      new RegExp(
        `::view-transition-new\\(\\.${REPRODUCTOR_CAMBIA}\\):only-child \\{[^}]*animation: ace-funde var\\(--dur-rapido\\)`,
      ),
    );
  });
});

/** Las reglas de una hoja de estilos, sin comentarios (Vitest no carga el CSS). */
function rules(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
}
const baseCss = '../styles/base.css';
const shellCss = './shell.css';

describe('cambio de vista', () => {
  const css = rules(baseCss);

  it('sale una vista y entra otra, cada una en su sitio (sin caja compartida)', () => {
    // La caja única «ace-vista» transformaba posición y tamaño entre vistas
    // de scroll y alto distintos (Canales): no debe volver.
    expect(css).not.toMatch(/\(ace-vista\)/);
    expect(css).toContain(`::view-transition-old(.${VISTA_SALE})`);
    expect(css).toContain(`::view-transition-new(.${VISTA_ENTRA})`);
    expect(css).toContain(
      `:active-view-transition-type(adelante)::view-transition-new(.${VISTA_ENTRA})`,
    );
    expect(css).toContain(
      `:active-view-transition-type(atras)::view-transition-new(.${VISTA_ENTRA})`,
    );
    // Los cambios internos de una vista no la animan entera; una navegación sí.
    expect(VISTA_CAMBIA.default).toBe('none');
    expect(VISTA_CAMBIA.adelante).toBe(VISTA_ENTRA);
  });

  it('con movimiento reducido, la vista que entra solo se funde', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain(`::view-transition-new(.${VISTA_ENTRA})`);
    expect(reduced).toMatch(/animation-name: ace-funde !important/);
  });

  it('las barras de navegación tienen capa propia, quieta y por encima de las vistas', () => {
    const shell = rules(shellCss);
    for (const name of ['ace-barra-superior', 'ace-barra-inferior', 'ace-velo'])
      expect(shell).toContain(`view-transition-name: ${name}`);
    expect(css).toMatch(
      /::view-transition-group\(\.ace-barra\) \{[^}]*animation: none;[^}]*z-index: 1;/,
    );
  });
});

describe('volver a una vista', () => {
  it('termina sus apariciones de entrada y deja los bucles', () => {
    const fake = (iterations: number) => ({
      effect: { getComputedTiming: () => ({ iterations }) },
      finish: vi.fn(),
    });
    const entrance = fake(1);
    const loop = fake(Infinity);
    const root = {
      getAnimations: vi.fn(() => [entrance, loop]),
    } as unknown as Element;
    finishEntranceAnimations(root);
    expect(root.getAnimations).toHaveBeenCalledWith({ subtree: true });
    expect(entrance.finish).toHaveBeenCalled();
    expect(loop.finish).not.toHaveBeenCalled();
    // Sin la API (jsdom, navegadores viejos) no hace nada.
    expect(() => finishEntranceAnimations(document.createElement('div'))).not.toThrow();
    expect(() => finishEntranceAnimations(null)).not.toThrow();
  });
});
