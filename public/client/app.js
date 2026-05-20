const app = typeof document !== 'undefined' ? document.querySelector('#app') : null;
let storageBackend = typeof localStorage !== 'undefined'
  ? localStorage
  : { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const storage = {
  getItem(key) {
    return storageBackend.getItem(key);
  },
  setItem(key, value) {
    return storageBackend.setItem(key, value);
  },
  removeItem(key) {
    return storageBackend.removeItem(key);
  }
};
const historyKey = 'mahjongSoloHistory';
const roomSessionKey = 'mahjongRoomSession';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;
const RECONNECT_GUIDANCE_THRESHOLD = 5;
const savedRoomSession = safeParse(storage.getItem(roomSessionKey), null);
const state = {
  screen: savedRoomSession?.roomCode ? 'room' : 'home',
  name: storage.getItem('mahjongName') || '玩家',
  mode: savedRoomSession?.roomCode ? 'room' : null,
  soloRaw: null,
  game: null,
  room: null,
  roomCode: savedRoomSession?.roomCode || '',
  playerId: savedRoomSession?.playerId || '',
  sessionToken: savedRoomSession?.sessionToken || '',
  selectedTileId: '',
  confirmDiscardTileId: '',
  cheatThreeBai: storage.getItem('mahjongCheatThreeBai') === '1',
  debugStartHand: storage.getItem('mahjongDebugStartHand') || '',
  debugDrawQueue: storage.getItem('mahjongDebugDrawQueue') || '',
  debugFixedCaiCount: Number(storage.getItem('mahjongDebugFixedCaiCount') || '0'),
  timer: null,
  roomSocket: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  soloHistory: safeParse(storage.getItem(historyKey), []),
  error: '',
  notice: ''
};

function safeParse(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function setNotice(message) {
  state.notice = message;
}

function clearNotice() {
  state.notice = '';
}

function showRoomError(error) {
  state.error = error instanceof Error ? error.message : String(error || '房间请求失败');
  render();
}

async function withRoomRequest(task) {
  try {
    const result = await task();
    state.error = '';
    return result;
  } catch (error) {
    showRoomError(error);
    return null;
  }
}

function saveSoloHistory() {
  storage.setItem(historyKey, JSON.stringify(state.soloHistory.slice(-20)));
}

function updateSoloHistory(game) {
  if (state.mode !== 'solo' || game.phase !== 'settlement' || !game.stats) return;
  const alreadySaved = state.soloHistory.some((item) => item.gameId === game.id);
  if (alreadySaved) return;
  state.soloHistory.push({
    gameId: game.id,
    endedAt: Date.now(),
    message: game.message,
    ...game.stats
  });
  saveSoloHistory();
}

function soloSummary() {
  const entries = state.soloHistory;
  if (entries.length === 0) return { rounds: 0, winRate: 0, dealerWinRate: 0, averageCai: 0, caiPiaoHits: 0, totalScore: 0 };
  const totals = entries.reduce((sum, item) => ({
    rounds: sum.rounds + item.rounds,
    wins: sum.wins + item.wins,
    dealerWins: sum.dealerWins + item.dealerWins,
    caiTiles: sum.caiTiles + item.caiTiles,
    caiPiaoHits: sum.caiPiaoHits + item.caiPiaoHits,
    totalScore: sum.totalScore + item.totalScore
  }), { rounds: 0, wins: 0, dealerWins: 0, caiTiles: 0, caiPiaoHits: 0, totalScore: 0 });
  return {
    rounds: totals.rounds,
    winRate: Math.round((totals.wins / totals.rounds) * 100),
    dealerWinRate: Math.round((totals.dealerWins / totals.rounds) * 100),
    averageCai: (totals.caiTiles / totals.rounds).toFixed(1),
    caiPiaoHits: totals.caiPiaoHits,
    totalScore: totals.totalScore
  };
}

const api = async (path, options = {}) => {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
};

function tileText(tile) {
  const honors = { east: '东', south: '南', west: '西', north: '北', zhong: '中', fa: '发', bai: '白' };
  if (tile.suit === 'honor') return honors[tile.rank];
  const labels = { wan: '万', tiao: '条', tong: '筒' };
  return `${tile.rank}${labels[tile.suit]}`;
}

function tileClass(tile) {
  const classes = ['tile-face'];
  if (tile.suit === 'wan' || tile.rank === 'zhong') classes.push('red');
  if (tile.suit === 'tiao' || tile.rank === 'fa') classes.push('green');
  if (tile.suit === 'tong' || ['east', 'south', 'west', 'north'].includes(tile.rank)) classes.push('blue');
  if (tile.rank === 'bai') classes.push('cai');
  return classes.join(' ');
}

function tileAssetName(tile) {
  if (tile.suit === 'honor') return `honor-${tile.rank}`;
  return `${tile.suit}-${tile.rank}`;
}

function saveName() {
  storage.setItem('mahjongName', state.name.trim() || '玩家');
}

function saveRoomSession() {
  if (!state.roomCode || !state.playerId || !state.sessionToken) return;
  storage.setItem(roomSessionKey, JSON.stringify({
    roomCode: state.roomCode,
    playerId: state.playerId,
    sessionToken: state.sessionToken
  }));
}

function clearRoomSession() {
  storage.removeItem(roomSessionKey);
}

function resetRoomState() {
  stopPolling();
  closeRoomSocket();
  resetReconnectState();
  state.mode = null;
  state.game = null;
  state.room = null;
  state.roomCode = '';
  state.playerId = '';
  state.sessionToken = '';
}

function setScreen(screen) {
  state.screen = screen;
  render();
}

function stopPolling() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function closeRoomSocket() {
  if (state.roomSocket) state.roomSocket.close();
  state.roomSocket = null;
}

function stopReconnect() {
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}

function reconnectDelay(attempt) {
  return Math.min(RECONNECT_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1)), RECONNECT_MAX_DELAY_MS);
}

