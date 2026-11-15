# Step 2: Suzuki-Kasami vs Ricart-Agrawala

`skm.tools.RicartAgrawala` is a second algorithm (no token). `skm.tools.Benchmark` runs both with the same
settings and seeds and prints messages per entry and average wait.

Run (project root, after run.bat has compiled):

    java -cp out skm.tools.Benchmark

Measured: Ricart-Agrawala always uses 2(N-1) messages per entry. Suzuki-Kasami uses at most N.
Under light load Suzuki-Kasami waits less. Under heavy load both wait almost the same, because the
critical section itself is the bottleneck.
