export const suits = ['wan', 'tiao', 'tong'];
export const winds = ['east', 'south', 'west', 'north'];
export const dragons = ['zhong', 'fa', 'bai'];
export const suitLabels = { wan: '万', tiao: '条', tong: '筒' };
export const honorLabels = { east: '东', south: '南', west: '西', north: '北', zhong: '中', fa: '发', bai: '白' };
export const seatNames = ['东', '南', '西', '北'];

export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function makeTiles() {
  const tiles = [];
  for (const suit of suits) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        tiles.push({ suit, rank, id: `${suit}-${rank}-${copy}` });
      }
    }
  }
  for (const rank of [...winds, ...dragons]) {
    for (let copy = 0; copy < 4; copy += 1) {
      tiles.push({ suit: 'honor', rank, id: `honor-${rank}-${copy}` });
    }
  }
  return shuffle(tiles);
}

export function tileKey(tile) {
  return `${tile.suit}-${tile.rank}`;
}

export function isCai(tile) {
  return tile?.suit === 'honor' && tile.rank === 'bai';
}

export function isNumberTile(tile) {
  return suits.includes(tile?.suit);
}

export function tileName(tile) {
  if (tile.suit === 'honor') return honorLabels[tile.rank];
  return `${tile.rank}${suitLabels[tile.suit]}`;
}

export function sortHand(hand) {
  const order = { wan: 0, tiao: 1, tong: 2, honor: 3 };
  const honorOrder = { east: 1, south: 2, west: 3, north: 4, zhong: 5, fa: 6, bai: 7 };
  return hand.sort((a, b) => {
    const rankA = a.suit === 'honor' ? honorOrder[a.rank] : a.rank;
    const rankB = b.suit === 'honor' ? honorOrder[b.rank] : b.rank;
    return order[a.suit] - order[b.suit] || rankA - rankB || a.id.localeCompare(b.id);
  });
}

export function countByKey(tiles) {
  const counts = new Map();
  for (const tile of tiles) counts.set(tileKey(tile), (counts.get(tileKey(tile)) || 0) + 1);
  return counts;
}

export function allTileTypes() {
  const types = [];
  for (const suit of suits) {
    for (let rank = 1; rank <= 9; rank += 1) types.push({ suit, rank, key: `${suit}-${rank}` });
  }
  for (const rank of [...winds, ...dragons]) types.push({ suit: 'honor', rank, key: `honor-${rank}` });
  return types;
}
