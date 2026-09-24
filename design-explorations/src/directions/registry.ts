import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/* Las cinco direcciones. Cada carpeta exporta `Web` e `Iphone` por defecto
   desde `web.tsx` e `iphone.tsx`. Aquí solo hay metadatos para la galería. */

export interface DirectionMeta {
  id: number;
  slug: string;
  name: string;
  tagline: string;
  concept: string;
  swatches: string[];
  Web: LazyExoticComponent<ComponentType>;
  Iphone: LazyExoticComponent<ComponentType>;
}

export const DIRECTIONS: DirectionMeta[] = [
  {
    id: 1,
    slug: 'tribuna',
    name: 'Tribuna',
    tagline: 'Nativo Apple editorial',
    concept: 'Calma de Apple TV y Apple Sports: tipografía grande, Liquid Glass solo en lo que flota, el partido como portada. En iPhone es SwiftUI puro.',
    swatches: ['#f5f4f0', '#1c1c1e', '#e3452f', '#0a84ff'],
    Web: lazy(() => import('./01-tribuna/web')),
    Iphone: lazy(() => import('./01-tribuna/iphone')),
  },
  {
    id: 2,
    slug: 'pizarra',
    name: 'Pizarra',
    tagline: 'Centro de datos deportivo',
    concept: 'Denso y rápido de escanear, como FotMob o Sofascore: la señal y el marcador mandan, filas de 52 pt, todo en una pantalla.',
    swatches: ['#0f1115', '#f4f6f8', '#2ecc71', '#f2b134'],
    Web: lazy(() => import('./02-pizarra/web')),
    Iphone: lazy(() => import('./02-pizarra/iphone')),
  },
  {
    id: 3,
    slug: 'palco',
    name: 'Palco',
    tagline: 'Cinemático video-first',
    concept: 'El partido en directo es el protagonista: hero a pantalla completa, controles que flotan sobre la imagen, todo lo demás se aparta.',
    swatches: ['#05070a', '#ffffff', '#ff3b30', '#ffd60a'],
    Web: lazy(() => import('./03-palco/web')),
    Iphone: lazy(() => import('./03-palco/iphone')),
  },
  {
    id: 4,
    slug: 'consola',
    name: 'Consola',
    tagline: 'Herramienta pro minimalista',
    concept: 'Precisión de Linear y Arc: paleta de comandos, atajos en todo, cero ruido, densidad ajustable. Pensada para el escritorio y la segunda pantalla.',
    swatches: ['#08090a', '#f7f8f8', '#5e6ad2', '#59d499'],
    Web: lazy(() => import('./04-consola/web')),
    Iphone: lazy(() => import('./04-consola/iphone')),
  },
  {
    id: 5,
    slug: 'transistor',
    name: 'Transistor',
    tagline: 'Carta libre',
    concept: 'El partido como una radio de bolsillo: un dial de intensidad que sube con el gol, marcador que se lleva en el bolsillo, teletexto reinterpretado para la señal.',
    swatches: ['#f2ead9', '#1a1612', '#ff5a36', '#00b3a4'],
    Web: lazy(() => import('./05-transistor/web')),
    Iphone: lazy(() => import('./05-transistor/iphone')),
  },
];

export function directionById(id: number | null): DirectionMeta | undefined {
  return DIRECTIONS.find((d) => d.id === id);
}
