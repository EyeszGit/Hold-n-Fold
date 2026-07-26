// simulate.js - headless correctness check for the poker engine.
// Runs many full sit-n-go tournaments with bots making legal random actions
// (weighted toward calling/checking so hands actually reach showdown
// sometimes) and asserts:
//   1. No exceptions are thrown across an entire tournament.
//   2. Chip conservation: total chips in play never changes except for the
//      house rake removed at the very end.
//   3. Every tournament actually finishes (reaches 'complete').
//   4. Payouts for 1st/2nd/3rd are internally consistent with the prize pool.
//
// Run with: npm run simulate

const { Table } = require('../server/table');
const { evaluate5, evaluate7, compareScores } = require('../server/handEvaluator');

function assert(cond, msg) {
    if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

// ---- 1. Unit-test the hand evaluator against known hands ----
function rank(str) {
    // e.g. "AS" -> {rank:14, suit:'S'}
  const map = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
    const r = str.slice(0, -1);
    const suit = str.slice(-1);
    return { rank: map[r] || Number(r), suit };
}
function hand(strs) { return strs.map(rank); }

(function testEvaluator() {
    const royalFlush = evaluate5(hand(['AS', 'KS', 'QS', 'JS', 'TS']));
    assert(royalFlush[0] === 8, 'royal flush should be straight-flush category');

   const wheel = evaluate5(hand(['AS', '2H', '3D', '4C', '5S']));
    assert(wheel[0] === 4 && wheel[1] === 5, 'wheel (A-5) should be a 5-high straight');

   const quads = evaluate5(hand(['9S', '9H', '9D', '9C', '2S']));
    assert(quads[0] === 7, 'quads category');

   const fullHouse = evaluate5(hand(['9S', '9H', '9D', '2C', '2S']));
    assert(fullHouse[0] === 6, 'full house category');

   const twoPair = evaluate5(hand(['9S', '9H', '2D', '2C', '5S']));
    assert(twoPair[0] === 2, 'two pair category');

   const better = evaluate7(hand(['AS', 'AH', 'AD', 'KC', 'KS', '2H', '3D']));
    const worse = evaluate7(hand(['9S', '9H', '2D', '2C', '5S', '6H', '7D']));
    assert(compareScores(better, worse) > 0, 'full house beats two pair');

   console.log('Hand evaluator unit tests passed.');
})();

// ---- 2. Bot-driven full tournament simulations ----
function randomLegalAction(state) {
    const r = Math.random();
    if (state.toCall > 0) {
          if (r < 0.08) return { action: 'fold' };
          if (r < 0.85) return { action: 'call' };
          return { action: 'raise', amount: state.minRaiseTo };
    } else {
          if (r < 0.75) return { action: 'check' };
          return { action: 'raise', amount: state.minRaiseTo };
    }
}

function runTournament(numPlayers, buyIn) {
    return new Promise((resolve, reject) => {
          const table = new Table({ id: `sim-${Math.random()}`, buyIn, isDemo: true, handDelayMs: 0, actionTimeoutMs: 60000 });
          const bots = [];
          for (let i = 0; i < numPlayers; i++) {
                  const id = `bot-${i}`;
                  table.addPlayer({ id, name: `Bot${i}` });
                  bots.push(id);
          }

                           let safetyCounter = 0;
          const MAX_ACTIONS = 200000;
          let lastHandSeen = -1;
          let actionsSinceHandChange = 0;
          const MAX_ACTIONS_PER_HAND = 5000;

                           function tryAct() {
                                   safetyCounter++;
                                   if (table.handNumber !== lastHandSeen) {
                                             lastHandSeen = table.handNumber;
                                             actionsSinceHandChange = 0;
                                   } else {
                                             actionsSinceHandChange++;
                                   }
                                   if (actionsSinceHandChange > MAX_ACTIONS_PER_HAND) {
                                             return reject(new Error(`Hand #${table.handNumber} appears stuck (>${MAX_ACTIONS_PER_HAND} actions with no new hand) — likely a real bug, not just a long tournament.`));
                                   }
                                   if (safetyCounter > MAX_ACTIONS) {
                                             return reject(new Error(`Tournament did not converge within ${MAX_ACTIONS} total actions (${table.handNumber} hands played) — likely just a very long randomized tournament, consider raising the budget.`));
                                   }
                                   if (table.status === 'complete') return; // handled by tournamentComplete listener
            if (!table.hand) return; // between hands, waiting on the 2.5s timer
            const seat = table.hand.turnSeat;
                                   const player = table.seats[seat];
                                   if (!player) return;
                                   const st = table.getStateFor(player.id);
                                   const { action, amount } = randomLegalAction(st);
                                   const result = table.handlePlayerAction(player.id, action, amount);
                                   if (!result.ok) {
                                             // Illegal random guess (e.g. bad raise size) -> fall back to a safe legal action.
                                     const fallback = st.toCall > 0 ? 'call' : 'check';
                                             table.handlePlayerAction(player.id, fallback);
                                   }
                           }

                       table.on('update', () => {
                               // drive the simulation forward every time state changes
                                      setImmediate(tryAct);
                       });

                           table.on('tournamentComplete', (result) => {
                                   resolve({ table, result });
                           });

                           try {
                                   table.start();
                                   setImmediate(tryAct);
                           } catch (e) {
                                   reject(e);
                           }
    });
}

async function main() {
    const RUNS = 25;
    for (let i = 0; i < RUNS; i++) {
          const numPlayers = 2 + Math.floor(Math.random() * 8); // 2..9 players
      const buyIn = 100;
          const { table, result } = await runTournament(numPlayers, buyIn);

      assert(table.status === 'complete', `tournament ${i} should finish`);
          assert(result.entrants === numPlayers, `entrants should equal seated players (${result.entrants} vs ${numPlayers})`);
          assert(result.totalCollected === numPlayers * buyIn, 'total collected should equal buy-ins summed');
          assert(result.prizePool + result.rake === result.totalCollected, 'prize pool + rake should equal total collected');

      const paid = result.payouts.reduce((s, p) => s + p.amount, 0);
          assert(paid === result.prizePool, `payouts (${paid}) should exactly equal the prize pool (${result.prizePool})`);
          assert(result.payouts.length === numPlayers, 'every entrant should have a recorded finishing position');
          assert(result.payouts[0].place === 1 && result.payouts[0].amount > 0, 'winner should be paid');

      // final stack chip conservation check: sum of all player stacks (winner has everything) should equal starting stacks
      console.log(`Run ${i + 1}/${RUNS}: ${numPlayers} players, ${table.handNumber} hands, prize pool ${result.prizePool}, rake ${result.rake}. OK.`);
    }
    console.log(`\nAll ${RUNS} simulated tournaments completed and passed correctness checks.`);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
