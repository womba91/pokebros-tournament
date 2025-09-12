// --- helpers to query DOM ---
const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// --- storage key ---
const STORE_KEY = 'pokebros_tournament_v1';

// --- app state ---
let state = {
  players: [],
  rounds: 4,
  // matches example:
  // { "1": [{p1:"Ethan", p2:"Isaac", outcome:"P1|P2|Draw", bonus:0|2}, ...],
  //   "1_bye": "Jenny" }
  matches: {}
};

// --- persistence ---
function save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function load(){
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return;
  try { state = JSON.parse(raw); } catch {}
}

// --- UI: players ---
function renderPlayers(){
  const list = $("#players-list");
  list.innerHTML = "";
  state.players.forEach((name,i)=>{
    const li = document.createElement('li');
    li.innerHTML = `<span>${name}</span> <button data-i="${i}">Remove</button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button').forEach(btn=>{
    btn.onclick = ()=>{
      state.players.splice(+btn.dataset.i,1);
      save(); renderPlayers(); renderRounds();
    };
  });
}

function optionList(options, selected=""){
  return options.map(o=>`<option value="${o}" ${o===selected?'selected':''}>${o}</option>`).join("");
}

// --- rounds UI ---
function buildRoundUI(r){
  const wrap = document.createElement('div');
  wrap.className = 'round';
  wrap.innerHTML = `
    <h3>Round ${r}</h3>
    <div class="row">
      <label>Bye:</label>
      <select id="bye-${r}">
        <option value="">(none)</option>
        ${optionList(state.players, (state.matches[`${r}_bye`] || ""))}
      </select>
      <button id="addmatch-${r}">Add Match</button>
      <button id="autopair-${r}">Auto Pair (Swiss)</button>
      <button id="clear-${r}" class="danger">Clear Round</button>
    </div>
    <div class="matches" id="matches-${r}"></div>
  `;

  // handlers
  wrap.querySelector('#bye-' + r).onchange = (e)=>{
    state.matches[r + '_bye'] = e.target.value || "";
    save(); updateLeaderboard();
  };

  wrap.querySelector('#addmatch-' + r).onclick = ()=>{
    const m = state.matches[r] || [];
    m.push({ p1:"", p2:"", outcome:"", bonus:0 });
    state.matches[r] = m;
    save(); renderMatches(r);
  };

  wrap.querySelector('#autopair-' + r).onclick = ()=>{
    if (r === 1) {
      alert("Use Randomise R1 for Round 1. Auto Swiss is for Round 2+.");
      return;
    }
    swissPairRound(r);
    renderMatches(r);
    const byeSel = wrap.querySelector('#bye-' + r);
    if (byeSel) byeSel.value = state.matches[r + '_bye'] || "";
    updateLeaderboard();
  };

  wrap.querySelector('#clear-' + r).onclick = ()=>{
    delete state.matches[r];
    delete state.matches[r + '_bye'];
    save(); renderRounds();
  };

  return wrap;
}

function renderMatches(r){
  const cont = $('#matches-' + r);
  cont.innerHTML = "";
  const matches = state.matches[r] || [];

  matches.forEach((m,idx)=>{
    const div = document.createElement('div');
    div.className = 'match';
    div.innerHTML = `
      <div class="row">
        <label>Player 1</label>
        <select class="p1">${optionList(["", ...state.players], m.p1)}</select>
      </div>
      <div class="row">
        <label>Player 2</label>
        <select class="p2">${optionList(["", ...state.players], m.p2)}</select>
      </div>
      <div class="row">
        <label>Outcome</label>
        <select class="outcome">${
          optionList(
            ["", "P1 wins", "P2 wins", "Draw"],
            m.outcome === "P1" ? "P1 wins" : m.outcome === "P2" ? "P2 wins" : (m.outcome || "")
          )
        }</select>
      </div>
      <div class="row">
        <label>Winner Bonus (PCR ≥ 5)</label>
        <select class="bonus">${optionList([0,2], m.bonus)}</select>
      </div>
      <div class="row">
        <button class="remove danger">Remove Match</button>
      </div>
    `;

    // per-card handlers
    div.querySelector('.p1').onchange = e => { m.p1 = e.target.value; save(); updateLeaderboard(); };
    div.querySelector('.p2').onchange = e => { m.p2 = e.target.value; save(); updateLeaderboard(); };
    div.querySelector('.outcome').onchange = e => {
      const v = e.target.value;
      m.outcome = v === "P1 wins" ? "P1" : v === "P2 wins" ? "P2" : v === "Draw" ? "Draw" : "";
      save(); updateLeaderboard();
    };
    div.querySelector('.bonus').onchange = e => { m.bonus = Number(e.target.value); save(); updateLeaderboard(); };
    div.querySelector('.remove').onclick = ()=>{
      matches.splice(idx,1);
      state.matches[r] = matches;
      save(); renderMatches(r); updateLeaderboard();
    };

    cont.appendChild(div);
  });
}

function renderRounds(){
  $('#rounds').value = state.rounds;
  const rc = $('#rounds-container');
  rc.innerHTML = "";
  for(let r=1; r<=state.rounds; r++){
    const ui = buildRoundUI(r);
    rc.appendChild(ui);
    renderMatches(r);
    const byeVal = state.matches[r + '_bye'] || "";
    const byeSel = $('#bye-' + r);
    if (byeSel) byeSel.value = byeVal;
  }
  updateLeaderboard();
}

// --- round 1 randomise ---
function randomiseR1(){
  if (state.players.length < 3){ alert("Add at least 3 players"); return; }
  const arr = [...state.players];
  // shuffle
  for (let i=arr.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const round = 1;
  state.matches[round] = [];
  if (arr.length % 2 === 1){
    state.matches[round + '_bye'] = arr.pop();
  } else {
    state.matches[round + '_bye'] = "";
  }
  while (arr.length >= 2){
    const p1 = arr.shift(), p2 = arr.shift();
    state.matches[round].push({ p1, p2, outcome:"", bonus:0 });
  }
  save(); renderRounds();
}

// --- swiss helpers (scores, opponents, byes) ---
function computeScores(){
  const scores = {};
  state.players.forEach(p => scores[p] = 0);

  for (let r=1; r<=state.rounds; r++){
    const bye = state.matches[r + '_bye'];
    if (bye) scores[bye] = (scores[bye] || 0) + 2;

    const matches = state.matches[r] || [];
    matches.forEach(m=>{
      if (!m.p1 || !m.p2) return;
      if (m.outcome === 'P1'){
        scores[m.p1] = (scores[m.p1] || 0) + 3 + (Number(m.bonus) || 0);
        scores[m.p2] = (scores[m.p2] || 0) + 1;
      } else if (m.outcome === 'P2'){
        scores[m.p2] = (scores[m.p2] || 0) + 3 + (Number(m.bonus) || 0);
        scores[m.p1] = (scores[m.p1] || 0) + 1;
      } else if (m.outcome === 'Draw'){
        scores[m.p1] = (scores[m.p1] || 0) + 2;
        scores[m.p2] = (scores[m.p2] || 0) + 2;
      }
    });
  }
  return scores;
}

function buildOpponentsMap(){
  const opp = {};
  state.players.forEach(p => opp[p] = new Set());
  for (let r=1; r<=state.rounds; r++){
    const matches = state.matches[r] || [];
    matches.forEach(m=>{
      if (m.p1 && m.p2){
        opp[m.p1].add(m.p2);
        opp[m.p2].add(m.p1);
      }
    });
  }
  return opp;
}

function playersWhoHadBye(){
  const had = new Set();
  for (let r=1; r<=state.rounds; r++){
    const b = state.matches[r + '_bye'];
    if (b) had.add(b);
  }
  return had;
}

// --- swiss pairing for round >= 2 ---
function swissPairRound(targetRound){
  const scores = computeScores();
  const opponents = buildOpponentsMap();
  const hadBye = playersWhoHadBye();

  // sort by points desc, then name asc
  const pool = [...state.players].sort((a,b)=> (scores[b]-scores[a]) || a.localeCompare(b));

  // assign bye if odd: lowest score who hasn't had bye (fallback: absolute lowest)
  let byePlayer = "";
  if (pool.length % 2 === 1){
    const eligible = pool.filter(p => !hadBye.has(p));
    const pickFrom = eligible.length ? eligible : pool;
    pickFrom.sort((a,b)=> (scores[a]-scores[b]) || a.localeCompare(b));
    byePlayer = pickFrom[0];
    pool.splice(pool.indexOf(byePlayer), 1);
  }

  // bucket by score
  const buckets = {};
  pool.forEach(p => (buckets[scores[p]] = (buckets[scores[p]] || [])).push(p));
  const bucketScores = Object.keys(buckets).map(Number).sort((a,b)=> b-a);

  const pairs = [];
  const floats = [];

  function greedyPair(list){
    const used = new Set();
    for (let i=0; i<list.length; i++){
      const a = list[i];
      if (used.has(a)) continue;
      let partner = -1;

      // first try avoid rematch
      for (let j=i+1; j<list.length; j++){
        const b = list[j];
        if (used.has(b)) continue;
        if (!opponents[a].has(b)){ partner = j; break; }
      }
      // if stuck, allow rematch
      if (partner === -1){
        for (let j=i+1; j<list.length; j++){
          const b = list[j];
          if (!used.has(b)){ partner = j; break; }
        }
      }
      if (partner !== -1){
        const b = list[partner];
        used.add(a); used.add(b);
        pairs.push([a,b]);
      }
    }
    return list.filter(p => !used.has(p));
  }

  for (const s of bucketScores){
    const group = [...(buckets[s] || []), ...floats.splice(0)];
    if (!group.length) continue;

    let working = [...group];
    if (working.length % 2 === 1){
      const floated = working.pop(); // float last
      floats.push(floated);
    }
    const leftover = greedyPair(working);
    leftover.forEach(p => floats.push(p));
  }

  if (floats.length){
    const leftover = greedyPair(floats);
    if (leftover.length) console.warn("Unpaired after Swiss:", leftover);
  }

  state.matches[targetRound] = pairs.map(([p1,p2]) => ({ p1, p2, outcome:"", bonus:0 }));
  state.matches[targetRound + '_bye'] = byePlayer || "";
  save();
}

// --- leaderboard ---
function updateLeaderboard(){
  const scores = {};
  state.players.forEach(p => scores[p] = 0);

  for (let r=1; r<=state.rounds; r++){
    const bye = state.matches[r + '_bye'];
    if (bye) scores[bye] = (scores[bye] || 0) + 2;

    const matches = state.matches[r] || [];
    matches.forEach(m=>{
      if (!m.p1 || !m.p2) return;
      if (m.outcome === "P1"){
        scores[m.p1] = (scores[m.p1] || 0) + 3 + (Number(m.bonus) || 0);
        scores[m.p2] = (scores[m.p2] || 0) + 1;
      } else if (m.outcome === "P2"){
        scores[m.p2] = (scores[m.p2] || 0) + 3 + (Number(m.bonus) || 0);
        scores[m.p1] = (scores[m.p1] || 0) + 1;
      } else if (m.outcome === "Draw"){
        scores[m.p1] = (scores[m.p1] || 0) + 2;
        scores[m.p2] = (scores[m.p2] || 0) + 2;
      }
    });
  }

  const rows = Object.entries(scores).map(([player,total])=>({player,total}));
  rows.sort((a,b)=> b.total - a.total || a.player.localeCompare(b.player));

  const tbody = $('#leaderboard tbody');
  tbody.innerHTML = "";
  rows.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${r.player}</td><td>${r.total}</td>`;
    tbody.appendChild(tr);
  });
}

