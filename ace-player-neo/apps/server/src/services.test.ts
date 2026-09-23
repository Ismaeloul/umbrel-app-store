/* Composición de servicios y reparto de rutas entre módulos. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_OPERATIONS, V1_ROUTES, V1_ROUTE_IDS, SERVER_MODULES } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { MODULE_ROUTES } from './app.js';
import { legacyOperationKey } from './core/legacy-routing.js';
import { SERVICE_ORDER, createServices } from './services.js';
import * as legacyFacade from './legacy/exports.js';
import { createTestCore } from '../test/helpers/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('createServices', () => {
  it('monta los 14 servicios sin ciclos y cada método del esqueleto dice not_implemented', () => {
    const services = createServices(createTestCore());
    expect([...SERVICE_ORDER].sort()).toEqual([...SERVER_MODULES].sort());
    for (const name of SERVICE_ORDER) {
      const service = services[name] as unknown as Record<string, () => unknown>;
      expect(() => service.cualquierMetodo?.(), name).toThrowError(
        expect.objectContaining({ code: 'not_implemented' }),
      );
    }
  });

  it('un servicio sustituido llega a los que dependen de él', () => {
    const fakeState = { marca: 'fake' } as never;
    const services = createServices(createTestCore(), { state: fakeState });
    expect(services.state).toBe(fakeState);
  });

  it('el orden de creación respeta el grafo de arquitectura §5.2 (nadie usa a uno posterior)', () => {
    const source = readFileSync(path.join(here, 'services.ts'), 'utf8');
    const created = new Map<string, number>();
    for (const [index, name] of SERVICE_ORDER.entries()) created.set(name, index);
    for (const name of SERVICE_ORDER) {
      const call = new RegExp(`const ${name} =[\\s\\S]*?;\\n`).exec(source)?.[0] ?? '';
      expect(call, name).not.toBe('');
      for (const other of SERVICE_ORDER) {
        if (other === name) continue;
        if (new RegExp(`[{ ,]${other}[,} ]`).test(call.replace(/overrides\.\w+/g, ''))) {
          expect(created.get(other), `${name} usa ${other}`).toBeLessThan(created.get(name) ?? 0);
        }
      }
    }
  });
});

describe('reparto de rutas', () => {
  it('cada operación antigua es de exactamente un módulo', () => {
    const owners = new Map<string, number>();
    for (const module of MODULE_ROUTES) {
      for (const key of module.LEGACY_ROUTES) owners.set(key, (owners.get(key) ?? 0) + 1);
    }
    const expected = LEGACY_OPERATIONS.map(legacyOperationKey).sort();
    expect([...owners.keys()].sort()).toEqual(expected);
    expect([...owners.values()].every((count) => count === 1)).toBe(true);
  });

  it('cada ruta v1 la declara el módulo que dice la tabla', () => {
    const declared = MODULE_ROUTES.flatMap((module) => [...module.V1_ROUTE_IDS]);
    expect([...declared].sort()).toEqual([...V1_ROUTE_IDS].sort());
    for (const [index, module] of MODULE_ROUTES.entries()) {
      for (const id of module.V1_ROUTE_IDS) {
        expect(V1_ROUTES[id as keyof typeof V1_ROUTES].module).toBe(SERVICE_ORDER[index]);
      }
    }
  });
});

describe('fachada de exportaciones de server.js (comportamientos-tests §3)', () => {
  it('tiene exactamente los nombres de module.exports de la 0.6.59', () => {
    const serverJs = readFileSync(
      path.resolve(here, '../../../../ismaeloul-ace-player-neo/releases/0.6.59/server.js'),
      'utf8',
    );
    const block = /module\.exports = \{([\s\S]*?)\};/.exec(serverJs)?.[1] ?? '';
    const original = [
      ...new Set(
        block
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ].sort();
    expect(original.length).toBeGreaterThan(90);
    expect(Object.keys(legacyFacade).sort()).toEqual(original);
  });

  it('lo ya portado a @ace/shared funciona; lo demás dice not_implemented', () => {
    expect(legacyFacade.channelMatchScore('DAZN', 'DAZN 1')).toBe(78);
    expect(legacyFacade.normalizeHash(`acestream://${'A'.repeat(40)}`)).toBe('a'.repeat(40));
    expect(legacyFacade.motivoDeFallo(new Error('http_429'))).toBe('http_429');
    expect(legacyFacade.RESOLUTION_EXACT_SCORE).toBe(92);
    expect(legacyFacade.STATS_NEUTRAL).toBe(0.35);
    expect(legacyFacade.STATE_BACKUP_FILE).toBe('state.json.bak');
    expect(() => legacyFacade.readState()).toThrowError(
      expect.objectContaining({ code: 'not_implemented' }),
    );
    expect(() => legacyFacade.createServer()).toThrowError(
      expect.objectContaining({ code: 'not_implemented' }),
    );
  });
});
