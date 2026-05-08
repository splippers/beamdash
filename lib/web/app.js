const App = {
  state: { instances: [], currentInstance: null, charts: {}, apiKey: '', apiHost: '' },
  pollTimers: [],

  init() {
    this.state.apiKey = localStorage.getItem('beamdash_api_key') || '';
    this.state.apiHost = localStorage.getItem('beamdash_api_host') || '';
    if (this.state.apiKey) {
      document.getElementById('api-key-input').value = this.state.apiKey;
    }
    if (this.state.apiHost) {
      document.getElementById('api-host-input').value = this.state.apiHost;
    }
    this.route();
    window.addEventListener('hashchange', () => this.route());
  },

  async api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...opts.headers };
    if (this.state.apiKey) {
      headers['X-API-Key'] = this.state.apiKey;
    }
    const host = this.state.apiHost || '';
    const url = host ? host.replace(/\/+$/, '') + path : path;
    const res = await fetch(url, { headers, ...opts });
    return res.json();
  },

  showSettings() {
    document.getElementById('api-key-input').value = this.state.apiKey;
    document.getElementById('api-host-input').value = this.state.apiHost;
    document.getElementById('api-key-status').textContent = '';
    const modal = new bootstrap.Modal(document.getElementById('settings-modal'));
    modal.show();
  },

  async saveSettings() {
    const key = document.getElementById('api-key-input').value.trim();
    const host = document.getElementById('api-host-input').value.trim();
    this.state.apiKey = key;
    this.state.apiHost = host;
    localStorage.setItem('beamdash_api_key', key);
    localStorage.setItem('beamdash_api_host', host);
    const status = document.getElementById('api-key-status');
    status.textContent = 'Testing...';
    try {
      const r = await this.api('/instances');
      if (r.ok !== undefined) {
        status.textContent = 'Connected';
        setTimeout(() => {
          bootstrap.Modal.getInstance(document.getElementById('settings-modal')).hide();
          this.route();
        }, 500);
      } else {
        status.textContent = 'Invalid key or connection failed';
      }
    } catch (e) {
      status.textContent = 'Connection failed: ' + e.message;
    }
  },

  toast(msg, type = 'success') {
    const colors = { success: '#2ecc71', danger: '#e74c3c', warning: '#f39c12', info: '#3498db' };
    const el = document.createElement('div');
    el.className = 'toast align-items-center text-bg-dark border-0 show';
    el.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="bi bi-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    el.style.borderLeft = `4px solid ${colors[type] || colors.info}`;
    let c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'toast-container'; c.className = 'toast-container'; document.body.appendChild(c); }
    c.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },

  nav(hash) { window.location.hash = hash; return false; },

  route() {
    const hash = window.location.hash.slice(1) || '/';
    this.clearPolling();
    document.getElementById('nav-status').textContent = '';
    if (hash === '/') this.renderDashboard();
    else if (hash.startsWith('/instance/')) {
      const parts = hash.split('/');
      const name = parts[2], tab = parts[3] || 'overview';
      this.renderInstance(name, tab);
    } else this.renderDashboard();
  },

  showLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '<div class="d-flex justify-content-center py-5"><div class="spinner"></div></div>';
  },

  clearPolling() {
    this.pollTimers.forEach(t => clearInterval(t));
    this.pollTimers = [];
    Object.values(this.state.charts).forEach(c => { try { c.destroy(); } catch(e) {} });
    this.state.charts = {};
  },

  async renderDashboard() {
    const m = document.getElementById('main');
    m.innerHTML = `
      <div class="row mb-4" id="stats-row"></div>
      <div class="row mb-4">
        <div class="col-md-8"><h5 class="fw-bold mb-0"><i class="bi bi-server me-2"></i>Instances</h5></div>
        <div class="col-md-4 text-end">
          <button class="btn btn-outline-warning btn-sm" onclick="App.refreshDashboard()"><i class="bi bi-arrow-clockwise"></i> Refresh</button>
        </div>
      </div>
      <div class="row g-3" id="instance-grid"></div>
    `;
    this.showLoading('instance-grid');
    await this.refreshDashboard();
  },

  async refreshDashboard() {
    const data = await this.api('/instances');
    if (!data.ok) { this.toast('Failed to load instances', 'danger'); return; }
    const names = data.instances || [];
    const instances = [];
    for (const name of names) {
      const r = await this.api(`/instances/${name}`);
      instances.push({ name, ...this.parseStatusOutput(r.output || '') });
    }
    this.state.instances = instances;
    this.renderStats(instances);
    this.renderInstanceGrid(instances);
  },

  parseStatusOutput(out) {
    const parts = out.trim().split(/\s+/);
    if (parts.length < 4) return { port: '?', map: '?', status: 'unknown', pid: '-' };
    return { port: parts[1], map: parts[2].replace(/^\/levels\//, '').replace(/\/info\.json$/, ''), status: parts[3], pid: parts[4] || '-' };
  },

  renderStats(instances) {
    const total = instances.length;
    const running = instances.filter(i => i.status === 'running').length;
    const stopped = total - running;
    const row = document.getElementById('stats-row');
    row.innerHTML = `
      <div class="col-md-3"><div class="card stat-card p-3 text-center"><div class="stat-value text-light">${total}</div><div class="stat-label">Total</div></div></div>
      <div class="col-md-3"><div class="card stat-card p-3 text-center"><div class="stat-value" style="color:#2ecc71">${running}</div><div class="stat-label">Running</div></div></div>
      <div class="col-md-3"><div class="card stat-card p-3 text-center"><div class="stat-value" style="color:#e74c3c">${stopped}</div><div class="stat-label">Stopped</div></div></div>
      <div class="col-md-3"><div class="card p-2" style="height:100px"><canvas id="status-chart"></canvas></div></div>
    `;
    const ctx = document.getElementById('status-chart');
    if (ctx) {
      if (this.state.charts.status) this.state.charts.status.destroy();
      this.state.charts.status = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Running', 'Stopped'], datasets: [{ data: [running, stopped], backgroundColor: ['#2ecc71', '#e74c3c'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '65%' }
      });
    }
  },

  renderInstanceGrid(instances) {
    const grid = document.getElementById('instance-grid');
    if (!instances.length) {
      grid.innerHTML = '<div class="col-12"><div class="card placeholder-card"><p class="text-secondary mb-0"><i class="bi bi-inbox me-2"></i>No instances. Create one with <code>beamctl create &lt;name&gt;</code></p></div></div>';
      return;
    }
    grid.innerHTML = instances.map(i => `
      <div class="col-lg-4 col-md-6">
        <div class="card instance-card h-100">
          <div class="card-body">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <h6 class="fw-bold mb-0"><i class="bi bi-server me-1"></i>${i.name}</h6>
              <span class="badge ${i.status === 'running' ? 'bg-success' : 'bg-secondary'}">${i.status}</span>
            </div>
            <div class="small text-secondary mb-2">
              <div><i class="bi bi-plug me-1"></i>Port: ${i.port}</div>
              <div><i class="bi bi-map me-1"></i>Map: <span class="badge-map" title="${i.map}">${i.map}</span></div>
              ${i.pid !== '-' ? `<div><i class="bi bi-cpu me-1"></i>PID: ${i.pid}</div>` : ''}
            </div>
          </div>
          <div class="card-footer d-flex gap-1 flex-wrap">
            ${i.status === 'running'
              ? `<button class="btn btn-outline-danger btn-sm flex-fill" onclick="App.action('stop','${i.name}')"><i class="bi bi-stop-fill"></i> Stop</button>`
              : `<button class="btn btn-outline-success btn-sm flex-fill" onclick="App.action('start','${i.name}')"><i class="bi bi-play-fill"></i> Start</button>`}
            <button class="btn btn-outline-info btn-sm flex-fill" onclick="App.nav('/instance/${i.name}')"><i class="bi bi-gear"></i> Manage</button>
          </div>
        </div>
      </div>
    `).join('');
  },

  async action(cmd, name) {
    const r = await this.api(`/instances/${name}/${cmd}`, { method: 'POST', body: '{}' });
    if (r.ok) { this.toast(`${name}: ${cmd} successful`); this.refreshDashboard(); }
    else { this.toast(`${name}: ${cmd} failed — ${r.stderr || r.error || 'unknown'}`, 'danger'); }
  },

  async renderInstance(name, activeTab = 'overview') {
    this.state.currentInstance = name;
    const m = document.getElementById('main');
    m.innerHTML = `
      <div class="mb-3">
        <a href="#" onclick="return App.nav('/')" class="text-secondary text-decoration-none small"><i class="bi bi-arrow-left"></i> Dashboard</a>
      </div>
      <div class="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
        <div>
          <h4 class="fw-bold mb-1"><i class="bi bi-server me-2"></i><span id="inst-name">${name}</span></h4>
          <span id="inst-status-badge" class="badge bg-secondary">?</span>
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-outline-success btn-sm" onclick="App.action('start','${name}')"><i class="bi bi-play-fill"></i> Start</button>
          <button class="btn btn-outline-danger btn-sm" onclick="App.action('stop','${name}')"><i class="bi bi-stop-fill"></i> Stop</button>
          <button class="btn btn-outline-warning btn-sm" onclick="App.action('restart','${name}')"><i class="bi bi-arrow-clockwise"></i> Restart</button>
        </div>
      </div>
      <ul class="nav nav-tabs mb-3" id="inst-tabs">
        <li class="nav-item"><a class="nav-link ${activeTab === 'overview' ? 'active' : ''}" href="#" onclick="return App.switchTab('${name}','overview')"><i class="bi bi-info-circle"></i> Overview</a></li>
        <li class="nav-item"><a class="nav-link ${activeTab === 'config' ? 'active' : ''}" href="#" onclick="return App.switchTab('${name}','config')"><i class="bi bi-sliders"></i> Config</a></li>
        <li class="nav-item"><a class="nav-link ${activeTab === 'mods' ? 'active' : ''}" href="#" onclick="return App.switchTab('${name}','mods')"><i class="bi bi-puzzle"></i> Mods</a></li>
        <li class="nav-item"><a class="nav-link ${activeTab === 'presets' ? 'active' : ''}" href="#" onclick="return App.switchTab('${name}','presets')"><i class="bi bi-bookmark"></i> Presets</a></li>
        <li class="nav-item"><a class="nav-link ${activeTab === 'logs' ? 'active' : ''}" href="#" onclick="return App.switchTab('${name}','logs')"><i class="bi bi-terminal"></i> Logs</a></li>
      </ul>
      <div id="inst-content"></div>
    `;
    this.switchTab(name, activeTab);
  },

  switchTab(name, tab) {
    window.location.hash = `/instance/${name}/${tab}`;
    document.querySelectorAll('#inst-tabs .nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector(`#inst-tabs .nav-link[onclick*="${tab}"]`)?.classList.add('active');
    const c = document.getElementById('inst-content');
    if (tab === 'overview') this.renderOverview(name, c);
    else if (tab === 'config') this.renderConfig(name, c);
    else if (tab === 'mods') this.renderMods(name, c);
    else if (tab === 'presets') this.renderPresets(name, c);
    else if (tab === 'logs') this.renderLogs(name, c);
    return false;
  },

  async renderOverview(name, container) {
    container.innerHTML = '<div class="d-flex justify-content-center py-5"><div class="spinner"></div></div>';
    const r = await this.api(`/instances/${name}`);
    const info = this.parseStatusOutput(r.output || '');
    const confR = await this.api(`/instances/${name}/config`);
    const confText = confR.config || '';

    document.getElementById('inst-status-badge').textContent = info.status;
    document.getElementById('inst-status-badge').className = `badge ${info.status === 'running' ? 'bg-success' : info.status === 'stopped' ? 'bg-secondary' : 'bg-warning'}`;

    const fields = this.parseToml(confText);
    container.innerHTML = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><i class="bi bi-info-circle me-1"></i>Server Info</div>
            <div class="card-body">
              <table class="table table-sm table-borderless">
                <tr><td class="text-secondary">Status</td><td><span class="status-dot ${info.status === 'running' ? 'status-running' : 'status-stopped'}"></span>${info.status}</td></tr>
                <tr><td class="text-secondary">Port</td><td>${info.port}</td></tr>
                <tr><td class="text-secondary">Map</td><td>${info.map}</td></tr>
                ${info.pid !== '-' ? `<tr><td class="text-secondary">PID</td><td>${info.pid}</td></tr>` : ''}
                <tr><td class="text-secondary">Name</td><td>${fields.Name || '?'}</td></tr>
                <tr><td class="text-secondary">Description</td><td>${fields.Description || '?'}</td></tr>
              </table>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><i class="bi bi-sliders me-1"></i>Key Settings</div>
            <div class="card-body">
              <table class="table table-sm table-borderless">
                <tr><td class="text-secondary">Max Players</td><td>${fields.MaxPlayers || '?'}</td></tr>
                <tr><td class="text-secondary">Max Cars</td><td>${fields.MaxCars || '?'}</td></tr>
                <tr><td class="text-secondary">Tags</td><td>${fields.Tags || '?'}</td></tr>
                <tr><td class="text-secondary">Private</td><td>${fields.Private === undefined ? '?' : fields.Private}</td></tr>
                <tr><td class="text-secondary">Allow Guests</td><td>${fields.AllowGuests === undefined ? '?' : fields.AllowGuests}</td></tr>
                <tr><td class="text-secondary">Debug</td><td>${fields.Debug === undefined ? '?' : fields.Debug}</td></tr>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  parseToml(text) {
    const fields = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*(\w+)\s*=\s*(.+)$/);
      if (m) {
        let val = m[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        fields[m[1]] = val;
      }
    }
    return fields;
  },

  async renderConfig(name, container) {
    container.innerHTML = '<div class="d-flex justify-content-center py-5"><div class="spinner"></div></div>';
    const r = await this.api(`/instances/${name}/config`);
    if (!r.ok) { container.innerHTML = '<div class="alert alert-danger">Failed to load config</div>'; return; }
    const fields = this.parseToml(r.config || '');
    const sections = { General: {}, Misc: {} };
    let currentSection = 'General';
    for (const line of (r.config || '').split('\n')) {
      if (line.startsWith('[Misc]')) currentSection = 'Misc';
      const m = line.match(/^\s*(\w+)\s*=\s*(.+)$/);
      if (m && sections[currentSection] !== undefined) {
        let val = m[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        sections[currentSection][m[1]] = val;
      }
    }

    container.innerHTML = `
      <div class="card">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span><i class="bi bi-sliders me-1"></i>Server Configuration</span>
          <button class="btn btn-warning btn-sm" onclick="App.saveConfig('${name}')"><i class="bi bi-floppy"></i> Save All</button>
        </div>
        <div class="card-body">
          <form id="config-form">
            <h6 class="text-warning mb-3">[General]</h6>
            ${this.configFields(Object.entries(sections.General), name)}
            <hr class="border-secondary">
            <h6 class="text-secondary mb-3">[Misc]</h6>
            ${this.configFields(Object.entries(sections.Misc), name)}
          </form>
        </div>
      </div>
    `;
  },

  configFields(entries, name) {
    const labels = { Name: 'Server Name', Description: 'Description', Map: 'Map Path', Port: 'Port', MaxPlayers: 'Max Players', MaxCars: 'Max Cars', AuthKey: 'Auth Key', Private: 'Private', AllowGuests: 'Allow Guests', Debug: 'Debug', LogChat: 'Log Chat', InformationPacket: 'Info Packet', Tags: 'Tags', IP: 'Bind IP', ResourceFolder: 'Resource Folder', UpdateReminderTime: 'Update Reminder', ImScaredOfUpdates: 'Disable Updates' };
    const bools = ['Private', 'AllowGuests', 'Debug', 'LogChat', 'InformationPacket', 'ImScaredOfUpdates'];
    return entries.map(([k, v]) => {
      const label = labels[k] || k;
      if (bools.includes(k)) {
        const checked = v === 'true' || v === true;
        return `<div class="mb-2 form-check form-switch"><input class="form-check-input" type="checkbox" id="cfg-${k}" ${checked ? 'checked' : ''} ${k === 'ImScaredOfUpdates' ? '' : ''}><label class="form-check-label" for="cfg-${k}">${label}</label></div>`;
      }
      const isLong = k === 'Description' || k === 'Map' || k === 'AuthKey';
      if (isLong) {
        return `<div class="mb-2"><label class="form-label small text-secondary">${label}</label><textarea class="form-control form-control-sm" id="cfg-${k}" rows="2">${this.esc(v)}</textarea></div>`;
      }
      return `<div class="mb-2"><label class="form-label small text-secondary">${label}</label><input class="form-control form-control-sm" id="cfg-${k}" value="${this.esc(v)}"></div>`;
    }).join('\n');
  },

  esc(s) { return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },

  async saveConfig(name) {
    const form = document.getElementById('config-form');
    if (!form) return;
    const inputs = form.querySelectorAll('input, textarea');
    const settings = {};
    inputs.forEach(el => {
      const key = el.id.replace('cfg-', '');
      if (el.type === 'checkbox') settings[key] = el.checked ? 'true' : 'false';
      else if (el.value) settings[key] = el.value;
    });
    const r = await this.api(`/instances/${name}/config`, {
      method: 'PUT', body: JSON.stringify({ settings })
    });
    if (r.ok && r.results.every(x => x.ok)) { this.toast('Config saved'); this.renderConfig(name, document.getElementById('inst-content')); }
    else { this.toast('Failed to save config: ' + JSON.stringify(r.results?.filter(x => !x.ok).map(x => x.error)), 'danger'); }
  },

  async renderMods(name, container) {
    container.innerHTML = '<div class="d-flex justify-content-center py-5"><div class="spinner"></div></div>';
    const [poolR, activeR] = await Promise.all([
      this.api(`/instances/${name}/mods/pool`),
      this.api(`/instances/${name}/mods/active`)
    ]);
    const pool = poolR.mods || [];
    const active = activeR.mods || [];

    container.innerHTML = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
              <span><i class="bi bi-archive me-1"></i>Mod Pool</span>
              <span class="badge bg-secondary">${pool.length}</span>
            </div>
            <div class="card-body" style="max-height:50vh;overflow-y:auto">
              ${pool.length ? pool.map(m => `
                <div class="d-flex justify-content-between align-items-center p-2 border-bottom border-secondary">
                  <span><i class="bi bi-file-zip me-1 text-warning"></i>${m}</span>
                  <button class="btn btn-outline-success btn-sm" onclick="App.enableMod('${name}','${m}')"><i class="bi bi-plus-circle"></i> Enable</button>
                </div>
              `).join('') : '<p class="text-secondary text-center py-3">Pool is empty. Upload .zip files to the mods directory.</p>'}
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header d-flex justify-content-between align-items-center">
              <span><i class="bi bi-check-circle me-1"></i>Active Mods</span>
              <div class="d-flex gap-1">
                <span class="badge bg-success">${active.length}</span>
                <button class="btn btn-outline-warning btn-sm" onclick="App.syncMods('${name}')"><i class="bi bi-arrow-repeat"></i> Sync</button>
              </div>
            </div>
            <div class="card-body" style="max-height:50vh;overflow-y:auto">
              ${active.length ? active.map(m => `
                <div class="d-flex justify-content-between align-items-center p-2 border-bottom border-secondary">
                  <span><i class="bi bi-file-zip me-1 text-success"></i>${m}</span>
                  <button class="btn btn-outline-danger btn-sm" onclick="App.disableMod('${name}','${m}')"><i class="bi bi-dash-circle"></i> Disable</button>
                </div>
              `).join('') : '<p class="text-secondary text-center py-3">No mods active. Enable from the pool.</p>'}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  async enableMod(name, mod) {
    const r = await this.api(`/instances/${name}/mods/enable`, { method: 'POST', body: JSON.stringify({ mod }) });
    if (r.ok) { this.toast(`Enabled: ${mod}`); this.renderMods(name, document.getElementById('inst-content')); }
    else { this.toast(`Failed: ${r.stderr || r.error}`, 'danger'); }
  },

  async disableMod(name, mod) {
    const r = await this.api(`/instances/${name}/mods/disable`, { method: 'POST', body: JSON.stringify({ mod }) });
    if (r.ok) { this.toast(`Disabled: ${mod}`); this.renderMods(name, document.getElementById('inst-content')); }
    else { this.toast(`Failed: ${r.stderr || r.error}`, 'danger'); }
  },

  async syncMods(name) {
    const r = await this.api(`/instances/${name}/mods/sync`, { method: 'POST', body: '{}' });
    if (r.ok) { this.toast('Mods synced'); this.renderMods(name, document.getElementById('inst-content')); }
    else { this.toast(`Sync failed: ${r.stderr || r.error}`, 'danger'); }
  },

  async renderPresets(name, container) {
    container.innerHTML = '<div class="d-flex justify-content-center py-5"><div class="spinner"></div></div>';
    const r = await this.api(`/instances/${name}/presets`);
    const presets = r.presets || [];

    container.innerHTML = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><i class="bi bi-bookmark me-1"></i>Saved Presets</div>
            <div class="card-body" style="max-height:50vh;overflow-y:auto">
              ${presets.length ? presets.map(p => `
                <div class="d-flex justify-content-between align-items-center p-2 border-bottom border-secondary">
                  <span><i class="bi bi-tag me-1 text-warning"></i>${p}</span>
                  <div class="d-flex gap-1">
                    <button class="btn btn-outline-warning btn-sm" onclick="App.loadPreset('${name}','${p}')"><i class="bi bi-upload"></i> Load</button>
                    <button class="btn btn-outline-danger btn-sm" onclick="App.deletePreset('${name}','${p}')"><i class="bi bi-trash"></i></button>
                  </div>
                </div>
              `).join('') : '<p class="text-secondary text-center py-3">No presets saved.</p>'}
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card h-100">
            <div class="card-header"><i class="bi bi-save me-1"></i>Save Current as Preset</div>
            <div class="card-body">
              <div class="mb-3">
                <label class="form-label small text-secondary">Preset Name</label>
                <input class="form-control form-control-sm" id="preset-name" placeholder="e.g. monaco-race">
              </div>
              <button class="btn btn-warning btn-sm" onclick="App.savePreset('${name}')"><i class="bi bi-floppy"></i> Save Preset</button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  async savePreset(name) {
    const preset = document.getElementById('preset-name')?.value?.trim();
    if (!preset) { this.toast('Enter a preset name', 'warning'); return; }
    const r = await this.api(`/instances/${name}/presets/save`, { method: 'POST', body: JSON.stringify({ preset }) });
    if (r.ok) { this.toast(`Preset '${preset}' saved`); this.renderPresets(name, document.getElementById('inst-content')); }
    else { this.toast(`Save failed: ${r.stderr || r.error}`, 'danger'); }
  },

  async loadPreset(name, preset) {
    if (!confirm(`Load preset '${preset}'? This will replace current config and mods.`)) return;
    const r = await this.api(`/instances/${name}/presets/load`, { method: 'POST', body: JSON.stringify({ preset }) });
    if (r.ok) { this.toast(`Preset '${preset}' loaded`); this.switchTab(name, 'overview'); }
    else { this.toast(`Load failed: ${r.stderr || r.error}`, 'danger'); }
  },

  async deletePreset(name, preset) {
    if (!confirm(`Delete preset '${preset}'?`)) return;
    const r = await this.api(`/instances/${name}/presets/delete`, { method: 'DELETE', body: JSON.stringify({ preset }) });
    if (r.ok) { this.toast(`Preset '${preset}' deleted`); this.renderPresets(name, document.getElementById('inst-content')); }
    else { this.toast(`Delete failed: ${r.stderr || r.error}`, 'danger'); }
  },

  async renderLogs(name, container) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span><i class="bi bi-terminal me-1"></i>Server Logs</span>
          <div class="d-flex gap-1">
            <button class="btn btn-outline-warning btn-sm" onclick="App.toggleAutoRefresh('${name}')" id="log-refresh-btn"><i class="bi bi-play-circle"></i> Auto-refresh</button>
            <button class="btn btn-outline-secondary btn-sm" onclick="App.refreshLogs('${name}')"><i class="bi bi-arrow-clockwise"></i></button>
          </div>
        </div>
        <div class="card-body p-0"><div class="log-viewer" id="log-content"><div class="text-secondary text-center py-5">Loading logs...</div></div></div>
      </div>
    `;
    await this.refreshLogs(name);
  },

  async refreshLogs(name) {
    const el = document.getElementById('log-content');
    if (!el) return;
    try {
      const r = await fetch(`/instances/${name}/logs`);
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch(e) { data = { stdout: text }; }
      const logText = data.stdout || data.error || 'No logs available';
      el.innerHTML = logText.split('\n').map(l => {
        const cls = l.toLowerCase().includes('error') ? 'error' : l.toLowerCase().includes('warn') ? 'warn' : l.toLowerCase().includes('info') ? 'info' : l.toLowerCase().includes('debug') ? 'debug' : '';
        return cls ? `<span class="${cls}">${this.esc(l)}</span>` : this.esc(l);
      }).join('\n');
      el.scrollTop = el.scrollHeight;
    } catch(e) {
      el.innerHTML = `<span class="error">Failed to fetch logs: ${e.message}</span>`;
    }
  },

  toggleAutoRefresh(name) {
    const btn = document.getElementById('log-refresh-btn');
    const existing = this.pollTimers.find(t => t._logPoll);
    if (existing) {
      clearInterval(existing);
      this.pollTimers = this.pollTimers.filter(t => t !== existing);
      btn.innerHTML = '<i class="bi bi-play-circle"></i> Auto-refresh';
      return;
    }
    const timer = setInterval(() => this.refreshLogs(name), 3000);
    timer._logPoll = true;
    this.pollTimers.push(timer);
    btn.innerHTML = '<i class="bi bi-stop-circle"></i> Auto-refresh ON';
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
