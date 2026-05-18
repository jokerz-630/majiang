import test from 'node:test';
import assert from 'node:assert/strict';
import { testing } from '../src/rules/game.js';

function tile(suit, rank, id) {
  return { suit, rank, id: id || `${suit}-${rank}` };
}

function createBasePlayers() {
  return [
    testing.makePlayer('human', '玩家', true, 0),
    testing.makePlayer('ai-1', 'AI1', false, 1),
    testing.makePlayer('ai-2', 'AI2', false, 2),
    testing.makePlayer('ai-3', 'AI3', false, 3)
  ];
}

test('AI 出牌会优先保留财神', () => {
  const player = testing.makePlayer('ai', 'AI', false, 1);
  player.hand = [
    tile('honor', 'bai', 'cai'),
    tile('wan', 1, 'a1'),
    tile('wan', 4, 'a4'),
    tile('wan', 7, 'a7'),
    tile('tong', 1, 'b1'),
    tile('tong', 4, 'b4'),
    tile('tong', 7, 'b7'),
    tile('tiao', 1, 'c1'),
    tile('tiao', 4, 'c4'),
    tile('tiao', 7, 'c7'),
    tile('honor', 'east', 'd1'),
    tile('honor', 'south', 'd2'),
    tile('honor', 'west', 'd3')
  ];

  const discardTile = testing.chooseDiscard(player);
  assert.notEqual(discardTile.id, 'cai');
});

test('AI 待响应时会优先选择杠牌', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[1].hand = [
    tile('wan', 3, 'k1'), tile('wan', 3, 'k2'), tile('wan', 3, 'k3'),
    tile('tong', 1, 'k4'), tile('tong', 4, 'k5'), tile('tong', 7, 'k6'),
    tile('tiao', 1, 'k7'), tile('tiao', 4, 'k8'), tile('tiao', 7, 'k9'),
    tile('honor', 'east', 'k10'), tile('honor', 'south', 'k11'), tile('honor', 'west', 'k12'), tile('honor', 'north', 'k13')
  ];
  game.pending = {
    fromSeat: 0,
    tile: tile('wan', 3, 'discard-3'),
    responses: [{
      seat: 1,
      actions: [
        { type: 'pong', tileIds: ['wan-3', 'wan-3'], label: '碰 3万' },
        { type: 'kongDiscard', tileIds: ['wan-3', 'wan-3', 'wan-3'], label: '杠 3万' }
      ]
    }],
    passes: []
  };

  const action = testing.choosePendingAction(game, 1);
  assert.equal(action.type, 'kongDiscard');
});

test('AI 有财飘等待时会放弃吃牌', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[1].waitingCaiPiao = true;
  game.players[1].hand = [
    tile('wan', 1, 'c1'), tile('wan', 2, 'c2'), tile('wan', 4, 'c4'),
    tile('tong', 1, 'c5'), tile('tong', 4, 'c6'), tile('tong', 7, 'c7'),
    tile('tiao', 1, 'c8'), tile('tiao', 4, 'c9'), tile('tiao', 7, 'c10'),
    tile('honor', 'east', 'c11'), tile('honor', 'south', 'c12'), tile('honor', 'west', 'c13'), tile('honor', 'north', 'c14')
  ];
  game.pending = {
    fromSeat: 0,
    tile: tile('wan', 3, 'discard-chi'),
    responses: [{
      seat: 1,
      actions: [
        { type: 'chi', tileIds: ['wan-1', 'wan-2'], label: '吃 3万' }
      ]
    }],
    passes: []
  };

  const action = testing.choosePendingAction(game, 1);
  assert.equal(action.type, 'pass');
});

test('AI 出牌会优先拆孤张而保留连搭', () => {
  const player = testing.makePlayer('ai', 'AI', false, 1);
  player.hand = [
    tile('wan', 2, 'w2'),
    tile('wan', 3, 'w3'),
    tile('wan', 4, 'w4'),
    tile('wan', 5, 'w5'),
    tile('tong', 2, 't2'),
    tile('tong', 3, 't3'),
    tile('tong', 4, 't4'),
    tile('tiao', 6, 'b6'),
    tile('tiao', 7, 'b7'),
    tile('honor', 'east', 'h1'),
    tile('honor', 'south', 'h2'),
    tile('honor', 'west', 'h3'),
    tile('honor', 'north', 'h4')
  ];

  const discardTile = testing.chooseDiscard(player);
  assert.notEqual(discardTile.id, 'w3');
  assert.notEqual(discardTile.id, 'w4');
  assert.equal(discardTile.id, 'h1');
});

test('AI 吃牌会优先选择保留更强余牌结构的组合', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[1].hand = [
    tile('wan', 1, 'a1'), tile('wan', 2, 'a2'), tile('wan', 4, 'a4'), tile('wan', 5, 'a5'),
    tile('wan', 6, 'a6'), tile('tong', 2, 'a7'), tile('tong', 3, 'a8'), tile('tong', 4, 'a9'),
    tile('tiao', 6, 'a10'), tile('tiao', 7, 'a11'),
    tile('honor', 'east', 'a12'), tile('honor', 'south', 'a13'), tile('honor', 'west', 'a14')
  ];
  game.pending = {
    fromSeat: 0,
    tile: tile('wan', 3, 'discard-3'),
    responses: [{
      seat: 1,
      actions: [
        { type: 'chi', tileIds: ['wan-1', 'wan-2'], label: '吃 3万' },
        { type: 'chi', tileIds: ['wan-2', 'wan-4'], label: '吃 3万' },
        { type: 'chi', tileIds: ['wan-4', 'wan-5'], label: '吃 3万' }
      ]
    }],
    passes: []
  };

  const action = testing.choosePendingAction(game, 1);
  assert.deepEqual(action.tileIds, ['wan-1', 'wan-2']);
});

test('AI 运行时会对可杠弃牌执行响应', () => {
  const game = testing.createGame(createBasePlayers());
  game.pending = {
    fromSeat: 0,
    tile: tile('wan', 3, 'discard-kong'),
    responses: [{
      seat: 1,
      actions: [
        { type: 'kongDiscard', tileIds: ['wan-3', 'wan-3', 'wan-3'], label: '杠 3万' }
      ]
    }],
    passes: []
  };
  game.wall = [tile('tong', 9, 'after-kong-draw')];
  game.players[1].hand = [
    tile('wan', 3, 'x1'), tile('wan', 3, 'x2'), tile('wan', 3, 'x3'),
    tile('tong', 1, 'x4'), tile('tong', 4, 'x5'), tile('tong', 7, 'x6'),
    tile('tiao', 1, 'x7'), tile('tiao', 4, 'x8'), tile('tiao', 7, 'x9'),
    tile('honor', 'east', 'x10'), tile('honor', 'south', 'x11'), tile('honor', 'west', 'x12'), tile('honor', 'north', 'x13')
  ];

  testing.runAi(game);

  assert.equal(game.players[1].melds.length, 1);
  assert.equal(game.players[1].melds[0].type, 'kong');
  assert.equal(game.wall.length, 0);
  assert.equal(game.players[1].melds[0].sourceTile.id, 'discard-kong');
});
