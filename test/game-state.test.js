import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, serializeGame } from '../src/rules/game.js';
import { testing } from '../src/rules/game.js';

function tile(suit, rank, id) {
  return { suit, rank, id: id || `${suit}-${rank}-${Math.random()}` };
}

function createBasePlayers() {
  return [
    testing.makePlayer('p0', '玩家0', true, 0),
    testing.makePlayer('p1', '玩家1', true, 1),
    testing.makePlayer('p2', '玩家2', true, 2),
    testing.makePlayer('p3', '玩家3', true, 3)
  ];
}

function createAiPlayers() {
  return [
    testing.makePlayer('ai-0', 'AI0', false, 0),
    testing.makePlayer('ai-1', 'AI1', false, 1),
    testing.makePlayer('ai-2', 'AI2', false, 2),
    testing.makePlayer('ai-3', 'AI3', false, 3)
  ];
}

function collectTileIds(game) {
  const ids = [];
  ids.push(...game.wall.map((tile) => tile.id));
  for (const player of game.players) {
    ids.push(...player.hand.map((tile) => tile.id));
    ids.push(...player.discards.map((tile) => tile.id));
    ids.push(...player.melds.flatMap((meld) => meld.tiles.map((tile) => tile.id)));
  }
  return new Set(ids);
}

function chooseLegalAction(game) {
  const seat = game.pending ? game.pending.responses[0]?.seat : game.currentSeat;
  if (seat == null) return null;
  const viewerId = game.players[seat].id;
  const view = serializeGame(game, viewerId);
  if (view.actions.some((action) => action.type === 'hu')) return { seat, body: { action: 'hu' } };
  if (game.pending) {
    const response = view.actions.find((action) => action.type !== 'pass') || view.actions.find((action) => action.type === 'pass');
    return response ? { seat, body: { action: response.type, tileIds: response.tileIds || [] } } : null;
  }
  const kong = view.actions.find((action) => action.type === 'kong');
  if (kong) return { seat, body: { action: 'kong', tileIds: kong.tileIds || [] } };
  const discardAction = view.actions.find((action) => action.type === 'discard');
  if (discardAction) return { seat, body: { action: 'discard', tileId: discardAction.tileId } };
  return null;
}

test('createGame 发牌后庄家 14 张其余 13 张', () => {
  const game = testing.createGame(createBasePlayers());
  assert.equal(game.phase, 'playing');
  assert.equal(game.players[0].hand.length, 14);
  assert.equal(game.players[1].hand.length, 13);
  assert.equal(game.players[2].hand.length, 13);
  assert.equal(game.players[3].hand.length, 13);
  assert.equal(game.wall.length, 83);
  assert.equal(game.currentSeat, 0);
});

