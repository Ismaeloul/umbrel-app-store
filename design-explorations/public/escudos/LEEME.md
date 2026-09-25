# Escudos reales (opcional)

El prototipo genera escudos propios con los colores de cada club. Si quieres ver los reales,
pon aquí un fichero por equipo con el **id** del equipo como nombre (los ids están en
`src/core/data/teams.ts`: `rma`, `fcb`, `ath`, `psg`, `esp-nt`…) y un `index.json` que los mapee:

```json
{ "rma": "rma.png", "fcb": "fcb.svg", "ath": "ath.png" }
```

Valen PNG, SVG o WebP, mejor cuadrados y con fondo transparente (los de 128–256 px sobran).
Los equipos que no estén en el índice siguen con el escudo generado; si una imagen falla,
también.

## Rellenarla sola

```bash
node scripts/escudos.mjs
```

Busca cada equipo en TheSportsDB (API pública, clave de prueba «3»; pon la tuya en
`THESPORTSDB_KEY`) y descarga su escudo. Esta carpeta está fuera del repositorio
(`.gitignore`): los escudos son marcas de cada club y se quedan solo en tu máquina.

## En la app real

El servidor (Fastify) haría lo mismo una vez por equipo al montar la agenda, con caché en disco
y una ruta `/api/v1/teams/:id/crest`; los clientes (web y SwiftUI) pintan la imagen y caen al
escudo generado si no hay. Así el paquete de la app no lleva ningún logo dentro.
