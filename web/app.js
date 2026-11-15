(function () {
  const $ = id => document.getElementById(id);
  const { Sim, bench, INF } = window.SKM;
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // ---------- theme colours for canvas ----------
  let C = {}, hatch = null;
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const bg = cs.getPropertyValue('--bg').trim(), ink = cs.getPropertyValue('--ink').trim();
    C = { bg, ink, mid: mix(ink, bg, 0.62), line: mix(ink, bg, 0.2), tint: mix(ink, bg, 0.08) };
    const h = document.createElement('canvas'); h.width = h.height = 8;
    const x = h.getContext('2d'); x.strokeStyle = ink; x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 6); x.lineTo(6, -2); x.moveTo(2, 10); x.lineTo(10, 2); x.stroke();
    hatch = h;
  }
  function hex(c) { c = c.replace('#', ''); return [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16)); }
  function mix(a, b, t) { const A = hex(a), B = hex(b); return 'rgb(' + A.map((v, i) => Math.round(v * t + B[i] * (1 - t))).join(',') + ')'; }
  new MutationObserver(() => { readColors(); drawAll(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- state ----------
  const form = { algo: 'sk', n: 5, seed: 42, minDelay: 0.8, maxDelay: 1.6, hold: 2, mean: 3, auto: false, fifo: true, autoRelease: true, loss: 0 };
  let sim = new Sim(form), playing = false, speed = 1, sel = -1, last = 0, lastPanel = 0;

  function readForm() {
    form.algo = $('algo').value; form.n = +$('cn').value; form.seed = +$('cseed').value;
    form.minDelay = +$('cmin').value; form.maxDelay = +$('cmax').value; form.hold = +$('chold').value; form.mean = +$('cmean').value;
    form.auto = $('cauto').checked; form.fifo = $('cfifo').checked; form.autoRelease = $('crel').checked;
  }
  function writeForm() {
    $('algo').value = form.algo; $('cn').value = form.n; $('cseed').value = form.seed; $('cmin').value = form.minDelay; $('cmax').value = form.maxDelay;
    $('chold').value = form.hold; $('cmean').value = form.mean; $('cauto').checked = form.auto; $('cfifo').checked = form.fifo; $('crel').checked = form.autoRelease;
    $('loss').value = Math.round(form.loss * 100); $('lossV').textContent = Math.round(form.loss * 100) + '%';
  }
  function restart() { readForm(); sim = new Sim(form); form.n = sim.s.cfg.n; sel = -1; writeForm(); panels(true); }

  // ---------- stage ----------
  const stage = $('stage');
  function fit(cv, cssH) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 600;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(cssH * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(cssH * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { ctx, w, h: cssH };
  }
  function layout(w, h, n) {
    const R = Math.max(60, Math.min(w, h) / 2 - 58), cx = w / 2, cy = h / 2 + 4;
    return Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + 2 * Math.PI * i / n; return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) }; });
  }
  function msgPos(m, pos, t) {
    const f = Math.max(0, Math.min(1, (t - m.sent) / Math.max(1e-6, m.arrive - m.sent))), a = pos[m.from], b = pos[m.to];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
  const NODE = 25;

  function drawStage() {
    const s = sim.s, { ctx, w, h } = fit(stage, Math.max(380, Math.min(520, stage.clientWidth * 0.78)));
    ctx.clearRect(0, 0, w, h);
    const pos = layout(w, h, s.cfg.n);
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) { ctx.beginPath(); ctx.moveTo(pos[i].x, pos[i].y); ctx.lineTo(pos[j].x, pos[j].y); ctx.stroke(); }
    // processes
    s.procs.forEach((p, i) => {
      const { x, y } = pos[i];
      if (i === sel) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, NODE + 8, 0, 7); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x, y, NODE, 0, 7);
      ctx.fillStyle = p.st === 'CS' ? C.ink : C.bg; ctx.fill();
      if (p.st === 'WAIT') { ctx.fillStyle = ctx.createPattern(hatch, 'repeat'); ctx.fill(); }
      ctx.lineWidth = 2.2; ctx.strokeStyle = p.st === 'DOWN' ? C.mid : C.ink;
      ctx.setLineDash(p.st === 'WAIT' ? [5, 4] : p.st === 'DOWN' ? [2, 4] : []); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = p.st === 'CS' ? C.bg : (p.st === 'DOWN' ? C.mid : C.ink);
      if (p.st === 'WAIT') { ctx.fillStyle = C.bg; ctx.fillRect(x - 15, y - 9, 30, 18); ctx.fillStyle = C.ink; }
      ctx.font = '700 14px Figtree, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('P' + i, x, y + 1);
      if (p.st === 'DOWN') { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 12, y - 12); ctx.lineTo(x + 12, y + 12); ctx.moveTo(x + 12, y - 12); ctx.lineTo(x - 12, y + 12); ctx.stroke(); }
      if (s.holder === i) {                                   // token badge
        const bx = x + 20, by = y - 24; ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(bx, by - 11); ctx.lineTo(bx + 11, by); ctx.lineTo(bx, by + 11); ctx.lineTo(bx - 11, by); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = C.bg; ctx.font = '800 10px Figtree, sans-serif'; ctx.fillText('T', bx, by + 1);
      }
    });
    // messages
    for (const m of s.flight) {
      const q = msgPos(m, pos, s.t);
      if (m.type === 'TOKEN') { ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(q.x, q.y - 11); ctx.lineTo(q.x + 11, q.y); ctx.lineTo(q.x, q.y + 11); ctx.lineTo(q.x - 11, q.y); ctx.closePath(); ctx.fill(); ctx.strokeStyle = C.bg; ctx.lineWidth = 1.5; ctx.stroke(); }
      else if (m.type === 'REQUEST') { ctx.beginPath(); ctx.arc(q.x, q.y, 6.5, 0, 7); ctx.fillStyle = C.bg; ctx.fill(); ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.stroke(); }
      else { ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(q.x, q.y - 7); ctx.lineTo(q.x + 7, q.y + 6); ctx.lineTo(q.x - 7, q.y + 6); ctx.closePath(); ctx.fill(); ctx.strokeStyle = C.bg; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    // lost-message flash
    const d = s.lastDrop;
    if (d && s.t - d.t < 1.6 && s.t >= d.t) {
      const a = pos[d.from], b = pos[d.to], x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      ctx.strokeStyle = C.ink; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 9, y - 9); ctx.lineTo(x + 9, y + 9); ctx.moveTo(x + 9, y - 9); ctx.lineTo(x - 9, y + 9); ctx.stroke();
    }
    // legend
    ctx.font = '600 12px Figtree, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = C.mid; ctx.textBaseline = 'middle';
    let ly = 16;
    const items = s.cfg.algo === 'sk' ? [['o', 'REQUEST'], ['d', 'TOKEN']] : [['o', 'REQUEST'], ['t', 'REPLY']];
    items.forEach(([k, name]) => {
      ctx.fillStyle = C.ink; ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      if (k === 'o') { ctx.beginPath(); ctx.arc(16, ly, 5, 0, 7); ctx.stroke(); }
      else if (k === 'd') { ctx.beginPath(); ctx.moveTo(16, ly - 7); ctx.lineTo(23, ly); ctx.lineTo(16, ly + 7); ctx.lineTo(9, ly); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(16, ly - 6); ctx.lineTo(22, ly + 5); ctx.lineTo(10, ly + 5); ctx.fill(); }
      ctx.fillStyle = C.mid; ctx.fillText(name, 32, ly); ly += 20;
    });
    stage._pos = pos;
  }

  stage.addEventListener('click', ev => {
    const r = stage.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, pos = stage._pos; if (!pos) return;
    for (const m of sim.s.flight) { const q = msgPos(m, pos, sim.s.t); if (Math.hypot(q.x - x, q.y - y) < 14) { sim.dropMessage(m.id); toast(m.type + ' lost.'); panels(true); return; } }
    for (let i = 0; i < pos.length; i++) if (Math.hypot(pos[i].x - x, pos[i].y - y) < NODE + 6) { sel = (sel === i ? -1 : i); panels(true); return; }
    sel = -1; panels(true);
  });

  // ---------- timeline ----------
  function drawTimeline() {
    const s = sim.s, n = s.cfg.n, rowH = 20, cssH = n * rowH + 26, tl = $('tl');
    const { ctx, w } = fit(tl, cssH); ctx.clearRect(0, 0, w, cssH);
    const t0 = Math.max(0, s.t - 60), span = Math.max(10, s.t - t0), t1 = t0 + span, x0 = 34, x1 = w - 6, X = t => x0 + (x1 - x0) * Math.max(0, Math.min(1, (t - t0) / span));
    const per = Array.from({ length: n }, () => []);
    for (const e of s.trans) per[e.i].push(e);
    ctx.font = '600 11px Figtree, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (let i = 0; i < n; i++) {
      const y = 8 + i * rowH + rowH / 2; ctx.fillStyle = C.mid; ctx.fillText('P' + i, 4, y);
      const ev = per[i];
      for (let k = 0; k < ev.length; k++) {
        const a = ev[k].t, b = k + 1 < ev.length ? ev[k + 1].t : s.t; if (b < t0) continue;
        const xa = X(a), xb = Math.max(X(b), xa + 1), st = ev[k].st;
        if (st === 'CS') { ctx.fillStyle = C.ink; ctx.fillRect(xa, y - 6, xb - xa, 12); }
        else if (st === 'WAIT') { ctx.fillStyle = ctx.createPattern(hatch, 'repeat'); ctx.fillRect(xa, y - 6, xb - xa, 12); ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.setLineDash([3, 2]); ctx.strokeRect(xa + .5, y - 5.5, xb - xa - 1, 11); ctx.setLineDash([]); }
        else { ctx.strokeStyle = st === 'DOWN' ? C.mid : C.line; ctx.lineWidth = 2; ctx.setLineDash(st === 'DOWN' ? [2, 3] : []); ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke(); ctx.setLineDash([]); }
      }
    }
    ctx.fillStyle = C.mid; ctx.textAlign = 'right'; ctx.fillText('t = ' + s.t.toFixed(1) + ' s', w - 4, cssH - 6);
  }

  // ---------- side panels ----------
  const chip = st => st === 'CS' ? '<span class="chip good">In CS</span>' : st === 'WAIT' ? '<span class="chip warn">Waiting</span>'
    : st === 'DOWN' ? '<span class="chip bad"><span>Down</span></span>' : '<span class="chip none">Idle</span>';
  function panels(force) {
    const s = sim.s, st = sim.status(), m = s.m, total = m.sentReq + m.sentTok + m.sentRep;
    let b = st.safe ? '<span class="chip good">Safety: OK</span>' : '<span class="chip bad"><span>Safety broken</span></span>';
    if (st.tokenLost) b += '<span class="chip bad"><span>Token lost</span></span>';
    if (st.stuck) b += '<span class="chip bad"><span>Stuck</span></span>';
    b += '<span class="chip none">t = ' + s.t.toFixed(1) + ' s</span>';
    let note = '';
    if (st.tokenLost) note = 'The token is gone. Nobody can enter the critical section again.';
    else if (st.stuck) note = 'A process is waiting for something that will never arrive.';
    $('banner').innerHTML = b + (note ? '<span class="msg-note" style="flex-basis:100%">' + note + '</span>' : '');
    $('metrics').innerHTML = [['requests', m.requests], ['entered CS', m.entries], ['messages sent', total],
      ['messages per entry', m.entries ? (total / m.entries).toFixed(2) : '-'], ['average wait (s)', m.entries ? (m.totalWait / m.entries).toFixed(2) : '-'],
      ['longest wait (s)', m.maxWait.toFixed(2)], ['messages lost', m.dropped]].map(x => '<div class="stat"><b>' + x[1] + '</b><span>' + x[0] + '</span></div>').join('');
    const sk = s.cfg.algo === 'sk';
    $('ptable').innerHTML = '<tr><th>Process</th><th>State</th><th>' + (sk ? 'RN (highest request seen)' : 'Clock / held-back replies') + '</th><th>CS</th></tr>' +
      s.procs.map((p, i) => '<tr' + (i === sel ? ' class="sel"' : '') + '><td><b>P' + i + '</b>' + (s.holder === i ? ' <span class="chip good" style="padding:0 7px">token</span>' : '') + '</td><td>' + chip(p.st) + '</td><td class="mono">' +
        (sk ? '[' + p.rn.join(',') + ']' : p.clock + ' / ' + (p.deferred.length ? p.deferred.map(k => 'P' + k).join(',') : '-')) + '</td><td>' + p.csCount + '</td></tr>').join('');
    if (sk) {
      const tk = s.token, fl = s.flight.find(x => x.type === 'TOKEN');
      $('tokenBox').innerHTML = '<h2 style="margin-top:14px;font-size:1rem">Token</h2>' + (tk ? '<div class="kv"><span>held by</span><b>P' + s.holder + '</b><span>LN</span><b class="mono">[' + tk.ln.join(',') + ']</b><span>queue</span><b class="mono">[' + tk.q.map(k => 'P' + k).join(', ') + ']</b></div>'
        : fl ? '<p class="small">Travelling from P' + fl.from + ' to P' + fl.to + '.</p>' : '<p class="small"><b>Lost.</b></p>');
    } else $('tokenBox').innerHTML = '';
    $('log').innerHTML = s.log.slice(-40).reverse().map(e => '<div' + (/LOST|CRASH|gone/.test(e.text) ? ' class="bad"' : '') + '><b>' + e.t.toFixed(1) + '</b>' + esc(e.text) + '</div>').join('');
    $('selName').textContent = sel >= 0 ? 'P' + sel : 'none (click a process)';
    $('play').textContent = playing ? 'Pause' : 'Play';
    $('back').disabled = !sim.canBack();
    const has = sel >= 0, p = has ? s.procs[sel] : null;
    $('reqBtn').disabled = !has || !p.up || p.st !== 'IDLE'; $('relBtn').disabled = !has || p.st !== 'CS';
    $('crashBtn').disabled = !has || !p.up; $('restartBtn').disabled = !has || p.up;
    ['reqBtn', 'relBtn', 'crashBtn', 'restartBtn', 'back'].forEach(id => $(id).style.opacity = $(id).disabled ? .45 : 1);
  }
  function drawAll() { drawStage(); drawTimeline(); }

  // ---------- controls ----------
  $('play').onclick = () => { playing = !playing; last = 0; panels(); };
  $('step').onclick = () => { playing = false; if (!sim.processNext()) toast('Nothing else will happen.'); panels(true); };
  $('back').onclick = () => { playing = false; sim.back(); panels(true); };
  $('reset').onclick = () => { playing = false; restart(); };
  $('speed').onchange = e => speed = +e.target.value;
  $('reqBtn').onclick = () => { sim.request(sel); panels(true); };
  $('relBtn').onclick = () => { sim.release(sel); panels(true); };
  $('crashBtn').onclick = () => { sim.crash(sel); panels(true); };
  $('restartBtn').onclick = () => { sim.restart(sel); panels(true); };
  $('loseNext').onclick = () => { sim.loseNext(); toast('The next message will be lost.'); panels(true); };
  $('loss').oninput = e => { form.loss = +e.target.value / 100; $('lossV').textContent = e.target.value + '%'; sim.applyCfg({ loss: form.loss }); };
  $('apply').onclick = () => { playing = false; restart(); };
  $('algo').onchange = () => { playing = false; restart(); };
  $('presets').onclick = e => {
    const p = e.target.dataset.p; if (!p) return;
    Object.assign(form, { quiet: 0 });
    if (p === 'quiet') Object.assign(form, { n: 3, auto: false, loss: 0, seed: 42 });
    if (p === 'busy') Object.assign(form, { n: 6, auto: true, mean: 2, loss: 0, seed: 7 });
    if (p === 'lossy') Object.assign(form, { n: 5, auto: true, mean: 2, loss: 0.1, seed: 3 });
    form.algo = $('algo').value; writeForm(); playing = p !== 'quiet'; restart();
  };

  // ---------- loop ----------
  function frame(ts) {
    if (playing) {
      if (last) sim.advance(sim.s.t + Math.min(0.1, (ts - last) / 1000) * speed);
      last = ts;
    } else last = 0;
    drawAll();
    if (ts - lastPanel > 140) { lastPanel = ts; panels(); }
    requestAnimationFrame(frame);
  }

  // ---------- compare ----------
  function lineChart(cv, series, yLabel) {
    const { ctx, w, h } = fit(cv, 260); ctx.clearRect(0, 0, w, h);
    const L = 40, R = 10, T = 12, B = 28, xs = series[0].pts.map(p => p[0]);
    const ymax = Math.max(1, ...series.flatMap(s => s.pts.map(p => p[1]))) * 1.08;
    const X = x => L + (w - L - R) * (x - xs[0]) / (xs[xs.length - 1] - xs[0]), Y = y => h - B - (h - B - T) * y / ymax;
    ctx.font = '11px Figtree, sans-serif'; ctx.fillStyle = C.mid; ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) { const v = ymax * i / 4, y = Y(v); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(w - R, y); ctx.stroke(); ctx.fillText(v.toFixed(v < 10 ? 1 : 0), L - 6, y); }
    ctx.textAlign = 'center'; xs.forEach(x => ctx.fillText(x, X(x), h - B + 14));
    ctx.fillText('processes (N)', (L + w - R) / 2, h - 4);
    series.forEach(s => {
      ctx.strokeStyle = C.ink; ctx.fillStyle = C.ink; ctx.lineWidth = 2.5; ctx.setLineDash(s.dash ? [7, 5] : []);
      ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))); ctx.stroke(); ctx.setLineDash([]);
      s.pts.forEach(p => { ctx.beginPath(); if (s.dash) { ctx.fillStyle = C.bg; ctx.arc(X(p[0]), Y(p[1]), 3.5, 0, 7); ctx.fill(); ctx.stroke(); } else { ctx.arc(X(p[0]), Y(p[1]), 3.5, 0, 7); ctx.fill(); } });
    });
  }
  let running = false;
  async function runCompare(load) {
    if (running) return; running = true;
    const btns = [$('runLight'), $('runHeavy')]; btns.forEach(b => b.disabled = true);
    const rows = [];
    for (let n = 2; n <= 10; n++) {
      $('cmpNote').textContent = 'Running ' + load + ' load: N = ' + n + ' of 10 ...';
      await new Promise(r => setTimeout(r, 15));
      rows.push([n, bench(load, 30, 400, n)]);
    }
    $('cmpNote').textContent = 'Done: ' + load + ' load, 30 seeds per row, 400 virtual seconds per run.';
    $('cmpOut').style.display = ''; $('cmpTable').style.display = '';
    lineChart($('chMsg'), [{ pts: rows.map(r => [r[0], r[1].sk.msgs]) }, { pts: rows.map(r => [r[0], r[1].ra.msgs]), dash: true }]);
    lineChart($('chWait'), [{ pts: rows.map(r => [r[0], r[1].sk.wait]) }, { pts: rows.map(r => [r[0], r[1].ra.wait]), dash: true }]);
    $('ctable').innerHTML = '<tr><th>N</th><th>Suzuki-Kasami messages</th><th>Ricart-Agrawala messages</th><th>Suzuki-Kasami wait (s)</th><th>Ricart-Agrawala wait (s)</th></tr>' +
      rows.map(r => '<tr><td><b>' + r[0] + '</b></td><td class="mono">' + r[1].sk.msgs.toFixed(2) + '</td><td class="mono">' + r[1].ra.msgs.toFixed(2) + '</td><td class="mono">' + r[1].sk.wait.toFixed(2) + '</td><td class="mono">' + r[1].ra.wait.toFixed(2) + '</td></tr>').join('');
    btns.forEach(b => b.disabled = false); running = false;
  }
  $('runLight').onclick = () => runCompare('light');
  $('runHeavy').onclick = () => runCompare('heavy');

  // ---------- tabs ----------
  function moveDock() { /* design.js handles the blob; this keeps it right after tab switches */ window.dispatchEvent(new Event('resize')); }
  document.querySelectorAll('.dock a').forEach(a => a.addEventListener('click', ev => {
    ev.preventDefault();
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
    $('tab-' + a.dataset.tab).classList.add('on'); window.scrollTo({ top: 0 }); moveDock();
  }));

  readColors(); writeForm(); panels(true);
  requestAnimationFrame(frame);
  const h = (location.hash || '').slice(1), link = document.querySelector('.dock a[data-tab="' + h + '"]'); if (link) link.click();
  window.__skm = { get sim() { return sim; }, restart, form, setSel: i => { sel = i; panels(true); } };
})();
