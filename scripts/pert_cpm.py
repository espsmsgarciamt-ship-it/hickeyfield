#!/usr/bin/env python3
"""PERT/CPM reference implementation and the worked example in docs/PERT-CPM.md.

Stdlib only. Run:  python3 scripts/pert_cpm.py [--scurve-json PATH]
Every number in docs/PERT-CPM.md sections 5 and 6 is printed by this script, so
the document can be re-checked rather than trusted. --scurve-json also writes
the S-curve series (progress envelope + completion probability) as JSON.
"""
from __future__ import annotations

import json
import math
import random
import sys
from dataclasses import dataclass, field


@dataclass
class Activity:
    name: str
    desc: str
    o: float  # optimistic
    m: float  # most likely
    p: float  # pessimistic
    preds: list[str] = field(default_factory=list)

    @property
    def te(self) -> float:  # PERT expected time
        return (self.o + 4 * self.m + self.p) / 6

    @property
    def var(self) -> float:  # PERT variance
        return ((self.p - self.o) / 6) ** 2


def topo(acts: dict[str, Activity]) -> list[str]:
    """Kahn's algorithm; raises on cycles or unknown predecessors."""
    indeg = {k: 0 for k in acts}
    for a in acts.values():
        for p in a.preds:
            if p not in acts:
                raise ValueError(f"{a.name}: unknown predecessor {p}")
            indeg[a.name] += 1
    ready = sorted(k for k, d in indeg.items() if d == 0)
    order: list[str] = []
    while ready:
        n = ready.pop(0)
        order.append(n)
        for a in acts.values():
            if n in a.preds:
                indeg[a.name] -= 1
                if indeg[a.name] == 0:
                    ready.append(a.name)
        ready.sort()
    if len(order) != len(acts):
        raise ValueError("cycle in precedence graph")
    return order


def cpm(acts: dict[str, Activity], dur: dict[str, float]):
    """Forward and backward pass (finish-to-start, zero lag)."""
    order = topo(acts)
    es, ef = {}, {}
    for n in order:
        es[n] = max((ef[p] for p in acts[n].preds), default=0.0)
        ef[n] = es[n] + dur[n]
    T = max(ef.values())
    succs = {k: [a.name for a in acts.values() if k in a.preds] for k in acts}
    ls, lf = {}, {}
    for n in reversed(order):
        lf[n] = min((ls[s] for s in succs[n]), default=T)
        ls[n] = lf[n] - dur[n]
    tf = {n: ls[n] - es[n] for n in acts}
    ff = {n: min((es[s] for s in succs[n]), default=T) - ef[n] for n in acts}
    return order, es, ef, ls, lf, tf, ff, T


