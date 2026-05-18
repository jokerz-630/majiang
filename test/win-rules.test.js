import test from 'node:test';
import assert from 'node:assert/strict';
import { canWin, classifyWin } from '../src/rules/win.js';
import { testing } from '../src/rules/game.js';

function tile(suit, rank, id) {
  return { suit, rank, id: id || `${suit}-${rank}` };
}

function playerWithHand(hand, extras = {}) {
  return {
    hand,
    knocked: false,
    caiPiao: 0,
    ...extras
  };
}

function createBasePlayers() {
  return [
    testing.makePlayer('p0', '玩家0', true, 0),
    testing.makePlayer('p1', '玩家1', true, 1),
    testing.makePlayer('p2', '玩家2', true, 2),
    testing.makePlayer('p3', '玩家3', true, 3)
  ];
}

test('平胡可胡且为 1 翻', () => {
  const hand = [
    tile('wan', 1, 'a1'), tile('wan', 2, 'a2'), tile('wan', 3, 'a3'),
    tile('wan', 4, 'a4'), tile('wan', 5, 'a5'), tile('wan', 6, 'a6'),
    tile('tong', 2, 'a7'), tile('tong', 3, 'a8'), tile('tong', 4, 'a9'),
    tile('tiao', 6, 'a10'), tile('tiao', 7, 'a11'), tile('tiao', 8, 'a12'),
    tile('honor', 'east', 'a13'), tile('honor', 'east', 'a14')
  ];

  assert.equal(canWin(hand), true);
  assert.deepEqual(classifyWin(playerWithHand(hand)), {
    name: '平胡',
    fan: 1,
    caiCount: 0,
    caiPiao: 0,
    knocked: false,
    sevenPairs: false
  });
});

test('七小对子无财神为 4 翻', () => {
  const hand = [
    tile('wan', 1, 'b1'), tile('wan', 1, 'b2'),
    tile('wan', 2, 'b3'), tile('wan', 2, 'b4'),
    tile('wan', 3, 'b5'), tile('wan', 3, 'b6'),
    tile('tong', 4, 'b7'), tile('tong', 4, 'b8'),
    tile('tong', 5, 'b9'), tile('tong', 5, 'b10'),
    tile('tiao', 6, 'b11'), tile('tiao', 6, 'b12'),
    tile('honor', 'east', 'b13'), tile('honor', 'east', 'b14')
  ];

  assert.equal(canWin(hand), true);
  const result = classifyWin(playerWithHand(hand));
  assert.equal(result.name, '七小对子');
  assert.equal(result.fan, 4);
  assert.equal(result.sevenPairs, true);
});

test('七小对子有财神为 2 翻', () => {
  const hand = [
    tile('wan', 1, 'c1'), tile('wan', 1, 'c2'),
    tile('wan', 2, 'c3'), tile('wan', 2, 'c4'),
    tile('wan', 3, 'c5'), tile('wan', 3, 'c6'),
    tile('tong', 4, 'c7'), tile('tong', 4, 'c8'),
    tile('tong', 5, 'c9'), tile('tong', 5, 'c10'),
    tile('tiao', 6, 'c11'), tile('tiao', 6, 'c12'),
    tile('honor', 'bai', 'c13'), tile('honor', 'bai', 'c14')
  ];

  assert.equal(canWin(hand), true);
  const result = classifyWin(playerWithHand(hand));
  assert.equal(result.name, '财神七小对子');
  assert.equal(result.fan, 2);
  assert.equal(result.caiCount, 2);
});

test('七小对子有财神且敲响为 4 翻', () => {
  const hand = [
    tile('wan', 1, 'd1'), tile('wan', 1, 'd2'),
    tile('wan', 2, 'd3'), tile('wan', 2, 'd4'),
    tile('wan', 3, 'd5'), tile('wan', 3, 'd6'),
    tile('tong', 4, 'd7'), tile('tong', 4, 'd8'),
    tile('tong', 5, 'd9'), tile('tong', 5, 'd10'),
    tile('tiao', 6, 'd11'), tile('tiao', 6, 'd12'),
    tile('honor', 'bai', 'd13'), tile('honor', 'bai', 'd14')
  ];

  const result = classifyWin(playerWithHand(hand, { knocked: true }));
  assert.equal(result.name, '财神敲响七对');
  assert.equal(result.fan, 4);
});

test('有财神的敲响为 2 翻', () => {
  const hand = [
    tile('wan', 1, 'e1'), tile('wan', 2, 'e2'), tile('wan', 3, 'e3'),
    tile('wan', 4, 'e4'), tile('wan', 5, 'e5'), tile('wan', 6, 'e6'),
    tile('tong', 2, 'e7'), tile('tong', 3, 'e8'), tile('tong', 4, 'e9'),
    tile('tiao', 6, 'e10'), tile('tiao', 7, 'e11'), tile('honor', 'bai', 'e12'),
    tile('honor', 'east', 'e13'), tile('honor', 'east', 'e14')
  ];

  assert.equal(canWin(hand), true);
  const result = classifyWin(playerWithHand(hand, { knocked: true }));
  assert.equal(result.name, '财神敲响');
  assert.equal(result.fan, 2);
});

