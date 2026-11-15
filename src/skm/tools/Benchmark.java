package skm.tools;

import skm.engine.*;

import java.io.PrintWriter;
import java.util.Locale;

/**
 * Headless benchmark: runs the real Suzuki-Kasami engine and a Ricart-Agrawala engine (no window) for 2..10 processes,
 * under light and heavy load, and prints messages per critical-section entry and waiting time.
 * It also writes benchmark.csv.
 *
 * Run:  java -cp out skm.tools.Benchmark
 */
public final class Benchmark {
    static final int SEEDS = 30;          // each row is the average of 30 runs with different seeds
    static final double SIM_TIME = 400;   // virtual seconds per run

    public static void main(String[] args) throws Exception {
        try (PrintWriter csv = new PrintWriter("benchmark.csv")) {
            csv.println("load,n,sk_msgs,sk_avg_wait,ra_msgs,ra_avg_wait,sk_entries,ra_entries");
            System.out.println("Suzuki-Kasami, " + SEEDS + " runs per row, " + (int) SIM_TIME + " virtual seconds each");
            System.out.println("Theory: at most N messages per entry (N-1 REQUEST + 1 TOKEN), 0 if the process already holds the token.");
            System.out.println("Ricart-Agrawala: always 2(N-1) messages per entry (N-1 REQUEST + N-1 REPLY).");
            for (String load : new String[]{"light", "heavy"}) {
                System.out.println("\nLoad: " + load + (load.equals("light") ? " (each process asks about every 30 s)" : " (each process asks about every 1 s; the CS is busy about 2 s per entry, so a queue builds up)"));
                System.out.println("    |  messages per entry  |   average wait (s)   |");
                System.out.println(" N  |  Suzuki-K |  Ricart-A |  Suzuki-K |  Ricart-A |");
                for (int n = 2; n <= 10; n++) {
                    double skM = 0, skW = 0, skE = 0, raM = 0, raW = 0, raE = 0;
                    for (int s = 0; s < SEEDS; s++) {
                        Config c = new Config();
                        c.n = n; c.seed = 1000 + s; c.initialHolder = 0;
                        c.minDelay = 0.8; c.maxDelay = 1.6; c.holdTime = 2.0;
                        c.autoWorkload = true; c.meanInterval = load.equals("light") ? 30 : 1;
                        Simulation sim = new Simulation(c, null);
                        while (sim.nextEventTime() <= SIM_TIME && sim.processNext()) { }
                        sim.cfg.autoWorkload = false; sim.applyLiveConfig();     // stop new requests, then serve every waiting one
                        int guard = 0;
                        while (sim.processNext() && guard++ < 1000000) { }
                        if (sim.violations != 0) throw new IllegalStateException("SK safety violated: " + sim.violation);
                        if (sim.m.csEntries != sim.m.requests) throw new IllegalStateException("SK: a request was never served");
                        skM += sim.m.msgsPerEntry(); skW += sim.m.avgWait(); skE += sim.m.csEntries;

                        RicartAgrawala ra = new RicartAgrawala(c);
                        while (ra.nextTime() <= SIM_TIME && ra.step()) { }
                        ra.stopWorkload();
                        guard = 0;
                        while (ra.step() && guard++ < 1000000) { }
                        if (ra.violations != 0) throw new IllegalStateException("RA safety violated");
                        if (ra.entries != ra.requests) throw new IllegalStateException("RA: a request was never served");
                        raM += ra.msgsPerEntry(); raW += ra.avgWait(); raE += ra.entries;
                    }
                    skM /= SEEDS; skW /= SEEDS; skE /= SEEDS; raM /= SEEDS; raW /= SEEDS; raE /= SEEDS;
                    System.out.println(String.format(Locale.ROOT, "%2d  | %9.2f | %9.2f | %9.2f | %9.2f |", n, skM, raM, skW, raW));
                    csv.println(String.format(Locale.ROOT, "%s,%d,%.3f,%.3f,%.3f,%.3f,%.1f,%.1f", load, n, skM, skW, raM, raW, skE, raE));
                }
            }
        }
        System.out.println("\nSaved benchmark.csv");
    }
}
