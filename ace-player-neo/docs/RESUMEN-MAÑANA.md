# Resumen para Isma

Todo está en la rama **`rewrite-v2`** del repo `Ismaeloul/umbrel-app-store`
(y en `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store`).
**No he publicado nada**: `main`, las etiquetas y tu Umbrel siguen en la
0.6.59.

## Qué está hecho

- **Backend nuevo** (Fastify + TypeScript): todas las rutas de siempre
  siguen igual, más `/api/v1`, SSE, sesiones del motor sin zombis y
  compartidas, vigilante del motor que se recupera solo, y la app de iPhone
  entrando por `/native/` con token. 1.294 tests.
- **Web nueva** con el diseño «Luz de focos» que elegiste: todo lo de la
  0.6.59 más dispositivos, "Abrir en…", ayuda de atajos, Media Session y PiP.
  668 tests unitarios + 40 E2E, accesibilidad 100.
- **Probada contra el motor real** en tu Chrome, con una copia de tus datos,
  y un soak de 30 min: **0 cortes**.
- **App de iPhone "Ace Neo"**: compila y pasa sus tests en GitHub Actions y
  deja la **IPA sin firmar** como artefacto (detalles en `ios.md`).
- **Release 0.7.0 cortada** en la carpeta de la app, lista para publicar,
  con el plan para volver atrás.

## Decisiones que conviene que revises

1. **D5**: dos dispositivos con el **mismo canal comparten** la sesión (antes
   uno echaba al otro). Si prefieres lo de antes: Ajustes → "Un solo
   dispositivo a la vez".
2. **D3**: la 0.7.0 sigue usando la imagen oficial de Node (no dependemos de
   GHCR).
3. **D6**: las fuentes HEVC cuentan como buenas en el iPhone (el remux las
   reproduce).
4. **LCP de 2,7 s en 4G lento** por la tipografía del diseño: ¿se deja o se
   cambia la fuente?
5. **Las releaseNotes** de la 0.7.0 en `ismaeloul-ace-player-neo/umbrel-app.yml`.

El resto de decisiones (D1-D21) está en `decisiones.md`.

## Lo que queda pendiente y por qué

- **Probar en tu iPhone real**: PiP, pantalla de bloqueo, audio en segundo
  plano y AirPlay no se pueden probar sin el teléfono
  (`pruebas-iphone.md`).
- **Dos canales distintos a la vez** y el **paso a HLS con el motor real**
  cuando se une un segundo dispositivo: sin probar todavía.
- Lighthouse de las vistas con vídeo (87-88) y el LCP (2,7 s en 4G).
- Todo lo demás, con detalle, en `INFORME.md` §5 y `pendiente.md`.

## Dónde está cada cosa

- **Capturas**: `docs/capturas/fase2/` (web, una selección; las ~480 están
  en tu PC), `docs/capturas/fase3/` (simulador de iOS) y
  `docs/diseno/opcion-A|B|C/capturas/` (las tres propuestas).
- **GIF** de la prueba con el motor real:
  `docs/capturas/gifs/ace-neo-v2-motor-real-reproducir-fuentes-mini.gif`.
- **IPA**: artefacto `AceNeo-unsigned-0.7.0` de la última ejecución en verde
  del workflow "iOS (Ace Neo)":
  https://github.com/Ismaeloul/umbrel-app-store/actions/runs/35886091911
  (cómo bajarla, firmarla con IPA Station e instalarla: `ios.md`).
- **Web de prueba en vivo** (mientras tu PC esté encendido):
  `http://pc.taila62835.ts.net:17800/__pasarela/login` por Tailscale. Para
  quitarla: `tailscale serve --http=17800 off` y
  `docker compose -p ace-prueba-isma down`.

## Qué revisar o probar primero

1. La web de prueba por Tailscale desde el móvil (la tienes ya).
2. Las decisiones de arriba, sobre todo D5.
3. Publicar la 0.7.0 siguiendo `despliegue.md` §7 (merge + etiqueta +
   Actualizar), con la vuelta atrás preparada.
4. Firmar la IPA con IPA Station y seguir `pruebas-iphone.md`.
5. Reinstalar a mano el vigilante del NAS (`monitoring/`), que las
   actualizaciones no copian.
