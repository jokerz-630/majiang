import { testing } from '../src/rules/game.js';

function makeSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function withSeed(seed, task) {
  const originalRandom = Math.random;
  Math.random = makeSeededRandom(seed);
  try {
    return task();
  } finally {
    Math.random = originalRandom;
  }
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
  return [...new Set(ids)].sort();
}

function simulateGame(seed) {
  return withSeed(seed, () => {
    const game = testing.createGame(createAiPlayers());
    const initialIds = collectTileIds(game);

    testing.runAi(game);

    const finalIds = collectTileIds(game);
    const totalScore = game.players.reduce((sum, player) => sum + player.score, 0);
    const hasWinEvent = game.events.some((event) => event.type === 'win');
    const hasDrawEvent = game.events.some((event) => event.type === 'draw_game');
    const ok = game.phase === 'settlement'
      && game.pending === null
      && game.stats
      && totalScore === 0
      && JSON.stringify(finalIds) === JSON.stringify(initialIds)
      && (hasWinEvent || hasDrawEvent)
      && (!hasDrawEvent || game.wall.length === 0)
      && (!hasWinEvent || (game.winnerSeat != null && game.settlement && game.players[game.winnerSeat].score > 0));

    return {
      ok,
      seed,
      phase: game.phase,
      winnerSeat: game.winnerSeat,
      wallCount: game.wall.length,
      totalScore,
      eventCount: game.events.length,
      finalEvent: game.events.at(-1)?.type || null,
      message: game.message,
      settlement: game.settlement,
      logTail: game.log.slice(-5)
    };
  });
}

const count = Math.max(1, Number(process.env.SIM_COUNT || process.argv[2] || 50));
const startSeed = Number(process.env.SIM_START_SEED || process.argv[3] || 1);
const samples = [];
const failures = [];
const summary = {
  total: count,
  passed: 0,
  failed: 0,
  wins: 0,
  draws: 0,
  averageEventCount: 0,
  seeds: {
    start: startSeed,
    end: startSeed + count - 1
  }
};

let totalEvents = 0;
for (let index = 0; index < count; index += 1) {
  const seed = startSeed + index;
  const result = simulateGame(seed);
  totalEvents += result.eventCount;

  if (result.finalEvent === 'win') summary.wins += 1;
  if (result.finalEvent === 'draw_game') summary.draws += 1;

  if (result.ok) {
    summary.passed += 1;
  } else {
    summary.failed += 1;
    failures.push(result.seed);
    if (samples.length < 5) samples.push(result);
  }
}

summary.averageEventCount = Number((totalEvents / count).toFixed(2));

const report = {
  summary,
  failureSeeds: failures,
  failureSamples: samples
};

console.log(JSON.stringify(report, null, 2));

if (summary.failed > 0) process.exit(1);
