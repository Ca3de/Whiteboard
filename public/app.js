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
  availableTags: [],  // { id, label, employeeId? }
  placedTags: [],     // { id, label, boxId, lockedBy }
  boxes: [],
  strokes: [],
  notes: [],
  texts: [],
  employees: [],      // { id, login, name, badge, permissions, ... }

  load(data) {
    this.availableTags = data.availableTags || [];
    this.placedTags = data.placedTags || [];
    this.boxes = data.boxes || [];
    this.strokes = data.strokes || [];
    this.notes = data.notes || [];
    this.texts = data.texts || [];
    this.employees = data.employees || [];
  },

  clear() {
    this.placedTags = [];
    this.boxes = [];
    this.strokes = [];
    this.notes = [];
    this.texts = [];
  },

  // Employees
  getEmployee(employeeId) {
    return this.employees.find(e => e.id === employeeId);
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
  // Make canvas large enough to cover the pannable area
  canvas.width = container.clientWidth / zoom + Math.abs(panX) / zoom + 2000;
  canvas.height = container.clientHeight / zoom + Math.abs(panY) / zoom + 2000;
  applyViewportTransform();
  redraw();
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Grid
  ctx.strokeStyle = document.documentElement.getAttribute('data-theme') === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.03)';
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

// Eraser
let isErasing = false;

// Tag dragging from palette
let paletteDragTag = null; // { id, label, el (ghost) }
let paletteDragPos = { x: 0, y: 0 };

// --- Zoom & Pan ---
let zoom = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

function applyViewportTransform() {
  const vp = document.getElementById('viewport');
  vp.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  const zoomEl = document.getElementById('zoom-level');
  if (document.activeElement !== zoomEl) {
    zoomEl.value = Math.round(zoom * 100) + '%';
  }
}

// Convert screen (client) coordinates to board coordinates
function screenToBoard(clientX, clientY) {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  return {
    x: (clientX - rect.left - panX) / zoom,
    y: (clientY - rect.top - panY) / zoom
  };
}

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
    else if (currentTool === 'eraser') container.style.cursor = 'pointer';
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

// --- Theme toggle ---

document.getElementById('theme-toggle-btn').addEventListener('click', () => {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle-btn');
  const isLight = root.getAttribute('data-theme') === 'light';
  if (isLight) {
    root.removeAttribute('data-theme');
    btn.textContent = 'Light';
    localStorage.setItem('wb-theme', 'dark');
  } else {
    root.setAttribute('data-theme', 'light');
    btn.textContent = 'Dark';
    localStorage.setItem('wb-theme', 'light');
  }
  redraw();
});

// Restore saved theme
(function() {
  const saved = localStorage.getItem('wb-theme');
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.getElementById('theme-toggle-btn').textContent = 'Dark';
  }
})();

// --- Badge search ---

document.getElementById('badge-search').addEventListener('input', () => {
  renderTagPalette();
});

// --- Tag palette rendering ---

