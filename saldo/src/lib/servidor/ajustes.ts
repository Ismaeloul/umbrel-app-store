import type { DatabaseSync } from 'node:sqlite';
import { config } from './config';

// Lo que se puede tocar desde la app sin reiniciar nada ni editar ficheros.
// Las variables de entorno siguen valiendo: son el valor por defecto, y lo que
// guardes aqui manda sobre ellas. Asi la app instalada en el Umbrel se
// configura desde su propia pantalla, que es lo comodo.

export interface Correo {
  servidor: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  clave: string;
  de: string;
  para: string;
}

export interface Preferencias {
  correo: Correo;
  avisoDias: number;
  avisoPruebaDias: number;
  /** Cada cuantos dias repetir el aviso de poco saldo. 1 = todos los dias. */
  recordarCada: number;
}

/** Lo que se guarda en la tabla. La clave es texto plano, sin anidar. */
type Clave =
  | 'correo.servidor'
  | 'correo.puerto'
  | 'correo.seguro'
  | 'correo.usuario'
  | 'correo.clave'
  | 'correo.de'
  | 'correo.para'
  | 'avisoDias'
  | 'avisoPruebaDias'
  | 'recordarCada';

function leer(conn: DatabaseSync, clave: Clave): string | null {
  const fila = conn.prepare('SELECT valor FROM ajustes WHERE clave = ?').get(clave) as
    | { valor: string }
    | undefined;
  return fila?.valor ?? null;
}

function escribir(conn: DatabaseSync, clave: Clave, valor: string): void {
  conn
    .prepare('INSERT OR REPLACE INTO ajustes (clave, valor) VALUES (?, ?)')
    .run(clave, valor);
}

export function preferencias(conn: DatabaseSync): Preferencias {
  const texto = (c: Clave, porDefecto: string) => leer(conn, c) ?? porDefecto;
  const numero = (c: Clave, porDefecto: number) => {
    const v = Number(leer(conn, c));
    return Number.isFinite(v) && leer(conn, c) !== null ? v : porDefecto;
  };

  return {
    correo: {
      servidor: texto('correo.servidor', config.correo.servidor),
      puerto: numero('correo.puerto', config.correo.puerto),
      seguro: (leer(conn, 'correo.seguro') ?? (config.correo.seguro ? '1' : '0')) === '1',
      usuario: texto('correo.usuario', config.correo.usuario),
      clave: texto('correo.clave', config.correo.clave),
      de: texto('correo.de', config.correo.de),
      para: texto('correo.para', config.correo.para)
    },
    avisoDias: numero('avisoDias', config.avisoDias),
    avisoPruebaDias: numero('avisoPruebaDias', config.avisoPruebaDias),
    // Nunca menos de un dia: si no, cada reinicio de la app seria un correo.
    recordarCada: Math.max(1, numero('recordarCada', config.recordarCada))
  };
}

/**
 * Guarda lo que venga del formulario. La clave del correo es la unica que se
 * puede omitir: si no la mandas, se queda la que ya hubiera. Asi el formulario
 * nunca tiene que devolverla a la pantalla para volver a guardarla.
 */
export function guardarPreferencias(
  conn: DatabaseSync,
  datos: Partial<Omit<Correo, 'clave'>> & {
    clave?: string;
    avisoDias?: number;
    avisoPruebaDias?: number;
    recordarCada?: number;
  }
): void {
  if (datos.servidor !== undefined) escribir(conn, 'correo.servidor', datos.servidor.trim());
  if (datos.puerto !== undefined) escribir(conn, 'correo.puerto', String(datos.puerto));
  if (datos.seguro !== undefined) escribir(conn, 'correo.seguro', datos.seguro ? '1' : '0');
  if (datos.usuario !== undefined) escribir(conn, 'correo.usuario', datos.usuario.trim());
  if (datos.de !== undefined) escribir(conn, 'correo.de', datos.de.trim());
  if (datos.para !== undefined) escribir(conn, 'correo.para', datos.para.trim());
  if (datos.clave !== undefined && datos.clave !== '') escribir(conn, 'correo.clave', datos.clave);
  if (datos.avisoDias !== undefined) escribir(conn, 'avisoDias', String(datos.avisoDias));
  if (datos.avisoPruebaDias !== undefined)
    escribir(conn, 'avisoPruebaDias', String(datos.avisoPruebaDias));
  if (datos.recordarCada !== undefined)
    escribir(conn, 'recordarCada', String(Math.max(1, datos.recordarCada)));
}

export function olvidarClave(conn: DatabaseSync): void {
  conn.prepare("DELETE FROM ajustes WHERE clave = 'correo.clave'").run();
}

/** Solo se manda correo si hay servidor y destinatario. */
export function correoConfigurado(p: Preferencias): boolean {
  return p.correo.servidor !== '' && p.correo.para !== '';
}

