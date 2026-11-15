package skm.tools;

import skm.engine.Config;
import skm.engine.Rng;

import java.util.*;

/**
 * Ricart-Agrawala mutual exclusion (no token), headless, same settings object and same random
 * generator as the Suzuki-Kasami engine, so both can be compared fairly.
 *
 * Rules (Lamport clock ts):
 *   want CS:   ts = ++clock; send REQUEST(ts, i) to all others; enter when all N-1 REPLY arrived.
 *   get REQUEST(ts, j): clock = max(clock, ts) + 1.
 *       Reply now, unless I am in the CS, or I am waiting and my (ts, id) is smaller than (ts, j).
 *       In those two cases the reply is deferred until I leave the CS.
 *   leave CS:  send all deferred REPLY messages.
 * Cost: 2(N-1) messages per entry, always.
 */
public final class RicartAgrawala {
    private enum St { IDLE, WANT, IN_CS }
    private record Ev(double t, int kind, int to, int from, int ts, long seq) { }   // kind: 0 REQUEST, 1 REPLY, 2 EXIT, 3 AUTO

    private final Config cfg;
    private final int n;
    private final Rng rng;
    private final PriorityQueue<Ev> q = new PriorityQueue<>(Comparator.comparingDouble(Ev::t).thenComparingLong(Ev::seq));
    private final St[] st;
    private final int[] clock, myTs, replies;
    private final double[] reqTime;
    private final List<List<Integer>> deferred = new ArrayList<>();
    private long seq;
    private double time;
    private boolean workload = true;
    private int inCs;

    public int requests, entries, messages, violations;
    public double totalWait, maxWait;

    public RicartAgrawala(Config c) {
        cfg = c; n = c.n; rng = new Rng(c.seed);
        st = new St[n]; clock = new int[n]; myTs = new int[n]; replies = new int[n]; reqTime = new double[n];
        for (int i = 0; i < n; i++) { st[i] = St.IDLE; deferred.add(new ArrayList<>()); add(rng.exp(cfg.meanInterval), 3, i, -1, 0); }
    }

    private void add(double t, int kind, int to, int from, int ts) { q.add(new Ev(t, kind, to, from, ts, seq++)); }

    private void send(int kind, int from, int to, int ts) {
        messages++;
        add(time + rng.range(cfg.minDelay, cfg.maxDelay), kind, to, from, ts);
    }

    public double nextTime() { return q.isEmpty() ? Double.POSITIVE_INFINITY : q.peek().t; }

    public void stopWorkload() { workload = false; }

    public boolean step() {
        Ev e = q.poll();
        if (e == null) return false;
        time = e.t;
        int i = e.to;
        switch (e.kind) {
            case 3 -> {                                           // automatic request
                if (!workload) break;
                if (st[i] == St.IDLE) {
                    requests++; reqTime[i] = time; st[i] = St.WANT;
                    myTs[i] = ++clock[i]; replies[i] = 0;
                    for (int k = 0; k < n; k++) if (k != i) send(0, i, k, myTs[i]);
                }
            }
            case 0 -> {                                           // REQUEST arrives at i from e.from
                clock[i] = Math.max(clock[i], e.ts) + 1;
                boolean mineFirst = st[i] == St.WANT && (myTs[i] < e.ts || (myTs[i] == e.ts && i < e.from));
                if (st[i] == St.IN_CS || mineFirst) deferred.get(i).add(e.from);
                else send(1, i, e.from, 0);
            }
            case 1 -> {                                           // REPLY arrives
                if (st[i] == St.WANT && ++replies[i] == n - 1) {
                    st[i] = St.IN_CS; inCs++;
                    if (inCs > 1) violations++;
                    double w = time - reqTime[i];
                    entries++; totalWait += w; maxWait = Math.max(maxWait, w);
                    add(time + cfg.holdTime, 2, i, -1, 0);
                }
            }
            case 2 -> {                                           // leave the CS
                st[i] = St.IDLE; inCs--;
                for (int k : deferred.get(i)) send(1, i, k, 0);
                deferred.get(i).clear();
                if (workload) add(time + rng.exp(cfg.meanInterval), 3, i, -1, 0);
            }
        }
        return true;
    }

    public double msgsPerEntry() { return entries == 0 ? 0 : (double) messages / entries; }
    public double avgWait() { return entries == 0 ? 0 : totalWait / entries; }
}