test('discard 在无人响应时推进到下一家摸牌', () => {
  const players = createBasePlayers();
  const game = testing.createGame(players);
  game.players[0].hand = [
    tile('wan', 1, 'a1'), tile('wan', 4, 'a2'), tile('wan', 7, 'a3'), tile('tong', 1, 'a4'), tile('tong', 4, 'a5'), tile('tong', 7, 'a6'), tile('tiao', 1, 'a7'), tile('tiao', 4, 'a8'), tile('tiao', 7, 'a9'), tile('honor', 'east', 'a10'), tile('honor', 'south', 'a11'), tile('honor', 'west', 'a12'), tile('honor', 'north', 'a13'), tile('honor', 'zhong', 'a14')
  ];
  game.players[1].hand = [
    tile('wan', 2, 'b1'), tile('wan', 5, 'b2'), tile('wan', 8, 'b3'), tile('tong', 2, 'b4'), tile('tong', 5, 'b5'), tile('tong', 8, 'b6'), tile('tiao', 2, 'b7'), tile('tiao', 5, 'b8'), tile('tiao', 8, 'b9'), tile('honor', 'east', 'b10'), tile('honor', 'south', 'b11'), tile('honor', 'west', 'b12'), tile('honor', 'north', 'b13')
  ];
  game.players[2].hand = [
    tile('wan', 3, 'c1'), tile('wan', 6, 'c2'), tile('wan', 9, 'c3'), tile('tong', 3, 'c4'), tile('tong', 6, 'c5'), tile('tong', 9, 'c6'), tile('tiao', 3, 'c7'), tile('tiao', 6, 'c8'), tile('tiao', 9, 'c9'), tile('honor', 'east', 'c10'), tile('honor', 'south', 'c11'), tile('honor', 'west', 'c12'), tile('honor', 'north', 'c13')
  ];
  game.players[3].hand = [
    tile('wan', 2, 'd1'), tile('wan', 5, 'd2'), tile('wan', 8, 'd3'), tile('tong', 2, 'd4'), tile('tong', 5, 'd5'), tile('tong', 8, 'd6'), tile('tiao', 2, 'd7'), tile('tiao', 5, 'd8'), tile('tiao', 8, 'd9'), tile('honor', 'zhong', 'd10'), tile('honor', 'fa', 'd11'), tile('honor', 'west', 'd12'), tile('honor', 'north', 'd13')
  ];
  game.wall = [tile('tong', 9, 'draw-next')];
  const discardId = 'a14';
  const wallBefore = game.wall.length;

  testing.discard(game, 0, discardId);

  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[0].hand.length, 13);
  assert.equal(game.players[0].discards.length, 1);
  assert.equal(game.players[1].hand.length, 14);
  assert.equal(game.wall.length, wallBefore - 1);
  assert.equal(game.pending, null);
  assert.ok(game.players[1].drawnTileId);
});

test('discard 白板后进入财飘等待，下一次摸牌后关闭等待', () => {
  const players = createBasePlayers();
  const game = testing.createGame(players);
  game.players[0].hand = [
    tile('honor', 'bai', 'honor-bai-0'),
    tile('wan', 1, 'wan-1-0'),
    tile('wan', 2, 'wan-2-0'),
    tile('wan', 3, 'wan-3-0'),
    tile('wan', 4, 'wan-4-0'),
    tile('wan', 5, 'wan-5-0'),
    tile('wan', 6, 'wan-6-0'),
    tile('wan', 7, 'wan-7-0'),
    tile('wan', 8, 'wan-8-0'),
    tile('tong', 1, 'tong-1-0'),
    tile('tong', 2, 'tong-2-0'),
    tile('tong', 3, 'tong-3-0'),
    tile('tong', 4, 'tong-4-0'),
    tile('tong', 5, 'tong-5-0')
  ];
  game.players[1].hand = [
    tile('honor', 'east', 'h-e-0'),
    tile('honor', 'south', 'h-s-0'),
    tile('honor', 'west', 'h-w-0'),
    tile('honor', 'north', 'h-n-0'),
    tile('honor', 'zhong', 'h-z-0'),
    tile('honor', 'fa', 'h-f-0'),
    tile('wan', 1, 'wan-1-a'),
    tile('wan', 4, 'wan-4-a'),
    tile('wan', 7, 'wan-7-a'),
    tile('tong', 1, 'tong-1-a'),
    tile('tong', 4, 'tong-4-a'),
    tile('tong', 7, 'tong-7-a'),
    tile('tiao', 9, 'tiao-9-a')
  ];
  game.players[2].hand = [
    tile('wan', 1, 'x1'), tile('wan', 4, 'x2'), tile('wan', 7, 'x3'), tile('tong', 1, 'x4'), tile('tong', 4, 'x5'), tile('tong', 7, 'x6'), tile('tiao', 1, 'x7'), tile('tiao', 4, 'x8'), tile('tiao', 7, 'x9'), tile('honor', 'east', 'x10'), tile('honor', 'south', 'x11'), tile('honor', 'west', 'x12'), tile('honor', 'north', 'x13')
  ];
  game.players[3].hand = [
    tile('wan', 2, 'y1'), tile('wan', 5, 'y2'), tile('wan', 8, 'y3'), tile('tong', 2, 'y4'), tile('tong', 5, 'y5'), tile('tong', 8, 'y6'), tile('tiao', 2, 'y7'), tile('tiao', 5, 'y8'), tile('tiao', 8, 'y9'), tile('honor', 'east', 'y10'), tile('honor', 'south', 'y11'), tile('honor', 'west', 'y12'), tile('honor', 'north', 'y13')
  ];
  game.wall = [
    tile('wan', 9, 'draw-3'),
    tile('tong', 9, 'draw-2'),
    tile('tiao', 9, 'draw-1'),
    tile('wan', 9, 'draw-0')
  ];

  testing.discard(game, 0, 'honor-bai-0');
  assert.equal(game.players[0].waitingCaiPiao, true);

  testing.discard(game, 1, 'h-e-0');
  assert.equal(game.currentSeat, 2);

  testing.discard(game, 2, 'x10');
  assert.equal(game.currentSeat, 3);

  testing.discard(game, 3, 'y10');
  assert.equal(game.currentSeat, 0);
  assert.equal(game.players[0].waitingCaiPiao, false);
});

