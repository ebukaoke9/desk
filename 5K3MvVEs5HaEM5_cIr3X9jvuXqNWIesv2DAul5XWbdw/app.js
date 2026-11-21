/* Desk iPhone app. Plain JS. Every FOMO URL comes from the API (links.py); none are built here. */
(function () {
  'use strict';
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BOT = { scanner: '#64d2ff', analyst: '#ffd60a', brain: '#bf5af2', executor: '#00d35a', risk: '#ff6b9a', copy: '#0a84ff' };

  // ---- token: #t=... -> localStorage, then clear the hash (never stored in files)
  // STATIC = Plan B snapshot on a static host (set by tools/publish.py). Its data is AES-GCM sealed;
  // the key comes once from #k=... into localStorage, then the hash is cleared (never in files).
  const STATIC = !!window.DESK_STATIC;
  (function () {
    const t = location.hash.match(/[#&]t=([^&]+)/), k = location.hash.match(/[#&]k=([^&]+)/);
    if (t) localStorage.setItem('desk_t', decodeURIComponent(t[1]));
    if (k) localStorage.setItem('desk_k', decodeURIComponent(k[1]));
    if (t || k) history.replaceState(null, '', location.pathname);
    // iPhone: a Home Screen app does not share Safari's storage and opens at start_url (no #k=). So in Safari,
    // right after the link was opened, offer to copy the unlock code (never shown on screen) for the one paste.
    const standalone = navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (k && window.DESK_STATIC && !standalone) {
      const code = '#k=' + k[1];
      window.addEventListener('DOMContentLoaded', () => {
        const d = document.createElement('div'); d.id = 'install';
        d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:50;background:#1c1c1e;border-radius:16px;padding:14px 16px;font:15px -apple-system,system-ui;color:#fff;box-shadow:0 8px 30px #000a';
        d.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Install on iPhone</div>' +
          '<div style="color:#8e8e93;font-size:13px;margin-bottom:10px">1 Copy unlock code · 2 Share → Add to Home Screen · 3 Open Desk from the Home Screen, paste, Unlock</div>' +
          '<button id="cpk" style="width:100%;min-height:44px;border:0;border-radius:12px;background:#0a84ff;color:#fff;font:600 15px -apple-system,system-ui">Copy unlock code</button>' +
          '<button id="xk" style="width:100%;min-height:36px;border:0;background:none;color:#8e8e93;font:13px -apple-system,system-ui;margin-top:4px">Done</button>';
        document.body.appendChild(d);
        d.querySelector('#cpk').onclick = async () => { try { await navigator.clipboard.writeText(code); d.querySelector('#cpk').textContent = 'Copied · now Add to Home Screen'; } catch (e) { d.querySelector('#cpk').textContent = 'Copy failed: open the link again'; } };
        d.querySelector('#xk').onclick = () => d.remove();
      });
    }
  })();
  const TOKEN = () => STATIC ? (localStorage.getItem('desk_k') || '') : (localStorage.getItem('desk_t') || '');
  const KEY = () => localStorage.getItem('desk_k') || '';

  // ---- API + offline handling (keep last good numbers, never invent)
  const net = { ok: true, lastOk: null, fails: 0, retryAt: 0 };
  const cache = {};
  const snap = { ts: null, every: null };
  const softErr = m => { const e = new Error(m); e.soft = true; return e; };
  async function staticFile(logical) {
    // ?t= busts the host CDN cache (GitHub Pages serves max-age=600); the name itself stays the HMAC
    const r = await fetch('d/' + await DeskCrypt.fileName(KEY(), logical) + '.bin?t=' + Date.now(), { cache: 'no-store' });
    if (r.status === 404) throw softErr('Not in this snapshot');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.arrayBuffer();
  }
  async function staticApi(path, opts) {
    if ((opts.method || 'GET') !== 'GET') throw softErr('Read-only snapshot · changes need the desk');
    const logical = path.replace(/^\/api\//, '').replace('?range=', '_');
    let o; try { o = await DeskCrypt.openJson(KEY(), logical, await staticFile(logical)); }
    catch (e) { if (e.soft || e.message.startsWith('HTTP') || e instanceof TypeError) throw e; throw softErr('Wrong desk key for this snapshot'); }
    snap.ts = o.ts; snap.every = o.every; return o.data;
  }
  async function api(path, opts) {
    opts = opts || {};
    if (STATIC) return staticApi(path, opts);
    const r = await fetch(path, { method: opts.method || 'GET', headers: Object.assign({ Authorization: 'Bearer ' + TOKEN() },
      opts.body ? { 'Content-Type': 'application/json' } : {}), body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' });
    if (r.status === 401) { const e = new Error('unauthorized'); e.status = 401; throw e; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.detail || ('HTTP ' + r.status)); e.status = r.status; e.soft = true; throw e; }
    return j;
  }
  async function get(path) {
    try { const j = await api(path); cache[path] = j; markOk(); return j; }
    catch (e) { if (e.soft) throw e; markFail(); if (cache[path]) return cache[path]; throw e; }
  }
  function markOk() { net.ok = true; net.fails = 0; net.lastOk = STATIC && snap.ts ? new Date(snap.ts * 1000) : new Date(); $('#offline').hidden = true; showOffline(); }
  function markFail() {
    net.ok = false; net.fails++; const wait = Math.min(30, 2 ** Math.min(net.fails, 5));
    net.retryAt = Date.now() + wait * 1000; showOffline();
  }
  function showOffline() {
    if (net.ok && STATIC && snap.ts && snap.every && Date.now() / 1000 - snap.ts > 3 * snap.every + 30) {
      const el = $('#offline'); el.hidden = false; el.textContent = `Desk offline · last update ${fmtTime(snap.ts)}`; return;
    }
    if (net.ok) return;
    const n = Math.max(0, Math.ceil((net.retryAt - Date.now()) / 1000));
    const el = $('#offline'); el.hidden = false;
    el.textContent = `Desk offline · retrying in ${n}s · last update ${net.lastOk ? fmtTime(net.lastOk) : 'never'}`;
  }
  setInterval(showOffline, 1000);

  // ---- format
  const fmtUsd = (v, d = 2) => v == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPct = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const fmtTime = d => (d instanceof Date ? d : new Date(d * 1000)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtPrice = v => v == null ? '—' : v >= 1 ? '$' + v.toFixed(4) : '$' + v.toPrecision(4);
  const fmtCompact = v => v == null ? '—' : '$' + Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const ago = ts => { const s = Math.round(Date.now() / 1000 - ts); return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h'; };
  const modePill = m => `<span class="pill ${m === 'LIVE' ? 'live' : 'paper'}">${m === 'LIVE' ? 'LIVE' : 'PAPER'}</span>`;
  const fomoLink = (url, txt) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(txt || 'Open on FOMO')}</a>` : '';
  function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }

  // ---- odometer: digit roll 600ms ease-out, 30ms stagger
  function odometer(el, text) {
    if (el._text === text) return; const old = el._text; el._text = text;
    if (!old || old.length !== text.length || RM) {
      el.innerHTML = [...text].map(ch => /\d/.test(ch)
        ? `<span class="d"><span class="s">${[...'0123456789'].map(n => `<span>${n}</span>`).join('')}</span></span>`
        : `<span>${esc(ch)}</span>`).join('');
      const strips = el.querySelectorAll('.s'); let i = 0;
      [...text].forEach(ch => { if (/\d/.test(ch)) { const s = strips[i++]; s.style.transition = 'none'; s.style.transform = `translateY(-${(old && !RM ? 0 : +ch) * 1.05}em)`; } });
      if (old && !RM) requestAnimationFrame(() => roll(el, text)); return;
    }
    roll(el, text);
  }
  function roll(el, text) {
    const strips = el.querySelectorAll('.s'); let i = 0;
    [...text].forEach(ch => { if (/\d/.test(ch)) { const s = strips[i]; s.style.transition = RM ? 'none' : '';
      s.style.transitionDelay = (i * 30) + 'ms'; s.style.transform = `translateY(-${+ch * 1.05}em)`; i++; } });
  }

  // ---- router
  let route = { tab: 'home' }; let timers = [];
  function clearTimers() { timers.forEach(t => clearInterval(t)); timers = []; }
  function go(r, push = true) {
    route = r; clearTimers();
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === (r.tab || '')));
    if (push) history.pushState(r, '', '#/' + (r.tab || r.view) + (r.mint ? '/' + r.mint : ''));
    window.scrollTo(0, 0); render();
  }
  window.addEventListener('popstate', e => { if (e.state) go(e.state, false); });
  window.addEventListener('hashchange', () => { if (/^#\/\w/.test(location.hash)) go(initialRoute(), false); });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => go({ tab: b.dataset.tab })));
  function initialRoute() {
    const m = location.hash.match(/^#\/(\w+)(?:\/(\w+))?/);
    if (!m) return { tab: 'home' };
    if (['audit', 'coin'].includes(m[1]) && m[2]) return { view: m[1], mint: m[2] };
    return { tab: ['home', 'bots', 'activity', 'account'].includes(m[1]) ? m[1] : 'home' };
  }
  const V = () => $('#view');
  function render() {
    if (!TOKEN()) {
      // Home Screen apps on iPhone don't share Safari's storage, so the key can be pasted once here.
      V().innerHTML = `<div class="nav"><div class="title" style="font-size:34px;font-weight:700">Desk</div></div>
        <div class="list" style="padding:16px"><div class="sec" style="font-size:15px;margin-bottom:12px">Open the desk link once, or paste the link or key here.</div>
        <input id="keyin" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Desk key" style="width:100%;font:15px ui-monospace,monospace;background:#2c2c2e;color:#fff;border:0;border-radius:12px;padding:12px;min-height:44px">
        <button class="btn d" id="keygo" style="width:100%;margin-top:12px;background:var(--blue)">Unlock</button></div>`;
      $('#keygo').onclick = () => {
        const v = $('#keyin').value.trim(), m = v.match(/[#&]([kt])=([^&\s]+)/);
        const val = m ? decodeURIComponent(m[2]) : v; if (!val) return;
        localStorage.setItem((m ? m[1] : (STATIC ? 'k' : 't')) === 'k' ? 'desk_k' : 'desk_t', val); render();
      };
      return;
    }
    const f = ({ home: Home, bots: Bots, activity: Activity, account: Account })[route.tab];
    if (f) f(); else if (route.view === 'audit') Audit(); else if (route.view === 'coin') Coin(); else Home();
  }
  const skel = (h, r) => `<div class="sk" style="height:${h}px;${r ? 'border-radius:' + r + 'px;' : ''}margin-bottom:12px"></div>`;

  // =================================================================== HOME
  let chartRange = 'LIVE';
  function Home() {
    V().innerHTML = `
      <div class="nav"><div class="avatar">W</div><button class="title" id="gb">Grok Bot ›</button>
        <button class="icon-btn" id="search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></button>
        <button class="icon-btn" id="bell" aria-label="Activity"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/></svg></button></div>
      <div id="balwrap">${skel(70)}${skel(22)}</div>
      <canvas class="chart" id="chart"></canvas>
      <div class="ranges" id="ranges">${['LIVE', '1H', '4H', '1D', '1W', 'ALL'].map(r => `<button class="${r === chartRange ? 'on' : ''}" data-r="${r}">${r}</button>`).join('')}</div>
      <div class="screen" id="screen"><div class="noframe">Connecting…</div><img id="imgA" alt="" hidden><img id="imgB" alt="" hidden>
        <div class="tag" id="stag"><span class="dot"></span><span>Waiting for a frame</span></div><div class="owner" id="sowner">Idle</div></div>
      <div class="lastorder" id="lastorder"></div>
      <div class="section-h"><span id="botsh">Bots</span><button id="toBots">See all</button></div>
      <div class="carousel" id="carousel">${skel(172, 20)}</div>
      <div class="section-h"><span>Activity</span><button id="toAct">See all</button></div>
      <div id="act">${skel(60)}${skel(60)}</div>`;
    $('#gb').onclick = () => go({ tab: 'account' }); $('#bell').onclick = () => go({ tab: 'activity' });
    $('#toBots').onclick = () => go({ tab: 'bots' }); $('#toAct').onclick = () => go({ tab: 'activity' });
    $('#search').onclick = () => { const m = prompt('Coin mint address'); if (m && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.trim())) go({ view: 'coin', mint: m.trim() }); };
    $('#ranges').onclick = e => { const r = e.target.dataset.r; if (!r) return; chartRange = r;
      [...$('#ranges').children].forEach(b => b.classList.toggle('on', b.dataset.r === r)); $('#chart')._last = null; loadChart(); };
    $('#screen').onclick = openFull;
    loadHome(); loadChart(); screenLoop();
    timers.push(setInterval(loadHome, 2000), setInterval(loadChart, 5000), setInterval(screenLoop, 1000));
  }
  async function loadHome() {
    let s; try { s = await get('/api/summary'); } catch (e) { return; }
    if (route.tab !== 'home') return;
    const bw = $('#balwrap');
    if (!bw.querySelector('.big')) bw.innerHTML = `<div class="bal-row"><div class="big odo" id="bal"></div>${modePill(s.mode)}</div><div class="today" id="today"></div>`;
    if (s.balance == null) { $('#bal').textContent = '—'; }
    else odometer($('#bal'), fmtUsd(s.balance));
    const tp = s.todayPct;
    $('#today').innerHTML = s.balance == null ? `<span class="sec">No balance yet</span>` :
      `<span class="${tp == null ? 'sec' : tp >= 0 ? 'green' : 'red'}">${fmtPct(tp)}</span><span class="sec">today</span>` +
      (s.multiplier != null ? `<span class="pill mult ${s.multiplier < 1 ? 'neg' : ''}">${s.multiplier.toFixed(2)}x</span>` : '') +
      (s.label ? `<span class="pill paper">${esc(s.label)}</span>` : '');
    // last order + owner
    const o = s.lastOrder;
    $('#lastorder').innerHTML = o ? `<span>${esc(o.side === 'buy' ? 'Buy' : 'Sell')} ${esc(o.symbol || o.mint.slice(0, 4))} · ${esc(o.status)} · ${fmtTime(o.ts)}</span>
      <span class="checks">${['screen', 'api', 'chain'].map(k => `<span class="chk ${o.checks && o.checks[k] ? 'on' : ''}">${k}</span>`).join('')}</span>` : `<span>No orders yet</span>`;
    const ow = $('#sowner'); ow.textContent = s.owner ? s.owner[0].toUpperCase() + s.owner.slice(1) : 'Idle'; ow.style.color = s.owner ? BOT[s.owner] : 'var(--sec)';
    // bots carousel
    const running = Object.values(s.heartbeats).filter(h => ['scanner', 'analyst', 'brain', 'executor', 'risk'].includes(h.bot) && Date.now() / 1000 - h.ts < 90 && h.state !== 'paused').length;
    $('#botsh').textContent = `Bots · ${running} running`;
    $('#carousel').innerHTML = s.bots.map(botMini).join('');
    s.bots.forEach(b => { const cv = document.getElementById('ring-' + b.id); if (cv) Charts.ring(cv, b.score, 70); });
    $('#carousel').querySelectorAll('.bot').forEach(el => el.onclick = () => go({ tab: 'bots' }));
    // activity
    $('#act').innerHTML = s.activity.length ? `<div class="list">${s.activity.map(actRow).join('')}</div>`
      : `<div class="empty">Waiting for the first trade</div>`;
    bindRows($('#act'));
  }
  function botMini(b) {
    let body = '';
    if (b.id === 'analyst') {
      const L = b.layers || [];
      body = `<div style="display:flex;gap:14px;align-items:center"><canvas class="ring" id="ring-analyst"></canvas><div style="flex:1">
        <div class="strips">${[...Array(8)].map((_, i) => { const l = L[i]; return `<i class="strip ${l ? (l.pass === 1 ? 'ok' : l.pass === 0 ? 'bad' : '') : ''}"></i>`; }).join('')}</div>
        <div class="sec" style="font-size:14px;margin-top:8px">${b.social === 'off' || !b.social ? 'Social: off' : (b.socialPts != null ? `Social ${b.socialPts >= 0 ? '+' : ''}${b.socialPts}` : 'Social —')}</div></div></div>`;
    } else if (b.id === 'brain') {
      body = b.sizing ? `<div class="sec">${b.sizing.usd > 0 ? `${fmtUsd(b.sizing.usd)} · ${b.sizing.pct}% of cash` : esc(b.sizing.reason)}</div>
        ${b.sizing.cap && b.sizing.cap !== 'none' ? `<span class="pill thr" style="background:var(--card2)">cap ${esc(b.sizing.cap)}</span>` : ''}` : `<div class="sec">No sizing yet</div>`;
    } else if (b.id === 'executor') {
      body = `<div class="sec" style="font-size:14px">${esc(b.status)}</div><div class="statusbar"><i style="width:${/done/.test(b.status) ? 100 : /buy|sell/i.test(b.status) ? 50 : 0}%"></i></div>`;
    } else if (b.id === 'risk') {
      body = `<div style="display:flex;gap:6px"><span class="pill thr red">${esc(b.pills[0])}</span><span class="pill thr green">${esc(b.pills[1])}</span></div>
        <div class="sec" style="font-size:14px">${b.guarding ? b.guarding + ' open' : 'Nothing open'}</div>`;
    } else body = `<div class="sec" style="font-size:14px">PumpSwap graduates tonight</div>`;
    return `<div class="bot"><div class="h"><i class="c" style="background:${b.color}"></i>${esc(b.name)}</div>
      <div class="n">${esc(b.countLabel)}</div>${body}</div>`;
  }
  const ICON = { buy: ['B', '#0a84ff'], sell: ['S', '#00d35a'], stop: ['−', '#ff453a'], reject: ['×', '#ff9f0a'], copy: ['C', '#0a84ff'], skip: ['·', 'rgba(235,235,245,.3)'], sizing: ['$', '#bf5af2'], night: ['☾', '#64d2ff'] };
  function actRow(a) {
    const [ch, col] = ICON[a.kind] || ['•', '#636366'];
    const neg = (a.amount || '').startsWith('-'), pos = (a.amount || '').startsWith('+');
    return `<div class="row" data-mint="${esc(a.mint || '')}"><div class="ic" style="background:${col}29;color:${col}">${ch}</div>
      <div class="t"><b>${esc(a.title)}</b><small>${esc(a.sub || '')}${a.ts ? ' · ' + fmtTime(a.ts) : ''}</small></div>
      <div class="r"><span class="${neg ? 'red' : pos ? 'green' : ''}">${esc(a.amount || '')}</span>${a.link ? `<small>${fomoLink(a.link)}</small>` : ''}</div></div>`;
  }
  function bindRows(root) {
    root.querySelectorAll('.row[data-mint]').forEach(r => r.addEventListener('click', e => {
      if (e.target.closest('a')) return; const m = r.dataset.mint; if (m) go({ view: 'coin', mint: m }); }));
  }
  async function loadChart() {
    let c; try { c = await get('/api/chart?range=' + chartRange); } catch (e) { return; }
    const cv = $('#chart'); if (!cv) return;
    if (!c.points.length) { const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height); return; }
    Charts.line(cv, { points: c.points, marks: c.marks, start: c.start, color: '#00d35a' });
  }
  // live screen: double-buffered, every 1 s
  let front = 'A', lastFrame = null;
  async function screenLoop() {
    const sc = $('#screen'); if (!sc) return;
    try {
      let blob = null, ft = null;
      if (STATIC) {
        const s = cache['/api/summary'];
        if (s && s.screenTs && s.screenTs !== lastFrame) {
          blob = new Blob([await DeskCrypt.open(KEY(), 'screen', await staticFile('screen'))], { type: 'image/jpeg' }); ft = s.screenTs;
        }
      } else {
        const r = await fetch('/api/screen.jpg?ts=' + Date.now(), { headers: { Authorization: 'Bearer ' + TOKEN() }, cache: 'no-store' });
        if (r.ok) { ft = parseFloat(r.headers.get('X-Frame-Ts')) || Date.now() / 1000; blob = await r.blob(); }
      }
      if (blob) {
        const url = URL.createObjectURL(blob);
        const back = front === 'A' ? 'B' : 'A', bi = $('#img' + back), fi = $('#img' + front);
        bi.onload = () => { bi.hidden = false; fi.hidden = true; if (fi.src) URL.revokeObjectURL(fi.src); front = back; };
        bi.src = url; lastFrame = ft; const nf = sc.querySelector('.noframe'); if (nf) nf.remove();
      }
    } catch (e) { }
    const tag = $('#stag'); if (!tag) return;
    if (lastFrame && Date.now() / 1000 - lastFrame < 5) tag.innerHTML = `<span class="dot live"></span><span>Live · Bot's computer</span>`;
    else tag.innerHTML = `<span class="dot"></span><span>${lastFrame ? 'Last frame ' + fmtTime(lastFrame) : 'No frame yet'}</span>`;
  }
  async function openFull() {
    const img = $('#img' + front); if (!img || !img.src || img.hidden) return;
    let link = null; try { const s = cache['/api/summary']; link = s && s.lastOrder && s.lastOrder.link; } catch (e) { }
    const f = $('#full'); f.hidden = false;
    f.innerHTML = `<div class="bar"><button class="back" id="fclose">Done</button>${link ? fomoLink(link) : ''}</div>
      <div class="stage" id="stage"><img id="fimg" src="${img.src}" alt="Bot's screen"></div>`;
    $('#fclose').onclick = () => { f.hidden = true; f.innerHTML = ''; };
    // pinch zoom + pan
    const fi = $('#fimg'), st = $('#stage'); let sc = 1, tx = 0, ty = 0, pts = new Map(), d0 = 0, s0 = 1, p0 = null;
    const apply = () => fi.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`;
    st.addEventListener('pointerdown', e => { st.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); s0 = sc; } p0 = { x: e.clientX - tx, y: e.clientY - ty }; });
    st.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; sc = Math.min(5, Math.max(1, s0 * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / d0)); }
      else if (sc > 1 && p0) { tx = e.clientX - p0.x; ty = e.clientY - p0.y; } apply(); });
    const up = e => { pts.delete(e.pointerId); if (sc <= 1) { tx = ty = 0; apply(); } };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    st.addEventListener('dblclick', () => { sc = sc > 1 ? 1 : 2.5; tx = ty = 0; apply(); });
  }

  // =================================================================== BOTS
  function Bots() {
    V().innerHTML = `<div class="nav"><div class="title" style="font-size:34px;font-weight:700">Bots</div></div><div id="bl">${skel(150, 20)}${skel(150, 20)}</div>`;
    loadBots(); timers.push(setInterval(loadBots, 3000));
  }
  async function loadBots() {
    let d; try { d = await get('/api/bots'); } catch (e) { return; }
    if (route.tab !== 'bots') return;
    const open = {}; document.querySelectorAll('#bl details').forEach(x => open[x.dataset.b] = x.open);
    $('#bl').innerHTML = d.bots.map(b => {
      const alive = b.hbTs && Date.now() / 1000 - b.hbTs < 90;
      const dot = b.paused ? 'warn' : !alive ? '' : b.state === 'error' ? 'live' : 'ok';
      return `<div class="botcard"><div class="top"><i class="dot ${dot}"></i><span class="nm" style="color:${b.color}">${esc(b.name)}</span>
        <button class="switch ${b.paused ? '' : 'on'}" data-b="${b.id}" ${b.locked ? 'disabled title="Locked while a position is open"' : ''} aria-label="Run ${esc(b.name)}"></button></div>
        <div style="display:flex;justify-content:space-between;margin:10px 0 2px"><span class="n" style="font-size:24px;font-weight:700">${esc(b.countLabel)}</span>
        <span class="sec" style="font-size:14px">${b.paused ? 'Paused' : alive ? esc(b.state) : 'Off'}${b.locked ? ' · locked' : ''}</span></div>
        <details data-b="${b.id}" ${open[b.id] ? 'open' : ''}><summary>Last ${b.decisions.length} decisions</summary>
        ${b.decisions.length ? b.decisions.map(x => `<div class="dec"><span><b>${esc(x.symbol || (x.mint || '').slice(0, 6))}</b> ${esc(x.title || '')}<br><span class="sec">${esc(x.sub || '')} · ${x.ts ? fmtTime(x.ts) : ''}</span></span>
          <span style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">${x.mint ? `<button class="audit" data-m="${esc(x.mint)}" style="color:var(--blue);font-size:14px">Audit</button>` : ''}${fomoLink(x.link, 'FOMO')}</span></div>`).join('')
          : `<div class="sec" style="padding:8px 0">Nothing yet tonight</div>`}</details>
        <button class="settings-sc" data-b="${b.id}" style="color:var(--blue);font-size:15px;min-height:44px">Settings ›</button></div>`;
    }).join('') + `<div class="botcard"><div class="top"><i class="dot ${d.copy.state === 'ok' ? 'ok' : ''}"></i><span class="nm" style="color:${BOT.copy}">Copy feed</span></div>
        <div class="sec" style="margin-top:8px">${d.copy.signals} signals today · top FOMO traders</div></div>`;
    $('#bl').querySelectorAll('.switch').forEach(s => s.onclick = async () => {
      if (s.disabled) return; const b = s.dataset.b, on = s.classList.contains('on');
      try { await api(`/api/${on ? 'pause' : 'resume'}/${b}`, { method: 'POST' }); loadBots(); } catch (e) { toast(e.message); } });
    $('#bl').querySelectorAll('.audit').forEach(a => a.onclick = () => go({ view: 'audit', mint: a.dataset.m }));
    $('#bl').querySelectorAll('.settings-sc').forEach(a => a.onclick = () => { go({ tab: 'account' }); setTimeout(() => { const g = document.getElementById('grp-' + a.dataset.b); g && g.scrollIntoView(); }, 400); });
  }

  // =================================================================== ACTIVITY
  function Activity() {
    V().innerHTML = `<div class="nav"><div class="title" style="font-size:34px;font-weight:700">Activity</div></div><div id="al">${skel(60)}${skel(60)}${skel(60)}</div>`;
    loadAct(); timers.push(setInterval(loadAct, 3000));
  }
  async function loadAct() {
    let rows; try { rows = await get('/api/feed'); } catch (e) { return; }
    if (route.tab !== 'activity') return;
    $('#al').innerHTML = rows.length ? `<div class="list">${rows.map(actRow).join('')}</div>` : `<div class="empty">Nothing yet tonight</div>`;
    bindRows($('#al'));
  }

  // =================================================================== AUDIT
  const LNAMES = ['Mint authority', 'Freeze authority', 'Dev wallet', 'Top 10', 'Liquidity', 'Pool age', 'Bundles', 'Delegations'];
  function Audit() {
    V().innerHTML = `<button class="back" id="bk">‹ Back</button><div id="au">${skel(40)}${skel(120)}${skel(300)}</div>`;
    $('#bk').onclick = () => history.back();
    loadAudit(); timers.push(setInterval(loadAudit, 2000));
  }
  async function loadAudit() {
    let a, c; try { a = await get('/api/audit/' + route.mint); c = await get('/api/coin/' + route.mint); } catch (e) { return; }
    if (route.view !== 'audit') return;
    const L = a.layers || []; const firstGrey = L.length < 8 ? L.length : L.findIndex(l => l.pass == null);
    const busy = L.length && L.length < 8 && Date.now() / 1000 - L[L.length - 1].ts < 30;
    const soc = a.social ? (a.social.plan === 'off' ? 'Social: off' : a.social.plan === 'fomo-only' ? `fomo-only · ${a.social.value != null ? a.social.value.toFixed(2) : '—'}` : `${a.social.plan} · ${a.social.value}`) : 'Social: off';
    $('#au').innerHTML = `<div class="coinh"><span class="sym">${esc(c.symbol || route.mint.slice(0, 6))}</span>${modePill(c.mode)}</div>
      <div class="sec mono" style="font-size:13px">${esc(route.mint)}</div>
      <div class="discs">${LNAMES.map((n, i) => { const l = L[i]; const cls = l ? (l.pass === 1 ? 'ok' : l.pass === 0 ? 'bad' : '') : '';
        return `<div class="disc ${cls} ${busy && i === firstGrey ? 'beam' : ''}"><i>${i + 1}</i><span>${esc(n)}</span></div>`; }).join('')}</div>
      <div class="card">${LNAMES.map((n, i) => { const l = L[i];
        return `<div class="lrow"><span>${esc(n)}</span><span class="v ${l ? (l.pass === 1 ? 'green' : l.pass === 0 ? 'red' : 'ter') : 'ter'}">${esc(l ? l.value : 'not checked')}</span></div>`; }).join('')}
        <div class="lrow"><span>Social</span><span class="v">${esc(soc)}</span></div>
        <div class="lrow"><span>Score</span><span class="v">${a.score ? esc(a.score.score) + (a.score.social_pts != null ? ` · social ${a.score.social_pts >= 0 ? '+' : ''}${a.score.social_pts}` : '') : '—'}</span></div></div>
      <div class="btns">${c.link ? `<a class="btn s" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ''}<button class="btn s" id="tocoin">Coin</button></div>`;
    $('#tocoin').onclick = () => go({ view: 'coin', mint: route.mint });
  }

  // =================================================================== COIN
  function Coin() {
    V().innerHTML = `<button class="back" id="bk">‹ Back</button><div id="co">${skel(40)}${skel(90)}${skel(220)}</div>`;
    $('#bk').onclick = () => history.back();
    loadCoin(); timers.push(setInterval(loadCoin, 3000));
  }
  async function loadCoin() {
    let c; try { c = await get('/api/coin/' + route.mint); } catch (e) { return; }
    if (route.view !== 'coin') return;
    const p = c.position && c.position.status === 'open' ? c.position : null;
    const since = p && c.price ? 100 * (c.price / p.entry - 1) : null;
    if (!$('#co .big')) {
      $('#co').innerHTML = `<div class="coinh"><span class="sym">${esc(c.symbol || route.mint.slice(0, 6))}</span>${modePill(c.mode)}
        <span class="shield" id="shield"></span></div><div class="sec" style="font-size:15px">${esc(c.name || '')}</div>
        <div class="big odo" id="price" style="margin-top:6px"></div><div class="today" id="since"></div>
        <canvas class="chart" id="candles" style="height:200px"></canvas>
        <div class="stats"><div class="stat"><small>Market cap</small><b id="mc"></b></div><div class="stat"><small>Liquidity</small><b id="lq"></b></div><div class="stat"><small>Holders</small><b id="hd"></b></div></div>
        <div id="pos"></div>
        <div class="btns">${c.link ? `<a class="btn s" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Open on FOMO</a>` : ''}<button class="btn d" id="sell">Sell now</button></div>
        <div style="text-align:center;margin-top:10px"><button id="toaudit" style="color:var(--blue);min-height:44px">Audit ›</button></div>`;
      $('#toaudit').onclick = () => go({ view: 'audit', mint: route.mint });
    }
    $('#shield').innerHTML = c.layersTotal ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>${c.layersGreen}/8` : '';
    $('#shield').style.color = c.layersGreen === 8 ? 'var(--green)' : 'var(--orange)';
    if (c.price == null) $('#price').textContent = '—'; else odometer($('#price'), fmtPrice(c.price));
    $('#since').innerHTML = since == null ? `<span class="sec">${p ? 'No price yet' : 'No position'}</span>` : `<span class="${since >= 0 ? 'green' : 'red'}">${fmtPct(since)}</span><span class="sec">since entry</span>`;
    Charts.candles($('#candles'), { candles: c.candles, exitLine: p ? c.exitLine : null, entry: p ? p.entry : null });
    $('#mc').textContent = fmtCompact(c.mcap); $('#lq').textContent = fmtCompact(c.liq); $('#hd').textContent = c.holders == null ? '—' : c.holders.toLocaleString();
    $('#pos').innerHTML = p ? `<div class="card"><div class="lrow"><span>Position</span><span class="v">${(+p.tokens).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${esc(c.symbol || '')}</span></div>
      <div class="lrow"><span>In</span><span class="v">${fmtUsd(p.usd_in)}</span></div><div class="lrow"><span>Entry</span><span class="v">${fmtPrice(p.entry)}</span></div>
      <div class="lrow"><span>Exit line</span><span class="v" style="color:var(--orange)">${fmtPrice(p.stop_line)}</span></div>
      <div class="lrow"><span>Take profit</span><span class="v">${p.tp_done ? 'done · trail on' : 'at 2.0x'}</span></div></div>` : '';
    const sb = $('#sell'); sb.disabled = !p || STATIC; sb.onclick = () => p && !STATIC && sellSheet(c);
    if (STATIC && p) sb.textContent = 'Sell from the desk link';
  }
  function sellSheet(c) {
    const sh = $('#sheet'); let pct = 100; sh.hidden = false;
    const draw = () => sh.innerHTML = `<div class="panel"><div class="grab"></div><div style="font-size:20px;font-weight:700">Sell ${esc(c.symbol || '')}</div>
      <div class="sec" style="font-size:15px">${c.mode === 'LIVE' ? 'Executor sells on FOMO' : 'PAPER sale at the current price minus fees'}</div>
      <div class="seg">${[25, 50, 100].map(v => `<button data-p="${v}" class="${v === pct ? 'on' : ''}">${v}%</button>`).join('')}</div>
      <div class="btns"><button class="btn s" id="cx">Cancel</button><button class="btn d" id="ok">Confirm</button></div></div>`;
    draw();
    sh.onclick = async e => {
      if (e.target === sh || e.target.id === 'cx') { sh.hidden = true; return; }
      if (e.target.dataset.p) { pct = +e.target.dataset.p; draw(); return; }
      if (e.target.id === 'ok') { e.target.disabled = true;
        try { const r = await api('/api/sell', { method: 'POST', body: { mint: c.mint, pct } }); toast(`Sold ${pct}% · ${r.pnl >= 0 ? '+' : '-'}$${Math.abs(r.pnl).toFixed(2)}`); }
        catch (err) { toast(err.message); } sh.hidden = true; loadCoin(); }
    };
  }

  // =================================================================== ACCOUNT
  const SECTIONS = [['desk', 'Desk'], ['scanner', 'Scanner'], ['analyst', 'Analyst'], ['social', 'Social'], ['brain', 'Brain'], ['executor', 'Executor'], ['risk', 'Risk'], ['copy', 'Copy feed']];
  async function Account() {
    V().innerHTML = `<div class="nav"><div class="title" style="font-size:34px;font-weight:700">Account</div></div><div id="ac">${skel(120)}${skel(200)}</div>`;
    let set, links, sum, push;
    try { [set, links, sum, push] = await Promise.all([get('/api/settings'), get('/api/links'), get('/api/summary'), get('/api/push/status')]); } catch (e) { return; }
    if (route.tab !== 'account') return;
    const m = set.desk.mode.value;
    let html = `<div class="list"><div class="linkrow"><span>Mode</span>${modePill(m)}</div>
      <div class="seg" style="margin:0 16px 12px"><button data-mode="PAPER" class="${m === 'PAPER' ? 'on' : ''}">PAPER</button><button data-mode="LIVE" class="${m === 'LIVE' ? 'on' : ''}">LIVE</button></div>
      <div class="linkrow"><span>Cash</span><span class="mono">${fmtUsd(sum.cash)}</span></div></div>
      <div class="group-h">FOMO</div><div class="list">
      <a class="linkrow" href="${esc(links.profile)}" target="_blank" rel="noopener noreferrer"><span style="color:var(--text)">Your FOMO profile</span><span class="ter">›</span></a>
      <button class="linkrow" id="invite" style="width:100%"><span>Invite a friend</span><span class="ter">›</span></button></div>
      <div class="group-h">Notifications</div><div class="list">
      <div class="linkrow"><span>${esc(push.notifier === 'webpush' ? 'Web push' : 'Telegram')}</span><span class="${push.ready ? 'green' : 'sec'}">${push.ready ? 'Ready · ' + push.webpushSubs + (push.webpushSubs === 1 ? ' device' : ' devices') : esc(push.why || 'Not set up')}</span></div>
      ${push.notifier === 'webpush' ? `<button class="linkrow" id="pushon" style="width:100%;color:var(--blue)">Turn on notifications on this phone</button>` : ''}
      ${STATIC ? '' : `<button class="linkrow" id="testpush" style="width:100%;color:var(--blue)">Send test push</button>`}</div>
      ${STATIC ? `<div class="sec" style="font-size:13px;margin:8px 16px 0">Read-only snapshot · settings, pause and Sell need the desk link</div>` : ''}`;
    for (const [sec, title] of SECTIONS) {
      const g = set[sec]; if (!g) continue;
      html += `<div class="group-h" id="grp-${sec}">${esc(title)}</div><div class="list">` + Object.entries(g).map(([name, s]) => {
        if (name === 'mode') return '';
        const num = typeof s.value === 'number', bool = typeof s.value === 'boolean';
        if (bool) return `<div class="set"><div class="lab"><span>${esc(name)}</span><button class="switch ${s.value ? 'on' : ''}" data-k="${s.key}" data-bool="1"></button></div></div>`;
        if (num && s.min != null && s.max != null) {
          const step = Number.isInteger(s.value) && Number.isInteger(s.min) && Number.isInteger(s.max) ? 1 : (s.max - s.min) / 200;
          return `<div class="set"><div class="lab"><span>${esc(name)}</span><input type="number" inputmode="decimal" data-k="${s.key}" value="${s.value}" min="${s.min}" max="${s.max}" step="any"></div>
            <input type="range" data-r="${s.key}" min="${s.min}" max="${s.max}" step="${step}" value="${s.value}"><div class="err" data-e="${s.key}"></div></div>`;
        }
        return `<div class="set"><div class="lab"><span>${esc(name)}</span><input type="text" data-k="${s.key}" value="${esc(s.value == null ? '' : s.value)}"></div><div class="err" data-e="${s.key}"></div></div>`;
      }).join('') + `</div>`;
    }
    $('#ac').innerHTML = html;
    const save = async (k, v) => { const e = document.querySelector(`[data-e="${k}"]`);
      try { await api('/api/settings', { method: 'PUT', body: { key: k, value: v } }); if (e) e.textContent = ''; toast('Saved'); }
      catch (err) { if (e) e.textContent = err.message; else toast(err.message); } };
    $('#ac').querySelectorAll('input[type=range]').forEach(r => { r.oninput = () => { document.querySelector(`input[data-k="${r.dataset.r}"]`).value = +(+r.value).toFixed(4); };
      r.onchange = () => save(r.dataset.r, +r.value); });
    $('#ac').querySelectorAll('input[type=number]').forEach(i => i.onchange = () => { const r = document.querySelector(`input[data-r="${i.dataset.k}"]`); if (r) r.value = i.value; save(i.dataset.k, +i.value); });
    $('#ac').querySelectorAll('input[type=text]').forEach(i => i.onchange = () => save(i.dataset.k, i.value));
    $('#ac').querySelectorAll('.switch[data-bool]').forEach(s => s.onclick = async () => { const v = !s.classList.contains('on'); await save(s.dataset.k, v); s.classList.toggle('on', v); });
    $('#ac').querySelectorAll('[data-mode]').forEach(b => b.onclick = () => b.dataset.mode === 'LIVE' ? liveSheet() : save('mode', 'PAPER').then(Account));
    $('#invite').onclick = async () => { try { if (navigator.share) await navigator.share({ title: 'FOMO', url: links.signup }); else { await navigator.clipboard.writeText(links.signup); toast('Link copied'); } } catch (e) { } };
    if ($('#testpush')) $('#testpush').onclick = async () => { try { const r = await api('/api/push/test', { method: 'POST' }); toast(r.sent ? `Sent to ${r.devices} device${r.devices === 1 ? '' : 's'}` : 'Not sent · ' + r.why); } catch (e) { toast(e.message); } };
    if ($('#pushon')) $('#pushon').onclick = pushOn;
    if (STATIC) $('#ac').querySelectorAll('input,.switch,[data-mode]').forEach(x => { x.disabled = true; x.style.opacity = .5; });
  }
  // ---- web push: iPhone needs iOS 16.4+, the app added to the Home Screen, and an https origin
  function infoSheet(title, text, extra) {
    const sh = $('#sheet'); sh.hidden = false;
    sh.innerHTML = `<div class="panel"><div class="grab"></div><div style="font-size:20px;font-weight:700">${esc(title)}</div>
      <div class="sec" style="font-size:15px;margin:6px 0 12px">${esc(text)}</div>${extra || ''}<div class="btns"><button class="btn s" id="cx">Done</button></div></div>`;
    sh.onclick = e => { if (e.target === sh || e.target.id === 'cx') sh.hidden = true; };
  }
  async function pushOn() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (!window.isSecureContext) return infoSheet('Needs https', 'Push only works when the app is opened from its https link.');
    if (ios && !standalone) return infoSheet('Add to Home Screen first', 'In Safari tap Share, then Add to Home Screen. Open Desk from the Home Screen and tap this again.');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return infoSheet('No web push here', 'This browser has no web push. iPhone needs iOS 16.4 or later.');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return infoSheet('Notifications are off', 'Turn them on in Settings, Notifications, Desk.');
      const reg = await navigator.serviceWorker.ready;
      const v = await get('/api/push/vapid'); if (!v || !v.key) return toast('Desk has no push key yet');
      const appKey = DeskCrypt.b64u.from(v.key);
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options && sub.options.applicationServerKey && DeskCrypt.b64u.to(sub.options.applicationServerKey) !== v.key) { await sub.unsubscribe(); sub = null; }
      sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
      const j = JSON.stringify(sub.toJSON());
      if (!STATIC) { await api('/api/push/subscribe', { method: 'POST', body: { subscription: JSON.parse(j) } }); toast('Notifications on'); return Account(); }
      const code = await DeskCrypt.sealSub(KEY(), j);
      infoSheet('Send this code to the desk once', 'It is this phone\'s push address, sealed with your desk key. Paste it to Grok Bot once; after that the desk pushes straight to this phone.',
        `<textarea id="pcode" readonly style="width:100%;height:96px;font:12px ui-monospace,monospace;background:#2c2c2e;color:#fff;border:0;border-radius:12px;padding:10px">${esc(code)}</textarea>
         <button class="btn s" id="pcopy" style="width:100%;margin-top:8px">Copy code</button>`);
      $('#pcopy').onclick = async e => { e.stopPropagation(); try { await navigator.clipboard.writeText(code); toast('Copied'); } catch (x) { $('#pcode').select(); } };
    } catch (e) { toast(e.message || 'Push failed'); }
  }
  function liveSheet() {
    const sh = $('#sheet'); sh.hidden = false;
    sh.innerHTML = `<div class="panel"><div class="grab"></div><div style="font-size:20px;font-weight:700">Switch to LIVE</div>
      <div class="sec" style="font-size:15px;margin:6px 0 12px">Real money. Needs a full PAPER night and passed acceptance tests. Type LIVE to confirm.</div>
      <div class="set" style="padding:0"><input type="text" id="liveword" autocapitalize="characters" autocomplete="off" style="width:100%;text-align:left" placeholder="LIVE"></div>
      <div class="err" id="liveerr" style="color:var(--red);font-size:14px;margin-top:8px"></div>
      <div class="btns"><button class="btn s" id="cx">Cancel</button><button class="btn d" id="ok">Go LIVE</button></div></div>`;
    sh.onclick = async e => {
      if (e.target === sh || e.target.id === 'cx') { sh.hidden = true; return; }
      if (e.target.id === 'ok') {
        try { await api('/api/settings', { method: 'PUT', body: { key: 'mode', value: 'LIVE', confirm: $('#liveword').value.trim() } }); sh.hidden = true; Account(); }
        catch (err) { $('#liveerr').textContent = err.message; }
      }
    };
  }

  // ---- boot
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => { });
  route = initialRoute(); history.replaceState(route, '', location.pathname + (route.tab === 'home' ? '' : '#/' + (route.tab || route.view) + (route.mint ? '/' + route.mint : '')));
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === route.tab));
  render();
  window.addEventListener('resize', () => { const c = $('#chart'); if (c && c._last) Charts.line(c, c._last); });
})();
