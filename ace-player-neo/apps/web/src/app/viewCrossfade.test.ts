import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureLeavingView,
  CROSSFADE_MARGIN_MS,
  discardPendingCrossfade,
  ENTER_ATTR,
  GHOST_CLASS,
  parseDuration,
  playPendingCrossfade,
  removeGhosts,
  WAIT_ATTR,
  WAIT_MAX_MS,
} from './viewCrossfade.ts';

/* Las vistas como las pone el armazón: .views > .view[data-vista], la oculta
   con display:none (Activity). */
function mountViews() {
  document.body.innerHTML = `
    <main class="app-main">
      <div class="views">
        <div class="view" data-vista="buscar" data-active="true">
          <h1 id="titulo-buscar" tabindex="-1">Buscar</h1>
          <input name="q" value="dazn" />
          <input type="radio" name="filtro" value="todo" checked />
          <p class="fila" style="animation: x 1s">fila</p>
        </div>
        <div class="view" data-vista="biblioteca" data-active="false" style="display: none">
          <h1 tabindex="-1">Canales</h1>
          <input type="radio" name="filtro" value="favoritos" />
        </div>
      </div>
    </main>`;
  const view = (vista: string) =>
    document.querySelector<HTMLElement>(`.views > .view[data-vista="${vista}"]`)!;
  /** Lo que hace React al cambiar de vista: una se oculta y otra se enseña. */
  const switchTo = (vista: string) => {
    for (const v of document.querySelectorAll<HTMLElement>('.views > .view')) {
      const on = v.dataset.vista === vista;
      v.style.display = on ? '' : 'none';
    }
  };
  return { view, switchTo };
}

/** Temporizadores a mano. */
function manualTimers() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    setTimer: (fn: () => void, ms: number) => pending.push({ fn, ms }),
    pending,
    runAll: () => pending.splice(0).forEach((t) => t.fn()),
  };
}

function animationEvent(type: 'animationend' | 'animationcancel', animationName: string) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: animationName });
  return event;
}

