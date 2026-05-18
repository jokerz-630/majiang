import test from 'node:test';
import assert from 'node:assert/strict';
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

test('结构化事件会记录摸牌、出牌、胡牌和流局', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].hand = [
    tile('wan', 1, 'a1'), tile('wan', 2, 'a2'), tile('wan', 3, 'a3'),
    tile('wan', 4, 'a4'), tile('wan', 5, 'a5'), tile('wan', 6, 'a6'),
    tile('tong', 2, 'a7'), tile('tong', 3, 'a8'), tile('tong', 4, 'a9'),
    tile('tiao', 6, 'a10'), tile('tiao', 7, 'a11'), tile('tiao', 8, 'a12'),
    tile('honor', 'east', 'a13'), tile('honor', 'east', 'a14')
  ];
  game.wall = [];

  testing.drawTile(game, 0);
  testing.settleWin(game, 0, '自摸');

  assert.equal(game.events.some((event) => event.type === 'game_start'), true);
  assert.equal(game.events.some((event) => event.type === 'draw_game'), true);
  assert.equal(game.events.some((event) => event.type === 'win'), true);
});

test('结构化事件会记录副露与过牌', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].hand = [
    tile('wan', 1, 'd1'), tile('wan', 2, 'd2'), tile('wan', 3, 'd3'), tile('wan', 4, 'd4'), tile('wan', 5, 'd5'), tile('wan', 6, 'd6'), tile('wan', 7, 'd7'), tile('wan', 8, 'd8'), tile('wan', 9, 'd9'), tile('tong', 1, 'd10'), tile('tong', 2, 'd11'), tile('tong', 3, 'd12'), tile('tong', 4, 'd13'), tile('tong', 5, 'd14')
  ];
  game.players[1].hand = [
    tile('wan', 1, 'e1'), tile('wan', 2, 'e2'), tile('wan', 4, 'e4'), tile('tong', 1, 'e5'), tile('tong', 2, 'e6'), tile('tong', 3, 'e7'), tile('tong', 4, 'e8'), tile('tong', 5, 'e9'), tile('tiao', 1, 'e10'), tile('tiao', 2, 'e11'), tile('tiao', 3, 'e12'), tile('honor', 'east', 'e13'), tile('honor', 'south', 'e14')
  ];
  game.players[2].hand = [
    tile('wan', 3, 'f1'), tile('wan', 3, 'f2'), tile('tong', 1, 'f3'), tile('tong', 2, 'f4'), tile('tong', 3, 'f5'), tile('tong', 4, 'f6'), tile('tong', 5, 'f7'), tile('tiao', 1, 'f8'), tile('tiao', 2, 'f9'), tile('tiao', 3, 'f10'), tile('honor', 'east', 'f11'), tile('honor', 'south', 'f12'), tile('honor', 'west', 'f13')
  ];
  game.players[3].hand = [
    tile('wan', 3, 'g1'), tile('wan', 3, 'g2'), tile('wan', 3, 'g3'), tile('tong', 1, 'g4'), tile('tong', 2, 'g5'), tile('tong', 3, 'g6'), tile('tong', 4, 'g7'), tile('tong', 5, 'g8'), tile('tiao', 1, 'g9'), tile('tiao', 2, 'g10'), tile('tiao', 3, 'g11'), tile('honor', 'east', 'g12'), tile('honor', 'south', 'g13')
  ];
  game.wall = [tile('tong', 9, 'draw-next')];

  testing.discard(game, 0, 'd3');
  testing.applyResponse(game, 1, 'pass');
  testing.applyResponse(game, 2, 'pass');
  testing.applyResponse(game, 3, 'kongDiscard', ['wan-3', 'wan-3', 'wan-3']);

  assert.equal(game.events.some((event) => event.type === 'discard'), true);
  assert.equal(game.events.some((event) => event.type === 'pass'), true);
  assert.equal(game.events.some((event) => event.type === 'meld'), true);
});

test('结构化事件会记录财飘成立与中断', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].hand = [
    tile('honor', 'bai', 'b0'),
    tile('wan', 1, 'b1'), tile('wan', 2, 'b2'), tile('wan', 3, 'b3'),
    tile('wan', 4, 'b4'), tile('wan', 5, 'b5'), tile('wan', 6, 'b6'),
    tile('tong', 2, 'b7'), tile('tong', 3, 'b8'), tile('tong', 4, 'b9'),
    tile('tiao', 6, 'b10'), tile('tiao', 7, 'b11'), tile('tiao', 8, 'b12'),
    tile('honor', 'east', 'b13')
  ];
  game.players[1].hand = [
    tile('honor', 'east', 'c1'), tile('honor', 'south', 'c2'), tile('honor', 'west', 'c3'), tile('honor', 'north', 'c4'), tile('honor', 'zhong', 'c5'), tile('honor', 'fa', 'c6'), tile('wan', 1, 'c7'), tile('wan', 4, 'c8'), tile('wan', 7, 'c9'), tile('tong', 1, 'c10'), tile('tong', 4, 'c11'), tile('tong', 7, 'c12'), tile('tiao', 9, 'c13')
  ];
  game.players[2].hand = [
    tile('wan', 1, 'x1'), tile('wan', 4, 'x2'), tile('wan', 7, 'x3'), tile('tong', 1, 'x4'), tile('tong', 4, 'x5'), tile('tong', 7, 'x6'), tile('tiao', 1, 'x7'), tile('tiao', 4, 'x8'), tile('tiao', 7, 'x9'), tile('honor', 'east', 'x10'), tile('honor', 'south', 'x11'), tile('honor', 'west', 'x12'), tile('honor', 'north', 'x13')
  ];
  game.players[3].hand = [
    tile('wan', 2, 'y1'), tile('wan', 5, 'y2'), tile('wan', 8, 'y3'), tile('tong', 2, 'y4'), tile('tong', 5, 'y5'), tile('tong', 8, 'y6'), tile('tiao', 2, 'y7'), tile('tiao', 5, 'y8'), tile('tiao', 8, 'y9'), tile('honor', 'east', 'y10'), tile('honor', 'south', 'y11'), tile('honor', 'west', 'y12'), tile('honor', 'north', 'y13')
  ];
  game.wall = [tile('wan', 9, 'draw-3'), tile('tong', 9, 'draw-2'), tile('tiao', 9, 'draw-1'), tile('honor', 'east', 'draw-win')];

  testing.discard(game, 0, 'b0');
  testing.discard(game, 1, 'c1');
  testing.discard(game, 2, 'x10');
  testing.discard(game, 3, 'y10');

  assert.equal(game.events.some((event) => event.type === 'cai_piao'), true);
});

test('调试配置会生成 debug 事件', () => {
  const game = testing.createGame(createBasePlayers(), {
    startHand: 'wan-1 wan-2 wan-3 tong-1 tong-2 tong-3 tiao-1 tiao-2 tiao-3 honor-east honor-east honor-bai honor-bai honor-bai',
    drawQueue: 'wan-9 honor-bai',
    fixedCaiCount: 2
  });

  const debugTypes = game.events.filter((event) => event.type.startsWith('debug_')).map((event) => event.type);
  assert.equal(debugTypes.includes('debug_setup'), true);
  assert.equal(debugTypes.includes('debug_draw_queue'), true);
  assert.equal(debugTypes.includes('debug_cai'), true);
});
