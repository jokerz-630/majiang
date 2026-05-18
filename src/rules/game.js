import crypto from 'node:crypto';
import { canClaimSequence, canWin, classifyWin, countSameTile } from './win.js';
import { allTileTypes, isCai, isNumberTile, makeTiles, seatNames, sortHand, tileKey, tileName } from '../shared/tiles.js';

function pushEvent(game, type, payload = {}) {
  game.events.push({
    id: `${type}-${game.events.length + 1}`,
    type,
    at: Date.now(),
    ...payload
  });
}

function setMessage(game, message) {
  game.message = message;
  game.log.push(message);
}

function tileFromKey(key, suffix) {
  const [suit, rank] = key.split('-');
  if (!suit || !rank) return null;
  return { suit, rank: suit === 'honor' ? rank : Number(rank), id: `${suit}-${rank}-${suffix}` };
}

function parseTileList(text, prefix) {
  if (!text) return [];
  return text.split(/[\s,]+/).map((item, index) => tileFromKey(item.trim(), `${prefix}-${index}`)).filter(Boolean);
}

function drawSpecificTiles(wall, keys, prefix) {
  const selected = [];
  for (const [index, key] of keys.entries()) {
    const matchIndex = wall.findIndex((tile) => tileKey(tile) === key);
    if (matchIndex < 0) continue;
    const [tile] = wall.splice(matchIndex, 1);
    selected.push({ ...tile, id: `${tile.suit}-${tile.rank}-${prefix}-${index}` });
  }
  return selected;
}

function rebuildPlayersFromPool(game, options = {}) {
  const pool = makeTiles();
  const desiredHand = parseTileList(options.startHand, 'debug-hand');
  const desiredKeys = desiredHand.map(tileKey);
  const desiredPlayerHand = drawSpecificTiles(pool, desiredKeys, 'debug-hand');

  if (desiredKeys.length > 0 && desiredPlayerHand.length !== desiredKeys.length) return false;

  for (const player of game.players) {
    player.hand = [];
    player.discards = [];
    player.melds = [];
    player.drawnTileId = '';
    player.chiCount = 0;
    player.knocked = false;
    player.caiPiao = 0;
    player.waitingCaiPiao = false;
    player.score = 0;
  }

  game.players[0].hand = desiredPlayerHand;
  while (game.players[0].hand.length < 14) game.players[0].hand.push(pool.pop());
  for (let index = 1; index < game.players.length; index += 1) {
    while (game.players[index].hand.length < 13) game.players[index].hand.push(pool.pop());
  }
  for (const player of game.players) sortHand(player.hand);
  game.wall = pool;
  pushEvent(game, 'debug_setup', { seat: 0, startHand: desiredKeys });
  return true;
}

function applyDebugSetup(game, options = {}) {
  const player = game.players[0];
  if (!player) return;

  rebuildPlayersFromPool(game, options);

  const fixedCaiCount = Math.max(0, Math.min(Number(options.fixedCaiCount || 0), 4));
  if (fixedCaiCount > 0) {
    const caiTiles = drawSpecificTiles(game.wall, Array.from({ length: fixedCaiCount }, () => 'honor-bai'), 'debug-cai');
    const replaced = [];
    for (const caiTile of caiTiles) {
      const replaceIndex = player.hand.findIndex((tile) => !isCai(tile));
      if (replaceIndex < 0) break;
      replaced.push(...player.hand.splice(replaceIndex, 1, caiTile));
    }
    game.wall.unshift(...replaced);
    sortHand(player.hand);
    pushEvent(game, 'debug_cai', { seat: 0, fixedCaiCount });
  }

  const drawQueue = parseTileList(options.drawQueue, 'debug-draw');
  if (drawQueue.length > 0) {
    const queueKeys = drawQueue.map(tileKey);
    const queued = drawSpecificTiles(game.wall, queueKeys, 'debug-draw');
    game.wall.push(...queued.reverse());
    pushEvent(game, 'debug_draw_queue', { drawQueue: queueKeys });
  }
}

