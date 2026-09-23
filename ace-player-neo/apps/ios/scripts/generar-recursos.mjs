#!/usr/bin/env node
/* Genera el Asset Catalog de la app iOS a partir del diseño «Luz de focos»:

   - AppIcon: icono claro (apariencia por defecto), oscuro y tintado, a
     1024 × 1024. Con iOS 17 como mínimo, Xcode solo pide ese tamaño (icono de
     tamaño único) y saca el resto al compilar.
   - Marca: el mismo icono a 96 pt (@2x y @3x) en claro y oscuro, para la
     pantalla de emparejamiento.
   - Colores: un colorset por token, con su valor claro y oscuro, sacados del
     respaldo en hex de apps/web/src/styles/tokens.css (conversión exacta de
     los OKLCH que usa la web).

   Los PNG se pintan con Chrome (Playwright, `channel: 'chrome'`) dibujando el
   SVG en un canvas del tamaño exacto, y se codifican aquí en RGB sin canal
   alfa (el icono principal no puede llevar transparencia).

   Uso (desde ace-player-neo, en Windows o en un Mac):
     node apps/ios/scripts/generar-recursos.mjs */

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(AQUI, '..');
const RAIZ = path.resolve(IOS, '../..');
const DISENO = path.join(RAIZ, 'docs/diseno/opcion-A');
const TOKENS = path.join(RAIZ, 'apps/web/src/styles/tokens.css');
const CATALOGO = path.join(IOS, 'Resources/Assets.xcassets');

const INFO = { author: 'xcode', version: 1 };

// --- PNG sin dependencias (RGB de 8 bits) ---

const TABLA_CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** RGBA del canvas → PNG RGB (tipo de color 2), compuesto sobre negro. */
function pngRGB(ancho, alto, rgba) {
  const fila = ancho * 3 + 1;
  const crudo = Buffer.alloc(fila * alto);
  for (let y = 0; y < alto; y += 1) {
    crudo[y * fila] = 0;
    for (let x = 0; x < ancho; x += 1) {
      const i = (y * ancho + x) * 4;
      const a = rgba[i + 3] / 255;
      const o = y * fila + 1 + x * 3;
      crudo[o] = Math.round(rgba[i] * a);
      crudo[o + 1] = Math.round(rgba[i + 1] * a);
      crudo[o + 2] = Math.round(rgba[i + 2] * a);
    }
  }
  const cabecera = Buffer.alloc(13);
  cabecera.writeUInt32BE(ancho, 0);
  cabecera.writeUInt32BE(alto, 4);
  cabecera[8] = 8;
  cabecera[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', cabecera),
    trozo('IDAT', zlib.deflateSync(crudo, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

async function pintar(pagina, svg, lado) {
  const b64 = await pagina.evaluate(
    async ({ svg, lado }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = lado;
      canvas.height = lado;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, lado, lado);
      const datos = ctx.getImageData(0, 0, lado, lado).data;
      let bin = '';
      for (let i = 0; i < datos.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, datos.subarray(i, i + 0x8000));
      }
      return btoa(bin);
    },
    { svg, lado },
  );
  return pngRGB(lado, lado, Buffer.from(b64, 'base64'));
}

function escribirJSON(ruta, datos) {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify(datos, null, 2) + '\n');
}

// --- Colores ---

function bloqueHex(css, selector) {
  const inicio = css.indexOf(selector + ' {', css.indexOf('Colores · respaldo en hex'));
  if (inicio < 0) throw new Error(`No encuentro ${selector} en tokens.css`);
  const fin = css.indexOf('\n}', inicio);
  const valores = {};
  for (const m of css.slice(inicio, fin).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)) {
    valores[m[1]] = m[2].toLowerCase();
  }
  return valores;
}

const COLORES = [
  ['bg', 'Bg'],
  ['bg-sunk', 'BgSunk'],
  ['surface', 'Surface'],
  ['surface-2', 'Surface2'],
  ['line', 'Line'],
  ['line-strong', 'LineStrong'],
  ['text', 'Text'],
  ['text-2', 'Text2'],
  ['text-3', 'Text3'],
  ['accent', 'Accent'],
  ['on-accent', 'OnAccent'],
  ['accent-ink', 'AccentInk'],
  ['accent-edge', 'AccentEdge'],
  ['ok', 'Ok'],
  ['ok-ink', 'OkInk'],
  ['weak', 'Weak'],
  ['weak-ink', 'WeakInk'],
  ['fail', 'Fail'],
  ['fail-ink', 'FailInk'],
  ['glass-solid', 'GlassSolid'],
];

