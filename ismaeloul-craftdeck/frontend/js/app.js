/* =================== ICONS (Lucide-style, stroke) =================== */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  barChart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  map: '<path d="M14.1 5.6a2 2 0 0 0 1.8 0l3.7-1.9a1 1 0 0 1 1.4.9v12.8a1 1 0 0 1-.6.9l-4.5 2.3a2 2 0 0 1-1.8 0l-4.2-2.1a2 2 0 0 0-1.8 0l-3.7 1.9a1 1 0 0 1-1.4-.9V6.6a1 1 0 0 1 .6-.9l4.5-2.3a2 2 0 0 1 1.8 0z"/><path d="M15 5.8v15"/><path d="M9 3.2v15"/>',
  package: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><line x1="2" y1="12" x2="22" y2="12"/>',
  fileCode: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 12-2 2 2 2"/><path d="m14 16 2-2-2-2"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  play: '<path d="m6 3 14 9-14 9V3z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  crown: '<path d="M11.6 3.3a.5.5 0 0 1 .8 0l3 5.6a1 1 0 0 0 1.5.3l2.3-2a.5.5 0 0 1 .8.5l-2.8 10.2a1 1 0 0 1-1 .7H7.8a1 1 0 0 1-1-.7L4 7.7a.5.5 0 0 1 .8-.5l2.3 2a1 1 0 0 0 1.5-.3z"/><path d="M5 21h14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  crosshair: '<circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3"/><path d="M15 1v3"/><path d="M9 20v3"/><path d="M15 20v3"/><path d="M1 9h3"/><path d="M1 15h3"/><path d="M20 9h3"/><path d="M20 15h3"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  activity: '<path d="M22 12h-2.5a2 2 0 0 0-1.9 1.5l-2.4 8.4a.25.25 0 0 1-.5 0L9.2 2.2a.25.25 0 0 0-.4 0L6.3 10.5A2 2 0 0 1 4.5 12H2"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1 1 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronsUpDown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  sliders: '<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>',
  bell: '<path d="M10.3 21a2 2 0 0 0 3.4 0"/><path d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 6-2.7 7.3"/>',
  umbrella: '<path d="M12 2a10 10 0 0 1 10 10H2A10 10 0 0 1 12 2z"/><path d="M12 12v7a2 2 0 0 0 4 0"/>',
  box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  pickaxe: '<path d="M14.5 3.5 12 6 9.5 3.5a1 1 0 0 0-1.4 0L6.7 4.9a1 1 0 0 0 0 1.4L9.2 8.8 3 15v6h6l6.2-6.2 2.5 2.5a1 1 0 0 0 1.4 0l1.4-1.4a1 1 0 0 0 0-1.4L18 12l2.5-2.5"/>',
};
function icon(name, size=16){
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]||ICONS.box}</svg>`;
}
function hydrateIcons(root=document){
  root.querySelectorAll('i[data-icon]').forEach(el=>{
    el.outerHTML = icon(el.dataset.icon, parseInt(el.dataset.size||'16'));
  });
}

/* =================== STATE =================== */
const state = {
  online: false,
  players: [],
  mods: [
    { id:'sodium', name:'Sodium', ic:'zap', color:'var(--accent)', bg:'var(--accent-dim)', desc:'Optimización radical del renderizado. Duplica o triplica los FPS.', dl:'38.2M', ver:'0.6.5', installed:true, enabled:true, update:false, deps:[] },
    { id:'lithium', name:'Lithium', ic:'cpu', color:'var(--info)', bg:'var(--info-dim)', desc:'Optimiza ticks, IA y física del servidor sin cambiar el gameplay.', dl:'21.7M', ver:'0.14.3', installed:true, enabled:true, update:true, deps:[] },
    { id:'jei', name:'Just Enough Items', ic:'search', color:'var(--warn)', bg:'var(--warn-dim)', desc:'Visor de recetas e items. El imprescindible de todo modpack.', dl:'29.1M', ver:'19.5.0', installed:true, enabled:false, update:false, deps:[] },
    { id:'create', name:'Create', ic:'settings', color:'var(--danger)', bg:'var(--danger-dim)', desc:'Máquinas, engranajes, trenes y automatización con física preciosa.', dl:'18.4M', ver:'6.0.1', installed:false, enabled:false, update:false, deps:['Fabric API','Flywheel'] },
    { id:'terralith', name:'Terralith', ic:'map', color:'var(--violet)', bg:'var(--violet-dim)', desc:'Generación de mundo espectacular: +95 biomas sin items nuevos.', dl:'12.9M', ver:'2.5.4', installed:false, enabled:false, update:false, deps:[] },
    { id:'voicechat', name:'Simple Voice Chat', ic:'wifi', color:'#22d3ee', bg:'rgba(34,211,238,.1)', desc:'Chat de voz por proximidad. Grupos, susurros y más.', dl:'15.3M', ver:'2.5.26', installed:false, enabled:false, update:false, deps:[] },
    { id:'phosphor', name:'Phosphor', ic:'zap', color:'#facc15', bg:'rgba(250,204,21,.08)', desc:'Optimización del motor de iluminación (proyecto antiguo).', dl:'8.4M', ver:'0.8.1', installed:false, enabled:false, update:false, deps:[], conflicts:'lithium' },
    { id:'bluemap', name:'BlueMap', ic:'globe', color:'#38bdf8', bg:'rgba(56,189,248,.1)', desc:'Mapa 3D del mundo en el navegador. El que alimenta la pestaña Mapa.', dl:'6.1M', ver:'5.4', installed:false, enabled:false, update:false, deps:[] },
  ],
  packs: [
    { name:'Fabulously Optimized', desc:'Solo rendimiento: FPS altos sin cambiar el juego.', mods:38, dl:'9.2M', grad:'linear-gradient(120deg,#065f46,#0c4a6e)' },
    { name:'Adrenaline', desc:'Optimización + shaders listos para usar.', mods:52, dl:'3.1M', grad:'linear-gradient(120deg,#7c2d12,#831843)' },
    { name:'Cobblemon Official', desc:'Pokémon en Minecraft. Sí, en serio.', mods:74, dl:'5.8M', grad:'linear-gradient(120deg,#1e3a8a,#5b21b6)' },
  ],
  backups: [
    { name:'auto_2026-07-04_04-00', size:'1.21 GB', date:'Hoy · 04:00', auto:true },
    { name:'auto_2026-07-03_04-00', size:'1.19 GB', date:'Ayer · 04:00', auto:true },
    { name:'pre-mod_lithium', size:'1.18 GB', date:'2 jul · 18:22', auto:true },
    { name:'manual_antes-del-raid', size:'1.14 GB', date:'30 jun · 21:45', auto:false },
  ],
  events: [
    { ic:'database', color:'var(--info)', bg:'var(--info-dim)', name:'Backup automático', sched:'Diario · 04:00', on:true },
    { ic:'refresh', color:'var(--accent)', bg:'var(--accent-dim)', name:'Reinicio programado', sched:'Domingos · 06:00', on:true },
    { ic:'message', color:'#8b9cf9', bg:'rgba(88,101,242,.12)', name:'Aviso "reinicio en 5 min" en el chat', sched:'Domingos · 05:55', on:true },
    { ic:'zap', color:'var(--warn)', bg:'var(--warn-dim)', name:'Evento doble XP', sched:'Viernes · 18:00 → Dom 23:59', on:false },
    { ic:'bell', color:'var(--danger)', bg:'var(--danger-dim)', name:'Alerta a Discord si el server se cae', sched:'Al detectar crash', on:true },
    { ic:'trash', color:'var(--muted2)', bg:'rgba(255,255,255,.06)', name:'Purga de items tirados en el suelo', sched:'Cada 30 min', on:true },
  ],
  crashes: [
    { id:0, date:'2 jul · 03:12', file:'crash-2026-07-02_03.12.44-server.txt', analyzed:true,
      culprit:'Phosphor 0.8.1', reason:'Incompatible con Lithium: ambos reemplazan el motor de iluminación y sus mixins chocan.',
      fix:'Desinstala Phosphor. Lithium ya incluye esas optimizaciones y está mantenido.',
      stack:`java.lang.IllegalStateException: Mixin apply failed
  at me.jellysquid.mods.phosphor.mixin.LightEngineMixin
  <span class="hl">at me.jellysquid.mods.lithium.light.LithiumLightEngine  ← CONFLICTO</span>
  at net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:912)` },
    { id:1, date:'28 jun · 21:47', file:'crash-2026-06-28_21.47.03-server.txt', analyzed:true,
      culprit:'OutOfMemoryError', reason:'El servidor se quedó sin RAM con 7 jugadores explorando chunks nuevos a la vez.',
      fix:'Sube la RAM asignada de 4 a 6 GB en Configuración, o baja la distancia de renderizado a 8.',
      stack:`java.lang.OutOfMemoryError: Java heap space
  <span class="hl">at net.minecraft.world.chunk.ChunkGenerator.generate  ← SIN MEMORIA</span>
  at net.minecraft.server.world.ServerChunkManager` },
  ],
  audit: [],
  files: {
    'server.properties': { lang:'PROPERTIES', content:'#Minecraft server properties\n#Fri Jul 04 04:00:12 CET 2026\nmotd=Servidor de Isma \\u2014 powered by Umbrel\nmax-players=20\ndifficulty=normal\ngamemode=survival\npvp=true\nview-distance=10\nspawn-protection=16\nwhite-list=true\nenable-rcon=true\nrcon.port=25575\nlevel-seed=-4172144997902289642\nonline-mode=true' },
    'whitelist.json': { lang:'JSON', content:'[\n  { "uuid": "af59e3b6-…", "name": "Isma_Dev" },\n  { "uuid": "1b2c8d90-…", "name": "xX_Dragon_Xx" },\n  { "uuid": "9c1f4a77-…", "name": "Creeper_Hunter" },\n  { "uuid": "3e8b2f01-…", "name": "Luna_Craft" }\n]' },
    'ops.json': { lang:'JSON', content:'[\n  {\n    "uuid": "af59e3b6-…",\n    "name": "Isma_Dev",\n    "level": 4,\n    "bypassesPlayerLimit": true\n  }\n]' },
    'config/lithium.properties': { lang:'PROPERTIES', content:'# Lithium config\nmixin.ai.pathing=true\nmixin.alloc=true\nmixin.block.hopper=true\nmixin.entity.collisions=true\nmixin.world.tick_scheduler=true' },
    'config/craftdeck.yml': { lang:'YAML', content:'# CraftDeck panel config\nrcon:\n  host: 127.0.0.1\n  port: 25575\nbackups:\n  keep: 7\n  schedule: "0 4 * * *"\nnotifications:\n  discord: true\n  on_crash: true\n  on_join: false' },
  },
  servers: [],
  currentServer: 0,
  uptimeSec: 0,
  tpsHistory: [], cpuHistory: [], ramHistory: [],
  autoscroll: true,
  currentFile: 'server.properties',
  currentCrash: 0,
  modTab: 'mods',
  installed: { 'sodium':'instalado', 'lithium':'instalado', 'jei':'instalado' },
  disabled: {},
  lastHits: [],
};

/* =================== NAV =================== */
const NAV = [
  { group:'SERVIDOR', items:[
    { id:'dashboard', label:'Dashboard', ic:'dashboard' },
    { id:'console', label:'Consola', ic:'terminal' },
    { id:'players', label:'Jugadores', ic:'users', badge:'navPlayerCount' },
    { id:'stats', label:'Estadísticas', ic:'barChart', demo:true },
    { id:'map', label:'Mapa en vivo', ic:'map', demo:true },
  ]},
  { group:'CONTENIDO', items:[
    { id:'mods', label:'Mods', ic:'package', badge:'navModCount', badgeWarn:true, demo:true },
    { id:'world', label:'Mundo', ic:'globe' },
    { id:'files', label:'Archivos', ic:'fileCode' },
  ]},
  { group:'OPERACIONES', items:[
    { id:'events', label:'Eventos', ic:'calendar', demo:true },
    { id:'backups', label:'Backups', ic:'database' },
    { id:'crashes', label:'Diagnóstico', ic:'alert', demo:true },
  ]},
  { group:'SISTEMA', items:[
    { id:'integrations', label:'Integraciones', ic:'share', demo:true },
    { id:'audit', label:'Auditoría', ic:'list' },
  ]},
];
const titles = {};
document.getElementById('navContainer').innerHTML = NAV.map(g =>
  `<div class="nav-group">${g.group}</div>` +
  g.items.map(it=>{
    titles[it.id] = it.label;
    return `<div class="nav-item${it.id==='dashboard'?' active':''}" data-section="${it.id}">
      ${icon(it.ic,16)} ${it.label}
      ${it.demo?'<span class="nav-badge" style="background:rgba(255,255,255,.06);color:var(--muted)">demo</span>':''}
      ${it.badge?`<span class="nav-badge${it.badgeWarn?' warn':''}" id="${it.badge}"></span>`:''}
    </div>`;
  }).join('')
).join('');

function go(id){
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active', n.dataset.section===id));
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('visible'));
  const el = document.getElementById('sec-'+id);
  el.classList.remove('visible'); void el.offsetWidth;
  el.classList.add('visible');
  document.getElementById('pageTitle').textContent = titles[id];
  if(id==='map') requestAnimationFrame(drawMapBase);
  if(id==='world' && typeof loadWorld==='function') loadWorld();
  if(id==='files') loadFiles();
  if(id==='audit') loadAudit();
  if(id==='backups') loadBackups();
  if(id==='players' && typeof refreshPlayerLists==='function') refreshPlayerLists();
}
document.querySelectorAll('.nav-item').forEach(item=>{
  item.addEventListener('click', ()=>go(item.dataset.section));
});

/* =================== SERVER SWITCHER =================== */
document.getElementById('logoMark').innerHTML = icon('pickaxe',17);
document.getElementById('umbrelIcon').innerHTML = icon('umbrella',13);
document.getElementById('ssChevron').innerHTML = icon('chevronsUpDown',14);
function renderServerMenu(){
  document.getElementById('ssMenu').innerHTML = state.servers.map((s,i)=>`
    <div class="ss-item" onclick="pickServer(${i})">
      <span class="ss-dot" style="background:${s.status==='online'?'var(--accent)':'var(--danger)'}"></span>
      ${s.name}<small>${s.status==='online'?'en línea':'detenido'}</small>
    </div>`).join('') +
    `<div class="ss-item" style="color:var(--muted2)" onclick="openCreateWizard()">${icon('plus',14)} Crear servidor…</div>`;
}
function toggleServerMenu(e){ e.stopPropagation(); document.getElementById('ssMenu').classList.toggle('open'); }
document.addEventListener('click', ()=>document.getElementById('ssMenu').classList.remove('open'));
function pickServer(i){
  state.currentServer = i;
  const s = state.servers[i];
  if(!s) return;
  document.getElementById('ssName').textContent = s.name;
  document.getElementById('ssSub').textContent = s.sub;
  document.getElementById('ssDot').style.background = s.status==='online'?'var(--accent)':'var(--danger)';
  if(typeof onServerSwitched==='function') onServerSwitched();
}
renderServerMenu();

/* =================== TOASTS =================== */
const TOAST_COLORS = { ok:['var(--accent-dim)','var(--accent)'], warn:['var(--warn-dim)','var(--warn)'], err:['var(--danger-dim)','var(--danger)'], info:['var(--info-dim)','var(--info)'] };
function toast(ic, msg, type='ok'){
  const [bg,color] = TOAST_COLORS[type]||TOAST_COLORS.ok;
  const zone = document.getElementById('toastZone');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span class="t-icon" style="background:${bg};color:${color}">${icon(ic,15)}</span><span>${msg}</span>`;
  zone.appendChild(t);
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(),340); }, 4200);
}
function copied(){ toast('check','Copiado al portapapeles','ok'); }