test('响应全部过牌后轮到下一家摸牌', () => {
  const players = createBasePlayers();
  const game = testing.createGame(players);
  game.players[0].hand = [
    tile('wan', 1, 'a1'), tile('wan', 2, 'a2'), tile('wan', 3, 'a3'), tile('wan', 4, 'a4'), tile('wan', 5, 'a5'), tile('wan', 6, 'a6'), tile('wan', 7, 'a7'), tile('wan', 8, 'a8'), tile('wan', 9, 'a9'), tile('tong', 1, 'a10'), tile('tong', 2, 'a11'), tile('tong', 3, 'a12'), tile('tong', 4, 'a13'), tile('tong', 5, 'a14')
  ];
  game.players[1].hand = [
    tile('wan', 1, 'b1'), tile('wan', 2, 'b2'), tile('wan', 4, 'b4'), tile('tong', 1, 'b5'), tile('tong', 2, 'b6'), tile('tong', 3, 'b7'), tile('tong', 4, 'b8'), tile('tong', 5, 'b9'), tile('tiao', 1, 'b10'), tile('tiao', 2, 'b11'), tile('tiao', 3, 'b12'), tile('honor', 'east', 'b13'), tile('honor', 'south', 'b14')
  ];
  game.players[2].hand = [
    tile('wan', 3, 'c1'), tile('wan', 3, 'c2'), tile('tong', 1, 'c3'), tile('tong', 2, 'c4'), tile('tong', 3, 'c5'), tile('tong', 4, 'c6'), tile('tong', 5, 'c7'), tile('tiao', 1, 'c8'), tile('tiao', 2, 'c9'), tile('tiao', 3, 'c10'), tile('honor', 'east', 'c11'), tile('honor', 'south', 'c12'), tile('honor', 'west', 'c13')
  ];
  game.players[3].hand = [
    tile('wan', 3, 'd1'), tile('wan', 3, 'd2'), tile('wan', 3, 'd3'), tile('tong', 1, 'd4'), tile('tong', 2, 'd5'), tile('tong', 3, 'd6'), tile('tong', 4, 'd7'), tile('tong', 5, 'd8'), tile('tiao', 1, 'd9'), tile('tiao', 2, 'd10'), tile('tiao', 3, 'd11'), tile('honor', 'east', 'd12'), tile('honor', 'south', 'd13')
  ];
  game.wall = [tile('tong', 9, 'draw-next')];

  testing.discard(game, 0, 'a3');
  assert.ok(game.pending);

  testing.applyResponse(game, 1, 'pass');
  assert.ok(game.pending);
  testing.applyResponse(game, 2, 'pass');
  assert.ok(game.pending);
  testing.applyResponse(game, 3, 'pass');

  assert.equal(game.pending, null);
  assert.equal(game.currentSeat, 1);
  assert.equal(game.players[1].hand.length, 14);
});

