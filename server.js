const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

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
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/ping', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  app.get('/api/state', (_req, res) => {
    res.json(board.state);
  });

  // --- Employee endpoints ---

  app.get('/api/employees', (_req, res) => {
    res.json(board.getEmployees());
  });

  app.post('/api/employees', (req, res) => {
    const result = board.addOrUpdateEmployee(req.body);
    if (!result) {
      return res.status(400).json({ error: 'Invalid employee data' });
    }
    // Broadcast updated employee list and tags to all WS clients
    broadcastAll({
      type: 'employees:updated',
      employees: board.getEmployees(),
      availableTags: board.state.availableTags
    });
    res.json({ ok: true, employee: result });
  });

  app.delete('/api/employees/:id', (req, res) => {
    const removed = board.removeEmployee(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    // Broadcast updated state
    broadcastAll({
      type: 'employees:updated',
      employees: board.getEmployees(),
      availableTags: board.state.availableTags,
      placedTags: board.state.placedTags
    });
    res.json({ ok: true });
  });

  // Permission check endpoint (used by frontend)
  app.get('/api/employees/:id/check/:subprocess', (req, res) => {
    const check = board.checkPermission(req.params.id, decodeURIComponent(req.params.subprocess));
    res.json(check);
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

  function broadcastAll(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  // Heartbeat
  const HEARTBEAT_INTERVAL = 30000;

  function heartbeat() {
    this.isAlive = true;
  }

  const pingInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) {
        console.log('[WS] Terminating dead connection');
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    // Assign a unique session ID to this connection
    ws.sessionId = crypto.randomUUID();

    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[WS] Client connected: ${ws.sessionId} from ${clientIp} (total: ${wss.clients.size})`);

    // Send full state + session ID
    ws.send(JSON.stringify({
      type: 'init',
      sessionId: ws.sessionId,
      state: board.state
    }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      console.log(`[WS] ${ws.sessionId}: ${msg.type}`);

      switch (msg.type) {
        // --- Tags (badges) ---
        case 'tag:place': {
          const result = board.placeTag(msg.tagId, msg.boxId);
          if (result && result.denied) {
            ws.send(JSON.stringify({
              type: 'tag:denied',
              id: msg.tagId,
              boxId: msg.boxId,
              reason: result.reason,
              level: result.level
            }));
          } else if (result) {
            broadcastAll({ type: 'tag:placed', tag: result });
          }
          break;
        }
        case 'tag:lock': {
          const tag = board.lockTag(msg.tagId, ws.sessionId);
          if (tag) {
            broadcastAll({ type: 'tag:locked', id: msg.tagId, lockedBy: ws.sessionId });
          } else {
            ws.send(JSON.stringify({ type: 'tag:lock-denied', id: msg.tagId }));
          }
          break;
        }
        case 'tag:move': {
          const tag = board.moveTag(msg.tagId, msg.boxId, ws.sessionId);
          if (tag) {
            broadcastAll({ type: 'tag:moved', id: msg.tagId, boxId: msg.boxId });
          }
          break;
        }
        case 'tag:unlock': {
          const result = board.unlockTag(msg.tagId, ws.sessionId, msg.boxId);
          if (result && result.denied) {
            ws.send(JSON.stringify({
              type: 'tag:move-denied',
              id: msg.tagId,
              boxId: result.boxId,
              reason: result.reason
            }));
            broadcastAll({ type: 'tag:unlocked', id: msg.tagId, boxId: result.boxId });
          } else if (result) {
            broadcastAll({ type: 'tag:unlocked', id: msg.tagId, boxId: result.boxId });
          }
          break;
        }
        case 'tag:remove': {
          if (board.removeTagFromBoard(msg.tagId)) {
            broadcastAll({ type: 'tag:removed', id: msg.tagId });
          }
          break;
        }

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

    ws.on('close', () => {
      // Release any locks this session held
      const released = board.releaseSessionLocks(ws.sessionId);
      released.forEach(tagId => {
        const tag = board.state.placedTags.find(t => t.id === tagId);
        broadcastAll({ type: 'tag:unlocked', id: tagId, boxId: tag ? tag.boxId : null });
      });
      console.log(`[WS] Client ${ws.sessionId} disconnected (released ${released.length} locks, remaining: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Connection error:', err.message);
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Whiteboard running on 0.0.0.0:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