/* =================== AUDIT =================== */
const AUDIT_COLORS = { info:['var(--info-dim)','var(--info)'], warn:['var(--warn-dim)','var(--warn)'], err:['var(--danger-dim)','var(--danger)'], ok:['var(--accent-dim)','var(--accent)'] };
function addAudit(ic, text, type='info', when=null){
  state.audit.unshift({ ic, text, type, when: when || new Date().toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) });
  if(state.audit.length>60) state.audit.pop();
  renderAudit();
}
function renderAudit(){
  document.getElementById('auditList').innerHTML = state.audit.map((a,i)=>{
    const [bg,color] = AUDIT_COLORS[a.type]||AUDIT_COLORS.info;
    return `<div class="audit-row" style="animation-delay:${Math.min(i*0.03,.3)}s">
      <span class="audit-time">${a.when}</span>
      <span class="audit-icon" style="background:${bg};color:${color}">${icon(a.ic,13)}</span>
      <span><b style="font-weight:620">isma</b> · ${a.text}</span>
    </div>`;
  }).join('') || '<div class="empty">Sin actividad registrada</div>';
}
async function loadAudit(){
  try {
    const rows = await API.get('/audit');
    state.audit = rows.map(r=>({
      ic: ICONS[r.action] ? r.action : 'list',
      text: r.detail,
      type: r.level,
      when: new Date(r.at).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}),
    }));
    renderAudit();
    renderActivity();
  } catch { /* backend no disponible */ }
}
function renderActivity(){
  const colors = { info:'var(--info)', warn:'var(--warn)', err:'var(--danger)', ok:'var(--accent)' };
  document.getElementById('activityFeed').innerHTML = state.audit.slice(0,5).map(a=>`
    <div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:12.5px;">
      <span style="color:${colors[a.type]||'var(--muted2)'};display:flex">${icon(a.ic,14)}</span>
      <span style="flex:1">${a.text}</span>
      <span style="color:var(--muted);font-size:11.5px">${a.when}</span>
    </div>`).join('') || '<div class="empty" style="padding:16px">Sin actividad todavía</div>';
}