function componentes(hex) {
  const n = (i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3);
  return { 'color-space': 'srgb', components: { red: n(1), green: n(3), blue: n(5), alpha: '1.000' } };
}

function colorset(claro, oscuro) {
  return {
    colors: [
      { color: componentes(claro), idiom: 'universal' },
      {
        appearances: [{ appearance: 'luminosity', value: 'dark' }],
        color: componentes(oscuro),
        idiom: 'universal',
      },
    ],
    info: INFO,
  };
}

function generarColores() {
  const css = readFileSync(TOKENS, 'utf8');
  const claro = bloqueHex(css, ':root');
  const oscuro = { ...claro, ...bloqueHex(css, ":root[data-scheme='dark']") };
  const dir = path.join(CATALOGO, 'Colores');
  rmSync(dir, { recursive: true, force: true });
  escribirJSON(path.join(dir, 'Contents.json'), { info: INFO, properties: { 'provides-namespace': false } });
  for (const [token, nombre] of COLORES) {
    if (!claro[token] || !oscuro[token]) throw new Error(`Falta el token --${token}`);
    escribirJSON(path.join(dir, `${nombre}.colorset/Contents.json`), colorset(claro[token], oscuro[token]));
  }
  // Color de acento global (tinte de los controles): el cielo que se lee como texto.
  escribirJSON(
    path.join(CATALOGO, 'AccentColor.colorset/Contents.json'),
    colorset(claro['accent-ink'], oscuro['accent-ink']),
  );
  return COLORES.length + 1;
}

// --- Imágenes ---

async function generarImagenes() {
  const svg = (nombre) => readFileSync(path.join(DISENO, nombre), 'utf8');
  const claro = svg('icono-claro.svg');
  const oscuro = svg('icono.svg');
  const tintado = svg('icono-tintado.svg');

  const navegador = await chromium.launch({ channel: 'chrome' });
  try {
    const pagina = await navegador.newPage();
    await pagina.setContent('<!doctype html><html><body></body></html>');

    const icono = path.join(CATALOGO, 'AppIcon.appiconset');
    rmSync(icono, { recursive: true, force: true });
    mkdirSync(icono, { recursive: true });
    const variantes = [
      ['AppIcon-claro.png', claro, null],
      ['AppIcon-oscuro.png', oscuro, 'dark'],
      ['AppIcon-tintado.png', tintado, 'tinted'],
    ];
    const images = [];
    for (const [fichero, fuente, apariencia] of variantes) {
      writeFileSync(path.join(icono, fichero), await pintar(pagina, fuente, 1024));
      images.push({
        ...(apariencia ? { appearances: [{ appearance: 'luminosity', value: apariencia }] } : {}),
        filename: fichero,
        idiom: 'universal',
        platform: 'ios',
        size: '1024x1024',
      });
    }
    escribirJSON(path.join(icono, 'Contents.json'), { images, info: INFO });

    const marca = path.join(CATALOGO, 'Marca.imageset');
    rmSync(marca, { recursive: true, force: true });
    mkdirSync(marca, { recursive: true });
    const imagenesMarca = [];
    for (const [sufijo, fuente, apariencia] of [
      ['claro', claro, null],
      ['oscuro', oscuro, 'dark'],
    ]) {
      for (const escala of [2, 3]) {
        const fichero = `marca-${sufijo}@${escala}x.png`;
        writeFileSync(path.join(marca, fichero), await pintar(pagina, fuente, 96 * escala));
        imagenesMarca.push({
          ...(apariencia ? { appearances: [{ appearance: 'luminosity', value: apariencia }] } : {}),
          filename: fichero,
          idiom: 'universal',
          scale: `${escala}x`,
        });
      }
    }
    escribirJSON(path.join(marca, 'Contents.json'), { images: imagenesMarca, info: INFO });
  } finally {
    await navegador.close();
  }
}

escribirJSON(path.join(CATALOGO, 'Contents.json'), { info: INFO });
const colores = generarColores();
await generarImagenes();
console.log(`Asset Catalog listo: 3 variantes del icono, la marca y ${colores} colores.`);
