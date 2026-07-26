// app.js - single-page client for the Hold-n-Fold MVP. No build step required.
const socket = io();

const state = {
    userId: localStorage.getItem('hnf_userId') || null,
    name: localStorage.getItem('hnf_name') || null,
    currentTableId: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showView(view) {
    $$('.view').forEach(v => v.classList.add('hidden'));
    const el = document.getElementById(`view-${view}`);
    if (el) el.classList.remove('hidden');
    $$('.navBtn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
}

function boot() {
    if (state.userId) {
          $('#whoName').textContent = state.name;
          socket.emit('table:register', { userId: state.userId, name: state.name });
          showView('lobby');
          refreshDashboard();
    } else {
          showView('signin');
    }
}

$('#signInBtn').addEventListener('click', async () => {
    const name = $('#nameInput').value.trim();
    if (!name) return;
    const res = await fetch('/api/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!data.ok) return alert(data.error || 'Could not register.');
    state.userId = data.user.id;
    state.name = data.user.name;
    localStorage.setItem('hnf_userId', state.userId);
    localStorage.setItem('hnf_name', state.name);
    boot();
});

$$('.navBtn').forEach(btn => btn.addEventListener('click', () => {
    showView(btn.dataset.view);
    if (btn.dataset.view === 'dashboard') refreshDashboard();
    if (btn.dataset.view === 'lobby') socket.emit('lobby:refresh');
}));

$('#joinHourlyBtn').addEventListener('click', () => socket.emit('table:joinHourly', { userId: state.userId }));
$('#joinDemoBtn').addEventListener('click', () => socket.emit('table:joinDemo', { userId: state.userId }));
$('#leaveTableBtn').addEventListener('click', () => {
    if (state.currentTableId) socket.emit('table:leave', { tableId: state.currentTableId });
    state.currentTableId = null;
    showView('lobby');
});

$('#actionBar').addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (!action || !state.currentTableId) return;
    if (action === 'raise') {
          const amount = Number($('#raiseAmount').value || 0);
          socket.emit('table:action', { tableId: state.currentTableId, action: 'raise', amount });
    } else {
          socket.emit('table:action', { tableId: state.currentTableId, action });
    }
});

socket.on('table:error', (msg) => alert(msg));

socket.on('table:joined', ({ tableId }) => {
    state.currentTableId = tableId;
    showView('table');
});

socket.on('lobby:state', (tables) => renderLobby(tables));

function fmtCountdown(ts) {
    if (!ts) return '';
    const secs = Math.max(0, Math.floor((ts - Date.now()) / 1000));
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${m}m ${s}s`;
}

function renderLobby(tables) {
    const list = $('#tableList');
    list.innerHTML = '';
    if (!tables.length) {
          list.innerHTML = '<div class="muted">No tables yet — click a button above to start one.</div>';
          return;
    }
    for (const t of tables) {
          const row = document.createElement('div');
          row.className = 'tableRow';
          const label = t.isHourly ? 'Hourly Public Table' : 'Demo Table';
          const statusPill = t.status === 'waiting'
            ? (t.isHourly ? `starts in ${fmtCountdown(t.scheduledStart)}` : 'waiting for players')
                  : (t.status === 'running' ? 'in progress' : 'finished');
          row.innerHTML = `
                <div><strong>${label}</strong> — buy-in ${t.buyIn} chips <span class="muted">(${t.players}/${t.maxSeats} seated)</span></div>
                      <div class="pill ${t.status === 'running' ? 'running' : ''}">${statusPill}</div>`;
          list.appendChild(row);
    }
}
setInterval(() => socket.emit('lobby:refresh'), 4000);

// ---- table rendering ----
const SEAT_POS = (i, n) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rx = 300, ry = 140;
    return { x: 320 + rx * Math.cos(angle) - 54, y: 170 + ry * Math.sin(angle) - 30 };
};

function cardChip(label) {
    const isRed = label.includes('H') || label.includes('D');
    return `<span class="card-chip ${isRed ? 'red' : ''}">${label}</span>`;
}

socket.on('table:state', (s) => {
    state.currentTableId = s.id;
    if ($('#view-table').classList.contains('hidden')) showView('table');

            $('#potLabel').textContent = `Pot: ${s.hand ? s.hand.pot : 0}`;
    $('#community').innerHTML = (s.hand ? s.hand.community : []).map(cardChip).join('');

            const seatsEl = $('#seats');
    seatsEl.innerHTML = '';
    const n = s.seats.length;
    s.seats.forEach((seat, i) => {
          if (!seat) return;
          const pos = SEAT_POS(i, n);
          const div = document.createElement('div');
          div.className = 'seat' + (seat.seat === s.yourSeat ? ' you' : '') +
                  (s.hand && s.hand.turnSeat === seat.seat ? ' turn' : '') +
                  (seat.status === 'folded' ? ' folded' : '');
          div.style.left = `${pos.x}px`;
          div.style.top = `${pos.y}px`;
          div.innerHTML = `<div>${seat.name}${seat.seat === s.buttonSeat ? ' 🔘' : ''}</div>
                <div class="stack">${seat.stack}</div>
                      ${seat.contributedThisStreet ? `<div class="muted">bet ${seat.contributedThisStreet}</div>` : ''}
                            ${seat.status === 'folded' ? '<div class="muted">folded</div>' : ''}`;
          seatsEl.appendChild(div);
    });

            $('#yourCards').innerHTML = (s.yourHoleCards || []).map(cardChip).join('') || '<span class="muted">spectating</span>';

            const bar = $('#actionBar');
    if (s.isYourTurn) {
          bar.classList.remove('hidden');
          $('#callBtn').textContent = s.toCall > 0 ? `Call ${s.toCall}` : 'Call';
          $('#raiseAmount').value = s.minRaiseTo || '';
          $('[data-action="check"]').style.display = s.toCall > 0 ? 'none' : 'inline-block';
          $('[data-action="call"]').style.display = s.toCall > 0 ? 'inline-block' : 'none';
    } else {
          bar.classList.add('hidden');
    }
    $('#turnBanner').textContent = s.status === 'waiting'
      ? 'Waiting for the table to fill / start...'
          : s.status === 'complete'
        ? 'Tournament complete — see results below.'
            : (s.isYourTurn ? 'Your turn!' : '');

            $('#handLog').innerHTML = s.log.map(l => `<div>${l}</div>`).join('');
    $('#handLog').scrollTop = $('#handLog').scrollHeight;

            if (s.status === 'complete' && s.finalResult && !s.finalResult.cancelled) {
                  setTimeout(refreshDashboard, 500);
            }
});

async function refreshDashboard() {
    if (!state.userId) return;
    const [dashRes, lbRes] = await Promise.all([
          fetch(`/api/dashboard/${state.userId}`).then(r => r.json()),
          fetch('/api/leaderboard').then(r => r.json()),
        ]);
    if (dashRes.ok) {
          const u = dashRes.user;
          $('#statsGrid').innerHTML = `
                <div class="stat"><div class="n">${u.chipBalance}</div><div class="l">Play-money chips</div></div>
                      <div class="stat"><div class="n">${u.gamesPlayed}</div><div class="l">Games played</div></div>
                            <div class="stat"><div class="n">${u.wins}</div><div class="l">1st-place wins</div></div>
                                  <div class="stat"><div class="n">${u.cashes}</div><div class="l">Top-3 cashes</div></div>`;
    }
    if (lbRes.ok) {
          $('#leaderboardBody').innerHTML = lbRes.leaderboard.map((u, i) => `
                <tr><td>${i + 1}</td><td>${u.name}</td><td>${u.wins}</td><td>${u.cashes}</td><td>${u.gamesPlayed}</td><td>${u.totalWinnings}</td></tr>
                    `).join('');
    }
}

boot();