/* =================== SERVER LIFECYCLE =================== */
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnRestart = document.getElementById('btnRestart');
btnStop.innerHTML = icon('stop',14)+' Detener';
btnRestart.innerHTML = icon('refresh',14)+' Reiniciar';
btnStart.innerHTML = icon('play',14)+' Iniciar';

function setStatus(mode){
  statusDot.className = 'dot '+mode;
  if(mode==='online'){ statusText.textContent='En línea'; state.online=true; btnStart.disabled=true; btnStop.disabled=false; btnRestart.disabled=false; }
  if(mode==='offline'){ statusText.textContent='Detenido'; state.online=false; btnStart.disabled=false; btnStop.disabled=true; btnRestart.disabled=true; }
  if(mode==='starting'){ statusText.textContent='Arrancando…'; btnStart.disabled=true; btnStop.disabled=true; btnRestart.disabled=true; }
}
btnStop.onclick = async ()=>{
  try { btnStop.disabled = true; await API.post(`/servers/${curServerId()}/stop`); toast('stop','Servidor detenido','warn'); }
  catch(err){ toast('alert', err.message, 'err'); btnStop.disabled = false; }
};
btnStart.onclick = async ()=>{
  try { btnStart.disabled = true; toast('play','Arrancando servidor…','info'); await API.post(`/servers/${curServerId()}/start`); }
  catch(err){ toast('alert', err.message, 'err'); btnStart.disabled = false; }
};
btnRestart.onclick = async ()=>{
  try { btnRestart.disabled = true; toast('refresh','Reiniciando servidor…','info'); await API.post(`/servers/${curServerId()}/restart`); }
  catch(err){ toast('alert', err.message, 'err'); btnRestart.disabled = false; }
};

