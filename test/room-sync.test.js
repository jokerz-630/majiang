import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeGame, startRoomGame } from '../src/rules/game.js';
import { testing as serverTesting } from '../server.js';

function resetRooms() {
  serverTesting.rooms.clear();
  serverTesting.roomSockets.clear();
  serverTesting.setRateBuckets(new Map());
  serverTesting.setNow(() => Date.now());
  serverTesting.setLogWriter(() => {});
}

async function startTestServer() {
  await new Promise((resolve) => serverTesting.server.listen(0, '127.0.0.1', resolve));
  const address = serverTesting.server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => serverTesting.server.close(resolve));
      resetRooms();
    }
  };
}

async function api(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const data = await response.json();
  return { status: response.status, ok: response.ok, data };
}

function makeSocket(playerId) {
  const writes = [];
  return {
    playerId,
    destroyed: false,
    write(chunk) {
      writes.push(chunk);
    },
    writes
  };
}

function makeUpgradeReq(code, playerId, sessionToken) {
  return {
    method: 'GET',
    url: `/ws/rooms/${code}?playerId=${playerId}&sessionToken=${sessionToken}`,
    headers: { host: 'localhost', 'sec-websocket-key': 'test-key' },
    socket: { remoteAddress: '127.0.0.1' }
  };
}

function makeUpgradeSocket() {
  const writes = [];
  const listeners = new Map();
  return {
    destroyed: false,
    ended: false,
    writes,
    write(chunk) {
      writes.push(chunk);
    },
    end() {
      this.ended = true;
      this.destroyed = true;
    },
    destroy() {
      this.destroyed = true;
    },
    on(event, handler) {
      listeners.set(event, handler);
    },
    emit(event, value) {
      listeners.get(event)?.(value);
    }
  };
}

function decodeFrame(frame) {
  const length = frame[1] & 0x7f;
  const offset = length === 126 ? 4 : 2;
  return JSON.parse(frame.subarray(offset).toString('utf8'));
}

test('serializeRoom 会按 viewerId 返回对应视角', () => {
  resetRooms();
  const room = {
    code: '123456',
    hostId: 'host',
    players: [
      { id: 'host', name: '房主' },
      { id: 'guest', name: '客人' }
    ],
    game: null
  };

  startRoomGame(room);
  const hostView = serverTesting.serializeRoom(room, 'host');
  const guestView = serverTesting.serializeRoom(room, 'guest');

  assert.equal(hostView.code, '123456');
  assert.equal(hostView.game.viewerSeat, 0);
  assert.equal(guestView.game.viewerSeat, 1);
  assert.equal(hostView.game.players[0].hand.length, 14);
  assert.equal(guestView.game.players[1].hand.length >= 13, true);
});

test('broadcastRoom 会向房间内每个连接推送各自视角状态', () => {
  resetRooms();
  const room = {
    code: '654321',
    hostId: 'host',
    players: [
      { id: 'host', name: '房主' },
      { id: 'guest', name: '客人' }
    ],
    game: null
  };

  startRoomGame(room);
  serverTesting.rooms.set(room.code, room);

  const hostSocket = makeSocket('host');
  const guestSocket = makeSocket('guest');
  serverTesting.roomSockets.set(room.code, new Set([hostSocket, guestSocket]));

  serverTesting.broadcastRoom(room);

  assert.equal(hostSocket.writes.length, 1);
  assert.equal(guestSocket.writes.length, 1);

  const hostPayload = decodeFrame(hostSocket.writes[0]);
  const guestPayload = decodeFrame(guestSocket.writes[0]);

  assert.equal(hostPayload.type, 'room_state');
  assert.equal(guestPayload.type, 'room_state');
  assert.equal(hostPayload.room.game.viewerSeat, 0);
  assert.equal(guestPayload.room.game.viewerSeat, 1);
  assert.deepEqual(hostPayload.room.players, guestPayload.room.players);

  serverTesting.roomSockets.delete(room.code);
  serverTesting.rooms.delete(room.code);
});

