// table.js - Texas Hold'em sit-n-go tournament table (play-money MVP).
// Single-table SNG: play continues until one player remains with all the chips.
// Finishing positions are recorded in reverse elimination order.
// Top 3 finishers split a prize pool (total buy-ins minus house rake).

const EventEmitter = require('events');
const { Deck, cardLabel } = require('./pokerEngine');
const { evaluate7, compareScores, describe } = require('./handEvaluator');

const ACTION_TIMEOUT_MS = 25000;
const HANDS_PER_BLIND_LEVEL = 8;
const DEFAULT_BLIND_LEVELS = [
  { sb: 10, bb: 20 },
  { sb: 15, bb: 30 },
  { sb: 25, bb: 50 },
  { sb: 50, bb: 100 },
  { sb: 75, bb: 150 },
  { sb: 100, bb: 200 },
  { sb: 150, bb: 300 },
  { sb: 200, bb: 400 },
  ];
const STARTING_STACK = 1000;
const PAYOUT_SPLITS = [0.5, 0.3, 0.2]; // 1st, 2nd, 3rd share of prize pool
const RAKE_PERCENT = 0.10; // house-bank cut
const MAX_SEATS = 10;

class Table extends EventEmitter {
    constructor({ id, buyIn = 100, isDemo = false, maxSeats = MAX_SEATS, handDelayMs = 2500, actionTimeoutMs = ACTION_TIMEOUT_MS }) {
          super();
          this.id = id;
          this.buyIn = buyIn;
          this.isDemo = isDemo;
          this.maxSeats = maxSeats;
          this.handDelayMs = handDelayMs;
          this.actionTimeoutMs = actionTimeoutMs;
          this.seats = new Array(maxSeats).fill(null);
          this.status = 'waiting'; // waiting -> running -> complete
      this.handNumber = 0;
          this.buttonSeat = 0;
          this.blindLevelIndex = 0;
          this.log = [];
          this.standings = []; // filled as players bust, reversed at the end
      this.createdAt = Date.now();
          this._turnTimer = null;
          this.hand = null; // active hand state
    }

  addLog(msg) {
        this.log.push({ t: Date.now(), msg });
        if (this.log.length > 200) this.log.shift();
        this.emit('log', msg);
  }

  playerCount() {
        return this.seats.filter(Boolean).length;
  }

  addPlayer({ id, name }) {
        if (this.status !== 'waiting') return null;
        if (this.seats.some(s => s && s.id === id)) return null;
        const seatIdx = this.seats.findIndex(s => s === null);
        if (seatIdx === -1) return null;
        this.seats[seatIdx] = {
                id, name, seat: seatIdx,
                stack: STARTING_STACK,
                status: 'active', // active | folded | allin | eliminated
                holeCards: [],
                contributedThisStreet: 0,
                contributedThisHand: 0,
                hasActedThisStreet: false,
        };
        this.addLog(`${name} took seat ${seatIdx + 1} (${this.playerCount()}/${this.maxSeats}).`);
        this.emit('update');
        return seatIdx;
  }

  removePlayer(id) {
        const idx = this.seats.findIndex(s => s && s.id === id);
        if (idx === -1) return;
        if (this.status === 'waiting') {
                this.addLog(`${this.seats[idx].name} left before the tournament started.`);
                this.seats[idx] = null;
                this.emit('update');
        } else if (this.status === 'running') {
                // Mark as sitting out; they auto-fold every hand until blinded out.
          this.seats[idx].isSittingOut = true;
                this.addLog(`${this.seats[idx].name} disconnected and will auto-fold.`);
        }
  }

  blindLevels() {
        return DEFAULT_BLIND_LEVELS;
  }

  currentBlinds() {
        const levels = this.blindLevels();
        return levels[Math.min(this.blindLevelIndex, levels.length - 1)];
  }

  start() {
        if (this.status !== 'waiting') return false;
        if (this.playerCount() < 2) return false;
        this.status = 'running';
        this.addLog(`Tournament started with ${this.playerCount()} players. Buy-in ${this.buyIn} chips (play money).`);
        this.emit('update');
        this.startHand();
        return true;
  }

  activeSeatedPlayers() {
        return this.seats.filter(s => s && s.status !== 'eliminated');
  }

