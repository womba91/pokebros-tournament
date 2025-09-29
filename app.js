// --- helpers ---
const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// --- storage key ---
const STORE_KEY = 'pokebros_tournament_v1';

// --- app state ---
let state = {
  players: [],
  rounds: 4,
  matches: {},         // current match sheets
  seasonTotals: {},    // cumulative totals across matches
  stage: { mode: 'setup', currentRound: 1 } // 'setup' | 'round' | 'review'
};

// --- persistence ---
function _save(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function load(){
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return;
  try { state = JSON.parse(raw); } catch {}
  if (!state.stage) state.stage = { mode: 'setup', currentRound: 1 }; // backward compat
  clampStage();
}

function clampStage(){
  if (!state.rounds || state.rounds < 1) state.rounds = 1;
  if (!state.stage) state.stage = { mode:'setup', currentRound:1 };
  if (state.stage.currentRound < 1) state.stage.currentRound = 1;
  if (state.stage.currentRound > state.rounds) state.stage.currentRound = state.rounds;
}

// save + status
let saveTimer;
function showSaving(){
  const el = $('#save-status'); if (!el) return;
  el.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=> el.textContent = 'Saved ✓ ' + new Date().toLocaleTimeString(), 250);
}
function save(){ _save(); showSaving(); }

// small utils
function debounce(fn, ms=300){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); };
}
function optionList(options, selected=""){
  return options.map(o=>`<option value="${o}" ${o===selected?'selected':''}>${o}</option>`).join("");
}

/* ---------- validation & sanitation helpers ---------- */
// Prevent self-matches and duplicate player assignments within the same round
function validateRoundAssignments(r){
  const matches = state.matches[r] || [];
  const used = new Map(); // player -> index
  for (let i=0; i<matches.length; i++){
    const m = matches[i];
    if (!m) continue;
    if (m.p1 && m.p2 && m.p1 === m.p2){
      return { ok:false, reason:'same', index:i, player:m.p1 };
    }
    for (const p of [m.p1, m.p2]){
      if (!p) continue;
      if (used.has(p)){
        return { ok:false, reason:'duplicate', index:i, player:p, prevIndex: used.get(p) };
      }
      used.set(p, i);
    }
  }
  return { ok:true };
}

// If a player is removed, clear them from matches and bye slots
function sanitizeMatchesOnPlayerRemoval(name){
  if (!name) return;
  for (let r=1; r<=state.rounds; r++){
    const byeKey = `${r}_bye`;
    if (state.matches[byeKey] === name) state.matches[byeKey] = "";
    const arr = state.matches[r] || [];
    arr.forEach(m=>{
      if (m.p1 === name || m.p2 === name){
        if (m.p1 === name) m.p1 = "";
        if (m.p2 === name) m.p2 = "";
        if (!m.p1 || !m.p2){ m.outcome = ""; m.bonus = 0; }
      }
    });
    state.matches[r] = arr;
  }
}

/* ========== PLAYERS ========== */
function renderPlayers(){
  const list = $("#players-list");
  if (!list) return;

  list.innerHTML = "";
  state.players.forEach((name,i)=>{
    const li = document.createElement('li');
    li.innerHTML = `<span>${name}</span> <button data-i="${i}">Remove</button>`;
    list.appendChild(li);
  });

  // per-row remove
  list.querySelectorAll('button').forEach(btn=>{
    btn.onclick = ()=>{
      const removed = state.players.splice(+btn.dataset.i,1)[0];
      sanitizeMatchesOnPlayerRemoval(removed);
      save(); renderPlayers(); renderRounds(); renderLeaderboards(); renderStageBar(); updateStageVisibility();
    };
  });

  // hide/show add row + toggle row
  const addRow   = $('#add-player-row');
  const toggleRow = $('#add-player-toggle');
  const hasPlayers = state.players.length > 0;

  if (addRow) addRow.style.display = hasPlayers ? 'none' : 'flex';

  if (toggleRow){
    if (hasPlayers){
      toggleRow.style.display = 'flex';
      toggleRow.innerHTML = `
        <button type="button" id="add-more-btn">Add more players</button>
        <button type="button" id="clear-players-inline" class="danger">Clear players</button>
      `;
      toggleRow.querySelector('#add-more-btn')?.addEventListener('click', (e)=>{
        e.stopPropagation();
        $('#add-player-row').style.display = 'flex';
        toggleRow.style.display = 'none';
      });
      toggleRow.querySelector('#clear-players-inline')?.addEventListener('click', (e)=>{
        e.stopPropagation();
        if (!confirm('Remove all players?')) return;
        state.players = [];
        state.matches = {};
        save();
        renderPlayers(); renderRounds(); renderLeaderboards(); renderStageBar(); updateStageVisibility();
      });
    } else {
      toggleRow.style.display = 'none';
      toggleRow.innerHTML = '';
    }
  }
}