function summarizeGame(game) {
  const humanPlayers = game.players.filter((player) => player.human);
  const winner = game.winnerSeat == null ? null : game.players[game.winnerSeat];
  return {
    rounds: 1,
    wins: winner?.human ? 1 : 0,
    dealerWins: winner?.human && winner.seat === game.dealerSeat ? 1 : 0,
    totalScore: humanPlayers.reduce((sum, player) => sum + player.score, 0),
    caiTiles: humanPlayers.reduce((sum, player) => sum + player.hand.filter(isCai).length, 0),
    caiPiaoHits: humanPlayers.reduce((sum, player) => sum + player.caiPiao, 0)
  };
}

function makePlayer(id, name, human, seat = 0) {
  return {
    id,
    name,
    human,
    seat,
    hand: [],
    discards: [],
    melds: [],
    score: 0,
    chiCount: 0,
    knocked: false,
    caiPiao: 0,
    waitingCaiPiao: false,
    drawnTileId: ''
  };
}

function createPlayers(hostName) {
  return [
    makePlayer(crypto.randomUUID(), hostName || '玩家', true, 0),
    makePlayer('ai-east', '东风 AI', false, 1),
    makePlayer('ai-south', '南风 AI', false, 2),
    makePlayer('ai-west', '西风 AI', false, 3)
  ];
}

function drawCheatBai(wall, count) {
  const tiles = [];
  for (let index = wall.length - 1; index >= 0 && tiles.length < count; index -= 1) {
    if (isCai(wall[index])) tiles.push(...wall.splice(index, 1));
  }
  return tiles;
}

function applyCheatTiles(player, wall, cheatTiles) {
  const removed = [];
  for (const tile of [...player.hand]) {
    if (removed.length >= cheatTiles.length) break;
    if (isCai(tile)) continue;
    const index = player.hand.findIndex((item) => item.id === tile.id);
    removed.push(...player.hand.splice(index, 1));
  }
  player.hand.push(...cheatTiles);
  wall.unshift(...removed);
}

function ensureSeatData(players) {
  players.forEach((player, seat) => {
    player.seat = seat;
    player.chiCount ??= 0;
    player.knocked ??= false;
    player.caiPiao ??= 0;
    player.waitingCaiPiao ??= false;
    player.drawnTileId ??= '';
    player.melds ??= [];
    player.discards ??= [];
    player.score ??= 0;
  });
}

function createGame(players, options = {}) {
  ensureSeatData(players);
  const wall = makeTiles();
  const cheatTiles = options.cheatThreeBai ? drawCheatBai(wall, 3) : [];
  for (let round = 0; round < 13; round += 1) {
    for (const player of players) player.hand.push(wall.pop());
  }
  players[0].hand.push(wall.pop());
  if (cheatTiles.length > 0) applyCheatTiles(players[0], wall, cheatTiles);
  for (const player of players) sortHand(player.hand);
  const game = {
    id: crypto.randomUUID(),
    phase: 'playing',
    wall,
    players,
    currentSeat: 0,
    dealerSeat: 0,
    lastDiscard: null,
    pending: null,
    winnerSeat: null,
    settlement: null,
    message: '庄家东位先出牌，白板为财神',
    log: ['牌局开始，白板为财神，庄家东位先出牌'],
    events: [],
    stats: null,
    updatedAt: Date.now()
  };
  pushEvent(game, 'game_start', { dealerSeat: game.dealerSeat, wallCount: game.wall.length });
  applyDebugSetup(game, options);
  return game;
}

function drawTile(game, seat, reason = '摸牌') {
  if (game.wall.length === 0) {
    game.phase = 'settlement';
    setMessage(game, '牌墙已空，流局');
    game.stats = summarizeGame(game);
    pushEvent(game, 'draw_game', { wallCount: 0 });
    return null;
  }

  const player = game.players[seat];
  const tile = game.wall.pop();
  player.hand.push(tile);
  player.drawnTileId = tile.id;
  sortHand(player.hand);
  updateCaiPiaoAfterDraw(game, seat);
  game.currentSeat = seat;
  game.lastDiscard = null;
  game.pending = null;
  setMessage(game, `${player.name}${reason}：${tileName(tile)}`);
  pushEvent(game, 'draw', { seat, tile: tileKey(tile), reason, wallCount: game.wall.length });
  return tile;
}

function nextSeat(seat) {
  return (seat + 1) % 4;
}

