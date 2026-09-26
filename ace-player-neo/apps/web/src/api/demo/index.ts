/* Modo demo: contesta /api/v1 sin red (inventario §22). Solo se descarga
   cuando la app decide que está en demo (import() desde client.ts).

   - Las respuestas salen de packages/shared/fixtures/v1/<ruta>.json, los
     mismos ejemplos que valida el test de contrato de @ace/shared, así que
     tienen la forma exacta de la API.
   - Lo que el usuario cambia (favoritos, preferencias, ajustes, dispositivos)
     se guarda en localStorage['aceneo-demo-v2'] y sobrevive a recargar.
   - La agenda y los marcadores se mueven a HOY (las fechas del ejemplo son
     del 23-sep-2026) para que la demo nunca salga vacía.
   - Sincronizar, activar y borrar directorios no funcionan en demo (igual que
     en la 0.6.59): dan el error `demo_unsupported`.
   - IPTV (docs/iptv.md §1.6): `iptvGet` enseña una «IPTV de ejemplo»
     (Xtream, 812 canales, guía con 640, activa) y el bootstrap la da por
     activa (`features.iptv`); guardar, actualizar, pausar y eliminar dan
     `demo_unsupported`, como los directorios.
   - Una vista puede afinar cualquier respuesta con registerDemoHandler. */

import type {
  BootstrapResponse,
  Device,
  DevicesListResponse,
  IptvView,
  LibraryMutationBody,
  LibraryView,
  Preferences,
  PreferencesResponse,
  SettingsResponse,
} from '@ace/shared';
import { readJson, STORAGE_KEYS, writeJson } from '../../lib/storage.ts';
import { registeredDemoHandler, type DemoRequest } from '../demo-registry.ts';
import { ApiError } from '../errors.ts';
import type { ApiResponse, JsonRouteId } from '../routes.ts';

const FIXTURES = import.meta.glob<unknown>('@fixtures/v1/*.json', {
  eager: true,
  import: 'default',
});

function fixture<T>(id: string): T {
  const entry = Object.entries(FIXTURES).find(([file]) => file.endsWith(`/${id}.json`));
  if (!entry) throw new ApiError({ code: 'not_found', route: id });
  // Copia profunda: nadie debe poder cambiar el ejemplo original.
  return structuredClone(entry[1]) as T;
}

// ---- Estado guardado ---------------------------------------------------------

interface DemoState {
  version: 1;
  library: LibraryView;
  preferences: Preferences;
  settings: SettingsResponse['settings'];
  devices: Device[];
}

function isDemoState(value: unknown): value is DemoState {
  return (
    typeof value === 'object' && value !== null && (value as { version?: unknown }).version === 1
  );
}

let state: DemoState | null = null;

function load(): DemoState {
  if (state) return state;
  const saved = readJson(STORAGE_KEYS.demo, isDemoState);
  state = saved ?? {
    version: 1,
    library: fixture<LibraryView>('libraryGet'),
    preferences: fixture<PreferencesResponse>('preferencesGet').preferences,
    settings: fixture<SettingsResponse>('settingsGet').settings,
    devices: fixture<DevicesListResponse>('devicesList').devices,
  };
  return state;
}

function save(): void {
  if (state) writeJson(STORAGE_KEYS.demo, state);
}

/** Solo para los tests. */
export function resetDemoState(): void {
  state = null;
}

// ---- Fechas del ejemplo movidas a hoy -----------------------------------------

const FIXTURE_DAY = '2026-09-23';
const DAY_MS = 86_400_000;

function madridToday(now: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Mueve todas las fechas (texto y epoch en `start`) los días que separan el ejemplo de hoy. */
export function shiftToToday<T>(value: T, now = Date.now()): T {
  const offset = Math.round(
    (Date.parse(`${madridToday(now)}T12:00:00Z`) - Date.parse(`${FIXTURE_DAY}T12:00:00Z`)) / DAY_MS,
  );
  if (offset === 0) return value;
  const shiftText = (text: string) =>
    text.replace(/\d{4}-\d{2}-\d{2}/g, (day) => addDays(day, offset));
  const walk = (node: unknown, key?: string): unknown => {
    if (typeof node === 'string') return shiftText(node);
    if (typeof node === 'number' && (key === 'start' || key === 'serverTime'))
      return node + offset * DAY_MS;
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [shiftText(k), walk(v, k)]));
    }
    return node;
  };
  return walk(value) as T;
}

// ---- Respuestas ---------------------------------------------------------------

function itemFrom(
  input: { id: string; title?: string; category?: string },
  type: 'fav' | 'recent',
) {
  return {
    id: input.id.toLowerCase(),
    title: input.title ?? 'Canal sin nombre',
    type,
    category: input.category ?? 'Sin categoría',
    date: new Date().toISOString(),
    fromWebSync: false,
    ih: false,
  } as LibraryView['favorites'][number];
}

