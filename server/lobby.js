// lobby.js - manages the set of live tables.
// MVP scope: one public "hourly" sit-n-go, created automatically every hour
// (24/7), plus unlimited on-demand "demo" tables so testers/PR contacts can
// try the game immediately without waiting for the clock.
//
// Everything here runs on play-money chips only. Real deposits/withdrawals
// are NOT wired up yet (see README "Roadmap" for the phase-2 plan).

const EventEmitter = require('events');
const { Table } = require('./table');

const HOURLY_BUY_IN = 100;
const DEMO_BUY_IN = 100;

class Lobby extends EventEmitter {
    constructor() {
          super();
          this.tables = new Map();
          this.nextDemoId = 1;
          this._startHourlyScheduler();
          this._ensureUpcomingHourlyTable();
    }

  _tableId(prefix) {
        return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  _ensureUpcomingHourlyTable() {
        const hasOpenHourly = [...this.tables.values()].some(t => t.isHourly && t.status === 'waiting');
        if (hasOpenHourly) return;
        const id = this._tableId('hourly');
        const table = new Table({ id, buyIn: HOURLY_BUY_IN, isDemo: false });
        table.isHourly = true;
        table.scheduledStart = this._nextTopOfHour();
        this._wire(table);
        this.tables.set(id, table);
        this.emit('lobbyUpdate');
  }

  _nextTopOfHour() {
        const d = new Date();
        d.setMinutes(0, 0, 0);
        d.setHours(d.getHours() + 1);
        return d.getTime();
  }

  _startHourlyScheduler() {
        setInterval(() => {
                const now = Date.now();
                for (const table of this.tables.values()) {
                          if (table.isHourly && table.status === 'waiting' && table.scheduledStart <= now) {
                                      if (table.playerCount() >= 2) {
                                                    table.start();
                                      } else {
                                                    table.addLog('Not enough players signed in, hourly table cancelled, no fees were charged.');
                                                    table.status = 'complete';
                                                    table.finalResult = { entrants: 0, cancelled: true };
                                                    table.emit('update');
                                      }
                                      this._ensureUpcomingHourlyTable();
                          }
                }
                for (const [id, table] of this.tables) {
                          if (table.status === 'complete' && now - table.createdAt > 20 * 60 * 1000) {
                                      this.tables.delete(id);
                          }
                }
                this.emit('lobbyUpdate');
        }, 5000);
  }

  createDemoTable() {
        const id = this._tableId('demo');
        const table = new Table({ id, buyIn: DEMO_BUY_IN, isDemo: true });
        table.isHourly = false;
        this._wire(table);
        this.tables.set(id, table);
        this.emit('lobbyUpdate');
        return table;
  }

  _wire(table) {
        table.on('update', () => this.emit('tableUpdate', table.id));
        table.on('handComplete', (payload) => this.emit('handComplete', table.id, payload));
        table.on('tournamentComplete', (result) => this.emit('tournamentComplete', table.id, result));
  }

  getTable(id) {
        return this.tables.get(id);
  }

  findJoinableHourly() {
        return [...this.tables.values()].find(t => t.isHourly && t.status === 'waiting' && t.playerCount() < t.maxSeats);
  }

  getPublicLobbyState() {
        const list = [...this.tables.values()].map(t => ({
                id: t.id,
                isDemo: t.isDemo,
                isHourly: !!t.isHourly,
                status: t.status,
                players: t.playerCount(),
                maxSeats: t.maxSeats,
                buyIn: t.buyIn,
                scheduledStart: t.scheduledStart || null,
                handNumber: t.handNumber,
        }));
        list.sort((a, b) => (b.isHourly - a.isHourly) || (a.status === 'waiting' ? -1 : 1));
        return list;
  }
}

module.exports = { Lobby, HOURLY_BUY_IN, DEMO_BUY_IN };