/* =================== CONSOLE =================== */
const consoleBody = document.getElementById('consoleBody');
function ts(){ return new Date().toTimeString().slice(0,8); }
function logLine(type,text){
  const cls = {info:'tag-info',warn:'tag-warn',err:'tag-err',cmd:'tag-cmd'}[type];
  const tag = {info:'INFO',warn:'WARN',err:'ERROR',cmd:'CMD'}[type];
  const line = document.createElement('div');
  line.className = 'console-line';
  line.innerHTML = `<span class="time">${ts()}</span> <span class="${cls}">${tag}</span> ${text}`;
  consoleBody.appendChild(line);
  if(consoleBody.children.length>300) consoleBody.firstChild.remove();
  if(state.autoscroll) consoleBody.scrollTop = consoleBody.scrollHeight;
}
function clearConsole(){ consoleBody.innerHTML=''; logLine('info','Consola limpiada'); }
function toggleAutoscroll(){
  state.autoscroll = !state.autoscroll;
  document.getElementById('btnAutoscroll').textContent = 'Auto-scroll: '+(state.autoscroll?'ON':'OFF');
}
const cmdInput = document.getElementById('cmdInput');
cmdInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendCommand(); });
async function sendCommand(){
  const cmd = cmdInput.value.trim();
  if(!cmd) return;
  cmdInput.value='';
  try { await API.post(`/servers/${curServerId()}/command`, { command: cmd }); }
  catch(err){ toast('alert', err.message, 'err'); }
}

/* =================== PLAYERS =================== */
function fmtDur(ms){
  const m = Math.floor(ms/60000);
  if(m<1) return 'recién conectado';
  if(m<60) return `${m} min`;
  return `${Math.floor(m/60)}h ${String(m%60).padStart(2,'0')}m`;
}
function renderPlayers(){
  const lists = state.playerLists || { ops:[], whitelist:[], banned:[] };
  const list = document.getElementById('playerList');
  if(!state.players.length) list.innerHTML = '<div class="empty">No hay nadie conectado ahora mismo</div>';
  else list.innerHTML = state.players.map((p,i)=>{
    const op = lists.ops.includes(p.name);
    return `
    <div class="player-row" style="animation-delay:${i*0.05}s">
      <div class="avatar">${p.name[0].toUpperCase()}</div>
      <div class="player-info">
        <div class="player-name">${p.name}
          ${op?'<span class="chip amber">OP</span>':''}
        </div>
        <div class="player-meta">${fmtDur(Date.now()-p.joinedAt)} en línea</div>
      </div>
      <div class="player-actions">
        <button class="icon-btn" title="${op?'Quitar OP':'Dar OP'}" onclick="playerAction('${p.name}','${op?'deop':'op'}')">${icon('crown',14)}</button>
        <button class="icon-btn red" title="Expulsar" onclick="playerAction('${p.name}','kick')">${icon('logout',14)}</button>
        <button class="icon-btn red" title="Banear" onclick="playerAction('${p.name}','ban')">${icon('ban',14)}</button>
      </div>
    </div>`;
  }).join('');
  document.getElementById('navPlayerCount').textContent = state.players.length;
  document.getElementById('statPlayers').textContent = state.players.length;
  document.getElementById('playersSubtitle').textContent =
    `${state.players.length} en línea · ${lists.whitelist.length} en whitelist · ${lists.banned.length} baneado${lists.banned.length===1?'':'s'}`;
  document.getElementById('mapPlayerCount').textContent = state.players.length;
}
async function playerAction(name, action){
  try {
    await API.post(`/servers/${curServerId()}/players/${encodeURIComponent(name)}/${action}`);
    const msgs = { op:`${name} ahora es operador`, deop:`${name} ya no es operador`, kick:`${name} expulsado`, ban:`${name} baneado` };
    toast(action==='ban'?'ban':action==='kick'?'logout':'crown', msgs[action]||name, action==='ban'?'err':action==='kick'?'warn':'ok');
    setTimeout(()=>{ if(typeof refreshPlayerLists==='function') refreshPlayerLists(); }, 600);
  } catch(err){ toast('alert', err.message, 'err'); }
}

/* =================== STATS TABLE =================== */
const statRows = [
  { n:'Isma_Dev', t:'184 h', d:23, b:'412.8k', m:'8,942', a:'87 / 122' },
  { n:'xX_Dragon_Xx', t:'156 h', d:67, b:'298.1k', m:'12,405', a:'74 / 122' },
  { n:'Luna_Craft', t:'121 h', d:12, b:'501.3k', m:'3,211', a:'91 / 122' },
  { n:'Creeper_Hunter', t:'98 h', d:104, b:'187.6k', m:'15,880', a:'62 / 122' },
  { n:'Steve_2010', t:'44 h', d:31, b:'92.4k', m:'2,077', a:'38 / 122' },
];
document.getElementById('statsBody').innerHTML = statRows.map((r,i)=>`
  <tr>
    <td><span class="rank r${i+1}">${i+1}</span></td>
    <td style="font-weight:600">${r.n}</td>
    <td>${r.t}</td><td>${r.d}</td><td>${r.b}</td><td>${r.m}</td>
    <td><span class="chip green">${r.a}</span></td>
  </tr>`).join('');