function resetReconnectState() {
  stopReconnect();
  state.reconnectAttempts = 0;
}

function scheduleReconnect() {
  stopReconnect();
  state.reconnectAttempts += 1;
  const delay = reconnectDelay(state.reconnectAttempts);
  state.reconnectTimer = setTimeout(reconnectRoom, delay);
  return delay;
}

function reconnectGuidance() {
  return state.reconnectAttempts >= RECONNECT_GUIDANCE_THRESHOLD ? '。如长时间未恢复，请返回首页后重新加入房间' : '';
}

function updateRoomState(data) {
  state.room = data;
  state.error = '';
  saveRoomSession();
  if (data.game) {
    state.game = data.game;
    state.screen = 'game';
  }
  render();
}

function roomPlayer() {
  return state.room?.players?.find((player) => player.id === state.playerId) || null;
}

async function startSolo() {
  saveName();
  clearRoomSession();
  storage.setItem('mahjongCheatThreeBai', state.cheatThreeBai ? '1' : '0');
  storage.setItem('mahjongDebugStartHand', state.debugStartHand);
  storage.setItem('mahjongDebugDrawQueue', state.debugDrawQueue);
  storage.setItem('mahjongDebugFixedCaiCount', String(state.debugFixedCaiCount));
  stopPolling();
  closeRoomSocket();
  clearNotice();
  const data = await api('/api/solo', {
    method: 'POST',
    body: JSON.stringify({
      name: state.name,
      cheatThreeBai: state.cheatThreeBai,
      startHand: state.debugStartHand,
      drawQueue: state.debugDrawQueue,
      fixedCaiCount: state.debugFixedCaiCount
    })
  });
  state.mode = 'solo';
  state.playerId = data.playerId;
  state.game = data.game;
  state.soloRaw = data.raw;
  state.selectedTileId = '';
  state.confirmDiscardTileId = '';
  setScreen('game');
}

async function createRoom() {
  saveName();
  clearNotice();
  const data = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: state.name }) });
  state.mode = 'room';
  state.roomCode = data.code;
  state.playerId = data.playerId;
  state.sessionToken = data.sessionToken;
  saveRoomSession();
  setScreen('room');
  connectRoom();
}

async function joinRoom() {
  saveName();
  const code = document.querySelector('#roomCode')?.value.trim();
  if (!code) {
    state.error = '请输入房间号';
    render();
    return;
  }
  try {
    const data = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ name: state.name }) });
    state.error = '';
    state.mode = 'room';
    state.roomCode = data.code;
    state.playerId = data.playerId;
    state.sessionToken = data.sessionToken;
    saveRoomSession();
    setScreen('room');
    connectRoom();
  } catch (error) {
    state.error = error.message;
    render();
  }
}

async function startRoomGame() {
  clearNotice();
  await withRoomRequest(async () => {
    await api(`/api/rooms/${state.roomCode}/start`, { method: 'POST', body: JSON.stringify(roomAuth()) });
    await pollRoom();
  });
}