test('非法状态跳转会被拒绝', () => {
  const game = testing.createGame(createBasePlayers());
  const beforeHand = game.players[1].hand.length;
  const beforeDiscard = game.players[1].discards.length;

  testing.discard(game, 1, game.players[1].hand[0].id);

  assert.equal(game.players[1].hand.length, beforeHand);
  assert.equal(game.players[1].discards.length, beforeDiscard);
  assert.equal(game.currentSeat, 0);
});

test('settleWin 会进入结算并更新分数', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].hand = [
    tile('wan', 1, 's1'), tile('wan', 1, 's2'), tile('wan', 2, 's3'), tile('wan', 2, 's4'), tile('wan', 3, 's5'), tile('wan', 3, 's6'), tile('tong', 4, 's7'), tile('tong', 4, 's8'), tile('tong', 5, 's9'), tile('tong', 5, 's10'), tile('tiao', 6, 's11'), tile('tiao', 6, 's12'), tile('honor', 'east', 's13'), tile('honor', 'east', 's14')
  ];

  testing.settleWin(game, 0, '自摸');

  assert.equal(game.phase, 'settlement');
  assert.equal(game.winnerSeat, 0);
  assert.ok(game.settlement);
  assert.ok(game.players[0].score > 0);
  assert.ok(game.players[1].score < 0);
  assert.ok(game.players[2].score < 0);
  assert.ok(game.players[3].score < 0);
});

test('暗杠后会立即补牌并保留当前出牌权', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].hand = [
    tile('wan', 1, 'k1'), tile('wan', 1, 'k2'), tile('wan', 1, 'k3'), tile('wan', 1, 'k4'),
    tile('wan', 2, 'k5'), tile('wan', 3, 'k6'), tile('wan', 4, 'k7'), tile('tong', 2, 'k8'),
    tile('tong', 3, 'k9'), tile('tong', 4, 'k10'), tile('tiao', 6, 'k11'), tile('tiao', 7, 'k12'),
    tile('honor', 'east', 'k13'), tile('honor', 'east', 'k14')
  ];
  game.wall = [tile('tong', 9, 'kong-draw')];

  testing.applySelfKong(game, 0, ['wan-1', 'wan-1', 'wan-1', 'wan-1']);

  assert.equal(game.currentSeat, 0);
  assert.equal(game.players[0].melds.length, 1);
  assert.equal(game.players[0].melds[0].type, 'kong');
  assert.equal(game.players[0].hand.length, 11);
  assert.equal(game.players[0].drawnTileId, 'kong-draw');
  assert.equal(game.wall.length, 0);
});

test('牌墙为空时摸牌会直接流局', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].hand = [
    tile('wan', 1, 'l1'), tile('wan', 4, 'l2'), tile('wan', 7, 'l3'), tile('tong', 1, 'l4'),
    tile('tong', 4, 'l5'), tile('tong', 7, 'l6'), tile('tiao', 1, 'l7'), tile('tiao', 4, 'l8'),
    tile('tiao', 7, 'l9'), tile('honor', 'east', 'l10'), tile('honor', 'south', 'l11'), tile('honor', 'west', 'l12'), tile('honor', 'north', 'l13'), tile('honor', 'zhong', 'l14')
  ];
  game.players[1].hand = [
    tile('wan', 2, 'm1'), tile('wan', 5, 'm2'), tile('wan', 8, 'm3'), tile('tong', 2, 'm4'), tile('tong', 5, 'm5'), tile('tong', 8, 'm6'), tile('tiao', 2, 'm7'), tile('tiao', 5, 'm8'), tile('tiao', 8, 'm9'), tile('honor', 'east', 'm10'), tile('honor', 'south', 'm11'), tile('honor', 'west', 'm12'), tile('honor', 'north', 'm13')
  ];
  game.players[2].hand = [
    tile('wan', 3, 'n1'), tile('wan', 6, 'n2'), tile('wan', 9, 'n3'), tile('tong', 3, 'n4'), tile('tong', 6, 'n5'), tile('tong', 9, 'n6'), tile('tiao', 3, 'n7'), tile('tiao', 6, 'n8'), tile('tiao', 9, 'n9'), tile('honor', 'east', 'n10'), tile('honor', 'south', 'n11'), tile('honor', 'west', 'n12'), tile('honor', 'north', 'n13')
  ];
  game.players[3].hand = [
    tile('wan', 2, 'o1'), tile('wan', 5, 'o2'), tile('wan', 8, 'o3'), tile('tong', 2, 'o4'), tile('tong', 5, 'o5'), tile('tong', 8, 'o6'), tile('tiao', 2, 'o7'), tile('tiao', 5, 'o8'), tile('tiao', 8, 'o9'), tile('honor', 'zhong', 'o10'), tile('honor', 'fa', 'o11'), tile('honor', 'west', 'o12'), tile('honor', 'north', 'o13')
  ];
  game.wall = [];

  testing.discard(game, 0, 'l14');

  assert.equal(game.phase, 'settlement');
  assert.equal(game.message, '牌墙已空，流局');
  assert.equal(game.pending, null);
});

