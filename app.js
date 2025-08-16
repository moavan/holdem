(() => {
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const storeKey = 'holdemTracker.v1';

  const defaultState = {
    accounts: [],   // {id, name, type, balance}
    sessions: [],   // {id, date, location, gameType, blinds, buyIn, cashOut, hours, notes}
    hands: [],      // {id, sessionId, hole, pos, line, pot, result, tags, notes, opp}
    players: [],    // {id, name, site, tags, notes, color, createdAt, lastSeen, handCount}
    ui: { hc:false },
    risk: { stopLoss: 0, dailyLoss: 0 },
    createdAt: Date.now()
  };

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const fmt = (n) => {
    const sign = n < 0 ? '-' : '';
    const x = Math.abs(Math.round(n));
    return sign + '₩' + x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  };
  const sum = (arr) => arr.reduce((a,b)=>a+b,0);

  let state = load();
  /* ---------- Chart helpers ---------- */
  function byMonthKey(dateStr){
    if(!dateStr) return 'Unknown';
    return (dateStr||'').slice(0,7); // YYYY-MM
  }
  function aggregateMonthly(){
    const m = {};
    for(const s of state.sessions){
      const k = byMonthKey(s.date);
      const pnl = Number(s.cashOut||0) - Number(s.buyIn||0);
      const hrs = Number(s.hours||0);
      if(!m[k]) m[k] = {pnl:0, hrs:0};
      m[k].pnl += pnl;
      m[k].hrs += hrs;
    }
    const keys = Object.keys(m).filter(k=>k!=='Unknown').sort();
    return {
      labels: keys,
      pnl: keys.map(k=>m[k].pnl),
      hourly: keys.map(k=> m[k].hrs>0 ? Math.round(m[k].pnl / m[k].hrs) : 0)
    };
  }
  function aggregateLast30(){
    const sorted = [...state.sessions].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    const last = sorted.slice(-30);
    const labels = last.map(s => (s.date||'').slice(5)); // MM-DD
    const pnl = last.map(s => Number(s.cashOut||0) - Number(s.buyIn||0));
    const hourly = last.map(s => {
      const hrs = Number(s.hours||0);
      const p = Number(s.cashOut||0) - Number(s.buyIn||0);
      return hrs>0 ? Math.round(p/hrs) : 0;
    });
    return {labels, pnl, hourly};
  }
  function drawLineChart(canvas, labels, data, {yLabel='₩', color='#3a6ff8'} = {}){
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.scale(dpr,dpr);
    // padding
    const padL = 44, padR = 10, padT = 10, padB = 24;
    const W = w - padL - padR, H = h - padT - padB;
    // scales
    const minV = Math.min(0, Math.min(...data));
    const maxV = Math.max(0, Math.max(...data));
    const span = (maxV - minV) || 1;
    // grid
    ctx.clearRect(0,0,w,h);
    ctx.translate(0.5,0.5);
    ctx.strokeStyle = '#e6ebf2';
    ctx.lineWidth = 1;
    const gridLines = 4;
    for(let i=0;i<=gridLines;i++){
      const y = padT + H * (i/gridLines);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL+W, y); ctx.stroke();
      const val = Math.round(maxV - span*(i/gridLines));
      ctx.fillStyle = '#6b7a90';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(yLabel + val.toLocaleString(), padL-6, y+4);
    }
    // x labels (sparse)
    const step = Math.ceil(labels.length/6) || 1;
    ctx.fillStyle = '#6b7a90';
    ctx.textAlign = 'center';
    for(let i=0;i<labels.length;i+=step){
      const x = padL + W * (i/(Math.max(1,labels.length-1)));
      ctx.fillText(labels[i], x, padT+H+16);
    }
    // line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = padL + W * (i/(Math.max(1,labels.length-1)));
      const y = padT + H * (1 - (v - minV)/span);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    // zero line if needed
    if(minV < 0 && maxV > 0){
      const y0 = padT + H * (1 - (0 - minV)/span);
      ctx.strokeStyle = '#cfd6e6'; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(padL+W, y0); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.translate(-0.5,-0.5);
  }
  function renderCharts(){
    const m = aggregateMonthly();
    const l = aggregateLast30();
    const c1 = document.getElementById('ch-month-pnl');
    const c2 = document.getElementById('ch-month-hourly');
    const c3 = document.getElementById('ch-last30-pnl');
    const c4 = document.getElementById('ch-last30-hourly');
    if(c1) drawLineChart(c1, m.labels, m.pnl, {yLabel:'₩'});
    if(c2) drawLineChart(c2, m.labels, m.hourly, {yLabel:'₩/h'});
    if(c3) drawLineChart(c3, l.labels, l.pnl, {yLabel:'₩'});
    if(c4) drawLineChart(c4, l.labels, l.hourly, {yLabel:'₩/h'});
  }

  /* ---------- Players helpers ---------- */
  function normalizeName(s){ return (s||'').trim().toLowerCase(); }
  function findPlayerByName(name){
    const n = normalizeName(name);
    return state.players.find(p => normalizeName(p.name) === n);
  }
  function ensurePlayer(name){
    if(!name) return null;
    let p = findPlayerByName(name);
    if(!p){
      p = { id: uid(), name: name.trim(), site:'', tags:'', notes:'', color:'#3a6ff8', createdAt: Date.now(), lastSeen: Date.now(), handCount: 0 };
      state.players.push(p);
    }
    return p;
  }
  function renderPlayersDatalist(){
    const dl = document.getElementById('players-list');
    if(!dl) return;
    dl.innerHTML = '';
    const names = [...state.players].sort((a,b)=>a.name.localeCompare(b.name));
    for(const p of names){
      const opt = document.createElement('option');
      opt.value = p.name;
      dl.appendChild(opt);
    }
  }
  function renderPlayersTable(filter=''){
    const q = (filter||'').toLowerCase();
    const rows = document.querySelector('#players-table tbody');
    rows.innerHTML='';
    const arr = [...state.players].sort((a,b)=> (b.lastSeen||0) - (a.lastSeen||0));
    for(const p of arr){
      const hay = (p.name+' '+(p.site||'')+' '+(p.tags||'')+' '+(p.notes||'')).toLowerCase();
      if(q && !hay.includes(q)) continue;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="badge" style="border-color:${p.color};background:${p.color}22;color:#000">${p.name}</span></td>
        <td>${p.site||''}</td>
        <td>${p.tags||''}</td>
        <td>${(p.notes||'').slice(0,80)}</td>
        <td>${p.lastSeen ? new Date(p.lastSeen).toISOString().slice(0,10) : ''}</td>
        <td>${p.handCount||0}</td>
        <td><button data-edit="${p.id}">수정</button> <button class="danger" data-del="${p.id}">삭제</button></td>`;
      rows.appendChild(tr);
    }
    // actions
    rows.querySelectorAll('button[data-del]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-del');
        state.players = state.players.filter(x=>x.id!==id);
        save();
      });
    });
    rows.querySelectorAll('button[data-edit]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.getAttribute('data-edit');
        const p = state.players.find(x=>x.id===id);
        if(!p) return;
        // prefill form
        const f = document.getElementById('player-form');
        f.dataset.editing = id;
        f.name.value = p.name||'';
        f.site.value = p.site||'';
        f.tags.value = p.tags||'';
        f.color.value = p.color||'#3a6ff8';
        f.notes.value = p.notes||'';
        // switch to players tab
        $$('.nav button').forEach(b=>b.classList.remove('active'));
        $('[data-tab="players"]').classList.add('active');
        $$('.tab').forEach(t=>t.classList.remove('active'));
        $('#players').classList.add('active');
      });
    });
  }



  function load() {
    try {
      const raw = localStorage.getItem(storeKey);
      if (!raw) return JSON.parse(JSON.stringify(defaultState));
      const obj = JSON.parse(raw);
      return Object.assign({}, defaultState, obj);
    } catch (e) {
      console.error('load error', e);
      return JSON.parse(JSON.stringify(defaultState));
    }
  }
  function save() {
    localStorage.setItem(storeKey, JSON.stringify(state));
    applyUI();
    render();
  }

  function navInit() {
    $$('.nav button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.nav button').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab');
        $$('.tab').forEach(t=>t.classList.remove('active'));
        $('#'+tab).classList.add('active');
        if (tab === 'sessions' || tab === 'hands') render();
      });
    });
  }

  function bankrollTotal() {
    return sum(state.accounts.map(a => Number(a.balance)||0));
  }
  function sessionsProfit() {
    return sum(state.sessions.map(s => Number(s.cashOut||0) - Number(s.buyIn||0)));
  }
  function sessionsHours() {
    return sum(state.sessions.map(s => Number(s.hours)||0));
  }
  function winRate() {
    const total = state.sessions.length;
    if (!total) return 0;
    const wins = state.sessions.filter(s => (Number(s.cashOut||0) - Number(s.buyIn||0)) > 0).length;
    return Math.round((wins / total) * 100);
  }
  function dailyLossExceeded() {
    if (!state.risk?.dailyLoss) return false;
    // group sessions by date and check loss
    const map = {};
    for (const s of state.sessions) {
      const d = s.date || '';
      const pnl = (Number(s.cashOut||0) - Number(s.buyIn||0));
      map[d] = (map[d] || 0) + pnl;
    }
    return Object.entries(map).some(([d, pnl]) => pnl < 0 && Math.abs(pnl) >= state.risk.dailyLoss);
  }

  function renderDashboard() {
    $('#metric-bankroll').textContent = fmt(bankrollTotal());
    $('#metric-profit').textContent = fmt(sessionsProfit());
    $('#metric-sessions').textContent = String(state.sessions.length);
    $('#metric-winrate').textContent = winRate() + '%';
    const hrs = sessionsHours();
    $('#metric-hourly').textContent = hrs > 0 ? (fmt(Math.round(sessionsProfit() / hrs)) + '/시간') : '₩0/시간';

    // recent 5 sessions
    const tbody = $('#recent-sessions tbody');
    tbody.innerHTML = '';
    const sorted = [...state.sessions].sort((a,b) => (b.date||'').localeCompare(a.date||''));
    for (const s of sorted.slice(0,5)) {
      const pnl = Number(s.cashOut||0) - Number(s.buyIn||0);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${s.date||''}</td><td>${s.location||''}</td><td>${s.gameType||''}</td>
      <td>${s.blinds||''}</td><td>${fmt(Number(s.buyIn||0))}</td><td>${fmt(Number(s.cashOut||0))}</td>
      <td class="${pnl>=0?'positive':'negative'}">${fmt(pnl)}</td>`;
      tbody.appendChild(tr);
    }

    // risk warnings
    const stopLoss = state.risk?.stopLoss || 0;
    const latest = sorted[0];
    const latestLossExceeded = latest ? ((Number(latest.buyIn||0) - Number(latest.cashOut||0)) >= stopLoss && stopLoss>0) : false;
    const dailyExceeded = dailyLossExceeded();

    // show badges in header title
    const h1 = document.querySelector('.topbar h1');
    let extra = '';
    if (latestLossExceeded) extra += ' <span class="badge">세션 손절 경고</span>';
    if (dailyExceeded) extra += ' <span class="badge">일일 손절 경고</span>';
    h1.innerHTML = 'Holdem Tracker' + extra;
  }

  function renderSessions() {
    const tbody = $('#sessions-table tbody');
    tbody.innerHTML = '';
    const sorted = [...state.sessions].sort((a,b) => (b.date||'').localeCompare(a.date||''));
    for (const s of sorted) {
      const pnl = Number(s.cashOut||0) - Number(s.buyIn||0);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${s.date||''}</td><td>${s.location||''}</td><td>${s.gameType||''}</td>
      <td>${s.blinds||''}</td><td>${fmt(Number(s.buyIn||0))}</td><td>${fmt(Number(s.cashOut||0))}</td>
      <td class="${pnl>=0?'positive':'negative'}">${fmt(pnl)}</td><td>${s.hours||0}</td>
      <td>${(s.notes||'').slice(0,40)}</td>
      <td>
        <button data-edit="${s.id}">수정</button>
        <button data-del="${s.id}" class="danger">삭제</button>
      </td>`;
      tbody.appendChild(tr);
    }

    // actions
    tbody.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del');
        state.sessions = state.sessions.filter(s => s.id !== id);
        state.hands = state.hands.filter(h => h.sessionId !== id);
        save();
      });
    });
    tbody.querySelectorAll('button[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit');
        const s = state.sessions.find(x=>x.id===id);
        if (!s) return;
        // switch to new-session tab and prefill
        $$('.nav button').forEach(b=>b.classList.remove('active'));
        $('[data-tab="new-session"]').classList.add('active');
        $$('.tab').forEach(t=>t.classList.remove('active'));
        $('#new-session').classList.add('active');
        const f = $('#new-session-form');
        f.dataset.editing = id;
        f.date.value = s.date||'';
        f.location.value = s.location||'';
        f.gameType.value = s.gameType||'cash';
        f.blinds.value = s.blinds||'';
        f.buyIn.value = s.buyIn||0;
        f.cashOut.value = s.cashOut||0;
        f.hours.value = s.hours||0;
        f.notes.value = s.notes||'';
      });
    });
  }

  function renderHands() {
    // session selector
    const sel = $('#hand-session');
    sel.innerHTML = '';
    const sorted = [...state.sessions].sort((a,b) => (b.date||'').localeCompare(a.date||''));
    for (const s of sorted) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.date||''} | ${s.location||''} | ${s.blinds||''}`;
      sel.appendChild(opt);
    }

    // table
    const tbody = $('#hands-table tbody');
    tbody.innerHTML = '';
    const hands = [...state.hands].sort((a,b) => b.createdAt - a.createdAt);
    for (const h of hands) {
      const s = state.sessions.find(x=>x.id===h.sessionId);
      const date = s?.date || '';
      const label = s ? `${s.location||''} ${s.blinds||''}` : '';
      const opp = state.players.find(p=>p.id===h.opp);
      const oppName = opp? opp.name : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${date}</td><td>${label}</td><td>${oppName}</td><td>${h.hole||''}</td><td>${h.pos||''}</td>
      <td>${h.line||''}</td><td>${fmt(Number(h.pot||0))}</td>
      <td class="${(Number(h.result||0))>=0?'positive':'negative'}">${fmt(Number(h.result||0))}</td>
      <td>${h.tags||''}</td><td>${(h.notes||'').slice(0,40)}</td>
      <td><button data-del="${h.id}" class="danger">삭제</button></td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del');
        state.hands = state.hands.filter(x=>x.id!==id);
        save();
      });
    });
  }

  function renderReview() {
    // top leak tags
    const map = {};
    for (const h of state.hands) {
      const tags = (h.tags||'').split(',').map(t=>t.trim()).filter(Boolean);
      for (const t of tags) map[t] = (map[t]||0)+1;
    }
    const top = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>`${k}(${v})`);
    $('#top-leaks').textContent = top.length ? top.join(', ') : '-';

    // trend (last 10 sessions pnl)
    const sorted = [...state.sessions].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const arr = sorted.slice(0,10).map(s => Number(s.cashOut||0) - Number(s.buyIn||0));
    $('#trend').textContent = arr.length ? arr.map(x => (x>=0?`+${(x/1000).toFixed(0)}k`:`-${(Math.abs(x)/1000).toFixed(0)}k`)).join(' | ') : '-';
  }

  function renderAccounts() {
    const tbody = $('#accounts-table tbody');
    tbody.innerHTML = '';
    for (const a of state.accounts) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${a.name}</td><td>${a.type}</td><td>${fmt(Number(a.balance||0))}</td>
      <td><button data-del="${a.id}" class="danger">삭제</button></td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del');
        state.accounts = state.accounts.filter(x=>x.id!==id);
        save();
      });
    });
  }

  function render() {
    renderDashboard();
    renderSessions();
    renderHands();
    renderReview();
    renderAccounts();
    renderPlayersDatalist();
    renderPlayersTable($('#player-search')?.value||'');
    renderCharts();
  }

  function bindForms() {
    // new session
    $('#new-session-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const data = {
        date: f.date.value,
        location: f.location.value.trim(),
        gameType: f.gameType.value,
        blinds: f.blinds.value.trim(),
        buyIn: Number(f.buyIn.value||0),
        cashOut: Number(f.cashOut.value||0),
        hours: Number(f.hours.value||0),
        notes: f.notes.value.trim()
      };
      const editingId = f.dataset.editing;
      if (editingId) {
        const s = state.sessions.find(x=>x.id===editingId);
        Object.assign(s, data);
        delete f.dataset.editing;
      } else {
        state.sessions.push({ id: uid(), ...data });
      }
      f.reset();
      save();
      alert('세션 저장 완료');
    });

    // sample data
    $('#btn-sample').addEventListener('click', () => {
      // add a sample account and sessions/hands
      if (state.accounts.length === 0) {
        state.accounts.push({ id: uid(), name: '현금지갑', type: 'cash', balance: 1000000 });
        state.accounts.push({ id: uid(), name: '포커룸A', type: 'site', balance: 300000 });
      }
      const today = new Date();
      const fmtDate = (d) => d.toISOString().slice(0,10);
      const d1 = new Date(today.getTime() - 86400000*3);
      const d2 = new Date(today.getTime() - 86400000*2);
      const d3 = new Date(today.getTime() - 86400000*1);
      const s1 = { id: uid(), date: fmtDate(d1), location: '인천 ○○펍', gameType:'cash', blinds:'1/2', buyIn:200000, cashOut:350000, hours:4.5, notes:'낮은 스택 상대로 밸류' };
      const s2 = { id: uid(), date: fmtDate(d2), location: '서울 △△룸', gameType:'cash', blinds:'2/5', buyIn:500000, cashOut:300000, hours:5.0, notes:'플랍 콜링 과다' };
      const s3 = { id: uid(), date: fmtDate(d3), location: '인천 ○○펍', gameType:'cash', blinds:'1/2', buyIn:200000, cashOut:260000, hours:3.0, notes:'블러프 빈도 조절' };
      state.sessions.push(s1, s2, s3);
      state.hands.push(
        { id: uid(), sessionId: s1.id, hole:'As Ks', pos:'BTN', line:'3bet pot, flop cbet', pot: 120000, result: 80000, tags:'value bet thin', notes:'상대 콜링' , createdAt: Date.now() },
        { id: uid(), sessionId: s2.id, hole:'Qh Qd', pos:'SB', line:'multiway, board high', pot: 200000, result: -150000, tags:'overplay TPTK', notes:'보드 텍스처 과대평가', createdAt: Date.now() },
        { id: uid(), sessionId: s3.id, hole:'9c 8c', pos:'CO', line:'SRP, turn semi-bluff jam', pot: 90000, result: 60000, tags:'good bluff spot', notes:'상대 폴드', createdAt: Date.now() }
      );
      save();
      alert('샘플 데이터가 추가되었습니다.');
    });

    // new hand
    $('#new-hand-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const oppName = (f.oppName?.value||'').trim();
      let oppId = null;
      if(oppName){ const p = ensurePlayer(oppName); oppId = p?.id; if(p){ p.lastSeen = Date.now(); p.handCount = (p.handCount||0)+1; } }
      const h = {
        id: uid(),
        sessionId: f.sessionId.value,
        hole: f.hole.value.trim(),
        pos: f.pos.value.trim(),
        line: f.line.value.trim(),
        pot: Number(f.pot.value||0),
        result: Number(f.result.value||0),
        tags: f.tags.value.trim(),
        notes: f.notes.value.trim(),
        createdAt: Date.now(),
        opp: oppId
      };
      state.hands.push(h);
      f.reset();
      save();
      alert('핸드 저장 완료');
    });

    // accounts
    $('#account-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      state.accounts.push({
        id: uid(),
        name: f.name.value.trim(),
        type: f.type.value,
        balance: Number(f.balance.value||0)
      });
      f.reset();
      save();
    });

    // risk
    $('#risk-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      state.risk = {
        stopLoss: Number(f.stopLoss.value||0),
        dailyLoss: Number(f.dailyLoss.value||0)
      };
      save();
      alert('리스크 설정 저장 완료');
    });


    // players
    $('#player-form').addEventListener('submit', (e)=>{
      e.preventDefault();
      const f = e.target;
      const data = {
        name: f.name.value.trim(),
        site: f.site.value.trim(),
        tags: f.tags.value.trim(),
        color: f.color.value || '#3a6ff8',
        notes: f.notes.value.trim()
      };
      if(!data.name) return alert('닉네임은 필수입니다.');
      const editingId = f.dataset.editing;
      if(editingId){
        const p = state.players.find(x=>x.id===editingId);
        Object.assign(p, data);
        delete f.dataset.editing;
      }else{
        const existing = findPlayerByName(data.name);
        if(existing) Object.assign(existing, data);
        else state.players.push({ id: uid(), ...data, createdAt: Date.now(), lastSeen: Date.now(), handCount: 0 });
      }
      f.reset();
      save();
      alert('플레이어 저장 완료');
    });
    $('#player-search').addEventListener('input', (e)=>{
      renderPlayersTable(e.target.value);
    });

    // accessibility toggle
    const setHC = (on) => {
      state.ui = state.ui || {}; state.ui.hc = !!on; save();
    };
    document.getElementById('btn-a11y').addEventListener('click', () => {
      const on = !(state.ui && state.ui.hc);
      state.ui = state.ui || {}; state.ui.hc = on;
      localStorage.setItem(storeKey, JSON.stringify(state));
      applyUI();
      document.getElementById('btn-a11y').textContent = '가독성 모드: ' + (on?'켬':'끔');
    });

    window.addEventListener('resize', ()=>{
      // re-render only charts for performance
      renderCharts();
    });


    // export
    $('#btn-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'holdem-tracker-backup.json';
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
    });

    // import
    $('#btn-import').addEventListener('click', async () => {
      const f = $('#file-import');
      if (!f.files || !f.files[0]) return alert('불러올 JSON 파일을 선택하세요.');
      const text = await f.files[0].text();
      try {
        const data = JSON.parse(text);
        // 최소 구조 체크
        if (!('sessions' in data) || !('accounts' in data)) throw new Error('형식 오류');
        state = Object.assign({}, defaultState, data);
        save();
        alert('복원 완료');
      } catch (err) {
        alert('가져오기 실패: ' + err.message);
      }
    });

    // reset
    $('#btn-reset').addEventListener('click', () => {
      if (!confirm('정말 모든 데이터를 삭제하시겠습니까?')) return;
      state = JSON.parse(JSON.stringify(defaultState));
      save();
      alert('데이터가 초기화되었습니다.');
    });
  }


  function applyUI(){
    if(state.ui && state.ui.hc){ document.body.classList.add('hc'); } else { document.body.classList.remove('hc'); }
    const btn = document.getElementById('btn-a11y'); if(btn){ btn.textContent = '가독성 모드: ' + ((state.ui&&state.ui.hc)?'켬':'끔'); }
  }

  function init() {
    navInit();
    bindForms();
    applyUI();
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();