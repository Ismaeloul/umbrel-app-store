/* =================== API + WEBSOCKET =================== */
const API = {
  async _req(path, opts = {}) {
    const res = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get(path) { return this._req(path); },
  post(path, body) { return this._req(path, { method: 'POST', body: JSON.stringify(body) }); },
  put(path, body) { return this._req(path, { method: 'PUT', body: JSON.stringify(body) }); },
  del(path) { return this._req(path, { method: 'DELETE' }); },
};

const wsHandlers = [];
function onWS(fn) { wsHandlers.push(fn); }
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (e) => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    wsHandlers.forEach((f) => f(msg));
  };
  ws.onclose = () => setTimeout(connectWS, 2000);
}
connectWS();
