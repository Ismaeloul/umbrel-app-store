/* =================== WIZARD: CREAR SERVIDOR =================== */
const LOADER_LABELS = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge' };

document.body.insertAdjacentHTML('beforeend', `
<div class="modal-overlay" id="wizardOverlay">
  <div class="modal">
    <h3 style="font-size:16px;font-weight:650;margin-bottom:4px;">Crear servidor</h3>
    <p style="font-size:12.5px;color:var(--muted);margin-bottom:18px;">Elige loader y versión; CraftDeck descarga Java y el servidor por ti.</p>
    <div class="field"><label>Nombre</label><input type="text" id="wzName" placeholder="Mi servidor" maxlength="40"></div>
    <div class="form-grid" style="margin-top:13px;">
      <div class="field"><label>Loader</label>
        <select id="wzLoader">${Object.entries(LOADER_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Versión de Minecraft</label>
        <select id="wzVersion"><option>Cargando…</option></select>
      </div>
    </div>
    <div class="field" style="margin-top:13px;"><label>RAM asignada · <span class="slider-val" id="wzRamVal">2048</span> MB</label>
      <div class="slider-row"><input type="range" id="wzRam" min="1024" max="8192" step="512" value="2048"></div>
    </div>
    <label style="display:flex;align-items:center;gap:9px;margin-top:15px;font-size:12.5px;color:var(--muted2);cursor:pointer;">
      <input type="checkbox" id="wzEula" style="accent-color:var(--accent);width:15px;height:15px;">
      Acepto la <a href="https://aka.ms/MinecraftEULA" target="_blank" style="color:var(--accent)">EULA de Minecraft</a>
    </label>
    <div id="wzProgress" style="display:none;margin-top:14px;max-height:160px;overflow-y:auto;background:#070708;border:1px solid var(--border);border-radius:9px;padding:10px 13px;font-family:var(--mono);font-size:11.5px;line-height:1.7;color:var(--muted2);"></div>
    <div style="display:flex;gap:9px;justify-content:flex-end;margin-top:18px;">
      <button class="btn" id="wzCancel">Cancelar</button>
      <button class="btn primary" id="wzCreate">Crear servidor</button>
    </div>
  </div>
</div>`);

const wzOverlay = document.getElementById('wizardOverlay');
const wzVersion = document.getElementById('wzVersion');
const wzProgress = document.getElementById('wzProgress');
let wzCreatingId = null;

document.getElementById('wzRam').oninput = function () { document.getElementById('wzRamVal').textContent = this.value; };
document.getElementById('wzCancel').onclick = closeCreateWizard;
wzOverlay.addEventListener('click', (e) => { if (e.target === wzOverlay && !wzCreatingId) closeCreateWizard(); });

async function loadWizardVersions() {
  const loader = document.getElementById('wzLoader').value;
  wzVersion.innerHTML = '<option>Cargando…</option>';
  try {
    const { versions } = await API.get('/catalog/' + loader);
    wzVersion.innerHTML = versions.map((v) => `<option value="${v}">${v}</option>`).join('');
  } catch (err) {
    wzVersion.innerHTML = '<option value="">Error cargando versiones</option>';
    toast('alert', 'No se pudo cargar el catálogo: ' + err.message, 'err');
  }
}
document.getElementById('wzLoader').onchange = loadWizardVersions;

function openCreateWizard() {
  wzCreatingId = null;
  wzProgress.style.display = 'none';
  wzProgress.innerHTML = '';
  document.getElementById('wzCreate').disabled = false;
  wzOverlay.classList.add('open');
  loadWizardVersions();
}

function closeCreateWizard() { wzOverlay.classList.remove('open'); }

document.getElementById('wzCreate').onclick = async () => {
  const name = document.getElementById('wzName').value.trim();
  const loader = document.getElementById('wzLoader').value;
  const version = wzVersion.value;
  const memoryMb = Number(document.getElementById('wzRam').value);
  const acceptEula = document.getElementById('wzEula').checked;
  if (!name) { toast('alert', 'Ponle un nombre al servidor', 'warn'); return; }
  if (!version) { toast('alert', 'Elige una versión', 'warn'); return; }
  if (!acceptEula) { toast('alert', 'Tienes que aceptar la EULA para crear el servidor', 'warn'); return; }

  document.getElementById('wzCreate').disabled = true;
  wzProgress.style.display = 'block';
  wzProgress.innerHTML = '<div>Creando servidor…</div>';
  try {
    const meta = await API.post('/servers', { name, loader, version, memoryMb, acceptEula });
    wzCreatingId = meta.id;
  } catch (err) {
    wzProgress.innerHTML += `<div style="color:var(--danger)">${err.message}</div>`;
    document.getElementById('wzCreate').disabled = false;
  }
};

/* =================== SERVIDORES REALES EN EL SWITCHER =================== */
async function refreshServers() {
  try {
    const servers = await API.get('/servers');
    state.servers = servers.map((s) => ({
      id: s.id,
      name: s.name,
      sub: `${LOADER_LABELS[s.loader] || s.loader} ${s.mcVersion} · :${s.port}`,
      status: s.runtime && s.runtime.status !== 'offline'
        ? s.runtime.status
        : (s.provision.status === 'ready' ? 'offline' : s.provision.status),
      meta: s,
    }));
    renderServerMenu();
    const cur = state.servers[state.currentServer] || state.servers[0];
    if (cur) {
      document.getElementById('ssName').textContent = cur.name;
      document.getElementById('ssSub').textContent = cur.sub;
      document.getElementById('ssDot').style.background = cur.status === 'online' ? 'var(--accent)' : 'var(--danger)';
    } else {
      document.getElementById('ssName').textContent = 'Sin servidores';
      document.getElementById('ssSub').textContent = 'Crea uno para empezar';
      document.getElementById('ssDot').style.background = 'var(--muted)';
    }
    if (!window.__liveInit) {
      window.__liveInit = true;
      if (typeof onServerSwitched === 'function') onServerSwitched();
    }
  } catch (err) {
    console.warn('No se pudo cargar la lista de servidores', err);
  }
}
refreshServers();

onWS((msg) => {
  if (msg.type !== 'provision' || msg.id !== wzCreatingId) return;
  const div = document.createElement('div');
  if (msg.status === 'error') { div.style.color = 'var(--danger)'; div.textContent = '✗ ' + msg.msg; }
  else div.textContent = msg.msg;
  wzProgress.appendChild(div);
  wzProgress.scrollTop = wzProgress.scrollHeight;
  if (msg.status === 'error') {
    document.getElementById('wzCreate').disabled = false;
    wzCreatingId = null;
    toast('alert', 'Falló la creación del servidor', 'err');
  } else if (/listo\.$/.test(msg.msg)) {
    toast('check', 'Servidor creado y listo para arrancar', 'ok');
    wzCreatingId = null;
    setTimeout(() => { closeCreateWizard(); if (typeof refreshServers === 'function') refreshServers(); }, 900);
  }
});
