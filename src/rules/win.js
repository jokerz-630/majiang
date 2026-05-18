import { allTileTypes, countByKey, isCai, suits, tileKey } from '../shared/tiles.js';

const tileTypes = allTileTypes();

function cloneCounts(counts) {
  return new Map(counts);
}

function canMakeSuitMelds(counts, caiLeft, suit) {
  const ranks = [];
  for (let rank = 1; rank <= 9; rank += 1) ranks.push(counts.get(`${suit}-${rank}`) || 0);
  return solveSuit(ranks, caiLeft);
}

function solveSuit(ranks, caiLeft) {
  let first = -1;
  for (let index = 0; index < ranks.length; index += 1) {
    if (ranks[index] > 0) {
      first = index;
      break;
    }
  }
  if (first === -1) return true;

  if (ranks[first] >= 3) {
    ranks[first] -= 3;
    if (solveSuit(ranks, caiLeft)) return true;
    ranks[first] += 3;
  }

  if (ranks[first] === 2 && caiLeft >= 1) {
    ranks[first] -= 2;
    if (solveSuit(ranks, caiLeft - 1)) return true;
    ranks[first] += 2;
  }

  if (ranks[first] === 1 && caiLeft >= 2) {
    ranks[first] -= 1;
    if (solveSuit(ranks, caiLeft - 2)) return true;
    ranks[first] += 1;
  }

  if (first <= 6) {
    const need = [first, first + 1, first + 2].filter((index) => ranks[index] === 0).length;
    if (need <= caiLeft) {
      const touched = [];
      for (const index of [first, first + 1, first + 2]) {
        if (ranks[index] > 0) {
          ranks[index] -= 1;
          touched.push(index);
        }
      }
      if (solveSuit(ranks, caiLeft - need)) return true;
      for (const index of touched) ranks[index] += 1;
    }
  }

  return false;
}

function canMakeHonorMelds(counts, caiLeft) {
  let need = 0;
  for (const type of tileTypes) {
    if (type.suit !== 'honor' || type.rank === 'bai') continue;
    const count = counts.get(type.key) || 0;
    need += (3 - (count % 3)) % 3;
  }
  return need <= caiLeft;
}

function canCompleteWithPair(tiles) {
  const caiCount = tiles.filter(isCai).length;
  const normalTiles = tiles.filter((tile) => !isCai(tile));
  const counts = countByKey(normalTiles);

  const pairCandidates = ['__cai__', ...tileTypes.map((tile) => tile.key)];
  for (const pairKey of pairCandidates) {
    let caiLeft = caiCount;
    const work = cloneCounts(counts);

    if (pairKey === '__cai__') {
      if (caiLeft < 2) continue;
      caiLeft -= 2;
    } else {
      const pairCount = work.get(pairKey) || 0;
      if (pairCount >= 2) {
        work.set(pairKey, pairCount - 2);
      } else if (pairCount === 1 && caiLeft >= 1) {
        work.set(pairKey, 0);
        caiLeft -= 1;
      } else if (pairCount === 0 && caiLeft >= 2) {
        caiLeft -= 2;
      } else {
        continue;
      }
    }

    let ok = true;
    for (const suit of suits) {
      if (!canMakeSuitMelds(work, caiLeft, suit)) {
        ok = false;
        break;
      }
      const suitNeed = calcSuitNeed(work, suit);
      caiLeft -= suitNeed;
    }
    if (!ok) continue;
    if (canMakeHonorMelds(work, caiLeft)) return true;
  }

  return false;
}

function calcSuitNeed(counts, suit) {
  const ranks = [];
  for (let rank = 1; rank <= 9; rank += 1) ranks.push(counts.get(`${suit}-${rank}`) || 0);
  for (let need = 0; need <= 8; need += 1) {
    if (solveSuit([...ranks], need)) return need;
  }
  return 9;
}

export function isSevenPairs(tiles) {
  if (tiles.length !== 14) return false;
  const caiCount = tiles.filter(isCai).length;
  const normalTiles = tiles.filter((tile) => !isCai(tile));
  const counts = countByKey(normalTiles);
  let pairs = 0;
  let singles = 0;
  for (const count of counts.values()) {
    pairs += Math.floor(count / 2);
    singles += count % 2;
  }
  if (singles > caiCount) return false;
  const remainingCai = caiCount - singles;
  return pairs + singles + Math.floor(remainingCai / 2) >= 7;
}

export function canWin(tiles) {
  if (tiles.length % 3 !== 2) return false;
  return isSevenPairs(tiles) || canCompleteWithPair(tiles);
}

export function classifyWin(player) {
  const caiCount = player.hand.filter(isCai).length;
  const sevenPairs = isSevenPairs(player.hand);
  let fan = 1;
  let name = '平胡';

  if (sevenPairs && caiCount === 0) {
    fan = 4;
    name = '七小对子';
  } else if (sevenPairs && caiCount > 0 && player.knocked) {
    fan = 4;
    name = '财神敲响七对';
  } else if (sevenPairs && caiCount > 0) {
    fan = 2;
    name = '财神七小对子';
  } else if (player.knocked && caiCount > 0) {
    fan = 2;
    name = '财神敲响';
  }

  if (caiCount === 3) fan += 1;
  if (caiCount >= 4) fan += 2;
  fan += Math.min(player.caiPiao || 0, 2);

  return {
    name,
    fan,
    caiCount,
    caiPiao: player.caiPiao || 0,
    knocked: Boolean(player.knocked),
    sevenPairs
  };
}

export function canClaimSequence(hand, discard) {
  if (discard.suit === 'honor' || isCai(discard)) return [];
  const counts = countByKey(hand.filter((tile) => !isCai(tile)));
  const sequences = [];
  for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
    const ranks = [discard.rank + a, discard.rank + b];
    if (ranks.some((rank) => rank < 1 || rank > 9)) continue;
    const keys = ranks.map((rank) => `${discard.suit}-${rank}`);
    if (keys.every((key) => (counts.get(key) || 0) >= 1)) sequences.push(keys);
  }
  return sequences;
}

export function countSameTile(hand, tile) {
  const key = tileKey(tile);
  return hand.filter((item) => tileKey(item) === key).length;
}