function updateCaiPiaoAfterDraw(game, seat) {
  const player = game.players[seat];
  if (!player.waitingCaiPiao) return;
  if (canWin(player.hand)) {
    player.caiPiao += 1;
    setMessage(game, `${player.name} 连续财飘成立，第 ${player.caiPiao} 次`);
    pushEvent(game, 'cai_piao', { seat, success: true, count: player.caiPiao });
  } else {
    player.caiPiao = 0;
    setMessage(game, `${player.name} 财飘链中断`);
    pushEvent(game, 'cai_piao', { seat, success: false, count: 0 });
  }
  player.waitingCaiPiao = false;
}

function clearDrawnTile(player) {
  player.drawnTileId = '';
}

function removeTileById(hand, tileId) {
  const index = hand.findIndex((tile) => tile.id === tileId);
  if (index < 0) return null;
  return hand.splice(index, 1)[0];
}

function removeTilesByKeys(hand, keys) {
  const removed = [];
  for (const key of keys) {
    const index = hand.findIndex((tile) => tileKey(tile) === key);
    if (index < 0) return null;
    removed.push(...hand.splice(index, 1));
  }
  return removed;
}

function settleWin(game, seat, type) {
  const winner = game.players[seat];
  game.phase = 'settlement';
  game.winnerSeat = seat;
  const result = classifyWin(winner);
  const base = 2 ** result.fan;
  let totalGain = 0;
  for (let seatIndex = 0; seatIndex < game.players.length; seatIndex += 1) {
    const player = game.players[seatIndex];
    if (seatIndex === seat) continue;
    const bankerMultiplier = seat === game.dealerSeat || seatIndex === game.dealerSeat ? 8 : 1;
    const loss = base * bankerMultiplier;
    player.score -= loss;
    totalGain += loss;
  }
  winner.score += totalGain;
  game.settlement = { type, ...result, base, totalGain, bankerMultiplier: seat === game.dealerSeat ? 8 : 1 };
  setMessage(game, `${winner.name}${type}${result.name}，${result.fan}翻`);
  game.stats = summarizeGame(game);
  pushEvent(game, 'win', { seat, winType: type, fan: result.fan, caiCount: result.caiCount, caiPiao: result.caiPiao });
}

function buildPending(game, fromSeat, tile) {
  const responses = [];
  for (let offset = 1; offset <= 3; offset += 1) {
    const seat = (fromSeat + offset) % 4;
    const player = game.players[seat];
    const sameCount = countSameTile(player.hand, tile);
    const actions = [];
    if (offset === 1 && player.chiCount < 2) {
      const sequences = canClaimSequence(player.hand, tile);
      for (const tileIds of sequences) actions.push({ type: 'chi', tileIds, label: `吃 ${tileName(tile)}` });
    }
    if (sameCount >= 2) actions.push({ type: 'pong', tileIds: [tileKey(tile), tileKey(tile)], label: `碰 ${tileName(tile)}` });
    if (sameCount >= 3) actions.push({ type: 'kongDiscard', tileIds: [tileKey(tile), tileKey(tile), tileKey(tile)], label: `杠 ${tileName(tile)}` });
    if (actions.length > 0) responses.push({ seat, actions });
  }

  if (responses.length === 0) return null;
  return { fromSeat, tile, responses, passes: [] };
}

function advanceAfterDiscard(game, seat) {
  const next = nextSeat(seat);
  drawTile(game, next);
}

function discard(game, seat, tileId) {
  if (game.phase !== 'playing' || game.pending || game.currentSeat !== seat) return;
  const player = game.players[seat];
  const tile = removeTileById(player.hand, tileId);
  if (!tile) return;

  clearDrawnTile(player);
  if (isCai(tile)) {
    player.waitingCaiPiao = true;
    setMessage(game, `${player.name} 打出白板，进入财飘等待`);
  } else {
    player.waitingCaiPiao = false;
    player.caiPiao = 0;
  }

  player.discards.push(tile);
  sortHand(player.hand);
  game.lastDiscard = { seat, tile };
  setMessage(game, `${player.name} 打出 ${tileName(tile)}`);
  pushEvent(game, 'discard', { seat, tile: tileKey(tile), cai: isCai(tile) });
  game.pending = buildPending(game, seat, tile);
  if (!game.pending) advanceAfterDiscard(game, seat);
}