/* =================== MODS — API REAL DE MODRINTH =================== */
const MODRINTH_API = 'https://api.modrinth.com/v2';
const MC_VERSION = '1.21.1';
const CONFLICTS = { phosphor: 'lithium' };
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtNum(n){ return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n); }
function modUpdatesBadge(){
  const n = state.installed['lithium'] ? 1 : 0; // demo: lithium con update pendiente
  const b = document.getElementById('navModCount');
  b.textContent = n; b.style.display = n?'':'none';
}
let searchTimer = null;
function onModSearchInput(){
  clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>searchModrinth(document.getElementById('modSearch').value.trim()), 400);
}
async function searchModrinth(query){
  const grid = document.getElementById('modGrid');
  grid.innerHTML = '<div class="searching"><span class="spin"></span> Buscando en Modrinth…</div>';
  const facets = encodeURIComponent(JSON.stringify([["project_type:mod"],["categories:fabric"],[`versions:${MC_VERSION}`]]));
  const url = `${MODRINTH_API}/search?query=${encodeURIComponent(query)}&limit=12&index=${query?'relevance':'downloads'}&facets=${facets}`;
  try {
    const res = await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    state.lastHits = data.hits;
    renderModCards();
  } catch(err){
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No se pudo conectar con Modrinth. ¿Sin internet?<br><span style="font-family:var(--mono);font-size:11px">${esc(err.message)}</span></div>`;
    toast('alert','Sin conexión con la API de Modrinth','err');
  }
}
function renderModCards(){
  const grid = document.getElementById('modGrid');
  if(!state.lastHits.length){ grid.innerHTML = '<div class="empty" style="grid-column:1/-1">Sin resultados en Modrinth</div>'; return; }
  grid.innerHTML = state.lastHits.map((m,i)=>{
    const inst = !!state.installed[m.slug];
    const off = !!state.disabled[m.slug];
    const hasUpdate = inst && m.slug==='lithium';
    return `
    <div class="card mod-card" style="animation-delay:${i*0.04}s">
      <div class="mod-icon">${m.icon_url?`<img src="${esc(m.icon_url)}" alt="" loading="lazy">`:icon('package',20)}</div>
      <div class="mod-body">
        <div class="mod-title">${esc(m.title)}
          ${inst?'<span class="chip green">INSTALADO</span>':''}
          ${hasUpdate?'<span class="chip amber">ACTUALIZACIÓN</span>':''}
          ${CONFLICTS[m.slug]&&state.installed[CONFLICTS[m.slug]]?'<span class="chip red">CONFLICTO</span>':''}
        </div>
        <div class="mod-desc">${esc(m.description).slice(0,150)}</div>
        <div class="mod-stats">
          <span>${icon('download',11)} ${fmtNum(m.downloads)}</span>
          <span>${icon('users',11)} ${fmtNum(m.follows)}</span>
          <span class="chip blue">FABRIC ${MC_VERSION}</span>
        </div>
        <div style="margin-top:12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          ${inst?`
            <label class="switch" title="Activar / desactivar"><input type="checkbox" ${off?'':'checked'} onchange="toggleMod(${i})"><span class="track"></span><span class="thumb"></span></label>
            <button class="btn small danger" onclick="removeMod(${i})">${icon('trash',12)} Quitar</button>
          `:`
            <button class="btn small primary" id="install-${m.slug}" onclick="installMod(${i})">${icon('download',12)} Instalar</button>
          `}
          <button class="btn small" onclick="downloadJar(${i}, this)" title="Descarga el .jar real para pasárselo a tus amigos">${icon('download',12)} .jar</button>
        </div>
      </div>
    </div>`;
  }).join('');
  modUpdatesBadge();
}
function checkUpdates(){
  const n = state.installed['lithium']?1:0;
  toast('refresh', n?`${n} mod tiene una versión nueva disponible`:'Todo está actualizado', n?'warn':'ok');
}
function installMod(i){
  const m = state.lastHits[i];
  const rival = CONFLICTS[m.slug];
  if(rival && state.installed[rival]){
    toast('alert',`Conflicto detectado: ${m.title} es incompatible con ${rival}. Instalación bloqueada.`,'err');
    logLine('err',`[CraftDeck] Conflicto de mixins: ${m.slug} ↔ ${rival}. Instalación cancelada.`);
    addAudit('alert',`Instalación de ${m.title} bloqueada por conflicto con ${rival}`,'err');
    return;
  }
  const btn = document.getElementById('install-'+m.slug);
  if(btn){ btn.disabled=true; btn.textContent='Instalando…'; }
  toast('download',`Descargando ${m.title} desde Modrinth… (la copia a /mods es simulada)`,'info');
  setTimeout(()=>{
    state.installed[m.slug]=true;
    renderModCards();
    toast('check',`${m.title} instalado. Se cargará al reiniciar.`,'ok');
    logLine('info',`[CraftDeck] ${m.title} instalado en /mods (backup previo creado)`);
    addAudit('package',`Instaló ${m.title}`,'ok');
  },1600);
}
function removeMod(i){
  const m = state.lastHits[i];
  delete state.installed[m.slug]; delete state.disabled[m.slug];
  renderModCards();
  toast('trash',`${m.title} eliminado (recuperable 7 días)`,'warn');
  logLine('warn',`[CraftDeck] ${m.slug} movido a /mods/.trash`);
  addAudit('trash','Eliminó el mod '+m.title,'warn');
}
function toggleMod(i){
  const m = state.lastHits[i];
  if(state.disabled[m.slug]) delete state.disabled[m.slug]; else state.disabled[m.slug]=true;
  const on = !state.disabled[m.slug];
  toast(on?'check':'x',`${m.title} ${on?'activado':'desactivado'} · aplica al reiniciar`, on?'ok':'warn');
}
/* ---- descarga real de .jar desde el CDN de Modrinth ---- */
async function fetchJarFile(slug){
  const params = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(`["${MC_VERSION}"]`)}`;
  const res = await fetch(`${MODRINTH_API}/project/${slug}/version?${params}`);
  if(!res.ok) throw new Error('HTTP '+res.status);
  const versions = await res.json();
  if(!versions.length) throw new Error('sin versión compatible');
  const files = versions[0].files;
  return files.find(f=>f.primary) || files[0];
}
function triggerDownload(url, filename){
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}
async function downloadJar(i, btn){
  const m = state.lastHits[i];
  const original = btn.innerHTML;
  btn.disabled = true; btn.textContent = 'Buscando versión…';
  try {
    const file = await fetchJarFile(m.slug);
    triggerDownload(file.url, file.filename);
    toast('check',`Descargando ${file.filename} (${(file.size/1048576).toFixed(1)} MB)`,'ok');
    addAudit('download','Descargó '+file.filename,'info');
  } catch(err){
    toast('alert',`No hay .jar de ${m.title} para Fabric ${MC_VERSION}`,'err');
  }
  btn.disabled = false; btn.innerHTML = original;
}
async function downloadAllForFriends(){
  const slugs = Object.keys(state.installed);
  if(!slugs.length){ toast('alert','No tienes mods instalados','warn'); return; }
  toast('download',`Descargando los .jar de tus ${slugs.length} mods… acepta las descargas múltiples si el navegador pregunta`,'info');
  let ok = 0;
  for(const slug of slugs){
    try {
      const file = await fetchJarFile(slug);
      triggerDownload(file.url, file.filename);
      ok++;
      await new Promise(r=>setTimeout(r,900));
    } catch(e){ /* sin versión compatible para esta MC: se omite */ }
  }
  toast('check',`Pack listo: ${ok} de ${slugs.length} .jar descargados. Tus amigos solo tienen que copiarlos a su carpeta mods.`,'ok');
  addAudit('download',`Exportó el pack para amigos (${ok} mods)`,'ok');
}
function switchModTab(tab){
  state.modTab = tab;
  document.querySelectorAll('[data-modtab]').forEach(t=>t.classList.toggle('active',t.dataset.modtab===tab));
  document.getElementById('modtab-mods').style.display = tab==='mods'?'':'none';
  document.getElementById('modtab-packs').style.display = tab==='packs'?'':'none';
}
function renderPacks(){
  document.getElementById('packGrid').innerHTML = state.packs.map((p,i)=>`
    <div class="card" style="animation-delay:${i*0.06}s">
      <div class="pack-banner" style="background:${p.grad}"></div>
      <div style="font-weight:640; font-size:14.5px;">${p.name}</div>
      <div style="font-size:12px; color:var(--muted2); margin-top:4px; line-height:1.5;">${p.desc}</div>
      <div class="mod-stats" style="margin-top:10px;">
        <span>${icon('package',11)} ${p.mods} mods</span>
        <span>${icon('download',11)} ${p.dl}</span>
      </div>
      <button class="btn small primary" style="margin-top:13px;" onclick="installPack(this,'${p.name}',${p.mods})">${icon('download',12)} Instalar pack</button>
    </div>`).join('');
}
function installPack(btn, name, mods){
  btn.disabled = true;
  let n = 0;
  toast('database','Backup de seguridad previo creado','info');
  const iv = setInterval(()=>{
    n += Math.ceil(Math.random()*6);
    if(n>=mods){
      clearInterval(iv);
      btn.textContent = 'Instalado';
      toast('check',`Modpack «${name}» instalado: ${mods} mods listos`,'ok');
      addAudit('package',`Instaló el modpack ${name} (${mods} mods)`,'ok');
      logLine('info',`[CraftDeck] Modpack ${name} desplegado. Reinicia para cargar.`);
    } else btn.textContent = `Instalando ${Math.min(n,mods)}/${mods}…`;
  }, 320);
}

/* =================== GAME RULES =================== */
const RULES = [
  { key:'pvp', type:'prop', label:'PvP', sub:'Permite combate entre jugadores', def:true },
  { key:'white-list', type:'prop', label:'Whitelist', sub:'Solo entran jugadores aprobados', def:false },
  { key:'hardcore', type:'prop', label:'Modo hardcore', sub:'Una vida. Sin respawn.', def:false },
  { key:'generate-structures', type:'prop', label:'Generar estructuras', sub:'Aldeas, templos, fortalezas', def:true },
  { key:'spawn-monsters', type:'prop', label:'Mobs hostiles', sub:'Spawneo de criaturas enemigas', def:true },
  { key:'doDaylightCycle', type:'gamerule', label:'Ciclo día / noche', sub:'Se aplica al momento · requiere server encendido', def:true },
  { key:'keepInventory', type:'gamerule', label:'Keep inventory', sub:'Se aplica al momento · requiere server encendido', def:false },
];
function renderRules(props){
  document.getElementById('gameRules').innerHTML = RULES.map(r=>{
    const on = r.type==='prop' && props && props[r.key]!==undefined ? props[r.key]==='true' : r.def;
    return `<div class="toggle-row"><div><div class="t-label">${r.label}</div><div class="t-sub">${r.sub}</div></div>
    <label class="switch"><input type="checkbox" data-rule="${r.key}" data-ruletype="${r.type}" ${on?'checked':''} onchange="ruleChanged(this)"><span class="track"></span><span class="thumb"></span></label></div>`;
  }).join('');
}
renderRules(null);

/* =================== FILES =================== */
function fileLang(f){
  const ext = f.split('.').pop().toUpperCase();
  return { YML:'YAML', YAML:'YAML', PROPERTIES:'PROPERTIES', JSON:'JSON', TOML:'TOML', TXT:'TEXTO', CONF:'CONF', CFG:'CFG' }[ext] || ext;
}
function renderFileTree(){
  const roots = [], configs = [];
  (state.fileList||[]).forEach(f=> (f.includes('/')?configs:roots).push(f));
  const item = f=>`<div class="file-item${state.currentFile===f?' active':''}" onclick="openFile('${f}')">${icon('fileCode',13)} ${f.replace(/^[^/]+\//,'')}</div>`;
  document.getElementById('fileTree').innerHTML =
    `<div class="file-folder">RAÍZ DEL SERVIDOR</div>` + (roots.map(item).join('') || '<div class="empty" style="padding:10px;font-size:11px">vacío</div>') +
    (configs.length ? `<div class="file-folder">CONFIG /</div>` + configs.map(item).join('') : '');
}
async function loadFiles(){
  const id = curServerId(); if(!id) return;
  try {
    const { files } = await API.get(`/servers/${id}/files`);
    state.fileList = files;
    renderFileTree();
    const first = files.includes('server.properties') ? 'server.properties' : files[0];
    if(first) openFile(first);
  } catch(err){ console.warn('loadFiles', err); }
}
async function openFile(f){
  state.currentFile = f;
  document.getElementById('editorFile').textContent = f;
  document.getElementById('editorLang').textContent = fileLang(f);
  renderFileTree();
  try {
    const { content } = await API.get(`/servers/${curServerId()}/file?path=${encodeURIComponent(f)}`);
    document.getElementById('editorArea').value = content;
  } catch(err){ document.getElementById('editorArea').value = ''; toast('alert', err.message, 'err'); }
}
async function saveFile(){
  if(!state.currentFile) return;
  try {
    await API.put(`/servers/${curServerId()}/file`, { path: state.currentFile, content: document.getElementById('editorArea').value });
    toast('save',`${state.currentFile} guardado`,'ok');
  } catch(err){ toast('alert', err.message, 'err'); }
}

/* =================== EVENTS =================== */
function renderEvents(){
  document.getElementById('eventList').innerHTML = state.events.map((e,i)=>`
    <div class="row-item" style="animation-delay:${i*0.04}s">
      <div class="row-icon" style="background:${e.bg};color:${e.color}">${icon(e.ic,16)}</div>
      <div class="row-body">
        <div class="row-title">${e.name} ${e.on?'':'<span class="chip gray">PAUSADO</span>'}</div>
        <div class="row-sub">${e.sched}</div>
      </div>
      <label class="switch"><input type="checkbox" ${e.on?'checked':''} onchange="toggleEvent(${i},this.checked)"><span class="track"></span><span class="thumb"></span></label>
      <button class="icon-btn red" onclick="deleteEvent(${i})">${icon('trash',13)}</button>
    </div>`).join('');
}
function toggleEvent(i,on){ state.events[i].on=on; renderEvents(); toast(on?'check':'x',`«${state.events[i].name}» ${on?'activada':'pausada'}`, on?'ok':'warn'); }
function deleteEvent(i){ const e=state.events.splice(i,1)[0]; renderEvents(); renderDashTasks(); toast('trash',`Tarea «${e.name}» eliminada`,'warn'); addAudit('trash','Eliminó la tarea programada: '+e.name,'warn'); }
function addEvent(){
  state.events.push({ ic:'message', color:'var(--accent)', bg:'var(--accent-dim)', name:'Anuncio: ¡Recuerda votar el server!', sched:'Cada 2 h', on:true });
  renderEvents(); renderDashTasks();
  toast('plus','Tarea creada (demo: editor completo en la app real)','ok');
  addAudit('plus','Creó una tarea programada','ok');
}
function renderDashTasks(){
  document.getElementById('dashTasks').innerHTML = state.events.filter(e=>e.on).slice(0,4).map(e=>`
    <div style="display:flex;align-items:center;gap:11px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:12.5px;">
      <span style="color:${e.color};display:flex">${icon(e.ic,14)}</span>
      <span style="flex:1">${e.name}</span>
      <span style="color:var(--muted);font-size:11.5px;font-variant-numeric:tabular-nums">${e.sched}</span>
    </div>`).join('');
}
renderEvents(); renderDashTasks();

/* =================== BACKUPS =================== */
function fmtSize(b){ return b>=1073741824 ? (b/1073741824).toFixed(2)+' GB' : (b/1048576).toFixed(1)+' MB'; }
function fmtDate(iso){ return new Date(iso).toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}); }
async function loadBackups(){
  const id = curServerId(); if(!id) return;
  try { state.backups = await API.get(`/servers/${id}/backups`); } catch { state.backups = []; }
  renderBackups();
  const meta = state.servers[state.currentServer]?.meta;
  document.getElementById('bkAuto').checked = meta ? meta.backupAuto !== false : true;
  const total = state.backups.reduce((a,b)=>a+b.size,0);
  document.getElementById('backupsSubtitle').textContent =
    state.backups.length ? `Snapshots del servidor · ${fmtSize(total)} usados` : 'Snapshots del servidor · todavía no hay ninguno';
}
function renderBackups(){
  document.getElementById('backupList').innerHTML = state.backups.map((b,i)=>`
    <div class="row-item" style="animation-delay:${i*0.04}s">
      <div class="row-icon" style="background:var(--info-dim);color:var(--info)">${icon('database',16)}</div>
      <div class="row-body">
        <div class="row-title" style="font-family:var(--mono);font-size:12.5px">${b.name}.zip</div>
        <div class="row-sub">${fmtDate(b.createdAt)} · ${fmtSize(b.size)} · ${b.auto?'automático':'manual'}</div>
      </div>
      <a class="btn small ghost" href="/api/servers/${curServerId()}/backups/${b.name}/download" title="Descargar">${icon('download',13)}</a>
      <button class="btn small" onclick="armAction(this, ()=>restoreBackupUI('${b.name}'))">Restaurar</button>
      <button class="icon-btn red" style="width:auto;padding:0 8px" onclick="armAction(this, ()=>deleteBackupUI('${b.name}'))">${icon('trash',13)}</button>
    </div>`).join('') || '<div class="empty">Sin backups todavía. Crea el primero con el botón de arriba.</div>';
}
/* doble click de confirmación: el primer click arma el botón, el segundo ejecuta */
function armAction(btn, fn, restoreHtml){
  if(btn.dataset.armed){ fn(); return; }
  btn.dataset.armed = '1';
  const orig = btn.innerHTML;
  btn.innerHTML = '¿Seguro?';
  btn.style.color = 'var(--danger)';
  setTimeout(()=>{ delete btn.dataset.armed; btn.innerHTML = restoreHtml || orig; btn.style.color=''; }, 3000);
}
async function makeBackup(){
  const btn = document.getElementById('btnBackup');
  btn.disabled = true; btn.textContent = 'Comprimiendo…';
  try {
    const b = await API.post(`/servers/${curServerId()}/backups`);
    toast('check',`Backup completado: ${fmtSize(b.size)}`,'ok');
    loadBackups();
  } catch(err){ toast('alert', err.message, 'err'); }
  btn.disabled = false; btn.innerHTML = icon('database',14)+' Crear backup';
}
async function restoreBackupUI(name){
  try {
    await API.post(`/servers/${curServerId()}/backups/${name}/restore`);
    toast('refresh',`Mundo restaurado desde ${name}`,'warn');
  } catch(err){ toast('alert', err.message, 'err'); }
}
async function deleteBackupUI(name){
  try { await API.del(`/servers/${curServerId()}/backups/${name}`); toast('trash',`Backup ${name} eliminado`,'warn'); loadBackups(); }
  catch(err){ toast('alert', err.message, 'err'); }
}
async function toggleBackupAuto(on){
  try { await API.put(`/servers/${curServerId()}/backup-settings`, { auto: on }); toast(on?'check':'x', on?'Backup diario activado':'Backup diario desactivado', on?'ok':'warn'); }
  catch(err){ toast('alert', err.message, 'err'); }
}

