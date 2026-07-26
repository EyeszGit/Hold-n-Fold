// pokerEngine.js - deck and card utilities
const SUITS = ['S', 'H', 'D', 'C'];
const RANK_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function rankName(rank) {
    return RANK_NAMES[rank] || String(rank);
}

function cardLabel(card) {
    return `${rankName(card.rank)}${card.suit}`;
}

class Deck {
    constructor() {
          this.cards = [];
          for (const suit of SUITS) {
                  for (let rank = 2; rank <= 14; rank++) {
                            this.cards.push({ rank, suit });
                  }
          }
          this.shuffle();
    }

  // Fisher-Yates shuffle using crypto-strength randomness where available.
  shuffle() {
        const crypto = require('crypto');
        for (let i = this.cards.length - 1; i > 0; i--) {
                const buf = crypto.randomBytes(4);
                const rand = buf.readUInt32BE(0) / 0xffffffff;
                const j = Math.floor(rand * (i + 1));
                [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
  }

  draw(n = 1) {
        return this.cards.splice(0, n);
  }
}

module.exports = { Deck, cardLabel, rankName, SUITS };
