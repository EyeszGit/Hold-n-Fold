// server.js - Hold-n-Fold MVP: one Node process, no paid services required.
// Serves the static frontend, exposes a tiny REST API, and runs the
// real-time table protocol over Socket.io. Play money only.

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { Lobby } = require('./lobby');
const store = require('./store');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const lobby = new Lobby();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/register', (req, res) => {
    const result = store.registerOrLogin(req.body.name);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
});

app.get('/api/dashboard/:id', (req, res) => {
    const user = store.getUser(req.params.id);
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    res.json({ ok: true, user });
});

app.get('/api/leaderboard', (req, res) => {
    res.json({ ok: true, leaderboard: store.leaderboard() });
});

app.get('/api/lobby', (req, res) => {
    res.json({ ok: true, tables: lobby.getPublicLobbyState() });
});

app.get('/healthz', (req, res) => res.send('ok'));

const socketMeta = new Map();

function broadcastTableState(tableId) {
    const table = lobby.getTable(tableId);
    if (!table) return;
    const room = io.sockets.adapter.rooms.get(tableId);
    if (!room) return;
    for (const sockId of room) {
          const sock = io.sockets.sockets.get(sockId);
          const meta = socketMeta.get(sockId);
          if (sock && meta) sock.emit('table:state', table.getStateFor(meta.userId));
    }
}

lobby.on('tableUpdate', (tableId) => broadcastTableState(tableId));
lobby.on('lobbyUpdate', () => io.emit('lobby:state', lobby.getPublicLobbyState()));
lobby.on('tournamentComplete', (tableId, result) => {
    const table = lobby.getTable(tableId);
    if (!table || !result || result.cancelled) return;
    for (const payout of result.payouts) {
          store.recordTournamentResult(payout.id, {
                  place: payout.place, amount: payout.amount, buyIn: table.buyIn, tableId,
          });
    }
    broadcastTableState(tableId);
});

io.on('connection', (socket) => {
    socket.emit('lobby:state', lobby.getPublicLobbyState());

        socket.on('lobby:refresh', () => {
              socket.emit('lobby:state', lobby.getPublicLobbyState());
        });

        function joinTable(table, userId) {
              if (!table) return socket.emit('table:error', 'Table not found.');
              const buyInResult = store.deductBuyIn(userId, table.buyIn);
              if (!buyInResult.ok) return socket.emit('table:error', buyInResult.error);
              const seat = table.addPlayer({ id: userId, name: socketMeta.get(socket.id)?.name || 'Player' });
              if (seat === null) {
                      store.refundBuyIn(userId, table.buyIn);
                      return socket.emit('table:error', 'Table is full or already running.');
              }
              socket.join(table.id);
              const meta = socketMeta.get(socket.id) || {};
              meta.tableId = table.id;
              socketMeta.set(socket.id, meta);
              socket.emit('table:joined', { tableId: table.id });
              broadcastTableState(table.id);

      if (table.isDemo && table.playerCount() >= 2 && table.status === 'waiting') {
              table.start();
      }
        }

        socket.on('table:register', ({ userId, name }) => {
              const meta = socketMeta.get(socket.id) || {};
              meta.userId = userId;
              meta.name = name;
              socketMeta.set(socket.id, meta);
        });

        socket.on('table:joinDemo', ({ userId }) => {
              store.topUpIfLow(userId);
              let table = [...lobby.tables.values()].find(t => t.isDemo && t.status === 'waiting' && t.playerCount() < t.maxSeats);
              if (!table) table = lobby.createDemoTable();
              joinTable(table, userId);
        });

        socket.on('table:joinHourly', ({ userId }) => {
              store.topUpIfLow(userId);
              const table = lobby.findJoinableHourly();
              joinTable(table, userId);
        });

        socket.on('table:spectate', ({ tableId }) => {
              socket.join(tableId);
              const meta = socketMeta.get(socket.id) || {};
              meta.tableId = tableId;
              socketMeta.set(socket.id, meta);
              broadcastTableState(tableId);
        });

        socket.on('table:action', ({ tableId, action, amount }) => {
              const table = lobby.getTable(tableId);
              const meta = socketMeta.get(socket.id);
              if (!table || !meta) return;
              const result = table.handlePlayerAction(meta.userId, action, amount);
              if (!result.ok) socket.emit('table:error', result.error);
        });

        socket.on('table:leave', ({ tableId }) => {
              const table = lobby.getTable(tableId);
              const meta = socketMeta.get(socket.id);
              if (table && meta) table.removePlayer(meta.userId);
              socket.leave(tableId);
        });

        socket.on('disconnect', () => {
              const meta = socketMeta.get(socket.id);
              if (meta && meta.tableId) {
                      const table = lobby.getTable(meta.tableId);
                      if (table) table.removePlayer(meta.userId);
              }
              socketMeta.delete(socket.id);
        });
});

server.listen(PORT, () => {
    console.log(`Hold-n-Fold MVP listening on http://localhost:${PORT}`);
    console.log('Play money only. No real crypto is processed by this build.');
});

module.exports = { app, server, lobby };