  nextOccupiedSeat(fromSeat) {
        const n = this.maxSeats;
        for (let i = 1; i <= n; i++) {
                const idx = (fromSeat + i) % n;
                const p = this.seats[idx];
                if (p && p.status !== 'eliminated') return idx;
        }
        return -1;
  }

  startHand() {
        const remaining = this.activeSeatedPlayers();
        if (remaining.length <= 1) {
                this.finishTournament();
                return;
        }
        this.handNumber++;
        if (this.handNumber > 1 && (this.handNumber - 1) % HANDS_PER_BLIND_LEVEL === 0) {
                this.blindLevelIndex = Math.min(this.blindLevelIndex + 1, this.blindLevels().length - 1);
                const b = this.currentBlinds();
                this.addLog(`Blinds increase: ${b.sb}/${b.bb}.`);
        }

      for (const p of remaining) {
              p.status = 'active';
              p.holeCards = [];
              p.contributedThisStreet = 0;
              p.contributedThisHand = 0;
              p.hasActedThisStreet = false;
              if (p.isSittingOut) p.autoFold = true;
      }

      this.buttonSeat = this.nextOccupiedSeat(this.buttonSeat === 0 && this.handNumber === 1 ? -1 : this.buttonSeat);
        if (this.handNumber === 1) this.buttonSeat = remaining[0].seat;

      const deck = new Deck();
        const blinds = this.currentBlinds();

      let sbSeat, bbSeat;
        if (remaining.length === 2) {
                // heads-up: button posts small blind
          sbSeat = this.buttonSeat;
                bbSeat = this.nextOccupiedSeat(this.buttonSeat);
        } else {
                sbSeat = this.nextOccupiedSeat(this.buttonSeat);
                bbSeat = this.nextOccupiedSeat(sbSeat);
        }

      this.hand = {
              deck,
              community: [],
              street: 'preflop',
              pot: 0,
              currentBet: blinds.bb,
              minRaise: blinds.bb,
              sbSeat, bbSeat,
              lastAggressorSeat: bbSeat,
              turnSeat: null,
              revealed: {},
      };

      // deal hole cards
      for (const p of remaining) p.holeCards = deck.draw(2);

      this.postBlind(sbSeat, blinds.sb);
        this.postBlind(bbSeat, blinds.bb);

      const firstToAct = remaining.length === 2
          ? this.nextOccupiedSeat(bbSeat) // heads-up preflop: button/SB acts... handled by nextOccupiedSeat from bb
              : this.nextOccupiedSeat(bbSeat);
        this.hand.turnSeat = firstToAct;

      this.addLog(`Hand #${this.handNumber} dealt. Button: seat ${this.buttonSeat + 1}. Blinds ${blinds.sb}/${blinds.bb}.`);
        this.emit('update');
        this.armTurnTimer();
  }

  postBlind(seat, amount) {
        const p = this.seats[seat];
        const post = Math.min(amount, p.stack);
        p.stack -= post;
        p.contributedThisStreet += post;
        p.contributedThisHand += post;
        if (p.stack === 0) p.status = 'allin';
  }

  armTurnTimer() {
        this.clearTurnTimer();
        const seat = this.hand?.turnSeat;
        if (seat === null || seat === undefined) return;
        const player = this.seats[seat];
        if (player && player.autoFold) {
                this._turnTimer = setTimeout(() => this.handlePlayerAction(player.id, 'fold'), 500);
                return;
        }
        this._turnTimer = setTimeout(() => {
                const p = this.seats[seat];
                if (!p) return;
                const toCall = this.hand.currentBet - p.contributedThisStreet;
                this.handlePlayerAction(p.id, toCall > 0 ? 'fold' : 'check');
        }, this.actionTimeoutMs);
  }

  clearTurnTimer() {
        if (this._turnTimer) clearTimeout(this._turnTimer);
        this._turnTimer = null;
  }

  playersStillInHand() {
        return this.seats.filter(s => s && (s.status === 'active' || s.status === 'allin'));
  }

