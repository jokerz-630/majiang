import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { applyAction, createSolo, serializeGame, startRoomGame } from '../rules/game.js';
import { port, publicDir } from './config.js';
import { HttpError, json, readBody, sendError } from './http.js';
import pkg from '../../package.json' with { type: 'json' };

const rooms = new Map();
const roomSockets = new Map();
const startupAt = Date.now();
const ROOM_TTL_MS = {
  empty: 5 * 60 * 1000,
  inactive: 30 * 60 * 1000,
  settled: 10 * 60 * 1000
};
const BODY_LIMIT_BYTES = 8 * 1024;
const NAME_MAX_LENGTH = 12;
const RATE_LIMIT_WINDOW_MS = 10 * 1000;
const RATE_LIMITS = {
  createRoom: { limit: 5, windowMs: RATE_LIMIT_WINDOW_MS },
  joinRoom: { limit: 10, windowMs: RATE_LIMIT_WINDOW_MS },
  action: { limit: 30, windowMs: RATE_LIMIT_WINDOW_MS },
  reconnect: { limit: 12, windowMs: RATE_LIMIT_WINDOW_MS },
  wsUpgrade: { limit: 20, windowMs: RATE_LIMIT_WINDOW_MS }
};
let now = () => Date.now();
let logWriter = (level, entry) => {
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
};

function writeLog(level, event, context = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...context
  };
  logWriter(level, entry);
  return entry;
}

function createRequestContext(req, path, extra = {}) {
  return {
    requestId: crypto.randomUUID(),
    method: req.method,
    path,
    remoteIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    ...extra
  };
}

const rateBuckets = new Map();

function respondJson(res, status, data, context) {
  json(res, status, data);
  writeLog(status >= 400 ? 'warn' : 'info', 'http.response', {
    ...context,
    status
  });
}

function respondRoomError(res, status, message, context, extra = {}) {
  writeLog(status >= 500 ? 'error' : 'warn', 'room.action_rejected', {
    ...context,
    status,
    error: message,
    ...extra
  });
  respondJson(res, status, { error: message }, context);
}