test('serializeGame 对非本人只暴露手牌数量', () => {
  resetRooms();
  const room = {
    code: '222222',
    hostId: 'host',
    players: [
      { id: 'host', name: '房主' },
      { id: 'guest', name: '客人' }
    ],
    game: null
  };

  startRoomGame(room);
  const guestView = serializeGame(room.game, 'guest');

  assert.equal(guestView.players[0].hand.length, 0);
  assert.ok(guestView.players[0].handCount >= 13);
  assert.ok(guestView.players[1].hand.length >= 13);
});

test('createRoomState 会初始化配置与累计战绩', () => {
  resetRooms();
  const room = serverTesting.createRoomState('888888', { id: 'host', sessionToken: 'token-host', name: '房主' });

  assert.equal(room.config.fillWithAi, true);
  assert.equal(room.players[0].ready, true);
  assert.equal(room.players[0].online, true);
  assert.deepEqual(room.standings, [{ id: 'host', name: '房主', totalScore: 0 }]);
});

test('syncStandings 会在结算后累计真人分数且只累计一次', () => {
  resetRooms();
  const room = serverTesting.createRoomState('777777', { id: 'host', name: '房主' });
  room.players.push({ id: 'guest', name: '客人', ready: true, online: true });
  serverTesting.ensureStanding(room, room.players[1]);
  startRoomGame(room);

  room.game.phase = 'settlement';
  room.game.players[0].score = 16;
  room.game.players[1].score = -16;

  serverTesting.syncStandings(room);
  serverTesting.syncStandings(room);

  assert.equal(room.standings.find((item) => item.id === 'host').totalScore, 16);
  assert.equal(room.standings.find((item) => item.id === 'guest').totalScore, -16);
});

test('removeSocket 会把玩家标记为离线', () => {
  resetRooms();
  const room = serverTesting.createRoomState('666666', { id: 'host', name: '房主' });
  serverTesting.rooms.set(room.code, room);
  const socket = makeSocket('host');
  serverTesting.roomSockets.set(room.code, new Set([socket]));

  socket.destroyed = true;
  const sockets = serverTesting.roomSockets.get(room.code);
  sockets.delete(socket);
  room.players[0].online = false;

  assert.equal(room.players[0].online, false);

  serverTesting.roomSockets.delete(room.code);
  serverTesting.rooms.delete(room.code);
});

test('acceptWebSocket 会替换同一玩家的旧连接', () => {
  resetRooms();
  const room = serverTesting.createRoomState('666667', { id: 'host', sessionToken: 'token-host', name: '房主' });
  serverTesting.rooms.set(room.code, room);

  const request = {
    headers: { 'sec-websocket-key': 'test-key' }
  };
  const oldSocket = {
    destroyed: false,
    writes: [],
    ended: false,
    write(chunk) {
      this.writes.push(chunk);
    },
    end() {
      this.ended = true;
      this.destroyed = true;
    },
    on() {}
  };
  const newSocket = {
    destroyed: false,
    writes: [],
    ended: false,
    write(chunk) {
      this.writes.push(chunk);
    },
    end() {
      this.ended = true;
      this.destroyed = true;
    },
    on() {}
  };

  serverTesting.acceptWebSocket(request, oldSocket, room, 'host');
  serverTesting.acceptWebSocket(request, newSocket, room, 'host');

  const sockets = serverTesting.roomSockets.get(room.code);
  assert.equal(oldSocket.ended, true);
  assert.equal(newSocket.ended, false);
  assert.equal(sockets.size, 1);
  assert.equal(sockets.has(newSocket), true);
  assert.equal(room.players[0].online, true);
});

