// La lista blanca del proxy de «Ver juntos» (deploy/umbrel/Caddyfile,
// docs/ver-juntos.md §9) frente a la tabla de rutas v1: toda ruta con la
// credencial de la sala tiene que pasar por @sala (si no, al invitado de fuera
// le da 404, como le pasó al cartel en la 1.1.1) y ninguna de casa (crear,
// cerrar, la lista de salas, el catálogo) puede colarse. Sin Caddy: las
// expresiones se leen del fichero y se prueban con RegExp (RE2 y JS casan
// igual en lo que usan).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  V1_ROUTES,
  V1_ROUTE_IDS,
  type V1RouteDefinition,
  type V1RouteId,
} from '../../packages/shared/src/routes.js';
import { readText, UMBREL_DIR } from './helpers.js';

const CADDYFILE = readText(path.join(UMBREL_DIR, 'Caddyfile'));

/** La expresión de un `@nombre path_regexp …` (el test falla si no está). */
function pathRegexp(name: string): RegExp {
  const line = new RegExp(`^\\s*@${name}\\s+path_regexp\\s+(\\S+)\\s*$`, 'm').exec(CADDYFILE);
  if (!line?.[1]) throw new Error(`el Caddyfile no tiene @${name} path_regexp`);
  return new RegExp(line[1]);
}

/** Los patrones de un `@nombre path …` (con `*` al final, como Caddy). */
function pathList(name: string): string[] {
  const line = new RegExp(`^\\s*@${name}\\s+path\\s+(.+)$`, 'm').exec(CADDYFILE);
  if (!line?.[1]) throw new Error(`el Caddyfile no tiene @${name} path`);
  return line[1].trim().split(/\s+/);
}

const SALA = pathRegexp('sala');
const PAGINA = pathRegexp('pagina');
const ESTATICOS = pathList('estaticos');

function staticMatch(pathname: string): boolean {
  return ESTATICOS.some((pattern) =>
    pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern,
  );
}

/** ¿Llega al servidor o a un fichero desde fuera? (lo que no, da 404). */
function guestAllowed(url: string): boolean {
  const pathname = new URL(url, 'https://sala.example').pathname;
  return SALA.test(pathname) || PAGINA.test(pathname) || staticMatch(pathname);
}

const CODE = 'k3J9xQ2mZpL8wR4t';
/* Valores con forma válida para cada `:param` (los mismos que security.test.ts). */
const PARAM_VALUES: Record<string, string> = {
  code: CODE,
  key: 'k'.repeat(32),
  file: 'index.m3u8',
  artId: 'a'.repeat(40),
  id: 'a'.repeat(40),
  art: 'poster',
};

function concretePath(route: V1RouteDefinition): string {
  return route.path.replace(/:([A-Za-z]+)/g, (_all, name: string) => {
    const value = PARAM_VALUES[name];
    if (!value && route.credential === 'party') {
      throw new Error(`falta un valor de prueba para :${name} (${route.path})`);
    }
    /* Las de casa solo se miran para que no pasen: cualquier valor sirve. */
    return value ?? 'p1';
  });
}

const ROUTES = V1_ROUTE_IDS.map((id) => [id, V1_ROUTES[id] as V1RouteDefinition] as const);

describe('Caddyfile de «Ver juntos»: la lista blanca', () => {
  it('tiene las tres listas (@sala, @pagina y @estaticos)', () => {
    expect(SALA).toBeInstanceOf(RegExp);
    expect(PAGINA).toBeInstanceOf(RegExp);
    expect(ESTATICOS).toContain('/invitado.html');
  });

  it('toda ruta con la credencial de la sala casa con @sala (el cartel, `partyArt`, también)', () => {
    const party = ROUTES.filter(([, route]) => route.credential === 'party');
    expect(party.map(([id]) => id)).toContain('partyArt');
    const missing = party
      .filter(([, route]) => !SALA.test(concretePath(route)))
      .map(([id, route]) => `${id} ${concretePath(route)}`);
    expect(missing).toEqual([]);
  });

  it('ni crear, ni cerrar, ni terminar, ni la lista de salas, ni el catálogo', () => {
    const closed: V1RouteId[] = ['partyCreate', 'partyClose', 'partyEnd', 'partyList', 'vodArt'];
    for (const id of closed) {
      const url = concretePath(V1_ROUTES[id] as V1RouteDefinition);
      expect({ id, pasa: SALA.test(url) || guestAllowed(url) }).toEqual({ id, pasa: false });
    }
    /* Ninguna ruta de casa (credencial de dispositivo o sin ella) pasa por la sala. */
    const leaks = ROUTES.filter(
      ([, route]) => route.credential !== 'party' && SALA.test(concretePath(route)),
    ).map(([id]) => id);
    expect(leaks).toEqual([]);
  });

  it('el cartel: 40 hex en minúscula y nada más (la ?v= va en la query)', () => {
    const base = `/api/v1/party/${CODE}/art/`;
    expect(guestAllowed(`${base}${'0123456789abcdef'.repeat(2)}01234567?v=abc`)).toBe(true);
    expect(SALA.test(`${base}${'A'.repeat(40)}`)).toBe(false);
    expect(SALA.test(`${base}${'a'.repeat(39)}`)).toBe(false);
    expect(SALA.test(`${base}${'a'.repeat(40)}/poster`)).toBe(false);
  });

  it('la página: /s/<código> sale sin caché, con la cabecera antes del rewrite', () => {
    expect(PAGINA.test(`/s/${CODE}`)).toBe(true);
    expect(PAGINA.test(`/s/${CODE}/`)).toBe(true);
    const header = CADDYFILE.indexOf('header @pagina Cache-Control no-cache');
    const rewrite = CADDYFILE.indexOf('rewrite @pagina /invitado.html');
    expect(header).toBeGreaterThan(-1);
    expect(rewrite).toBeGreaterThan(header);
  });
});
