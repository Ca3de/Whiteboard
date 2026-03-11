/**
 * Whiteboard Extension — Background Service Worker
 *
 * Manages:
 *   - AA roster (stored in chrome.storage.local)
 *   - 5-hour sync alarm
 *   - Relay employee permissions data to Whiteboard server
 *   - Find an FCLM tab to run fetches through
 */

const DEFAULT_WHITEBOARD_URL = 'https://ca3de-whiteboard.fly.dev';
const SYNC_ALARM_NAME = 'whiteboard-sync';
const SYNC_INTERVAL_MINUTES = 300; // 5 hours

// Default roster — seeded on first install
const DEFAULT_ROSTER = [
  'alicpops', 'smmahma', 'mawngsui', 'kahlcame', 'rrodrigq',
  'kamvan', 'naiamzn', 'ththan', 'ktthawng', 'hougeuni',
  'mureknya', 'shabjmoh', 'malabigk', 'pregaell', 'germbadb',
  'suchante', 'lthana', 'ngutling', 'nilianz', 'umyothan',
  'zdesstay', 'dawtling', 'pahupwin', 'thluacim', 'iranbash',
  'tijosep', 'lgaljuan', 'vankims', 'wluthang', 'hrialalj',
  'dialmmah', 'thluangu', 'aunpi', 'tawtan', 'qmaaye',
  'damiakij', 'pahenris', 'barljenn', 'stjeakez', 'abebayet',
  'jeanropi', 'vilsmois', 'zbourfra', 'htikewin', 'rwweldea',
  'avlia', 'wblacksm', 'tedromih', 'jakoreyn', 'wrmarcia',
  'donettaj', 'masengap', 'belavlag', 'boithan', 'jacqamic',
  'hnijenny', 'simpjony', 'angladch', 'lkawl', 'wkhanars',
  'lzohming', 'ronalcou', 'szweldey', 'whabebec', 'genebezu',
  'uniscer', 'alzamb'
];

// --- Initialization ---

chrome.runtime.onInstalled.addListener(() => {
  // Seed roster on first install
  chrome.storage.local.get('roster', (data) => {
    if (!data.roster || data.roster.length === 0) {
      chrome.storage.local.set({ roster: DEFAULT_ROSTER });
      console.log('[Whiteboard BG] Roster seeded with', DEFAULT_ROSTER.length, 'AAs');
    }
  });

  // Set up the 5-hour sync alarm
  chrome.alarms.create(SYNC_ALARM_NAME, {
    delayInMinutes: 1,            // first sync 1 min after install
    periodInMinutes: SYNC_INTERVAL_MINUTES
  });
  console.log('[Whiteboard BG] Sync alarm created (every 5 hours)');
});

// Also create alarm on service worker startup (in case it was killed)
chrome.alarms.get(SYNC_ALARM_NAME, (alarm) => {
  if (!alarm) {
    chrome.alarms.create(SYNC_ALARM_NAME, {
      delayInMinutes: 1,
      periodInMinutes: SYNC_INTERVAL_MINUTES
    });
  }
});

// --- Alarm handler ---

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    console.log('[Whiteboard BG] Sync alarm fired');
    triggerSync();
  }
});

// --- Track FCLM tabs ---

