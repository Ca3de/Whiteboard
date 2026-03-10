/**
 * Whiteboard — Client
 *
 * Architecture:
 *   EventBus     — decouples UI from transport (Observer pattern)
 *   Connection   — WebSocket transport, auto-reconnect
 *   BoardRenderer — renders state to DOM, handles drag-and-drop
 *
 * Extension point: listen to EventBus events or register
 * new message handlers without modifying existing code.
 */

// --- EventBus (Observer pattern) ---

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
  tags: [],
  paths: [],

  load(data) {
    this.tags = data.tags || [];
    this.paths = data.paths || [];
  },

  findTag(id) {
    return this.tags.find(t => t.id === id);
  },

  addTag(tag) {
    this.tags.push(tag);
  },

  moveTag(id, pathId) {
    const tag = this.findTag(id);
    if (tag) tag.pathId = pathId;
  },

  removeTag(id) {
    this.tags = this.tags.filter(t => t.id !== id);
  },

  tagsInPath(pathId) {
    return this.tags.filter(t => t.pathId === pathId);
  }
};

// --- Connection (WebSocket transport) ---

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

// --- Board Renderer ---

const TAG_COLORS = ['tag-blue', 'tag-green', 'tag-orange', 'tag-pink', 'tag-purple', 'tag-teal'];
let draggedTagId = null;

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  State.paths.forEach(path => {
    const tagsInPath = State.tagsInPath(path.id);

    const col = document.createElement('div');
    col.className = 'path-column';
    col.dataset.pathId = path.id;
    col.innerHTML = `
      <div class="path-header">
        <span>${escapeHtml(path.name)}</span>
        <span class="tag-count">${tagsInPath.length}</span>
      </div>
      <div class="path-body"></div>
    `;

    const body = col.querySelector('.path-body');

    tagsInPath.forEach(tag => {
      const el = document.createElement('div');
      el.className = `tag ${tag.color}`;
      el.draggable = true;
      el.dataset.tagId = tag.id;
      el.innerHTML = `
        <span>${escapeHtml(tag.text)}</span>
        <button class="delete-btn" title="Delete tag">&times;</button>
      `;

      el.addEventListener('dragstart', () => {
        draggedTagId = tag.id;
        el.classList.add('dragging');
      });

      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        draggedTagId = null;
        document.querySelectorAll('.path-column').forEach(c => c.classList.remove('drag-over'));
      });

      el.querySelector('.delete-btn').addEventListener('click', () => {
        State.removeTag(tag.id);
        renderBoard();
        Connection.send({ type: 'tag:delete', id: tag.id });
      });

      body.appendChild(el);
    });

    // Drop zone
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });

    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (draggedTagId) {
        const tag = State.findTag(draggedTagId);
        if (tag && tag.pathId !== path.id) {
          State.moveTag(draggedTagId, path.id);
          renderBoard();
          Connection.send({ type: 'tag:move', id: draggedTagId, pathId: path.id });
        }
      }
    });

    board.appendChild(col);
  });
}

// --- Wire events ---

// Server → Client
EventBus.on('ws:init', (msg) => {
  State.load(msg.state);
  renderBoard();
});

EventBus.on('ws:tag:created', (msg) => {
  State.addTag(msg.tag);
  renderBoard();
});

EventBus.on('ws:tag:moved', (msg) => {
  State.moveTag(msg.id, msg.pathId);
  renderBoard();
});

EventBus.on('ws:tag:deleted', (msg) => {
  State.removeTag(msg.id);
  renderBoard();
});

// Connection status
EventBus.on('connection:change', (connected) => {
  const el = document.getElementById('connection-status');
  el.textContent = connected ? 'Connected' : 'Reconnecting...';
  el.className = 'status ' + (connected ? 'connected' : 'disconnected');
});

// --- UI Controls ---

document.getElementById('add-tag-btn').addEventListener('click', () => {
  const input = document.getElementById('tag-input');
  const text = input.value.trim();
  if (!text) return;

  const tag = {
    id: 'tag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    text,
    pathId: State.paths[0]?.id || 'backlog',
    color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]
  };

  State.addTag(tag);
  renderBoard();
  Connection.send({ type: 'tag:create', ...tag });

  input.value = '';
  input.focus();
});

document.getElementById('tag-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('add-tag-btn').click();
});

// --- Start ---
Connection.connect();
