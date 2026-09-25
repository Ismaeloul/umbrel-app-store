/* Servidor para capturas: mismo proyecto, sin recarga en caliente (los cambios
   de ficheros no recargan la página a mitad de una captura). */
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(
  base,
  defineConfig({
    server: { host: '0.0.0.0', port: 5182, strictPort: true, hmr: false },
  }),
);
