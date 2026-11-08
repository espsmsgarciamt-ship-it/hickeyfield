# PERT and CPM — research notes and a checked worked example

**2026-11-08.** A self-contained reference on the Program Evaluation and Review Technique (PERT)
and the Critical Path Method (CPM): where they came from, how the computations work, what the
statistics actually assume, where the classical method is known to be wrong, and what
practitioners use instead. Every number in §5 is printed by
[`scripts/pert_cpm.py`](../scripts/pert_cpm.py) (stdlib Python, ~3 s), so it can be re-run rather
than trusted.

---

## 1. One-paragraph summary

Both methods model a project as a directed acyclic graph of activities with precedence
constraints. **CPM** takes one fixed duration per activity, finds the longest path through the
graph (the *critical path*), and tells you how much each other activity can slip (*float*)
without moving the end date. **PERT** takes three estimates per activity (optimistic, most
likely, pessimistic), turns them into a mean and variance, runs the same longest-path
calculation on the means, and attaches a probability of meeting a deadline. The CPM arithmetic
is exact and still the core of every scheduling tool. The PERT probability is a known
**optimistic bias**: it looks only at one path and ignores the extra lateness created where
parallel paths merge. Monte Carlo simulation over the same network is the standard fix.

## 2. Origins

| | PERT | CPM |
|---|---|---|
| Developed | 1957–58 | Dec 1956 – Feb 1959 |
| By | US Navy Special Projects Office with Booz Allen Hamilton (and Lockheed) | Morgan R. Walker (DuPont) and James E. Kelley Jr. (Remington Rand) |
| For | Polaris Fleet Ballistic Missile programme — R&D with genuinely uncertain durations | Chemical-plant construction and maintenance — repeatable work with known durations |
| Founding paper | Malcolm, Roseboom, Clark & Fazar, "Application of a Technique for Research and Development Program Evaluation", *Operations Research* 7(5):646–669, 1959, [doi:10.1287/opre.7.5.646](https://doi.org/10.1287/opre.7.5.646) | Kelley & Walker, "Critical-Path Planning and Scheduling", *Proc. Eastern Joint Computer Conference*, 1959 ([scan](https://www.mosaicprojects.com.au/PDF/PM-History_Critical_Path_Planning_&_Scheduling_Kelley_and_Walker_1959.pdf)) |
| Original emphasis | Probability of hitting milestones | Time–cost trade-off ("crashing") |

The two were invented independently and converged; modern tools ("CPM scheduling") use CPM's
arithmetic and treat PERT's three-point estimate as an optional input. Walker's own account of
the DuPont work is in PMI's ["The origins of CPM"](https://www.pmi.org/learning/library/origins-cpm-personal-history-3762).

## 3. CPM — the deterministic core

### 3.1 Model
- **Activities** with duration *dᵢ*. Modern tools use *activity-on-node* (AON / precedence
  diagramming). The original PERT and CPM used *activity-on-arrow* (AOA), which needs dummy
  activities to express some dependencies; AON does not, which is why it won.
- **Dependencies**: finish-to-start (FS) is the default. Precedence diagramming adds
  start-to-start (SS), finish-to-finish (FF), start-to-finish (SF) and lags/leads. The script
  implements FS with zero lag; the others change only the `max`/`min` expressions below.

### 3.2 Algorithm (O(V + E) after a topological sort)
1. **Forward pass** in topological order:
   `ES(i) = max over predecessors p of EF(p)` (0 if none); `EF(i) = ES(i) + dᵢ`.
   Project duration `T = max EF`.
2. **Backward pass** in reverse order:
   `LF(i) = min over successors s of LS(s)` (T if none); `LS(i) = LF(i) − dᵢ`.
3. **Float**:
   - *Total float* `TF = LS − ES` — slip allowed before the project end moves.
   - *Free float* `FF = min ES(successors) − EF` — slip allowed before *any successor* moves.
4. **Critical path** = activities with `TF = 0` (with a hard deadline earlier than T, the
   critical ones are those with the *least* float, which may be negative).

Total float is shared along a chain; free float is not. In §5, C and E both show TF = 0.67, but
that's one 0.67 days shared between them: C's free float is 0, so if C uses it, E has none left.

### 3.3 Extensions that matter in practice
- **Crashing (time–cost trade-off)** — Kelley & Walker's original point: shorten critical
  activities in order of cheapest cost per day saved, re-computing the critical path after
  each step, since a new path can become critical. It can be solved exactly as an LP.
- **Resource levelling / resource-constrained scheduling** — CPM assumes unlimited resources.
  Once two critical activities need the same person, the "critical path" is no longer the
  longest path. Resource-constrained scheduling (RCPSP) is NP-hard; tools use priority-rule
  heuristics. Goldratt's *Critical Chain* (1997) is the best-known methodology built on it.
- **Fast-tracking** — overlapping activities that were sequential (FS → SS + lag), trading
  schedule for rework risk.

## 4. PERT — the probabilistic layer

### 4.1 Formulas
For each activity, with optimistic *o*, most likely *m*, pessimistic *p*:

```
tₑ = (o + 4m + p) / 6         σ² = ((p − o) / 6)²
```

Along the critical path: `Tₑ = Σ tₑ`, `σ²_T = Σ σ²`, and
`P(finish ≤ D) ≈ Φ((D − Tₑ) / σ_T)` by the central limit theorem.

### 4.2 Where the formulas come from
They are approximations to a beta distribution on [o, p] with mode m, chosen for hand
computation in 1958, not derived from data. Clark, one of the original authors, explained the
reasoning in "The PERT Model for the Distribution of an Activity Time", *Operations Research*
10(3):405–406, 1962 ([RePEc](https://ideas.repec.org/a/inm/oropre/v10y1962i3p405-406.html)):
the "range ≈ 6σ" rule is borrowed from the normal distribution, and the 1-4-1 weights give a
mean that is close to the beta mean for typical shapes. The modern "PERT-Beta" distribution
(shape parameters `α = 1 + 4(m−o)/(p−o)`, `β = 1 + 4(p−m)/(p−o)`) reproduces the PERT mean
exactly, and is what the script samples.

### 4.3 Known weaknesses, in order of practical importance
1. **Merge-event bias (the big one).** At a merge point the start time is the *maximum* of the
   incoming paths, and `E[max(X, Y)] ≥ max(E[X], E[Y])`. Classical PERT computes the max of the
   *means*, so it systematically underestimates the expected duration and overstates the odds
   of on-time delivery. The more near-critical parallel paths, the worse it gets. Fulkerson
   (1962) showed the PERT value is a lower bound on the true expected project length. See
   Hulett / PMI, ["Project schedule risk analysis: Monte Carlo simulation or PERT?"](https://www.pmi.org/learning/library/project-schedule-risk-analysis-simulation-4620),
   and Goman & Pečerska (2020) on [merge event bias in analytical PERT models](https://ortus.rtu.lv/science/en/publications/31563).
2. **Single-path variance.** σ_T uses only the critical path's activities, ignoring
   near-critical paths that can take over (same root cause as #1).
3. **Independence.** Activity durations are assumed independent. In real projects they are
   correlated (same team, same misunderstood requirement), which widens the true spread.
   The CLT also needs many activities on the path to be a good approximation.
4. **Estimate quality.** "Pessimistic" estimates are anchored and rarely pessimistic enough.
   The formulas cannot fix biased inputs. MacCrimmon & Ryavec (1964) showed the
   activity-level approximations themselves can be off by up to tens of percent depending on the
   distribution's shape.

## 5. Worked example (from `scripts/pert_cpm.py`)

A small desktop-app release. The two parallel chains, backend B→D and UI C→E, are
almost equal and merge at integration testing F. That merge is where classical PERT goes
wrong. Units are days.

| Act | Description | o | m | p | tₑ | σ² | ES | EF | LS | LF | TF | FF | Critical |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A | Scope & design | 2 | 3 | 6 | 3.33 | 0.44 | 0.00 | 3.33 | 0.00 | 3.33 | 0.00 | 0.00 | yes |
| B | Core engine work (after A) | 4 | 6 | 14 | 7.00 | 2.78 | 3.33 | 10.33 | 3.33 | 10.33 | 0.00 | 0.00 | yes |
| C | UI build (after A) | 3 | 5 | 13 | 6.00 | 2.78 | 3.33 | 9.33 | 4.00 | 10.00 | 0.67 | 0.00 |  |
| D | Provider integration (after B) | 2 | 4 | 8 | 4.33 | 1.00 | 10.33 | 14.67 | 10.33 | 14.67 | 0.00 | 0.00 | yes |
| E | UI polish & a11y (after C) | 3 | 4 | 9 | 4.67 | 1.00 | 9.33 | 14.00 | 10.00 | 14.67 | 0.67 | 0.67 |  |
| F | Integration testing (after D, E) | 2 | 3 | 5 | 3.17 | 0.25 | 14.67 | 17.83 | 14.67 | 17.83 | 0.00 | 0.00 | yes |
| G | Docs & installer (after A) | 1 | 2 | 4 | 2.17 | 0.25 | 3.33 | 5.50 | 15.67 | 17.83 | 12.33 | 12.33 |  |
| H | Release (after F, G) | 1 | 1 | 2 | 1.17 | 0.03 | 17.83 | 19.00 | 17.83 | 19.00 | 0.00 | 0.00 | yes |

**Critical path:** A → B → D → F → H. Tₑ = **19.00 days**, σ²_T = 4.50, σ_T = 2.12.

**Classical PERT vs Monte Carlo** (100,000 runs, PERT-Beta sampling, seed 1959, re-computing
the real longest path each run):

| | Classical PERT | Monte Carlo |
|---|---|---|
| Expected duration | 19.00 | **19.85** (+0.85 merge bias) |
| P(≤ 20 days) | 68.1 % | **54.4 %** |
| P(≤ 22 days) | 92.1 % | **84.9 %** |
| P(≤ 24 days) | 99.1 % | 97.2 % |
| P80 / P90 | — | 21.56 / 22.56 |

**Criticality index** (share of runs in which each activity was on the critical path):
A, F, H 100 %; B, D 59.3 %; C, E 40.7 %; G 0 %.

What this shows:
- The UI chain C→E, which CPM marks non-critical with 0.67 days of float, is actually the
  critical path in **41 %** of outcomes. A CPM report would tell a manager to ignore it.
- A "68 % chance of shipping in 20 days" is really about **54 %**, roughly a coin flip. To quote
  a figure with 80 % confidence you'd need about 21.6 days, not 20.
- G has 12 days of float and is never critical, so it's safe to put the least
  senior resource on it, or to schedule it late.

## 6. What to use in practice

1. **Build the network with CPM**: AON, FS by default, explicit lags. Use float to decide where
   attention goes, and recompute whenever actuals come in.
2. **Collect three-point estimates** for activities that are genuinely uncertain, and
   **simulate** (Monte Carlo) rather than applying the PERT normal formula. Report P50/P80, not a
   single date. Add correlation between activities that share a cause of risk.
3. **Watch criticality index and near-critical paths**, not just the one critical path.
4. **Level resources** before trusting any critical path; a shared person creates hidden links
   between activities.
5. Keep classical PERT arithmetic for **quick sanity checks** or very serial projects with
   no significant merges, where its bias is small.

Tooling: MS Project, Primavera P6 and most planners compute CPM natively. Monte Carlo is
built in or available as add-ons (e.g. Primavera Risk Analysis, Safran Risk, @RISK). For code,
`networkx.dag_longest_path` does the deterministic pass, and the ~100-line script here does
both passes, float and a simulation with no dependencies.

## 7. References

- D. G. Malcolm, J. H. Roseboom, C. E. Clark, W. Fazar. "Application of a Technique for Research
  and Development Program Evaluation." *Operations Research* 7(5):646–669, 1959.
  [doi:10.1287/opre.7.5.646](https://doi.org/10.1287/opre.7.5.646) ·
  [RePEc](https://ideas.repec.org/a/inm/oropre/v7y1959i5p646-669.html)
- J. E. Kelley Jr., M. R. Walker. "Critical-Path Planning and Scheduling." *Proc. Eastern Joint
  Computer Conference*, 1959. [Scan (Mosaic Projects)](https://www.mosaicprojects.com.au/PDF/PM-History_Critical_Path_Planning_&_Scheduling_Kelley_and_Walker_1959.pdf)
- C. E. Clark. "The PERT Model for the Distribution of an Activity Time." *Operations Research*
  10(3):405–406, 1962. [RePEc](https://ideas.repec.org/a/inm/oropre/v10y1962i3p405-406.html)
- D. R. Fulkerson. "Expected Critical Path Lengths in PERT Networks." *Operations Research*
  10(6):808–817, 1962. *(cited from memory; not re-checked online for this note)*
- K. R. MacCrimmon, C. A. Ryavec. "An Analytical Study of the PERT Assumptions." *Operations
  Research* 12(1):16–37, 1964. *(cited from memory; not re-checked online for this note)*
- M. R. Walker / PMI. ["The origins of CPM: a personal history."](https://www.pmi.org/learning/library/origins-cpm-personal-history-3762)
- D. T. Hulett / PMI. ["Project schedule risk analysis: Monte Carlo simulation or PERT?"](https://www.pmi.org/learning/library/project-schedule-risk-analysis-simulation-4620)
- J. Goman, J. Pečerska. "Merge Event Bias in Project Evaluation Techniques – Problems and
  Directions." IEEE ITMS, 2020. [RTU record](https://ortus.rtu.lv/science/en/publications/31563)
- [Critical path method — Wikipedia](https://en.wikipedia.org/wiki/Critical_path_method) (overview and history)