async function setReady(ready) {
  await withRoomRequest(() => api(`/api/rooms/${state.roomCode}/ready`, { method: 'POST', body: JSON.stringify(roomAuth({ ready })) }));
}

async function reconnectRoom() {
  if (!state.roomCode || !state.playerId || !state.sessionToken) return;
  try {
    const data = await api(`/api/rooms/${state.roomCode}/reconnect`, { method: 'POST', body: JSON.stringify(roomAuth()) });
    updateRoomState(data.room);
    if (state.reconnectAttempts > 0) setNotice('房间连接已恢复');
    resetReconnectState();
    connectRoom();
  } catch (error) {
    const delay = scheduleReconnect();
    state.error = `${error.message}，${Math.round(delay / 1000)} 秒后重试${reconnectGuidance()}`;
    render();
  }
}

async function restoreRoomSession() {
  if (!state.roomCode || !state.playerId || !state.sessionToken) return false;
  state.mode = 'room';
  state.screen = 'room';
  state.error = '正在恢复房间会话';
  render();
  try {
    const data = await api(`/api/rooms/${state.roomCode}/reconnect`, { method: 'POST', body: JSON.stringify(roomAuth()) });
    updateRoomState(data.room);
    connectRoom();
    return true;
  } catch {
    clearRoomSession();
    resetRoomState();
    state.screen = 'home';
    state.error = '房间恢复失败，请重新加入';
    render();
    return false;
  }
}

function startPolling() {
  stopPolling();
  void pollRoom();
  state.timer = setInterval(() => {
    void pollRoom();
  }, 1200);
}