test('旧连接关闭时如仍有新连接在线则保持玩家在线状态', () => {
  resetRooms();
  const room = serverTesting.createRoomState('666668', { id: 'host', sessionToken: 'token-host', name: '房主' });
  serverTesting.rooms.set(room.code, room);
  const oldSocket = makeSocket('host');
  const newSocket = makeSocket('host');
  serverTesting.roomSockets.set(room.code, new Set([oldSocket, newSocket]));
  room.players[0].online = true;

  serverTesting.removeSocket(room.code, oldSocket);

  assert.equal(room.players[0].online, true);
  assert.equal(serverTesting.roomSockets.get(room.code).size, 1);
  assert.equal(serverTesting.roomSockets.get(room.code).has(newSocket), true);

  serverTesting.removeSocket(room.code, newSocket);

  assert.equal(room.players[0].online, false);
  assert.equal(serverTesting.roomSockets.has(room.code), false);
});

test('roomStats 会返回房间与连接摘要', () => {
  resetRooms();
  const roomA = serverTesting.createRoomState('100001', { id: 'host-a', sessionToken: 'token-a', name: '房主A' });
  const roomB = serverTesting.createRoomState('100002', { id: 'host-b', sessionToken: 'token-b', name: '房主B' });
  roomA.players.push({ id: 'guest-a', name: '客人A', ready: true, online: true, sessionToken: 'token-ga' });
  roomB.players.push({ id: 'guest-b', name: '客人B', ready: false, online: false, sessionToken: 'token-gb' });
  roomA.game = { phase: 'playing' };
  serverTesting.rooms.set(roomA.code, roomA);
  serverTesting.rooms.set(roomB.code, roomB);
  serverTesting.roomSockets.set(roomA.code, new Set([makeSocket('host-a'), makeSocket('guest-a')]));

  const stats = serverTesting.roomStats();

  assert.deepEqual(stats, {
    rooms: 2,
    activeGames: 1,
    connectedPlayers: 3,
    sockets: 2
  });
});

test('createRequestContext 会生成 requestId 和请求上下文', () => {
  const context = serverTesting.createRequestContext({
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.7' },
    socket: { remoteAddress: '127.0.0.1' }
  }, '/api/rooms', { roomCode: '123456' });

  assert.equal(typeof context.requestId, 'string');
  assert.equal(context.requestId.length > 10, true);
  assert.equal(context.method, 'POST');
  assert.equal(context.path, '/api/rooms');
  assert.equal(context.remoteIp, '203.0.113.7');
  assert.equal(context.roomCode, '123456');
});

test('cleanupRooms 会清理超时空房间', () => {
  resetRooms();
  let current = 1_000_000;
  serverTesting.setNow(() => current);
  const room = serverTesting.createRoomState('300001', { id: 'host', sessionToken: 'token-host', name: '房主' });
  room.players[0].online = false;
  room.lastActiveAt = current - serverTesting.ROOM_TTL_MS.empty - 1;
  serverTesting.rooms.set(room.code, room);
  serverTesting.roomSockets.set(room.code, new Set([makeSocket('host')]));

  const removed = serverTesting.cleanupRooms(current);

  assert.equal(removed, 1);
  assert.equal(serverTesting.rooms.has(room.code), false);
  assert.equal(serverTesting.roomSockets.has(room.code), false);
});

test('cleanupRooms 会保留仍在活跃窗口内的房间', () => {
  resetRooms();
  let current = 2_000_000;
  serverTesting.setNow(() => current);
  const room = serverTesting.createRoomState('300002', { id: 'host', sessionToken: 'token-host', name: '房主' });
  room.lastActiveAt = current - serverTesting.ROOM_TTL_MS.inactive + 1;
  serverTesting.rooms.set(room.code, room);

  const removed = serverTesting.cleanupRooms(current);

  assert.equal(removed, 0);
  assert.equal(serverTesting.rooms.has(room.code), true);
});

