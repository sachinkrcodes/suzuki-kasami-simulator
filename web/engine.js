/* Suzuki-Kasami and Ricart-Agrawala in a discrete-event simulator (virtual time, seeded random).
   No DOM code here, so the same file runs in the browser and in Node (tests, benchmark).
   All state lives in one plain object (this.s) so "step back" is a JSON snapshot. */
(function (root) {
  const INF = 1e18;

  function rnd(s) {                       // mulberry32, state kept inside s so it is saved by snapshots
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const DEFAULTS = { algo: 'sk', n: 5, holder: 0, seed: 42, minDelay: 0.8, maxDelay: 1.6, fifo: true,
    autoRelease: true, hold: 2.0, auto: false, mean: 3.0, loss: 0 };

  function cleanCfg(c) {
    const o = Object.assign({}, DEFAULTS, c || {});
    o.n = Math.max(2, Math.min(10, Math.round(o.n)));
    o.holder = Math.max(0, Math.min(o.n - 1, Math.round(o.holder)));
    o.minDelay = Math.max(0.05, +o.minDelay);
    o.maxDelay = Math.max(o.minDelay, +o.maxDelay);
    o.hold = Math.max(0.1, +o.hold);
    o.mean = Math.max(0.2, +o.mean);
    o.loss = Math.max(0, Math.min(0.9, +o.loss));
    return o;
  }

  class Sim {
    constructor(cfg, opts) {
      this.history = [];
      this.keepHistory = !(opts && opts.noHistory);
      const c = cleanCfg(cfg), n = c.n;
      const s = this.s = {
        cfg: c, t: 0, rng: (c.seed * 2654435761 + 12345) >>> 0, procs: [], token: null, holder: -1,
        flight: [], nextId: 1, lastArr: Array.from({ length: n }, () => Array(n).fill(0)),
        m: { requests: 0, entries: 0, immediate: 0, sentReq: 0, sentTok: 0, sentRep: 0, totalWait: 0, maxWait: 0, dropped: 0 },
        log: [], trans: [], violations: 0, violation: '', pendingDrop: false, lastDrop: null,
      };
      for (let i = 0; i < n; i++) {
        s.procs.push({ st: 'IDLE', rn: Array(n).fill(0), clock: 0, myTs: 0, replies: 0, reqTime: 0,
          csExit: INF, nextReq: INF, deferred: [], csCount: 0, up: true });
        s.trans.push({ t: 0, i, st: 'IDLE' });
      }
      if (c.algo === 'sk') { s.token = { ln: Array(n).fill(0), q: [] }; s.holder = c.holder; this.log('Start: ' + n + ' processes. P' + c.holder + ' holds the token.'); }
      else this.log('Start: ' + n + ' processes. No token; a process needs a REPLY from every other process.');
      this.applyCfg();
    }

    // ---------- helpers ----------
    log(text) { const s = this.s; s.log.push({ t: s.t, text }); if (s.log.length > 120) s.log.shift(); }
    snap() { if (!this.keepHistory) return; this.history.push(JSON.stringify(this.s)); if (this.history.length > 400) this.history.shift(); }
    canBack() { return this.history.length > 0; }
    back() { if (!this.history.length) return false; this.s = JSON.parse(this.history.pop()); return true; }
    fingerprint() { const s = this.s; return JSON.stringify([s.t, s.procs, s.token, s.holder, s.flight, s.m, s.rng]); }
    setState(i, st) { const s = this.s; s.procs[i].st = st; s.trans.push({ t: s.t, i, st }); if (s.trans.length > 1500) s.trans.shift(); }
    inCs() { return this.s.procs.filter(p => p.st === 'CS').length; }

    applyCfg(patch) {                      // live settings (loss, auto workload, delays) without restarting
      const s = this.s;
      if (patch) s.cfg = cleanCfg(Object.assign({}, s.cfg, patch, { n: s.cfg.n, algo: s.cfg.algo }));
      for (const p of s.procs) {
        if (!s.cfg.auto || !p.up) p.nextReq = INF;
        else if (p.nextReq >= INF && p.st === 'IDLE') p.nextReq = s.t + this.exp(s.cfg.mean);
      }
    }
    exp(mean) { return -mean * Math.log(1 - rnd(this.s)); }

    // ---------- network ----------
    send(type, from, to, data) {
      const s = this.s, c = s.cfg;
      if (type === 'REQUEST') s.m.sentReq++; else if (type === 'TOKEN') s.m.sentTok++; else s.m.sentRep++;
      if (s.pendingDrop || (c.loss > 0 && rnd(s) < c.loss)) {
        s.pendingDrop = false; s.m.dropped++; s.lastDrop = { t: s.t, from, to, type };
        this.log('LOST: ' + type + ' P' + from + ' -> P' + to + (type === 'TOKEN' ? ' (the token is gone!)' : '') + '.');
        return;
      }
      let arrive = s.t + c.minDelay + rnd(s) * (c.maxDelay - c.minDelay);
      if (c.fifo) arrive = Math.max(arrive, s.lastArr[from][to] + 0.001);
      s.lastArr[from][to] = arrive;
      s.flight.push({ id: s.nextId++, type, from, to, sent: s.t, arrive, data });
    }

    // ---------- algorithm: actions ----------
    request(i, quiet) {
      const s = this.s, p = s.procs[i];
      if (!p.up || p.st !== 'IDLE') return false;
      if (!quiet) this.snap();
      s.m.requests++; p.reqTime = s.t; p.nextReq = INF;
      if (s.cfg.algo === 'sk') {
        if (s.holder === i) { this.log('P' + i + ' asks for the CS and already holds the token (0 messages).'); this.enterCs(i, true); return true; }
        p.rn[i]++; this.setState(i, 'WAIT');
        this.log('P' + i + ' asks for the CS: broadcasts REQUEST(' + i + ', ' + p.rn[i] + ').');
        for (let k = 0; k < s.cfg.n; k++) if (k !== i) this.send('REQUEST', i, k, { num: p.rn[i] });
      } else {
        p.myTs = ++p.clock; p.replies = 0; this.setState(i, 'WAIT');
        this.log('P' + i + ' asks for the CS: sends REQUEST(ts ' + p.myTs + ') to everyone.');
        for (let k = 0; k < s.cfg.n; k++) if (k !== i) this.send('REQUEST', i, k, { ts: p.myTs });
      }
      return true;
    }

    enterCs(i, immediate) {
      const s = this.s, p = s.procs[i], w = s.t - p.reqTime;
      this.setState(i, 'CS');
      s.m.entries++; s.m.totalWait += w; s.m.maxWait = Math.max(s.m.maxWait, w); if (immediate) s.m.immediate++;
      p.csCount++; p.csExit = s.cfg.autoRelease ? s.t + s.cfg.hold : INF;
      this.log('P' + i + ' ENTERS the critical section (waited ' + w.toFixed(2) + ' s).');
      if (this.inCs() > 1) { s.violations++; s.violation = 'Two processes in the CS at t=' + s.t.toFixed(2); }
    }

    release(i, quiet) {
      const s = this.s, p = s.procs[i];
      if (!p.up || p.st !== 'CS') return false;
      if (!quiet) this.snap();
      p.csExit = INF; this.setState(i, 'IDLE');
      this.log('P' + i + ' leaves the critical section.');
      if (s.cfg.algo === 'sk') {
        const tk = s.token; tk.ln[i] = p.rn[i];
        for (let k = 0; k < s.cfg.n; k++) if (k !== i && !tk.q.includes(k) && p.rn[k] === tk.ln[k] + 1) tk.q.push(k);
        if (tk.q.length) this.passToken(i, tk.q.shift());
      } else {
        for (const k of p.deferred) this.send('REPLY', i, k, {});
        p.deferred = [];
      }
      if (s.cfg.auto) p.nextReq = s.t + this.exp(s.cfg.mean);
      return true;
    }

    passToken(i, j) {
      const s = this.s, tk = s.token;
      s.token = null; s.holder = -1;
      this.log('P' + i + ' sends the TOKEN to P' + j + '.');
      this.send('TOKEN', i, j, { ln: tk.ln, q: tk.q });
    }

    // ---------- algorithm: messages arriving ----------
    deliver(m) {
      const s = this.s, i = m.to, p = s.procs[i];
      if (!p.up) { s.m.dropped++; this.log('P' + i + ' is down: ' + m.type + ' from P' + m.from + ' is lost' + (m.type === 'TOKEN' ? ' (the token is gone!)' : '') + '.'); return; }
      if (s.cfg.algo === 'sk') {
        if (m.type === 'REQUEST') {
          p.rn[m.from] = Math.max(p.rn[m.from], m.data.num);
          this.log('P' + i + ' receives REQUEST(' + m.from + ', ' + m.data.num + ').');
          if (s.holder === i && p.st === 'IDLE' && p.rn[m.from] === s.token.ln[m.from] + 1) this.passToken(i, m.from);
        } else {
          s.token = { ln: m.data.ln, q: m.data.q }; s.holder = i;
          this.log('P' + i + ' receives the TOKEN.');
          if (p.st === 'WAIT') this.enterCs(i, false);
        }
      } else if (m.type === 'REQUEST') {
        p.clock = Math.max(p.clock, m.data.ts) + 1;
        const mineFirst = p.st === 'WAIT' && (p.myTs < m.data.ts || (p.myTs === m.data.ts && i < m.from));
        if (p.st === 'CS' || mineFirst) { p.deferred.push(m.from); this.log('P' + i + ' receives REQUEST from P' + m.from + ' and keeps it waiting.'); }
        else { this.log('P' + i + ' receives REQUEST from P' + m.from + ' and replies.'); this.send('REPLY', i, m.from, {}); }
      } else {
        this.log('P' + i + ' receives REPLY from P' + m.from + '.');
        if (p.st === 'WAIT' && ++p.replies === s.cfg.n - 1) this.enterCs(i, false);
      }
    }

    // ---------- time ----------
    nextEvent() {
      const s = this.s; let best = null;
      const cand = (t, kind, id, ref) => { if (t < INF && (!best || t < best.t - 1e-12)) best = { t, kind, id, ref }; };
      for (const m of s.flight) cand(m.arrive, 'msg', m.id, m);
      for (let i = 0; i < s.procs.length; i++) { cand(s.procs[i].csExit, 'exit', i); cand(s.procs[i].nextReq, 'auto', i); }
      return best;
    }
    nextTime() { const e = this.nextEvent(); return e ? e.t : INF; }

    processNext() {
      const e = this.nextEvent(); if (!e) return false;
      this.snap();
      const s = this.s; s.t = Math.max(s.t, e.t);
      if (e.kind === 'msg') { s.flight = s.flight.filter(x => x.id !== e.id); this.deliver(e.ref); }
      else if (e.kind === 'exit') { s.procs[e.id].csExit = INF; this.release(e.id, true); }
      else { s.procs[e.id].nextReq = INF; this.request(e.id, true); }
      return true;
    }

    advance(T) { let k = 0; while (k++ < 5000) { const e = this.nextEvent(); if (!e || e.t > T) break; this.processNext(); } if (T > this.s.t) this.s.t = T; }

    // ---------- faults ----------
    dropMessage(id) {
      const s = this.s, m = s.flight.find(x => x.id === id); if (!m) return false;
      this.snap();
      s.flight = s.flight.filter(x => x.id !== id); s.m.dropped++; s.lastDrop = { t: s.t, from: m.from, to: m.to, type: m.type };
      this.log('LOST: ' + m.type + ' P' + m.from + ' -> P' + m.to + (m.type === 'TOKEN' ? ' (the token is gone!)' : '') + '.');
      return true;
    }
    loseNext() { this.s.pendingDrop = true; this.log('The next message sent will be lost.'); }
    crash(i) {
      const s = this.s, p = s.procs[i]; if (!p.up) return false;
      this.snap();
      p.up = false; p.csExit = INF; p.nextReq = INF; p.deferred = []; this.setState(i, 'DOWN');
      this.log('P' + i + ' CRASHED.');
      if (s.holder === i) { s.token = null; s.holder = -1; this.log('The token was inside P' + i + ' and is gone.'); }
      return true;
    }
    restart(i) {
      const s = this.s, p = s.procs[i]; if (p.up) return false;
      this.snap();
      Object.assign(p, { up: true, rn: Array(s.cfg.n).fill(0), clock: 0, myTs: 0, replies: 0, deferred: [], csExit: INF, nextReq: INF });
      this.setState(i, 'IDLE'); this.log('P' + i + ' restarted with an empty memory.');
      this.applyCfg(); return true;
    }

    // ---------- status ----------
    status() {
      const s = this.s, waiting = s.procs.some(p => p.up && p.st === 'WAIT');
      const tokenLost = s.cfg.algo === 'sk' && s.holder === -1 && !s.flight.some(m => m.type === 'TOKEN');
      const e = this.nextEvent();
      const idle = !e || (!s.flight.length && !s.procs.some(p => p.csExit < INF));
      return { safe: s.violations === 0, tokenLost, stuck: waiting && (tokenLost || idle) };
    }
  }

  // ---------- benchmark ----------
  function runOne(algo, n, seed, load, simTime) {
    const sim = new Sim({ algo, n, seed, holder: 0, auto: true, mean: load === 'light' ? 30 : 1 }, { noHistory: true });
    while (sim.nextTime() <= simTime && sim.processNext()) { /* run */ }
    sim.applyCfg({ auto: false });
    let g = 0; while (sim.processNext() && g++ < 1000000) { /* drain */ }
    const m = sim.s.m;
    if (sim.s.violations) throw new Error('safety violated');
    if (m.entries !== m.requests) throw new Error('a request was never served');
    const msgs = m.sentReq + m.sentTok + m.sentRep;
    return { msgs: m.entries ? msgs / m.entries : 0, wait: m.entries ? m.totalWait / m.entries : 0, entries: m.entries };
  }
  function bench(load, seeds, simTime, n) {
    const out = {};
    for (const algo of ['sk', 'ra']) {
      let a = 0, w = 0, e = 0;
      for (let k = 0; k < seeds; k++) { const r = runOne(algo, n, 1000 + k, load, simTime); a += r.msgs; w += r.wait; e += r.entries; }
      out[algo] = { msgs: a / seeds, wait: w / seeds, entries: e / seeds };
    }
    return out;
  }

  root.SKM = { Sim, bench, runOne, INF, DEFAULTS };
  if (typeof module !== 'undefined') module.exports = root.SKM;
})(typeof window !== 'undefined' ? window : globalThis);