/* ========== ROUNDS UI ========== */
function buildRoundUI(r){
  const wrap = document.createElement('div');
  wrap.className = 'round';
  const autoBtnHtml = (r >= 2) ? `<button id="autopair-${r}">Auto Pair (Swiss)</button>` : '';
  wrap.innerHTML = `
    <h3>Round ${r}</h3>
    <div class="row">
      <label>Bye:</label>
      <select id="bye-${r}">
        <option value="">(none)</option>
        ${optionList(state.players, (state.matches[`${r}_bye`] || ""))}
      </select>
      <button id="addmatch-${r}">Add Match</button>
      ${autoBtnHtml}
      <button id="clear-${r}" class="danger">Clear Round</button>
    </div>
    <div class="matches" id="matches-${r}"></div>
  `;

  // handlers
  const byeSel = wrap.querySelector(`#bye-${r}`);
  byeSel.onchange = (e)=>{
    state.matches[r + '_bye'] = e.target.value || "";
    save(); renderLeaderboards();
  };

  wrap.querySelector(`#addmatch-${r}`).onclick = ()=>{
    const m = state.matches[r] || [];
    m.push({ p1:"", p2:"", outcome:"", bonus:0 });
    state.matches[r] = m;
    save(); renderMatches(r);
  };

  const autoBtn = wrap.querySelector(`#autopair-${r}`);
  if (autoBtn){
    autoBtn.onclick = ()=>{
      if (state.players.length < 2){ alert("Need at least 2 players to pair."); return; }
      swissPairRound(r);
      renderMatches(r);
      byeSel.value = state.matches[r + '_bye'] || "";
      renderLeaderboards();
    };
  }

  wrap.querySelector(`#clear-${r}`).onclick = ()=>{
    delete state.matches[r];
    delete state.matches[r + '_bye'];
    save(); renderRounds();
  };

  return wrap;
}

function renderMatches(r){
  const cont = $(`#matches-${r}`);
  if (!cont) return;
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
          optionList(["", "P1 wins", "P2 wins", "Draw"],
          m.outcome === "P1" ? "P1 wins" : m.outcome === "P2" ? "P2 wins" : (m.outcome || ""))
        }</select>
      </div>
      <div class="row">
        <label>Winner Bonus (PCR ≥ 5)</label>
        <select class="bonus">${optionList([0,2], m.bonus)}</select>
      </div>
      <div class="row"><button class="remove danger">Remove Match</button></div>
    `;

    div.querySelector('.p1').onchange = e => {
      const before = m.p1;
      m.p1 = e.target.value;
      const chk = validateRoundAssignments(r);
      if (!chk.ok){
        m.p1 = before; e.target.value = before || "";
        if (chk.reason === 'same') alert('A player cannot face themselves in the same match.');
        else alert(`"${chk.player}" is already assigned in another match this round.`);
        return;
      }
      save(); renderLeaderboards();
    };

    div.querySelector('.p2').onchange = e => {
      const before = m.p2;
      m.p2 = e.target.value;
      const chk = validateRoundAssignments(r);
      if (!chk.ok){
        m.p2 = before; e.target.value = before || "";
        if (chk.reason === 'same') alert('A player cannot face themselves in the same match.');
        else alert(`"${chk.player}" is already assigned in another match this round.`);
        return;
      }
      save(); renderLeaderboards();
    };

    div.querySelector('.outcome').onchange = e => {
      const v = e.target.value;
      m.outcome = v === "P1 wins" ? "P1" : v === "P2 wins" ? "P2" : v === "Draw" ? "Draw" : "";
      save(); renderLeaderboards();
    };
    div.querySelector('.bonus').onchange = e => { m.bonus = Number(e.target.value); save(); renderLeaderboards(); };
    div.querySelector('.remove').onclick = ()=>{
      matches.splice(idx,1); state.matches[r] = matches; save(); renderMatches(r); renderLeaderboards();
    };
    cont.appendChild(div);
  });
}

// Only render the active round in 'round' mode. Nothing in setup/review.
function renderRounds(){
  clampStage();
  const rc = $('#rounds-container');
  if (!rc) return;
  rc.innerHTML = "";

  if (state.stage.mode === 'round'){
    const r = Math.max(1, Math.min(state.rounds || 1, state.stage.currentRound || 1));
    const ui = buildRoundUI(r);
    rc.appendChild(ui);
    renderMatches(r);
    const byeSel = $(`#bye-${r}`);
    if (byeSel) byeSel.value = state.matches[r + '_bye'] || "";

    // NEW: inline nav inside the round card
    renderInlineRoundNav();
  } else {
    // if we leave the round page, make sure inline nav is gone
    $('#stage-nav-inline')?.remove();
  }

  renderLeaderboards();
}

/* ========== Swiss Helpers ========== */
function computeCurrentScores(){
  const scores = {}; state.players.forEach(p => scores[p] = 0);
  for (let r=1; r<=state.rounds; r++){
    const bye = state.matches[r + '_bye']; if (bye) scores[bye] += 2;
    const matches = state.matches[r] || [];
    matches.forEach(m=>{
      if (!m.p1 || !m.p2) return;
      if (m.outcome === 'P1'){ scores[m.p1] += 3 + (Number(m.bonus)||0); scores[m.p2] += 1; }
      else if (m.outcome === 'P2'){ scores[m.p2] += 3 + (Number(m.bonus)||0); scores[m.p1] += 1; }
      else if (m.outcome === 'Draw'){ scores[m.p1] += 2; scores[m.p2] += 2; }
    });
  }
  return scores;
}
const computeScores = computeCurrentScores;

function buildOpponentsMap(){
  const opp = {}; state.players.forEach(p => opp[p] = new Set());
  for (let r=1; r<=state.rounds; r++){
    const matches = state.matches[r] || [];
    matches.forEach(m=>{ if (m.p1 && m.p2){ opp[m.p1].add(m.p2); opp[m.p2].add(m.p1); } });
  }
  return opp;
}
function playersWhoHadBye(){
  const had = new Set();
  for (let r=1; r<=state.rounds; r++){ const b = state.matches[r + '_bye']; if (b) had.add(b); }
  return had;
}

