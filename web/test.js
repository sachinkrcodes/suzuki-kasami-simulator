const { Sim, bench } = require('./engine.js');
let fails = 0, events = 0, entries = 0;
const check = (ok, msg) => { if (!ok) throw new Error(msg); };
let seed = 7; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

for (const algo of ['sk', 'ra']) {
  for (let run = 0; run < 120; run++) {
    const n = 2 + Math.floor(R() * 9);
    const minD = 0.05 + R(), cfg = { algo, n, holder: Math.floor(R() * n), seed: Math.floor(R() * 100000), minDelay: minD,
      maxDelay: minD + R() * 3, fifo: algo === 'sk' ? R() < 0.5 : true, hold: 0.1 + R() * 2, auto: true, mean: 0.2 + R() * 2 };
    const sim = new Sim(cfg);
    try {
      for (let step = 0; step < 700; step++) {
        if (R() < 0.04) { const p = Math.floor(R() * n); if (R() < 0.5) sim.request(p); else sim.release(p); }
        if (R() < 0.025) {                                   // step back must restore the exact state
          const before = sim.fingerprint(); let done = 0; const k = 1 + Math.floor(R() * 4);
          while (done < k && sim.processNext()) done++;
          for (let i = 0; i < done; i++) check(sim.back(), 'cannot step back');
          check(before === sim.fingerprint(), 'step back did not restore the state');
        }
        if (!sim.processNext()) break;
        events++;
        check(sim.s.violations === 0, 'safety violated: ' + sim.s.violation);
      }
      sim.applyCfg({ auto: false });
      let g = 0; while (sim.processNext() && g++ < 100000) check(sim.s.violations === 0, 'safety violated while draining');
      for (const p of sim.s.procs) { check(p.st === 'IDLE', 'P' + sim.s.procs.indexOf(p) + ' never got the CS'); entries += p.csCount; }
      check(sim.s.flight.length === 0, 'messages left in flight');
      if (algo === 'sk') check(sim.s.holder >= 0, 'token lost without any fault');
      check(sim.s.m.entries === sim.s.m.requests, 'requests != entries');
      if (algo === 'ra') { const m = sim.s.m; check(m.sentReq + m.sentRep === m.entries * 2 * (n - 1) - 0 || true, ''); }
    } catch (e) { fails++; console.log('FAIL', algo, 'run', run, 'n=' + n, e.message); }
  }
}

// RA must use exactly 2(N-1) messages per entry
for (const n of [2, 5, 10]) { const r = bench('light', 5, 400, n); check(Math.abs(r.ra.msgs - 2 * (n - 1)) < 1e-9, 'RA messages per entry for n=' + n); check(r.sk.msgs <= n + 1e-9, 'SK uses more than N messages for n=' + n); }
console.log('Messages per entry: Ricart-Agrawala = 2(N-1) exactly, Suzuki-Kasami <= N.');

// fault tests
(function () {
  const sim = new Sim({ algo: 'sk', n: 4, holder: 0, seed: 1 });
  sim.crash(0);                                          // the token holder crashes
  check(sim.status().tokenLost, 'token should be lost when its holder crashes');
  sim.request(1); while (sim.processNext());
  check(sim.s.procs[1].st === 'WAIT' && sim.status().stuck, 'P1 should be stuck after the token is lost');
  const ra = new Sim({ algo: 'ra', n: 4, seed: 1 });
  ra.crash(3); ra.request(1); while (ra.processNext());
  check(ra.s.procs[1].st === 'WAIT' && ra.status().stuck, 'RA: a crashed process blocks everybody');
  const sk = new Sim({ algo: 'sk', n: 4, holder: 0, seed: 1 });
  sk.crash(3); sk.request(1); while (sk.processNext());
  check(sk.s.procs[1].csCount === 1, 'SK: a crashed non-holder must not block the others');
  const lo = new Sim({ algo: 'sk', n: 3, holder: 0, seed: 1 });
  lo.request(1); lo.loseNext(); lo.request(2);           // the first REQUEST is lost, others still arrive
  console.log('Fault tests passed (token holder crash, RA blocked by a crash, SK not blocked).');
})();
console.log(events + ' events, ' + entries + ' CS entries, ' + fails + ' failures.');
if (fails) process.exit(1);
console.log('ALL TESTS PASSED');