function renderTagPalette() {
  const palette = document.getElementById('tag-palette');
  palette.innerHTML = '';

  if (State.availableTags.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding: 16px; color: var(--text-secondary); font-size: 0.78rem; text-align: center;';
    empty.textContent = 'No employees synced yet. Use the browser extension on FCLM to add employees.';
    palette.appendChild(empty);
    return;
  }

  const searchInput = document.getElementById('badge-search');
  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

  const filtered = query
    ? State.availableTags.filter(tag => {
        const emp = tag.employeeId ? State.getEmployee(tag.employeeId) : null;
        const login = emp ? emp.login || '' : '';
        return tag.label.toLowerCase().includes(query) || login.toLowerCase().includes(query);
      })
    : State.availableTags;

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding: 16px; color: var(--text-secondary); font-size: 0.78rem; text-align: center;';
    empty.textContent = 'No badges match your search.';
    palette.appendChild(empty);
    return;
  }

  filtered.forEach(tag => {
    const el = document.createElement('div');
    const isPlaced = State.isTagPlaced(tag.id);
    el.className = 'palette-tag' + (isPlaced ? ' placed' : '');

    // Show login below name if employee
    const emp = tag.employeeId ? State.getEmployee(tag.employeeId) : null;
    const loginHtml = emp && emp.login ? `<span class="badge-login">${escapeHtml(emp.login)}</span>` : '';
    el.innerHTML = `<span class="badge-icon">${getInitials(tag.label)}</span><span class="badge-label-wrap"><span>${escapeHtml(tag.label)}</span>${loginHtml}</span>`;
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

// --- Hit-test: find which box/sub-box the cursor is over ---

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

function findSubBoxAt(clientX, clientY) {
  const subEls = document.querySelectorAll('.sub-box');
  for (const el of subEls) {
    const rect = el.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right &&
        clientY >= rect.top && clientY <= rect.bottom) {
      return el.dataset.subBoxId;
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

    // Highlight box/sub-box under cursor
    document.querySelectorAll('.process-box, .sub-box').forEach(el => el.classList.remove('drop-target'));
    const boxId = findBoxAt(e.clientX, e.clientY);
    if (boxId) {
      const boxEl = document.querySelector(`[data-box-id="${boxId}"]`);
      if (boxEl) boxEl.classList.add('drop-target');
      const sbId = findSubBoxAt(e.clientX, e.clientY);
      if (sbId) {
        const sbEl = document.querySelector(`[data-sub-box-id="${sbId}"]`);
        if (sbEl) sbEl.classList.add('drop-target');
      }
    }
    return;
  }

  // Tag drag ghost (moving existing badge between boxes)
  if (dragTarget && dragTarget.type === 'tag') {
    dragTarget.el.style.left = e.clientX - 30 + 'px';
    dragTarget.el.style.top = e.clientY - 12 + 'px';

    document.querySelectorAll('.process-box, .sub-box').forEach(el => el.classList.remove('drop-target'));
    const boxId = findBoxAt(e.clientX, e.clientY);
    if (boxId) {
      const boxEl = document.querySelector(`[data-box-id="${boxId}"]`);
      if (boxEl) boxEl.classList.add('drop-target');
      const sbId = findSubBoxAt(e.clientX, e.clientY);
      if (sbId) {
        const sbEl = document.querySelector(`[data-sub-box-id="${sbId}"]`);
        if (sbEl) sbEl.classList.add('drop-target');
      }
    }
    return;
  }

  // Pan
  if (isPanning) {
    panX += e.clientX - panStart.x;
    panY += e.clientY - panStart.y;
    panStart.x = e.clientX;
    panStart.y = e.clientY;
    applyViewportTransform();
    return;
  }

  // Drag existing objects (boxes, notes, text)
  if (dragTarget) {
    const { x, y } = screenToBoard(e.clientX, e.clientY);
    const bx = x - dragOffset.x;
    const by = y - dragOffset.y;
    dragTarget.el.style.left = bx + 'px';
    dragTarget.el.style.top = by + 'px';

    if (dragTarget.type === 'box') State.updateBox(dragTarget.id, { x: bx, y: by });
    else if (dragTarget.type === 'note') State.updateNote(dragTarget.id, { x: bx, y: by });
    else if (dragTarget.type === 'text') State.updateText(dragTarget.id, { x: bx, y: by });
  }

  // Resize
  if (resizeTarget) {
    const dx = (e.clientX - resizeStart.x) / zoom;
    const dy = (e.clientY - resizeStart.y) / zoom;
    const w = Math.max(200, resizeStart.w + dx);
    const h = Math.max(150, resizeStart.h + dy);
    resizeTarget.el.style.width = w + 'px';
    resizeTarget.el.style.minHeight = h + 'px';
    State.updateBox(resizeTarget.id, { w, h });
  }
});

document.addEventListener('mouseup', (e) => {
  // Clear drop highlights
  document.querySelectorAll('.process-box, .sub-box').forEach(el => el.classList.remove('drop-target'));

  // Palette drag: drop badge into a box
  if (paletteDragTag) {
    const boxId = findBoxAt(e.clientX, e.clientY);
    if (boxId) {
      const subBoxId = findSubBoxAt(e.clientX, e.clientY) || null;
      Connection.send({ type: 'tag:place', tagId: paletteDragTag.id, boxId, subBoxId });
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
      // Drop badge into whatever box/sub-box is under cursor, or keep in original
      const boxId = findBoxAt(e.clientX, e.clientY);
      const tag = State.placedTags.find(t => t.id === dragTarget.id);
      const targetBox = boxId || (tag ? tag.boxId : null);
      const subBoxId = findSubBoxAt(e.clientX, e.clientY) || null;
      Connection.send({ type: 'tag:unlock', tagId: dragTarget.id, boxId: targetBox, subBoxId });

      // Clean up the floating ghost
      dragTarget.el.remove();
    }
    dragTarget = null;
    renderObjects();
  }

  if (isPanning) {
    isPanning = false;
    document.getElementById('canvas-container').style.cursor =
      currentTool === 'select' ? 'default' :
      currentTool === 'box' ? 'copy' :
      currentTool === 'draw' ? 'crosshair' :
      currentTool === 'eraser' ? 'pointer' :
      currentTool === 'note' ? 'copy' :
      currentTool === 'text' ? 'text' : 'default';
    return;
  }

  if (resizeTarget) {
    const b = State.boxes.find(b => b.id === resizeTarget.id);
    if (b) Connection.send({ type: 'box:resize', id: b.id, w: b.w, h: b.h });
    resizeTarget = null;
  }
});

// --- Zoom with scroll wheel ---

document.getElementById('canvas-container').addEventListener('wheel', (e) => {
  e.preventDefault();
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Zoom towards cursor
  const oldZoom = zoom;
  const delta = -e.deltaY * 0.001;
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)));

  // Adjust pan so the point under the cursor stays fixed
  panX = mouseX - (mouseX - panX) * (zoom / oldZoom);
  panY = mouseY - (mouseY - panY) * (zoom / oldZoom);

  applyViewportTransform();
  resizeCanvas();
}, { passive: false });