let fclmTabIds = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // FCLM tab ready notification
  if (msg.action === 'fclmTabReady') {
    if (sender.tab) {
      fclmTabIds.add(sender.tab.id);
      console.log('[Whiteboard BG] FCLM tab registered:', sender.tab.id);
    }
    sendResponse({ ok: true });
    return false;
  }

  // Employee permissions data from content script
  if (msg.action === 'employeePermissions') {
    syncEmployee(msg.data)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => {
        console.error('[Whiteboard BG] Sync error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  // Get employees from server
  if (msg.action === 'getEmployees') {
    fetchEmployees()
      .then(employees => sendResponse({ success: true, employees }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Remove employee
  if (msg.action === 'removeEmployee') {
    removeEmployee(msg.employeeId)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Roster management
  if (msg.action === 'getRoster') {
    chrome.storage.local.get('roster', (data) => {
      sendResponse({ roster: data.roster || [] });
    });
    return true;
  }

  if (msg.action === 'setRoster') {
    chrome.storage.local.set({ roster: msg.roster }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.action === 'addToRoster') {
    chrome.storage.local.get('roster', (data) => {
      const roster = data.roster || [];
      const login = msg.login.toLowerCase().trim();
      if (!roster.includes(login)) {
        roster.push(login);
        chrome.storage.local.set({ roster }, () => {
          sendResponse({ success: true, roster });
        });
      } else {
        sendResponse({ success: true, roster });
      }
    });
    return true;
  }

  if (msg.action === 'removeFromRoster') {
    chrome.storage.local.get('roster', (data) => {
      const roster = (data.roster || []).filter(l => l !== msg.login);
      chrome.storage.local.set({ roster }, () => {
        sendResponse({ success: true, roster });
      });
    });
    return true;
  }

  // Server URL management
  if (msg.action === 'getWhiteboardUrl') {
    chrome.storage.local.get('whiteboardUrl', (data) => {
      sendResponse({ url: data.whiteboardUrl || DEFAULT_WHITEBOARD_URL });
    });
    return true;
  }

  if (msg.action === 'setWhiteboardUrl') {
    chrome.storage.local.set({ whiteboardUrl: msg.url }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  // Manual sync trigger
  if (msg.action === 'triggerSync') {
    triggerSync().then(result => {
      sendResponse({ success: true, result });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  // Sync status
  if (msg.action === 'getSyncStatus') {
    chrome.storage.local.get(['lastSyncTime', 'lastSyncResult'], (data) => {
      sendResponse({
        lastSyncTime: data.lastSyncTime || null,
        lastSyncResult: data.lastSyncResult || null
      });
    });
    return true;
  }
});

// Clean up closed tabs
chrome.tabs.onRemoved.addListener((tabId) => {
  fclmTabIds.delete(tabId);
});

// --- Sync logic ---

/**
 * Find an active FCLM tab to run the sync through.
 * The content script on that tab will make same-origin fetches.
 */
async function findFclmTab() {
  // First check our tracked tabs
  for (const tabId of fclmTabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url && tab.url.includes('fclm-portal.amazon.com')) {
        return tabId;
      }
    } catch {
      fclmTabIds.delete(tabId);
    }
  }

  // Search for any FCLM tab
  const tabs = await chrome.tabs.query({ url: 'https://fclm-portal.amazon.com/*' });
  if (tabs.length > 0) {
    fclmTabIds.add(tabs[0].id);
    return tabs[0].id;
  }

  return null;
}

/**
 * Trigger a full roster sync.
 */
async function triggerSync() {
  const tabId = await findFclmTab();
  if (!tabId) {
    console.warn('[Whiteboard BG] No FCLM tab found — cannot sync. Open any FCLM page first.');
    chrome.storage.local.set({
      lastSyncResult: { error: 'No FCLM tab open. Open fclm-portal.amazon.com in a tab.' }
    });
    return { error: 'no_fclm_tab' };
  }

  const data = await new Promise(resolve => {
    chrome.storage.local.get('roster', resolve);
  });
  const roster = data.roster || [];
  if (roster.length === 0) {
    console.warn('[Whiteboard BG] Roster is empty');
    return { error: 'empty_roster' };
  }

  console.log(`[Whiteboard BG] Starting sync for ${roster.length} AAs via tab ${tabId}`);

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, {
      action: 'startSync',
      roster
    }, (result) => {
      if (chrome.runtime.lastError) {
        console.error('[Whiteboard BG] Sync failed:', chrome.runtime.lastError.message);
        chrome.storage.local.set({
          lastSyncResult: { error: chrome.runtime.lastError.message }
        });
        resolve({ error: chrome.runtime.lastError.message });
        return;
      }

      console.log('[Whiteboard BG] Sync complete:', result);
      chrome.storage.local.set({
        lastSyncTime: Date.now(),
        lastSyncResult: result
      });
      resolve(result);
    });
  });
}

// --- Server API helpers ---

async function getServerUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get('whiteboardUrl', (data) => {
      resolve(data.whiteboardUrl || DEFAULT_WHITEBOARD_URL);
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
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Server returned ${res.status}: ${body}`);
  }
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