function applyClaim(game, seat, type, tileIds) {
  const pending = game.pending;
  if (!pending) return;
  const player = game.players[seat];
  const discardTile = pending.tile;
  const removed = removeTilesByKeys(player.hand, tileIds);
  if (!removed) return;

  const meldTiles = [...removed, discardTile];
  sortHand(player.hand);
  player.melds.push({
    type: type === 'kongDiscard' ? 'kong' : type,
    fromSeat: pending.fromSeat,
    sourceTile: discardTile,
    tiles: meldTiles
  });
  if (type === 'chi') player.chiCount += 1;
  if (type === 'kongDiscard') drawTile(game, seat, '杠后补牌');
  else {
    game.currentSeat = seat;
    setMessage(game, `${player.name}${type === 'chi' ? '吃' : '碰'}了 ${tileName(discardTile)}`);
  }
  pushEvent(game, 'meld', { seat, meldType: type === 'kongDiscard' ? 'kong' : type, fromSeat: pending.fromSeat, tile: tileKey(discardTile) });
  game.pending = null;
  game.lastDiscard = null;
}

function applyResponse(game, seat, action, tileIds = []) {
  if (!game.pending) return;
  const options = game.pending.responses.find((entry) => entry.seat === seat);
  if (!options) return;

  if (action === 'pass') {
    game.pending.passes.push(seat);
    pushEvent(game, 'pass', { seat, fromSeat: game.pending.fromSeat, tile: tileKey(game.pending.tile) });
    if (game.pending.passes.length >= game.pending.responses.length) {
      const fromSeat = game.pending.fromSeat;
      game.pending = null;
      advanceAfterDiscard(game, fromSeat);
    }
    return;
  }

  const matched = options.actions.find((item) => item.type === action && JSON.stringify(item.tileIds || []) === JSON.stringify(tileIds || []));
  if (!matched) return;
  applyClaim(game, seat, action, tileIds);
}

function applySelfKong(game, seat, tileIds = []) {
  if (game.phase !== 'playing' || game.pending || game.currentSeat !== seat) return;
  if (tileIds.length !== 4) return;
  const player = game.players[seat];
  const removed = removeTilesByKeys(player.hand, tileIds);
  if (!removed) return;
  player.melds.push({ type: 'kong', fromSeat: seat, sourceTile: removed[0], tiles: removed });
  clearDrawnTile(player);
  setMessage(game, `${player.name} 暗杠 ${tileName(removed[0])}`);
  pushEvent(game, 'meld', { seat, meldType: 'kong', fromSeat: seat, tile: tileKey(removed[0]) });
  drawTile(game, seat, '杠后补牌');
}

function knock(game, seat) {
  if (game.phase !== 'playing' || game.pending || game.currentSeat !== seat) return;
  const player = game.players[seat];
  player.knocked = true;
  setMessage(game, `${player.name} 敲响`);
  pushEvent(game, 'knock', { seat });
}

function getSelfActions(game, seat) {
  if (game.phase !== 'playing' || game.pending || game.currentSeat !== seat) return [];
  const player = game.players[seat];
  const actions = player.hand.map((tile) => ({ type: 'discard', tileId: tile.id, label: `打出 ${tileName(tile)}` }));
  if (canWin(player.hand)) actions.push({ type: 'hu', label: '自摸胡' });
  const groups = new Map();
  for (const tile of player.hand) {
    const key = tileKey(tile);
    const list = groups.get(key) || [];
    list.push(key);
    groups.set(key, list);
  }
  for (const [key, list] of groups.entries()) {
    if (list.length >= 4) actions.push({ type: 'kong', tileIds: [key, key, key, key], label: `暗杠 ${key}` });
  }
  actions.push({ type: 'knock', label: '敲响' });
  return actions;
}

function getPendingActions(game, seat) {
  if (!game.pending) return [];
  const response = game.pending.responses.find((entry) => entry.seat === seat);
  if (!response) return [];
  return [...response.actions, { type: 'pass', label: '过' }];
}

function countNeighbors(hand, tile, gap) {
  return hand.filter((item) => item.suit === tile.suit && item.rank === tile.rank + gap).length;
}

