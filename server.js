const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const PluginManager = require('./src/core/PluginManager');
const Board = require('./src/core/Board');
const LoggerPlugin = require('./src/plugins/LoggerPlugin');

// --- Bootstrap ---

const plugins = new PluginManager();

const board = new Board({
  onEvent: (eventName, data) => {
    plugins.trigger(eventName, data);
  }
});

async function start() {
  plugins.register(LoggerPlugin);
  await plugins.initAll({ board });

  const app = express();
  const server = http.createServer(app);
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // --- WebSocket ---

  const wss = new WebSocket.Server({ server });

  function broadcast(data, sender) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  wss.on('connection', (ws) => {
    // Send full state to new client
    ws.send(JSON.stringify({ type: 'init', state: board.state }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        // --- Boxes ---
        case 'box:add': {
          const box = board.addBox(msg.box);
          if (box) {
            broadcast({ type: 'box:added', box }, ws);
            ws.send(JSON.stringify({ type: 'box:added', box }));
          } else {
            ws.send(JSON.stringify({ type: 'box:error', message: 'Name already taken' }));
          }
          break;
        }
        case 'box:move': {
          if (board.moveBox(msg.id, msg.x, msg.y)) {
            broadcast({ type: 'box:moved', id: msg.id, x: msg.x, y: msg.y }, ws);
          }
          break;
        }
        case 'box:resize': {
          if (board.resizeBox(msg.id, msg.w, msg.h)) {
            broadcast({ type: 'box:resized', id: msg.id, w: msg.w, h: msg.h }, ws);
          }
          break;
        }
        case 'box:rename': {
          const box = board.updateBox(msg.id, { name: msg.name });
          if (box) {
            broadcast({ type: 'box:renamed', id: msg.id, name: msg.name }, ws);
            ws.send(JSON.stringify({ type: 'box:renamed', id: msg.id, name: msg.name }));
          } else {
            ws.send(JSON.stringify({ type: 'box:error', message: 'Name already taken' }));
          }
          break;
        }
        case 'box:delete': {
          if (board.deleteBox(msg.id)) {
            broadcast({ type: 'box:deleted', id: msg.id }, ws);
          }
          break;
        }

        // --- Strokes ---
        case 'stroke:add': {
          board.addStroke(msg.stroke);
          broadcast({ type: 'stroke:added', stroke: msg.stroke }, ws);
          break;
        }

        // --- Notes ---
        case 'note:add': {
          board.addNote(msg.note);
          broadcast({ type: 'note:added', note: msg.note }, ws);
          break;
        }
        case 'note:update': {
          if (board.updateNote(msg.id, { text: msg.text })) {
            broadcast({ type: 'note:updated', id: msg.id, text: msg.text }, ws);
          }
          break;
        }
        case 'note:move': {
          if (board.moveNote(msg.id, msg.x, msg.y)) {
            broadcast({ type: 'note:moved', id: msg.id, x: msg.x, y: msg.y }, ws);
          }
          break;
        }
        case 'note:delete': {
          if (board.deleteNote(msg.id)) {
            broadcast({ type: 'note:deleted', id: msg.id }, ws);
          }
          break;
        }

        // --- Text ---
        case 'text:add': {
          board.addText(msg.textObj);
          broadcast({ type: 'text:added', textObj: msg.textObj }, ws);
          break;
        }
        case 'text:update': {
          if (board.updateText(msg.id, { text: msg.text })) {
            broadcast({ type: 'text:updated', id: msg.id, text: msg.text }, ws);
          }
          break;
        }
        case 'text:move': {
          if (board.moveText(msg.id, msg.x, msg.y)) {
            broadcast({ type: 'text:moved', id: msg.id, x: msg.x, y: msg.y }, ws);
          }
          break;
        }
        case 'text:delete': {
          if (board.deleteText(msg.id)) {
            broadcast({ type: 'text:deleted', id: msg.id }, ws);
          }
          break;
        }

        // --- Clear ---
        case 'clear': {
          board.clear();
          broadcast({ type: 'cleared' }, ws);
          break;
        }
      }
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Whiteboard running at http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