/* =================== CRASHES =================== */
function renderCrashes(){
  document.getElementById('crashList').innerHTML =
    `<div class="mini-label" style="padding:8px 10px 2px">CRASH REPORTS</div>` +
    state.crashes.map(c=>`
    <div class="row-item" style="cursor:pointer; ${state.currentCrash===c.id?'border-color:var(--border-hover);background:var(--card-hover);':''}" onclick="openCrash(${c.id})">
      <div class="row-icon" style="background:var(--danger-dim);color:var(--danger)">${icon('alert',15)}</div>
      <div class="row-body">
        <div class="row-title" style="font-size:12.5px">${c.culprit}</div>
        <div class="row-sub">${c.date}</div>
      </div>
      <span class="chip green">ANALIZADO</span>
    </div>`).join('') +
    `<div class="empty" style="padding:16px;font-size:12px;">El servidor lleva 2 días sin crashes</div>`;
}
function openCrash(id){
  state.currentCrash = id;
  const c = state.crashes.find(x=>x.id===id);
  renderCrashes();
  document.getElementById('crashDetail').innerHTML = `
    <h3>${icon('alert',15)} Análisis automático</h3>
    <div class="crash-detail">
      <div style="font-size:15px;font-weight:650;">Culpable: <span style="color:var(--danger)">${c.culprit}</span></div>
      <dl class="crash-kv">
        <dt>Fecha</dt><dd>${c.date}</dd>
        <dt>Archivo</dt><dd style="font-family:var(--mono);font-size:11.5px">${c.file}</dd>
        <dt>Qué pasó</dt><dd>${c.reason}</dd>
        <dt>Solución sugerida</dt><dd style="color:var(--accent)">${c.fix}</dd>
      </dl>
      <pre class="stack">${c.stack}</pre>
      <div style="display:flex;gap:9px;margin-top:14px;">
        <button class="btn small primary" onclick="toast('check','Acción aplicada — reinicia para confirmar','ok'); addAudit('check','Aplicó la solución sugerida del crash','ok')">${icon('check',13)} Aplicar solución</button>
        <button class="btn small" onclick="toast('fileCode','Abriendo reporte completo (demo)','info')">Ver reporte completo</button>
      </div>
    </div>`;
}
renderCrashes(); openCrash(0);

