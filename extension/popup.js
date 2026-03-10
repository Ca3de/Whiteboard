const statusEl = document.getElementById('status');
const rosterListEl = document.getElementById('roster-list');
const rosterCountEl = document.getElementById('roster-count');
const syncInfoEl = document.getElementById('sync-info');
const urlInput = document.getElementById('url-input');
const syncBtn = document.getElementById('sync-btn');

// --- Load state ---

function init() {
  loadServerStatus();
  loadRoster();
  loadSyncStatus();
  loadUrl();
}

function loadServerStatus() {
  statusEl.textContent = 'Checking...';
  statusEl.className = '';

  chrome.runtime.sendMessage({ action: 'getWhiteboardUrl' }, (urlRes) => {
    const url = urlRes && urlRes.url ? urlRes.url : 'https://ca3de-whiteboard.fly.dev';
    fetch(`${url}/api/ping`)
      .then(r => r.json())
      .then(data => {
        statusEl.textContent = `Server connected — ${new Date(data.timestamp).toLocaleTimeString()}`;
        statusEl.className = 'ok';
      })
      .catch(() => {
        statusEl.textContent = 'Server unreachable';
        statusEl.className = 'err';
      });
  });
}

function loadRoster() {
  chrome.runtime.sendMessage({ action: 'getRoster' }, (res) => {
    const roster = (res && res.roster) || [];
    rosterCountEl.textContent = roster.length;
    renderRoster(roster);
  });
}

function renderRoster(roster) {
  rosterListEl.innerHTML = '';
  if (!roster || roster.length === 0) {
    rosterListEl.innerHTML = '<div style="color:#718096;font-size:11px;padding:8px">No AAs in roster</div>';
    return;
  }

  roster.forEach(login => {
    const tag = document.createElement('span');
    tag.className = 'roster-tag';
    tag.innerHTML = `${esc(login)}<button title="Remove">&times;</button>`;
    tag.querySelector('button').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'removeFromRoster', login }, () => {
        loadRoster();
      });
    });
    rosterListEl.appendChild(tag);
  });
}

function loadSyncStatus() {
  chrome.runtime.sendMessage({ action: 'getSyncStatus' }, (res) => {
    if (res && res.lastSyncTime) {
      const date = new Date(res.lastSyncTime);
      const result = res.lastSyncResult || {};
      let text = `Last sync: ${date.toLocaleString()}`;
      if (result.synced !== undefined) {
        text += ` — ${result.synced} synced`;
        if (result.failed > 0) text += `, ${result.failed} failed`;
      }
      if (result.error) {
        text = `Last attempt failed: ${result.error}`;
        syncInfoEl.style.color = '#fca5a5';
      } else {
        syncInfoEl.style.color = '#718096';
      }
      syncInfoEl.textContent = text;
    } else {
      syncInfoEl.textContent = 'Never synced — click "Sync Now" (with FCLM tab open)';
    }
  });
}

function loadUrl() {
  chrome.runtime.sendMessage({ action: 'getWhiteboardUrl' }, (res) => {
    if (res && res.url) urlInput.value = res.url;
  });
}

// --- Add to roster ---

document.getElementById('add-btn').addEventListener('click', () => {
  const input = document.getElementById('add-login');
  const login = input.value.trim().toLowerCase();
  if (!login) return;
  chrome.runtime.sendMessage({ action: 'addToRoster', login }, () => {
    input.value = '';
    loadRoster();
  });
});

document.getElementById('add-login').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-btn').click();
});

// --- Sync now ---

syncBtn.addEventListener('click', () => {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing...';
  chrome.runtime.sendMessage({ action: 'triggerSync' }, (res) => {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Sync Now';

    if (res && res.error) {
      if (res.error === 'no_fclm_tab') {
        statusEl.textContent = 'Open an FCLM tab first!';
        statusEl.className = 'warn';
      } else {
        statusEl.textContent = 'Sync failed: ' + res.error;
        statusEl.className = 'err';
      }
    } else {
      loadSyncStatus();
      loadServerStatus();
    }
  });
});

// --- Save URL ---

document.getElementById('save-url-btn').addEventListener('click', () => {
  const url = urlInput.value.trim().replace(/\/+$/, '');
  if (!url) return;
  chrome.runtime.sendMessage({ action: 'setWhiteboardUrl', url }, () => {
    loadServerStatus();
  });
});

// --- Helpers ---

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

init();
