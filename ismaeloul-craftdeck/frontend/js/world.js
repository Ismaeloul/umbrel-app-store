/* =================== MUNDO: server.properties real =================== */
function setSlider(id, valId, v){
  const el = document.getElementById(id);
  el.value = v;
  document.getElementById(valId).textContent = v;
}

async function loadWorld(){
  const id = curServerId(); if(!id) return;
  try {
    const p = await API.get(`/servers/${id}/properties`);
    state.props = p;
    document.getElementById('wMotd').value = p.motd || '';
    document.getElementById('wSeed').value = p['level-seed'] || '';
    document.getElementById('wDifficulty').value = p.difficulty || 'normal';
    document.getElementById('wGamemode').value = p.gamemode || 'survival';
    setSlider('wMaxPlayers','maxPlayersVal', p['max-players'] || '20');
    setSlider('wViewDist','viewDistVal', p['view-distance'] || '10');
    setSlider('wSpawnProt','spawnProtVal', p['spawn-protection'] || '16');
    renderRules(p);
  } catch(err){ toast('alert','No se pudo leer server.properties: '+err.message,'err'); }
}

async function saveWorld(){
  const id = curServerId(); if(!id) return;
  const patch = {
    motd: document.getElementById('wMotd').value,
    'level-seed': document.getElementById('wSeed').value,
    difficulty: document.getElementById('wDifficulty').value,
    gamemode: document.getElementById('wGamemode').value,
    'max-players': document.getElementById('wMaxPlayers').value,
    'view-distance': document.getElementById('wViewDist').value,
    'spawn-protection': document.getElementById('wSpawnProt').value,
  };
  document.querySelectorAll('#gameRules input[data-ruletype="prop"]').forEach(i=>{ patch[i.dataset.rule] = String(i.checked); });
  try {
    await API.put(`/servers/${id}/properties`, patch);
    toast('check', state.online ? 'Guardado. Se aplicará al reiniciar el servidor.' : 'Configuración guardada.', 'ok');
  } catch(err){ toast('alert', err.message, 'err'); }
}

/* =================== ZONA PELIGROSA =================== */
async function deleteWorld(){
  try {
    await API.del(`/servers/${curServerId()}/world`);
    toast('trash','Mundo borrado. Al arrancar se generará uno nuevo.','warn');
  } catch(err){ toast('alert', err.message, 'err'); }
}
async function deleteServerUI(){
  try {
    await API.del(`/servers/${curServerId()}`);
    toast('trash','Servidor eliminado por completo','warn');
    state.currentServer = 0;
    await refreshServers();
    onServerSwitched();
    go('dashboard');
  } catch(err){ toast('alert', err.message, 'err'); }
}

async function ruleChanged(input){
  if(input.dataset.ruletype !== 'gamerule') return; // las de server.properties se guardan con «Guardar»
  const rule = input.dataset.rule, value = input.checked;
  try {
    await API.post(`/servers/${curServerId()}/command`, { command: `gamerule ${rule} ${value}` });
    toast('check', `gamerule ${rule} = ${value}`, 'ok');
  } catch {
    input.checked = !value;
    toast('alert', 'El servidor debe estar encendido para cambiar esta regla', 'warn');
  }
}
