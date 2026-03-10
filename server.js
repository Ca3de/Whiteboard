const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// In-memory board state
let boardState = {
  tags: [],
  paths: [
    { id: 'backlog', name: 'Backlog' },
    { id: 'in-progress', name: 'In Progress' },
    { id: 'review', name: 'Review' },
    { id: 'done', name: 'Done' }
  ]
};

function broadcast(data, sender) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  // Send current state to new client
  ws.send(JSON.stringify({ type: 'init', state: boardState }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'tag:create': {
        const tag = { id: msg.id, text: msg.text, pathId: msg.pathId, color: msg.color };
        boardState.tags.push(tag);
        broadcast({ type: 'tag:created', tag }, ws);
        break;
      }
      case 'tag:move': {
        const tag = boardState.tags.find(t => t.id === msg.id);
        if (tag) {
          tag.pathId = msg.pathId;
          broadcast({ type: 'tag:moved', id: msg.id, pathId: msg.pathId }, ws);
        }
        break;
      }
      case 'tag:delete': {
        boardState.tags = boardState.tags.filter(t => t.id !== msg.id);
        broadcast({ type: 'tag:deleted', id: msg.id }, ws);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Whiteboard running at http://localhost:${PORT}`);
});