function swissPairRound(targetRound){
  const scores = computeScores();
  const opponents = buildOpponentsMap();
  const hadBye = playersWhoHadBye();
  const pool = [...state.players].sort((a,b)=> (scores[b]-scores[a]) || a.localeCompare(b));

  let byePlayer = "";
  if (pool.length % 2 === 1){
    const eligible = pool.filter(p => !hadBye.has(p));
    const pickFrom = eligible.length ? eligible : pool;
    pickFrom.sort((a,b)=> (scores[a]-scores[b]) || a.localeCompare(b));
    byePlayer = pickFrom[0];
    pool.splice(pool.indexOf(byePlayer), 1);
  }

  const buckets = {}; pool.forEach(p => (buckets[scores[p]] = (buckets[scores[p]] || [])).push(p));
  const bucketScores = Object.keys(buckets).map(Number).sort((a,b)=> b-a);
  const pairs = []; const floats = [];

  function greedyPair(list){
    const used = new Set();
    for (let i=0; i<list.length; i++){
      const a = list[i]; if (used.has(a)) continue;
      let partner = -1;
      for (let j=i+1; j<list.length; j++){
        const b = list[j]; if (used.has(b)) continue;
        if (!opponents[a].has(b)){ partner=j; break; }
      }
      if (partner === -1){
        for (let j=i+1; j<list.length; j++){
          const b=list[j]; if(!used.has(b)){ partner=j; break; }
        }
      }
      if (partner !== -1){
        const b=list[partner]; used.add(a); used.add(b); pairs.push([a,b]);
      }
    }
    return list.filter(p => !used.has(p));
  }

  for (const s of bucketScores){
    const group = [...(buckets[s] || []), ...floats.splice(0)];
    if (!group.length) continue;
    let working = [...group];
    if (working.length % 2 === 1) floats.push(working.pop());
    const leftover = greedyPair(working); leftover.forEach(p => floats.push(p));
  }
  if (floats.length){ greedyPair(floats); }

  state.matches[targetRound] = pairs.map(([p1,p2]) => ({ p1, p2, outcome:"", bonus:0 }));
  state.matches[targetRound + '_bye'] = byePlayer || "";
  save();
}

/* ========== Leaderboards ========== */
let leaderboardMode = 'current'; // 'current' | 'totals'

function renderLeaderboards(){
  const tbody = $('#leaderboard tbody'); if (!tbody) return;
  tbody.innerHTML = '';

  // Hide/show leaderboard mode switch by stage
  const lbSwitch = $('.lb-switch');
  if (lbSwitch) lbSwitch.hidden = (state.stage.mode !== 'setup');

  let rows;
  if (leaderboardMode === 'current'){
    const scores = computeCurrentScores();
    rows = state.players.map(p => ({ player: p, total: scores[p] ?? 0 }));
  } else {
    const totals = state.seasonTotals || {};
    rows = state.players.map(p => ({ player: p, total: totals[p] ?? 0 }));
  }

  rows.sort((a,b)=> (b.total - a.total) || a.player.localeCompare(b.player));

  rows.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${r.player}</td><td>${r.total}</td>`;
    tbody.appendChild(tr);
  });

  // Commit/Clear visibility
  const commitBtn = $('#commit-totals');
  const clearBtn = $('#clear-current-matches');
  if (commitBtn) commitBtn.hidden = !(state.stage.mode === 'review');
  if (clearBtn)  clearBtn.hidden  = (state.stage.mode === 'review');
}

function commitMatchToTotals(){
  const cur = computeCurrentScores();
  state.seasonTotals = state.seasonTotals || {};
  for (const p of state.players){
    state.seasonTotals[p] = (state.seasonTotals[p] || 0) + (cur[p] || 0);
  }
  state.matches = {}; // fresh sheets
  save(); renderRounds(); renderLeaderboards();
  alert('Results submitted to Season Totals!');
  // After submit, jump back to setup and show totals by default
  state.stage = { mode: 'setup', currentRound: 1 };
  leaderboardMode = 'totals';
  save();
  renderStageBar(); updateStageVisibility(); renderRounds(); renderLeaderboards();
}
function clearCurrentMatches(){
  state.matches = {}; save(); renderRounds(); renderLeaderboards();
}

/* ========== DEMO / RESET ========== */
function addPlayer(name){
  name = (name||'').trim();
  if (!name || state.players.includes(name)) return;
  state.players.push(name);
  save(); renderPlayers(); renderRounds(); renderStageBar(); updateStageVisibility();
  const input = $('#player-input'); if (input) input.value = "";
}
function loadDemo(){
  state.players = ["Ethan","Isaac","Dayne","Sam","Phoebe","Noah","Jenny"];
  state.rounds = 4; state.matches = {};
  state.stage = { mode: 'setup', currentRound: 1 };
  save(); renderPlayers(); renderRounds(); renderStageBar(); updateStageVisibility();
}
function resetAll(){
  if (!confirm("Clear all data?")) return;
  localStorage.removeItem(STORE_KEY);
  state = { players: [], rounds: 4, matches: {}, seasonTotals: {}, stage: { mode: 'setup', currentRound: 1 } };
  renderPlayers(); renderRounds(); renderLeaderboards(); renderStageBar(); updateStageVisibility();
}

/* ========== CARD SEARCH (via Cloudflare Worker proxy — no client key) ========== */

// 1) point to YOUR worker (keep /api suffix)
const TCG_API_BASE = 'https://pokebros-proxy.womba91.workers.dev/api';

// 2) tiny in-memory cache (keeps UI snappy for repeated queries)
const tcgCache = new Map();
const TCG_CACHE_MS = 5 * 60 * 1000;
const cacheGet = k => {
  const v = tcgCache.get(k);
  if (!v) return null;
  if (Date.now() - v.ts > TCG_CACHE_MS) { tcgCache.delete(k); return null; }
  return v.data;
};
const cacheSet = (k, d) => tcgCache.set(k, { ts: Date.now(), data: d });

// 3) query builder
function buildTcgQuery(name, type, standardOnly) {
  const parts = [];
  if (name) {
    const safe = String(name).replace(/"/g, '').trim();
    parts.push(safe.includes(' ') ? `name:"${safe}"` : `name:${safe}*`);
  }
  if (type) parts.push(`types:${type}`);
  if (standardOnly) parts.push(`legalities.standard:Legal`);
  return parts.join(' ');
}

// 4) fetch through the Worker (no headers, no key in browser)
async function fetchCards({ name, type, standardOnly }) {
  const q = buildTcgQuery(name, type, standardOnly);
  const params = new URLSearchParams({ pageSize: '12', orderBy: 'name' });
  if (q) params.set('q', q);

  const url = `${TCG_API_BASE}/cards?${params.toString()}`;
  const cacheKey = `v1|${q}|${params.get('pageSize')}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`TCG API error ${res.status}`);
  const data = await res.json();
  const cards = data.data || [];
  cacheSet(cacheKey, cards);
  return cards;
}

