<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatear, factor } from '$lib/dinero';
  import { proyectar } from '$lib/motor/proyeccion';
  import { color, diaDelMes, escalaRecarga, fechaCorta, fechaLarga, gastoMensual, llenado, margen } from '$lib/ui';

  let { data, form } = $props();

  const c = $derived(data.cuenta);
  const activas = $derived(data.suscripciones.filter((s) => s.estado === 'activa'));
  const perdidas = $derived(data.suscripciones.filter((s) => s.estado === 'perdida'));
  const canceladas = $derived(data.suscripciones.filter((s) => s.estado === 'cancelada'));

  // --- El simulador -------------------------------------------------------
  // El mismo motor que corre en el servidor, corriendo aqui: mueves la barra y
  // la fecha se recalcula sin pedirle nada a nadie.
  let unidades = $state(0);
  const extra = $derived(Math.round(unidades * factor(c.divisa)));
  // La barra va en la moneda de la cuenta: 120 € dan para meses de Netflix,
  // pero 120 ₹ no llegan ni a una mensualidad de YouTube. El tope sale de lo
  // que cobra la cuenta al mes.
  const escala = $derived(escalaRecarga(gastoMensual(data.proyectables), c.divisa));
  const simulada = $derived(
    proyectar({
      saldo: c.saldo + extra,
      suscripciones: data.proyectables,
      hoy: data.hoy
    })
  );
  const ganados = $derived(simulada.diasRestantes - data.proyeccion.diasRestantes);
  // Cuantos cobros mas cubres con esa recarga: es lo que explica por que 70 ₹
  // pueden valer un mes entero (si ya tenias casi el importe del cobro) y
  // 300 ₹ no valer nada (si con ellos sigues sin llegar al siguiente).
  const cubiertos = $derived(
    simulada.cobros.filter((x) => x.cabe).length - data.proyeccion.cobros.filter((x) => x.cabe).length
  );
  const sobra = $derived(simulada.primerFallo ? simulada.primerFallo.saldoDespues : null);

  const proximos = $derived(data.proyeccion.cobros.slice(0, 8));
</script>

<svelte:head><title>{c.correo || `${c.tienda} · ${c.region}`} — Saldo</title></svelte:head>

