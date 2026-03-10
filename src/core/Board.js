/**
 * Board — core domain model for whiteboard
 *
 * Manages strokes, sticky notes, and text labels.
 */
class Board {
  constructor({ onEvent }) {
    this._strokes = [];
    this._notes = [];
    this._texts = [];
    this._onEvent = onEvent || (() => {});
  }

  get state() {
    return {
      strokes: [...this._strokes],
      notes: [...this._notes],
      texts: [...this._texts]
    };
  }

  addStroke(stroke) {
    this._strokes.push(stroke);
    this._onEvent('stroke:added', { stroke });
    return stroke;
  }

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

  moveNote(id, x, y) {
    return this.updateNote(id, { x, y });
  }

  deleteNote(id) {
    const before = this._notes.length;
    this._notes = this._notes.filter(n => n.id !== id);
    if (this._notes.length < before) {
      this._onEvent('note:deleted', { id });
      return true;
    }
    return false;
  }

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

  moveText(id, x, y) {
    return this.updateText(id, { x, y });
  }

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
    this._strokes = [];
    this._notes = [];
    this._texts = [];
    this._onEvent('cleared', {});
  }
}

module.exports = Board;
