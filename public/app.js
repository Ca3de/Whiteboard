/**
 * Whiteboard — Freeform drawing, sticky notes, text labels
 *
 * Tools: select, draw, note, text
 * Real-time sync via WebSocket
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
  strokes: [],   // { id, points: [{x,y}], color, width }
  notes: [],     // { id, x, y, text, color }
  texts: [],     // { id, x, y, text, color }

  load(data) {
    this.strokes = data.strokes || [];
    this.notes = data.notes || [];
    this.texts = data.texts || [];
  },

  clear() {
    this.strokes = [];
    this.notes = [];
    this.texts = [];
  },

  addStroke(s) { this.strokes.push(s); },
  removeStroke(id) { this.strokes = this.strokes.filter(s => s.id !== id); },

  addNote(n) { this.notes.push(n); },
  updateNote(id, changes) {
    const n = this.notes.find(n => n.id === id);
    if (n) Object.assign(n, changes);
    return n;
  },
  removeNote(id) { this.notes = this.notes.filter(n => n.id !== id); },

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

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}`);
    ws.onopen = () => EventBus.emit('connection:change', true);
    ws.onclose = () => {
      EventBus.emit('connection:change', false);
      setTimeout(connect, 2000);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      EventBus.emit(`ws:${msg.type}`, msg);
    };
  }

  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  return { connect, send };
})();

// --- Canvas drawing ---

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

  // Draw grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let x = 0; x < canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // Draw strokes
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

const NOTE_COLORS = ['note-yellow', 'note-pink', 'note-blue', 'note-green', 'note-purple'];

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
  redraw();
  Connection.send({ type: 'clear' });
});

// --- Canvas events (drawing) ---

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (currentTool === 'draw') {
    isDrawing = true;
    currentStroke = {
      id: uid(),
      points: [{ x, y }],
      color: currentColor,
      width: currentStrokeWidth
    };
  } else if (currentTool === 'note') {
    createNote(x, y);
  } else if (currentTool === 'text') {
    createText(x, y);
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing || currentTool !== 'draw') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  currentStroke.points.push({ x, y });
  redraw();

  // Draw in-progress stroke
  if (currentStroke.points.length >= 2) {
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
  }
});

canvas.addEventListener('mouseup', () => {
  if (isDrawing && currentStroke && currentStroke.points.length >= 2) {
    State.addStroke(currentStroke);
    Connection.send({ type: 'stroke:add', stroke: currentStroke });
    redraw();
  }
  isDrawing = false;
  currentStroke = null;
});

canvas.addEventListener('mouseleave', () => {
  if (isDrawing && currentStroke && currentStroke.points.length >= 2) {
    State.addStroke(currentStroke);
    Connection.send({ type: 'stroke:add', stroke: currentStroke });
    redraw();
  }
  isDrawing = false;
  currentStroke = null;
});

// --- Sticky notes ---

function createNote(x, y) {
  const note = {
    id: uid(),
    x, y,
    text: '',
    color: NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]
  };
  State.addNote(note);
  Connection.send({ type: 'note:add', note });
  renderObjects();

  // Focus the new note
  const el = document.querySelector(`[data-note-id="${note.id}"] .note-content`);
  if (el) el.focus();
}

function createText(x, y) {
  const text = {
    id: uid(),
    x, y,
    text: 'Text',
    color: currentColor
  };
  State.addText(text);
  Connection.send({ type: 'text:add', textObj: text });
  renderObjects();

  const el = document.querySelector(`[data-text-id="${text.id}"]`);
  if (el) {
    el.focus();
    document.execCommand('selectAll');
  }
}

function renderObjects() {
  const layer = document.getElementById('objects-layer');
  layer.innerHTML = '';

  // Render sticky notes
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

    // Drag
    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('note-content') || e.target.classList.contains('note-delete')) return;
      dragTarget = { type: 'note', id: note.id, el };
      dragOffset.x = e.clientX - note.x;
      dragOffset.y = e.clientY - note.y;
      el.classList.add('dragging');
      e.preventDefault();
    });

    // Edit
    el.querySelector('.note-content').addEventListener('input', (e) => {
      State.updateNote(note.id, { text: e.target.value });
      Connection.send({ type: 'note:update', id: note.id, text: e.target.value });
    });

    // Delete
    el.querySelector('.note-delete').addEventListener('click', () => {
      State.removeNote(note.id);
      Connection.send({ type: 'note:delete', id: note.id });
      renderObjects();
    });

    layer.appendChild(el);
  });

  // Render text labels
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
      if (document.activeElement === el) return; // allow editing
      dragTarget = { type: 'text', id: t.id, el };
      dragOffset.x = e.clientX - t.x;
      dragOffset.y = e.clientY - t.y;
      el.classList.add('dragging');
    });

    el.addEventListener('input', (e) => {
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

// Global drag handling
document.addEventListener('mousemove', (e) => {
  if (!dragTarget) return;
  const container = document.getElementById('canvas-container');
  const rect = container.getBoundingClientRect();
  const x = e.clientX - dragOffset.x;
  const y = e.clientY - dragOffset.y;

  dragTarget.el.style.left = x + 'px';
  dragTarget.el.style.top = y + 'px';

  if (dragTarget.type === 'note') {
    State.updateNote(dragTarget.id, { x, y });
  } else if (dragTarget.type === 'text') {
    State.updateText(dragTarget.id, { x, y });
  }
});

document.addEventListener('mouseup', () => {
  if (dragTarget) {
    dragTarget.el.classList.remove('dragging');
    if (dragTarget.type === 'note') {
      const n = State.notes.find(n => n.id === dragTarget.id);
      if (n) Connection.send({ type: 'note:move', id: n.id, x: n.x, y: n.y });
    } else if (dragTarget.type === 'text') {
      const t = State.texts.find(t => t.id === dragTarget.id);
      if (t) Connection.send({ type: 'text:move', id: t.id, x: t.x, y: t.y });
    }
    dragTarget = null;
  }
});

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// --- WebSocket events ---

EventBus.on('ws:init', (msg) => {
  State.load(msg.state);
  redraw();
  renderObjects();
});

EventBus.on('ws:stroke:added', (msg) => {
  State.addStroke(msg.stroke);
  redraw();
});

EventBus.on('ws:note:added', (msg) => {
  State.addNote(msg.note);
  renderObjects();
});

EventBus.on('ws:note:updated', (msg) => {
  State.updateNote(msg.id, { text: msg.text });
  renderObjects();
});

EventBus.on('ws:note:moved', (msg) => {
  State.updateNote(msg.id, { x: msg.x, y: msg.y });
  renderObjects();
});

EventBus.on('ws:note:deleted', (msg) => {
  State.removeNote(msg.id);
  renderObjects();
});

EventBus.on('ws:text:added', (msg) => {
  State.addText(msg.textObj);
  renderObjects();
});

EventBus.on('ws:text:updated', (msg) => {
  State.updateText(msg.id, { text: msg.text });
  renderObjects();
});

EventBus.on('ws:text:moved', (msg) => {
  State.updateText(msg.id, { x: msg.x, y: msg.y });
  renderObjects();
});

EventBus.on('ws:text:deleted', (msg) => {
  State.removeText(msg.id);
  renderObjects();
});

EventBus.on('ws:cleared', () => {
  State.clear();
  redraw();
  renderObjects();
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
