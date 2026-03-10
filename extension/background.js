/**
 * Whiteboard Extension — Background Service Worker
 *
 * Receives employee permission data from the FCLM content script
 * and forwards it to the Whiteboard server.
 */

const WHITEBOARD_URL = 'https://whiteboard.fly.dev';

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'employeePermissions') {
    syncEmployee(msg.data)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => {
        console.error('[Whiteboard BG] Sync error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // keep channel open for async response
  }

  if (msg.action === 'getEmployees') {
    fetchEmployees()
      .then(employees => sendResponse({ success: true, employees }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.action === 'removeEmployee') {
    removeEmployee(msg.employeeId)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.action === 'getWhiteboardUrl') {
    chrome.storage.local.get('whiteboardUrl', (data) => {
      sendResponse({ url: data.whiteboardUrl || WHITEBOARD_URL });
    });
    return true;
  }

  if (msg.action === 'setWhiteboardUrl') {
    chrome.storage.local.set({ whiteboardUrl: msg.url }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function getServerUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get('whiteboardUrl', (data) => {
      resolve(data.whiteboardUrl || WHITEBOARD_URL);
    });
  });
}

async function syncEmployee(data) {
  const url = await getServerUrl();
  const res = await fetch(`${url}/api/employees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

async function fetchEmployees() {
  const url = await getServerUrl();
  const res = await fetch(`${url}/api/employees`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

async function removeEmployee(employeeId) {
  const url = await getServerUrl();
  const res = await fetch(`${url}/api/employees/${encodeURIComponent(employeeId)}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}