function countConnectedGroups(hand, tile) {
  if (!isNumberTile(tile)) return 0;
  const offsets = [-2, -1, 1, 2];
  return offsets.reduce((sum, offset) => sum + Number(countNeighbors(hand, tile, offset) > 0), 0);
}

function scoreMeldValue(hand) {
  let score = 0;
  const counts = new Map();
  for (const tile of hand) counts.set(tileKey(tile), (counts.get(tileKey(tile)) || 0) + 1);

  for (const tile of hand) {
    const same = counts.get(tileKey(tile)) || 0;
    if (same >= 2) score += 2;
    if (same >= 3) score += 1;
    if (isCai(tile)) {
      score += 4;
      continue;
    }
    if (tile.suit === 'honor') continue;

    const left1 = countNeighbors(hand, tile, -1);
    const right1 = countNeighbors(hand, tile, 1);
    const left2 = countNeighbors(hand, tile, -2);
    const right2 = countNeighbors(hand, tile, 2);

    score += Math.min(left1 + right1, 2) * 2;
    score += Math.min(left2 + right2, 1);
    if (left1 > 0 && right1 > 0) score += 2;
  }

  return score;
}

function scoreDiscard(player, tile) {
  let score = 0;
  const same = player.hand.filter((item) => tileKey(item) === tileKey(tile)).length;

  if (isCai(tile)) score -= 20;
  if (player.waitingCaiPiao && isCai(tile)) score -= 10;
  if (player.knocked && isCai(tile)) score -= 6;

  score -= Math.min(same, 3) * 3;

  if (tile.suit === 'honor') {
    score += same > 1 ? -2 : 3;
    return score;
  }

  const left1 = countNeighbors(player.hand, tile, -1);
  const right1 = countNeighbors(player.hand, tile, 1);
  const left2 = countNeighbors(player.hand, tile, -2);
  const right2 = countNeighbors(player.hand, tile, 2);
  const edgePenalty = tile.rank === 1 || tile.rank === 9 ? 2 : tile.rank === 2 || tile.rank === 8 ? 1 : 0;

  score -= (left1 + right1) * 2;
  score -= left2 + right2;
  score += edgePenalty;

  if (left1 > 0 && right1 > 0) score -= 2;
  if (countConnectedGroups(player.hand, tile) >= 2) score -= 1.5;
  if (same >= 2) score -= 2;
  if (player.drawnTileId === tile.id) score -= 0.5;

  return score;
}

function chooseDiscard(player) {
  const scored = player.hand.map((tile) => ({ tile, score: scoreDiscard(player, tile) }));
  scored.sort((a, b) => b.score - a.score || a.tile.id.localeCompare(b.tile.id));
  return scored[0].tile;
}

function choosePendingAction(game, seat) {
  const player = game.players[seat];
  const actions = getPendingActions(game, seat).filter((item) => item.type !== 'pass');
  if (actions.length === 0) return { type: 'pass' };

  const kongAction = actions.find((item) => item.type === 'kongDiscard');
  if (kongAction && game.wall.length > 0) return kongAction;

  const pongAction = actions.find((item) => item.type === 'pong');
  if (pongAction) {
    const key = pongAction.tileIds[0];
    const pairCount = player.hand.filter((tile) => tileKey(tile) === key).length;
    if (pairCount >= 2) return pongAction;
  }

  const chiActions = actions.filter((item) => item.type === 'chi');
  if (chiActions.length > 0 && player.chiCount < 2 && !player.waitingCaiPiao) {
    chiActions.sort((a, b) => scoreChiAction(player, b, game.pending?.tile) - scoreChiAction(player, a, game.pending?.tile)
      || a.tileIds.join('-').localeCompare(b.tileIds.join('-')));
    return chiActions[0];
  }

  return { type: 'pass' };
}

function scoreChiAction(player, action, discardTile) {
  if (!discardTile) return 0;
  const consumed = [...action.tileIds];
  const remaining = [];

  for (const tile of player.hand) {
    const index = consumed.findIndex((key) => key === tileKey(tile));
    if (index >= 0) {
      consumed.splice(index, 1);
      continue;
    }
    remaining.push(tile);
  }

  return scoreMeldValue(remaining) - countConnectedGroups(player.hand, discardTile);
}