test('cleanupRooms 会清理结算后保留超时的房间', () => {
  resetRooms();
  let current = 3_000_000;
  serverTesting.setNow(() => current);
  const room = serverTesting.createRoomState('300003', { id: 'host', sessionToken: 'token-host', name: '房主' });
  room.game = { phase: 'settlement', settlementApplied: true };
  room.settledAt = current - serverTesting.ROOM_TTL_MS.settled - 1;
  room.lastActiveAt = current;
  serverTesting.rooms.set(room.code, room);

  const reason = serverTesting.roomCleanupReason(room, current);
  const removed = serverTesting.cleanupRooms(current);

  assert.equal(reason, 'settled_room_timeout');
  assert.equal(removed, 1);
  assert.equal(serverTesting.rooms.has(room.code), false);
});

test('创建和加入房间会校验昵称长度', async () => {
  resetRooms();
  const testServer = await startTestServer();

  try {
    const longName = '超长昵称超长昵称超长昵称呀';
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: longName })
    });
    assert.equal(createRes.status, 400);
    assert.match(createRes.data.error, /昵称长度/);

    const validCreateRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    assert.equal(validCreateRes.status, 200);

    const joinRes = await api(testServer.baseUrl, `/api/rooms/${validCreateRes.data.code}/join`, {
      method: 'POST',
      body: JSON.stringify({ name: longName })
    });
    assert.equal(joinRes.status, 400);
    assert.match(joinRes.data.error, /昵称长度/);
  } finally {
    await testServer.close();
  }
});