test('财飘在下一次自己摸牌成胡时累计一次', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].hand = [
    tile('honor', 'bai', 'p0-bai'),
    tile('wan', 1, 'p0-1'), tile('wan', 2, 'p0-2'), tile('wan', 3, 'p0-3'),
    tile('wan', 4, 'p0-4'), tile('wan', 5, 'p0-5'), tile('wan', 6, 'p0-6'),
    tile('tong', 2, 'p0-7'), tile('tong', 3, 'p0-8'), tile('tong', 4, 'p0-9'),
    tile('tiao', 6, 'p0-10'), tile('tiao', 7, 'p0-11'), tile('honor', 'east', 'p0-12'), tile('honor', 'east', 'p0-13')
  ];
  game.players[1].hand = [
    tile('honor', 'south', 'q1'), tile('honor', 'west', 'q2'), tile('honor', 'north', 'q3'), tile('honor', 'zhong', 'q4'), tile('honor', 'fa', 'q5'), tile('wan', 1, 'q6'), tile('wan', 4, 'q7'), tile('wan', 7, 'q8'), tile('tong', 1, 'q9'), tile('tong', 4, 'q10'), tile('tong', 7, 'q11'), tile('tiao', 1, 'q12'), tile('tiao', 4, 'q13')
  ];
  game.players[2].hand = [
    tile('wan', 2, 'r1'), tile('wan', 5, 'r2'), tile('wan', 8, 'r3'), tile('tong', 2, 'r4'), tile('tong', 5, 'r5'), tile('tong', 8, 'r6'), tile('tiao', 2, 'r7'), tile('tiao', 5, 'r8'), tile('tiao', 8, 'r9'), tile('honor', 'zhong', 'r10'), tile('honor', 'south', 'r11'), tile('honor', 'west', 'r12'), tile('honor', 'north', 'r13')
  ];
  game.players[3].hand = [
    tile('wan', 3, 's1'), tile('wan', 6, 's2'), tile('wan', 9, 's3'), tile('tong', 3, 's4'), tile('tong', 6, 's5'), tile('tong', 9, 's6'), tile('tiao', 3, 's7'), tile('tiao', 6, 's8'), tile('tiao', 9, 's9'), tile('honor', 'fa', 's10'), tile('honor', 'south', 's11'), tile('honor', 'west', 's12'), tile('honor', 'north', 's13')
  ];
  game.wall = [
    tile('tiao', 8, 'draw-third'),
    tile('tong', 9, 'draw-second'),
    tile('wan', 9, 'draw-first'),
    tile('tiao', 8, 'win-draw')
  ];

  testing.discard(game, 0, 'p0-bai');
  testing.discard(game, 1, 'q1');
  testing.discard(game, 2, 'r10');
  testing.discard(game, 3, 's10');

  assert.equal(game.currentSeat, 0);
  assert.equal(game.players[0].waitingCaiPiao, false);
  assert.equal(game.players[0].caiPiao, 1);
});