function mutateLibrary(body: LibraryMutationBody): LibraryView {
  const current = load();
  const library = current.library;
  switch (body.action) {
    case 'favorite-upsert':
      library.favorites = [
        itemFrom(body.item, 'fav'),
        ...library.favorites.filter((i) => i.id !== body.item.id.toLowerCase()),
      ];
      break;
    case 'history-upsert':
      library.history = [
        itemFrom(body.item, 'recent'),
        ...library.history.filter((i) => i.id !== body.item.id.toLowerCase()),
      ].slice(0, 30);
      break;
    case 'rename': {
      const list =
        body.collection === 'favorites'
          ? library.favorites
          : body.collection === 'history'
            ? library.history
            : library.web;
      for (const item of list) if (item.id === body.id.toLowerCase()) item.title = body.title;
      break;
    }
    case 'delete':
      if (body.collection === 'favorites')
        library.favorites = library.favorites.filter((i) => i.id !== body.id.toLowerCase());
      else if (body.collection === 'history')
        library.history = library.history.filter((i) => i.id !== body.id.toLowerCase());
      else library.web = library.web.filter((i) => i.id !== body.id.toLowerCase());
      break;
  }
  save();
  return structuredClone(library);
}

const UNSUPPORTED: ReadonlySet<JsonRouteId> = new Set([
  'directoriesSync',
  'directoriesActivate',
  'directoriesDelete',
  'iptvSave',
  'iptvUpdate',
  'iptvSync',
  'iptvDelete',
]);

/** La IPTV de la demo (§1.6): la de demo-5 («Casa» en sus carteles) se llama aquí «IPTV de ejemplo». */
export function demoIptvView(now = Date.now()): IptvView {
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
  return {
    provider: {
      kind: 'xtream',
      name: 'IPTV de ejemplo',
      enabled: true,
      host: 'proveedor.example:8080',
      origin: 'http://proveedor.example:8080',
      hasUrl: false,
      hasUsername: true,
      hasPassword: true,
      status: 'ok',
      channels: 812,
      updatedAt: hoursAgo(2),
      error: null,
      staleSince: null,
      account: {
        status: 'active',
        expiresAt: new Date(now + 68 * DAY_MS).toISOString(),
        maxConnections: 1,
        activeConnections: 0,
        ours: 0,
      },
      guide: { available: true, channelsWithGuide: 640, updatedAt: hoursAgo(5), failedAt: null },
    },
    refreshHours: 6,
  };
}

export async function handleDemo<Id extends JsonRouteId>(
  id: Id,
  request: DemoRequest<Id>,
): Promise<ApiResponse<Id>> {
  const custom = registeredDemoHandler(id);
  if (custom) return custom(request);
  if (UNSUPPORTED.has(id)) throw new ApiError({ code: 'demo_unsupported', status: 409, route: id });

  const current = load();
  let result: unknown;
  switch (id) {
    case 'bootstrap': {
      const base = fixture<BootstrapResponse>('bootstrap');
      result = {
        ...base,
        origin: 'web',
        device: null,
        serverTime: Date.now(),
        library: structuredClone(current.library),
        preferences: structuredClone(current.preferences),
        settings: structuredClone(current.settings),
        features: { ...base.features, demoSchedule: true, iptv: true },
      } satisfies BootstrapResponse;
      break;
    }
    case 'iptvGet':
      result = demoIptvView();
      break;
    case 'libraryGet':
      result = structuredClone(current.library);
      break;
    case 'libraryMutate':
      result = mutateLibrary(request.body as unknown as LibraryMutationBody);
      break;
    case 'preferencesGet':
      result = { preferences: structuredClone(current.preferences) };
      break;
    case 'preferencesUpdate':
      current.preferences = {
        ...current.preferences,
        ...(request.body as unknown as Partial<Preferences>),
      };
      save();
      result = { preferences: structuredClone(current.preferences) };
      break;
    case 'settingsGet':
      result = { settings: structuredClone(current.settings), source: 'saved' };
      break;
    case 'settingsUpdate':
      current.settings = {
        ...current.settings,
        ...(request.body as unknown as Partial<SettingsResponse['settings']>),
      };
      save();
      result = { settings: structuredClone(current.settings), source: 'saved' };
      break;
    case 'devicesList':
      result = { devices: structuredClone(current.devices) };
      break;
    case 'deviceRevoke': {
      const deviceId = (request.params as unknown as { id: string }).id;
      const device = current.devices.find((d) => d.id === deviceId);
      if (!device) throw new ApiError({ code: 'not_found', status: 404, route: id });
      device.revokedAt = new Date().toISOString();
      save();
      result = { device: structuredClone(device) };
      break;
    }
    case 'pairingCreate': {
      const base = fixture<{ ttlMs: number }>('pairingCreate');
      result = { ...base, expiresAt: new Date(Date.now() + base.ttlMs).toISOString() };
      break;
    }
    case 'footballSchedule':
    case 'scores':
    case 'footballPreheat':
      result = shiftToToday(fixture(id));
      break;
    default:
      result = fixture(id);
  }
  // Un pelín de espera para que se vean los esqueletos y las transiciones.
  await new Promise((resolve) => setTimeout(resolve, 120));
  return result as ApiResponse<Id>;
}
