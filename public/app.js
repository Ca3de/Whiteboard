/**
 * Whiteboard — Boxes (process paths), tags (lockable), drawing, notes, text
 *
 * Tags: predefined list in a sidebar palette. Drag onto board to place.
 * Only one instance of each tag on the board. While dragging, tag is locked —
 * no other session can interact with it until released.
 */

// --- EventBus ---

const EventBus = (() => {
  const listeners = {};
  return {
    on(event, fn) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    emit(event, data) {
      (listeners[event] || []).forEach(fn => fn(data));
    }
  };
})();

// --- State ---

const State = {
  sessionId: null,
  availableTags: [],  // { id, label }
  placedTags: [],     // { id, label, boxId, lockedBy }
  boxes: [],
  strokes: [],
  notes: [],
  texts: [],

  load(data) {
    this.availableTags = data.availableTags || [];
    this.placedTags = data.placedTags || [];
    this.boxes = data.boxes || [];
    this.strokes = data.strokes || [];
    this.notes = data.notes || [];
    this.texts = data.texts || [];
  },

  clear() {
    this.placedTags = [];
    this.boxes = [];
    this.strokes = [];
    this.notes = [];
    this.texts = [];
  },

  // Tags
  isTagPlaced(tagId) { return this.placedTags.some(t => t.id === tagId); },
  addPlacedTag(tag) { this.placedTags.push(tag); },
  updatePlacedTag(id, changes) {
    const t = this.placedTags.find(t => t.id === id);
    if (t) Object.assign(t, changes);
    return t;
  },
  removePlacedTag(id) { this.placedTags = this.placedTags.filter(t => t.id !== id); },

  // Boxes
  addBox(b) { this.boxes.push(b); },
  updateBox(id, changes) {
    const b = this.boxes.find(b => b.id === id);
    if (b) Object.assign(b, changes);
    return b;
  },
  removeBox(id) { this.boxes = this.boxes.filter(b => b.id !== id); },
  isNameTaken(name, excludeId) {
    return this.boxes.some(b => b.name.toLowerCase() === name.toLowerCase() && b.id !== excludeId);
  },

  // Strokes
  addStroke(s) { this.strokes.push(s); },

  // Notes
  addNote(n) { this.notes.push(n); },
  updateNote(id, changes) {
    const n = this.notes.find(n => n.id === id);
    if (n) Object.assign(n, changes);
    return n;
  },
  removeNote(id) { this.notes = this.notes.filter(n => n.id !== id); },

  // Texts
  addText(t) { this.texts.push(t); },
  updateText(id, changes) {
    const t = this.texts.find(t => t.id === id);
    if (t) Object.assign(t, changes);
    return t;
  },
  removeText(id) { this.texts = this.texts.filter(t => t.id !== id); }
};

// --- Connection ---