// --- Middle-mouse / Space+drag pan ---

document.getElementById('canvas-container').addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    e.preventDefault();
    isPanning = true;
    panStart.x = e.clientX;
    panStart.y = e.clientY;
    document.getElementById('canvas-container').style.cursor = 'grabbing';
  }
});

// --- Zoom buttons ---

document.getElementById('zoom-in-btn').addEventListener('click', () => {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const oldZoom = zoom;
  zoom = Math.min(MAX_ZOOM, zoom * 1.25);
  panX = cx - (cx - panX) * (zoom / oldZoom);
  panY = cy - (cy - panY) * (zoom / oldZoom);
  applyViewportTransform();
  resizeCanvas();
});

document.getElementById('zoom-out-btn').addEventListener('click', () => {
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const oldZoom = zoom;
  zoom = Math.max(MIN_ZOOM, zoom / 1.25);
  panX = cx - (cx - panX) * (zoom / oldZoom);
  panY = cy - (cy - panY) * (zoom / oldZoom);
  applyViewportTransform();
  resizeCanvas();
});

document.getElementById('zoom-reset-btn').addEventListener('click', () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  applyViewportTransform();
  resizeCanvas();
});

// Editable zoom level input
const zoomInput = document.getElementById('zoom-level');
zoomInput.addEventListener('focus', () => {
  zoomInput.value = Math.round(zoom * 100);
  zoomInput.select();
});

zoomInput.addEventListener('blur', () => {
  applyZoomFromInput();
});

zoomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    applyZoomFromInput();
    zoomInput.blur();
  } else if (e.key === 'Escape') {
    zoomInput.value = Math.round(zoom * 100) + '%';
    zoomInput.blur();
  }
});

function applyZoomFromInput() {
  const raw = parseInt(zoomInput.value.replace('%', ''), 10);
  if (!isNaN(raw) && raw > 0) {
    const container = document.getElementById('canvas-container');
    const rect = container.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const oldZoom = zoom;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, raw / 100));
    panX = cx - (cx - panX) * (zoom / oldZoom);
    panY = cy - (cy - panY) * (zoom / oldZoom);
    applyViewportTransform();
    resizeCanvas();
  } else {
    zoomInput.value = Math.round(zoom * 100) + '%';
  }
}

// --- Process / Subprocess data ---