// 5) renderer
function renderCardResults(cards){
  const host = $('#tcg-results');
  host.innerHTML = '';
  if (!cards.length){
    host.innerHTML = `<div class="notes">No results. Try another name, remove filters, or uncheck Standard.</div>`;
    return;
  }

  for (const c of cards){
    const img = (c.images && (c.images.small || c.images.large)) || '';
    const types = (c.types || []).join(', ');
    const mark = c.regulationMark || (c.set && c.set.regulationMark) || '?';
    const el = document.createElement('div');
    el.className = 'tcg-card';
    el.tabIndex = 0;                      // make it focusable
    el.setAttribute('role', 'button');    // a11y hint
    el.setAttribute('aria-label', `View details for ${c.name}`);

    el.innerHTML = `
      ${img ? `<img loading="lazy" src="${img}" alt="${c.name} card">` : ''}
      <div class="meta">
        <div class="name">${c.name}</div>
        <div class="tags">
          ${types ? `<span class="tcg-tag">${types}</span>` : ''}
          <span class="tcg-tag">Reg: ${mark}</span>
          ${c.supertype ? `<span class="tcg-tag">${c.supertype}</span>` : ''}
          ${c.subtypes && c.subtypes.length ? `<span class="tcg-tag">${c.subtypes.join(' / ')}</span>` : ''}
        </div>
      </div>`;

    el.addEventListener('click', () => openCardModal(c));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openCardModal(c); });

    host.appendChild(el);
  }
}

function openCardModal(card) {
  const modal = document.querySelector('#card-modal');
  const body  = document.querySelector('#card-modal-body');
  if (!modal || !body) return;

  body.innerHTML = buildCardDetailHtml(card);
  modal.removeAttribute('hidden');

  // close handlers (click X, click backdrop, ESC)
  document.querySelector('#card-modal-close')?.addEventListener('click', closeCardModal, { once:true });
  modal.addEventListener('click', (e)=> { if (e.target === modal) closeCardModal(); }, { once:true });
  const onEsc = (e)=>{ if (e.key === 'Escape') { closeCardModal(); document.removeEventListener('keydown', onEsc); } };
  document.addEventListener('keydown', onEsc);

  // focus
  setTimeout(()=> document.querySelector('#card-modal-close')?.focus(), 0);
}

function closeCardModal() {
  document.querySelector('#card-modal')?.setAttribute('hidden', '');
}

function buildCardDetailHtml(c) {
  const big = c.images?.large || c.images?.small || '';
  const types = (c.types || []).join(', ');
  const subs  = (c.subtypes || []).join(' / ');
  const attacks = (c.attacks || []).map(a => `
    <div class="pb-attack">
      <div><strong>${a.name}</strong>${a.damage ? ` <span class="dmg">${a.damage}</span>` : ''}</div>
      ${a.cost?.length ? `<div class="cost">Cost: ${a.cost.join(' · ')}</div>` : ''}
      ${a.text ? `<div class="txt">${a.text}</div>` : ''}
    </div>
  `).join('');

  const wk = (c.weaknesses || []).map(w => `${w.type} ${w.value ?? ''}`).join(', ');
  const rs = (c.resistances || []).map(r => `${r.type} ${r.value ?? ''}`).join(', ');
  const rt = c.retreatCost?.length ? c.retreatCost.length : '';

  return `
    <div class="pb-modal-body">
      ${big ? `<img src="${big}" alt="${c.name} card image">` : ''}
      <div>
        <h3 id="card-modal-title" style="margin:0 0 6px;">${c.name}</h3>
        <div class="tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
          ${types ? `<span class="tcg-tag">${types}</span>` : ''}
          ${c.regulationMark ? `<span class="tcg-tag">Reg ${c.regulationMark}</span>` : ''}
          ${c.supertype ? `<span class="tcg-tag">${c.supertype}</span>` : ''}
          ${subs ? `<span class="tcg-tag">${subs}</span>` : ''}
        </div>
        <div class="muted" style="margin:6px 0 10px;">Set: ${c.set?.name || '?'} · #${c.number || ''}</div>

        ${attacks ? `<h4 style="margin:0 0 6px;">Attacks</h4>${attacks}` : ''}

        ${(wk || rs || rt) ? `
          <div style="margin-top:8px;">
            ${wk ? `<div>Weakness: ${wk}</div>` : ''}
            ${rs ? `<div>Resistance: ${rs}</div>` : ''}
            ${rt ? `<div>Retreat: ${rt}</div>` : ''}
          </div>` : ''}

        ${(c.tcgplayer?.url || c.cardmarket?.url) ? `
          <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
            ${c.tcgplayer?.url ? `<a class="btn" href="${c.tcgplayer.url}" target="_blank" rel="noopener">TCGplayer</a>` : ''}
            ${c.cardmarket?.url ? `<a class="btn" href="${c.cardmarket.url}" target="_blank" rel="noopener">Cardmarket</a>` : ''}
          </div>` : ''}
      </div>
    </div>
  `;
}