function normalizeName(name, fallback) {
  const value = String(name || fallback).trim();
  if (!value) throw new HttpError(400, '昵称不能为空');
  if (value.length > NAME_MAX_LENGTH) throw new HttpError(400, `昵称长度不能超过 ${NAME_MAX_LENGTH} 个字符`);
  return value;
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${fieldName} 格式无效`);
  return value.trim();
}

function consumeRateLimit(scope, key) {
  const config = RATE_LIMITS[scope];
  if (!config) return;
  const bucketKey = `${scope}:${key}`;
  const timestamp = now();
  const bucket = (rateBuckets.get(bucketKey) || []).filter((time) => timestamp - time < config.windowMs);
  if (bucket.length >= config.limit) throw new HttpError(429, '请求过于频繁，请稍后再试');
  bucket.push(timestamp);
  rateBuckets.set(bucketKey, bucket);
}

function withRateLimit(scope, context, key = context.remoteIp || 'unknown') {
  try {
    consumeRateLimit(scope, key);
  } catch (error) {
    writeLog('warn', 'rate_limit.rejected', {
      ...context,
      scope,
      key,
      error: error.message,
      status: error.status || 429
    });
    throw error;
  }
}

function createRoomState(code, host) {
  const createdAt = now();
  return {
    code,
    hostId: host.id,
    players: [{ ...host, ready: true, online: true }],
    game: null,
    config: { fillWithAi: true },
    standings: [{ id: host.id, name: host.name, totalScore: 0 }],
    createdAt,
    lastActiveAt: createdAt,
    settledAt: null
  };
}

function createSessionPlayer(name) {
  return {
    id: crypto.randomUUID(),
    sessionToken: crypto.randomUUID(),
    name
  };
}

function ensureStanding(room, player) {
  let standing = room.standings.find((item) => item.id === player.id);
  if (!standing) {
    standing = { id: player.id, name: player.name, totalScore: 0 };
    room.standings.push(standing);
  }
  return standing;
}

function syncStandings(room) {
  if (!room.game || room.game.phase !== 'settlement' || room.game.settlementApplied) return;
  room.game.settlementApplied = true;
  room.settledAt = now();
  for (const gamePlayer of room.game.players) {
    if (gamePlayer.human) ensureStanding(room, gamePlayer).totalScore += gamePlayer.score;
  }
}

function markRoomActive(room) {
  room.lastActiveAt = now();
  if (room.game?.phase !== 'settlement') room.settledAt = null;
}

function ensureSocketSet(code) {
  let sockets = roomSockets.get(code);
  if (!sockets) {
    sockets = new Set();
    roomSockets.set(code, sockets);
  }
  return sockets;
}

function serializeRoom(room, playerId) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map(({ sessionToken, ...player }) => player),
    config: room.config,
    standings: room.standings,
    game: room.game ? serializeGame(room.game, playerId) : null
  };
}

function verifyRoomSession(room, playerId, sessionToken) {
  if (!playerId || !sessionToken) return null;
  const player = room.players.find((item) => item.id === playerId);
  if (!player) return null;
  return player.sessionToken === sessionToken ? player : null;
}

function sendWs(socket, data) {
  const payload = Buffer.from(JSON.stringify(data));
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  socket.write(Buffer.concat([header, payload]));
}

function broadcastRoom(room) {
  markRoomActive(room);
  const sockets = roomSockets.get(room.code);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket.destroyed) continue;
    sendWs(socket, { type: 'room_state', room: serializeRoom(room, socket.playerId) });
  }
}

function hasPlayerSocket(code, playerId) {
  const sockets = roomSockets.get(code);
  if (!sockets) return false;
  for (const socket of sockets) {
    if (!socket.destroyed && socket.playerId === playerId) return true;
  }
  return false;
}

function replacePlayerSocket(code, playerId, nextSocket) {
  const sockets = ensureSocketSet(code);
  for (const socket of sockets) {
    if (socket === nextSocket || socket.playerId !== playerId) continue;
    sockets.delete(socket);
    socket.replaced = true;
    socket.end();
  }
  sockets.add(nextSocket);
}

function removeSocket(code, socket) {
  const sockets = roomSockets.get(code);
  if (!sockets) return;
  sockets.delete(socket);
  if (sockets.size === 0) roomSockets.delete(code);
  const room = rooms.get(code);
  const player = room?.players.find((item) => item.id === socket.playerId);
  if (player) player.online = hasPlayerSocket(code, socket.playerId);
  if (room) {
    markRoomActive(room);
    broadcastRoom(room);
  }
}

function roomCleanupReason(room, timestamp = now()) {
  const onlineCount = room.players.filter((player) => player.online).length;
  if (onlineCount === 0 && timestamp - room.lastActiveAt >= ROOM_TTL_MS.empty) return 'empty_room_timeout';
  if (room.settledAt && timestamp - room.settledAt >= ROOM_TTL_MS.settled) return 'settled_room_timeout';
  if (timestamp - room.lastActiveAt >= ROOM_TTL_MS.inactive) return 'inactive_room_timeout';
  return null;
}

function cleanupRooms(timestamp = now()) {
  let removed = 0;
  for (const [code, room] of rooms.entries()) {
    const reason = roomCleanupReason(room, timestamp);
    if (!reason) continue;
    roomSockets.delete(code);
    rooms.delete(code);
    removed += 1;
    writeLog('info', 'room.cleaned_up', {
      roomCode: code,
      reason,
      playerCount: room.players.length,
      lastActiveAt: room.lastActiveAt,
      settledAt: room.settledAt
    });
  }
  return removed;
}

function acceptWebSocket(req, socket, room, playerId) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '\r\n'].join('\r\n'));

  socket.playerId = playerId;
  socket.roomCode = room.code;
  replacePlayerSocket(room.code, playerId, socket);
  const player = room.players.find((item) => item.id === playerId);
  if (player) player.online = true;
  sendWs(socket, { type: 'room_state', room: serializeRoom(room, playerId) });
  broadcastRoom(room);

  socket.on('data', (chunk) => {
    if ((chunk[0] & 0x0f) === 0x8) socket.end();
  });
  socket.on('close', () => removeSocket(room.code, socket));
  socket.on('end', () => removeSocket(room.code, socket));
  socket.on('error', () => removeSocket(room.code, socket));
}

function roomCode() {
  let code = '';
  do code = String(Math.floor(100000 + Math.random() * 900000));
  while (rooms.has(code));
  return code;
}

function roomStats() {
  let connectedPlayers = 0;
  let activeGames = 0;
  for (const room of rooms.values()) {
    connectedPlayers += room.players.filter((player) => player.online).length;
    if (room.game) activeGames += 1;
  }
  return {
    rooms: rooms.size,
    activeGames,
    connectedPlayers,
    sockets: Array.from(roomSockets.values()).reduce((sum, sockets) => sum + sockets.size, 0)
  };
}

async function handleApi(req, res, path) {
  cleanupRooms();
  const context = createRequestContext(req, path);
  writeLog('info', 'http.request', context);

  if (req.method === 'GET' && path === '/api/health') {
    respondJson(res, 200, {
      ok: true,
      service: pkg.name,
      version: pkg.version,
      startupAt,
      uptimeMs: Date.now() - startupAt,
      stats: roomStats()
    }, context);
    return;
  }

  if (req.method === 'GET' && path === '/api/version') {
    respondJson(res, 200, {
      service: pkg.name,
      version: pkg.version,
      startupAt
    }, context);
    return;
  }

  if (req.method === 'POST' && path === '/api/solo') {
    const body = await readBody(req, { maxBytes: BODY_LIMIT_BYTES });
    const game = createSolo(body.name, body);
    respondJson(res, 200, { game: serializeGame(game, game.players[0].id), playerId: game.players[0].id, raw: game }, context);
    return;
  }

  if (req.method === 'POST' && path === '/api/solo/action') {
    const body = await readBody(req, { maxBytes: BODY_LIMIT_BYTES });
    const game = body.game;
    applyAction(game, 0, body);
    respondJson(res, 200, { game: serializeGame(game, game.players[0].id), raw: game }, context);
    return;
  }

  if (req.method === 'POST' && path === '/api/rooms') {
    withRateLimit('createRoom', context);
    const body = await readBody(req, { maxBytes: BODY_LIMIT_BYTES });
    const code = roomCode();
    const host = createSessionPlayer(normalizeName(body.name, '房主'));
    rooms.set(code, createRoomState(code, host));
    writeLog('info', 'room.created', { ...context, roomCode: code, playerId: host.id });
    respondJson(res, 200, { code, playerId: host.id, sessionToken: host.sessionToken }, { ...context, roomCode: code, playerId: host.id });
    return;
  }

  if (req.method === 'POST' && path.match(/^\/api\/rooms\/\d{6}\/join$/)) {
    const code = path.split('/')[3];
    context.roomCode = code;
    withRateLimit('joinRoom', context);
    const room = rooms.get(code);
    if (!room) return respondRoomError(res, 404, '房间不存在', context, { eventName: 'join' });
    if (room.game) return respondRoomError(res, 409, '牌局已开始', context, { eventName: 'join' });
    if (room.players.length >= 4) return respondRoomError(res, 409, '房间已满', context, { eventName: 'join' });
    markRoomActive(room);
    const body = await readBody(req, { maxBytes: BODY_LIMIT_BYTES });
    const player = {
      ...createSessionPlayer(normalizeName(body.name, `玩家${room.players.length + 1}`)),
      ready: false,
      online: true
    };
    room.players.push(player);
    ensureStanding(room, player);
    broadcastRoom(room);
    writeLog('info', 'room.joined', { ...context, roomCode: code, playerId: player.id });
    respondJson(res, 200, { code, playerId: player.id, sessionToken: player.sessionToken }, { ...context, playerId: player.id });
    return;
  }

  if (req.method === 'POST' && path.match(/^\/api\/rooms\/\d{6}\/reconnect$/)) {
    const code = path.split('/')[3];
    context.roomCode = code;
    withRateLimit('reconnect', context);
    const room = rooms.get(code);
    if (!room) return respondRoomError(res, 404, '房间不存在', context, { eventName: 'reconnect' });
    markRoomActive(room);
    const body = await readBody(req, { maxBytes: BODY_LIMIT_BYTES });
    context.playerId = body.playerId;
    requireString(body.playerId, 'playerId');
    requireString(body.sessionToken, 'sessionToken');
    const player = verifyRoomSession(room, body.playerId, body.sessionToken);
    if (!player) return respondRoomError(res, 403, '玩家不在房间中', context, { eventName: 'reconnect_failed' });
    player.online = true;
    broadcastRoom(room);
    writeLog('info', 'room.reconnected', context);
    respondJson(res, 200, { ok: true, room: serializeRoom(room, body.playerId) }, context);
    return;
  }

  if (req.method === 'POST' && path.match(/^\/api\/rooms\/\d{6}\/ready$/)) {
    const code = path.split('/')[3];
    context.roomCode = code;
    const room = rooms.get(code);
    if (!room) return respondRoomError(res, 404, '房间不存在', context, { eventName: 'ready' });
    markRoomActive(room);
    const body = await readBody(req, { maxBytes: BODY_LIMIT_BYTES });
    context.playerId = body.playerId;
    requireString(body.playerId, 'playerId');
    requireString(body.sessionToken, 'sessionToken');
    const player = verifyRoomSession(room, body.playerId, body.sessionToken);
    if (!player) return respondRoomError(res, 403, '玩家不在房间中', context, { eventName: 'ready' });
    player.ready = body.ready !== false;
    broadcastRoom(room);
    writeLog('info', 'room.ready_changed', { ...context, ready: player.ready });
    respondJson(res, 200, { ok: true, room: serializeRoom(room, body.playerId) }, context);
    return;
  }

  if (req.method === 'POST' && path.match(/^\/api\/rooms\/\d{6}\/config$/)) {
    const code = path.split('/')[3];
    context.roomCode = code;
    const room = rooms.get(code);
    if (!room) return respondRoomError(res, 404, '房间不存在', context, { eventName: 'config' });
    markRoomActive(room);
    const body = await readBody(req, { maxBytes: BODY_LIMIT_BYTES });
    context.playerId = body.playerId;
    requireString(body.playerId, 'playerId');
    requireString(body.sessionToken, 'sessionToken');
    const player = verifyRoomSession(room, body.playerId, body.sessionToken);
    if (!player || player.id !== room.hostId) return respondRoomError(res, 403, '只有房主可以修改房间配置', context, { eventName: 'config' });
    if (room.game) return respondRoomError(res, 409, '牌局开始后不可修改配置', context, { eventName: 'config' });
    room.config.fillWithAi = true;
    broadcastRoom(room);
    writeLog('info', 'room.config_updated', context);
    respondJson(res, 200, { ok: true, room: serializeRoom(room, body.playerId) }, context);
    return;
  }

  if (req.method === 'POST' && path.match(/^\/api\/rooms\/\d{6}\/start$/)) {
    const code = path.split('/')[3];
    context.roomCode = code;
    const room = rooms.get(code);
    if (!room) return respondRoomError(res, 404, '房间不存在', context, { eventName: 'start' });
    markRoomActive(room);
    const body = await readBody(req, { maxBytes: BODY_LIMIT_BYTES });
    context.playerId = body.playerId;
    requireString(body.playerId, 'playerId');
    requireString(body.sessionToken, 'sessionToken');
    const player = verifyRoomSession(room, body.playerId, body.sessionToken);
    if (!player || player.id !== room.hostId) return respondRoomError(res, 403, '只有房主可以开始游戏', context, { eventName: 'start' });
    if (room.players.some((item) => !item.ready)) return respondRoomError(res, 409, '仍有玩家未准备', context, { eventName: 'start' });
    if (!room.game) startRoomGame(room);
    writeLog('info', 'room.started', {
      ...context,
      playerCount: room.players.length,
      standingsCount: room.standings.length
    });
    broadcastRoom(room);
    respondJson(res, 200, { ok: true }, context);
    return;
  }

  if (req.method === 'GET' && path.match(/^\/api\/rooms\/\d{6}$/)) {
    const code = path.split('/')[3];
    context.roomCode = code;
    const room = rooms.get(code);
    if (!room) return respondRoomError(res, 404, '房间不存在', context, { eventName: 'get_room' });
    markRoomActive(room);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const playerId = url.searchParams.get('playerId');
    const sessionToken = url.searchParams.get('sessionToken');
    context.playerId = playerId;
    requireString(playerId, 'playerId');
    requireString(sessionToken, 'sessionToken');
    if (!verifyRoomSession(room, playerId, sessionToken)) return respondRoomError(res, 403, '玩家不在房间中', context, { eventName: 'get_room' });
    respondJson(res, 200, serializeRoom(room, playerId), context);
    return;
  }

  if (req.method === 'POST' && path.match(/^\/api\/rooms\/\d{6}\/action$/)) {
    const code = path.split('/')[3];
    context.roomCode = code;
    withRateLimit('action', context);
    const room = rooms.get(code);
    const body = await readBody(req, { maxBytes: BODY_LIMIT_BYTES });
    context.playerId = body.playerId;
    context.action = body.action;
    requireString(body.playerId, 'playerId');
    requireString(body.sessionToken, 'sessionToken');
    const action = requireString(body.action, 'action');
    if (!['discard', 'pass', 'peng', 'chi', 'gang', 'win'].includes(action)) throw new HttpError(400, 'action 格式无效');
    if (!room?.game) return respondRoomError(res, 404, '牌局不存在', context, { eventName: 'action' });
    markRoomActive(room);
    if (!verifyRoomSession(room, body.playerId, body.sessionToken)) return respondRoomError(res, 403, '玩家不在房间中', context, { eventName: 'action' });
    const seat = room.game.players.findIndex((player) => player.id === body.playerId);
    if (seat < 0) return respondRoomError(res, 403, '玩家不在房间中', context, { eventName: 'action' });
    applyAction(room.game, seat, body);
    syncStandings(room);
    writeLog('info', 'room.action_applied', {
      ...context,
      seat,
      phase: room.game.phase
    });
    broadcastRoom(room);
    respondJson(res, 200, { game: serializeGame(room.game, body.playerId) }, context);
    return;
  }

  respondJson(res, 404, { error: '接口不存在' }, context);
}

async function serveStatic(req, res, path) {
  const safePath = normalize(path === '/' ? '/index.html' : path).replace(/^\.\.(\/|\\|$)/, '');
  const filePath = join(publicDir, safePath);
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
  const extension = extname(filePath);
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': `${types[extension] || 'application/octet-stream'}; charset=utf-8` });
    res.end(content);
  } catch {
    if (extension) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const content = await readFile(join(publicDir, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(content);
  }
}

const server = createServer(async (req, res) => {
  const requestContext = createRequestContext(req, req.url || '/');
  writeLog('info', 'http.request_received', requestContext);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url.pathname);
    else await serveStatic(req, res, url.pathname);
  } catch (error) {
    if (error instanceof HttpError) {
      respondJson(res, error.status, { error: error.message }, requestContext);
      return;
    }
    writeLog('error', 'http.unhandled_error', {
      ...requestContext,
      error: error instanceof Error ? error.message : '服务器内部错误'
    });
    sendError(res, error);
  }
});

server.on('upgrade', (req, socket) => {
  cleanupRooms();
  const context = createRequestContext(req, req.url || '/');
  writeLog('info', 'ws.upgrade_request', context);
  try {
    withRateLimit('wsUpgrade', context);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/ws\/rooms\/(\d{6})$/);
    if (!match) {
      writeLog('warn', 'ws.upgrade_rejected', { ...context, status: 404, reason: 'upgrade_path_not_found' });
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const room = rooms.get(match[1]);
    const playerId = url.searchParams.get('playerId') || '';
    const sessionToken = url.searchParams.get('sessionToken') || '';
    context.roomCode = match[1];
    context.playerId = playerId;
    if (!room) {
      writeLog('warn', 'ws.upgrade_rejected', { ...context, status: 404, reason: 'room_not_found' });
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!verifyRoomSession(room, playerId, sessionToken)) {
      writeLog('warn', 'ws.upgrade_rejected', { ...context, status: 403, reason: 'invalid_session' });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    markRoomActive(room);
    writeLog('info', 'ws.upgrade_accepted', context);
    acceptWebSocket(req, socket, room, playerId);
  } catch (error) {
    if (error instanceof HttpError) {
      writeLog('warn', 'ws.upgrade_rejected', {
        ...context,
        status: error.status,
        reason: error.message
      });
      socket.write(`HTTP/1.1 ${error.status} Too Many Requests\r\n\r\n`);
      socket.destroy();
      return;
    }
    writeLog('error', 'ws.upgrade_error', {
      ...context,
      error: error instanceof Error ? error.message : '升级失败'
    });
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
  }
});

function startServer() {
  return server.listen(port, '0.0.0.0', () => {
    console.log(`Hangzhou Mahjong running on http://localhost:${port}`);
  });
}

export { server, startServer };

export const testing = {
  BODY_LIMIT_BYTES,
  RATE_LIMITS,
  ROOM_TTL_MS,
  cleanupRooms,
  createRoomState,
  createRequestContext,
  ensureStanding,
  roomCleanupReason,
  roomStats,
  removeSocket,
  setRateBuckets(map) {
    rateBuckets.clear();
    for (const [key, value] of map.entries()) rateBuckets.set(key, value);
  },
  setNow(fn) {
    now = fn;
  },
  setLogWriter(writer) {
    logWriter = writer;
  },
  syncStandings,
  serializeRoom,
  broadcastRoom,
  acceptWebSocket,
  handleApi,
  rooms,
  roomSockets,
  server
};
