/**
 * Board — core domain model for whiteboard
 *
 * Manages boxes (process paths), tags (lockable, single-instance),
 * strokes, sticky notes, text labels, and employees with permissions.
 */

const LEVEL_RANK = { 'none': 0, 'beginner': 1, 'intermediate': 2, 'expert': 3, 'admin': 4, 'permitted': 1 };

// Subprocess compatibility: each group shares permissions.
// If an employee has permission for any subprocess in a group,
// they can work in any box whose name matches that group.
const SUBPROCESS_GROUPS = [
  ['pick', 'pick rf', 'v-returns pick'],
];

function areSubprocessesCompatible(boxName, permKey) {
  const a = boxName.toLowerCase();
  const b = permKey.toLowerCase();
  for (const group of SUBPROCESS_GROUPS) {
    const boxMatch = group.some(g => a === g || a.startsWith(g + ' ') || a.endsWith(' ' + g));
    const permMatch = group.some(g => b === g || b.startsWith(g + ' ') || b.endsWith(' ' + g));
    if (boxMatch && permMatch) return true;
  }
  return false;
}
function parseLevel(raw) {
  const s = raw.trim().toLowerCase();
  // Direct match first
  if (LEVEL_RANK[s] !== undefined) return { level: raw, rank: LEVEL_RANK[s] };
  // Strip leading digits: "1beginner" → "beginner", "0none" → "none"
  const stripped = s.replace(/^\d+/, '');
  if (LEVEL_RANK[stripped] !== undefined) return { level: stripped, rank: LEVEL_RANK[stripped] };
  // Unknown
  return { level: raw, rank: 0 };
}

class Board {
  constructor({ onEvent }) {
    this._boxes = [];
    this._strokes = [];
    this._notes = [];
    this._texts = [];
    this._onEvent = onEvent || (() => {});

    // Employees synced from FCLM extension
    // { id, login, name, badge, emplId, shift, permissions: { subprocess: level }, lastSynced }
    this._employees = [];

    // Tags (badges) derived from employees.
    // Each can be placed on the board or remain in the palette.
    this._availableTags = [];

    // Placed tags: { id, label, boxId, lockedBy: null | sessionId }
    this._placedTags = [];
  }

  get state() {
    return {
      boxes: [...this._boxes],
      strokes: [...this._strokes],
      notes: [...this._notes],
      texts: [...this._texts],
      availableTags: this._availableTags.map(t => ({ ...t })),
      placedTags: this._placedTags.map(t => ({ ...t })),
      employees: this._employees.map(e => ({ ...e, permissions: { ...e.permissions } }))
    };
  }

  // --- Employees ---

  addOrUpdateEmployee(data) {
    const { employee, permissions, source, timestamp } = data;
    const id = employee.login || employee.emplId;
    if (!id) return null;

    const existing = this._employees.find(e => e.id === id);
    if (existing) {
      existing.name = employee.name || existing.name;
      existing.badge = employee.badge || existing.badge;
      existing.emplId = employee.emplId || existing.emplId;
      existing.login = employee.login || existing.login;
      existing.shift = employee.shift || existing.shift;
      existing.permissions = permissions || existing.permissions;
      existing.source = source;
      existing.lastSynced = timestamp || Date.now();
    } else {
      this._employees.push({
        id,
        login: employee.login,
        name: employee.name || id,
        badge: employee.badge,
        emplId: employee.emplId,
        shift: employee.shift,
        permissions: permissions || {},
        source,
        lastSynced: timestamp || Date.now()
      });
    }

    // Rebuild available tags from employees
    this._rebuildTags();
    this._onEvent('employee:synced', { id });
    return this._employees.find(e => e.id === id);
  }

  removeEmployee(id) {
    const before = this._employees.length;
    this._employees = this._employees.filter(e => e.id !== id);
    if (this._employees.length < before) {
      // Remove placed tag for this employee
      const tagId = `emp-${id}`;
      this._placedTags = this._placedTags.filter(t => t.id !== tagId);
      this._rebuildTags();
      this._onEvent('employee:removed', { id });
      return true;
    }
    return false;
  }

  getEmployees() {
    return this._employees.map(e => ({ ...e, permissions: { ...e.permissions } }));
  }

  _rebuildTags() {
    this._availableTags = this._employees.map(e => ({
      id: `emp-${e.id}`,
      label: e.name || e.login || e.id,
      employeeId: e.id
    }));
  }

