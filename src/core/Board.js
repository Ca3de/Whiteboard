/**
 * Board — core domain model for whiteboard
 *
 * Manages boxes (process paths), strokes, sticky notes, and text labels.
 */
class Board {
  constructor({ onEvent }) {
    this._boxes = [];    // { id, name, x, y, w, h, color }
    this._strokes = [];
    this._notes = [];
    this._texts = [];
    this._onEvent = onEvent || (() => {});
  }

  get state() {
    return {
      boxes: [...this._boxes],
      strokes: [...this._strokes],
      notes: [...this._notes],
      texts: [...this._texts]
    };
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

  moveBox(id, x, y) {
    return this.updateBox(id, { x, y });
  }

  resizeBox(id, w, h) {
    return this.updateBox(id, { w, h });
  }

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
    this._onEvent('cleared', {});
  }
}

module.exports = Board;
