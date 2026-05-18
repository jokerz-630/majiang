import test from 'node:test';
import assert from 'node:assert/strict';
import { testing } from '../public/app.js';

function tile(suit, rank, id) {
  return { suit, rank, id: id || `${suit}-${rank}` };
}

function baseGame() {
  return {
    viewerSeat: 0,
    currentSeat: 0,
    wallCount: 50,
    canAct: true,
    message: '测试消息',
    phase: 'playing',
    actions: [],
    log: ['测试日志'],
    players: [
      {
        id: 'self',
        name: '自己',
        seat: 0,
        seatName: '东',
        role: '庄家',
        score: 0,
        chiCount: 0,
        knocked: false,
        caiPiao: 0,
        waitingCaiPiao: false,
        drawnTileId: '',
        melds: [],
        discards: [],
        hand: [],
        handCount: 14
      },
      { id: 'p1', name: '南家', seat: 1, seatName: '南', role: '闲家', score: 0, chiCount: 0, knocked: false, caiPiao: 0, waitingCaiPiao: false, drawnTileId: '', melds: [], discards: [], hand: [], handCount: 13 },
      { id: 'p2', name: '西家', seat: 2, seatName: '西', role: '闲家', score: 0, chiCount: 0, knocked: false, caiPiao: 0, waitingCaiPiao: false, drawnTileId: '', melds: [], discards: [], hand: [], handCount: 13 },
      { id: 'p3', name: '北家', seat: 3, seatName: '北', role: '闲家', score: 0, chiCount: 0, knocked: false, caiPiao: 0, waitingCaiPiao: false, drawnTileId: '', melds: [], discards: [], hand: [], handCount: 13 }
    ]
  };
}

test('tableActions 会显示财飘等待提示和可胡提示', () => {
  const game = baseGame();
  game.actions = [{ type: 'hu', label: '自摸胡' }];
  game.players[0].waitingCaiPiao = true;
  game.players[0].hand = [tile('wan', 1, 'a1')];

  const html = testing.tableActions(game, game.players[0], game.players[0].hand[0]);
  assert.match(html, /你当前可以自摸胡/);
  assert.match(html, /你已进入财飘等待/);
});

test('tableActions 会显示副露来源信息', () => {
  const game = baseGame();
  game.players[0].melds = [{
    type: 'chi',
    fromSeat: 1,
    sourceTile: tile('wan', 3, 'source-3'),
    tiles: [tile('wan', 1, 'm1'), tile('wan', 2, 'm2'), tile('wan', 3, 'm3')]
  }];
  game.players[0].hand = [tile('tong', 1, 'h1')];

  const html = testing.tableActions(game, game.players[0], game.players[0].hand[0]);
  assert.match(html, /来自南家 3万/);
});

test('tableActions 在二次确认阶段会显示确认打出文案', () => {
  const game = baseGame();
  game.actions = [{ type: 'discard', tileId: 'h1', label: '打出 1万' }];
  game.players[0].hand = [tile('wan', 1, 'h1')];
  testing.state.selectedTileId = 'h1';
  testing.state.confirmDiscardTileId = 'h1';

  const html = testing.tableActions(game, game.players[0], game.players[0].hand[0]);
  assert.match(html, /确认打出 1万/);

  testing.state.selectedTileId = '';
  testing.state.confirmDiscardTileId = '';
});

test('tableActions 在确认出牌阶段会显示取消确认入口和滑动提示', () => {
  const game = baseGame();
  game.actions = [{ type: 'discard', tileId: 'h1', label: '打出 1万' }];
  game.players[0].hand = [tile('wan', 1, 'h1'), tile('wan', 2, 'h2')];
  testing.state.selectedTileId = 'h1';
  testing.state.confirmDiscardTileId = 'h1';

  const html = testing.tableActions(game, game.players[0], game.players[0].hand[0]);
  assert.match(html, /取消确认/);
  assert.match(html, /横向滑动可查看更多手牌/);
  assert.match(html, /hand-scroll-wrap/);

  testing.state.selectedTileId = '';
  testing.state.confirmDiscardTileId = '';
});