function wireCardModal() {
  // nothing to do now; kept in case you want to add global listeners later
}

// Utility: remove all listeners from an element by replacing it with a clone
function _stripAllListeners(selector){
  const el = document.querySelector(selector);
  if (!el || !el.parentNode) return el;
  const clone = el.cloneNode(true);
  el.parentNode.replaceChild(clone, el);
  return clone;
}

// 6) one-time wiring for the Card Search UI (Enter-only; no API-key controls)
function wireCardSearch() {
  // Remove the old API-key row/UI if it still exists
  document.querySelector('#tcg-api-key')?.closest('.row')?.remove();
  document.querySelector('#tcg-save-key')?.remove();

  // Hard reset inputs to drop ANY previously bound listeners
  const qInput     = _stripAllListeners('#tcg-query');
  const typeSelect = _stripAllListeners('#tcg-type');
  const stdCheck   = _stripAllListeners('#tcg-standard');
  const searchBtn  = _stripAllListeners('#tcg-search');
  const results    = document.querySelector('#tcg-results');

  if (qInput) qInput.placeholder = 'Search by name… (press Enter)';

  const doSearch = async () => {
    if (!results) return;
    const name = (qInput?.value || '').trim();
    const type = typeSelect?.value || '';
    const standardOnly = !!(stdCheck && stdCheck.checked);

    if (!name) { results.innerHTML = ''; return; }

    results.innerHTML = `<div class="notes">Searching…</div>`;
    try {
      const cards = await fetchCards({ name, type, standardOnly });
      renderCardResults(cards);
    } catch (err) {
      results.innerHTML = `<div class="notes">Error: ${err.message}</div>`;
    }
  };

  // ONLY trigger on Enter in the name box
  qInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSearch();
    }
  });

  // Optional: keep the button as a manual trigger
  searchBtn?.addEventListener('click', doSearch);

  // Keep Clear Results
  document.querySelector('#tcg-clear-results')?.addEventListener('click', () => {
    if (results) results.innerHTML = '';
  });
}

async function wireTrendingMeta() {
  const hostPanel = document.querySelector("#panel-cards");
  if (!hostPanel) return;

  // Create card if not present
  let box = document.querySelector("#meta-trending");
  if (!box) {
    box = document.createElement("div");
    box.id = "meta-trending";
    box.className = "card";
    box.innerHTML = `
      <h2 style="margin-top:0">Trending Decks (last 30 days)</h2>
      <div id="meta-trending-list" class="notes">Loading…</div>
      <div id="meta-matchups" style="margin-top:12px"></div>
    `;
    // put it under your card-search controls (adjust if needed)
    const anchor = document.querySelector("#tcg-results")?.closest(".card") || hostPanel;
    anchor.insertAdjacentElement("afterend", box);
  }

  const list = box.querySelector("#meta-trending-list");
  const muHost = box.querySelector("#meta-matchups");

  try {
    const base = location.origin; // same domain through your Worker
    const meta = await fetch(`${base}/meta/top-decks?format=STANDARD&days=30`).then(r => r.json());
    const rows = meta.top.slice(0, 12).map((d, i) =>
      `<div style="display:flex;gap:8px;align-items:center">
         <span style="min-width:1.5em;text-align:right">${i+1}.</span>
         <strong>${d.name}</strong>
         <span class="notes">(${d.count})</span>
       </div>`
    ).join("");
    list.innerHTML = rows || `<div class="notes">No recent data.</div>`;
  } catch (e) {
    list.innerHTML = `<div class="notes">Failed to load meta.</div>`;
  }

  // Optional: compact matchup table for top 6
  try {
    const base = location.origin;
    const data = await fetch(`${base}/meta/matchups?format=STANDARD&days=30&limitDecks=6`).then(r => r.json());
    const decks = data.decks || [];
    const table = data.table || {};

    if (decks.length) {
      let html = `<h3 style="margin:12px 0 6px">Top Deck Matchups (WR%)</h3>
      <div style="overflow:auto">
      <table style="border-collapse:collapse;min-width:420px">
        <thead><tr><th></th>${decks.map(d=>`<th style="padding:6px 8px;text-align:center">${d}</th>`).join("")}</tr></thead>
        <tbody>
          ${decks.map(a => `
            <tr>
              <th style="text-align:right;padding:6px 8px">${a}</th>
              ${decks.map(b => {
                if (a === b) return `<td style="padding:6px 8px;text-align:center;opacity:.3">—</td>`;
                const cell = table[a]?.[b];
                const wr = (cell && cell.wr != null) ? `${cell.wr}%` : "";
                return `<td title="W:${cell?.w||0} L:${cell?.l||0} T:${cell?.t||0} G:${cell?.g||0}"
                           style="padding:6px 8px;text-align:center">${wr}</td>`;
              }).join("")}
            </tr>`).join("")}
        </tbody>
      </table></div>`;
      muHost.innerHTML = html;
    } else {
      muHost.innerHTML = "";
    }
  } catch {
    muHost.innerHTML = "";
  }
}

