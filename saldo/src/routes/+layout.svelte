<script lang="ts">
  // Las fuentes viajan dentro de la imagen: la app vive en una red privada y
  // no debe depender de que el NAS tenga salida a internet para verse bien.
  import '@fontsource/roboto/400.css';
  import '@fontsource/roboto/500.css';
  import '@fontsource/roboto/700.css';
  import '@fontsource/roboto-mono/400.css';
  import '@fontsource/roboto-mono/500.css';
  import '../app.css';

  let { children } = $props();
</script>

{@render children()}
