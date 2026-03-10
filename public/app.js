const TAG_COLORS = ['tag-blue', 'tag-green', 'tag-orange', 'tag-pink', 'tag-purple', 'tag-teal'];

let state = { tags: [], paths: [] };
let ws;
let draggedTagId = null;

// --- WebSocket ---

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.onopen = () => setStatus(true);
  ws.onclose = () => {
    setStatus(false);
    setTimeout(connect, 2000);
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'init':
        state = msg.state;
        render();
        break;
      case 'tag:created':
        state.tags.push(msg.tag);
        render();
        break;
      case 'tag:moved': {
        const tag = state.tags.find(t => t.id === msg.id);
        if (tag) { tag.pathId = msg.pathId; render(); }
        break;
      }
      case 'tag:deleted':
        state.tags = state.tags.filter(t => t.id !== msg.id);
        render();
        break;
    }
  };
}

function send(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function setStatus(connected) {
  const el = document.getElementById('connection-status');
  el.textContent = connected ? 'Connected' : 'Reconnecting...';
  el.className = 'status ' + (connected ? 'connected' : 'disconnected');
}

// --- Rendering ---

function render() {
  const board = document.getElementById('board');
  board.innerHTML = '';

  state.paths.forEach(path => {
    const col = document.createElement('div');
    col.className = 'path-column';
    col.dataset.pathId = path.id;

    const tagsInPath = state.tags.filter(t => t.pathId === path.id);

    col.innerHTML = `
      <div class="path-header">
        <span>${path.name}</span>
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

      el.addEventListener('dragstart', (e) => {
        draggedTagId = tag.id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        draggedTagId = null;
        document.querySelectorAll('.path-column').forEach(c => c.classList.remove('drag-over'));
      });

      el.querySelector('.delete-btn').addEventListener('click', () => deleteTag(tag.id));

      body.appendChild(el);
    });

    // Drop zone events
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove('drag-over');
      }
    });

    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (draggedTagId) {
        moveTag(draggedTagId, path.id);
      }
    });

    board.appendChild(col);
  });
}

// --- Actions ---

function createTag(text) {
  const id = 'tag-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
  const pathId = state.paths[0]?.id || 'backlog';

  const tag = { id, text, pathId, color };
  state.tags.push(tag);
  render();

  send({ type: 'tag:create', ...tag });
}

function moveTag(id, pathId) {
  const tag = state.tags.find(t => t.id === id);
  if (tag && tag.pathId !== pathId) {
    tag.pathId = pathId;
    render();
    send({ type: 'tag:move', id, pathId });
  }
}

function deleteTag(id) {
  state.tags = state.tags.filter(t => t.id !== id);
  render();
  send({ type: 'tag:delete', id });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Init ---

document.getElementById('add-tag-btn').addEventListener('click', () => {
  const input = document.getElementById('tag-input');
  const text = input.value.trim();
  if (text) {
    createTag(text);
    input.value = '';
    input.focus();
  }
});

document.getElementById('tag-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('add-tag-btn').click();
  }
});

connect();