/* ========== AI Assistant (Cloudflare Workers AI) ========== */
const AI_ENDPOINT = 'https://pokebros-proxy.womba91.workers.dev/ai/chat';

function wireAiAssistant(){
  const box   = document.querySelector('#ai-input');
  const btn   = document.querySelector('#ai-send');
  const clear = document.querySelector('#ai-clear');
  const msgs  = document.querySelector('#ai-messages');

  if (!box || !btn || !msgs) return; // AI panel not on page

  function addMsg(role, text){
    const wrap = document.createElement('div');
    wrap.className = `ai-msg ${role}`;
    const safe = String(text).replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s]));
    wrap.innerHTML = `<div class="bubble">${safe}</div>`;
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }

  async function send(){
    const message = (box.value || '').trim();
    if (!message) return;

    addMsg('user', message);
    box.value = '';
    btn.disabled = true;

    try{
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ message })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      addMsg('assistant', data.reply || 'No reply.');
    }catch(err){
      addMsg('assistant', `⚠️ ${err.message}`);
    }finally{
      btn.disabled = false;
      box.focus();
    }
  }

  // Enter to send (Shift+Enter = newline)
  box.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      send();
    }
  });
  btn.addEventListener('click', send);
  clear?.addEventListener('click', ()=> { msgs.innerHTML = ''; });
}

/* ========== Stage bar & visibility ========== */
function renderStageBar(){
  clampStage();

  const panel = $('#panel-tournament');
  if (!panel) return;

  // place bar right under Players card
  const playersCard = $('#players-list')?.closest('.card');

  let bar = $('#stagebar');
  const isNew = !bar;
  if (!bar){
    bar = document.createElement('div');
    bar.id = 'stagebar';
    bar.className = 'card';
  }

  // Steps: Setup • Round 1..N • Review
  const steps = ['Setup', ...Array.from({length: state.rounds}, (_,i)=>`Round ${i+1}`), 'Review'];
  const activeIndex =
    state.stage.mode === 'setup' ? 0 :
    state.stage.mode === 'review' ? steps.length - 1 :
    state.stage.currentRound;

  const chips = steps.map((s, i) =>
    `<button type="button" class="stage-chip${i===activeIndex?' active':''}" data-step="${i}">${s}</button>`
  ).join('');

  // SETUP row: rounds input on the left, Start button on the right
  const setupControls = (state.stage.mode === 'setup')
    ? `
      <div class="row stage-setup-row"
           style="margin-top:8px; align-items:center; justify-content:space-between; gap:12px;">
        <div class="row" style="gap:8px; align-items:center;">
          <label for="stage-rounds-input">Rounds</label>
          <input id="stage-rounds-input" type="number" min="1" max="9"
                 value="${state.rounds}" style="width:72px">
        </div>
        <button id="stage-start-top">Start Tournament</button>
      </div>`
    : '';

  bar.innerHTML = `
    <div class="row" style="justify-content:flex-start; align-items:center;">
      <div class="stage-chips" role="group" aria-label="Tournament stages"
           style="display:flex; gap:8px; flex-wrap:wrap;">
        ${chips}
      </div>
    </div>
    ${setupControls}
  `;

  if (playersCard) playersCard.insertAdjacentElement('afterend', bar);
  else if (isNew) panel.prepend(bar);

  // chip handlers
  bar.querySelectorAll('.stage-chip').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.step);
      if (idx === 0) setStage('setup');
      else if (idx === steps.length - 1) setStage('review');
      else setStage('round', idx); // idx maps to round #
    });
  });

  // rounds input
  const roundsInput = bar.querySelector('#stage-rounds-input');
  if (roundsInput){
    roundsInput.addEventListener('change', ()=>{
      const n = Math.max(1, Math.min(9, +roundsInput.value || state.rounds));
      state.rounds = n; clampStage(); save();
      renderStageBar(); renderRounds(); // refresh chips/sheets
    });
  }

  // NEW: top-right Start button (behaves like "Next" from setup)
  bar.querySelector('#stage-start-top')?.addEventListener('click', onStageNext);

  // keep bottom nav in sync (and we’ll hide it on setup)
  renderStageNavBottom();
}

