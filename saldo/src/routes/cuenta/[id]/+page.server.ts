import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/servidor/db';
import { hoy } from '$lib/servidor/reloj';
import {
  anotar,
  borrarCuenta,
  borrarSuscripcion,
  cancelarSuscripcion,
  crearSuscripcion,
  cuenta as leerCuenta,
  guardarNotas,
  movimientosDe,
  proyectablesDe,
  reactivarSuscripcion,
  suscripcionesDe
} from '$lib/servidor/consultas';
import { proyectar } from '$lib/motor/proyeccion';
import { proximoDesde } from '$lib/motor/fechas';
import { parsear } from '$lib/dinero';
import type { Actions, PageServerLoad } from './$types';

function cuentaDe(params: { id: string }) {
  const c = leerCuenta(db(), Number(params.id));
  if (!c) error(404, 'Esa cuenta no existe.');
  return c;
}

export const load: PageServerLoad = async ({ params }) => {
  const dia = hoy();
  const c = cuentaDe(params);
  const conn = db();

  const proyectables = proyectablesDe(conn, c.id, dia);

  return {
    hoy: dia,
    cuenta: c,
    // El motor tambien corre en el navegador con estos mismos datos: es lo que
    // hace instantaneo el simulador de recargas.
    proyectables,
    proyeccion: proyectar({ saldo: c.saldo, suscripciones: proyectables, hoy: dia }),
    suscripciones: suscripcionesDe(conn, c.id, dia),
    movimientos: movimientosDe(conn, c.id)
  };
};

export const actions: Actions = {
  recargar: async ({ request, params }) => {
    const c = cuentaDe(params);
    const datos = await request.formData();

    let importe: number;
    try {
      importe = parsear(String(datos.get('importe') ?? ''), c.divisa);
    } catch {
      return fail(400, { error: 'Eso no es un importe.' });
    }
    if (importe <= 0) return fail(400, { error: 'La recarga tiene que ser mayor que cero.' });

    anotar(db(), {
      cuentaId: c.id,
      fecha: hoy(),
      tipo: 'recarga',
      importe,
      concepto: 'Recarga'
    });
    return { hecho: 'Recarga anotada.' };
  },

  // Escribes el saldo real que ves en la tienda y la app apunta la diferencia
  // como ajuste, con su motivo. Asi el historial no miente.
  reconciliar: async ({ request, params }) => {
    const c = cuentaDe(params);
    const datos = await request.formData();
    const motivo = String(datos.get('motivo') ?? '').trim();

    let real: number;
    try {
      real = parsear(String(datos.get('real') ?? ''), c.divisa);
    } catch {
      return fail(400, { error: 'Eso no es un importe.' });
    }
    if (real < 0) return fail(400, { error: 'El saldo no puede ser negativo.' });

    const diferencia = real - c.saldo;
    if (diferencia === 0) return { hecho: 'Ya cuadraba: no hay nada que ajustar.' };

    anotar(db(), {
      cuentaId: c.id,
      fecha: hoy(),
      tipo: 'ajuste',
      importe: diferencia,
      concepto: motivo === '' ? 'Ajuste al saldo real' : motivo
    });
    return { hecho: 'Cuadrado con el saldo real.' };
  },

  crearSuscripcion: async ({ request, params }) => {
    const c = cuentaDe(params);
    const datos = await request.formData();

    const nombre = String(datos.get('nombre') ?? '').trim();
    const periodo = String(datos.get('periodo') ?? 'mensual') as 'mensual' | 'anual';
    const primerCobro = String(datos.get('primerCobro') ?? '');
    const esPrueba = datos.get('prueba') === 'on';

    if (nombre === '') return fail(400, { error: 'Ponle nombre a la suscripción.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(primerCobro))
      return fail(400, { error: 'Falta la fecha del próximo cobro.' });
    if (periodo !== 'mensual' && periodo !== 'anual')
      return fail(400, { error: 'El periodo no es válido.' });

    let importe: number;
    try {
      importe = parsear(String(datos.get('importe') ?? ''), c.divisa);
    } catch {
      return fail(400, { error: 'El precio no es un importe válido.' });
    }
    if (importe <= 0) return fail(400, { error: 'El precio tiene que ser mayor que cero.' });

    crearSuscripcion(db(), {
      cuentaId: c.id,
      nombre,
      periodo,
      importe,
      primerCobro,
      esPrueba,
      hoy: hoy()
    });
    return { hecho: `${nombre} añadida.` };
  },

  cancelar: async ({ request, params }) => {
    cuentaDe(params);
    const id = Number((await request.formData()).get('id'));
    cancelarSuscripcion(db(), id);
    return { hecho: 'Suscripción cancelada.' };
  },

  reactivar: async ({ request, params }) => {
    cuentaDe(params);
    const conn = db();
    const id = Number((await request.formData()).get('id'));

    const sub = conn
      .prepare('SELECT periodo, ancla_dia AS anclaDia, ancla_mes AS anclaMes FROM suscripciones WHERE id = ?')
      .get(id) as { periodo: 'mensual' | 'anual'; anclaDia: number; anclaMes: number | null } | undefined;
    if (!sub) return fail(404, { error: 'Esa suscripción no existe.' });

    reactivarSuscripcion(conn, id, proximoDesde(hoy(), sub.periodo, sub.anclaDia, sub.anclaMes));
    return { hecho: 'Suscripción reactivada.' };
  },

  borrarSuscripcion: async ({ request, params }) => {
    cuentaDe(params);
    const id = Number((await request.formData()).get('id'));
    borrarSuscripcion(db(), id);
    return { hecho: 'Suscripción borrada.' };
  },

  datos: async ({ request, params }) => {
    const c = cuentaDe(params);
    const datos = await request.formData();
    const correo = String(datos.get('correo') ?? '').trim();
    // Si el campo no viene (formularios viejos), la tienda se queda como esta.
    const tienda = String(datos.get('tienda') ?? c.tienda).trim() || c.tienda;

    db().prepare('UPDATE cuentas SET correo = ?, tienda = ? WHERE id = ?').run(correo, tienda, c.id);
    guardarNotas(db(), c.id, String(datos.get('notas') ?? ''));
    return { hecho: 'Guardado.' };
  },

  borrarCuenta: async ({ params }) => {
    const c = cuentaDe(params);
    borrarCuenta(db(), c.id);
    redirect(303, '/');
  }
};