function roomSocketUrl() {
  if (typeof window === 'undefined') return '';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/rooms/${state.roomCode}?playerId=${encodeURIComponent(state.playerId)}&sessionToken=${encodeURIComponent(state.sessionToken)}`;
}

function connectRoom() {
  closeRoomSocket();
  stopPolling();
  stopReconnect();
  void pollRoom();
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined' || !state.roomCode || !state.playerId || !state.sessionToken) {
    startPolling();
    return;
  }
  const socket = new WebSocket(roomSocketUrl());
  state.roomSocket = socket;
  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'room_state') updateRoomState(payload.room);
  });
  socket.addEventListener('open', () => {
    if (state.reconnectAttempts > 0) setNotice('实时同步已恢复');
    state.error = '';
    resetReconnectState();
    render();
  });
  socket.addEventListener('close', () => {
    if (state.roomSocket === socket) {
      state.roomSocket = null;
      const delay = scheduleReconnect();
      state.error = `房间连接已断开，${Math.round(delay / 1000)} 秒后重试${reconnectGuidance()}`;
      startPolling();
      render();
    }
  });
  socket.addEventListener('error', () => {
    if (state.roomSocket === socket) {
      state.roomSocket = null;
      const delay = scheduleReconnect();
      state.error = `房间实时同步异常，已切回轮询，${Math.round(delay / 1000)} 秒后重试${reconnectGuidance()}`;
      startPolling();
      render();
    }
  });
}

async function pollRoom() {
  if (state.mode !== 'room' || !state.roomCode) return;
  const query = new URLSearchParams(roomAuth()).toString();
  await withRoomRequest(async () => {
    const data = await api(`/api/rooms/${state.roomCode}?${query}`);
    updateRoomState(data);
  });
}

async function act(action, tileId = '') {
  const actionDef = state.game?.actions?.find((item) => item.type === action && (!tileId || item.tileId === tileId));
  if (!actionDef && action !== 'discard') {
    setNotice('当前动作不可用，请等待轮到你或重新选择。');
    render();
    return;
  }
  clearNotice();
  if (state.mode === 'solo') {
    const data = await api('/api/solo/action', {
      method: 'POST',
      body: JSON.stringify({ game: state.soloRaw, action, tileId, tileIds: actionDef?.tileIds || [] })
    });
    state.game = data.game;
    state.soloRaw = data.raw;
  } else {
    const data = await withRoomRequest(() => api(`/api/rooms/${state.roomCode}/action`, {
      method: 'POST',
      body: JSON.stringify(roomAuth({ action, tileId, tileIds: actionDef?.tileIds || [] }))
    }));
    if (!data) return;
    state.game = data.game;
  }
  state.selectedTileId = '';
  state.confirmDiscardTileId = '';
  render();
}

function requestDiscardConfirmation() {
  if (!state.selectedTileId) {
    setNotice('先选中一张手牌，再确认出牌。');
    render();
    return;
  }
  if (state.confirmDiscardTileId === state.selectedTileId) {
    act('discard', state.selectedTileId);
    return;
  }
  state.confirmDiscardTileId = state.selectedTileId;
  setNotice(`再次点击“确认打出”即可打出 ${selectedTileText()}`);
  render();
}

function cancelDiscardConfirmation() {
  state.confirmDiscardTileId = '';
  setNotice('已取消本次出牌确认，可重新选牌。');
  render();
}

function selectedTileText() {
  const self = state.game?.players?.[state.game.viewerSeat];
  const selected = self?.hand.find((tile) => tile.id === state.selectedTileId);
  return selected ? tileText(selected) : '';
}

function homeView() {
  const summary = soloSummary();
  return `<section class="shell hero">
    <div>
      <p class="badge">手机网页直接玩</p>
      <h1 class="title">杭州<br>麻将</h1>
      <p class="subtitle">杭州麻将 MVP，白板作财神，无点炮。打出白板后，下一次摸任意牌能胡则自动记为连续财飘。</p>
    </div>
    <div class="panel stack">
      <input value="${state.name}" id="name" maxlength="12" placeholder="输入昵称">
      <label class="cheat-toggle">
        <input type="checkbox" id="cheatThreeBai" ${state.cheatThreeBai ? 'checked' : ''}>
        <span>单机作弊：起手 3 张白板财神</span>
      </label>
      <div class="panel stack debug-panel">
        <div class="name">单机调试面板</div>
        <input value="${state.debugStartHand}" id="debugStartHand" placeholder="起手牌，如 wan-1 wan-2 wan-3 honor-bai">
        <input value="${state.debugDrawQueue}" id="debugDrawQueue" placeholder="摸牌队列，如 honor-bai tong-9 wan-3">
        <input value="${state.debugFixedCaiCount}" id="debugFixedCaiCount" type="number" min="0" max="4" placeholder="固定财神张数 0-4">
      </div>
      <div class="panel stack debug-panel">
        <div class="name">单机战绩</div>
        <div class="score-item"><span>对局数</span><strong>${summary.rounds}</strong></div>
        <div class="score-item"><span>胜率</span><strong>${summary.winRate}%</strong></div>
        <div class="score-item"><span>庄家胜率</span><strong>${summary.dealerWinRate}%</strong></div>
        <div class="score-item"><span>平均财神数</span><strong>${summary.averageCai}</strong></div>
        <div class="score-item"><span>财飘累计</span><strong>${summary.caiPiaoHits}</strong></div>
        <div class="score-item"><span>总分</span><strong>${summary.totalScore}</strong></div>
      </div>
      <button id="solo">单机开局</button>
      <button class="secondary" id="create">创建好友房</button>
      <div class="row">
        <input id="roomCode" inputmode="numeric" maxlength="6" placeholder="输入房间号">
        <button class="ghost" id="join">加入</button>
      </div>
      ${state.error ? `<p class="meta">${state.error}</p>` : ''}
    </div>
  </section>`;
}

function roomPlayerStatus(player, room) {
  const tags = [];
  if (player.id === room.hostId) tags.push('房主');
  if (player.role) tags.push(player.role);
  if (player.seatName) tags.push(`${player.seatName}位`);
  tags.push(player.ready ? '已准备' : '未准备');
  tags.push(player.online ? '在线' : '离线');
  return tags.join(' · ');
}

function standingsSummary(standings = []) {
  if (standings.length === 0) return '<div class="meta">暂无累计战绩</div>';
  const leader = [...standings].sort((a, b) => b.totalScore - a.totalScore)[0];
  return `<div class="score-item score-highlight"><span>当前领先</span><strong>${leader.name} · ${leader.totalScore} 分</strong></div>`;
}

function settlementBreakdown(settlement) {
  if (!settlement) return [];
  const items = [
    `${settlement.name} ${settlement.fan}翻`,
    `基础倍率 ${settlement.base}`,
    `财神 ${settlement.caiCount} 张`,
    `财飘 ${settlement.caiPiao} 次`
  ];
  if (settlement.knocked) items.push('敲响成立');
  if (settlement.sevenPairs) items.push('七小对子成型');
  if (settlement.caiCount === 3) items.push('三财胡额外 +1 翻');
  if (settlement.caiCount >= 4) items.push('四财胡额外 +2 翻');
  if (settlement.caiPiao > 0) items.push(`连续财飘额外 +${Math.min(settlement.caiPiao, 2)} 翻`);
  return items;
}

function replayLabel(event) {
  if (event.type === 'discard') return `出牌 · ${event.tile || ''}`;
  if (event.type === 'draw') return `摸牌 · ${event.tile || ''}`;
  if (event.type === 'meld') return `${event.meldType || '副露'} · ${event.tile || ''}`;
  if (event.type === 'pass') return `过牌 · ${event.tile || ''}`;
  if (event.type === 'cai_piao') return event.success ? `财飘成立 · 第 ${event.count || 0} 次` : '财飘中断';
  if (event.type === 'win') return `${event.winType || '胡牌'} · ${event.fan || 0}翻`;
  if (event.type === 'draw_game') return '流局';
  if (event.type === 'knock') return '敲响';
  return `${event.type} · ${event.tile || event.reason || ''}`;
}

function replaySummary(events = [], limit = 8) {
  if (!events.length) return '';
  return `<div class="panel replay-panel"><div class="name">最近一局回放摘要</div>${events.slice(-limit).map((event) => `<div class="meta">${replayLabel(event)}</div>`).join('')}</div>`;
}

function roomView() {
  const room = state.room;
  const players = room?.players || [];
  const me = roomPlayer();
  const isHost = state.playerId && room?.hostId === state.playerId;
  const allReady = players.length > 0 && players.every((player) => player.ready);
  const onlineCount = players.filter((player) => player.online).length;
  return `<section class="shell stack">
    <div class="topbar">
      <button class="ghost" id="back">返回</button>
      <span class="badge">房间 ${state.roomCode}</span>
    </div>
    <div class="panel stack">
      <h2>等待玩家入座</h2>
      <p class="subtitle">把房间号发给朋友。首版支持游客加入，人数不足时也可以开始，系统会用 AI 补位。</p>
      <div class="room-summary-grid">
        <div class="score-item"><span>在线人数</span><strong>${onlineCount}/${players.length || 4}</strong></div>
        <div class="score-item"><span>我的状态</span><strong>${me ? roomPlayerStatus(me, room) : '等待同步'}</strong></div>
      </div>
      <div class="stack">${players.map((p, i) => `<div class="score-item"><span>${i + 1}. ${p.name}</span><strong>${roomPlayerStatus(p, room)}</strong></div>`).join('')}</div>
      <div class="score-item"><span>补位 AI</span><strong>开启</strong></div>
      <div class="panel stack standings-panel">
        <div class="name">累计战绩</div>
        ${standingsSummary(room?.standings || [])}
        <div class="score-list">${(room?.standings || []).map((item) => `<div class="score-item"><span>${item.name}</span><strong>${item.totalScore} 分</strong></div>`).join('')}</div>
      </div>
      <div class="actions">
        <button id="toggleReady" class="ghost">${me?.ready ? '取消准备' : '准备'}</button>
        <button id="startRoom" ${!isHost || !allReady ? 'disabled' : ''}>开始游戏</button>
      </div>
      ${state.error ? `<p class="meta">${state.error}</p>` : ''}
    </div>
  </section>`;
}

function playerCard(player, active, place = '') {
  const tags = [`${player.handCount} 张`, `${player.score} 分`];
  if (player.role) tags.unshift(player.role);
  if (active) tags.push('当前');
  const rackCount = Math.min(Math.max(player.handCount || 0, 0), 14);
  const rackClass = place === 'seat-left' || place === 'seat-right' ? 'vertical' : 'horizontal';
  return `<div class="player-card ${active ? 'active' : ''} ${place}">
    <div class="player-head">
      <div class="player-ident">
        <div class="player-avatar">${player.name.slice(0, 1)}</div>
        <div>
          <div class="name">${player.name}</div>
          <div class="meta">${tags.join(' · ')}</div>
        </div>
      </div>
      <div class="seat-mark">${player.seatName}</div>
    </div>
    <div class="player-rack ${rackClass}">${Array.from({ length: rackCount }, () => '<span></span>').join('')}</div>
    <div class="meta">财飘 ${player.caiPiao}${player.knocked ? ' · 敲响' : ''}</div>
    <div class="melds">${player.melds.map((meld) => `<span>${meld.tiles.map(tileText).join('')}</span>`).join('')}</div>
  </div>`;
}

function discardRiver(game) {
  return game.players.map((player) => `<div class="river river-${player.seat}">
    <div class="river-label">${player.seatName}家弃牌</div>
    <div class="river-tiles">${player.discards.map((tile) => `<span class="mini-tile ${tile.rank === 'bai' ? 'cai' : ''}">${tileText(tile)}</span>`).join('')}</div>
  </div>`).join('');
}

function discardZone(player, extraClass = '') {
  return `<section class="diagram-zone ${extraClass}">
    <div class="diagram-zone-label">${player.seatName}家</div>
    <div class="diagram-zone-tiles">${player.discards.map((tile) => `<span class="mini-tile ${tile.rank === 'bai' ? 'cai' : ''}">${tileText(tile)}</span>`).join('') || '<span class="diagram-empty">暂无弃牌</span>'}</div>
  </section>`;
}

function meldZone(player, extraClass = '') {
  return `<section class="diagram-meld-zone ${extraClass}">
    <div class="diagram-zone-label">${player.seatName}家副露</div>
    <div class="diagram-zone-tiles">${player.melds.map((meld) => `<span>${meld.tiles.map(tileText).join(' ')}</span>`).join('') || '<span class="diagram-empty">暂无副露</span>'}</div>
  </section>`;
}

function gameView() {
  const game = state.game;
  const self = game.players[game.viewerSeat];
  const topPlayer = game.players[(game.viewerSeat + 2) % 4];
  const leftPlayer = game.players[(game.viewerSeat + 3) % 4];
  const rightPlayer = game.players[(game.viewerSeat + 1) % 4];
  const selected = self?.hand.find((tile) => tile.id === state.selectedTileId);
  const canSelfHu = game.actions.some((action) => action.type === 'hu');
  const currentPlayer = game.players[game.currentSeat];
  return `<section class="shell table">
    <div class="topbar">
      <button class="ghost topbar-button" id="back">首页</button>
      <div class="topbar-badges">
        <span class="badge topbar-badge">${state.mode === 'room' ? `房间 ${state.roomCode}` : '单机模式'}</span>
        <span class="badge topbar-badge">余牌 ${game.wallCount}</span>
        <span class="badge topbar-badge">当前操作者 ${currentPlayer?.name || '结算中'}</span>
      </div>
    </div>
    <div class="diagram-layout panel">
      <div class="diagram-statusbar">
      <div class="diagram-status-main">
          <div class="message">${game.message}</div>
          <div class="meta">${game.canAct ? '你可以操作' : `等待 ${currentPlayer?.name || '结算中'}`}</div>
        </div>
        <div class="diagram-status-metrics">
          <span class="diagram-chip">庄家 ${game.players.find((player) => player.role === '庄家')?.name || '未知'}</span>
          <span class="diagram-chip">财神 白板</span>
          <span class="diagram-chip">余牌 ${game.wallCount}</span>
        </div>
      </div>
      <div class="diagram-board-shell">
        <div class="diagram-player-top">${playerCard(topPlayer, topPlayer.seat === game.currentSeat, 'seat-top')}</div>
        <div class="diagram-player-left">${playerCard(leftPlayer, leftPlayer.seat === game.currentSeat, 'seat-left')}</div>
        <div class="diagram-player-right">${playerCard(rightPlayer, rightPlayer.seat === game.currentSeat, 'seat-right')}</div>
        <div class="diagram-meld-top-left">${meldZone(leftPlayer)}</div>
        <div class="diagram-meld-top-right">${meldZone(topPlayer)}</div>
        <div class="diagram-meld-bottom-left">${meldZone(self)}</div>
        <div class="diagram-meld-bottom-right">${meldZone(rightPlayer)}</div>
        <div class="diagram-board-core">
          ${discardZone(topPlayer, 'zone-top')}
          ${discardZone(leftPlayer, 'zone-left')}
          <div class="diagram-center-core">
            <div class="diagram-core-box">
              <span class="wind north">北</span>
              <span class="wind west">西</span>
              <div class="diagram-core-disc">
                <span>骰子区</span>
                <strong>${game.players.find((player) => player.role === '庄家')?.seatName || '东'}</strong>
              </div>
              <span class="wind east">东</span>
              <span class="wind south">南</span>
            </div>
          </div>
          ${discardZone(rightPlayer, 'zone-right')}
          <div class="diagram-bottom-zones">
            ${discardZone(self, 'zone-bottom-primary')}
            <section class="diagram-zone zone-bottom-secondary">
              <div class="diagram-zone-label">状态</div>
              <div class="diagram-zone-tiles zone-summary">${canSelfHu ? '<span>可胡</span>' : ''}${self.waitingCaiPiao ? '<span>财飘</span>' : ''}<span>${self.hand.length} 张</span></div>
            </section>
          </div>
        </div>
      </div>
    </div>
    <div class="mobile-table-meta stack">
      <div class="log panel">${game.log.map((line) => `<div>${line}</div>`).join('')}</div>
      ${game.phase === 'settlement' ? '' : replaySummary(game.events)}
      ${state.error ? `<div class="notice panel">${state.error}</div>` : ''}
      ${state.notice ? `<div class="notice panel">${state.notice}</div>` : ''}
    </div>
    ${game.phase === 'settlement' ? settlementView(game) : tableActions(game, self, selected)}
  </section>`;
}

function tableActions(game, self, selected) {
  const responseActions = game.actions.filter((action) => action.type !== 'discard' && action.type !== 'hu');
  const hasDiscard = game.actions.some((action) => action.type === 'discard');
  const canSelfHu = game.actions.some((action) => action.type === 'hu');
  const discardReady = state.confirmDiscardTileId && state.confirmDiscardTileId === state.selectedTileId;
  return `<div class="panel action-panel">
    <div class="hand-header">
      <div>
        <div class="name">${self.name} 的手牌</div>
        <div class="meta">${self.role} · 财飘 ${self.caiPiao}</div>
      </div>
      <div class="action-summary-badges">
        <span class="badge">手牌 ${self.hand.length} 张</span>
        ${canSelfHu ? '<span class="badge">可胡</span>' : ''}
      </div>
    </div>
    ${canSelfHu ? '<div class="action-tip strong">你当前可以自摸胡</div>' : ''}
    ${self.waitingCaiPiao ? '<div class="action-tip">你已进入财飘等待</div>' : ''}
    <div class="exposed-area">
      <div class="area-label">吃碰杠区</div>
      <div class="meld-row">${self.melds.length ? self.melds.map((meld) => `<span><b>${meld.type === 'chi' ? '吃' : meld.type === 'pong' ? '碰' : '杠'}</b>${meld.tiles.map(tileText).join(' ')}<small> 来自${['东','南','西','北'][meld.fromSeat] || ''}家 ${meld.sourceTile ? tileText(meld.sourceTile) : ''}</small></span>`).join('') : '<em>暂无副露</em>'}</div>
    </div>
    <div class="draw-tip">横向滑动可查看更多手牌。</div>
    <div class="hand-scroll-wrap"><div class="hand">${self.hand.map((tile) => `<button class="tile ${tileClass(tile)} ${tile.id === self.drawnTileId ? 'drawn' : ''} ${tile.id === state.selectedTileId ? 'selected' : ''}" data-tile="${tile.id}" data-asset="${tileAssetName(tile)}"><span>${tileText(tile)}</span>${tile.rank === 'bai' ? '<small>财</small>' : ''}${tile.id === self.drawnTileId ? '<i>新摸</i>' : ''}</button>`).join('')}</div></div>
    <div class="actions action-deck">
      <button id="discard" ${!hasDiscard || !selected ? 'disabled' : ''}>${discardReady ? `确认打出 ${selected ? tileText(selected) : ''}` : `准备打出${selected ? ` ${tileText(selected)}` : ''}`}</button>
      <button class="secondary" data-action="hu" ${!canSelfHu ? 'disabled' : ''}>自摸胡</button>
      ${discardReady ? '<button id="cancelDiscard" class="ghost">取消确认</button>' : ''}
      ${responseActions.map((action) => `<button class="ghost" data-action="${action.type}">${action.label}</button>`).join('')}
    </div>
  </div>`;
}

function settlementView(game) {
  updateSoloHistory(game);
  const winner = game.winnerSeat == null ? null : game.players[game.winnerSeat];
  const breakdown = settlementBreakdown(game.settlement);
  return `<div class="panel settlement">
    <h2>${game.message}</h2>
    <p class="subtitle">${game.settlement ? `${game.settlement.name}，${game.settlement.fan}翻，财神${game.settlement.caiCount}张，连续财飘${game.settlement.caiPiao}次。庄家参与输赢按 8 倍结算。` : '白板作财神参与胡牌；打出白板后，下一次摸牌能胡才累计连续财飘。'}</p>
    ${game.settlement ? `<div class="score-list settlement-summary-grid"><div class="score-item score-highlight"><span>胡牌玩家</span><strong>${winner?.name || '未知'}</strong></div><div class="score-item"><span>赢得总分</span><strong>${game.settlement.totalGain} 分</strong></div><div class="score-item"><span>胡牌方式</span><strong>${game.settlement.type}</strong></div><div class="score-item"><span>庄家倍率</span><strong>${game.settlement.bankerMultiplier} 倍</strong></div></div>` : ''}
    ${breakdown.length ? `<div class="panel stack settlement-breakdown"><div class="name">番型拆解</div><div class="settlement-tags">${breakdown.map((item) => `<span>${item}</span>`).join('')}</div><div class="meta">输赢来源按基础倍率、庄家倍率、财神附加和财飘附加共同结算。</div></div>` : ''}
    ${game.stats ? `<div class="score-list"><div class="score-item"><span>本局总分</span><strong>${game.stats.totalScore}</strong></div><div class="score-item"><span>本局财神数</span><strong>${game.stats.caiTiles}</strong></div><div class="score-item"><span>本局财飘次数</span><strong>${game.stats.caiPiaoHits}</strong></div></div>` : ''}
    <div class="score-list">${game.players.map((p) => `<div class="score-item"><span>${p.name}</span><strong>${p.score} 分</strong></div>`).join('')}</div>
    ${replaySummary(game.events, 12)}
    <button id="newGame">再来一局</button>
  </div>`;
}

function bind() {
  document.querySelector('#name')?.addEventListener('input', (event) => { state.name = event.target.value; });
  document.querySelector('#cheatThreeBai')?.addEventListener('change', (event) => { state.cheatThreeBai = event.target.checked; });
  document.querySelector('#debugStartHand')?.addEventListener('input', (event) => { state.debugStartHand = event.target.value; });
  document.querySelector('#debugDrawQueue')?.addEventListener('input', (event) => { state.debugDrawQueue = event.target.value; });
  document.querySelector('#debugFixedCaiCount')?.addEventListener('input', (event) => { state.debugFixedCaiCount = Math.max(0, Math.min(Number(event.target.value || '0'), 4)); });
  document.querySelector('#solo')?.addEventListener('click', startSolo);
  document.querySelector('#create')?.addEventListener('click', createRoom);
  document.querySelector('#join')?.addEventListener('click', joinRoom);
  document.querySelector('#startRoom')?.addEventListener('click', startRoomGame);
  document.querySelector('#toggleReady')?.addEventListener('click', () => setReady(!roomPlayer()?.ready));
  document.querySelector('#back')?.addEventListener('click', () => {
    clearRoomSession();
    resetRoomState();
    state.screen = 'home';
    render();
  });
  document.querySelector('#discard')?.addEventListener('click', requestDiscardConfirmation);
  document.querySelector('#cancelDiscard')?.addEventListener('click', cancelDiscardConfirmation);
  document.querySelectorAll('[data-action]').forEach((el) => el.addEventListener('click', () => act(el.dataset.action)));
  document.querySelector('#newGame')?.addEventListener('click', () => state.mode === 'solo' ? startSolo() : startRoomGame());
  document.querySelectorAll('[data-tile]').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedTileId = el.dataset.tile === state.selectedTileId ? '' : el.dataset.tile;
      if (state.confirmDiscardTileId && state.confirmDiscardTileId !== state.selectedTileId) state.confirmDiscardTileId = '';
      render();
    });
  });
}

function render() {
  if (!app) return;
  if (state.screen === 'home') app.innerHTML = homeView();
  if (state.screen === 'room') app.innerHTML = roomView();
  if (state.screen === 'game') app.innerHTML = gameView();
  bind();
}

if (app) {
  render();
  if (state.mode === 'room' && state.roomCode && state.playerId && state.sessionToken) void restoreRoomSession();
}

export const testing = {
  clearRoomSession,
  reconnectDelay,
  resetReconnectState,
  resetRoomState,
  restoreRoomSession,
  saveRoomSession,
  soloSummary,
  setStorageBackend(backend) {
    storageBackend = backend;
  },
  updateSoloHistory,
  updateRoomState,
  withRoomRequest,
  showRoomError,
  scheduleReconnect,
  reconnectRoom,
  roomPlayer,
  roomView,
  roomSocketUrl,
  tileText,
  tileClass,
  replaySummary,
  tableActions,
  cancelDiscardConfirmation,
  settlementView,
  gameView,
  state
};
function roomAuth(extra = {}) {
  return { playerId: state.playerId, sessionToken: state.sessionToken, ...extra };
}