  handlePlayerAction(playerId, action, amount) {
        if (this.status !== 'running' || !this.hand) return { ok: false, error: 'No active hand.' };
        const seat = this.seats.findIndex(s => s && s.id === playerId);
        if (seat === -1 || seat !== this.hand.turnSeat) return { ok: false, error: 'Not your turn.' };
        const p = this.seats[seat];
        const h = this.hand;
        const toCall = h.currentBet - p.contributedThisStreet;

      if (action === 'fold') {
              p.status = 'folded';
              this.addLog(`${p.name} folds.`);
      } else if (action === 'check') {
              if (toCall > 0) return { ok: false, error: 'Cannot check, must call or fold.' };
              this.addLog(`${p.name} checks.`);
      } else if (action === 'call') {
              const callAmt = Math.min(toCall, p.stack);
              p.stack -= callAmt;
              p.contributedThisStreet += callAmt;
              p.contributedThisHand += callAmt;
              if (p.stack === 0) p.status = 'allin';
              this.addLog(`${p.name} calls ${callAmt}.`);
      } else if (action === 'raise') {

          const targetTotal = Math.max(0, Math.floor(amount || 0));
              const addAmount = targetTotal - p.contributedThisStreet;
              if (addAmount <= 0 || addAmount > p.stack) {
                        if (addAmount === p.stack) {
                        } else {
                                    return { ok: false, error: 'Invalid raise amount.' };
                        }
              }
              const isAllIn = addAmount >= p.stack;
              const actualAdd = isAllIn ? p.stack : addAmount;
              const newTotal = p.contributedThisStreet + actualAdd;
              const minLegal = h.currentBet + h.minRaise;
              if (!isAllIn && newTotal < minLegal) {
                        return { ok: false, error: `Raise must be at least ${minLegal}.` };
              }
              if (newTotal > h.currentBet) {
                        h.minRaise = Math.max(h.minRaise, newTotal - h.currentBet);
                        h.currentBet = newTotal;
                        h.lastAggressorSeat = seat;
                        for (const other of this.playersStillInHand()) {
                                    if (other.seat !== seat) other.hasActedThisStreet = false;
                        }
              }
              p.stack -= actualAdd;
              p.contributedThisStreet = newTotal;
              p.contributedThisHand += actualAdd;
              if (p.stack === 0) p.status = 'allin';
              this.addLog(`${p.name} ${isAllIn ? 'goes all-in for' : 'bets/raises to'} ${newTotal}.`);
      } else {
              return { ok: false, error: 'Unknown action.' };
      }

      p.hasActedThisStreet = true;
        this.clearTurnTimer();
        this.advance();
        return { ok: true };
  }

  advance() {
        const inHand = this.playersStillInHand();
        const notFolded = this.seats.filter(s => s && s.status !== 'folded' && s.status !== 'eliminated');

      if (notFolded.length === 1) {
              this.awardPotToSingleWinner(notFolded[0]);
              return;
      }

      const contestants = inHand.filter(s => s.status === 'active');
        const roundDone = contestants.length === 0 || contestants.every(s => {
                return s.hasActedThisStreet && s.contributedThisStreet === this.hand.currentBet;
        });

      if (roundDone) {
              this.settleStreetContributions();
              if (contestants.length <= 1 && inHand.filter(s => s.status === 'allin').length >= 1) {
                        this.runOutBoardAndShowdown();
                        return;
              }
              this.nextStreet();
              return;
      }

      let next = this.nextOccupiedSeat(this.hand.turnSeat);
        let loops = 0;
        while (loops < this.maxSeats) {
                const p = this.seats[next];
                if (p && p.status === 'active') break;
                next = this.nextOccupiedSeat(next);
                loops++;
        }
        this.hand.turnSeat = next;
        this.emit('update');
        this.armTurnTimer();
  }

  settleStreetContributions() {
        const total = this.seats.reduce((sum, s) => sum + (s ? s.contributedThisStreet : 0), 0);
        this.hand.pot += total;
        for (const s of this.seats) {
                if (s) { s.contributedThisStreet = 0; s.hasActedThisStreet = false; }
        }
        this.hand.currentBet = 0;
        this.hand.minRaise = this.currentBlinds().bb;
  }

