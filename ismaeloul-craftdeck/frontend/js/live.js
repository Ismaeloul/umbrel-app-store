/* =================== LIVE: consola, estado y métricas reales =================== */
function curServerId(){ return state.servers[state.currentServer]?.id; }

function classifyLine(line){
  if(line.startsWith('> ')) return 'cmd';
  if(/ERROR|SEVERE|FATAL|Exception/.test(line)) return 'err';
  if(/WARN/.test(line)) return 'warn';
  return 'info';
}
function logRemote(line){ logLine(classifyLine(line), esc(line)); }

async function loadConsole(){
  const id = curServerId(); if(!id) return;
  consoleBody.innerHTML = '';
  try {
    const { lines } = await API.get(`/servers/${id}/console`);
    lines.forEach(logRemote);
  } catch { /* servidor recién creado, sin consola aún */ }
}

function setPlayers(players){
  state.players = players || [];
  renderPlayers();
}

async function refreshPlayerLists(){
  const id = curServerId(); if(!id) return;
  try {
    const data = await API.get(`/servers/${id}/players`);
    state.playerLists = { ops: data.ops, whitelist: data.whitelist, banned: data.banned };
    state.players = data.online || [];
    renderPlayers();
  } catch { /* sin datos aún */ }
}

function showWhitelist(){
  const wl = state.playerLists?.whitelist || [];
  toast('shield', wl.length ? `Whitelist (${wl.length}): ${wl.join(', ')}` : 'La whitelist está vacía', 'info');
}
function showBanned(){
  const b = state.playerLists?.banned || [];
  toast('ban', b.length ? `Baneados (${b.length}): ${b.map(x=>x.name).join(', ')}` : 'Nadie está baneado', b.length?'warn':'info');
}

function applyStatus(status){
  if(status==='stopping'){ setStatus('starting'); statusText.textContent='Deteniendo…'; return; }
  setStatus(status==='online'?'online':status==='starting'?'starting':'offline');
}

async function onServerSwitched(){
  state.tpsHistory=[]; state.cpuHistory=[]; state.ramHistory=[];
  await loadConsole();
  const id = curServerId(); if(!id){ setStatus('offline'); setPlayers([]); return; }
  try {
    const s = await API.get(`/servers/${id}`);
    applyStatus(s.runtime.status);
    state.uptimeSec = s.runtime.uptimeSec || 0;
    setPlayers(s.runtime.players);
    document.getElementById('statRamMax').textContent = ` / ${(s.memoryMb/1024).toFixed(0)} GB`;
  } catch { /* ignorar */ }
  refreshPlayerLists();
  loadAudit();
  const visible = document.querySelector('.section.visible')?.id;
  if(visible==='sec-world') loadWorld();
  if(visible==='sec-files') loadFiles();
}

onWS((msg)=>{
  if(!msg.id) return;
  if(msg.id !== curServerId()){
    if(msg.type==='status') refreshServers(); // actualizar puntos del switcher
    return;
  }
  switch(msg.type){
    case 'console':
      logRemote(msg.line);
      break;
    case 'status':
      applyStatus(msg.status);
      if(msg.status==='online') toast('check','Servidor en línea','ok');
      if(msg.status==='offline'){
        state.uptimeSec = 0; setPlayers([]);
        if(msg.crashed) toast('alert','El servidor se cerró inesperadamente — mira la consola','err');
      }
      refreshServers();
      break;
    case 'players':
      setPlayers(msg.players);
      break;
    case 'metrics': {
      state.uptimeSec = msg.uptimeSec;
      state.cpuHistory.push(Math.min(100, msg.cpu));
      const meta = state.servers[state.currentServer]?.meta;
      const memPct = meta ? Math.min(100, (msg.memMb / meta.memoryMb) * 100) : 0;
      state.ramHistory.push(memPct);
      state.tpsHistory.push(state.online ? 20 : 0);
      document.getElementById('statRam').textContent = (msg.memMb/1024).toFixed(1);
      const ramBar = document.getElementById('ramBar');
      ramBar.style.width = memPct + '%';
      ramBar.className = 'progress-fill' + (memPct>85?' warn':'');
      break;
    }
  }
});
