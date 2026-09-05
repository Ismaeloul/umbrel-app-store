import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/servidor/db';
import { hoy } from '$lib/servidor/reloj';
import { crearCuenta, crearSuscripcion, panel } from '$lib/servidor/consultas';
import { region } from '$lib/regiones';
import { parsear } from '$lib/dinero';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const dia = hoy();
  const cuentas = panel(db(), dia).map((r) => ({
    id: r.cuenta.id,
    correo: r.cuenta.correo,
    tienda: r.cuenta.tienda,
    region: r.cuenta.region,
    divisa: r.cuenta.divisa,
    locale: r.cuenta.locale,
    saldo: r.cuenta.saldo,
    activas: r.activas,
    diasRestantes: r.proyeccion.diasRestantes,
    seAgotaEl: r.proyeccion.seAgotaEl,
    aguantaTodo: r.proyeccion.aguantaTodo,
    culpable: r.proyeccion.primerFallo?.nombre ?? null
  }));

  return { hoy: dia, cuentas };
};

interface FilaSuscripcion {
  nombre: string;
  importe: number;
  periodo: 'mensual' | 'anual';
  primerCobro: string;
  esPrueba: boolean;
}

/**
 * Las suscripciones vienen del formulario numeradas (`sub_nombre_3`), y la
 * lista de numeros vivos en `sub_ids`. Es lo que permite quitar una fila de en
 * medio sin que se descoloquen las demas.
 */
function filasDelFormulario(
  datos: FormData,
  divisa: string
): { filas: FilaSuscripcion[] } | { error: string } {
  const ids = String(datos.get('sub_ids') ?? '')
    .split(',')
    .filter((x) => x !== '');

  const filas: FilaSuscripcion[] = [];

  for (const id of ids) {
    const nombre = String(datos.get(`sub_nombre_${id}`) ?? '').trim();
    const importeTexto = String(datos.get(`sub_importe_${id}`) ?? '').trim();
    const primerCobro = String(datos.get(`sub_cobro_${id}`) ?? '');
    const periodo = String(datos.get(`sub_periodo_${id}`) ?? 'mensual');

    // Una fila que se ha quedado en blanco no es un error: es una fila que
    // abriste y no llegaste a rellenar.
    if (nombre === '' && importeTexto === '') continue;

    if (nombre === '') return { error: 'Hay una suscripción sin nombre.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(primerCobro))
      return { error: `Falta la fecha del próximo cobro de ${nombre}.` };
    if (periodo !== 'mensual' && periodo !== 'anual')
      return { error: `El periodo de ${nombre} no es válido.` };

    let importe: number;
    try {
      importe = parsear(importeTexto, divisa);
    } catch {
      return { error: `El precio de ${nombre} no es un importe válido.` };
    }
    if (importe <= 0) return { error: `El precio de ${nombre} tiene que ser mayor que cero.` };

    filas.push({
      nombre,
      importe,
      periodo,
      primerCobro,
      esPrueba: datos.get(`sub_prueba_${id}`) === 'on'
    });
  }

  return { filas };
}

export const actions: Actions = {
  crearCuenta: async ({ request }) => {
    const datos = await request.formData();
    const correo = String(datos.get('correo') ?? '').trim();
    const tienda = String(datos.get('tienda') ?? '').trim();
    const regionId = String(datos.get('region') ?? '');
    const notas = String(datos.get('notas') ?? '');
    const saldoTexto = String(datos.get('saldo') ?? '0');

    if (tienda === '') return fail(400, { error: 'Ponle nombre a la tienda.' });

    const r = region(regionId);
    if (!r) return fail(400, { error: 'Elige una región.' });

    let saldo: number;
    try {
      saldo = saldoTexto.trim() === '' ? 0 : parsear(saldoTexto, r.divisa);
    } catch {
      return fail(400, { error: 'El saldo no es un importe válido.' });
    }
    if (saldo < 0) return fail(400, { error: 'El saldo no puede ser negativo.' });

    // Las suscripciones se validan ANTES de crear nada: si una está mal, no
    // quiero dejarte media cuenta creada y el formulario perdido.
    const leidas = filasDelFormulario(datos, r.divisa);
    if ('error' in leidas) return fail(400, { error: leidas.error });

    const dia = hoy();
    const conn = db();

    const id = crearCuenta(conn, {
      correo,
      tienda,
      region: r.nombre,
      regionId: r.id,
      divisa: r.divisa,
      locale: r.locale,
      saldo,
      notas,
      hoy: dia
    });

    for (const fila of leidas.filas) {
      crearSuscripcion(conn, { cuentaId: id, hoy: dia, ...fila });
    }

    redirect(303, `/cuenta/${id}`);
  }
};