beforeEach(() => {
  discardPendingCrossfade();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('parseDuration', () => {
  it('lee el token de duración (ms o s) y si no, el respaldo', () => {
    expect(parseDuration('340ms')).toBe(340);
    expect(parseDuration(' 0.12s ')).toBe(120);
    expect(parseDuration('')).toBe(340);
    expect(parseDuration('rápido', 200)).toBe(200);
    expect(parseDuration('-5ms')).toBe(340);
  });
});

describe('fundido cruzado sin View Transitions', () => {
  it('prepara un fantasma de la vista que sale sin enseñarlo hasta que la nueva aparece', () => {
    const { view, switchTo } = mountViews();
    const ghost = captureLeavingView('buscar', 'adelante');
    expect(ghost).not.toBeNull();
    // Aún no está en la página: React no ha confirmado la vista nueva.
    expect(document.querySelector(`.${GHOST_CLASS}`)).toBeNull();

    switchTo('biblioteca');
    const timers = manualTimers();
    const played = playPendingCrossfade('biblioteca', document, {
      durationMs: 340,
      setTimer: timers.setTimer,
    });
    expect(played).toBe(ghost);
    // Encima de la nueva: el último de .views.
    expect(view('biblioteca').parentElement!.lastElementChild).toBe(ghost);
    // La nueva entra con el sentido de la navegación.
    expect(view('biblioteca').getAttribute(ENTER_ATTR)).toBe('adelante');
    // Respaldo: aunque no corra ninguna animación, todo se recoge.
    expect(timers.pending.map((t) => t.ms)).toEqual([
      340 + CROSSFADE_MARGIN_MS,
      340 + CROSSFADE_MARGIN_MS,
    ]);
  });

  it('el fantasma es un clon inerte: ni vista, ni ids, ni nombres de formulario, ni accesible', () => {
    mountViews();
    const ghost = captureLeavingView('buscar', null)!;
    expect(ghost.className).toBe(GHOST_CLASS);
    expect(ghost.hasAttribute('data-vista')).toBe(false);
    expect(ghost.hasAttribute('data-active')).toBe(false);
    expect(ghost.querySelector('[id]')).toBeNull();
    // Un radio clonado con el mismo name desmarcaría el de verdad.
    expect(ghost.querySelector('[name]')).toBeNull();
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.inert).toBe(true);
    expect(ghost.style.position).toBe('fixed');
    expect(ghost.style.pointerEvents).toBe('');
    // Lo escrito se ve igual en el fantasma.
    expect(ghost.querySelector('input')!.value).toBe('dazn');
  });

  it('el radio de verdad sigue marcado con el fantasma en la página', () => {
    const { switchTo } = mountViews();
    captureLeavingView('buscar', null);
    switchTo('biblioteca');
    playPendingCrossfade('biblioteca', document, { durationMs: 340, setTimer: () => 0 });
    const real = document.querySelector<HTMLInputElement>(
      '.views > .view[data-vista="buscar"] input[type="radio"]',
    )!;
    expect(real.checked).toBe(true);
  });

  it('el fantasma se quita al acabar SU animación, no la de un hijo', () => {
    const { switchTo } = mountViews();
    captureLeavingView('buscar', 'atras');
    switchTo('biblioteca');
    const ghost = playPendingCrossfade('biblioteca', document, {
      durationMs: 340,
      setTimer: () => 0,
    })!;
    ghost.querySelector('.fila')!.dispatchEvent(animationEvent('animationend', 'ace-vt-sale'));
    expect(ghost.isConnected).toBe(true);
    ghost.dispatchEvent(animationEvent('animationend', 'otra'));
    expect(ghost.isConnected).toBe(true);
    ghost.dispatchEvent(animationEvent('animationend', 'ace-vt-sale'));
    expect(ghost.isConnected).toBe(false);
  });

  it('se quita también si la animación se cancela o no llega a correr (temporizador)', () => {
    const { view, switchTo } = mountViews();
    captureLeavingView('buscar', 'adelante');
    switchTo('biblioteca');
    const timers = manualTimers();
    const ghost = playPendingCrossfade('biblioteca', document, {
      durationMs: 340,
      setTimer: timers.setTimer,
    })!;
    ghost.dispatchEvent(animationEvent('animationcancel', 'ace-vt-sale'));
    expect(ghost.isConnected).toBe(false);
    expect(view('biblioteca').hasAttribute(ENTER_ATTR)).toBe(true);
    timers.runAll();
    expect(view('biblioteca').hasAttribute(ENTER_ATTR)).toBe(false);
    expect(document.querySelectorAll(`.${GHOST_CLASS}`)).toHaveLength(0);
  });

  it('un cambio nuevo a mitad del anterior quita el fantasma viejo: nunca dos', () => {
    const { switchTo } = mountViews();
    captureLeavingView('buscar', 'adelante');
    switchTo('biblioteca');
    const first = playPendingCrossfade('biblioteca', document, {
      durationMs: 340,
      setTimer: () => 0,
    })!;
    captureLeavingView('biblioteca', 'atras');
    switchTo('buscar');
    const second = playPendingCrossfade('buscar', document, {
      durationMs: 340,
      setTimer: () => 0,
    })!;
    expect(first.isConnected).toBe(false);
    expect(second.isConnected).toBe(true);
    expect(document.querySelectorAll(`.${GHOST_CLASS}`)).toHaveLength(1);
  });

  it('la entrada que se repite no la corta el aviso tardío de la anterior', () => {
    const { view, switchTo } = mountViews();
    const timers = manualTimers();
    const go = (from: string, to: string) => {
      captureLeavingView(from, 'adelante');
      switchTo(to);
      playPendingCrossfade(to, document, { durationMs: 340, setTimer: timers.setTimer });
    };
    go('buscar', 'biblioteca');
    go('biblioteca', 'buscar');
    go('buscar', 'biblioteca');
    const canales = view('biblioteca');
    // El temporizador de la primera entrada de Canales llega ahora: no borra
    // el atributo de la segunda.
    timers.pending[0]!.fn();
    expect(canales.getAttribute(ENTER_ATTR)).toBe('adelante');
    // Ni el aviso tardío de que la primera se canceló (al quitar el atributo).
    canales.dispatchEvent(animationEvent('animationcancel', 'ace-vt-entra-dcha'));
    expect(canales.getAttribute(ENTER_ATTR)).toBe('adelante');
    canales.dispatchEvent(animationEvent('animationend', 'ace-vt-entra-dcha'));
    expect(canales.hasAttribute(ENTER_ATTR)).toBe(false);
  });

  it('sin sentido (cambio instantáneo) es solo un fundido', () => {
    const { view, switchTo } = mountViews();
    captureLeavingView('buscar', null);
    switchTo('biblioteca');
    playPendingCrossfade('biblioteca', document, { durationMs: 340, setTimer: () => 0 });
    expect(view('biblioteca').getAttribute(ENTER_ATTR)).toBe('fundido');
  });

  it('nada que fundir: misma vista, sin preparar, vista oculta o duración 0', () => {
    const { switchTo } = mountViews();
    const opts = { durationMs: 340, setTimer: () => 0 };
    // Sin preparar.
    expect(playPendingCrossfade('biblioteca', document, opts)).toBeNull();
    // Se quedó en la misma vista.
    captureLeavingView('buscar', 'adelante');
    expect(playPendingCrossfade('buscar', document, opts)).toBeNull();
    // Una vista oculta no se clona.
    expect(captureLeavingView('biblioteca', 'adelante')).toBeNull();
    // Movimiento cero.
    captureLeavingView('buscar', 'adelante');
    switchTo('biblioteca');
    expect(playPendingCrossfade('biblioteca', document, { ...opts, durationMs: 0 })).toBeNull();
    // Lo preparado se usa una vez.
    expect(playPendingCrossfade('biblioteca', document, opts)).toBeNull();
    expect(removeGhosts()).toBe(0);
  });
});

describe('la vista nueva aún con su esqueleto', () => {
  it('la vieja se queda quieta encima, la nueva escondida, y funden cuando llega', async () => {
    const { view, switchTo } = mountViews();
    const timers = manualTimers();
    captureLeavingView('buscar', 'adelante');
    switchTo('biblioteca');
    const entering = view('biblioteca');
    entering.innerHTML = '<div class="view-skeleton" aria-busy="true"></div>';
    const ghost = playPendingCrossfade('biblioteca', document, {
      durationMs: 200,
      setTimer: timers.setTimer,
    });
    expect(ghost?.hasAttribute(WAIT_ATTR)).toBe(true);
    expect(entering.hasAttribute(WAIT_ATTR)).toBe(true);
    expect(entering.hasAttribute(ENTER_ATTR)).toBe(false);
    // Llega la vista: ahora sí, el fundido.
    entering.innerHTML = '<h1 tabindex="-1">Canales</h1>';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(entering.hasAttribute(WAIT_ATTR)).toBe(false);
    expect(entering.getAttribute(ENTER_ATTR)).toBe('adelante');
    const ghosts = document.querySelectorAll(`.${GHOST_CLASS}`);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.hasAttribute(WAIT_ATTR)).toBe(false);
  });

  it('si no llega a tiempo, funde igualmente (y otro cambio de vista corta la espera)', () => {
    const { view, switchTo } = mountViews();
    const timers = manualTimers();
    captureLeavingView('buscar', null);
    switchTo('biblioteca');
    view('biblioteca').innerHTML = '<div class="view-skeleton"></div>';
    playPendingCrossfade('biblioteca', document, { durationMs: 200, setTimer: timers.setTimer });
    expect(timers.pending.some((t) => t.ms === WAIT_MAX_MS)).toBe(true);
    timers.runAll();
    expect(view('biblioteca').getAttribute(ENTER_ATTR)).toBe('fundido');
    expect(view('biblioteca').hasAttribute(WAIT_ATTR)).toBe(false);
  });
});

describe('CSS del fundido', () => {
  // Por variable: con la ruta literal, Vite cambia el new URL por el del asset.
  const shellCss = './shell.css';
  const css = readFileSync(fileURLToPath(new URL(shellCss, import.meta.url)), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  it('usa los mismos fotogramas y tokens que las View Transitions de base.css', () => {
    expect(css).toMatch(
      /\.view\[data-entra\]\s*\{\s*animation: ace-funde var\(--dur-rapido\) var\(--ease-out\) both;/,
    );
    expect(css).toMatch(
      /\.view\[data-entra='adelante'\]\s*\{\s*animation-name: ace-vt-entra-dcha;/,
    );
    expect(css).toMatch(/\.view\[data-entra='atras'\]\s*\{\s*animation-name: ace-vt-entra-izda;/);
    expect(css).toMatch(
      /\.view-fantasma\s*\{[^}]*animation: ace-vt-sale var\(--dur-rapido\) var\(--ease-out\) both;/,
    );
  });
  it('con movimiento reducido, solo el fundido', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.view\[data-entra\]\s*\{\s*animation-name: ace-funde;/,
    );
  });
});
