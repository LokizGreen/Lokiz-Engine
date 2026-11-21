
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4173);
const rooms = new Map();

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json'
};

function defaultScene() {
  return {
    objects: [{
      id: 'cube-1',
      name: 'Cube',
      type: 'cube',
      x: 0, y: 0, z: 0,
      sx: 1, sy: 1, sz: 1,
      color: '#7777ff',
      rotation: 0
    }]
  };
}

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      scene: defaultScene(),
      clients: new Map(),
      chat: []
    });
  }
  return rooms.get(id);
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data, except) {
  for (const client of room.clients.keys()) {
    if (client !== except) send(client, data);
  }
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(
    (req.url || '/').split('?')[0]
  );

  const requested = urlPath === '/'
    ? 'index.html'
    : urlPath.replace(/^\/+/, '');

  const file = path.resolve(ROOT, requested);

  if (!file.startsWith(ROOT + path.sep) &&
      file !== path.join(ROOT, 'index.html')) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }

    res.writeHead(200, {
      'Content-Type':
        types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });

    res.end(data);
  });
});

const wss = new WebSocket.Server({
  server,
  maxPayload: 1024 * 1024
});

wss.on('connection', ws => {
  ws.roomId = null;
  ws.user = null;
  ws.role = 'viewer';

  ws.on('message', raw => {
    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, {
        type: 'error',
        message: 'Invalid message format.'
      });
    }

    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      const roomId = String(msg.room || 'main')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 32) || 'main';

      const name = String(msg.name || 'Guest')
        .trim()
        .slice(0, 24) || 'Guest';

      const room = getRoom(roomId);

      if (ws.roomId) {
        const old = rooms.get(ws.roomId);
        if (old) old.clients.delete(ws);
      }

      ws.roomId = roomId;
      ws.user = {
        id: Math.random().toString(36).slice(2, 10),
        name
      };

      ws.role = msg.role === 'editor'
        ? 'editor'
        : 'viewer';

      room.clients.set(ws, {
        ...ws.user,
        role: ws.role
      });

      send(ws, {
        type: 'joined',
        room: roomId,
        user: ws.user,
        role: ws.role,
        scene: room.scene,
        members: [...room.clients.values()]
      });

      broadcast(room, {
        type: 'presence',
        members: [...room.clients.values()]
      }, ws);

      broadcast(room, {
        type: 'system',
        text: `${name} joined the room.`
      }, ws);

      return;
    }

    const room = ws.roomId && rooms.get(ws.roomId);

    if (!room) {
      return send(ws, {
        type: 'error',
        message: 'Join a room first.'
      });
    }

    if (msg.type === 'scene') {
      if (ws.role !== 'editor') {
        return send(ws, {
          type: 'error',
          message: 'Viewer access: editing is disabled.'
        });
      }

      if (!msg.scene ||
          !Array.isArray(msg.scene.objects) ||
          msg.scene.objects.length > 500) return;

      room.scene = msg.scene;

      broadcast(room, {
        type: 'scene',
        scene: room.scene,
        by: ws.user.name
      }, ws);

    } else if (msg.type === 'chat') {
      const text = String(msg.text || '')
        .trim()
        .slice(0, 500);

      if (!text) return;

      const item = {
        name: ws.user.name,
        text,
        time: Date.now()
      };

      room.chat.push(item);

      if (room.chat.length > 100) {
        room.chat.shift();
      }

      broadcast(room, {
        type: 'chat',
        item
      });

      send(ws, {
        type: 'chat',
        item
      });

    } else if (msg.type === 'ping') {
      send(ws, {
        type: 'pong',
        time: Date.now()
      });
    }
  });

  ws.on('close', () => {
    if (!ws.roomId) return;

    const room = rooms.get(ws.roomId);
    if (!room) return;

    room.clients.delete(ws);

    broadcast(room, {
      type: 'presence',
      members: [...room.clients.values()]
    });

    if (ws.user) {
      broadcast(room, {
        type: 'system',
        text: `${ws.user.name} left the room.`
      });
    }
  });
});

function startServer(port = PORT) {
  return new Promise(resolve => {
    server.listen(port, '0.0.0.0', () => {
      console.log(
        `LOKIZ 0.2.0 running at http://localhost:${port}`
      );
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