test('gameView 会显示新摸牌标签和提示条', () => {
  const game = baseGame();
  game.actions = [{ type: 'discard', tileId: 'd1', label: '打出 1筒' }];
  game.players[0].hand = [tile('tong', 1, 'd1')];
  game.players[0].drawnTileId = 'd1';
  testing.state.game = game;
  testing.state.notice = '再次点击确认出牌';

  const html = testing.gameView();
  assert.match(html, /新摸/);
  assert.match(html, /再次点击确认出牌/);
});

test('roomView 会显示在线人数、我的状态和累计战绩领先者', () => {
  testing.state.screen = 'room';
  testing.state.roomCode = 'ABCD';
  testing.state.playerId = 'self';
  testing.state.room = {
    code: 'ABCD',
    hostId: 'self',
    players: [
      { id: 'self', name: '自己', ready: true, online: true, role: '庄家', seatName: '东' },
      { id: 'p1', name: '南家', ready: false, online: false, role: '闲家', seatName: '南' }
    ],
    standings: [
      { name: '自己', totalScore: 16 },
      { name: '南家', totalScore: -8 }
    ]
  };

  const html = testing.roomView();
  assert.match(html, /在线人数/);
  assert.match(html, /2\/2|1\/2/);
  assert.match(html, /房主 · 庄家 · 东位 · 已准备 · 在线/);
  assert.match(html, /当前领先/);
  assert.match(html, /自己 · 16 分/);

  testing.resetRoomState();
});

test('gameView 会显示当前操作者和庄家摘要', () => {
  const game = baseGame();
  game.currentSeat = 1;
  game.canAct = false;
  game.players[0].hand = [tile('wan', 1, 'h1')];
  testing.state.game = game;
  testing.state.mode = 'room';
  testing.state.roomCode = 'ABCD';

  const html = testing.gameView();
  assert.match(html, /等待 南家/);
  assert.match(html, /当前操作者/);
  assert.match(html, /南家/);
  assert.match(html, /庄家/);
  assert.match(html, /自己/);
  assert.match(html, /当前操作者/);

  testing.resetRoomState();
});

test('首页会显示单机调试面板和战绩摘要', () => {
  testing.state.soloHistory = [{
    gameId: 'g1',
    rounds: 1,
    wins: 1,
    dealerWins: 1,
    caiTiles: 3,
    caiPiaoHits: 1,
    totalScore: 16
  }];
  const summary = testing.soloSummary();

  assert.equal(summary.rounds, 1);
  assert.equal(summary.winRate, 100);
  assert.equal(summary.dealerWinRate, 100);
  assert.equal(summary.averageCai, '3.0');
});

test('withRoomRequest 会把房间错误写回 state.error', async () => {
  testing.state.error = '';

  const result = await testing.withRoomRequest(async () => {
    throw new Error('房间已满');
  });

  assert.equal(result, null);
  assert.equal(testing.state.error, '房间已满');
});

test('cancelDiscardConfirmation 会清空确认状态并写入提示', () => {
  testing.state.confirmDiscardTileId = 'h1';
  testing.state.notice = '';

  testing.cancelDiscardConfirmation();

  assert.equal(testing.state.confirmDiscardTileId, '');
  assert.equal(testing.state.notice, '已取消本次出牌确认，可重新选牌。');

  testing.resetRoomState();
});