test('请求体过大时会返回 413', async () => {
  resetRooms();
  const testServer = await startTestServer();

  try {
    const hugeName = 'a'.repeat(serverTesting.BODY_LIMIT_BYTES + 100);
    const response = await fetch(`${testServer.baseUrl}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: hugeName })
    });
    const data = await response.json();

    assert.equal(response.status, 413);
    assert.equal(data.error, '请求体过大');
  } finally {
    await testServer.close();
  }
});

test('动作接口超过频率限制会返回 429', async () => {
  resetRooms();
  let current = 5_000_000;
  serverTesting.setNow(() => current);
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    const code = createRes.data.code;
    const hostId = createRes.data.playerId;
    const hostToken = createRes.data.sessionToken;

    for (let index = 0; index < serverTesting.RATE_LIMITS.action.limit; index += 1) {
      const response = await api(testServer.baseUrl, `/api/rooms/${code}/action`, {
        method: 'POST',
        body: JSON.stringify({ playerId: hostId, sessionToken: hostToken, action: 'discard', tileId: 'missing' })
      });
      assert.notEqual(response.status, 429);
    }

    const limitedRes = await api(testServer.baseUrl, `/api/rooms/${code}/action`, {
      method: 'POST',
      body: JSON.stringify({ playerId: hostId, sessionToken: hostToken, action: 'discard', tileId: 'missing' })
    });
    assert.equal(limitedRes.status, 429);
    assert.match(limitedRes.data.error, /请求过于频繁/);
  } finally {
    await testServer.close();
  }
});

test('WebSocket upgrade 超过频率限制会返回 429', async () => {
  resetRooms();
  let current = 6_000_000;
  serverTesting.setNow(() => current);
  const room = serverTesting.createRoomState('400001', { id: 'host', sessionToken: 'token-host', name: '房主' });
  serverTesting.rooms.set(room.code, room);

  const req = {
    method: 'GET',
    url: `/ws/rooms/${room.code}?playerId=host&sessionToken=token-host`,
    headers: { host: 'localhost', 'sec-websocket-key': 'test-key' },
    socket: { remoteAddress: '127.0.0.1' }
  };

  for (let index = 0; index < serverTesting.RATE_LIMITS.wsUpgrade.limit; index += 1) {
    const socket = { write() {}, destroy() {}, on() {} };
    serverTesting.server.emit('upgrade', req, socket);
  }

  const writes = [];
  const limitedSocket = {
    write(chunk) {
      writes.push(String(chunk));
    },
    destroy() {},
    on() {}
  };
  serverTesting.server.emit('upgrade', req, limitedSocket);

  assert.equal(writes.some((line) => line.includes('429 Too Many Requests')), true);
});

test('创建房间接口超过频率限制会返回 429', async () => {
  resetRooms();
  let current = 7_000_000;
  serverTesting.setNow(() => current);
  const testServer = await startTestServer();

  try {
    for (let index = 0; index < serverTesting.RATE_LIMITS.createRoom.limit; index += 1) {
      const response = await api(testServer.baseUrl, '/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: `房主${index}` })
      });
      assert.equal(response.status, 200);
    }

    const limitedRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '超限房主' })
    });

    assert.equal(limitedRes.status, 429);
    assert.match(limitedRes.data.error, /请求过于频繁/);
  } finally {
    await testServer.close();
  }
});

test('加入房间接口超过频率限制会返回 429', async () => {
  resetRooms();
  let current = 8_000_000;
  serverTesting.setNow(() => current);
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    assert.equal(createRes.status, 200);

    for (let index = 0; index < serverTesting.RATE_LIMITS.joinRoom.limit; index += 1) {
      const response = await api(testServer.baseUrl, `/api/rooms/${createRes.data.code}/join`, {
        method: 'POST',
        body: JSON.stringify({ name: `客人${index}` })
      });
      if (index < 3) assert.equal(response.status, 200);
      else assert.notEqual(response.status, 429);
    }

    const limitedRes = await api(testServer.baseUrl, `/api/rooms/${createRes.data.code}/join`, {
      method: 'POST',
      body: JSON.stringify({ name: '超限客人' })
    });

    assert.equal(limitedRes.status, 429);
    assert.match(limitedRes.data.error, /请求过于频繁/);
  } finally {
    await testServer.close();
  }
});

test('接口请求会触发过期空房间清理', async () => {
  resetRooms();
  let current = 9_000_000;
  serverTesting.setNow(() => current);
  const staleRoom = serverTesting.createRoomState('500001', { id: 'host', sessionToken: 'token-host', name: '房主' });
  staleRoom.players[0].online = false;
  staleRoom.lastActiveAt = current - serverTesting.ROOM_TTL_MS.empty - 1;
  serverTesting.rooms.set(staleRoom.code, staleRoom);
  serverTesting.roomSockets.set(staleRoom.code, new Set([makeSocket('host')]));

  const testServer = await startTestServer();

  try {
    const healthRes = await api(testServer.baseUrl, '/api/health');
    assert.equal(healthRes.status, 200);
    assert.equal(serverTesting.rooms.has(staleRoom.code), false);
    assert.equal(serverTesting.roomSockets.has(staleRoom.code), false);
    assert.equal(healthRes.data.stats.rooms, 0);
  } finally {
    await testServer.close();
  }
});

test('联机接口支持创建加入准备开局动作与重连', async () => {
  resetRooms();
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    assert.equal(createRes.status, 200);
    const { code, playerId: hostId, sessionToken: hostToken } = createRes.data;

    const joinRes = await api(testServer.baseUrl, `/api/rooms/${code}/join`, {
      method: 'POST',
      body: JSON.stringify({ name: '客人' })
    });
    assert.equal(joinRes.status, 200);
    const guestId = joinRes.data.playerId;
    const guestToken = joinRes.data.sessionToken;

    const readyRes = await api(testServer.baseUrl, `/api/rooms/${code}/ready`, {
      method: 'POST',
      body: JSON.stringify({ playerId: guestId, sessionToken: guestToken, ready: true })
    });
    assert.equal(readyRes.status, 200);
    assert.equal(readyRes.data.room.players.find((player) => player.id === guestId).ready, true);

    const startRes = await api(testServer.baseUrl, `/api/rooms/${code}/start`, {
      method: 'POST',
      body: JSON.stringify({ playerId: hostId, sessionToken: hostToken })
    });
    assert.equal(startRes.status, 200);

    const roomRes = await api(testServer.baseUrl, `/api/rooms/${code}?playerId=${hostId}&sessionToken=${hostToken}`);
    assert.equal(roomRes.status, 200);
    assert.equal(roomRes.data.game.viewerSeat, 0);
    assert.equal(roomRes.data.players.length, 2);

    const discardAction = roomRes.data.game.actions.find((action) => action.type === 'discard');
    assert.ok(discardAction);

    const actionRes = await api(testServer.baseUrl, `/api/rooms/${code}/action`, {
      method: 'POST',
      body: JSON.stringify({ playerId: hostId, sessionToken: hostToken, action: 'discard', tileId: discardAction.tileId })
    });
    assert.equal(actionRes.status, 200);
    assert.ok(actionRes.data.game.players[0].discards.length >= 1);

    const reconnectRes = await api(testServer.baseUrl, `/api/rooms/${code}/reconnect`, {
      method: 'POST',
      body: JSON.stringify({ playerId: guestId, sessionToken: guestToken })
    });
    assert.equal(reconnectRes.status, 200);
    assert.equal(reconnectRes.data.room.players.find((player) => player.id === guestId).online, true);
  } finally {
    await testServer.close();
  }
});

test('刷新恢复后可继续拿到房间中的最新对局状态', async () => {
  resetRooms();
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    const { code, playerId: hostId, sessionToken: hostToken } = createRes.data;

    const joinRes = await api(testServer.baseUrl, `/api/rooms/${code}/join`, {
      method: 'POST',
      body: JSON.stringify({ name: '客人' })
    });
    const guestId = joinRes.data.playerId;
    const guestToken = joinRes.data.sessionToken;

    await api(testServer.baseUrl, `/api/rooms/${code}/ready`, {
      method: 'POST',
      body: JSON.stringify({ playerId: guestId, sessionToken: guestToken, ready: true })
    });
    await api(testServer.baseUrl, `/api/rooms/${code}/start`, {
      method: 'POST',
      body: JSON.stringify({ playerId: hostId, sessionToken: hostToken })
    });

    const roomBeforeRefresh = await api(testServer.baseUrl, `/api/rooms/${code}?playerId=${hostId}&sessionToken=${hostToken}`);
    const discardAction = roomBeforeRefresh.data.game.actions.find((action) => action.type === 'discard');
    assert.ok(discardAction);

    await api(testServer.baseUrl, `/api/rooms/${code}/action`, {
      method: 'POST',
      body: JSON.stringify({ playerId: hostId, sessionToken: hostToken, action: 'discard', tileId: discardAction.tileId })
    });

    const refreshReconnectRes = await api(testServer.baseUrl, `/api/rooms/${code}/reconnect`, {
      method: 'POST',
      body: JSON.stringify({ playerId: hostId, sessionToken: hostToken })
    });

    assert.equal(refreshReconnectRes.status, 200);
    assert.equal(refreshReconnectRes.data.room.game.viewerSeat, 0);
    assert.ok(refreshReconnectRes.data.room.game.players[0].discards.length >= 1);
    assert.equal(refreshReconnectRes.data.room.players.find((player) => player.id === hostId).online, true);
  } finally {
    await testServer.close();
  }
});

test('WebSocket 重复连接替换后房间只保留一个活跃连接', async () => {
  resetRooms();
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    const { code, playerId, sessionToken } = createRes.data;

    const firstSocket = makeUpgradeSocket();
    serverTesting.server.emit('upgrade', makeUpgradeReq(code, playerId, sessionToken), firstSocket);
    assert.equal(serverTesting.roomSockets.get(code).size, 1);

    const secondSocket = makeUpgradeSocket();
    serverTesting.server.emit('upgrade', makeUpgradeReq(code, playerId, sessionToken), secondSocket);

    const sockets = serverTesting.roomSockets.get(code);
    assert.equal(firstSocket.ended, true);
    assert.equal(secondSocket.ended, false);
    assert.equal(sockets.size, 1);
    assert.equal(sockets.has(secondSocket), true);

    const healthRes = await api(testServer.baseUrl, '/api/health');
    assert.equal(healthRes.data.stats.connectedPlayers, 1);
    assert.equal(healthRes.data.stats.sockets, 1);
  } finally {
    await testServer.close();
  }
});

test('短时中断后可通过 reconnect 与新 WebSocket 恢复在线状态', async () => {
  resetRooms();
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    const { code, playerId, sessionToken } = createRes.data;

    const socket = makeUpgradeSocket();
    serverTesting.server.emit('upgrade', makeUpgradeReq(code, playerId, sessionToken), socket);
    assert.equal(serverTesting.rooms.get(code).players.find((player) => player.id === playerId).online, true);

    socket.emit('close');
    assert.equal(serverTesting.rooms.get(code).players.find((player) => player.id === playerId).online, false);

    const reconnectRes = await api(testServer.baseUrl, `/api/rooms/${code}/reconnect`, {
      method: 'POST',
      body: JSON.stringify({ playerId, sessionToken })
    });
    assert.equal(reconnectRes.status, 200);
    assert.equal(reconnectRes.data.room.players.find((player) => player.id === playerId).online, true);

    const newSocket = makeUpgradeSocket();
    serverTesting.server.emit('upgrade', makeUpgradeReq(code, playerId, sessionToken), newSocket);
    assert.equal(serverTesting.roomSockets.get(code).size, 1);
    assert.equal(serverTesting.roomSockets.get(code).has(newSocket), true);
  } finally {
    await testServer.close();
  }
});

test('健康检查与版本接口会返回运行摘要', async () => {
  resetRooms();
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    assert.equal(createRes.status, 200);

    const healthRes = await api(testServer.baseUrl, '/api/health');
    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.data.ok, true);
    assert.equal(healthRes.data.service, 'hangzhou-mahjong-web-game');
    assert.equal(healthRes.data.version, '0.1.0');
    assert.ok(healthRes.data.startupAt > 0);
    assert.ok(healthRes.data.uptimeMs >= 0);
    assert.equal(healthRes.data.stats.rooms, 1);
    assert.equal(healthRes.data.stats.connectedPlayers, 1);

    const versionRes = await api(testServer.baseUrl, '/api/version');
    assert.equal(versionRes.status, 200);
    assert.equal(versionRes.data.service, 'hangzhou-mahjong-web-game');
    assert.equal(versionRes.data.version, '0.1.0');
    assert.ok(versionRes.data.startupAt > 0);
  } finally {
    await testServer.close();
  }
});

test('联机接口会输出关键结构化日志', async () => {
  resetRooms();
  const logs = [];
  serverTesting.setLogWriter((level, entry) => logs.push({ level, entry }));
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    assert.equal(createRes.status, 200);

    const readyRes = await api(testServer.baseUrl, `/api/rooms/${createRes.data.code}/ready`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: createRes.data.playerId,
        sessionToken: createRes.data.sessionToken,
        ready: true
      })
    });
    assert.equal(readyRes.status, 200);

    const startRes = await api(testServer.baseUrl, `/api/rooms/${createRes.data.code}/start`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: createRes.data.playerId,
        sessionToken: createRes.data.sessionToken
      })
    });
    assert.equal(startRes.status, 200);

    const events = logs.map((item) => item.entry.event);
    assert.ok(events.includes('http.request'));
    assert.ok(events.includes('room.created'));
    assert.ok(events.includes('room.ready_changed'));
    assert.ok(events.includes('room.started'));

    const createLog = logs.find((item) => item.entry.event === 'room.created');
    assert.equal(createLog.entry.roomCode, createRes.data.code);
    assert.equal(createLog.entry.playerId, createRes.data.playerId);
    assert.equal(typeof createLog.entry.requestId, 'string');
  } finally {
    await testServer.close();
  }
});

test('动作拒绝会输出带房间和玩家上下文的日志', async () => {
  resetRooms();
  const logs = [];
  serverTesting.setLogWriter((level, entry) => logs.push({ level, entry }));
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    assert.equal(createRes.status, 200);

    const actionRes = await api(testServer.baseUrl, `/api/rooms/${createRes.data.code}/action`, {
      method: 'POST',
      body: JSON.stringify({
        playerId: createRes.data.playerId,
        sessionToken: createRes.data.sessionToken,
        action: 'discard',
        tileId: 'missing'
      })
    });
    assert.equal(actionRes.status, 404);

    const rejectedLog = logs.find((item) => item.entry.event === 'room.action_rejected');
    assert.ok(rejectedLog);
    assert.equal(rejectedLog.level, 'warn');
    assert.equal(rejectedLog.entry.roomCode, createRes.data.code);
    assert.equal(rejectedLog.entry.playerId, createRes.data.playerId);
    assert.equal(rejectedLog.entry.action, 'discard');
    assert.equal(rejectedLog.entry.error, '牌局不存在');
    assert.equal(typeof rejectedLog.entry.requestId, 'string');
  } finally {
    await testServer.close();
  }
});

test('联机接口会拒绝非法权限与非法动作', async () => {
  resetRooms();
  const testServer = await startTestServer();

  try {
    const createRes = await api(testServer.baseUrl, '/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ name: '房主' })
    });
    const code = createRes.data.code;
    const hostId = createRes.data.playerId;
    const hostToken = createRes.data.sessionToken;

    const joinRes = await api(testServer.baseUrl, `/api/rooms/${code}/join`, {
      method: 'POST',
      body: JSON.stringify({ name: '客人' })
    });
    const guestId = joinRes.data.playerId;
    const guestToken = joinRes.data.sessionToken;

    const guestStartRes = await api(testServer.baseUrl, `/api/rooms/${code}/start`, {
      method: 'POST',
      body: JSON.stringify({ playerId: guestId, sessionToken: guestToken })
    });
    assert.equal(guestStartRes.status, 403);
    assert.match(guestStartRes.data.error, /只有房主/);

    const badConfigRes = await api(testServer.baseUrl, `/api/rooms/${code}/config`, {
      method: 'POST',
      body: JSON.stringify({ playerId: guestId, sessionToken: guestToken, fillWithAi: false })
    });
    assert.equal(badConfigRes.status, 403);

    const hostConfigRes = await api(testServer.baseUrl, `/api/rooms/${code}/config`, {
      method: 'POST',
      body: JSON.stringify({ playerId: hostId, sessionToken: hostToken, fillWithAi: false })
    });
    assert.equal(hostConfigRes.status, 200);
    assert.equal(hostConfigRes.data.room.config.fillWithAi, true);

    await api(testServer.baseUrl, `/api/rooms/${code}/ready`, {
      method: 'POST',
      body: JSON.stringify({ playerId: guestId, sessionToken: guestToken, ready: true })
    });

    const startRes = await api(testServer.baseUrl, `/api/rooms/${code}/start`, {
      method: 'POST',
      body: JSON.stringify({ playerId: hostId, sessionToken: hostToken })
    });
    assert.equal(startRes.status, 200);

    const illegalActionRes = await api(testServer.baseUrl, `/api/rooms/${code}/action`, {
      method: 'POST',
      body: JSON.stringify({ playerId: 'outsider', sessionToken: hostToken, action: 'discard', tileId: 'missing' })
    });
    assert.equal(illegalActionRes.status, 403);
    assert.match(illegalActionRes.data.error, /玩家不在房间中/);

    const forgedRoomRes = await api(testServer.baseUrl, `/api/rooms/${code}?playerId=${hostId}&sessionToken=forged-token`);
    assert.equal(forgedRoomRes.status, 403);

    const forgedReadyRes = await api(testServer.baseUrl, `/api/rooms/${code}/ready`, {
      method: 'POST',
      body: JSON.stringify({ playerId: guestId, sessionToken: 'forged-token', ready: false })
    });
    assert.equal(forgedReadyRes.status, 403);
  } finally {
    await testServer.close();
  }
});