// --- add/remove players ---
function addPlayer(name){
  name = name.trim();
  if (!name || state.players.includes(name)) return;
  state.players.push(name);
  save(); renderPlayers(); renderRounds();
  const input = $('#player-input');
  if (input) input.value = "";
}

// --- demo/reset ---
function loadDemo(){
  state.players = ["Ethan","Isaac","Dayne","Sam","Phoebe","Noah","Jenny"];
  state.rounds = 4;
  state.matches = {};
  save(); renderPlayers(); renderRounds();
}
function resetAll(){
  if (!confirm("Clear all data?")) return;
  localStorage.removeItem(STORE_KEY);
  state = { players: [], rounds: 4, matches: {} };
  renderPlayers(); renderRounds();
}

// --- init ---
function init(){
  load(); renderPlayers(); renderRounds();
  $('#add-player').onclick = ()=> addPlayer($('#player-input').value);
  $('#player-input').addEventListener('keydown', e=>{ if (e.key==='Enter') addPlayer(e.target.value); });
  $('#clear-players').onclick = ()=>{ if (confirm("Remove all players?")){ state.players=[]; save(); renderPlayers(); renderRounds(); } };
  $('#build-rounds').onclick = ()=>{ const n = Math.max(1, Math.min(9, (+$('#rounds').value || 4))); state.rounds = n; save(); renderRounds(); };
  $('#random-r1').onclick = randomiseR1;
  $('#save-data').onclick = save;
  $('#load-demo').onclick = loadDemo;
  $('#reset').onclick = resetAll;
}

window.addEventListener('DOMContentLoaded', init);