test('scheduleReconnect 会替换旧定时器并设置新的重连任务', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const calls = [];
  const cleared = [];

  globalThis.setTimeout = (handler, delay) => {
    const timer = { handler, delay };
    calls.push(timer);
    return timer;
  };
  globalThis.clearTimeout = (timer) => {
    cleared.push(timer);
  };

  try {
    testing.resetReconnectState();
    testing.state.reconnectTimer = { old: true };
    testing.scheduleReconnect();

    assert.equal(cleared.length, 1);
    assert.deepEqual(cleared[0], { old: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].delay, 1000);
    assert.equal(testing.state.reconnectTimer, calls[0]);
    assert.equal(testing.state.reconnectAttempts, 1);
  } finally {
    testing.resetReconnectState();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('reconnectDelay 会按指数退避增长并受上限约束', () => {
  assert.equal(testing.reconnectDelay(1), 1000);
  assert.equal(testing.reconnectDelay(2), 2000);
  assert.equal(testing.reconnectDelay(3), 4000);
  assert.equal(testing.reconnectDelay(4), 8000);
  assert.equal(testing.reconnectDelay(5), 10000);
  assert.equal(testing.reconnectDelay(6), 10000);
});

test('saveRoomSession 和 clearRoomSession 会维护本地房间会话', () => {
  const store = new Map();
  testing.setStorageBackend({
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    }
  });

  testing.state.roomCode = 'ABCD';
  testing.state.playerId = 'player-1';
  testing.state.sessionToken = 'token-1';
  testing.saveRoomSession();

  assert.deepEqual(JSON.parse(store.get('mahjongRoomSession')), {
    roomCode: 'ABCD',
    playerId: 'player-1',
    sessionToken: 'token-1'
  });

  testing.clearRoomSession();
  assert.equal(store.has('mahjongRoomSession'), false);

  testing.resetRoomState();
  testing.setStorageBackend({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {}
  });
});

test('restoreRoomSession 成功后会恢复房间状态并保留本地会话', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const store = new Map();
  const fetchCalls = [];

  class MockWebSocket {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
    }

    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    }

    close() {}
  }

  globalThis.fetch = async (path) => {
    fetchCalls.push(path);
    if (String(path).includes('/reconnect')) {
      return {
        ok: true,
        json: async () => ({
          room: {
            code: 'ABCD',
            players: [{ id: 'player-1', name: '自己' }],
            game: null
          }
        })
      };
    }
    return {
      ok: true,
      json: async () => ({
        code: 'ABCD',
        players: [{ id: 'player-1', name: '自己' }],
        game: null
      })
    };
  };
  globalThis.WebSocket = MockWebSocket;
  testing.setStorageBackend({
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    }
  });

  try {
    testing.state.roomCode = 'ABCD';
    testing.state.playerId = 'player-1';
    testing.state.sessionToken = 'token-1';
    testing.state.mode = null;
    testing.state.screen = 'home';
    testing.state.room = null;
    testing.state.game = null;

    const restored = await testing.restoreRoomSession();

    assert.equal(restored, true);
    assert.equal(testing.state.mode, 'room');
    assert.equal(testing.state.screen, 'room');
    assert.equal(testing.state.error, '');
    assert.equal(testing.state.room?.code, 'ABCD');
    assert.equal(testing.state.roomSocket, null);
    assert.notEqual(testing.state.timer, null);
    assert.deepEqual(JSON.parse(store.get('mahjongRoomSession')), {
      roomCode: 'ABCD',
      playerId: 'player-1',
      sessionToken: 'token-1'
    });
    assert.equal(fetchCalls.some((path) => String(path).includes('/reconnect')), true);
  } finally {
    testing.resetRoomState();
    testing.setStorageBackend({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    });
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('restoreRoomSession 失败后会清理失效会话并回到首页', async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const store = new Map();

  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ error: '会话失效' })
  });
  globalThis.WebSocket = undefined;
  testing.setStorageBackend({
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    }
  });
  store.set('mahjongRoomSession', JSON.stringify({
    roomCode: 'ABCD',
    playerId: 'player-1',
    sessionToken: 'token-1'
  }));

  try {
    testing.state.roomCode = 'ABCD';
    testing.state.playerId = 'player-1';
    testing.state.sessionToken = 'token-1';
    testing.state.mode = 'room';
    testing.state.screen = 'room';

    const restored = await testing.restoreRoomSession();

    assert.equal(restored, false);
    assert.equal(testing.state.mode, null);
    assert.equal(testing.state.screen, 'home');
    assert.equal(testing.state.roomCode, '');
    assert.equal(testing.state.playerId, '');
    assert.equal(testing.state.sessionToken, '');
    assert.equal(testing.state.error, '房间恢复失败，请重新加入');
    assert.equal(store.has('mahjongRoomSession'), false);
  } finally {
    testing.resetRoomState();
    testing.setStorageBackend({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    });
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('reconnectRoom 连续失败后会显示重试引导文案', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ error: '网络异常' })
  });

  try {
    testing.resetReconnectState();
    testing.state.roomCode = 'ABCD';
    testing.state.playerId = 'player-1';
    testing.state.sessionToken = 'token-1';

    for (let index = 0; index < 5; index += 1) {
      await testing.reconnectRoom();
    }

    assert.equal(testing.state.reconnectAttempts, 5);
    assert.match(testing.state.error, /10 秒后重试/);
    assert.match(testing.state.error, /返回首页后重新加入房间/);
  } finally {
    testing.resetRoomState();
    globalThis.fetch = originalFetch;
  }
});