  /**
   * Check if an employee has permission (Beginner+) for a subprocess.
   * Returns { allowed, level, required } or null if no employee found.
   */
  checkPermission(employeeId, subprocessName) {
    const emp = this._employees.find(e => e.id === employeeId);
    if (!emp) return { allowed: true, level: 'unknown', reason: 'no employee data' };

    // Find the best permission match for this subprocess.
    // Try exact match first, then check if any permission key is a prefix
    // of the box name (e.g. "Pick" matches "Pick RF").
    const subLower = subprocessName.toLowerCase();
    let level = null;

    // Exact match
    for (const [key, val] of Object.entries(emp.permissions)) {
      if (key.toLowerCase() === subLower) {
        level = val;
        break;
      }
    }

    // Prefix match: permission "Pick" covers box "Pick RF"
    if (level === null) {
      let bestLen = 0;
      for (const [key, val] of Object.entries(emp.permissions)) {
        const keyLower = key.toLowerCase();
        if (subLower.startsWith(keyLower) && keyLower.length > bestLen) {
          const parsed = parseLevel(val);
          if (parsed.rank >= 1) {
            level = val;
            bestLen = keyLower.length;
          }
        }
      }
    }

    // Subprocess group match: e.g. "Pick RF" permission covers "V-Returns Pick" box
    if (level === null) {
      for (const [key, val] of Object.entries(emp.permissions)) {
        if (areSubprocessesCompatible(subprocessName, key)) {
          const parsed = parseLevel(val);
          if (parsed.rank >= 1) {
            level = val;
            break;
          }
        }
      }
    }

    // If no permission entry exists, check if this is a subprocess we track
    if (level === null) {
      // If employee has permissions data but this subprocess isn't listed,
      // it means they have "None" for it
      if (Object.keys(emp.permissions).length > 0) {
        return { allowed: false, level: 'None', reason: `No permission for ${subprocessName}` };
      }
      // No permissions data at all — allow by default
      return { allowed: true, level: 'unknown', reason: 'no permission data loaded' };
    }

    const parsed = parseLevel(level);
    const allowed = parsed.rank >= 1; // Beginner or higher
    return {
      allowed,
      level: parsed.level,
      reason: allowed ? null : `${emp.name || emp.id} has ${parsed.level} for ${subprocessName}`
    };
  }

  // --- Tags (badges) ---

  isTagPlaced(tagId) {
    return this._placedTags.some(t => t.id === tagId);
  }

  placeTag(tagId, boxId) {
    if (this.isTagPlaced(tagId)) return null;
    const box = this._boxes.find(b => b.id === boxId);
    if (!box) return null;
    const def = this._availableTags.find(t => t.id === tagId);
    if (!def) return null;

    // Permission check
    if (def.employeeId) {
      const check = this.checkPermission(def.employeeId, box.name);
      if (!check.allowed) {
        return { denied: true, reason: check.reason, level: check.level };
      }
    }

    const placed = { id: tagId, label: def.label, employeeId: def.employeeId, boxId, lockedBy: null };
    this._placedTags.push(placed);
    this._onEvent('tag:placed', { tag: placed });
    return placed;
  }

  removeTagFromBoard(tagId) {
    const tag = this._placedTags.find(t => t.id === tagId);
    if (!tag) return false;
    if (tag.lockedBy) return false;
    this._placedTags = this._placedTags.filter(t => t.id !== tagId);
    this._onEvent('tag:removed', { id: tagId });
    return true;
  }

  lockTag(tagId, sessionId) {
    const tag = this._placedTags.find(t => t.id === tagId);
    if (!tag) return null;
    if (tag.lockedBy && tag.lockedBy !== sessionId) return null;
    tag.lockedBy = sessionId;
    this._onEvent('tag:locked', { id: tagId, lockedBy: sessionId });
    return tag;
  }

