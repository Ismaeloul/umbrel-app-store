<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatear } from '$lib/dinero';
  import { REGIONES } from '$lib/regiones';
  import { color, fechaLarga, llenado, margen } from '$lib/ui';

  let { data, form } = $props();

  let abriendo = $state(false);
  const hayCuentas = $derived(data.cuentas.length > 0);
  const primera = $derived(data.cuentas[0]);
  const resto = $derived(data.cuentas.slice(1));

  // Las filas de suscripción se numeran y la lista de números vivos viaja en un
  // campo oculto. Así se puede quitar una de en medio sin descolocar las demás.
  let siguiente = $state(1);
  let filas = $state([{ id: 0 }]);

  function anadirFila() {
    filas = [...filas, { id: siguiente++ }];
  }

  function quitarFila(id: number) {
    filas = filas.filter((f) => f.id !== id);
  }

  const hoyLegible = new Intl.DateTimeFormat('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  }).format(new Date());
</script>

<svelte:head><title>Saldo</title></svelte:head>

<main>
  <header>
    <h1>Saldo</h1>
    <div class="derecha">
      <span class="rotulo">{hoyLegible}</span>
      <a href="/ajustes" aria-label="Ajustes" title="Ajustes">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
      </a>
    </div>
  </header>

  {#if hayCuentas}
    <div class="columnas">
      <section class="principal">
        {#if resto.length > 0}
          <span class="rotulo">La que antes se queda sin saldo</span>
        {/if}

        <a class="tarjeta destacada" href="/cuenta/{primera.id}">
          <div class="fila">
            <div class="quien">
              {#if primera.correo}
                <span class="nombre">{primera.correo}</span>
                <span class="tienda">{primera.tienda} · {primera.region}</span>
              {:else}
                <span class="nombre"
                  >{primera.tienda} <span class="region">· {primera.region}</span></span
                >
              {/if}
            </div>
            {#if !primera.aguantaTodo && primera.diasRestantes <= 30}
              <span class="aviso">Recarga ya</span>
            {/if}
          </div>

          <div class="cifra">
            {#if primera.aguantaTodo}
              <strong style="color: {color(999)}; font-size: 44px">+2 años</strong>
            {:else}
              <strong style="color: {color(primera.diasRestantes)}"
                >{Math.max(0, primera.diasRestantes)}</strong
              >
              <span>{primera.diasRestantes === 1 ? 'día' : 'días'}</span>
            {/if}
          </div>

          <p>
            {#if primera.aguantaTodo}
              {#if primera.activas === 0}
                Todavía no le has puesto suscripciones.
              {:else}
                El saldo aguanta los próximos dos años sin quedarse corto.
              {/if}
            {:else}
              Se queda sin saldo el <strong>{fechaLarga(primera.seAgotaEl!, data.hoy)}</strong>, en
              el cobro de {primera.culpable}.
            {/if}
          </p>

          <div class="barra">
            <div
              style="width: {primera.aguantaTodo ? 100 : llenado(primera.diasRestantes)}%;
                     background: {color(primera.aguantaTodo ? 999 : primera.diasRestantes)}"
            ></div>
          </div>

          <div class="fila">
            <span class="mono saldo">{formatear(primera.saldo, primera.divisa, primera.locale)}</span
            >
            <span class="apunte"
              >{primera.activas}
              {primera.activas === 1 ? 'suscripción' : 'suscripciones'}</span
            >
          </div>
        </a>
      </section>

      <section class="lista">
        {#if resto.length > 0}
          <span class="rotulo">Las demás cuentas</span>
        {/if}

        {#each resto as cuenta (cuenta.id)}
          <a class="tarjeta linea" href="/cuenta/{cuenta.id}">
            <div class="fila">
              <div class="quien">
                {#if cuenta.correo}
                  <span class="nombre">{cuenta.correo}</span>
                  <span class="tienda">{cuenta.tienda} · {cuenta.region}</span>
                {:else}
                  <span class="nombre"
                    >{cuenta.tienda} <span class="region">· {cuenta.region}</span></span
                  >
                {/if}
              </div>
              <span
                class="mono margen"
                style="color: {color(cuenta.aguantaTodo ? 999 : cuenta.diasRestantes)}"
                >{margen(cuenta.diasRestantes, cuenta.aguantaTodo)}</span
              >
            </div>
            <div class="fila">
              <span class="mono apunte">{formatear(cuenta.saldo, cuenta.divisa, cuenta.locale)}</span
              >
              <span class="apunte tenue"
                >{cuenta.seAgotaEl ? fechaLarga(cuenta.seAgotaEl, data.hoy) : '—'}</span
              >
            </div>
            <div class="barra">
              <div
                style="width: {cuenta.aguantaTodo ? 100 : llenado(cuenta.diasRestantes)}%;
                       background: {color(cuenta.aguantaTodo ? 999 : cuenta.diasRestantes)}"
              ></div>
            </div>
          </a>
        {/each}

        {#if !abriendo}
          <button class="boton suave" type="button" onclick={() => (abriendo = true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
            Añadir otra cuenta
          </button>
        {/if}
      </section>
    </div>
  {:else}
    <section class="vacio">
      <h2>Aún no hay ninguna cuenta</h2>
      <p>
        Crea una por cada cuenta de tienda que recargues con saldo, con sus suscripciones, y
        ya te dice cuánto te dura.
      </p>
    </section>
  {/if}

  {#if abriendo || !hayCuentas}
    <form method="POST" action="?/crearCuenta" class="tarjeta formulario" use:enhance>
      <span class="rotulo">Nueva cuenta</span>

      {#if form?.error}
        <p class="error">{form.error}</p>
      {/if}

      <label class="campo">
        <span>Correo de la cuenta</span>
        <input
          name="correo"
          type="email"
          placeholder="lacuenta@ejemplo.com"
          autocomplete="off"
        />
        <small>Para saber de cuál hablamos cuando tengas varias en la misma tienda.</small>
      </label>

      <div class="dos">
        <label class="campo">
          <span>Tienda</span>
          <input name="tienda" placeholder="App Store" required autocomplete="off" />
        </label>
        <label class="campo">
          <span>Región</span>
          <select name="region" required>
            {#each REGIONES as r (r.id)}
              <option value={r.id}>{r.nombre} · {r.divisa}</option>
            {/each}
          </select>
        </label>
      </div>

      <label class="campo">
        <span>Saldo que tiene ahora</span>
        <input name="saldo" inputmode="decimal" placeholder="0" autocomplete="off" />
      </label>

      <div class="apartado">
        <span class="rotulo">Suscripciones</span>
        <input type="hidden" name="sub_ids" value={filas.map((f) => f.id).join(',')} />

        {#each filas as fila (fila.id)}
          <div class="suscripcion">
            <div class="cabeza">
              <input
                name="sub_nombre_{fila.id}"
                placeholder="iCloud+ 2 TB"
                autocomplete="off"
                aria-label="Nombre de la suscripción"
              />
              {#if filas.length > 1}
                <button
                  class="quitar"
                  type="button"
                  onclick={() => quitarFila(fila.id)}
                  aria-label="Quitar esta suscripción"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14" /></svg>
                </button>
              {/if}
            </div>

            <div class="tres">
              <input
                name="sub_importe_{fila.id}"
                inputmode="decimal"
                placeholder="2,99"
                autocomplete="off"
                aria-label="Precio"
              />
              <select name="sub_periodo_{fila.id}" aria-label="Cada cuánto se cobra">
                <option value="mensual">Al mes</option>
                <option value="anual">Al año</option>
              </select>
              <input
                name="sub_cobro_{fila.id}"
                type="date"
                value={data.hoy}
                aria-label="Próximo cobro"
              />
            </div>

            <label class="marcable">
              <input type="checkbox" name="sub_prueba_{fila.id}" />
              <span>Está en prueba gratuita y ese día pasa a cobro</span>
            </label>
          </div>
        {/each}

        <button class="boton suave chico" type="button" onclick={anadirFila}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Otra suscripción
        </button>
      </div>

      <label class="campo">
        <span>Notas</span>
        <textarea
          name="notas"
          rows="3"
          placeholder="Con qué tarjeta la recargas, dónde compras los cupones…"
        ></textarea>
      </label>

      <div class="acciones">
        <button class="boton" type="submit">Crear cuenta</button>
        {#if hayCuentas}
          <button class="boton suave" type="button" onclick={() => (abriendo = false)}>
            Cancelar
          </button>
        {/if}
      </div>
    </form>
  {/if}
</main>

<style>
  main {
    max-width: 1160px;
    margin: 0 auto;
    padding: 26px 22px 34px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  h1 {
    margin: 0;
    font-size: 27px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1;
  }

  .derecha {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .derecha a {
    display: flex;
    color: var(--tinta-tenue);
  }

  .derecha a:hover {
    color: var(--tinta);
  }

  .columnas {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .fila {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .quien {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .nombre {
    font-size: 14px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .tienda {
    font-size: 11.5px;
    color: var(--tinta-suave);
  }

  .region {
    color: var(--tinta-suave);
    font-weight: 400;
  }

  .destacada {
    border-radius: var(--radio);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .aviso {
    align-self: center;
    background: var(--rojo-fondo);
    color: var(--rojo);
    border-radius: 999px;
    padding: 5px 11px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .cifra {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .cifra strong {
    font-size: 84px;
    font-weight: 700;
    letter-spacing: -0.035em;
    line-height: 0.84;
  }

  .cifra span {
    font-size: 19px;
  }

  .destacada p {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.45;
    color: var(--tinta-media);
    text-wrap: pretty;
  }

  .destacada .barra {
    height: 6px;
  }

  .saldo {
    font-size: 20px;
    font-weight: 500;
  }

  .apunte {
    font-size: 12px;
    color: var(--tinta-suave);
  }

  .tenue {
    color: var(--tinta-tenue);
  }

  .principal,
  .lista {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .principal .rotulo,
  .lista .rotulo {
    margin-bottom: 2px;
  }

  .linea {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .destacada:hover,
  .linea:hover {
    border-color: var(--borde-fuerte);
  }

  .margen {
    font-size: 13px;
    font-weight: 500;
  }

  .vacio {
    padding: 8px 2px 0;
  }

  .vacio h2 {
    margin: 0 0 8px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .vacio p {
    margin: 0;
    max-width: 46ch;
    font-size: 14px;
    line-height: 1.5;
    color: var(--tinta-media);
    text-wrap: pretty;
  }

  .formulario {
    border-radius: var(--radio);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 15px;
    max-width: 540px;
  }

  .campo small {
    font-size: 11.5px;
    color: var(--tinta-tenue);
    line-height: 1.4;
  }

  .dos {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .apartado {
    display: flex;
    flex-direction: column;
    gap: 11px;
    padding: 16px;
    background: var(--papel);
    border-radius: 13px;
  }

  .suscripcion {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 13px;
    background: var(--tarjeta);
    border: 1px solid var(--borde);
    border-radius: 12px;
  }

  .cabeza {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .quitar {
    flex: none;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--borde-fuerte);
    border-radius: 10px;
    color: var(--tinta-suave);
    cursor: pointer;
  }

  .quitar:hover {
    color: var(--rojo);
    border-color: var(--rojo);
  }

  .tres {
    display: grid;
    grid-template-columns: 1fr 1fr 1.3fr;
    gap: 8px;
  }

  .tres input,
  .tres select {
    min-height: 42px;
    padding: 9px 10px;
    font-size: 14px;
  }

  .marcable {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--tinta-suave);
  }

  .marcable input {
    width: 17px;
    height: 17px;
    min-height: 17px;
    flex: none;
    accent-color: var(--tinta);
  }

  .chico {
    min-height: 40px;
    padding: 0 14px;
    font-size: 13px;
    align-self: flex-start;
  }

  .acciones {
    display: flex;
    gap: 10px;
    margin-top: 4px;
  }

  /* En pantalla ancha la cuenta urgente manda a la izquierda y el resto se
     lee en una columna al lado, en vez de estirar la vista de móvil. */
  @media (min-width: 880px) {
    main {
      padding: 34px 40px 44px;
      gap: 26px;
    }

    .columnas {
      flex-direction: row;
      align-items: start;
      gap: 32px;
    }

    .principal {
      flex: 1 1 0;
    }

    .destacada {
      padding: 28px;
    }

    .cifra strong {
      font-size: 108px;
    }

    .lista {
      flex: 1 1 0;
    }
  }
</style>