  nextStreet() {
        const h = this.hand;
        if (h.street === 'preflop') {
                h.community.push(...h.deck.draw(3));
                h.street = 'flop';
        } else if (h.street === 'flop') {
                h.community.push(...h.deck.draw(1));
                h.street = 'turn';
        } else if (h.street === 'turn') {
                h.community.push(...h.deck.draw(1));
                h.street = 'river';
        } else {
                this.showdown();
                return;
        }
        this.addLog(`${h.street.toUpperCase()}: ${h.community.map(cardLabel).join(' ')}`);
        let seat = this.nextOccupiedSeat(this.buttonSeat);
        let loops = 0;
        while (loops < this.maxSeats) {
                const p = this.seats[seat];
                if (p && p.status === 'active') break;
                seat = this.nextOccupiedSeat(seat);
                loops++;
        }

      const anyActive = this.seats.some(s => s && s.status === 'active');
        if (!anyActive) {
                this.runOutBoardAndShowdown();
                return;
        }
        h.turnSeat = seat;
        this.emit('update');
        this.armTurnTimer();
  }

  runOutBoardAndShowdown() {
        const h = this.hand;
        while (h.community.length < 5) {
                if (h.street === 'preflop') { h.community.push(...h.deck.draw(3)); h.street = 'flop'; }
                else if (h.street === 'flop') { h.community.push(...h.deck.draw(1)); h.street = 'turn'; }
                else if (h.street === 'turn') { h.community.push(...h.deck.draw(1)); h.street = 'river'; }
                else break;
        }
        this.addLog(`Board runs out: ${h.community.map(cardLabel).join(' ')}`);
        this.showdown();
  }

  awardPotToSingleWinner(winner) {
        const h = this.hand;
        const total = h.pot + this.seats.reduce((sum, s) => sum + (s ? s.contributedThisStreet : 0), 0);
        winner.stack += total;
        this.addLog(`${winner.name} wins ${total} chips (everyone else folded).`);
        this.finishHand();
  }

  showdown() {
        const h = this.hand;
        const total = h.pot + this.seats.reduce((sum, s) => sum + (s ? s.contributedThisStreet : 0), 0);
        const contestants = this.seats.filter(s => s && (s.status === 'active' || s.status === 'allin'));

      const byContribution = [...contestants].sort((a, b) => a.contributedThisHand - b.contributedThisHand);
        const pots = [];
        let prevLevel = 0;
        for (let i = 0; i < byContribution.length; i++) {
                const level = byContribution[i].contributedThisHand;
                if (level <= prevLevel) continue;
                const eligible = contestants.filter(c => c.contributedThisHand >= level);
                const layerAmount = (level - prevLevel) * this.seats.filter(s => s && s.contributedThisHand >= level).length;
                pots.push({ amount: layerAmount, eligible: eligible.map(c => c.seat) });
                prevLevel = level;
        }
        const potsSum = pots.reduce((s, p) => s + p.amount, 0);
        if (pots.length > 0 && potsSum < total) pots[0].amount += (total - potsSum);
        if (pots.length === 0) pots.push({ amount: total, eligible: contestants.map(c => c.seat) });

      const scores = {};
        for (const c of contestants) {
                scores[c.seat] = evaluate7([...c.holeCards, ...h.community]);
        }

      const results = [];
        for (const pot of pots) {
                let bestSeats = [];
                let bestScore = null;
                for (const seat of pot.eligible) {
                          const score = scores[seat];
                          if (!bestScore || compareScores(score, bestScore) > 0) { bestScore = score; bestSeats = [seat]; }
                          else if (compareScores(score, bestScore) === 0) bestSeats.push(seat);
                }
                const share = Math.floor(pot.amount / bestSeats.length);
                let remainder = pot.amount - share * bestSeats.length;
                for (const seat of bestSeats) {
                          const give = share + (remainder > 0 ? 1 : 0);
                          if (remainder > 0) remainder--;
                          this.seats[seat].stack += give;
                          results.push({ seat, name: this.seats[seat].name, amount: give, hand: describe(bestScore) });
                }
        }

      for (const c of contestants) {
              this.addLog(`${c.name} shows ${c.holeCards.map(cardLabel).join(' ')} (${describe(scores[c.seat])}).`);
      }
        for (const r of results) {
                this.addLog(`${r.name} wins ${r.amount} chips with ${r.hand}.`);
        }
        this.emit('handComplete', { handNumber: this.handNumber, results, community: h.community });
        this.finishHand();
  }