test('财飘在下一次自己摸牌不成胡时清零', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].caiPiao = 2;
  game.players[0].hand = [
    tile('honor', 'bai', 't0-bai'),
    tile('wan', 1, 't0-1'), tile('wan', 2, 't0-2'), tile('wan', 3, 't0-3'),
    tile('wan', 4, 't0-4'), tile('wan', 5, 't0-5'), tile('tong', 2, 't0-6'),
    tile('tong', 4, 't0-7'), tile('tong', 6, 't0-8'), tile('tiao', 1, 't0-9'),
    tile('tiao', 4, 't0-10'), tile('honor', 'east', 't0-11'), tile('honor', 'south', 't0-12'), tile('honor', 'west', 't0-13')
  ];
  game.players[1].hand = [
    tile('honor', 'north', 'u1'), tile('honor', 'zhong', 'u2'), tile('honor', 'fa', 'u3'), tile('wan', 1, 'u4'), tile('wan', 4, 'u5'), tile('wan', 7, 'u6'), tile('tong', 1, 'u7'), tile('tong', 4, 'u8'), tile('tong', 7, 'u9'), tile('tiao', 1, 'u10'), tile('tiao', 4, 'u11'), tile('tiao', 7, 'u12'), tile('wan', 9, 'u13')
  ];
  game.players[2].hand = [
    tile('wan', 2, 'v1'), tile('wan', 5, 'v2'), tile('wan', 8, 'v3'), tile('tong', 2, 'v4'), tile('tong', 5, 'v5'), tile('tong', 8, 'v6'), tile('tiao', 2, 'v7'), tile('tiao', 5, 'v8'), tile('tiao', 8, 'v9'), tile('honor', 'east', 'v10'), tile('honor', 'south', 'v11'), tile('honor', 'west', 'v12'), tile('honor', 'north', 'v13')
  ];
  game.players[3].hand = [
    tile('wan', 3, 'w1'), tile('wan', 6, 'w2'), tile('wan', 9, 'w3'), tile('tong', 3, 'w4'), tile('tong', 6, 'w5'), tile('tong', 9, 'w6'), tile('tiao', 3, 'w7'), tile('tiao', 6, 'w8'), tile('tiao', 9, 'w9'), tile('honor', 'east', 'w10'), tile('honor', 'south', 'w11'), tile('honor', 'west', 'w12'), tile('honor', 'north', 'w13')
  ];
  game.wall = [tile('wan', 9, 'break-draw'), tile('tong', 9, 'mid-2'), tile('tiao', 9, 'mid-1'), tile('wan', 8, 'mid-0')];

  testing.discard(game, 0, 't0-bai');
  testing.discard(game, 1, 'u1');
  testing.discard(game, 2, 'v10');
  testing.discard(game, 3, 'w10');

  assert.equal(game.currentSeat, 0);
  assert.equal(game.players[0].waitingCaiPiao, false);
  assert.equal(game.players[0].caiPiao, 0);
});

test('杠后补牌也会触发财飘成立', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].waitingCaiPiao = true;
  game.players[0].hand = [
    tile('wan', 1, 'g1'), tile('wan', 1, 'g2'), tile('wan', 1, 'g3'), tile('wan', 1, 'g4'),
    tile('wan', 2, 'g5'), tile('wan', 3, 'g6'), tile('wan', 4, 'g7'),
    tile('tong', 2, 'g8'), tile('tong', 3, 'g9'), tile('tong', 4, 'g10'),
    tile('tiao', 6, 'g11'), tile('tiao', 7, 'g12'), tile('honor', 'east', 'g13'), tile('honor', 'east', 'g14')
  ];
  game.wall = [tile('tiao', 8, 'gang-win-draw')];

  testing.applySelfKong(game, 0, ['wan-1', 'wan-1', 'wan-1', 'wan-1']);

  assert.equal(game.players[0].waitingCaiPiao, false);
  assert.equal(game.players[0].caiPiao, 1);
  assert.equal(game.players[0].drawnTileId, 'gang-win-draw');
});

