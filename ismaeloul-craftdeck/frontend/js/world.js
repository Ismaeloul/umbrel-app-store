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
    const r = await API.put(`/servers/${id}/properties`, patch);
    if (r.appliedLive.length && r.needsRestart.length)
      toast('check', `Aplicado al momento: ${r.appliedLive.join(', ')} · Al reiniciar: ${r.needsRestart.join(', ')}`, 'ok');
    else if (r.appliedLive.length)
      toast('check', `Aplicado al momento: ${r.appliedLive.join(', ')}`, 'ok');
    else if (r.needsRestart.length)
      toast('refresh', `Guardado. Se aplicará al reiniciar: ${r.needsRestart.join(', ')}`, 'warn');
    else
      toast('check', 'Configuración guardada.', 'ok');
  } catch(err){ toast('alert', err.message, 'err'); }
}

/* =================== ZONA PELIGROSA =================== */
function curServerName(){ return state.servers[state.currentServer]?.name || ''; }
async function deleteWorld(){
  try {
    await API.del(`/servers/${curServerId()}/world?confirm=${encodeURIComponent(curServerName())}`);
    toast('trash','Mundo borrado. Al arrancar se generará uno nuevo.','warn');
  } catch(err){ toast('alert', err.message, 'err'); }
}
async function deleteServerUI(){
  try {
    await API.del(`/servers/${curServerId()}?confirm=${encodeURIComponent(curServerName())}`);
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
  const label = RULES.find(r=>r.key===rule)?.label || rule;
  try {
    await API.post(`/servers/${curServerId()}/gamerule`, { rule, value, label });
    toast('check', `${label} ${value?'activado':'desactivado'} · anunciado en el chat`, 'ok');
  } catch {
    input.checked = !value;
    toast('alert', 'El servidor debe estar encendido para cambiar esta regla', 'warn');
  }
}
