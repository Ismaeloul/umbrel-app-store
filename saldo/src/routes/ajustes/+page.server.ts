import { fail } from '@sveltejs/kit';
import { db } from '$lib/servidor/db';
import {
  correoConfigurado,
  guardarPreferencias,
  olvidarClave,
  preferencias
} from '$lib/servidor/ajustes';
import { enviarPrueba } from '$lib/servidor/correo';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const p = preferencias(db());

  return {
    correo: {
      servidor: p.correo.servidor,
      puerto: p.correo.puerto,
      seguro: p.correo.seguro,
      usuario: p.correo.usuario,
      de: p.correo.de,
      para: p.correo.para
      // La clave NO sale de aqui: no tiene por que viajar a la pantalla.
    },
    tieneClave: p.correo.clave !== '',
    configurado: correoConfigurado(p),
    avisoDias: p.avisoDias,
    avisoPruebaDias: p.avisoPruebaDias
  };
};

function delFormulario(datos: FormData) {
  const puerto = Number(datos.get('puerto'));
  const dias = Number(datos.get('avisoDias'));
  const diasPrueba = Number(datos.get('avisoPruebaDias'));

  return {
    servidor: String(datos.get('servidor') ?? ''),
    puerto: Number.isFinite(puerto) && puerto > 0 ? puerto : 587,
    seguro: datos.get('seguro') === 'on',
    usuario: String(datos.get('usuario') ?? ''),
    // Vacia significa «deja la que ya había», no «bórrala».
    clave: String(datos.get('clave') ?? ''),
    de: String(datos.get('de') ?? ''),
    para: String(datos.get('para') ?? ''),
    avisoDias: Number.isFinite(dias) && dias > 0 ? dias : 30,
    avisoPruebaDias: Number.isFinite(diasPrueba) && diasPrueba > 0 ? diasPrueba : 7
  };
}

/** El mensaje de un fallo de SMTP, en cristiano. */
function enCristiano(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);

  if (/Invalid login|535|BadCredentials/i.test(texto))
    return 'El servidor no acepta esas credenciales. Con Gmail acuérdate de que la clave tiene que ser una contraseña de aplicación, no la de tu cuenta.';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(texto))
    return 'No se encuentra ese servidor. Revisa la dirección.';
  if (/ECONNREFUSED|ETIMEDOUT|ECONNECTION/i.test(texto))
    return 'No contesta por ese puerto. Prueba con 587 sin SSL, o 465 con SSL.';
  if (/self.signed|certificate/i.test(texto))
    return 'El certificado del servidor no cuadra con la opción de SSL marcada.';

  return `El servidor de correo ha dicho: ${texto}`;
}

export const actions: Actions = {
  guardar: async ({ request }) => {
    guardarPreferencias(db(), delFormulario(await request.formData()));
    return { hecho: 'Ajustes guardados.' };
  },

  probar: async ({ request }) => {
    const conn = db();
    guardarPreferencias(conn, delFormulario(await request.formData()));

    const p = preferencias(conn);
    if (!correoConfigurado(p))
      return fail(400, { error: 'Faltan el servidor y la dirección a la que avisarte.' });

    try {
      await enviarPrueba(p.correo);
    } catch (error) {
      return fail(400, { error: enCristiano(error) });
    }
    return { hecho: `Correo de prueba enviado a ${p.correo.para}. Mira tu bandeja.` };
  },

  olvidar: async () => {
    olvidarClave(db());
    return { hecho: 'Contraseña borrada.' };
  }
};
