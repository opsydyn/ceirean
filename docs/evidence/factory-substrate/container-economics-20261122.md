# Container Economics: A Number Before A Hosted Run

Recorded 2026-11-22. Prerequisite 4 of
[the Factory assessment](../../assessments/astro-factory-foundation-20261121.md),
the last one open. It asked for a cost number for `instance_type: standard-2`,
`max_instances: 10`, `sleepAfter: '1h'` running a FoldKit install and full
suite per candidate.

**No container was run and nothing was deployed.** This is arithmetic over
verified published rates and a workload measured locally during
[the migration pilot](../foldkit-pilot/migration-pilot-20261121.md).

## The Answer

**About $0.13 per candidate.** The per-run cost is negligible. The real
exposure is idle time and concurrency, not the workload.

|                                          | standard-2, `sleepAfter: '1h'` |
| ---------------------------------------- | ------------------------------ |
| Active time per candidate                | ~37 min                        |
| Cost per candidate                       | **$0.1326**                    |
| Of which the idle hour                   | $0.057 — **42%**               |
| Included allowance covers                | **2.6 candidates/month**       |
| Ceiling, 10 instances held awake 30 days | **$515–$929/month**            |

## Verified Inputs

Read from Cloudflare's own documentation on 2026-11-22, not from secondary
summaries. `standard-2` is **1 vCPU, 6 GiB memory, 12 GB disk**.

| Resource | Rate                    | Basis                 |
| -------- | ----------------------- | --------------------- |
| Memory   | $0.0000025 / GiB-second | **provisioned** size  |
| CPU      | $0.000020 / vCPU-second | **active usage only** |
| Disk     | $0.00000007 / GB-second | **provisioned** size  |

Billing is in 10 ms increments. Workers Paid is $5/month and includes 25
GiB-hours memory, 375 vCPU-minutes, and 200 GB-hours disk.

## Measured Workload

From the pilot's own CI logs, not estimated:

- **1283 seconds** of summed task time across 104 completed tasks.
- **545 seconds** wall clock on an M4 Pro with 12 logical cores.
- So the task graph achieves only **2.4x parallelism**, not 12x.

That 2.4x ceiling is the load-bearing measurement, because `standard-2` has
**one** vCPU. The pilot's 9-minute wall clock is not the container's runtime;
roughly 21 minutes of serial work is, before any core-speed difference.

## Where The Money Goes

Central scenario, `standard-2`, 1h idle:

| Component                                       | Cost    | Share   |
| ----------------------------------------------- | ------- | ------- |
| Memory (6 GiB, provisioned, whole awake window) | $0.0874 | **64%** |
| CPU (active only)                               | $0.0445 | 32%     |
| Disk (12 GB, provisioned)                       | $0.0049 | 4%      |

Memory dominates because it is billed on provisioned size for as long as the
instance is awake — including the idle hour, during which CPU bills nothing.

**The binding constraint is the memory allowance, not CPU.** One candidate
consumes 9.7 GiB-hours against 25 included, so the $5 plan covers **2.6
candidates per month**. CPU would cover 10.1 and disk 10.3. Past the third
candidate in a month, every run is paid.

## The Instance Type Is The Wrong Knob

Cost per candidate across instance types, holding the measured 2.4x
parallelism ceiling:

| Type           | vCPU | Active | `sleepAfter: '1h'` | `sleepAfter: 1 min` |
| -------------- | ---- | ------ | ------------------ | ------------------- |
| standard-1     | 0.5  | 69.2m  | $0.1212 (**-9%**)  | $0.0838 (+10%)      |
| **standard-2** | 1    | 37.1m  | $0.1326            | $0.0765             |
| standard-3     | 2    | 21.0m  | $0.1448 (+9%)      | $0.0700 (**-8%**)   |
| standard-4     | 4    | 18.4m  | $0.1933 (+46%)     | $0.0822 (+7%)       |

Two conclusions:

1. **Every instance type lands within roughly ±10% of every other**, because
   bigger instances finish sooner but bill more memory per second. The choice
   between `standard-1` and `standard-3` is not where the money is.
2. **`standard-4` is waste in both columns.** The task graph parallelises to
   2.4x, so four vCPUs buy 2.6 minutes over two vCPUs while billing 12 GiB.

**`sleepAfter` is the knob that matters.** Shortening it from an hour to a
minute cuts the bill by about 42% on `standard-2` and flips which instance
type is cheapest. A container that runs one verification and is then finished
has no reason to idle for an hour.

## Recommendation

`standard-2` is a defensible middle choice and needs no change. Two changes do
earn their keep before a hosted run:

1. **Shorten the inactivity timeout.** An hour of idle is 42% of each bill and
   buys nothing for a one-shot verification. Note that Cloudflare's own API is
   `setInactivityTimeout()`; `sleepAfter` is the framework's key above it.
2. **Treat `max_instances: 10` as the budget control it is.** Ten instances
   held awake for a month is $515 at Cloudflare's own 20%-CPU example and $929
   saturated. The per-candidate cost is trivial; the concurrency ceiling is the
   only way to spend real money here.

A hosted run can be approved on these numbers. At realistic volumes — say 20
candidates a month — the cost is about **$2.65** plus the $5 plan, against
$0.13 of marginal cost per verification.

## What This Estimate Rests On

**One documented ambiguity, and it is the largest single risk.** Cloudflare
states that memory and disk bill on "provisioned resources" while CPU bills on
"active usage only", and that "charges stop after the container instance goes
to sleep". It does **not** state explicitly whether memory and disk bill during
the awake-but-idle window. This record assumes they do, which is the
conservative reading and the one the sleep language implies. **If they do not,
every figure here falls by roughly 40%** and `sleepAfter` stops mattering.
Worth confirming with Cloudflare before relying on the idle-window conclusion.

Other assumptions, stated rather than buried:

- A container vCPU is taken as **1.5x slower** than an M4 Pro core. This is a
  judgement, not a measurement. The floor and conservative cases (1.0x and
  2.0x) put the per-candidate cost between $0.11 and $0.16, so the headline
  figure is not sensitive to it.
- **300 seconds** is allowed for a cold clone and install. The pilot's own
  install ran in 1.1 seconds against a warm Bun store, which a fresh container
  will not have; the repository's `node_modules` is 4.9 GB and its `.git` is
  1.1 GB, so a shallow clone matters.
- The 2.4x parallelism is measured on this repository's task graph. A different
  suite would re-open the instance-type comparison.
- Network egress is not modelled. Package installs are ingress; 1 TB of egress
  is included.