  finishHand() {
        this.hand = null;
        this.clearTurnTimer();
        const busted = this.seats.filter(s => s && s.status !== 'eliminated' && s.stack === 0);
        if (busted.length) {
                busted.sort((a, b) => b.contributedThisHand - a.contributedThisHand);
                for (const b of busted) {
                          b.status = 'eliminated';
                          this.standings.push({ id: b.id, name: b.name });
                          this.addLog(`${b.name} is eliminated.`);
                }
        }
        this.emit('update');

      const remaining = this.activeSeatedPlayers();
        if (remaining.length <= 1) {
                this.finishTournament();
        } else {
                setTimeout(() => this.startHand(), this.handDelayMs);
        }
  }

  finishTournament() {
        this.status = 'complete';
        this.clearTurnTimer();
        const winner = this.activeSeatedPlayers()[0];
        if (winner) this.standings.push({ id: winner.id, name: winner.name });
        const finishOrder = [...this.standings].reverse();

      const entrants = finishOrder.length;
        const totalCollected = entrants * this.buyIn;
        const prizePool = Math.floor(totalCollected * (1 - RAKE_PERCENT));
        const rake = totalCollected - prizePool;

      const paidSpots = Math.min(entrants, PAYOUT_SPLITS.length);
        const weightSum = PAYOUT_SPLITS.slice(0, paidSpots).reduce((s, w) => s + w, 0);
        let distributed = 0;
        const payouts = finishOrder.map((p, idx) => {
                const place = idx + 1;
                let amount = 0;
                if (place <= paidSpots) {
                          if (place < paidSpots) {
                                      amount = Math.floor(prizePool * (PAYOUT_SPLITS[idx] / weightSum));
                                      distributed += amount;
                          } else {
                                      amount = prizePool - distributed;
                          }
                }
                return { place, id: p.id, name: p.name, amount };
        });

      this.finalResult = { entrants, buyIn: this.buyIn, totalCollected, prizePool, rake, payouts };
        this.addLog(`Tournament complete. Prize pool ${prizePool} (house rake ${rake}).`);
        payouts.slice(0, 3).forEach(p => this.addLog(`${p.place}${p.place === 1 ? 'st' : p.place === 2 ? 'nd' : 'rd'} place: ${p.name} — ${p.amount} chips.`));
        this.emit('tournamentComplete', this.finalResult);
        this.emit('update');
  }

  getPublicState() {
        return {
                id: this.id,
                isDemo: this.isDemo,
                status: this.status,
                buyIn: this.buyIn,
                handNumber: this.handNumber,
                blinds: this.currentBlinds(),
                buttonSeat: this.buttonSeat,
                seats: this.seats.map(s => s && ({
                          seat: s.seat, name: s.name, stack: s.stack, status: s.status,
                          contributedThisStreet: s.contributedThisStreet,
                })),
                hand: this.hand && {
                          street: this.hand.street,
                          community: this.hand.community.map(cardLabel),
                          pot: this.hand.pot + this.seats.reduce((sum, s) => sum + (s ? s.contributedThisStreet : 0), 0),
                          currentBet: this.hand.currentBet,
                          turnSeat: this.hand.turnSeat,
                },
                log: this.log.slice(-30).map(l => l.msg),
                finalResult: this.finalResult || null,
        };
  }

  getStateFor(playerId) {
        const base = this.getPublicState();
        const me = this.seats.find(s => s && s.id === playerId);
        base.yourSeat = me ? me.seat : null;
        base.yourHoleCards = (me && this.hand) ? me.holeCards.map(cardLabel) : [];
        base.toCall = (me && this.hand) ? Math.max(0, this.hand.currentBet - me.contributedThisStreet) : 0;
        base.minRaiseTo = (me && this.hand) ? this.hand.currentBet + this.hand.minRaise : 0;
        base.isYourTurn = !!(me && this.hand && this.hand.turnSeat === me.seat);
        return base;
  }
}

module.exports = { Table, STARTING_STACK, PAYOUT_SPLITS, RAKE_PERCENT };