/* =================== ACTIVITY FEED =================== */

/* =================== CHARTS =================== */
function drawChart(canvas,data,opts){
  const dpr = window.devicePixelRatio||1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if(!w) return;
  canvas.width=w*dpr; canvas.height=h*dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,w,h);
  const {min,max,color,fill} = opts;
  const pts = data.map((v,i)=>[i/(data.length-1)*w, h-((v-min)/(max-min))*(h-14)-7]);
  const grad = ctx.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,fill); grad.addColorStop(1,'transparent');
  ctx.beginPath(); ctx.moveTo(pts[0][0],h);
  pts.forEach(p=>ctx.lineTo(p[0],p[1]));
  ctx.lineTo(w,h); ctx.closePath(); ctx.fillStyle=grad; ctx.fill();
  ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
  ctx.strokeStyle=color; ctx.lineWidth=1.8; ctx.lineJoin='round'; ctx.stroke();
  const last = pts[pts.length-1];
  ctx.beginPath(); ctx.arc(last[0],last[1],3,0,7);
  ctx.fillStyle=color; ctx.fill();
}
function drawDualChart(canvas,a,b){
  const dpr = window.devicePixelRatio||1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if(!w) return;
  canvas.width=w*dpr; canvas.height=h*dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,w,h);
  [[a,'#22d3ee'],[b,'#a78bfa']].forEach(([data,color])=>{
    const pts = data.map((v,i)=>[i/(data.length-1)*w, h-(v/100)*(h-14)-7]);
    ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
    ctx.strokeStyle=color; ctx.lineWidth=1.8; ctx.lineJoin='round'; ctx.stroke();
  });
  ctx.font='10.5px Inter, Segoe UI'; ctx.fillStyle='#22d3ee'; ctx.fillText('CPU',8,13);
  ctx.fillStyle='#a78bfa'; ctx.fillText('RAM',40,13);
}
function tickCharts(){
  // el historial lo alimentan los eventos 'metrics' del WebSocket (live.js)
  [state.tpsHistory,state.cpuHistory,state.ramHistory].forEach(a=>{ if(a.length>90)a.shift(); });
  const pad = a => a.length>1 ? a : [0,0];
  drawChart(document.getElementById('tpsChart'),pad(state.tpsHistory),{min:0,max:20.5,color:'#34d399',fill:'rgba(52,211,153,.18)'});
  drawDualChart(document.getElementById('cpuChart'),pad(state.cpuHistory),pad(state.ramHistory));
  const tpsEl = document.getElementById('statTps');
  tpsEl.textContent = state.online ? '20' : '—';
  tpsEl.style.color = state.online ? 'var(--accent)' : 'var(--muted)';
}
setInterval(tickCharts,1500);