const PROCESS_DATA = [
  { process: 'ADM/HR/TRAIN/IT', subprocess: 'MENU ADMIN', level: 'BEGINNER' },
  { process: 'ADM/HR/TRAIN/IT', subprocess: 'Security', level: 'NONE' },
  { process: 'Amtran', subprocess: 'Amtran (Sub)', level: 'NONE' },
  { process: 'AR Support', subprocess: 'Floor Health', level: 'NONE' },
  { process: 'AR Support', subprocess: 'RME Support', level: 'NONE' },
  { process: 'Associate Training', subprocess: 'Training Pick', level: 'NONE' },
  { process: 'Associate Training', subprocess: 'Training Stow', level: 'NONE' },
  { process: 'BETA TEST ROOT', subprocess: 'BETA TEST', level: 'NONE' },
  { process: 'COMMAND LINE/BINTOOL', subprocess: 'BINCONF', level: 'NONE' },
  { process: 'Customer Returns', subprocess: 'C-Returns (Sub)', level: 'BEGINNER' },
  { process: 'Customer Returns', subprocess: 'C-Returns Stow', level: 'BEGINNER' },
  { process: 'Customer Returns', subprocess: 'C-Returns Support', level: 'EXPERT' },
  { process: 'Decant', subprocess: 'Decanter', level: 'NONE' },
  { process: 'Facilities', subprocess: 'Facilities (Sub)', level: 'NONE' },
  { process: 'FC Infra', subprocess: 'LTD Internet Access', level: 'NONE' },
  { process: 'FC Infra', subprocess: 'Open Internet Access', level: 'NONE' },
  { process: 'IC QA CS', subprocess: 'Amnesty', level: 'NONE' },
  { process: 'IC QA CS', subprocess: 'IC QA', level: 'NONE' },
  { process: 'IC QA CS', subprocess: 'CS', level: 'NONE' },
  { process: 'Inbound Prep', subprocess: 'Cubiscan', level: 'NONE' },
  { process: 'Inbound Prep', subprocess: 'Prep', level: 'NONE' },
  { process: 'Inbound Prep', subprocess: 'Sample Center', level: 'NONE' },
  { process: 'On Demand', subprocess: 'Burn on Demand', level: 'NONE' },
  { process: 'On Demand', subprocess: 'Create Your Own Ring', level: 'NONE' },
  { process: 'On Demand', subprocess: 'On Demand Spt', level: 'NONE' },
  { process: 'On Demand', subprocess: 'Print On Demand', level: 'NONE' },
  { process: 'On Demand', subprocess: 'On Demand Production', level: 'NONE' },
  { process: 'Outbound Prep', subprocess: 'GW Scanning Partners', level: 'NONE' },
  { process: 'Outbound Prep', subprocess: 'Giftwrap', level: 'NONE' },
  { process: 'Outbound Prep', subprocess: 'Giftwrap Support', level: 'NONE' },
  { process: 'Outbound Prep', subprocess: 'Library Services', level: 'NONE' },
  { process: 'Outbound Prep', subprocess: 'Scan Verify Partners', level: 'NONE' },
  { process: 'Pack', subprocess: 'Biohazard Vials', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Autobox', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Bigs', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Chuting', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Full Case', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Lev/Autofold', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Manual SLAM', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Multis', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack SLAM', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Singles', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Support', level: 'NONE' },
  { process: 'Pack', subprocess: 'Slam At Pack', level: 'NONE' },
  { process: 'Pack', subprocess: 'Pack Batchy SLAM', level: 'NONE' },
  { process: 'Pack', subprocess: 'PackApp', level: 'INTERMEDIATE' },
  { process: 'Pack', subprocess: 'PackAutomation', level: 'NONE' },
  { process: 'Pack', subprocess: 'SimplePackTool', level: 'EXPERT' },
  { process: 'Pick', subprocess: 'Pick Mech', level: 'NONE' },
  { process: 'Pick', subprocess: 'Pick Paper', level: 'NONE' },
  { process: 'Pick', subprocess: 'Pick Presort', level: 'NONE' },
  { process: 'Pick', subprocess: 'Pick RF', level: 'BEGINNER' },
  { process: 'Pick', subprocess: 'Pick Support', level: 'NONE' },
  { process: 'Pick', subprocess: 'Pick Team Lift', level: 'NONE' },
  { process: 'Pick', subprocess: 'Unwind Support', level: 'NONE' },
  { process: 'Pick', subprocess: 'Update SLA Support', level: 'NONE' },
  { process: 'Pick', subprocess: 'Auto Collate', level: 'NONE' },
  { process: 'Pick', subprocess: 'Manual Collate', level: 'NONE' },
  { process: 'Pick', subprocess: 'Pick RF Count', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'DamageProcessorTool', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Inbound-Sideline App', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Psolve General', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Psolve Inbound', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Psolve Outbound', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Psolve Returns', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Inventory Power Tool', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Inventory-Add', level: 'BEGINNER' },
  { process: 'Problem Solve', subprocess: 'Inventory-Delete', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Inventory-Edit', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Inventory-Move', level: 'EXPERT' },
  { process: 'Problem Solve', subprocess: 'Label Printing', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'OOPS', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Psolve ISS', level: 'NONE' },
  { process: 'Problem Solve', subprocess: 'Sherlock', level: 'NONE' },
  { process: 'RC Pick', subprocess: 'RC Pick Library', level: 'NONE' },
  { process: 'RC Pick', subprocess: 'RC Pick Pallet Rack', level: 'NONE' },
  { process: 'RC Pick', subprocess: 'RC Pick Support', level: 'NONE' },
  { process: 'RC Sort', subprocess: 'RC Presort', level: 'NONE' },
  { process: 'RC Sort', subprocess: 'RC Sort (Sub)', level: 'NONE' },
  { process: 'RC Sort', subprocess: 'RC Sort Support', level: 'NONE' },
  { process: 'RC Stow', subprocess: 'RC Case Stow', level: 'NONE' },
  { process: 'RC Stow', subprocess: 'RC Pallet Stow', level: 'NONE' },
  { process: 'RC Stow', subprocess: 'RC Stow Support', level: 'NONE' },
  { process: 'Receive', subprocess: 'Receive Case', level: 'NONE' },
  { process: 'Receive', subprocess: 'Receive Dock', level: 'NONE' },
  { process: 'Receive', subprocess: 'Receive Each', level: 'NONE' },
  { process: 'Receive', subprocess: 'Receive LP', level: 'NONE' },
  { process: 'Receive', subprocess: 'Receive Pallet', level: 'NONE' },
  { process: 'Receive', subprocess: 'Receive Support', level: 'NONE' },
  { process: 'REPORTS', subprocess: 'MGR REPORTS', level: 'NONE' },
  { process: 'Rsr', subprocess: 'Replen Case', level: 'NONE' },
  { process: 'Rsr', subprocess: 'Replen Pallet', level: 'NONE' },
  { process: 'Rsr', subprocess: 'Replen Support', level: 'NONE' },
  { process: 'Rsr', subprocess: 'Stow-Reserve Case', level: 'NONE' },
  { process: 'Rsr', subprocess: 'Stow-Reserve Pallet', level: 'NONE' },
  { process: 'Rsr', subprocess: 'RSR Consolidation', level: 'NONE' },
  { process: 'Ship', subprocess: 'DirectShip', level: 'NONE' },
  { process: 'Ship', subprocess: 'EscalationTool', level: 'NONE' },
  { process: 'Ship', subprocess: 'Outbound Dock', level: 'NONE' },
  { process: 'Ship', subprocess: 'Ship Support', level: 'NONE' },
  { process: 'Sort', subprocess: 'Rebin', level: 'BEGINNER' },
  { process: 'Sort', subprocess: 'Sort Support', level: 'NONE' },
  { process: 'Sort', subprocess: 'Tote Wrangler', level: 'NONE' },
  { process: 'Sort', subprocess: 'Batchy', level: 'NONE' },
  { process: 'Sort Center', subprocess: 'Container Mgmt', level: 'NONE' },
  { process: 'Sort Center', subprocess: 'Exception Mgmt', level: 'NONE' },
  { process: 'Sort Center', subprocess: 'SC Audit', level: 'NONE' },
  { process: 'Sort Center', subprocess: 'Sort Center Support', level: 'NONE' },
  { process: 'Sort Center', subprocess: 'Sorter Mgmt', level: 'NONE' },
  { process: 'Sort Center', subprocess: 'Vehicle Mgmt', level: 'NONE' },
  { process: 'Stow to Prime', subprocess: 'Stow to Prime (Sub)', level: 'NONE' },
  { process: 'Stow to Prime', subprocess: 'Stow to Prime Spt', level: 'NONE' },
  { process: 'Support', subprocess: 'Admin HR IT', level: 'NONE' },
  { process: 'Support', subprocess: 'Training', level: 'NONE' },
  { process: 'Support', subprocess: 'BatteryLabelApprover', level: 'NONE' },
  { process: 'Support', subprocess: 'Vendor Flex', level: 'NONE' },
  { process: 'Transfer In', subprocess: 'Transfer In Dock', level: 'NONE' },
  { process: 'Transfer In', subprocess: 'Transfer In Stow', level: 'NONE' },
  { process: 'Transfer In', subprocess: 'Transfer In Support', level: 'NONE' },
  { process: 'Transfer Out', subprocess: 'Transfer Out (Sub)', level: 'NONE' },
  { process: 'Transfer Out', subprocess: 'Transfer Out Dock', level: 'NONE' },
  { process: 'Transfer Out', subprocess: 'Transfer Out Support', level: 'NONE' },
  { process: 'Vendor Returns', subprocess: 'V-Returns Pack', level: 'INTERMEDIATE' },
  { process: 'Vendor Returns', subprocess: 'V-Returns Pick', level: 'NONE' },
  { process: 'Vendor Returns', subprocess: 'V-Returns Receive', level: 'NONE' },
  { process: 'Vendor Returns', subprocess: 'V-Returns Ship', level: 'NONE' },
  { process: 'Vendor Returns', subprocess: 'V-Returns Sort', level: 'NONE' },
  { process: 'Vendor Returns', subprocess: 'V-Returns Stow', level: 'NONE' },
  { process: 'Vendor Returns', subprocess: 'V-Returns Support', level: 'NONE' },
  { process: 'Vendor Returns', subprocess: 'V-Returns WaterSpider', level: 'NONE' },
  { process: 'Warehouse Deals', subprocess: 'Grading', level: 'NONE' },
  { process: 'Warehouse Deals', subprocess: 'Kindle', level: 'NONE' },
  { process: 'Warehouse Deals', subprocess: 'WD Sort', level: 'INTERMEDIATE' },
  { process: 'Warehouse Deals', subprocess: 'Trade In', level: 'NONE' },
];

// Group process data by process name
function getGroupedProcesses() {
  const groups = {};
  PROCESS_DATA.forEach(entry => {
    if (!groups[entry.process]) groups[entry.process] = [];
    groups[entry.process].push(entry);
  });
  return groups;
}

// Get subprocess names already on the board
function getUsedSubprocesses(excludeBoxId) {
  return State.boxes
    .filter(b => b.id !== excludeBoxId)
    .map(b => b.name.toLowerCase());
}

// Render the grouped, searchable picker list
function renderPickerList(listEl, searchValue, onSelect, excludeBoxId) {
  listEl.innerHTML = '';
  const query = (searchValue || '').toLowerCase();
  const used = getUsedSubprocesses(excludeBoxId);
  const groups = getGroupedProcesses();
  let hasResults = false;

  Object.keys(groups).forEach(processName => {
    const subs = groups[processName];
    // Filter by search query (match process or subprocess)
    const filtered = subs.filter(s =>
      s.process.toLowerCase().includes(query) ||
      s.subprocess.toLowerCase().includes(query)
    );
    if (filtered.length === 0) return;
    hasResults = true;

    // Group header
    const header = document.createElement('div');
    header.className = 'picker-group-header';
    header.textContent = processName;
    header.addEventListener('click', () => {
      const items = header.nextElementSibling;
      items.classList.toggle('collapsed');
      header.classList.toggle('collapsed');
    });
    listEl.appendChild(header);

    // Group items
    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'picker-group-items';
    filtered.forEach(entry => {
      const item = document.createElement('div');
      const isUsed = used.includes(entry.subprocess.toLowerCase());
      item.className = 'picker-item' + (isUsed ? ' disabled' : '');
      item.innerHTML = `<span class="picker-subprocess">${escapeHtml(entry.subprocess)}</span>`;
      if (isUsed) {
        item.innerHTML += `<span class="picker-used">In use</span>`;
      }
      if (!isUsed) {
        item.addEventListener('click', () => onSelect(entry));
      }
      itemsContainer.appendChild(item);
    });
    listEl.appendChild(itemsContainer);
  });

  if (!hasResults) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = 'No matching processes found';
    listEl.appendChild(empty);
  }
}

// --- Box dialog (create) ---

let pendingBoxPosition = null;

function showBoxDialog(x, y) {
  pendingBoxPosition = { x, y };
  const dialog = document.getElementById('box-dialog');
  const search = document.getElementById('picker-search');
  const list = document.getElementById('picker-list');
  const error = document.getElementById('box-name-error');
  document.getElementById('picker-title').textContent = 'New Process Path';
  dialog.style.display = 'flex';
  search.value = '';
  error.textContent = '';
  renderPickerList(list, '', (entry) => {
    const box = {
      id: uid(), name: entry.subprocess,
      process: entry.process, level: entry.level,
      x: pendingBoxPosition.x, y: pendingBoxPosition.y,
      w: 280, h: 200,
      color: BOX_COLORS[boxColorIndex++ % BOX_COLORS.length]
    };
    Connection.send({ type: 'box:add', box });
    hideBoxDialog();
  });
  search.focus();
}

function hideBoxDialog() {
  document.getElementById('box-dialog').style.display = 'none';
  pendingBoxPosition = null;
}

document.getElementById('picker-search').addEventListener('input', (e) => {
  const list = document.getElementById('picker-list');
  renderPickerList(list, e.target.value, (entry) => {
    const box = {
      id: uid(), name: entry.subprocess,
      process: entry.process, level: entry.level,
      x: pendingBoxPosition.x, y: pendingBoxPosition.y,
      w: 280, h: 200,
      color: BOX_COLORS[boxColorIndex++ % BOX_COLORS.length]
    };
    Connection.send({ type: 'box:add', box });
    hideBoxDialog();
  });
});

document.getElementById('box-cancel-btn').addEventListener('click', hideBoxDialog);
document.getElementById('picker-search').addEventListener('keydown', (e) => {
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
  const search = document.getElementById('rename-search');
  const list = document.getElementById('rename-list');
  const error = document.getElementById('rename-error');
  dialog.style.display = 'flex';
  search.value = '';
  error.textContent = '';
  renderPickerList(list, '', (entry) => {
    Connection.send({ type: 'box:rename', id: renameBoxId, name: entry.subprocess });
    hideRenameDialog();
  }, renameBoxId);
  search.focus();
}

function hideRenameDialog() {
  document.getElementById('rename-dialog').style.display = 'none';
  renameBoxId = null;
}

document.getElementById('rename-search').addEventListener('input', (e) => {
  const list = document.getElementById('rename-list');
  renderPickerList(list, e.target.value, (entry) => {
    Connection.send({ type: 'box:rename', id: renameBoxId, name: entry.subprocess });
    hideRenameDialog();
  }, renameBoxId);
});

document.getElementById('rename-cancel-btn').addEventListener('click', hideRenameDialog);
document.getElementById('rename-search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideRenameDialog();
});
document.getElementById('rename-dialog').addEventListener('mousedown', (e) => {
  if (e.target === e.currentTarget) hideRenameDialog();
});

// --- Canvas events ---

canvas.addEventListener('mousedown', (e) => {
  const { x, y } = screenToBoard(e.clientX, e.clientY);

  if (currentTool === 'draw') {
    isDrawing = true;
    currentStroke = {
      id: uid(), points: [{ x, y }],
      color: currentColor, width: currentStrokeWidth
    };
  } else if (currentTool === 'eraser') {
    isErasing = true;
    eraseAtPoint(x, y);
  } else if (currentTool === 'box') {
    showBoxDialog(x, y);
  } else if (currentTool === 'note') {
    createNote(x, y);
  } else if (currentTool === 'text') {
    createText(x, y);
  }
});

// --- Eraser ---

function eraseAtPoint(px, py) {
  const threshold = 12; // pixels
  for (let i = State.strokes.length - 1; i >= 0; i--) {
    const stroke = State.strokes[i];
    for (const pt of stroke.points) {
      const dx = pt.x - px;
      const dy = pt.y - py;
      if (dx * dx + dy * dy < threshold * threshold) {
        const id = stroke.id;
        State.strokes.splice(i, 1);
        Connection.send({ type: 'stroke:remove', id });
        redraw();
        return;
      }
    }
  }
}

canvas.addEventListener('mousemove', (e) => {
  if (isErasing && currentTool === 'eraser') {
    const pt = screenToBoard(e.clientX, e.clientY);
    eraseAtPoint(pt.x, pt.y);
    return;
  }
  if (!isDrawing || currentTool !== 'draw') return;
  const pt = screenToBoard(e.clientX, e.clientY);
  currentStroke.points.push(pt);
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
  isErasing = false;
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
    const subBoxes = box.subBoxes || [];
    el.innerHTML = `
      <div class="box-header">
        <div class="box-name-wrap">
          ${box.process ? `<span class="box-process">${escapeHtml(box.process)}</span>` : ''}
          <span class="box-name">${escapeHtml(box.name)}</span>
        </div>
        <div class="box-actions">
          <button class="box-add-sub-btn" title="Add sub-box">+</button>
          <button class="box-rename-btn" title="Rename">&#9998;</button>
          <button class="box-delete-btn" title="Delete">&times;</button>
        </div>
      </div>
      <div class="box-body"></div>
      <div class="box-resize-handle"></div>
    `;

    // Helper to create a tag element
    function createTagEl(tag) {
      const tagEl = document.createElement('div');
      const isLockedByOther = tag.lockedBy && tag.lockedBy !== State.sessionId;
      const isLockedByMe = tag.lockedBy === State.sessionId;

      tagEl.className = 'board-tag';
      if (isLockedByOther) tagEl.classList.add('locked');
      if (isLockedByMe) tagEl.classList.add('locked-by-me');
      tagEl.dataset.tagId = tag.id;
      const emp = tag.employeeId ? State.getEmployee(tag.employeeId) : null;
      const login = emp ? emp.login || emp.id : '';
      const firstName = emp && emp.name ? emp.name.split(' ')[0] : tag.label;
      tagEl.innerHTML = `<span class="badge-icon">${getInitials(tag.label)}</span><span class="tag-info"><strong>${escapeHtml(login)}</strong><span class="tag-firstname">${escapeHtml(firstName)}</span></span><button class="tag-remove-btn">&times;</button>`;

      if (!isLockedByOther) {
        tagEl.addEventListener('mousedown', (e) => {
          if (e.target.classList.contains('tag-remove-btn')) return;
          e.preventDefault();
          Connection.send({ type: 'tag:lock', tagId: tag.id });

          const ghost = document.createElement('div');
          ghost.className = 'board-tag locked-by-me';
          ghost.innerHTML = `<span class="badge-icon">${getInitials(tag.label)}</span><span class="tag-info"><strong>${escapeHtml(login)}</strong><span class="tag-firstname">${escapeHtml(firstName)}</span></span>`;
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
      return tagEl;
    }

    // Render badges inside this box
    const boxBody = el.querySelector('.box-body');
    const boxTags = State.placedTags.filter(t => t.boxId === box.id);

    if (subBoxes.length > 0) {
      // Render sub-boxes
      subBoxes.forEach(sb => {
        const sbEl = document.createElement('div');
        sbEl.className = 'sub-box';
        sbEl.dataset.subBoxId = sb.id;
        sbEl.innerHTML = `<div class="sub-box-header"><span class="sub-box-name">${escapeHtml(sb.name)}</span><button class="sub-box-delete-btn" title="Remove sub-box">&times;</button></div><div class="sub-box-body"></div>`;
        const sbBody = sbEl.querySelector('.sub-box-body');
        boxTags.filter(t => t.subBoxId === sb.id).forEach(tag => sbBody.appendChild(createTagEl(tag)));

        sbEl.querySelector('.sub-box-delete-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          Connection.send({ type: 'subbox:delete', boxId: box.id, subBoxId: sb.id });
        });

        boxBody.appendChild(sbEl);
      });
      // Tags not assigned to any sub-box go at the end
      const unassigned = boxTags.filter(t => !t.subBoxId || !subBoxes.some(sb => sb.id === t.subBoxId));
      unassigned.forEach(tag => boxBody.appendChild(createTagEl(tag)));
    } else {
      // No sub-boxes — tags go directly in body
      boxTags.forEach(tag => boxBody.appendChild(createTagEl(tag)));
    }

    el.querySelector('.box-header').addEventListener('mousedown', (e) => {
      if (e.target.closest('.box-actions')) return;
      dragTarget = { type: 'box', id: box.id, el };
      const bp = screenToBoard(e.clientX, e.clientY);
      dragOffset.x = bp.x - box.x;
      dragOffset.y = bp.y - box.y;
      el.classList.add('dragging');
      e.preventDefault();
    });

    el.querySelector('.box-resize-handle').addEventListener('mousedown', (e) => {
      resizeTarget = { id: box.id, el };
      resizeStart = { x: e.clientX, y: e.clientY, w: box.w, h: box.h };
      e.preventDefault();
      e.stopPropagation();
    });

    el.querySelector('.box-add-sub-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const name = prompt('Sub-box name:');
      if (name && name.trim()) {
        const subBox = { id: uid(), name: name.trim() };
        Connection.send({ type: 'subbox:add', boxId: box.id, subBox });
      }
    });

    el.querySelector('.box-rename-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      showRenameDialog(box.id);
    });

    el.querySelector('.box-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      // Return badges in this box to palette
      State.placedTags = State.placedTags.filter(t => t.boxId !== box.id);
      State.removeBox(box.id);
      Connection.send({ type: 'box:delete', id: box.id });
      renderObjects();
      renderTagPalette();
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
      const bp = screenToBoard(e.clientX, e.clientY);
      dragOffset.x = bp.x - note.x;
      dragOffset.y = bp.y - note.y;
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
      const bp = screenToBoard(e.clientX, e.clientY);
      dragOffset.x = bp.x - t.x;
      dragOffset.y = bp.y - t.y;
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
  console.log('[WS] Session:', State.sessionId, '| Employees:', State.employees.length, '| Tags:', State.availableTags.length, '| Placed:', State.placedTags.length, '| Boxes:', State.boxes.length);
  // Debug: check for inconsistencies
  const orphanedTags = State.placedTags.filter(t => !State.boxes.some(b => b.id === t.boxId));
  if (orphanedTags.length > 0) {
    console.warn('[WS] Orphaned placed tags (box missing):', orphanedTags.map(t => `${t.label} → box:${t.boxId}`));
  }
  const missingEmps = State.placedTags.filter(t => t.employeeId && !State.getEmployee(t.employeeId));
  if (missingEmps.length > 0) {
    console.warn('[WS] Placed tags with missing employee:', missingEmps.map(t => `${t.label} emp:${t.employeeId}`));
  }
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

EventBus.on('ws:tag:denied', (msg) => {
  console.warn('[WS] Permission denied:', msg.reason);
  showPermissionDenied(msg.reason);
});

EventBus.on('ws:tag:move-denied', (msg) => {
  console.warn('[WS] Move denied:', msg.reason);
  showPermissionDenied(msg.reason);
  renderObjects();
});

EventBus.on('ws:employees:updated', (msg) => {
  State.employees = msg.employees || [];
  State.availableTags = msg.availableTags || [];
  if (msg.placedTags) State.placedTags = msg.placedTags;
  renderObjects();
  renderTagPalette();
});

// Re-fetch employees when tab becomes visible (catches any missed WS broadcasts)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    fetch('/api/employees')
      .then(r => r.json())
      .then(employees => {
        if (!Array.isArray(employees) || employees.length === 0) return;
        // Check if any names changed
        const changed = employees.some(e => {
          const existing = State.employees.find(s => s.id === e.id);
          return !existing || existing.name !== e.name;
        });
        if (changed) {
          console.log('[App] Employee data refreshed from server');
          State.employees = employees;
          // Rebuild availableTags from fresh employee data
          State.availableTags = employees.map(e => ({
            id: `emp-${e.id}`,
            label: e.name || e.login || e.id,
            employeeId: e.id
          }));
          renderObjects();
          renderTagPalette();
        }
      })
      .catch(() => {}); // Silently ignore if offline
  }
});

EventBus.on('ws:tag:moved', (msg) => {
  State.updatePlacedTag(msg.id, { boxId: msg.boxId });
  renderObjects();
});

EventBus.on('ws:tag:unlocked', (msg) => {
  const changes = { lockedBy: null };
  if (msg.boxId) changes.boxId = msg.boxId;
  if (msg.subBoxId !== undefined) changes.subBoxId = msg.subBoxId;
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
EventBus.on('ws:box:deleted', (msg) => {
  State.removeBox(msg.id);
  // Return badges to palette
  if (msg.returnedTags) {
    State.placedTags = State.placedTags.filter(t => !msg.returnedTags.includes(t.id));
  }
  renderObjects();
  renderTagPalette();
});

// Sub-boxes
EventBus.on('ws:subbox:added', (msg) => {
  const box = State.boxes.find(b => b.id === msg.boxId);
  if (box) {
    if (!box.subBoxes) box.subBoxes = [];
    if (!box.subBoxes.some(sb => sb.id === msg.subBox.id)) {
      box.subBoxes.push(msg.subBox);
    }
  }
  renderObjects();
});

EventBus.on('ws:subbox:deleted', (msg) => {
  const box = State.boxes.find(b => b.id === msg.boxId);
  if (box && box.subBoxes) {
    box.subBoxes = box.subBoxes.filter(sb => sb.id !== msg.subBoxId);
    // Clear subBoxId from affected tags
    State.placedTags.forEach(t => {
      if (t.boxId === msg.boxId && t.subBoxId === msg.subBoxId) t.subBoxId = null;
    });
  }
  renderObjects();
});

EventBus.on('ws:subbox:error', (msg) => {
  alert(msg.message || 'Sub-box error');
});

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
EventBus.on('ws:stroke:removed', (msg) => { State.strokes = State.strokes.filter(s => s.id !== msg.id); redraw(); });

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

// --- Permission denied toast ---

function showPermissionDenied(reason) {
  // Remove existing toast
  const existing = document.getElementById('permission-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'permission-toast';
  toast.style.cssText = `
    position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
    z-index: 9999; padding: 12px 24px; border-radius: 8px;
    background: #7f1d1d; color: #fca5a5; border: 1px solid #f87171;
    font-size: 0.85rem; font-weight: 600; font-family: -apple-system, sans-serif;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4); max-width: 500px; text-align: center;
    animation: toastIn 0.3s ease;
  `;
  toast.textContent = reason || 'Permission denied';
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- Init ---

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
applyViewportTransform();
Connection.connect();