const Connection = (() => {
  let ws;
  let pingInterval = null;
  let reconnectDelay = 1000;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${location.host}`;
    console.log('[WS] Connecting to', url);

    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('[WS] Connected');
      reconnectDelay = 1000;
      EventBus.emit('connection:change', true);

      clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    };

    ws.onclose = (e) => {
      console.log('[WS] Disconnected, code:', e.code, 'reason:', e.reason);
      clearInterval(pingInterval);
      EventBus.emit('connection:change', false);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    };

    ws.onerror = (e) => {
      console.error('[WS] Error:', e);
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'pong') return;
      console.log('[WS] Received:', msg.type);
      EventBus.emit(`ws:${msg.type}`, msg);
    };
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    } else {
      console.warn('[WS] Cannot send, not connected. Message type:', data.type);
    }
  }

  return { connect, send };
})();

// --- Canvas ---

const canvas = document.getElementById('whiteboard');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  redraw();
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < canvas.width; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // Strokes
  State.strokes.forEach(stroke => {
    if (stroke.points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  });
}

// --- Tool state ---

let currentTool = 'select';
let currentColor = '#e94560';
let currentStrokeWidth = 4;
let isDrawing = false;
let currentStroke = null;
let dragTarget = null;
let dragOffset = { x: 0, y: 0 };
let resizeTarget = null;
let resizeStart = { x: 0, y: 0, w: 0, h: 0 };

// Tag dragging from palette
let paletteDragTag = null; // { id, label, el (ghost) }
let paletteDragPos = { x: 0, y: 0 };

function getInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const BOX_COLORS = ['box-red', 'box-blue', 'box-green', 'box-orange', 'box-purple', 'box-teal'];
const NOTE_COLORS = ['note-yellow', 'note-pink', 'note-blue', 'note-green', 'note-purple'];
let boxColorIndex = 0;

function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

// --- Toolbar ---

document.querySelectorAll('.tool').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;

    const container = document.getElementById('canvas-container');
    if (currentTool === 'select') container.style.cursor = 'default';
    else if (currentTool === 'box') container.style.cursor = 'copy';
    else if (currentTool === 'draw') container.style.cursor = 'crosshair';
    else if (currentTool === 'note') container.style.cursor = 'copy';
    else if (currentTool === 'text') container.style.cursor = 'text';
  });
});

document.getElementById('color-picker').addEventListener('input', (e) => {
  currentColor = e.target.value;
});

document.getElementById('stroke-width').addEventListener('change', (e) => {
  currentStrokeWidth = parseInt(e.target.value, 10);
});

document.getElementById('clear-btn').addEventListener('click', () => {
  State.clear();
  renderObjects();
  renderTagPalette();
  redraw();
  Connection.send({ type: 'clear' });
});

// --- Tag panel toggle ---

document.getElementById('tags-toggle-btn').addEventListener('click', () => {
  const panel = document.getElementById('tag-panel');
  const btn = document.getElementById('tags-toggle-btn');
  panel.classList.toggle('hidden');
  btn.classList.toggle('active');
  // Resize canvas after panel animation
  setTimeout(resizeCanvas, 220);
});

document.getElementById('tag-panel-close').addEventListener('click', () => {
  document.getElementById('tag-panel').classList.add('hidden');
  document.getElementById('tags-toggle-btn').classList.remove('active');
  setTimeout(resizeCanvas, 220);
});

// --- Tag palette rendering ---

function renderTagPalette() {
  const palette = document.getElementById('tag-palette');
  palette.innerHTML = '';

  State.availableTags.forEach(tag => {
    const el = document.createElement('div');
    const isPlaced = State.isTagPlaced(tag.id);
    el.className = 'palette-tag' + (isPlaced ? ' placed' : '');
    el.innerHTML = `<span class="badge-icon">${getInitials(tag.label)}</span><span>${escapeHtml(tag.label)}</span>`;
    el.dataset.tagId = tag.id;

    if (!isPlaced) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startPaletteDrag(tag, e);
      });
    }

    palette.appendChild(el);
  });
}

// --- Hit-test: find which box the cursor is over ---

function findBoxAt(clientX, clientY) {
  const boxEls = document.querySelectorAll('.process-box');
  for (const el of boxEls) {
    const rect = el.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
      return el.dataset.boxId;
    }
  }
  return null;
}

// --- Palette drag (drag badge from sidebar into a box) ---

function startPaletteDrag(tag, e) {
  const ghost = document.createElement('div');
  ghost.className = 'board-tag';
  ghost.innerHTML = `<span class="badge-icon">${getInitials(tag.label)}</span><span>${escapeHtml(tag.label)}</span>`;
  ghost.style.position = 'fixed';
  ghost.style.left = e.clientX - 30 + 'px';
  ghost.style.top = e.clientY - 12 + 'px';
  ghost.style.zIndex = '5000';
  ghost.style.pointerEvents = 'none';
  document.body.appendChild(ghost);

  paletteDragTag = { id: tag.id, label: tag.label, el: ghost };
}

document.addEventListener('mousemove', (e) => {
  // Palette drag ghost
  if (paletteDragTag) {
    paletteDragTag.el.style.left = e.clientX - 30 + 'px';
    paletteDragTag.el.style.top = e.clientY - 12 + 'px';

    // Highlight box under cursor
    document.querySelectorAll('.process-box').forEach(el => el.classList.remove('drop-target'));
    const boxId = findBoxAt(e.clientX, e.clientY);
    if (boxId) {
      const boxEl = document.querySelector(`[data-box-id="${boxId}"]`);
      if (boxEl) boxEl.classList.add('drop-target');
    }
    return;
  }

  // Tag drag ghost (moving existing badge between boxes)
  if (dragTarget && dragTarget.type === 'tag') {
    dragTarget.el.style.left = e.clientX - 30 + 'px';
    dragTarget.el.style.top = e.clientY - 12 + 'px';

    document.querySelectorAll('.process-box').forEach(el => el.classList.remove('drop-target'));
    const boxId = findBoxAt(e.clientX, e.clientY);
    if (boxId) {
      const boxEl = document.querySelector(`[data-box-id="${boxId}"]`);
      if (boxEl) boxEl.classList.add('drop-target');
    }
    return;
  }

  // Drag existing objects (boxes, notes, text)
  if (dragTarget) {
    const x = e.clientX - dragOffset.x;
    const y = e.clientY - dragOffset.y;
    dragTarget.el.style.left = x + 'px';
    dragTarget.el.style.top = y + 'px';

    if (dragTarget.type === 'box') State.updateBox(dragTarget.id, { x, y });
    else if (dragTarget.type === 'note') State.updateNote(dragTarget.id, { x, y });
    else if (dragTarget.type === 'text') State.updateText(dragTarget.id, { x, y });
  }

  // Resize
  if (resizeTarget) {
    const dx = e.clientX - resizeStart.x;
    const dy = e.clientY - resizeStart.y;
    const w = Math.max(200, resizeStart.w + dx);
    const h = Math.max(150, resizeStart.h + dy);
    resizeTarget.el.style.width = w + 'px';
    resizeTarget.el.style.height = h + 'px';
    State.updateBox(resizeTarget.id, { w, h });
  }
});

document.addEventListener('mouseup', (e) => {
  // Clear drop highlights
  document.querySelectorAll('.process-box').forEach(el => el.classList.remove('drop-target'));

  // Palette drag: drop badge into a box
  if (paletteDragTag) {
    const boxId = findBoxAt(e.clientX, e.clientY);
    if (boxId) {
      Connection.send({ type: 'tag:place', tagId: paletteDragTag.id, boxId });
    }
    // If not dropped on a box, it just goes back to palette (no-op)

    paletteDragTag.el.remove();
    paletteDragTag = null;
    return;
  }

  // Regular drag end
  if (dragTarget) {
    dragTarget.el.classList.remove('dragging');
    if (dragTarget.type === 'box') {
      const b = State.boxes.find(b => b.id === dragTarget.id);
      if (b) Connection.send({ type: 'box:move', id: b.id, x: b.x, y: b.y });
    } else if (dragTarget.type === 'note') {
      const n = State.notes.find(n => n.id === dragTarget.id);
      if (n) Connection.send({ type: 'note:move', id: n.id, x: n.x, y: n.y });
    } else if (dragTarget.type === 'text') {
      const t = State.texts.find(t => t.id === dragTarget.id);
      if (t) Connection.send({ type: 'text:move', id: t.id, x: t.x, y: t.y });
    } else if (dragTarget.type === 'tag') {
      // Drop badge into whatever box is under cursor, or keep in original box
      const boxId = findBoxAt(e.clientX, e.clientY);
      const tag = State.placedTags.find(t => t.id === dragTarget.id);
      const targetBox = boxId || (tag ? tag.boxId : null);
      Connection.send({ type: 'tag:unlock', tagId: dragTarget.id, boxId: targetBox });

      // Clean up the floating ghost
      dragTarget.el.remove();
    }
    dragTarget = null;
    renderObjects();
  }

  if (resizeTarget) {
    const b = State.boxes.find(b => b.id === resizeTarget.id);
    if (b) Connection.send({ type: 'box:resize', id: b.id, w: b.w, h: b.h });
    resizeTarget = null;
  }
});

// --- Box dialog ---

let pendingBoxPosition = null;

function showBoxDialog(x, y) {
  pendingBoxPosition = { x, y };
  const dialog = document.getElementById('box-dialog');
  const input = document.getElementById('box-name-input');
  const error = document.getElementById('box-name-error');
  dialog.style.display = 'flex';
  input.value = '';
  error.textContent = '';
  input.focus();
}

function hideBoxDialog() {
  document.getElementById('box-dialog').style.display = 'none';
  pendingBoxPosition = null;
}

document.getElementById('box-create-btn').addEventListener('click', () => {
  const input = document.getElementById('box-name-input');
  const error = document.getElementById('box-name-error');
  const name = input.value.trim();

  if (!name) { error.textContent = 'Name is required'; return; }
  if (State.isNameTaken(name)) { error.textContent = 'A box with this name already exists'; return; }

  const box = {
    id: uid(), name,
    x: pendingBoxPosition.x, y: pendingBoxPosition.y,
    w: 280, h: 200,
    color: BOX_COLORS[boxColorIndex++ % BOX_COLORS.length]
  };

  Connection.send({ type: 'box:add', box });
  hideBoxDialog();
});

document.getElementById('box-cancel-btn').addEventListener('click', hideBoxDialog);
document.getElementById('box-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('box-create-btn').click();
  if (e.key === 'Escape') hideBoxDialog();
});
document.getElementById('box-dialog').addEventListener('mousedown', (e) => {
  if (e.target === e.currentTarget) hideBoxDialog();
});

// --- Rename dialog ---

let renameBoxId = null;

function showRenameDialog(boxId) {
  const box = State.boxes.find(b => b.id === boxId);
  if (!box) return;
  renameBoxId = boxId;
  const dialog = document.getElementById('rename-dialog');
  const input = document.getElementById('rename-input');
  const error = document.getElementById('rename-error');
  dialog.style.display = 'flex';
  input.value = box.name;
  error.textContent = '';
  input.focus();
  input.select();
}

function hideRenameDialog() {
  document.getElementById('rename-dialog').style.display = 'none';
  renameBoxId = null;
}

document.getElementById('rename-save-btn').addEventListener('click', () => {
  const input = document.getElementById('rename-input');
  const error = document.getElementById('rename-error');
  const name = input.value.trim();

  if (!name) { error.textContent = 'Name is required'; return; }
  if (State.isNameTaken(name, renameBoxId)) { error.textContent = 'A box with this name already exists'; return; }

  Connection.send({ type: 'box:rename', id: renameBoxId, name });
  hideRenameDialog();
});

document.getElementById('rename-cancel-btn').addEventListener('click', hideRenameDialog);
document.getElementById('rename-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('rename-save-btn').click();
  if (e.key === 'Escape') hideRenameDialog();
});
document.getElementById('rename-dialog').addEventListener('mousedown', (e) => {
  if (e.target === e.currentTarget) hideRenameDialog();
});

// --- Canvas events ---

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (currentTool === 'draw') {
    isDrawing = true;
    currentStroke = {
      id: uid(), points: [{ x, y }],
      color: currentColor, width: currentStrokeWidth
    };
  } else if (currentTool === 'box') {
    showBoxDialog(x, y);
  } else if (currentTool === 'note') {
    createNote(x, y);
  } else if (currentTool === 'text') {
    createText(x, y);
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing || currentTool !== 'draw') return;
  const rect = canvas.getBoundingClientRect();
  currentStroke.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  redraw();

  ctx.beginPath();
  ctx.strokeStyle = currentStroke.color;
  ctx.lineWidth = currentStroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.moveTo(currentStroke.points[0].x, currentStroke.points[0].y);
  for (let i = 1; i < currentStroke.points.length; i++) {
    ctx.lineTo(currentStroke.points[i].x, currentStroke.points[i].y);
  }
  ctx.stroke();
});

function finishStroke() {
  if (isDrawing && currentStroke && currentStroke.points.length >= 2) {
    State.addStroke(currentStroke);
    Connection.send({ type: 'stroke:add', stroke: currentStroke });
    redraw();
  }
  isDrawing = false;
  currentStroke = null;
}

canvas.addEventListener('mouseup', finishStroke);
canvas.addEventListener('mouseleave', finishStroke);

// --- Notes & Text ---

function createNote(x, y) {
  const note = {
    id: uid(), x, y, text: '',
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]
  };
  State.addNote(note);
  Connection.send({ type: 'note:add', note });
  renderObjects();
  const el = document.querySelector(`[data-note-id="${note.id}"] .note-content`);
  if (el) el.focus();
}

function createText(x, y) {
  const text = { id: uid(), x, y, text: 'Text', color: currentColor };
  State.addText(text);
  Connection.send({ type: 'text:add', textObj: text });
  renderObjects();
  const el = document.querySelector(`[data-text-id="${text.id}"]`);
  if (el) { el.focus(); document.execCommand('selectAll'); }
}

// --- Render all objects ---

function renderObjects() {
  const layer = document.getElementById('objects-layer');
  layer.innerHTML = '';

  // Boxes (with badges rendered inside)
  State.boxes.forEach(box => {
    const el = document.createElement('div');
    el.className = `process-box ${box.color}`;
    el.dataset.boxId = box.id;
    el.style.left = box.x + 'px';
    el.style.top = box.y + 'px';
    el.style.width = box.w + 'px';
    el.style.minHeight = box.h + 'px';
    el.innerHTML = `
      <div class="box-header">
        <span class="box-name">${escapeHtml(box.name)}</span>
        <div class="box-actions">
          <button class="box-rename-btn" title="Rename">&#9998;</button>
          <button class="box-delete-btn" title="Delete">&times;</button>
        </div>
      </div>
      <div class="box-body"></div>
      <div class="box-resize-handle"></div>
    `;

    // Render badges inside this box
    const boxBody = el.querySelector('.box-body');
    const boxTags = State.placedTags.filter(t => t.boxId === box.id);
    boxTags.forEach(tag => {
      const tagEl = document.createElement('div');
      const isLockedByOther = tag.lockedBy && tag.lockedBy !== State.sessionId;
      const isLockedByMe = tag.lockedBy === State.sessionId;

      tagEl.className = 'board-tag';
      if (isLockedByOther) tagEl.classList.add('locked');
      if (isLockedByMe) tagEl.classList.add('locked-by-me');
      tagEl.dataset.tagId = tag.id;
      tagEl.innerHTML = `<span class="badge-icon">${getInitials(tag.label)}</span><span>${escapeHtml(tag.label)}</span><button class="tag-remove-btn">&times;</button>`;

      if (!isLockedByOther) {
        tagEl.addEventListener('mousedown', (e) => {
          if (e.target.classList.contains('tag-remove-btn')) return;
          e.preventDefault();
          Connection.send({ type: 'tag:lock', tagId: tag.id });

          // Create a floating ghost for dragging between boxes
          const ghost = document.createElement('div');
          ghost.className = 'board-tag locked-by-me';
          ghost.innerHTML = `<span class="badge-icon">${getInitials(tag.label)}</span><span>${escapeHtml(tag.label)}</span>`;
          ghost.style.position = 'fixed';
          ghost.style.left = e.clientX - 30 + 'px';
          ghost.style.top = e.clientY - 12 + 'px';
          ghost.style.zIndex = '5000';
          ghost.style.pointerEvents = 'none';
          document.body.appendChild(ghost);

          dragTarget = { type: 'tag', id: tag.id, el: ghost, originalBoxId: tag.boxId };
        });

        tagEl.querySelector('.tag-remove-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          Connection.send({ type: 'tag:remove', tagId: tag.id });
        });
      }

      boxBody.appendChild(tagEl);
    });

    el.querySelector('.box-header').addEventListener('mousedown', (e) => {
      if (e.target.closest('.box-actions')) return;
      dragTarget = { type: 'box', id: box.id, el };
      dragOffset.x = e.clientX - box.x;
      dragOffset.y = e.clientY - box.y;
      el.classList.add('dragging');
      e.preventDefault();
    });

    el.querySelector('.box-resize-handle').addEventListener('mousedown', (e) => {
      resizeTarget = { id: box.id, el };
      resizeStart = { x: e.clientX, y: e.clientY, w: box.w, h: box.h };
      e.preventDefault();
      e.stopPropagation();
    });

    el.querySelector('.box-rename-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showRenameDialog(box.id);
    });

    el.querySelector('.box-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      State.removeBox(box.id);
      Connection.send({ type: 'box:delete', id: box.id });
      renderObjects();
    });

    layer.appendChild(el);
  });

  // Sticky notes
  State.notes.forEach(note => {
    const el = document.createElement('div');
    el.className = `sticky-note ${note.color}`;
    el.dataset.noteId = note.id;
    el.style.left = note.x + 'px';
    el.style.top = note.y + 'px';
    el.innerHTML = `
      <textarea class="note-content" placeholder="Type here...">${escapeHtml(note.text)}</textarea>
      <button class="note-delete">&times;</button>
    `;

    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('note-content') || e.target.classList.contains('note-delete')) return;
      dragTarget = { type: 'note', id: note.id, el };
      dragOffset.x = e.clientX - note.x;
      dragOffset.y = e.clientY - note.y;
      el.classList.add('dragging');
      e.preventDefault();
    });

    el.querySelector('.note-content').addEventListener('input', (e) => {
      State.updateNote(note.id, { text: e.target.value });
      Connection.send({ type: 'note:update', id: note.id, text: e.target.value });
    });

    el.querySelector('.note-delete').addEventListener('click', () => {
      State.removeNote(note.id);
      Connection.send({ type: 'note:delete', id: note.id });
      renderObjects();
    });

    layer.appendChild(el);
  });

  // Text labels
  State.texts.forEach(t => {
    const el = document.createElement('div');
    el.className = 'text-label';
    el.dataset.textId = t.id;
    el.contentEditable = true;
    el.style.left = t.x + 'px';
    el.style.top = t.y + 'px';
    el.style.color = t.color;
    el.textContent = t.text;
    el.innerHTML += `<button class="text-delete">&times;</button>`;

    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('text-delete')) return;
      if (document.activeElement === el) return;
      dragTarget = { type: 'text', id: t.id, el };
      dragOffset.x = e.clientX - t.x;
      dragOffset.y = e.clientY - t.y;
      el.classList.add('dragging');
    });

    el.addEventListener('input', () => {
      const newText = el.childNodes[0]?.textContent || '';
      State.updateText(t.id, { text: newText });
      Connection.send({ type: 'text:update', id: t.id, text: newText });
    });

    el.querySelector('.text-delete').addEventListener('click', () => {
      State.removeText(t.id);
      Connection.send({ type: 'text:delete', id: t.id });
      renderObjects();
    });

    layer.appendChild(el);
  });
}

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// --- WebSocket events ---

EventBus.on('ws:init', (msg) => {
  State.sessionId = msg.sessionId;
  State.load(msg.state);
  console.log('[WS] Session:', State.sessionId, '| Tags:', State.availableTags.length, '| Placed:', State.placedTags.length);
  redraw();
  renderObjects();
  renderTagPalette();
});

// Tags
EventBus.on('ws:tag:placed', (msg) => {
  if (!State.isTagPlaced(msg.tag.id)) {
    State.addPlacedTag(msg.tag);
  }
  renderObjects();
  renderTagPalette();
});

EventBus.on('ws:tag:locked', (msg) => {
  State.updatePlacedTag(msg.id, { lockedBy: msg.lockedBy });
  renderObjects();
});

EventBus.on('ws:tag:lock-denied', (msg) => {
  console.warn('[WS] Lock denied for tag:', msg.id);
  // Cancel current drag if we were trying to drag this tag
  if (dragTarget && dragTarget.type === 'tag' && dragTarget.id === msg.id) {
    dragTarget = null;
    renderObjects();
  }
});

EventBus.on('ws:tag:moved', (msg) => {
  State.updatePlacedTag(msg.id, { boxId: msg.boxId });
  renderObjects();
});

EventBus.on('ws:tag:unlocked', (msg) => {
  const changes = { lockedBy: null };
  if (msg.boxId) changes.boxId = msg.boxId;
  State.updatePlacedTag(msg.id, changes);
  renderObjects();
});

EventBus.on('ws:tag:removed', (msg) => {
  State.removePlacedTag(msg.id);
  renderObjects();
  renderTagPalette();
});

// Boxes
EventBus.on('ws:box:added', (msg) => {
  if (!State.boxes.find(b => b.id === msg.box.id)) State.addBox(msg.box);
  renderObjects();
});
EventBus.on('ws:box:moved', (msg) => { State.updateBox(msg.id, { x: msg.x, y: msg.y }); renderObjects(); });
EventBus.on('ws:box:resized', (msg) => { State.updateBox(msg.id, { w: msg.w, h: msg.h }); renderObjects(); });
EventBus.on('ws:box:renamed', (msg) => { State.updateBox(msg.id, { name: msg.name }); renderObjects(); });
EventBus.on('ws:box:deleted', (msg) => { State.removeBox(msg.id); renderObjects(); });

EventBus.on('ws:box:error', (msg) => {
  const boxErr = document.getElementById('box-name-error');
  const renameErr = document.getElementById('rename-error');
  if (boxErr && document.getElementById('box-dialog').style.display !== 'none') {
    boxErr.textContent = msg.message;
  } else if (renameErr && document.getElementById('rename-dialog').style.display !== 'none') {
    renameErr.textContent = msg.message;
  }
});

// Strokes
EventBus.on('ws:stroke:added', (msg) => { State.addStroke(msg.stroke); redraw(); });

// Notes
EventBus.on('ws:note:added', (msg) => { State.addNote(msg.note); renderObjects(); });
EventBus.on('ws:note:updated', (msg) => { State.updateNote(msg.id, { text: msg.text }); renderObjects(); });
EventBus.on('ws:note:moved', (msg) => { State.updateNote(msg.id, { x: msg.x, y: msg.y }); renderObjects(); });
EventBus.on('ws:note:deleted', (msg) => { State.removeNote(msg.id); renderObjects(); });

// Texts
EventBus.on('ws:text:added', (msg) => { State.addText(msg.textObj); renderObjects(); });
EventBus.on('ws:text:updated', (msg) => { State.updateText(msg.id, { text: msg.text }); renderObjects(); });
EventBus.on('ws:text:moved', (msg) => { State.updateText(msg.id, { x: msg.x, y: msg.y }); renderObjects(); });
EventBus.on('ws:text:deleted', (msg) => { State.removeText(msg.id); renderObjects(); });

// Clear
EventBus.on('ws:cleared', () => {
  State.clear();
  redraw();
  renderObjects();
  renderTagPalette();
});

EventBus.on('connection:change', (connected) => {
  const el = document.getElementById('connection-status');
  el.textContent = connected ? 'Connected' : 'Reconnecting...';
  el.className = 'status ' + (connected ? 'connected' : 'disconnected');
});

// --- Init ---

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
Connection.connect();
