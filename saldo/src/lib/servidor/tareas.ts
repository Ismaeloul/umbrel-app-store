import { config } from './config';
import { db } from './db';
import { hoy as diaDeHoy, horaLocal } from './reloj';
import { materializar } from './materializador';
import { marcarEnviados, revisar, sinRepetir } from './avisos';
import { correoConfigurado, preferencias } from './ajustes';
import { enviarResumen } from './correo';

// La tarea diaria: aplica los cobros vencidos y manda un correo con lo que
// haya que mirar. Corre al arrancar y una vez al dia a la hora configurada.

let ultimaVuelta: string | null = null;
let temporizador: ReturnType<typeof setInterval> | null = null;

export async function pasada(dia = diaDeHoy()): Promise<{ aplicados: number; avisados: number }> {
  const conn = db();

  // Primero los cobros: los avisos tienen que salir del estado ya al dia.
  const aplicados = materializar(conn, dia);

  const pendientes = sinRepetir(conn, revisar(conn, dia, aplicados), dia);
  let avisados = 0;

  if (pendientes.length > 0) {
    for (const aviso of pendientes) {
      console.log(`[saldo] aviso: ${aviso.titulo} — ${aviso.detalle}`);
    }

    const prefs = preferencias(conn);
    if (correoConfigurado(prefs)) {
      try {
        await enviarResumen(pendientes, prefs.correo);
        // Solo se marcan como avisados si el correo ha salido de verdad.
        marcarEnviados(conn, pendientes, dia);
        avisados = pendientes.length;
      } catch (error) {
        // Un correo caido NO puede tumbar la materializacion, que es lo que de
        // verdad no puede dejar de pasar.
        console.error('[saldo] no se pudo enviar el aviso:', error);
      }
    }
    // Sin correo configurado los avisos se quedan pendientes a proposito: el
    // dia que lo configures, saldran.
  }

  ultimaVuelta = dia;
  return { aplicados: aplicados.length, avisados };
}

export function arrancarTareas(): void {
  if (!config.tareasDeFondo || temporizador) return;

  // Al arrancar, siempre: si el NAS ha estado apagado hay cobros que aplicar.
  pasada().catch((e) => console.error('[saldo] fallo en la pasada de arranque:', e));

  // Cada media hora se mira si toca. Es mas robusto que un cron a una hora
  // exacta: si el NAS estaba apagado a las 3, la pasada sale igualmente.
  temporizador = setInterval(
    () => {
      const dia = diaDeHoy();
      if (dia !== ultimaVuelta && horaLocal() >= config.horaTarea) {
        pasada(dia).catch((e) => console.error('[saldo] fallo en la pasada diaria:', e));
      }
    },
    30 * 60 * 1000
  );
}
