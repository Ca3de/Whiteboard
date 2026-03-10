/**
 * Content script — FCLM permissions batch fetcher
 *
 * Runs on: fclm-portal.amazon.com/* (any FCLM page)
 *
 * On load (and every 5 hours via background alarm), fetches the
 * Employee Permissions page for each AA in the roster using
 * same-origin requests with session cookies. Parses employee info
 * and permission data from the HTML response, then sends to the
 * Whiteboard server via the background service worker.
 */

(function () {
  'use strict';

  const WAREHOUSE_ID = 'IND8';
  const BATCH_DELAY_MS = 800; // delay between fetches to avoid hammering FCLM

  // --- Init ---

  console.log('[Whiteboard] Content script loaded on FCLM');

  // Listen for sync requests from the background
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'startSync') {
      console.log('[Whiteboard] Sync requested by background');
      syncAllEmployees(msg.roster).then(results => {
        sendResponse({ success: true, results });
      }).catch(err => {
        console.error('[Whiteboard] Sync error:', err);
        sendResponse({ success: false, error: err.message });
      });
      return true; // async
    }

    if (msg.action === 'syncSingle') {
      fetchAndParseEmployee(msg.login).then(data => {
        sendResponse({ success: true, data });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  });

  // Notify background that an FCLM tab is ready
  chrome.runtime.sendMessage({ action: 'fclmTabReady' });

  // --- Fetch & Parse ---

  /**
   * Fetch the permissions page for a single employee and parse it.
   */
  async function fetchAndParseEmployee(login) {
    const url = `/employee/permissions?employeeId=${encodeURIComponent(login)}&warehouseId=${WAREHOUSE_ID}`;

    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${login}`);
    }

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const employee = extractEmployeeInfo(doc, login);
    const permissions = extractPermissions(doc);

    return {
      employee,
      permissions,
      source: Object.keys(permissions).length > 0 ? 'defaultMenu' : 'none',
      timestamp: Date.now()
    };
  }

  /**
   * Extract employee info from the parsed HTML document.
   */
  function extractEmployeeInfo(doc, fallbackLogin) {
    const info = { login: fallbackLogin };

    // Name from fold-control: "Oladeji,Israel (oladeisr)"
    const titleSpan = doc.querySelector('.empDetailCard .fold-control');
    if (titleSpan) {
      const match = titleSpan.textContent.trim().match(/^(.+?)\s*\((\w+)\)$/);
      if (match) {
        const rawName = match[1];
        const parts = rawName.split(',').map(s => s.trim());
        info.name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : rawName;
        info.login = match[2];
      }
    }

    // Parse dl.list-side-by-side fields
    const dlElements = doc.querySelectorAll('.empDetailCard dl.list-side-by-side');
    dlElements.forEach(dl => {
      const dts = dl.querySelectorAll('dt');
      const dds = dl.querySelectorAll('dd');
      for (let i = 0; i < dts.length && i < dds.length; i++) {
        const key = dts[i].textContent.trim();
        const val = dds[i].textContent.trim();
        if (key === 'Login') info.login = info.login || val;
        if (key === 'Empl ID') info.emplId = val;
        if (key === 'Badge') info.badge = val;
        if (key === 'Shift') info.shift = val;
        if (key === 'Location') info.location = val;
      }
    });

    // Badge photo for employee ID fallback
    const photo = doc.querySelector('.empDetailCard .badgePhoto img');
    if (photo && !info.emplId) {
      const m = (photo.getAttribute('src') || '').match(/employeeid=(\d+)/i);
      if (m) info.emplId = m[1];
    }

    return info;
  }

  /**
   * Extract permissions from parsed HTML.
   *
   * Strategy 1: Parse the sortable permissions table (process/subprocess/level cols)
   * Strategy 2: Fall back to Default Menu dropdown (subprocess options = Beginner+)
   */
  function extractPermissions(doc) {
    let permissions = {};

    // Strategy 1: sortable table
    const mainPanel = doc.getElementById('main-panel');
    if (mainPanel) {
      const tables = mainPanel.querySelectorAll('table');
      for (const table of tables) {
        if (table.closest('.cp-form')) continue;

        const rows = table.querySelectorAll('tr');
        if (rows.length < 2) continue;

        const headers = Array.from(rows[0].querySelectorAll('th, td'))
          .map(th => th.textContent.trim().toLowerCase());

        let subCol = -1, levelCol = -1;
        headers.forEach((h, i) => {
          if (h.includes('subprocess') || h.includes('function') || h.includes('menu')) subCol = i;
          if (h.includes('level') || h.includes('permission') || h.includes('current')) levelCol = i;
        });

        if (subCol >= 0 && levelCol >= 0) {
          for (let r = 1; r < rows.length; r++) {
            const cells = rows[r].querySelectorAll('td');
            if (cells.length <= Math.max(subCol, levelCol)) continue;
            const subprocess = cells[subCol].textContent.trim();
            const level = cells[levelCol].textContent.trim();
            if (subprocess && level) permissions[subprocess] = level;
          }
        }

        if (Object.keys(permissions).length > 0) return permissions;
      }
    }

    // Strategy 2: Default Menu dropdown options
    const select = doc.querySelector('select[name="newDefaultMenu"]');
    if (select) {
      select.querySelectorAll('option').forEach(opt => {
        const name = opt.textContent.trim();
        if (name && name !== '(None)' && opt.value !== '0') {
          permissions[name] = 'Permitted';
        }
      });
    }

    return permissions;
  }

  /**
   * Sync all employees in the roster sequentially with delay.
   */
  async function syncAllEmployees(roster) {
    const results = { synced: 0, failed: 0, errors: [] };
    showProgress(0, roster.length);

    for (let i = 0; i < roster.length; i++) {
      const login = roster[i];
      try {
        const data = await fetchAndParseEmployee(login);

        // Send to background for relay to Whiteboard server
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'employeePermissions',
            data
          }, (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (res && res.success) {
              resolve(res);
            } else {
              reject(new Error(res ? res.error : 'unknown'));
            }
          });
        });

        results.synced++;
        console.log(`[Whiteboard] Synced ${login} (${i + 1}/${roster.length})`);
      } catch (err) {
        results.failed++;
        results.errors.push({ login, error: err.message });
        console.warn(`[Whiteboard] Failed ${login}: ${err.message}`);
      }

      showProgress(i + 1, roster.length);

      // Delay between fetches
      if (i < roster.length - 1) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    showSyncComplete(results);
    return results;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // --- Progress indicator ---

  function showProgress(current, total) {
    let el = document.getElementById('wb-sync-progress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wb-sync-progress';
      el.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 99999;
        padding: 12px 20px; border-radius: 8px; font-size: 13px;
        font-family: -apple-system, sans-serif; font-weight: 600;
        background: #1e3a5f; color: #93c5fd; border: 1px solid #3b82f6;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); min-width: 200px;
      `;
      document.body.appendChild(el);
    }

    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    el.innerHTML = `
      <div style="margin-bottom:4px">Syncing to Whiteboard...</div>
      <div style="background:#1a1a2e;border-radius:4px;height:6px;overflow:hidden">
        <div style="background:#3b82f6;height:100%;width:${pct}%;transition:width 0.3s"></div>
      </div>
      <div style="font-size:11px;margin-top:4px;opacity:0.8">${current} / ${total}</div>
    `;
  }

  function showSyncComplete(results) {
    const el = document.getElementById('wb-sync-progress');
    if (!el) return;

    const isOk = results.failed === 0;
    el.style.background = isOk ? '#065f46' : '#713f12';
    el.style.color = isOk ? '#d1fae5' : '#fef3c7';
    el.style.borderColor = isOk ? '#10b981' : '#f59e0b';
    el.innerHTML = `
      <div>${results.synced} synced${results.failed > 0 ? `, ${results.failed} failed` : ''}</div>
    `;

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.5s';
      setTimeout(() => el.remove(), 500);
    }, 5000);
  }
})();