def phi(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def beta_pert_sample(rng: random.Random, o: float, m: float, p: float) -> float:
    """Sample the 'PERT-Beta' distribution (lambda = 4), the usual modern reading."""
    if p == o:
        return o
    a = 1 + 4 * (m - o) / (p - o)
    b = 1 + 4 * (p - m) / (p - o)
    return o + rng.betavariate(a, b) * (p - o)


# Worked example: a small desktop-app release. Two near-equal chains
# (backend B->D and UI C->E) merge at F, which is what exposes merge bias.
ACTS = {a.name: a for a in [
    Activity("A", "Scope & design",          2, 3, 6),
    Activity("B", "Core engine work",        4, 6, 14, ["A"]),
    Activity("C", "UI build",                3, 5, 13, ["A"]),
    Activity("D", "Provider integration",    2, 4, 8,  ["B"]),
    Activity("E", "UI polish & a11y",        3, 4, 9,  ["C"]),
    Activity("F", "Integration testing",     2, 3, 5,  ["D", "E"]),
    Activity("G", "Docs & installer",        1, 2, 4,  ["A"]),
    Activity("H", "Release",                 1, 1, 2,  ["F", "G"]),
]}


def progress_curve(acts, start, finish, grid):
    """Cumulative % of planned work done at each t, work spread evenly over each activity.

    Weight = expected duration (one person per activity). Swap in a budget or
    labour-hours field for a cost- or resource-loaded S-curve; the shape logic is the same.
    """
    total = sum(finish[n] - start[n] for n in acts)
    out = []
    for t in grid:
        done = sum(min(max(t - start[n], 0.0), finish[n] - start[n]) for n in acts)
        out.append(100 * done / total)
    return out


def main() -> None:
    dur = {k: a.te for k, a in ACTS.items()}
    order, es, ef, ls, lf, tf, ff, T = cpm(ACTS, dur)

    print("## Activity table (days)")
    print("| Act | Description | o | m | p | t_e | sigma^2 | ES | EF | LS | LF | TF | FF | Critical |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for n in order:
        a = ACTS[n]
        crit = "yes" if abs(tf[n]) < 1e-9 else ""
        print(f"| {n} | {a.desc} | {a.o:g} | {a.m:g} | {a.p:g} | {a.te:.2f} | {a.var:.2f} | "
              f"{es[n]:.2f} | {ef[n]:.2f} | {ls[n]:.2f} | {lf[n]:.2f} | {tf[n]:.2f} | {ff[n]:.2f} | {crit} |")

    crit_path = [n for n in order if abs(tf[n]) < 1e-9]
    var_T = sum(ACTS[n].var for n in crit_path)
    sd_T = math.sqrt(var_T)
    print(f"\nCritical path: {' -> '.join(crit_path)}")
    print(f"Expected duration T_e = {T:.2f} days, variance = {var_T:.2f}, sigma = {sd_T:.2f}")

    deadlines = [20, 22, 24, 26]
    print("\n## Classical PERT probability of finishing by D (normal approx, critical path only)")
    for D in deadlines:
        z = (D - T) / sd_T
        print(f"D={D}: z={z:.2f}, P={phi(z):.1%}")

    # Monte Carlo: resample every activity, recompute the true longest path each run.
    rng = random.Random(1959)
    N = 100_000
    totals = []
    crit_count = {k: 0 for k in ACTS}
    for _ in range(N):
        d = {k: beta_pert_sample(rng, a.o, a.m, a.p) for k, a in ACTS.items()}
        _, _, _, _, _, tf_s, _, T_s = cpm(ACTS, d)
        totals.append(T_s)
        for k in ACTS:
            if abs(tf_s[k]) < 1e-9:
                crit_count[k] += 1
    totals.sort()
    T_crit_sd = sd_T
    mean = sum(totals) / N
    sd = math.sqrt(sum((x - mean) ** 2 for x in totals) / (N - 1))
    pct = lambda q: totals[int(q * N) - 1]
    print(f"\n## Monte Carlo (N={N:,}, PERT-Beta, seed 1959)")
    print(f"Mean = {mean:.2f} days (classical PERT says {T:.2f}; merge bias = +{mean - T:.2f})")
    print(f"SD   = {sd:.2f}")
    print(f"P50 = {pct(0.50):.2f}, P80 = {pct(0.80):.2f}, P90 = {pct(0.90):.2f}")
    for D in deadlines:
        p = sum(1 for x in totals if x <= D) / N
        print(f"D={D}: P={p:.1%}")
    print("\nCriticality index (share of runs in which the activity was critical):")
    for k in order:
        print(f"  {k}: {crit_count[k] / N:.1%}")

    # S-curve 1: planned progress envelope (early-start vs late-start "banana").
    grid = [i * 0.25 for i in range(int(T / 0.25) + 1)]
    if grid[-1] < T:
        grid.append(T)
    early = progress_curve(ACTS, es, ef, grid)
    late = progress_curve(ACTS, ls, lf, grid)
    print("\n## Progress S-curve (% of planned work complete)")
    print("| Day | Early start | Late start | Gap |")
    print("|---|---|---|---|")
    for day in [2, 4, 6, 8, 10, 12, 14, 16, 18]:
        i = grid.index(float(day))
        print(f"| {day} | {early[i]:.1f} % | {late[i]:.1f} % | {early[i] - late[i]:.1f} pts |")
    gaps = [e - l for e, l in zip(early, late)]
    gi = max(range(len(gaps)), key=gaps.__getitem__)
    print(f"Widest gap: {gaps[gi]:.1f} pts at day {grid[gi]:.2f}")

    # S-curve 2: probability of completion by date (Monte Carlo ECDF vs PERT normal).
    dates = [round(14 + i * 0.25, 2) for i in range(int((30 - 14) / 0.25) + 1)]
    mc = []
    j = 0
    for D in dates:
        while j < N and totals[j] <= D:
            j += 1
        mc.append(100 * j / N)
    pert = [100 * phi((D - T) / T_crit_sd) for D in dates]

    if "--scurve-json" in sys.argv:
        path = sys.argv[sys.argv.index("--scurve-json") + 1]
        with open(path, "w") as f:
            json.dump({
                "progress": {"day": grid, "early": [round(x, 2) for x in early],
                             "late": [round(x, 2) for x in late]},
                "probability": {"day": dates, "monte_carlo": [round(x, 2) for x in mc],
                                "pert": [round(x, 2) for x in pert]},
                "T_pert": T, "mc_mean": round(mean, 2),
                "P50": round(pct(0.50), 2), "P80": round(pct(0.80), 2), "P90": round(pct(0.90), 2),
            }, f)
        print(f"\nWrote S-curve data to {path}")


if __name__ == "__main__":
    main()