test('gameView 会显示弱网轮询提示文案', () => {
  const game = baseGame();
  game.players[0].hand = [tile('wan', 1, 'h1')];
  testing.state.game = game;
  testing.state.error = '房间实时同步异常，已切回轮询，4 秒后重试';

  const html = testing.gameView();
  assert.match(html, /房间实时同步异常，已切回轮询，4 秒后重试/);

  testing.resetRoomState();
});

test('settlementView 会显示番型拆解、输赢来源和最近一局回放摘要', () => {
  const game = baseGame();
  game.phase = 'settlement';
  game.winnerSeat = 0;
  game.message = '自己自摸财神敲响，4翻';
  game.players[0].score = 48;
  game.players[1].score = -16;
  game.players[2].score = -16;
  game.players[3].score = -16;
  game.settlement = {
    type: '自摸',
    name: '财神敲响',
    fan: 4,
    caiCount: 3,
    caiPiao: 1,
    knocked: true,
    sevenPairs: false,
    base: 16,
    totalGain: 48,
    bankerMultiplier: 8
  };
  game.stats = { totalScore: 48, caiTiles: 3, caiPiaoHits: 1 };
  game.events = [
    { type: 'discard', tile: 'honor-bai' },
    { type: 'cai_piao', success: true, count: 1 },
    { type: 'win', winType: '自摸', fan: 4 }
  ];

  const html = testing.settlementView(game);
  assert.match(html, /番型拆解/);
  assert.match(html, /基础倍率 16/);
  assert.match(html, /三财胡额外 \+1 翻/);
  assert.match(html, /连续财飘额外 \+1 翻/);
  assert.match(html, /庄家倍率/);
  assert.match(html, /8 倍/);
  assert.match(html, /最近一局回放摘要/);
  assert.match(html, /财飘成立 · 第 1 次/);
  assert.match(html, /自摸 · 4翻/);
});

test('reconnectRoom 成功后会重置重连状态并显示恢复提示', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      room: {
        code: 'ABCD',
        players: [{ id: 'player-1', name: '自己' }],
        game: null
      }
    })
  });

  try {
    testing.state.roomCode = 'ABCD';
    testing.state.playerId = 'player-1';
    testing.state.sessionToken = 'token-1';
    testing.state.reconnectAttempts = 3;
    testing.state.notice = '';

    await testing.reconnectRoom();

    assert.equal(testing.state.reconnectAttempts, 0);
    assert.equal(testing.state.notice, '房间连接已恢复');
    assert.equal(testing.state.error, '');
  } finally {
    testing.resetRoomState();
    globalThis.fetch = originalFetch;
  }
});
