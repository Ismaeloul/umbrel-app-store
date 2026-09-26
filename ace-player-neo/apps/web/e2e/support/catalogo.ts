/* Catálogo de los motores falsos de las pruebas E2E y la lista M3U de mentira.

   Lo importan la pila (stack.ts, que arranca los motores con él) y los
   recorridos (que necesitan saber qué id es cada fuente). Los nombres casan
   con los canales de la agenda de demostración del backend
   (FOOTBALL_DEMO_ONLY: apps/server/src/modules/football/agenda-sources.ts),
   así el buscador del motor falso encuentra varias fuentes por partido:

   | Partido (id)                              | Canal                 | Fuentes |
   |-------------------------------------------|-----------------------|---------|
   | demo-5 Real Madrid – Manchester City      | M+ Liga de Campeones  | 3       |
   | demo-1 FC Barcelona – Juventus            | DAZN                  | 3       |
   | demo-4 Real Sociedad – Villarreal         | DAZN LaLiga           | 3       |
   | demo-3 España – Marruecos                 | La 1 HD               | 2       |

   Los ids son Content ID inventados de 40 hex que empiezan por «e2e0». */

/**
 * Segundos de vídeo que el motor principal ya tiene en caché al abrir un
 * progresivo (la ráfaga inicial, `burstSeconds` del motor falso). Por
 * defecto 15 s, la misma caché que ya da su HLS (3 segmentos de 5, 4 y 6 s),
 * y aun así por debajo del motor de verdad: 22 MB en 12 s a ~3,8 Mbit/s, unos
 * 34 s por delante del directo (docs/analisis/motor-real.md §7 y §9). El
 * valor por defecto del motor falso (2 s) es el caso malo: con
 * `E2E_CACHE_MOTOR_S=2` se mide (ttff.spec.ts). Tope 30 s (el del motor falso).
 */
export function cacheDelMotorS(): number {
  const valor = Number(process.env.E2E_CACHE_MOTOR_S ?? 15);
  return Number.isFinite(valor) ? Math.min(30, Math.max(0, Math.floor(valor))) : 15;
}

/** Content ID de 40 hex fácil de reconocer en un log: e2e0 + número. */
export function e2eId(n: number): string {
  return `e2e0${n.toString(16).padStart(36, '0')}`;
}

export interface CatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly bitrateKbps?: number;
  readonly peers?: number;
}

export const FUENTES = {
  campeones: [
    { id: e2eId(1), title: 'M+ Liga de Campeones --> ELCANO' },
    { id: e2eId(2), title: 'M+ Liga de Campeones --> NEW ERA' },
    { id: e2eId(3), title: 'M+ Liga de Campeones HD --> SPIDER' },
  ],
  dazn: [
    { id: e2eId(11), title: 'DAZN --> ELCANO' },
    { id: e2eId(12), title: 'DAZN --> NEW ERA' },
    { id: e2eId(13), title: 'DAZN HD --> SPIDER' },
  ],
  laliga: [
    { id: e2eId(21), title: 'DAZN LaLiga --> ELCANO' },
    { id: e2eId(22), title: 'DAZN LaLiga --> NEW ERA' },
    { id: e2eId(23), title: 'DAZN LaLiga HD --> SPIDER' },
  ],
  la1: [
    { id: e2eId(31), title: 'La 1 HD --> ELCANO' },
    { id: e2eId(32), title: 'La 1 HD --> NEW ERA' },
  ],
  /* Un canal suelto que también está en la IPTV falsa («ES: Antena 3 FHD»):
     iptv.spec.ts lo guarda como favorito y lo toca desde Canales. */
  generalistas: [{ id: e2eId(51), title: 'Antena 3 HD' }],
  /* Los canales de la lista M3U (también existen en el motor, para poder
     reproducirlos desde la biblioteca). */
  lista: [
    { id: e2eId(41), title: 'Canal Lista E2E Uno' },
    { id: e2eId(42), title: 'Canal Lista E2E Dos' },
    { id: e2eId(43), title: 'Canal Lista E2E Tres' },
  ],
} as const satisfies Record<string, readonly CatalogEntry[]>;

/** Partidos de la agenda de demostración que usan los recorridos. */
export const PARTIDOS = {
  campeones: { id: 'demo-5', local: 'Real Madrid', visitante: 'Manchester City' },
  dazn: { id: 'demo-1', local: 'FC Barcelona', visitante: 'Juventus' },
  laliga: { id: 'demo-4', local: 'Real Sociedad', visitante: 'Villarreal' },
  la1: { id: 'demo-3', local: 'España', visitante: 'Marruecos' },
} as const;

/** Todo el catálogo, en el formato de `createFakeEngine({ catalog })`. */
export function catalogoMotor(): CatalogEntry[] {
  return Object.values(FUENTES)
    .flat()
    .map((entry) => ({ ...entry, bitrateKbps: 2500, peers: 12 }));
}

/* La lista M3U que «descarga» el backend de pruebas. El host es de un
   dominio reservado (RFC 2606) que el filtro anti-SSRF deja pasar; el
   backend de pruebas lo resuelve a una IP pública y sirve el contenido sin
   salir a internet (backend.ts). */
export const LISTA_HOST = 'listas.ace-e2e.example';
export const LISTA_URL = `http://${LISTA_HOST}/deportes.m3u`;

export function listaM3u(): string {
  const lines = ['#EXTM3U'];
  for (const entry of FUENTES.lista) {
    lines.push(`#EXTINF:-1 group-title="E2E",${entry.title}`, `acestream://${entry.id}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Una URL privada: el filtro anti-SSRF la tiene que bloquear. */
export const LISTA_PRIVADA_URL = 'http://192.168.1.20:8080/lista.m3u';