/* =================== MAP =================== */
const mapPlayers = state.players.map((p,i)=>({
  name:p.name, x:0.35+Math.random()*0.3, y:0.35+Math.random()*0.3,
  vx:(Math.random()-0.5)*0.0016, vy:(Math.random()-0.5)*0.0016,
}));
let mapBase = null;
function terrainH(x,y){
  return Math.sin(x*0.09)*Math.cos(y*0.075)*1.1
       + Math.sin(x*0.031+y*0.045)*0.9
       + Math.cos(x*0.017-y*0.023)*0.7
       + Math.sin((x+y)*0.11)*0.35;
}
function terrainColor(v){
  if(v<-0.9) return '#1d4ed8';
  if(v<-0.35) return '#2563eb';
  if(v<-0.15) return '#d4c27a';
  if(v<0.5) return '#4d7c3a';
  if(v<1.1) return '#2d5426';
  if(v<1.7) return '#6b7280';
  return '#e5e7eb';
}
function drawMapBase(){
  const canvas = document.getElementById('mapCanvas');
  const dpr = window.devicePixelRatio||1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if(!w) return;
  canvas.width=w*dpr; canvas.height=h*dpr;
  const off = document.createElement('canvas');
  const cell = 7;
  const cols = Math.ceil(w/cell), rows = Math.ceil(h/cell);
  off.width=cols; off.height=rows;
  const octx = off.getContext('2d');
  for(let cy=0;cy<rows;cy++) for(let cx=0;cx<cols;cx++){
    octx.fillStyle = terrainColor(terrainH(cx,cy));
    octx.fillRect(cx,cy,1,1);
  }
  mapBase = { off, w, h, dpr };
  drawMapFrame();
}
function drawMapFrame(){
  if(!mapBase) return;
  const canvas = document.getElementById('mapCanvas');
  const { off, w, h, dpr } = mapBase;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0,0,w,h);
  ctx.drawImage(off,0,0,w,h);
  // subtle grid
  ctx.strokeStyle='rgba(0,0,0,.12)'; ctx.lineWidth=1;
  for(let x=0;x<w;x+=56){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
  for(let y=0;y<h;y+=56){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
  // spawn marker
  const sx=w*0.5, sy=h*0.5;
  ctx.strokeStyle='rgba(255,255,255,.85)'; ctx.lineWidth=1.6;
  ctx.strokeRect(sx-6,sy-6,12,12);
  ctx.font='10px Inter, Segoe UI'; ctx.fillStyle='rgba(255,255,255,.75)';
  ctx.fillText('spawn', sx+10, sy+3);
  // players
  mapPlayers.length = state.players.length;
  mapPlayers.forEach(p=>{
    p.x+=p.vx; p.y+=p.vy;
    if(p.x<0.05||p.x>0.95) p.vx*=-1;
    if(p.y<0.05||p.y>0.95) p.vy*=-1;
    if(Math.random()<0.01){ p.vx=(Math.random()-0.5)*0.0016; p.vy=(Math.random()-0.5)*0.0016; }
    const px=p.x*w, py=p.y*h;
    ctx.beginPath(); ctx.arc(px,py,9,0,7);
    ctx.fillStyle='rgba(52,211,153,.25)'; ctx.fill();
    ctx.beginPath(); ctx.arc(px,py,4,0,7);
    ctx.fillStyle='#34d399'; ctx.fill();
    ctx.strokeStyle='#052e1c'; ctx.lineWidth=1.4; ctx.stroke();
    ctx.font='600 10.5px Inter, Segoe UI';
    const tw = ctx.measureText(p.name).width;
    ctx.fillStyle='rgba(9,9,11,.75)';
    ctx.fillRect(px-tw/2-5, py-24, tw+10, 15);
    ctx.fillStyle='#e7e7ea';
    ctx.fillText(p.name, px-tw/2, py-13);
  });
}
setInterval(()=>{ if(document.getElementById('sec-map').classList.contains('visible')) drawMapFrame(); }, 90);
document.getElementById('mapCanvas').addEventListener('mousemove', e=>{
  const r = e.target.getBoundingClientRect();
  const bx = Math.round((e.clientX-r.left-r.width/2)*4), bz = Math.round((e.clientY-r.top-r.height/2)*4);
  document.getElementById('mapCoords').textContent = `${bx}, ${bz}`;
});
window.addEventListener('resize', ()=>{ if(document.getElementById('sec-map').classList.contains('visible')) drawMapBase(); tickCharts(); });

/* =================== UPTIME =================== */
setInterval(()=>{
  if(state.online) state.uptimeSec++;
  const s = state.uptimeSec;
  const fmt = [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');
  document.getElementById('statUptime').textContent = state.online?fmt:'—';
},1000);

/* =================== INIT =================== */
hydrateIcons();
renderPlayers();
searchModrinth('');
renderPacks();
modUpdatesBadge();
tickCharts();
setTimeout(()=>toast('umbrella','Bienvenido a CraftDeck','ok'),700);