<main>
  <header>
    <a href="/" aria-label="Volver al panel">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
    </a>
    <div class="quien">
      {#if c.correo}
        <h1>{c.correo}</h1>
        <span class="tienda">{c.tienda} · {c.region}</span>
      {:else}
        <h1>{c.tienda} <span class="region">· {c.region}</span></h1>
      {/if}
    </div>
  </header>

  {#if form?.error}<p class="error">{form.error}</p>{/if}
  {#if form?.hecho}<p class="hecho">{form.hecho}</p>{/if}

  <section class="cabecera">
    <div class="mono cifra">{formatear(c.saldo, c.divisa, c.locale)}</div>
    <p>
      {#if data.proyeccion.aguantaTodo}
        {#if activas.length === 0}
          Sin suscripciones todavía: el saldo no se mueve.
        {:else}
          <span style="color: var(--verde); font-weight: 600">Aguanta más de dos años</span>
          con lo que hay ahora.
        {/if}
      {:else}
        <span style="color: {color(data.proyeccion.diasRestantes)}; font-weight: 600"
          >{margen(data.proyeccion.diasRestantes)}</span
        >
        · se agota el {fechaLarga(data.proyeccion.seAgotaEl!, data.hoy)}
      {/if}
    </p>
    <div class="barra">
      <div
        style="width: {data.proyeccion.aguantaTodo ? 100 : llenado(data.proyeccion.diasRestantes)}%;
               background: {color(data.proyeccion.aguantaTodo ? 999 : data.proyeccion.diasRestantes)}"
      ></div>
    </div>
  </section>

  <div class="rejilla">
    {#if activas.length > 0}
      <section class="bloque">
        <span class="rotulo">Si recargo…</span>
        <div class="tarjeta caja simulador">
          <div class="fila">
            <span class="mono grande">{formatear(extra, c.divisa, c.locale)}</span>
            <span class="apunte">arrastra para probar</span>
          </div>

          <input
            class="deslizador"
            type="range"
            min="0"
            max={escala.max}
            step={escala.paso}
            bind:value={unidades}
            aria-label="Cuánto recargar"
          />

          {#if extra === 0}
            <p class="resultado tenue">Mueve la barra para ver hasta dónde llegarías.</p>
          {:else if simulada.aguantaTodo}
            <p class="resultado">
              Con eso <strong>aguantas más de dos años</strong>.
            </p>
          {:else if cubiertos === 0}
            <p class="resultado">
              Con eso <strong>no llegas a ningún cobro más</strong>: sigues hasta el
              {fechaLarga(simulada.seAgotaEl!, data.hoy)}.
            </p>
            <p class="mono apunte tenue">
              te faltarían {formatear(simulada.primerFallo!.importe - sobra!, c.divisa, c.locale)}
              para el de {simulada.primerFallo!.nombre}
            </p>
          {:else}
            <p class="resultado">
              Cubres <strong>{cubiertos} {cubiertos === 1 ? 'cobro' : 'cobros'} más</strong> y
              aguantas hasta el <strong>{fechaLarga(simulada.seAgotaEl!, data.hoy)}</strong>.
            </p>
            <p class="mono apunte" style="color: var(--verde)">
              {margen(simulada.diasRestantes)} · +{ganados} días respecto de ahora
              {#if sobra}· sobran {formatear(sobra, c.divisa, c.locale)}{/if}
            </p>
          {/if}
        </div>
      </section>

      <section class="bloque">
        <span class="rotulo">Próximos cobros</span>
        <div class="tarjeta">
          {#each proximos as cobro (cobro.suscripcionId + cobro.fecha)}
            <div class="renglon" class:falla={!cobro.cabe}>
              <div class="izq">
                <span class="mono fecha">{fechaCorta(cobro.fecha)}</span>
                <span class="titulo">
                  {cobro.nombre}
                  {#if cobro.finDePrueba}<span class="marca">fin de prueba</span>{/if}
                </span>
              </div>
              <div class="der">
                <span class="mono">−{formatear(cobro.importe, c.divisa, c.locale)}</span>
                <span class="mono apunte">
                  {#if cobro.cabe}
                    quedan {formatear(cobro.saldoDespues, c.divisa, c.locale)}
                  {:else}
                    no cabe · se pierde
                  {/if}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <section class="bloque">
      <span class="rotulo">Suscripciones · {activas.length}</span>
      <div class="tarjeta">
        {#each activas as s (s.id)}
          <div class="renglon">
            <div class="izq">
              <span class="titulo">
                {s.nombre}
                {#if s.pruebaHasta}<span class="marca">en prueba</span>{/if}
              </span>
              <span class="mono apunte">
                {formatear(s.importe, c.divisa, c.locale)} / {s.periodo === 'mensual'
                  ? 'mes'
                  : 'año'} ·
                {s.periodo === 'mensual' ? `día ${diaDelMes(s.proximoCobro)}` : fechaCorta(s.proximoCobro)}
              </span>
            </div>
            <form method="POST" action="?/cancelar" use:enhance>
              <input type="hidden" name="id" value={s.id} />
              <button class="boton peligro" type="submit">Cancelar</button>
            </form>
          </div>
        {:else}
          <p class="ninguna">Ninguna todavía. Añade la primera abajo.</p>
        {/each}
      </div>

      {#if perdidas.length > 0}
        <span class="rotulo">Perdidas · {perdidas.length}</span>
        <div class="tarjeta">
          {#each perdidas as s (s.id)}
            <div class="renglon">
              <div class="izq">
                <span class="titulo" style="color: var(--rojo)">{s.nombre}</span>
                <span class="mono apunte">
                  {formatear(s.importe, c.divisa, c.locale)} · no hubo saldo el {fechaCorta(
                    s.proximoCobro
                  )}
                </span>
              </div>
              <form method="POST" action="?/reactivar" use:enhance>
                <input type="hidden" name="id" value={s.id} />
                <button class="boton peligro" type="submit" style="color: var(--tinta)">
                  Reactivar
                </button>
              </form>
            </div>
          {/each}
        </div>
      {/if}

      <details class="tarjeta caja">
        <summary>Añadir una suscripción</summary>
        <form method="POST" action="?/crearSuscripcion" class="formulario" use:enhance>
          <label class="campo">
            <span>Nombre</span>
            <input name="nombre" placeholder="iCloud+ 2 TB" required autocomplete="off" />
          </label>
          <div class="dos">
            <label class="campo">
              <span>Precio</span>
              <input name="importe" inputmode="decimal" placeholder="2,99" required autocomplete="off" />
            </label>
            <label class="campo">
              <span>Cada</span>
              <select name="periodo">
                <option value="mensual">Mes</option>
                <option value="anual">Año</option>
              </select>
            </label>
          </div>
          <label class="campo">
            <span>Próximo cobro</span>
            <input name="primerCobro" type="date" required value={data.hoy} />
          </label>
          <label class="marcable">
            <input type="checkbox" name="prueba" />
            <span>Está en prueba gratuita y ese día pasa a cobro</span>
          </label>
          <button class="boton" type="submit">Añadir</button>
        </form>
      </details>
    </section>

    <section class="bloque">
      <span class="rotulo">Saldo</span>

      <details class="tarjeta caja">
        <summary>Registrar una recarga</summary>
        <form method="POST" action="?/recargar" class="formulario" use:enhance>
          <label class="campo">
            <span>Cuánto has recargado</span>
            <input name="importe" inputmode="decimal" placeholder="25" required autocomplete="off" />
          </label>
          <button class="boton" type="submit">Anotar recarga</button>
        </form>
      </details>

      <details class="tarjeta caja">
        <summary>Cuadrar con el saldo real</summary>
        <form method="POST" action="?/reconciliar" class="formulario" use:enhance>
          <p class="ayuda">
            Escribe el saldo que ves en la tienda. La app anota la diferencia como ajuste,
            con su motivo, en vez de cambiar el número por detrás.
          </p>
          <label class="campo">
            <span>Saldo real</span>
            <input name="real" inputmode="decimal" required autocomplete="off" />
          </label>
          <label class="campo">
            <span>Motivo</span>
            <input name="motivo" placeholder="Compra suelta en la tienda" autocomplete="off" />
          </label>
          <button class="boton" type="submit">Cuadrar</button>
        </form>
      </details>

      {#if data.movimientos.length > 0}
        <span class="rotulo">Movimientos</span>
        <div class="tarjeta">
          {#each data.movimientos.slice(0, 12) as m (m.id)}
            <div class="renglon">
              <div class="izq">
                <span class="mono fecha">{fechaCorta(m.fecha)}</span>
                <span class="titulo">{m.concepto}</span>
              </div>
              <span
                class="mono"
                style="color: {m.importe > 0 ? 'var(--verde)' : m.importe === 0 ? 'var(--rojo)' : 'inherit'}"
              >
                {#if m.importe === 0}
                  —
                {:else}
                  {m.importe > 0 ? '+' : '−'}{formatear(Math.abs(m.importe), c.divisa, c.locale)}
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="bloque">
      <span class="rotulo">Datos de la cuenta</span>
      <form method="POST" action="?/datos" class="tarjeta caja formulario" use:enhance>
        <label class="campo">
          <span>Tienda</span>
          <input name="tienda" value={c.tienda} placeholder="App Store" required autocomplete="off" />
        </label>
        <label class="campo">
          <span>Correo de la cuenta</span>
          <input name="correo" type="email" value={c.correo} placeholder="lacuenta@ejemplo.com" autocomplete="off" />
        </label>
        <label class="campo">
          <span>Notas</span>
          <textarea name="notas" placeholder="Con qué tarjeta la recargas, dónde compras los cupones…">{c.notas}</textarea>
        </label>
        <button class="boton suave" type="submit">Guardar</button>
      </form>

      {#if canceladas.length > 0}
        <span class="rotulo">Canceladas · {canceladas.length}</span>
        <div class="tarjeta">
          {#each canceladas as s (s.id)}
            <div class="renglon">
              <span class="titulo tenue">{s.nombre}</span>
              <form method="POST" action="?/borrarSuscripcion" use:enhance>
                <input type="hidden" name="id" value={s.id} />
                <button class="boton peligro" type="submit">Borrar</button>
              </form>
            </div>
          {/each}
        </div>
      {/if}

      <details class="tarjeta caja">
        <summary>Borrar esta cuenta</summary>
        <form method="POST" action="?/borrarCuenta" class="formulario">
          <p class="ayuda">
            Se lleva por delante sus suscripciones y su historial. No hay deshacer.
          </p>
          <button class="boton" type="submit" style="background: var(--rojo); border-color: var(--rojo)">
            Borrar {c.tienda} · {c.region}
          </button>
        </form>
      </details>
    </section>
  </div>
</main>

<style>
  main {
    max-width: 1160px;
    margin: 0 auto;
    padding: 26px 22px 44px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  header a {
    display: flex;
    color: var(--tinta);
  }

  .quien {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .tienda {
    font-size: 11.5px;
    color: var(--tinta-suave);
  }

  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .region {
    color: var(--tinta-suave);
    font-weight: 400;
  }

  .cabecera {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cifra {
    font-size: 46px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .cabecera p {
    margin: 0;
    font-size: 13.5px;
    color: var(--tinta-media);
  }

  .cabecera .barra {
    height: 6px;
  }

  .rejilla {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  .bloque {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .caja {
    border-radius: var(--radio);
    padding: 18px;
  }

  .simulador {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .fila {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .grande {
    font-size: 30px;
    font-weight: 500;
  }

  .deslizador {
    width: 100%;
    min-height: 0;
    padding: 0;
    border: none;
    background: none;
    accent-color: var(--tinta);
  }

  .deslizador:focus {
    outline: none;
  }

  .resultado {
    margin: 0;
    font-size: 15px;
    line-height: 1.4;
    text-wrap: pretty;
  }

  .renglon {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--separador);
  }

  .renglon:last-child {
    border-bottom: none;
  }

  .izq,
  .der {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .der {
    align-items: flex-end;
    text-align: right;
    white-space: nowrap;
  }

  .fecha {
    font-size: 11px;
    color: var(--tinta-tenue);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .titulo {
    font-size: 14px;
    overflow-wrap: anywhere;
  }

  .falla .titulo,
  .falla .fecha,
  .falla .mono {
    color: var(--rojo);
  }

  .falla .titulo {
    font-weight: 600;
  }

  .marca {
    margin-left: 6px;
    padding: 2px 7px;
    border: 1px solid #e8d8b2;
    border-radius: 999px;
    color: var(--ambar);
    font-size: 9.5px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .apunte {
    font-size: 11.5px;
    color: var(--tinta-suave);
  }

  .tenue {
    color: var(--tinta-tenue);
  }

  .ninguna,
  .ayuda {
    margin: 0;
    padding: 14px 16px;
    font-size: 13.5px;
    line-height: 1.5;
    color: var(--tinta-suave);
    text-wrap: pretty;
  }

  .ayuda {
    padding: 0;
  }

  summary {
    padding: 4px 0;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }

  details[open] summary {
    margin-bottom: 14px;
  }

  .formulario {
    display: flex;
    flex-direction: column;
    gap: 13px;
  }

  .dos {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .marcable {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    color: var(--tinta-media);
    line-height: 1.4;
  }

  .marcable input {
    width: 18px;
    min-height: 18px;
    height: 18px;
    flex: none;
    accent-color: var(--tinta);
  }

  .hecho {
    margin: 0;
    padding: 12px 14px;
    background: #eef3ec;
    border-radius: 11px;
    color: var(--verde);
    font-size: 13.5px;
  }

  @media (min-width: 880px) {
    main {
      padding: 34px 40px 54px;
      gap: 28px;
    }

    .cifra {
      font-size: 56px;
    }

    .rejilla {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
      gap: 28px;
    }
  }
</style>
