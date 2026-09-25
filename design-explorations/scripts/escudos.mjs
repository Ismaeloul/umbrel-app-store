#!/usr/bin/env node
/* Rellena `public/escudos/` con los escudos reales de los equipos del prototipo.
   No se ejecuta solo: lo lanza Isma cuando quiera (los escudos son marcas de cada club;
   para uso personal en su propio Umbrel está bien, pero la decisión es suya).

   Fuente: TheSportsDB (https://www.thesportsdb.com), API pública con clave de prueba «3»
   (o la tuya en la variable THESPORTSDB_KEY). Descarga el «badge» PNG de cada equipo
   buscándolo por nombre y escribe `public/escudos/index.json` con el mapa id → fichero.
   Los que no encuentre los deja con el escudo generado.

   Uso:  node scripts/escudos.mjs            (todos)
         node scripts/escudos.mjs rma fcb    (solo esos ids)
         THESPORTSDB_KEY=xxxx node scripts/escudos.mjs

   También vale a mano: copia `rma.png`, `fcb.svg`… (nombre = id del equipo en
   src/core/data/teams.ts) en public/escudos/ y añade la entrada al index.json. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'public', 'escudos');
const KEY = process.env.THESPORTSDB_KEY ?? '3';
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

// Nombres tal y como los conoce TheSportsDB (cuando difieren del nombre del prototipo).
const SEARCH = {
  fcb: 'Barcelona',
  atm: 'Atletico Madrid',
  ath: 'Athletic Bilbao',
  rso: 'Real Sociedad',
  bet: 'Real Betis',
  cel: 'Celta Vigo',
  ala: 'Alaves',
  lev: 'Levante',
  ovi: 'Real Oviedo',
  mci: 'Manchester City',
  mun: 'Manchester United',
  tot: 'Tottenham Hotspur',
  new: 'Newcastle United',
  bha: 'Brighton',
  whu: 'West Ham United',
  int: 'Inter Milan',
  mil: 'AC Milan',
  rom: 'AS Roma',
  bay: 'Bayern Munich',
  bvb: 'Borussia Dortmund',
  lev4: 'Bayer Leverkusen',
  rbl: 'RB Leipzig',
  psg: 'Paris SG',
  om: 'Marseille',
  ben: 'Benfica',
  por: 'FC Porto',
  spo: 'Sporting CP',
  aja: 'Ajax',
  gal: 'Galatasaray',
  sla: 'Slavia Prague',
  'esp-nt': 'Spain',
  'mar-nt': 'Morocco',
  'fra-nt': 'France',
  'ale-nt': 'Germany',
  'por-nt': 'Portugal',
  'ita-nt': 'Italy',
  'ing-nt': 'England',
  'arg-nt': 'Argentina',
  'bra-nt': 'Brazil',
  rac: 'Racing Santander',
  zar: 'Real Zaragoza',
  cad: 'Cadiz',
  spg: 'Sporting Gijon',
  bur: 'Burgos',
  leg: 'Leganes',
  esp: 'Espanyol',
  mll: 'Mallorca',
  ray: 'Rayo Vallecano',
  get: 'Getafe',
  osa: 'Osasuna',
  gir: 'Girona',
  val: 'Valencia',
  vil: 'Villarreal',
  sev: 'Sevilla',
  elc: 'Elche',
  rma: 'Real Madrid',
  ars: 'Arsenal',
  liv: 'Liverpool',
  che: 'Chelsea',
  avl: 'Aston Villa',
  juv: 'Juventus',
  nap: 'Napoli',
  ata: 'Atalanta',
};

// Lee los ids y nombres del fichero de equipos sin importar TypeScript.
const src = fs.readFileSync(path.join(root, 'src', 'core', 'data', 'teams.ts'), 'utf8');
const teams = [...src.matchAll(/T\('([^']+)',\s*'([^']+)'/g)].map((m) => ({ id: m[1], name: m[2] }));
const wanted = only.length ? teams.filter((t) => only.includes(t.id)) : teams;

fs.mkdirSync(outDir, { recursive: true });
const indexPath = path.join(outDir, 'index.json');
const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
const missing = [];
for (const t of wanted) {
  const q = SEARCH[t.id] ?? t.name;
  const isNational = t.id.endsWith('-nt');
  try {
    const url = `https://www.thesportsdb.com/api/v1/json/${KEY}/searchteams.php?t=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { 'user-agent': 'ace-player-neo-prototipo' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const list = (j.teams ?? []).filter((x) => x.strSport === 'Soccer');
    const pick = list.find((x) => (isNational ? /national|nacional/i.test(x.strTeam + ' ' + (x.strLeague ?? '')) || x.strCountry?.toLowerCase() === q.toLowerCase() : true)) ?? list[0];
    const badge = pick?.strBadge ?? pick?.strTeamBadge;
    if (!badge) throw new Error('sin resultado');
    const img = await fetch(`${badge}/small`).then((x) => (x.ok ? x : fetch(badge)));
    if (!img.ok) throw new Error(`badge HTTP ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    const file = `${t.id}.png`;
    fs.writeFileSync(path.join(outDir, file), buf);
    index[t.id] = file;
    ok++;
    console.log(`ok  ${t.id.padEnd(7)} ${t.name} ← ${pick.strTeam}`);
  } catch (e) {
    missing.push(t.id);
    console.log(`--  ${t.id.padEnd(7)} ${t.name}: ${String(e.message ?? e)}`);
  }
  await sleep(350); // la API pública pide calma
}
fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
console.log(`\n${ok} escudos guardados en public/escudos · ${missing.length} sin escudo${missing.length ? ` (${missing.join(', ')})` : ''}`);
console.log('Recarga la app: los equipos con escudo lo enseñan; el resto sigue con el generado.');
