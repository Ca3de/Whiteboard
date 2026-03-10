/**
 * Board — core domain model for whiteboard
 *
 * Manages boxes (process paths), tags (lockable, single-instance),
 * strokes, sticky notes, and text labels.
 */
class Board {
  constructor({ onEvent }) {
    this._boxes = [];
    this._strokes = [];
    this._notes = [];
    this._texts = [];
    this._onEvent = onEvent || (() => {});

    // Tags: predefined list. Each tag can be placed on the board or in the palette.
    // Placed tags have x, y coordinates. Locked tags have a lockedBy session id.
    this._availableTags = [
      { id: 'tag-urgent', label: 'Urgent' },
      { id: 'tag-blocked', label: 'Blocked' },
      { id: 'tag-in-review', label: 'In Review' },
      { id: 'tag-approved', label: 'Approved' },
      { id: 'tag-needs-info', label: 'Needs Info' },
      { id: 'tag-high-priority', label: 'High Priority' },
      { id: 'tag-low-priority', label: 'Low Priority' },
      { id: 'tag-bug', label: 'Bug' },
      { id: 'tag-feature', label: 'Feature' },
      { id: 'tag-tech-debt', label: 'Tech Debt' },
      { id: 'tag-qa-ready', label: 'QA Ready' },
      { id: 'tag-deployed', label: 'Deployed' }
    ];

    // Placed tags: { id, label, x, y, lockedBy: null | sessionId }
    this._placedTags = [];
  }

  get state() {
    return {
      boxes: [...this._boxes],
      strokes: [...this._strokes],
      notes: [...this._notes],
      texts: [...this._texts],
      availableTags: this._availableTags.map(t => ({ ...t })),
      placedTags: this._placedTags.map(t => ({ ...t }))
    };
  }

  // --- Tags ---

  isTagPlaced(tagId) {
    return this._placedTags.some(t => t.id === tagId);
  }

  placeTag(tagId, x, y) {
    if (this.isTagPlaced(tagId)) return null;
    const def = this._availableTags.find(t => t.id === tagId);
    if (!def) return null;
    const placed = { id: tagId, label: def.label, x, y, lockedBy: null };
    this._placedTags.push(placed);
    this._onEvent('tag:placed', { tag: placed });
    return placed;
  }

  removeTagFromBoard(tagId) {
    const tag = this._placedTags.find(t => t.id === tagId);
    if (!tag) return false;
    if (tag.lockedBy) return false; // can't remove a locked tag
    this._placedTags = this._placedTags.filter(t => t.id !== tagId);
    this._onEvent('tag:removed', { id: tagId });
    return true;
  }

  lockTag(tagId, sessionId) {
    const tag = this._placedTags.find(t => t.id === tagId);
    if (!tag) return null;
    if (tag.lockedBy && tag.lockedBy !== sessionId) return null; // already locked by someone else
    tag.lockedBy = sessionId;
    this._onEvent('tag:locked', { id: tagId, lockedBy: sessionId });
    return tag;
  }

  unlockTag(tagId, sessionId) {
    const tag = this._placedTags.find(t => t.id === tagId);
    if (!tag) return null;
    if (tag.lockedBy !== sessionId) return null; // not locked by this session
    tag.lockedBy = null;
    this._onEvent('tag:unlocked', { id: tagId });
    return tag;
  }

  moveTag(tagId, x, y, sessionId) {
    const tag = this._placedTags.find(t => t.id === tagId);
    if (!tag) return null;
    if (tag.lockedBy && tag.lockedBy !== sessionId) return null;
    tag.x = x;
    tag.y = y;
    this._onEvent('tag:moved', { id: tagId, x, y });
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
      this._onEvent('box:deleted', { id });
      return true;
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