test('三财胡额外加 1 翻', () => {
  const hand = [
    tile('wan', 1, 'f1'), tile('wan', 1, 'f2'),
    tile('wan', 2, 'f3'), tile('wan', 2, 'f4'),
    tile('wan', 3, 'f5'), tile('wan', 3, 'f6'),
    tile('tong', 4, 'f7'), tile('tong', 4, 'f8'),
    tile('tong', 5, 'f9'), tile('tong', 5, 'f10'),
    tile('tiao', 6, 'f11'),
    tile('honor', 'bai', 'f12'), tile('honor', 'bai', 'f13'), tile('honor', 'bai', 'f14')
  ];

  assert.equal(canWin(hand), true);
  const result = classifyWin(playerWithHand(hand));
  assert.equal(result.caiCount, 3);
  assert.equal(result.fan, 3);
});

test('四财胡额外加 2 翻', () => {
  const hand = [
    tile('wan', 1, 'g1'), tile('wan', 1, 'g2'),
    tile('wan', 2, 'g3'), tile('wan', 2, 'g4'),
    tile('wan', 3, 'g5'), tile('wan', 3, 'g6'),
    tile('tong', 4, 'g7'), tile('tong', 4, 'g8'),
    tile('tong', 5, 'g9'), tile('tong', 5, 'g10'),
    tile('honor', 'bai', 'g11'), tile('honor', 'bai', 'g12'), tile('honor', 'bai', 'g13'), tile('honor', 'bai', 'g14')
  ];

  assert.equal(canWin(hand), true);
  const result = classifyWin(playerWithHand(hand));
  assert.equal(result.caiCount, 4);
  assert.equal(result.fan, 4);
});

test('连续财飘最多计 2 翻', () => {
  const hand = [
    tile('wan', 1, 'h1'), tile('wan', 2, 'h2'), tile('wan', 3, 'h3'),
    tile('wan', 4, 'h4'), tile('wan', 5, 'h5'), tile('wan', 6, 'h6'),
    tile('tong', 2, 'h7'), tile('tong', 3, 'h8'), tile('tong', 4, 'h9'),
    tile('tiao', 6, 'h10'), tile('tiao', 7, 'h11'), tile('tiao', 8, 'h12'),
    tile('honor', 'east', 'h13'), tile('honor', 'east', 'h14')
  ];

  const result = classifyWin(playerWithHand(hand, { caiPiao: 3 }));
  assert.equal(result.fan, 3);
  assert.equal(result.caiPiao, 3);
});

test('庄家自摸按 8 倍参与结算', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[0].hand = [
    tile('wan', 1, 'i1'), tile('wan', 2, 'i2'), tile('wan', 3, 'i3'),
    tile('wan', 4, 'i4'), tile('wan', 5, 'i5'), tile('wan', 6, 'i6'),
    tile('tong', 2, 'i7'), tile('tong', 3, 'i8'), tile('tong', 4, 'i9'),
    tile('tiao', 6, 'i10'), tile('tiao', 7, 'i11'), tile('tiao', 8, 'i12'),
    tile('honor', 'east', 'i13'), tile('honor', 'east', 'i14')
  ];

  testing.settleWin(game, 0, '自摸');

  assert.equal(game.settlement.base, 2);
  assert.equal(game.players[1].score, -16);
  assert.equal(game.players[2].score, -16);
  assert.equal(game.players[3].score, -16);
  assert.equal(game.players[0].score, 48);
});

test('闲家自摸时庄家承担 8 倍其余闲家承担 1 倍', () => {
  const game = testing.createGame(createBasePlayers());
  game.players[2].hand = [
    tile('wan', 1, 'j1'), tile('wan', 2, 'j2'), tile('wan', 3, 'j3'),
    tile('wan', 4, 'j4'), tile('wan', 5, 'j5'), tile('wan', 6, 'j6'),
    tile('tong', 2, 'j7'), tile('tong', 3, 'j8'), tile('tong', 4, 'j9'),
    tile('tiao', 6, 'j10'), tile('tiao', 7, 'j11'), tile('tiao', 8, 'j12'),
    tile('honor', 'east', 'j13'), tile('honor', 'east', 'j14')
  ];

  testing.settleWin(game, 2, '自摸');

  assert.equal(game.settlement.base, 2);
  assert.equal(game.players[0].score, -16);
  assert.equal(game.players[1].score, -2);
  assert.equal(game.players[3].score, -2);
  assert.equal(game.players[2].score, 20);
});
