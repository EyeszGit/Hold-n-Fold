// handEvaluator.js
// Standard-deck Texas Hold'em hand evaluator.
// A "card" is { rank: 2-14 (14 = Ace), suit: 'S'|'H'|'D'|'C' }.
//
// evaluate7(cards) picks the best 5-card hand out of 7 cards and returns a
// comparable score array: [category, tiebreak1, tiebreak2, ...]
// category: 8=straight flush, 7=quads, 6=full house, 5=flush, 4=straight,
//           3=trips, 2=two pair, 1=one pair, 0=high card
// Higher array (compared lexicographically) wins. Use compareScores() to compare.

function combinations(arr, k) {
    const results = [];
    const combo = [];
    function recurse(start) {
          if (combo.length === k) {
                  results.push(combo.slice());
                  return;
          }
          for (let i = start; i < arr.length; i++) {
                  combo.push(arr[i]);
                  recurse(i + 1);
                  combo.pop();
          }
    }
    recurse(0);
    return results;
}

function evaluate5(cards) {
    const ranksDesc = cards.map(c => c.rank).sort((a, b) => b - a);
    const suits = cards.map(c => c.suit);
    const isFlush = suits.every(s => s === suits[0]);

  const counts = {};
    for (const r of ranksDesc) counts[r] = (counts[r] || 0) + 1;
    const groups = Object.keys(counts)
      .map(r => ({ rank: Number(r), count: counts[r] }))
      .sort((a, b) => b.count - a.count || b.rank - a.rank);

  const uniqueRanksDesc = [...new Set(ranksDesc)];
    let straightHigh = null;
    if (uniqueRanksDesc.length === 5) {
          if (uniqueRanksDesc[0] - uniqueRanksDesc[4] === 4) {
                  straightHigh = uniqueRanksDesc[0];
          } else if (uniqueRanksDesc.join(',') === '14,5,4,3,2') {
                  straightHigh = 5;
          }
    }

  if (isFlush && straightHigh) return [8, straightHigh];
    if (groups[0].count === 4) {
          const kicker = groups[1].rank;
          return [7, groups[0].rank, kicker];
    }
    if (groups[0].count === 3 && groups[1].count === 2) {
          return [6, groups[0].rank, groups[1].rank];
    }
    if (isFlush) return [5, ...ranksDesc];
    if (straightHigh) return [4, straightHigh];
    if (groups[0].count === 3) {
          const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
          return [3, groups[0].rank, ...kickers];
    }
    if (groups[0].count === 2 && groups[1].count === 2) {
          const pairRanks = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
          const kicker = groups[2].rank;
          return [2, ...pairRanks, kicker];
    }
    if (groups[0].count === 2) {
          const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
          return [1, groups[0].rank, ...kickers];
    }
    return [0, ...ranksDesc];
}

function compareScores(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
          const av = a[i] === undefined ? -1 : a[i];
          const bv = b[i] === undefined ? -1 : b[i];
          if (av !== bv) return av - bv;
    }
    return 0;
}

function evaluate7(cards) {
    const combos = combinations(cards, 5);
    let best = null;
    for (const combo of combos) {
          const score = evaluate5(combo);
          if (best === null || compareScores(score, best) > 0) best = score;
    }
    return best;
}

const CATEGORY_NAMES = [
    'High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight',
    'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'
  ];

function describe(score) {
    return CATEGORY_NAMES[score[0]];
}

module.exports = { evaluate5, evaluate7, compareScores, describe, CATEGORY_NAMES };