  unlockTag(tagId, sessionId, boxId) {
    const tag = this._placedTags.find(t => t.id === tagId);
    if (!tag) return null;
    if (tag.lockedBy !== sessionId) return null;

    // Permission check on new box
    if (boxId && boxId !== tag.boxId) {
      const box = this._boxes.find(b => b.id === boxId);
      if (box) {
        const def = this._availableTags.find(t => t.id === tagId);
        if (def && def.employeeId) {
          const check = this.checkPermission(def.employeeId, box.name);
          if (!check.allowed) {
            // Revert to original box
            tag.lockedBy = null;
            this._onEvent('tag:move-denied', {
              id: tagId, boxId: tag.boxId, reason: check.reason
            });
            return { ...tag, denied: true, reason: check.reason };
          }
        }
      }
    }

    // Move to new box if provided and valid
    if (boxId && this._boxes.find(b => b.id === boxId)) {
      tag.boxId = boxId;
    }
    tag.lockedBy = null;
    this._onEvent('tag:unlocked', { id: tagId, boxId: tag.boxId });
    return tag;
  }

  moveTag(tagId, boxId, sessionId) {
    const tag = this._placedTags.find(t => t.id === tagId);
    if (!tag) return null;
    if (tag.lockedBy && tag.lockedBy !== sessionId) return null;
    if (!this._boxes.find(b => b.id === boxId)) return null;
    tag.boxId = boxId;
    this._onEvent('tag:moved', { id: tagId, boxId });
    return tag;
  }

  // Release all locks held by a session (called on disconnect)
  releaseSessionLocks(sessionId) {
    const released = [];
    this._placedTags.forEach(tag => {
      if (tag.lockedBy === sessionId) {
        tag.lockedBy = null;
        released.push(tag.id);
      }
    });
    return released;
  }

  // --- Boxes (process paths) ---

  isBoxNameTaken(name, excludeId) {
    return this._boxes.some(b => b.name.toLowerCase() === name.toLowerCase() && b.id !== excludeId);
  }

  addBox(box) {
    if (this.isBoxNameTaken(box.name)) return null;
    this._boxes.push(box);
    this._onEvent('box:added', { box });
    return box;
  }

  updateBox(id, changes) {
    const box = this._boxes.find(b => b.id === id);
    if (!box) return null;
    if (changes.name && this.isBoxNameTaken(changes.name, id)) return null;
    Object.assign(box, changes);
    this._onEvent('box:updated', { id, ...changes });
    return box;
  }

  moveBox(id, x, y) { return this.updateBox(id, { x, y }); }
  resizeBox(id, w, h) { return this.updateBox(id, { w, h }); }

  deleteBox(id) {
    const before = this._boxes.length;
    this._boxes = this._boxes.filter(b => b.id !== id);
    if (this._boxes.length < before) {
      // Return all badges in this box back to the palette
      const returnedTags = this._placedTags.filter(t => t.boxId === id).map(t => t.id);
      this._placedTags = this._placedTags.filter(t => t.boxId !== id);
      this._onEvent('box:deleted', { id, returnedTags });
      return { deleted: true, returnedTags };
    }
    return false;
  }

  // --- Strokes ---

  addStroke(stroke) {
    this._strokes.push(stroke);
    this._onEvent('stroke:added', { stroke });
    return stroke;
  }

  // --- Notes ---

  addNote(note) {
    this._notes.push(note);
    this._onEvent('note:added', { note });
    return note;
  }

  updateNote(id, changes) {
    const note = this._notes.find(n => n.id === id);
    if (!note) return null;
    Object.assign(note, changes);
    this._onEvent('note:updated', { id, ...changes });
    return note;
  }

  moveNote(id, x, y) { return this.updateNote(id, { x, y }); }

  deleteNote(id) {
    const before = this._notes.length;
    this._notes = this._notes.filter(n => n.id !== id);
    if (this._notes.length < before) {
      this._onEvent('note:deleted', { id });
      return true;
    }
    return false;
  }

  // --- Text ---

  addText(textObj) {
    this._texts.push(textObj);
    this._onEvent('text:added', { textObj });
    return textObj;
  }

  updateText(id, changes) {
    const t = this._texts.find(t => t.id === id);
    if (!t) return null;
    Object.assign(t, changes);
    this._onEvent('text:updated', { id, ...changes });
    return t;
  }

  moveText(id, x, y) { return this.updateText(id, { x, y }); }

  deleteText(id) {
    const before = this._texts.length;
    this._texts = this._texts.filter(t => t.id !== id);
    if (this._texts.length < before) {
      this._onEvent('text:deleted', { id });
      return true;
    }
    return false;
  }

  clear() {
    this._boxes = [];
    this._strokes = [];
    this._notes = [];
    this._texts = [];
    this._placedTags = [];
    this._onEvent('cleared', {});
  }
}

module.exports = Board;