function renderStageNavBottom(){
  clampStage();

  const panel = $('#panel-tournament');
  if (!panel) return;

  const footerEl = $('#panel-tournament footer');
  let nav = $('#stage-nav-bottom');
  if (!nav){
    nav = document.createElement('div');
    nav.id = 'stage-nav-bottom';
    nav.className = 'card';
    if (footerEl) footerEl.insertAdjacentElement('beforebegin', nav);
    else panel.appendChild(nav);
  }

  // Hide on Setup (we have Start in the setup bar) AND on Round pages
  if (state.stage.mode === 'setup' || state.stage.mode === 'round'){
    nav.hidden = true;
    return;
  }
  nav.hidden = false;

  // Review page content (unchanged)
  const prevLabel = `Back: Round ${state.rounds}`;
  const nextLabel = 'Submit Results';

  nav.innerHTML = `
    <div class="row" style="justify-content:center; align-items:center; gap:12px;">
      <button id="stage-prev-bottom">${prevLabel}</button>
      <button id="stage-next-bottom">${nextLabel}</button>
    </div>
  `;

  nav.querySelector('#stage-prev-bottom')?.addEventListener('click', onStagePrev);
  nav.querySelector('#stage-next-bottom')?.addEventListener('click', onStageNext);
}

function renderInlineRoundNav(){
  // only on round pages
  if (state.stage.mode !== 'round') {
    $('#stage-nav-inline')?.remove();
    return;
  }

  const rc = $('#rounds-container');
  const roundCard = rc?.querySelector('.round');
  if (!roundCard) return;

  // compute labels (same logic you already use)
  const prevLabel =
    state.stage.currentRound === 1 ? 'Back to Setup' :
    `Previous: Round ${state.stage.currentRound - 1}`;

  const nextLabel =
    state.stage.currentRound < state.rounds ? `Next: Round ${state.stage.currentRound + 1}` :
    'Go to Review';

  let nav = $('#stage-nav-inline');
  if (!nav){
    nav = document.createElement('div');
    nav.id = 'stage-nav-inline';
    // card-ish row centered
    nav.className = 'row';
    nav.style.cssText = 'justify-content:center;gap:12px;margin-top:16px;';
    roundCard.appendChild(nav);
  }

  nav.innerHTML = `
    <button id="stage-prev-inline">${prevLabel}</button>
    <button id="stage-next-inline">${nextLabel}</button>
  `;

  // wire buttons
  nav.querySelector('#stage-prev-inline')?.addEventListener('click', onStagePrev);
  nav.querySelector('#stage-next-inline')?.addEventListener('click', onStageNext);
}

function setStage(mode, round=null){
  if (mode === 'setup'){
    state.stage = { mode:'setup', currentRound: 1 };
  } else if (mode === 'round'){
    const r = Math.min(Math.max(round ?? state.stage.currentRound ?? 1, 1), state.rounds);
    state.stage = { mode:'round', currentRound: r };
  } else {
    state.stage = { mode:'review', currentRound: state.rounds };
  }
  save();
  renderStageBar();
  updateStageVisibility();
  renderRounds();
  renderLeaderboards();
  renderStageNavBottom();
}

function onStagePrev(){
  if (state.stage.mode === 'setup') return;
  if (state.stage.mode === 'review'){ setStage('round', state.rounds); return; }
  if (state.stage.mode === 'round'){
    if (state.stage.currentRound === 1) setStage('setup');
    else setStage('round', state.stage.currentRound - 1);
  }
}
function onStageNext(){
  if (state.stage.mode === 'setup'){
    if (state.players.length < 3){
      alert('Add at least 3 players before starting the tournament.');
      return;
    }
    // Only randomise if R1 has no pairs yet
    const hasR1 = Array.isArray(state.matches[1]) && state.matches[1].length > 0;
    if (!hasR1) randomiseR1();
    setStage('round', 1);
    return;
  }
  if (state.stage.mode === 'round'){
    if (state.stage.currentRound < state.rounds) setStage('round', state.stage.currentRound + 1);
    else setStage('review');
    return;
  }
  if (state.stage.mode === 'review'){
    commitMatchToTotals();
  }
}

// Show/hide cards based on stage
function updateStageVisibility(){
  const playersCard     = $('#players-list')?.closest('.card');
  const roundsCard      = $('#rounds-container')?.closest('.card');
  const leaderboardCard = $('#leaderboard')?.closest('.card');
  const roundsHeaderRow = $('#rounds')?.closest('.row'); // legacy "Number of rounds..." row

  if (roundsHeaderRow) roundsHeaderRow.hidden = true; // permanently hidden

  if (state.stage.mode === 'setup'){
    if (playersCard) playersCard.hidden = false;
    if (roundsCard)  roundsCard.hidden  = true;
    if (leaderboardCard) leaderboardCard.hidden = false;
  } else if (state.stage.mode === 'round'){
    if (playersCard) playersCard.hidden = true;
    if (roundsCard)  roundsCard.hidden  = false;
    if (leaderboardCard) leaderboardCard.hidden = true; // inline LB used instead
  } else { // review
    if (playersCard) playersCard.hidden = true;
    if (roundsCard)  roundsCard.hidden  = true;
    if (leaderboardCard) leaderboardCard.hidden = false;
  }

  ensureInlineRoundLeaderboard();
}

