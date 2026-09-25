#!/usr/bin/env node
/* Genera la imagen «Marca» del Asset Catalog de la app iOS desde el icono de la web
   (apps/web/public/icon.svg, la variante oscura por defecto; b-arquitectura §1.2, §0.3 «Icono»):
   96 pt a @2x y @3x, UNA sola variante (sin claro/oscuro). La usan la pantalla de emparejar y la
   carátula de Now Playing.

   Lo que ya NO hace (fase 0.4): los colores salen de Palco/Tokens/ColoresPalco.generado.swift
   (generar-tokens.mjs), así que no escribe colorsets; el AppIcon (claro, oscuro y tintado) se queda
   intacto (decisión 8) y no se toca. `Colores/Bg.colorset` (lo exige UILaunchScreen) y
   `AccentColor.colorset` tampoco se tocan.

   Los PNG se pintan con Chrome (Playwright, `channel: 'chrome'`) dibujando el SVG en un canvas del
   tamaño exacto, y se codifican aquí en RGB sin alfa (el icono es opaco).

   Uso (desde ace-player-neo, en Windows o en un Mac):
     node apps/ios/scripts/generar-recursos.mjs */

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const IOS = path.resolve(AQUI, '..');
const RAIZ = path.resolve(IOS, '../..');
const ICONO_WEB = path.join(RAIZ, 'apps/web/public/icon.svg');
const CATALOGO = path.join(IOS, 'Resources/Assets.xcassets');
// Playwright se busca junto a la web (el monorepo instalado); ACE_MODULOS permite apuntar a otro sitio.
const require = createRequire(process.env.ACE_MODULOS ?? path.join(RAIZ, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

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

const svg = readFileSync(ICONO_WEB, 'utf8');
const navegador = await chromium.launch({ channel: 'chrome' });
try {
  const pagina = await navegador.newPage();
  await pagina.setContent('<!doctype html><html><body></body></html>');
  const marca = path.join(CATALOGO, 'Marca.imageset');
  rmSync(marca, { recursive: true, force: true });
  mkdirSync(marca, { recursive: true });
  const imagenes = [];
  for (const escala of [2, 3]) {
    const fichero = `marca@${escala}x.png`;
    writeFileSync(path.join(marca, fichero), await pintar(pagina, svg, 96 * escala));
    imagenes.push({ filename: fichero, idiom: 'universal', scale: `${escala}x` });
  }
  escribirJSON(path.join(marca, 'Contents.json'), { images: imagenes, info: INFO });
} finally {
  await navegador.close();
}
console.log('Marca.imageset listo (apps/web/public/icon.svg, 96 pt @2x y @3x, una sola variante).');
