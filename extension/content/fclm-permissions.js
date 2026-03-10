/**
 * Content script — FCLM Employee Permissions page
 *
 * Runs on: fclm-portal.amazon.com/employee/permissions*
 *
 * Extracts:
 *   1. Employee info (login, name, badge, emplId) from empDetailCard
 *   2. Permission levels per subprocess from the permissions table
 *   3. Falls back to Default Menu options (subprocesses = Beginner+)
 *
 * Sends the data to the background service worker for relay to Whiteboard.
 */

(function () {
  'use strict';

  // Wait for the page to fully load before scraping
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Small delay to let any dynamic content render
    setTimeout(scrapeAndSend, 1500);
  }

  /**
   * Extract employee info from the empDetailCard table
   */
  function extractEmployeeInfo() {
    const info = {};

    // Name from the fold-control span: "Oladeji,Israel (oladeisr)"
    const titleSpan = document.querySelector('.empDetailCard .fold-control');
    if (titleSpan) {
      const match = titleSpan.textContent.trim().match(/^(.+?)\s*\((\w+)\)$/);
      if (match) {
        // "Oladeji,Israel" -> "Israel Oladeji"
        const rawName = match[1];
        const parts = rawName.split(',').map(s => s.trim());
        info.name = parts.length === 2 ? `${parts[1]} ${parts[0]}` : rawName;
        info.login = match[2];
      }
    }

    // Parse the dl.list-side-by-side fields
    const dlElements = document.querySelectorAll('.empDetailCard dl.list-side-by-side');
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

    // Badge photo URL for employee ID fallback
    const photo = document.querySelector('.empDetailCard .badgePhoto img');
    if (photo && !info.emplId) {
      const m = photo.src.match(/employeeid=(\d+)/i);
      if (m) info.emplId = m[1];
    }

    return info;
  }

  /**
   * Parse the permissions table.
   *
   * FCLM permissions tables use sortableTable with columns for
   * Process, Subprocess (or Function), and Level.
   * We look for any table in the main content area and try to
   * identify the level column.
   */
  function extractPermissionsFromTable() {
    const permissions = {};

    // Find tables in the main panel (after the control-panel)
    const mainPanel = document.getElementById('main-panel');
    if (!mainPanel) return permissions;

    const tables = mainPanel.querySelectorAll('table');
    for (const table of tables) {
      // Skip the control-panel form table
      if (table.closest('.cp-form')) continue;

      const rows = table.querySelectorAll('tr');
      if (rows.length < 2) continue;

      // Try to identify header columns
      const headerRow = rows[0];
      const headers = Array.from(headerRow.querySelectorAll('th, td'))
        .map(th => th.textContent.trim().toLowerCase());

      // Look for columns that indicate process/subprocess/level
      let processCol = -1, subprocessCol = -1, levelCol = -1;
      headers.forEach((h, i) => {
        if (h.includes('process') && !h.includes('sub')) processCol = i;
        if (h.includes('subprocess') || h.includes('function') || h.includes('menu')) subprocessCol = i;
        if (h.includes('level') || h.includes('permission') || h.includes('current')) levelCol = i;
      });

      // If we found meaningful columns, parse data rows
      if (subprocessCol >= 0 && levelCol >= 0) {
        for (let r = 1; r < rows.length; r++) {
          const cells = rows[r].querySelectorAll('td');
          if (cells.length <= Math.max(subprocessCol, levelCol)) continue;

          const subprocess = cells[subprocessCol].textContent.trim();
          const level = cells[levelCol].textContent.trim();
          if (subprocess && level) {
            permissions[subprocess] = level;
          }
        }
      }

      // Alternative: look for rows with select elements for level
      if (Object.keys(permissions).length === 0) {
        for (let r = 0; r < rows.length; r++) {
          const cells = rows[r].querySelectorAll('td');
          for (const cell of cells) {
            const select = cell.querySelector('select');
            if (select) {
              const selectedOpt = select.querySelector('option[selected]');
              if (selectedOpt) {
                // The subprocess name might be in a sibling/previous cell
                const prevCell = cell.previousElementSibling;
                if (prevCell) {
                  const subName = prevCell.textContent.trim();
                  if (subName) {
                    permissions[subName] = selectedOpt.textContent.trim();
                  }
                }
              }
            }
          }
        }
      }

      if (Object.keys(permissions).length > 0) break;
    }

    return permissions;
  }

  /**
   * Fallback: use the Default Menu dropdown options.
   * If a subprocess appears in this list, the employee has Beginner+ access.
   */
  function extractPermissionsFromDefaultMenu() {
    const permissions = {};
    const select = document.querySelector('select[name="newDefaultMenu"]');
    if (!select) return permissions;

    const options = select.querySelectorAll('option');
    options.forEach(opt => {
      const name = opt.textContent.trim();
      if (name && name !== '(None)' && opt.value !== '0') {
        // We know they have access, but not the exact level
        // Mark as "Permitted" — the server will treat this as Beginner+
        permissions[name] = 'Permitted';
      }
    });
    return permissions;
  }

  /**
   * Main: scrape data and send to background
   */
  function scrapeAndSend() {
    const employee = extractEmployeeInfo();
    if (!employee.login && !employee.emplId) {
      console.log('[Whiteboard] No employee data found on page');
      return;
    }

    // Try full table first, fall back to Default Menu
    let permissions = extractPermissionsFromTable();
    let source = 'table';
    if (Object.keys(permissions).length === 0) {
      permissions = extractPermissionsFromDefaultMenu();
      source = 'defaultMenu';
    }

    const data = {
      employee,
      permissions,
      source,
      timestamp: Date.now(),
      url: location.href
    };

    console.log('[Whiteboard] Scraped employee permissions:', data);

    // Send to background service worker
    chrome.runtime.sendMessage({
      action: 'employeePermissions',
      data
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Whiteboard] Failed to send:', chrome.runtime.lastError);
        return;
      }
      console.log('[Whiteboard] Background response:', response);
      showIndicator(response && response.success);
    });
  }

  /**
   * Show a small indicator on the page confirming sync
   */
  function showIndicator(success) {
    const existing = document.getElementById('wb-sync-indicator');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'wb-sync-indicator';
    el.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 99999;
      padding: 10px 18px; border-radius: 8px; font-size: 13px;
      font-family: -apple-system, sans-serif; font-weight: 600;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: opacity 0.3s;
      ${success
        ? 'background: #065f46; color: #d1fae5; border: 1px solid #10b981;'
        : 'background: #991b1b; color: #fee2e2; border: 1px solid #f87171;'}
    `;
    el.textContent = success ? 'Synced to Whiteboard' : 'Sync failed';
    document.body.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }
})();