test('吃碰杠会记录来源牌、来源座位和动作类型', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].hand = [
    tile('wan', 1, 'z1'), tile('wan', 4, 'z2'), tile('wan', 7, 'z3'), tile('tong', 1, 'z4'), tile('tong', 4, 'z5'), tile('tong', 7, 'z6'), tile('tiao', 1, 'z7'), tile('tiao', 4, 'z8'), tile('tiao', 7, 'z9'), tile('honor', 'east', 'z10'), tile('honor', 'south', 'z11'), tile('honor', 'west', 'z12'), tile('honor', 'north', 'z13'), tile('wan', 3, 'discard-3')
  ];
  game.players[1].hand = [
    tile('wan', 1, 'chi-1'), tile('wan', 2, 'chi-2'), tile('wan', 4, 'chi-4'), tile('wan', 5, 'chi-5'), tile('tong', 1, 'chi-6'), tile('tong', 4, 'chi-7'), tile('tong', 7, 'chi-8'), tile('tiao', 1, 'chi-9'), tile('tiao', 4, 'chi-10'), tile('tiao', 7, 'chi-11'), tile('honor', 'east', 'chi-12'), tile('honor', 'south', 'chi-13'), tile('honor', 'west', 'chi-14')
  ];
  game.players[2].hand = [
    tile('wan', 3, 'pong-1'), tile('wan', 3, 'pong-2'), tile('tong', 2, 'pong-3'), tile('tong', 5, 'pong-4'), tile('tong', 8, 'pong-5'), tile('tiao', 2, 'pong-6'), tile('tiao', 5, 'pong-7'), tile('tiao', 8, 'pong-8'), tile('honor', 'east', 'pong-9'), tile('honor', 'south', 'pong-10'), tile('honor', 'west', 'pong-11'), tile('honor', 'north', 'pong-12'), tile('honor', 'zhong', 'pong-13')
  ];
  game.players[3].hand = [
    tile('wan', 3, 'kong-1'), tile('wan', 3, 'kong-2'), tile('wan', 3, 'kong-3'), tile('tong', 3, 'kong-4'), tile('tong', 6, 'kong-5'), tile('tong', 9, 'kong-6'), tile('tiao', 3, 'kong-7'), tile('tiao', 6, 'kong-8'), tile('tiao', 9, 'kong-9'), tile('honor', 'east', 'kong-10'), tile('honor', 'south', 'kong-11'), tile('honor', 'west', 'kong-12'), tile('honor', 'north', 'kong-13')
  ];
  game.wall = [tile('tong', 9, 'kong-follow-draw')];

  testing.discard(game, 0, 'discard-3');
  testing.applyResponse(game, 1, 'chi', ['wan-1', 'wan-2']);

  assert.equal(game.players[1].melds[0].type, 'chi');
  assert.equal(game.players[1].melds[0].fromSeat, 0);
  assert.equal(game.players[1].melds[0].sourceTile.id, 'discard-3');

  game.currentSeat = 0;
  game.pending = null;
  game.players[0].hand.push(tile('wan', 3, 'discard-3b'));
  testing.discard(game, 0, 'discard-3b');
  testing.applyResponse(game, 2, 'pong', ['wan-3', 'wan-3']);

  assert.equal(game.players[2].melds[0].type, 'pong');
  assert.equal(game.players[2].melds[0].fromSeat, 0);
  assert.equal(game.players[2].melds[0].sourceTile.id, 'discard-3b');

  game.currentSeat = 0;
  game.pending = null;
  game.players[0].hand.push(tile('wan', 3, 'discard-3c'));
  testing.discard(game, 0, 'discard-3c');
  testing.applyResponse(game, 3, 'kongDiscard', ['wan-3', 'wan-3', 'wan-3']);

  assert.equal(game.players[3].melds[0].type, 'kong');
  assert.equal(game.players[3].melds[0].fromSeat, 0);
  assert.equal(game.players[3].melds[0].sourceTile.id, 'discard-3c');
});

