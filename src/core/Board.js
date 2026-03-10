/**
 * Board — core domain model
 *
 * Pure state management, no transport or storage concerns.
 * Emits events via callback so plugins/transport can react.
 */
class Board {
  constructor({ paths, onEvent }) {
    this._tags = [];
    this._paths = paths || [];
    this._onEvent = onEvent || (() => {});
  }

  get state() {
    return { tags: [...this._tags], paths: [...this._paths] };
  }

  loadTags(tags) {
    this._tags = tags;
  }

  addPath(path) {
    if (!this._paths.find(p => p.id === path.id)) {
      this._paths.push(path);
    }
  }

  createTag({ id, text, pathId, color }) {
    const tag = { id, text, pathId, color };
    this._tags.push(tag);
    this._onEvent('tag:created', { tag });
    return tag;
  }

  moveTag(id, pathId) {
    const tag = this._tags.find(t => t.id === id);
    if (!tag) return null;
    if (!this._paths.find(p => p.id === pathId)) return null;
    tag.pathId = pathId;
    this._onEvent('tag:moved', { id, pathId });
    return tag;
  }

  deleteTag(id) {
    const before = this._tags.length;
    this._tags = this._tags.filter(t => t.id !== id);
    if (this._tags.length < before) {
      this._onEvent('tag:deleted', { id });
      return true;
    }
    return false;
  }
}

module.exports = Board;
