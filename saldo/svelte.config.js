import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // La app vive detras del proxy de Umbrel y se entra por muchos nombres
    // distintos: localhost, umbrel.local, la IP de la LAN, el nombre de
    // Tailscale... Con una lista fija de origenes, enviar cualquier formulario
    // desde uno que no estuviera en ella daria 403. Es una app de un solo
    // usuario en red privada, asi que no hay terceros de los que protegerse.
    csrf: { trustedOrigins: ['*'] }
  }
};
