const statusEl = document.getElementById('status');
const listEl = document.getElementById('employee-list');
const urlInput = document.getElementById('url-input');

// Load saved URL
chrome.runtime.sendMessage({ action: 'getWhiteboardUrl' }, (res) => {
  if (res && res.url) urlInput.value = res.url;
});

async function refresh() {
  statusEl.textContent = 'Checking...';
  statusEl.className = '';

  chrome.runtime.sendMessage({ action: 'getWhiteboardUrl' }, async (urlRes) => {
    const url = urlRes && urlRes.url ? urlRes.url : 'https://whiteboard.fly.dev';

    try {
      const pingRes = await fetch(`${url}/api/ping`);
      const pingData = await pingRes.json();
      statusEl.textContent = `Connected — ${new Date(pingData.timestamp).toLocaleTimeString()}`;
      statusEl.className = 'ok';
    } catch {
      statusEl.textContent = 'Server unreachable';
      statusEl.className = 'err';
    }

    // Load employees
    chrome.runtime.sendMessage({ action: 'getEmployees' }, (res) => {
      if (res && res.success && res.employees) {
        renderEmployees(res.employees);
      } else {
        listEl.innerHTML = '<div class="empty">Could not load employees</div>';
      }
    });
  });
}

function renderEmployees(employees) {
  listEl.innerHTML = '';

  if (!employees || employees.length === 0) {
    listEl.innerHTML = '<div class="empty">No employees synced yet</div>';
    return;
  }

  employees.forEach(emp => {
    const permCount = emp.permissions ? Object.keys(emp.permissions).length : 0;
    const el = document.createElement('div');
    el.className = 'employee-item';
    el.innerHTML = `
      <div>
        <div class="name">${escapeHtml(emp.name || emp.id)}</div>
        <div class="login">${escapeHtml(emp.login || '')} | Badge: ${escapeHtml(emp.badge || '—')}</div>
        <div class="perms">${permCount} permission${permCount !== 1 ? 's' : ''}</div>
      </div>
      <button title="Remove" data-id="${escapeHtml(emp.id)}">&times;</button>
    `;
    el.querySelector('button').addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'removeEmployee', employeeId: emp.id }, () => {
        refresh();
      });
    });
    listEl.appendChild(el);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

document.getElementById('refresh-btn').addEventListener('click', refresh);

document.getElementById('save-url-btn').addEventListener('click', () => {
  const url = urlInput.value.trim().replace(/\/+$/, '');
  if (!url) return;
  chrome.runtime.sendMessage({ action: 'setWhiteboardUrl', url }, () => {
    refresh();
  });
});

refresh();
