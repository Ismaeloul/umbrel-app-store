<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();

  // Los campos se pintan con lo que dice el servidor y ya esta: nada de copiar
  // los valores a estado local, que despues de guardar se quedaria viejo.
  let formulario: HTMLFormElement;

  // Gmail es lo que se va a usar el 99 % de las veces, asi que se rellena de un
  // golpe en vez de tener que acordarse del servidor y del puerto.
  function gmail() {
    const campo = (n: string) => formulario.elements.namedItem(n) as HTMLInputElement;
    campo('servidor').value = 'smtp.gmail.com';
    campo('puerto').value = '587';
    campo('seguro').checked = false;
  }
</script>

<svelte:head><title>Ajustes — Saldo</title></svelte:head>

<main>
  <header>
    <a href="/" aria-label="Volver al panel">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
    </a>
    <h1>Ajustes</h1>
  </header>

  {#if form?.error}<p class="error">{form.error}</p>{/if}
  {#if form?.hecho}<p class="hecho">{form.hecho}</p>{/if}

  <section class="bloque">
    <div class="titulo">
      <span class="rotulo">Avisos por correo</span>
      <span class="estado" class:activo={data.configurado}>
        {data.configurado ? 'Configurado' : 'Sin configurar'}
      </span>
    </div>

    <form method="POST" action="?/guardar" class="tarjeta caja formulario" bind:this={formulario} use:enhance>
      <p class="ayuda">
        Un solo correo al día como mucho, con todo junto: las cuentas con poco margen, las
        pruebas que pasan a cobro y lo que se haya perdido. El de poco saldo te lo recuerda
        una vez por semana hasta que recargues.
      </p>

      <div class="atajo">
        <span>¿Es una cuenta de Gmail?</span>
        <button class="boton suave chico" type="button" onclick={gmail}>Rellenar por mí</button>
      </div>

      <div class="dos">
        <label class="campo">
          <span>Servidor de salida</span>
          <input name="servidor" value={data.correo.servidor} placeholder="smtp.gmail.com" autocomplete="off" />
        </label>
        <label class="campo">
          <span>Puerto</span>
          <input name="puerto" type="number" value={data.correo.puerto} min="1" max="65535" />
        </label>
      </div>

      <label class="marcable">
        <input type="checkbox" name="seguro" checked={data.correo.seguro} />
        <span>Conexión SSL directa (marca esto solo si usas el puerto 465)</span>
      </label>

      <label class="campo">
        <span>Cuenta desde la que se envía</span>
        <input
          name="usuario"
          type="email"
          value={data.correo.usuario}
          placeholder="tucuenta@gmail.com"
          autocomplete="off"
        />
      </label>

      <label class="campo">
        <span>Contraseña de aplicación</span>
        <input
          name="clave"
          type="password"
          placeholder={data.tieneClave ? '•••••••• (guardada)' : 'xxxx xxxx xxxx xxxx'}
          autocomplete="new-password"
        />
      </label>

      <p class="ayuda ceñida">
        Con Gmail <strong>no es la contraseña de tu cuenta</strong>: es una contraseña de
        aplicación, que se genera en la cuenta de Google con la verificación en dos pasos
        puesta. Se guarda tal cual en la base de datos de la app, así que trátala como lo que
        es: una llave que conviene poder revocar desde Google.
      </p>

      <label class="campo">
        <span>Nombre del remitente</span>
        <input name="de" value={data.correo.de} placeholder="Saldo &lt;tucuenta@gmail.com&gt;" autocomplete="off" />
        <small>
          Si lo dejas vacío o pones solo la dirección, el correo llega firmado como «Saldo».
        </small>
      </label>

      <label class="campo">
        <span>A quién se avisa</span>
        <input
          name="para"
          type="email"
          value={data.correo.para}
          placeholder="tucuenta@gmail.com"
          autocomplete="off"
        />
      </label>

      <span class="rotulo separa">Cuándo avisar</span>

      <div class="dos">
        <label class="campo">
          <span>Días de margen o menos</span>
          <input name="avisoDias" type="number" value={data.avisoDias} min="1" max="365" />
        </label>
        <label class="campo">
          <span>Aviso de fin de prueba</span>
          <input
            name="avisoPruebaDias"
            type="number"
            value={data.avisoPruebaDias}
            min="1"
            max="90"
          />
        </label>
      </div>

      <div class="acciones">
        <button class="boton" type="submit">Guardar</button>
        <button class="boton suave" type="submit" formaction="?/probar">
          Guardar y enviar una prueba
        </button>
      </div>
    </form>

    {#if data.tieneClave}
      <form method="POST" action="?/olvidar" use:enhance>
        <button class="boton peligro" type="submit">Borrar la contraseña guardada</button>
      </form>
    {/if}
  </section>
</main>

<style>
  main {
    max-width: 560px;
    margin: 0 auto;
    padding: 26px 22px 44px;
    display: flex;
    flex-direction: column;
    gap: 20px;
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

  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .bloque {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .titulo {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .estado {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--pista);
    color: var(--tinta-suave);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .estado.activo {
    background: #eef3ec;
    color: var(--verde);
  }

  .caja {
    border-radius: var(--radio);
    padding: 20px;
  }

  .formulario {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .atajo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    background: var(--papel);
    border-radius: 11px;
    font-size: 13.5px;
    color: var(--tinta-media);
  }

  .chico {
    min-height: 38px;
    padding: 0 14px;
    font-size: 13px;
  }

  .ayuda {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--tinta-suave);
    text-wrap: pretty;
  }

  .ceñida {
    margin-top: -4px;
  }

  .dos {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
  }

  .marcable {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13.5px;
    line-height: 1.4;
    color: var(--tinta-media);
  }

  .marcable input {
    width: 18px;
    height: 18px;
    min-height: 18px;
    flex: none;
    accent-color: var(--tinta);
  }

  .separa {
    margin-top: 6px;
  }

  .acciones {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 4px;
  }

  .hecho {
    margin: 0;
    padding: 12px 14px;
    background: #eef3ec;
    border-radius: 11px;
    color: var(--verde);
    font-size: 13.5px;
  }
</style>