function ensureInlineRoundLeaderboard(){
  const rc = $('#rounds-container');
  if (!rc) return;

  // Remove old inline leaderboard if any
  rc.querySelector('#inline-lb')?.remove();

  if (state.stage.mode !== 'round') return;

  // Build a simple inline leaderboard (current match only)
  const wrap = document.createElement('div');
  wrap.id = 'inline-lb';
  wrap.className = 'card';
  const scores = computeCurrentScores();
  const rows = state.players.map(p => ({ player:p, total: scores[p] ?? 0 }))
                            .sort((a,b)=> (b.total - a.total) || a.player.localeCompare(b.player));

  wrap.innerHTML = `
    <h2 style="margin-top:0">Current Match Leaderboard</h2>
    <table style="width:100%; border-collapse:collapse" aria-label="Current standings">
      <thead><tr><th style="text-align:left;padding:8px 10px">Rank</th><th style="text-align:left;padding:8px 10px">Player</th><th style="text-align:left;padding:8px 10px">Total</th></tr></thead>
      <tbody>
        ${rows.map((r,i)=>`<tr><td style="padding:8px 10px">${i+1}</td><td style="padding:8px 10px">${r.player}</td><td style="padding:8px 10px">${r.total}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
  rc.appendChild(wrap);
}

/* ========== Tabs ========== */
const TAB_KEY = 'pokebros_active_tab';
const panels = { tournament: $('#panel-tournament'), cards: $('#panel-cards') };
const tabButtons = Array.from($$('.tabs .tab'));

function resolveTabNameFromButton(btn){
  const data = btn?.dataset?.tab;
  if (data) return data;
  const id = btn?.id || '';
  if (id.startsWith('tab-')) return id.slice(4);
  const ac = btn?.getAttribute('aria-controls') || '';
  if (ac.startsWith('panel-')) return ac.slice(6);
  return 'tournament';
}
function showTab(name){
  if (!['tournament','cards'].includes(name)) name = 'tournament';

  Object.entries(panels).forEach(([k,el])=>{
    const active = (k===name);
    el?.classList.toggle('is-active', active);
    if (active) el?.removeAttribute('hidden'); else el?.setAttribute('hidden','');
  });

  tabButtons.forEach(btn=>{
    const active = resolveTabNameFromButton(btn) === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  localStorage.setItem(TAB_KEY, name);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ========== INIT ========== */
function init(){
  load();
  renderPlayers();
  renderRounds();
  renderLeaderboards();
  renderStageBar();
  updateStageVisibility();
  renderStageNavBottom();
  wireCardSearch();
  wireAiAssistant();
  wireTrendingMeta();
  wireCardModal();

  // ensure the old Rounds header row is hidden from the outset
  $('#rounds')?.closest('.row')?.setAttribute('hidden','');

  // Players controls
  $('#add-player')?.addEventListener('click', ()=> addPlayer($('#player-input').value));
  $('#player-input')?.addEventListener('keydown', e=>{ if (e.key==='Enter') addPlayer(e.target.value); });
  $('#clear-players')?.addEventListener('click', ()=>{ if (confirm("Remove all players?")){ state.players=[]; state.matches={}; save(); renderPlayers(); renderRounds(); renderLeaderboards(); renderStageBar(); updateStageVisibility(); }});
  const toggleHost = $('#add-player-toggle');
  if (toggleHost){
    toggleHost.addEventListener('click', (e)=>{
      if (e.target.closest('#clear-players-inline')) return;
      if (e.target.closest('#add-more-btn')) return;
    });
  }

  // Leaderboard controls
  $('#lb-current')?.addEventListener('click', ()=>{ leaderboardMode='current'; $('#lb-current').classList.add('active'); $('#lb-totals').classList.remove('active'); renderLeaderboards(); });
  $('#lb-totals')?.addEventListener('click', ()=>{ leaderboardMode='totals'; $('#lb-totals').classList.add('active'); $('#lb-current').classList.remove('active'); renderLeaderboards(); });
  $('#commit-totals')?.addEventListener('click', ()=>{ if (confirm('Add current scores to Season Totals and clear match sheets?')) commitMatchToTotals(); });
  $('#clear-current-matches')?.addEventListener('click', ()=>{ if (confirm('Clear only the current match sheets?')) clearCurrentMatches(); });

  // Footer controls
  $('#load-demo')?.addEventListener('click', loadDemo);
  $('#reset')?.addEventListener('click', resetAll);
  $('#export-json')?.addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download='pokebros-tournament.json'; a.click();
    URL.revokeObjectURL(url);
  });
  $('#import-json')?.addEventListener('change', async e=>{
    const file = e.target.files?.[0]; if (!file) return;
    try{
      const text = await file.text();
      const loaded = JSON.parse(text);
      if (!loaded || typeof loaded !== 'object' || !('matches' in loaded)) throw new Error('Invalid data');
      state = loaded; clampStage(); save();
      renderPlayers(); renderRounds(); renderLeaderboards(); renderStageBar(); updateStageVisibility();
      alert('Import complete!');
    }catch(err){ alert('Import failed: ' + err.message); }
    e.target.value = '';
  });

  // Tabs
  tabButtons.forEach(btn=> btn.addEventListener('click', ()=> showTab(resolveTabNameFromButton(btn))));
  const savedTab = localStorage.getItem(TAB_KEY);
  showTab(savedTab);
}

window.addEventListener('DOMContentLoaded', init);

/* ========== Randomise R1 (auto-called on Start Tournament) ========== */
function randomiseR1(){
  if (state.players.length < 3){ alert("Add at least 3 players"); return; }
  const arr = [...state.players];
  for (let i=arr.length-1; i>0; i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  const round=1; state.matches[round]=[];
  state.matches[round + '_bye'] = (arr.length % 2 === 1) ? arr.pop() : "";
  while (arr.length >= 2){ const p1=arr.shift(), p2=arr.shift(); state.matches[round].push({ p1, p2, outcome:"", bonus:0 }); }
  save(); renderRounds(); renderStageBar(); updateStageVisibility();
}