function runAi(game) {
  let safety = 0;
  while (game.phase === 'playing' && safety < 200) {
    safety += 1;
    if (game.pending) {
      const aiResponse = game.pending.responses.find((entry) => !game.players[entry.seat].human && !game.pending.passes.includes(entry.seat));
      if (!aiResponse) break;
      const action = choosePendingAction(game, aiResponse.seat);
      applyResponse(game, aiResponse.seat, action.type, action.tileIds || []);
      continue;
    }

    const player = game.players[game.currentSeat];
    if (player.human) break;
    if (canWin(player.hand)) {
      settleWin(game, game.currentSeat, '自摸');
      break;
    }
    const action = getSelfActions(game, game.currentSeat).find((item) => item.type === 'kong');
    if (action) {
      applySelfKong(game, game.currentSeat, action.tileIds);
      continue;
    }
    const discardTile = chooseDiscard(player);
    discard(game, game.currentSeat, discardTile.id);
  }
}

function visiblePlayer(player, viewerId) {
  const isSelf = player.id === viewerId;
  return {
    id: player.id,
    name: player.name,
    seat: player.seat,
    seatName: seatNames[player.seat],
    role: player.seat === 0 ? '庄家' : '闲家',
    score: player.score,
    chiCount: player.chiCount,
    knocked: player.knocked,
    caiPiao: player.caiPiao,
    waitingCaiPiao: player.waitingCaiPiao,
    drawnTileId: isSelf ? player.drawnTileId : '',
    melds: player.melds,
    discards: player.discards,
    hand: isSelf ? player.hand : [],
    handCount: isSelf ? player.hand.length : player.hand.length
  };
}

export function serializeGame(game, viewerId) {
  const viewerSeat = Math.max(0, game.players.findIndex((player) => player.id === viewerId));
  const actions = game.pending ? getPendingActions(game, viewerSeat) : getSelfActions(game, viewerSeat);
  const canHu = actions.some((action) => action.type === 'hu');
  return {
    id: game.id,
    phase: game.phase,
    wallCount: game.wall.length,
    currentSeat: game.currentSeat,
    dealerSeat: game.dealerSeat,
    viewerSeat,
    canAct: actions.length > 0,
    canHu,
    players: game.players.map((player) => visiblePlayer(player, viewerId)),
    actions,
    message: game.message,
    log: game.log.slice(-20),
    settlement: game.settlement,
    events: game.events.slice(-40),
    stats: game.stats
  };
}

export function createSolo(name, options = {}) {
  if (options.cheatThreeBai) {
    const players = createPlayers(name);
    const cheatedGame = createGame(players, { ...options, cheatThreeBai: true });
    cheatedGame.message = '作弊模式已开启：起手 3 张白板财神';
    cheatedGame.log.push('单机作弊模式：玩家起手获得 3 张白板财神');
    runAi(cheatedGame);
    return cheatedGame;
  }
  const game = createGame(createPlayers(name), options);
  runAi(game);
  return game;
}

export function startRoomGame(room) {
  const players = room.players.map((player, index) => makePlayer(player.id, player.name, true, index));
  while ((room.config?.fillWithAi ?? true) && players.length < 4) players.push(makePlayer(`bot-${players.length}`, `补位 AI ${players.length}`, false, players.length));
  room.game = createGame(players);
  runAi(room.game);
}

export function applyAction(game, seat, body) {
  if (!game || game.phase === 'settlement') return;
  if (body.action === 'hu' && canWin(game.players[seat].hand)) settleWin(game, seat, '自摸');
  if (body.action === 'kong') applySelfKong(game, seat, body.tileIds || []);
  if (body.action === 'knock') knock(game, seat);
  if (['pong', 'kongDiscard', 'chi', 'pass'].includes(body.action)) applyResponse(game, seat, body.action, body.tileIds || []);
  if (body.action === 'discard') discard(game, seat, body.tileId);
  game.updatedAt = Date.now();
  runAi(game);
}

export { canWin };

export const testing = {
  pushEvent,
  summarizeGame,
  applyDebugSetup,
  createGame,
  drawTile,
  discard,
  applyResponse,
  applySelfKong,
  settleWin,
  makePlayer,
  chooseDiscard,
  choosePendingAction,
  scoreDiscard,
  runAi
};
