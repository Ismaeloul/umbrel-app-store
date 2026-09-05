import { env } from '$env/dynamic/private';

function texto(clave: string, porDefecto: string): string {
  const v = env[clave];
  return v === undefined || v === '' ? porDefecto : v;
}

function numero(clave: string, porDefecto: number): number {
  const v = Number(env[clave]);
  return Number.isFinite(v) ? v : porDefecto;
}

function bandera(clave: string, porDefecto: boolean): boolean {
  const v = env[clave];
  if (v === undefined || v === '') return porDefecto;
  return v !== '0' && v.toLowerCase() !== 'false';
}

export const config = {
  /** Donde vive saldo.db. Es lo unico que hay que respaldar. */
  datos: texto('SALDO_DATA_DIR', './data'),
  /** Huso con el que se decide que dia es «hoy». */
  zona: texto('TZ', 'Europe/Madrid'),
  /** Hora local a la que corre la tarea diaria. */
  horaTarea: numero('SALDO_HORA_TAREA', 3),
  /** A 0 se apagan la tarea diaria y la materializacion de arranque. */
  tareasDeFondo: bandera('SALDO_TAREAS_DE_FONDO', true),
  // Lo de aqui abajo es solo el valor POR DEFECTO: lo que guardes en la
  // pantalla de ajustes manda sobre estas variables. Ver `ajustes.ts`.

  /** Avisa cuando a una cuenta le quedan estos dias o menos. */
  avisoDias: numero('SALDO_AVISO_DIAS', 30),
  /** Avisa cuando una prueba gratuita pasa a cobro dentro de estos dias. */
  avisoPruebaDias: numero('SALDO_AVISO_PRUEBA_DIAS', 7),
  /** Cada cuantos dias insistir con el aviso de poco saldo. 1 = todos los dias. */
  recordarCada: numero('SALDO_RECORDAR_CADA', 1),

  correo: {
    servidor: texto('SALDO_SMTP_HOST', ''),
    puerto: numero('SALDO_SMTP_PUERTO', 587),
    seguro: bandera('SALDO_SMTP_SEGURO', false),
    usuario: texto('SALDO_SMTP_USUARIO', ''),
    // Contrasena de aplicacion, nunca la de la cuenta.
    clave: texto('SALDO_SMTP_CLAVE', ''),
    de: texto('SALDO_CORREO_DE', ''),
    para: texto('SALDO_CORREO_PARA', '')
  }
};