test('批量合法动作推进过程中牌张集合保持守恒', () => {
  for (let round = 0; round < 12; round += 1) {
    const game = testing.createGame(createBasePlayers());
    const initialIds = collectTileIds(game);
    assert.equal(initialIds.size, 136);

    let safety = 0;
    while (game.phase === 'playing' && safety < 160) {
      safety += 1;
      const next = chooseLegalAction(game);
      assert.ok(next, `第 ${round + 1} 局在第 ${safety} 步缺少合法动作`);
      applyAction(game, next.seat, next.body);
      const currentIds = collectTileIds(game);
      assert.equal(currentIds.size, initialIds.size);
      assert.deepEqual([...currentIds].sort(), [...initialIds].sort());
    }

    assert.ok(safety < 160, `第 ${round + 1} 局未在安全步数内结束`);
  }
});

test('applyAction 遇到不在合法动作集中的动作时不会改写牌局状态', () => {
  const game = testing.createGame(createBasePlayers());
  const before = JSON.stringify({
    phase: game.phase,
    currentSeat: game.currentSeat,
    wall: game.wall.map((tile) => tile.id),
    players: game.players.map((player) => ({
      hand: player.hand.map((tile) => tile.id),
      discards: player.discards.map((tile) => tile.id),
      melds: player.melds.map((meld) => meld.tiles.map((tile) => tile.id)),
      score: player.score,
      knocked: player.knocked,
      caiPiao: player.caiPiao,
      waitingCaiPiao: player.waitingCaiPiao
    }))
  });

  applyAction(game, 0, { action: 'discard', tileId: 'missing-tile-id' });

  const after = JSON.stringify({
    phase: game.phase,
    currentSeat: game.currentSeat,
    wall: game.wall.map((tile) => tile.id),
    players: game.players.map((player) => ({
      hand: player.hand.map((tile) => tile.id),
      discards: player.discards.map((tile) => tile.id),
      melds: player.melds.map((meld) => meld.tiles.map((tile) => tile.id)),
      score: player.score,
      knocked: player.knocked,
      caiPiao: player.caiPiao,
      waitingCaiPiao: player.waitingCaiPiao
    }))
  });

  assert.equal(after, before);
});

test('批量自动对局会在安全步数内收敛到有效终局', () => {
  for (let round = 0; round < 24; round += 1) {
    const game = testing.createGame(createAiPlayers());
    const initialIds = collectTileIds(game);

    testing.runAi(game);

    assert.equal(game.phase, 'settlement', `第 ${round + 1} 局未进入结算阶段`);
    assert.equal(game.pending, null, `第 ${round + 1} 局结算后仍残留待响应状态`);
    assert.ok(game.stats, `第 ${round + 1} 局缺少统计摘要`);

    const finalIds = collectTileIds(game);
    assert.equal(finalIds.size, initialIds.size, `第 ${round + 1} 局牌张数量发生变化`);
    assert.deepEqual([...finalIds].sort(), [...initialIds].sort(), `第 ${round + 1} 局牌张集合不守恒`);

    const totalScore = game.players.reduce((sum, player) => sum + player.score, 0);
    assert.equal(totalScore, 0, `第 ${round + 1} 局总分没有守恒`);

    const hasWinEvent = game.events.some((event) => event.type === 'win');
    const hasDrawEvent = game.events.some((event) => event.type === 'draw_game');
    assert.equal(hasWinEvent || hasDrawEvent, true, `第 ${round + 1} 局缺少终局事件`);

    if (hasWinEvent) {
      assert.ok(game.winnerSeat != null, `第 ${round + 1} 局胡牌终局缺少赢家座位`);
      assert.ok(game.settlement, `第 ${round + 1} 局胡牌终局缺少结算详情`);
      assert.ok(game.players[game.winnerSeat].score > 0, `第 ${round + 1} 局赢家分数异常`);
    }

    if (hasDrawEvent) {
      assert.equal(game.wall.length, 0, `第 ${round + 1} 局流局时牌墙未空`);
    }
  }
});
