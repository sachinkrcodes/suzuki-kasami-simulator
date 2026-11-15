# Step 1: Benchmark

`skm.tools.Benchmark` runs the same engine as the window, but with no window, so it is fast.
For N = 2 to 10 processes it runs 30 different seeds per row, under light and heavy load, and averages:
messages per critical-section entry, average wait, longest wait.

Run (project root):

    javac -d out $(find src -name "*.java")      (Windows: use compile steps from README / run.bat)
    java -cp out skm.tools.Benchmark

Result: with every request served, messages per entry stay at or just under N (theory: N-1 REQUEST + 1 TOKEN).
They are lower when the process already holds the token, because then 0 messages are needed.
