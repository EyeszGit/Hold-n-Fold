// store.js - zero-cost persistence for the MVP.
// A single JSON file on disk instead of a paid database service. Good enough
// for a play-money proof of concept; swap for Postgres/Mongo once real money
// and concurrent write volume justify the expense (see README roadmap).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

function loadRaw() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {} }, null, 2));
    try {
          return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
          return { users: {} };
    }
}

let db = loadRaw();
let saveTimer = null;
function persist() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
          fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
          saveTimer = null;
    }, 500);
}

function normalizeName(name) {
    return String(name || '').trim().slice(0, 20);
}

function registerOrLogin(name) {
    const clean = normalizeName(name);
    if (!clean) return { ok: false, error: 'Please enter a display name.' };
    const key = clean.toLowerCase();
    let user = Object.values(db.users).find(u => u.nameLower === key);
    if (!user) {
          const id = crypto.randomBytes(8).toString('hex');
          user = {
                  id, name: clean, nameLower: key,
                  createdAt: Date.now(),
                  chipBalance: 1000,
                  gamesPlayed: 0,
                  wins: 0,
                  cashes: 0,
                  totalWinnings: 0,
                  history: [],
          };
          db.users[id] = user;
          persist();
    }
    return { ok: true, user: publicUser(user) };
}

function publicUser(u) {
    return {
          id: u.id, name: u.name, chipBalance: u.chipBalance,
          gamesPlayed: u.gamesPlayed, wins: u.wins, cashes: u.cashes,
          totalWinnings: u.totalWinnings,
    };
}

function getUser(id) {
    const u = db.users[id];
    return u ? publicUser(u) : null;
}

function recordTournamentResult(userId, { place, amount, buyIn, tableId }) {
    const u = db.users[userId];
    if (!u) return;
    u.gamesPlayed += 1;
    u.chipBalance += amount;
    if (place === 1) u.wins += 1;
    if (place <= 3) u.cashes += 1;
    u.totalWinnings += (amount - buyIn);
    u.history.unshift({ tableId, place, amount, buyIn, at: Date.now() });
    u.history = u.history.slice(0, 50);
    persist();
}

function deductBuyIn(userId, amount) {
    const u = db.users[userId];
    if (!u) return { ok: false, error: 'Unknown user.' };
    if (u.chipBalance < amount) return { ok: false, error: 'Not enough play chips. Refill from your dashboard.' };
    u.chipBalance -= amount;
    persist();
    return { ok: true };
}

function refundBuyIn(userId, amount) {
    const u = db.users[userId];
    if (!u) return;
    u.chipBalance += amount;
    persist();
}

function topUpIfLow(userId) {
    const u = db.users[userId];
    if (!u) return;
    if (u.chipBalance < 100) {
          u.chipBalance += 1000;
          persist();
    }
}

function leaderboard(limit = 20) {
    return Object.values(db.users)
      .sort((a, b) => b.totalWinnings - a.totalWinnings)
      .slice(0, limit)
      .map(publicUser);
}

module.exports = {
    registerOrLogin, getUser, recordTournamentResult,
    deductBuyIn, refundBuyIn, topUpIfLow, leaderboard,
};
