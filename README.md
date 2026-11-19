# Telegraph Provider

**Track:** Miners / Providers · **Network:** Telegraph testnet (Ethereum Sepolia)
**Live endpoint:** https://telegraph-provider.vercel.app/api/grid-price
**Registered miner:** slug `chrysolite-telegraph-provider`, YAML id `7319205`, registration **#6129**, status **LIVE** (registered 19 Nov 2026, tx `0x20364b622e376235…451651e8`)

A Telegraph miner for `GRID_POWER_PRICE_GENERAL` that answers wholesale electricity prices for **three US grid operators (CAISO, NYISO and MISO)** straight from each operator's own public price file. It never estimates: when it cannot answer, it says why.

## For judges (5 minutes)

| Check | Where | Time |
|---|---|---|
| Ask it the Intent's own scored question (CAISO day-ahead, 2026-09-13 14:00 UTC) | [live answer](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=CAISO&interval_start=2026-09-13T14:00:00Z), expected `38.09459`, the value in CAISO's OASIS file | 30 s |
| See 24 of 24 answers match the operators' files, checked on GitHub's servers | [public accuracy run](https://github.com/investor567768/telegraph-provider/actions/runs/44534807922) (Summary table) | 1 min |
| See that the check repeats every day | [Actions → Grid price accuracy](https://github.com/investor567768/telegraph-provider/actions/workflows/accuracy.yml) | 30 s |
| Read the registered YAML (registration #6129), pinned to one commit | [miner.yaml at e18a1ec](https://raw.githubusercontent.com/investor567768/telegraph-provider/e18a1ec5cf2a70cf8dbbc983b902830549f66418/miner.yaml), SHA-256 `0x678c732b…1b8c7b` | 1 min |
| Try any location yourself | [N.Y.C. now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=NYC) · [MISO Indiana hub now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=MISO%20Indiana%20hub) · [CAISO SP15](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=SP15) · [ERCOT, refused honestly](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=ERCOT%20Houston%20hub) | 2 min |

## Why it matters

A wholesale power price can swing several-fold within an hour, and it can go below zero. In our own 19 Nov run, MISO's Indiana hub went from **85.96** to **349.88 USD/MWh** in 70 minutes, and New York City was **−52.24** at 11:10 UTC while the Capital zone was **+46.52**. Anything that decides *when* to draw power (a data-centre or AI-compute scheduler, an EV fleet charging plan, a bitcoin miner deciding whether to curtail) loses money on every wrong or stale number, and a "smoothed" or guessed price is exactly the wrong number at the moments that matter. Agents need the operator's real figure for the exact interval, with proof of where it came from.

## What makes this miner different

Compared with the other miners serving `GRID_POWER_PRICE_GENERAL` (37 on 19 Nov 2026):

1. **Three US operators in one miner.** CAISO day-ahead (hubs and any node, any date), NYISO real-time and day-ahead (11 zones), MISO real-time (8 hubs and any node). No other miner on this Intent answers NYISO or MISO.
2. **Public, repeating proof of accuracy.** A GitHub Actions job asks the live miner 24 questions every day and compares each answer with a file it downloads from the operator separately. First run: **24 of 24 exact matches**.
3. **Read by code, not guessed.** It is the only miner on this Intent with an `intent_mapping`, so the node reads `lmp_usd_per_mwh` from a fixed path instead of asking a model to find the number.
4. **Answers that can be checked.** Every answer carries the operator, the exact interval in UTC, the operator's own time stamp, the price components (energy, congestion, losses and, for CAISO, greenhouse gas) and the source URL.
5. **Honest refusals.** ERCOT, PJM, ISO-NE, SPP and CAISO real-time are not covered yet, and the miner says so with HTTP 404 and a reason. Real negative prices are reported as published.

## Coverage

| Operator | Market | Locations | Dates | Source (no API key) |
|---|---|---|---|---|
| CAISO | Day-ahead, hourly | NP15, SP15, ZP26 hubs and any node by OASIS name; a question naming only "CAISO" uses NP15 and says so | Any date OASIS holds | OASIS `PRC_LMP`, market `DAM` (zipped CSV) |
| NYISO | Real-time 5-minute and day-ahead hourly | 11 zones (WEST … LONGIL, `N.Y.C.`) | Any date | NYISO public zonal LBMP CSVs |
| MISO | Real-time 5-minute ex-post | 8 trading hubs and any node | Current operating day | MISO public API, rolling file |

## Request and answer

`GET /api/grid-price?node_or_zone=CAISO&interval_start=2026-09-13T14:00:00Z`

```json
{
  "lmp_usd_per_mwh": 38.09459,
  "node_or_zone": "TH_NP15_GEN-APND",
  "market": "CAISO day-ahead hourly LMP (DAM)",
  "interval_start": "2026-09-13T14:00:00Z",
  "interval_end": "2026-09-13T15:00:00Z",
  "currency": "USD",
  "operator": "CAISO",
  "marginal_cost_losses_usd_per_mwh": 0.20224,
  "marginal_cost_congestion_usd_per_mwh": -0.26689,
  "marginal_cost_energy_usd_per_mwh": 27.70032,
  "marginal_cost_ghg_usd_per_mwh": 10.45891,
  "operator_time_stamp": "2026-09-13 hour ending 8 Pacific (operating day, OPR_HR)",
  "source_url": "http://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&...",
  "verdict": "found",
  "confidence": 1,
  "reason": "CAISO published 38.09459 USD/MWh for TH_NP15_GEN-APND for the interval starting 2026-09-13T14:00:00Z. No CAISO location was named, so the NP15 trading hub (TH_NP15_GEN-APND) was used."
}
```

| Parameter | Required | Meaning |
|---|---|---|
| `node_or_zone` | Yes | Operator name (`N.Y.C.`, `INDIANA.HUB`, `TH_SP15_GEN-APND`) or a common name (`NYC`, `NYISO zone J`, `MISO Indiana hub`, `SP15`, `CAISO`) |
| `interval_start` | No | RFC 3339 time in UTC. Any time inside an interval selects that interval. Omit for the latest. |
| `market` | No | `real_time` or `day_ahead`. Defaults: CAISO day-ahead; NYISO and MISO real-time. |

Errors are explicit, never a guessed price: unknown location (404), operator not covered (404), no data for that time (404), operator unreachable (502), CAISO rate limit (503).

## Time handling

- **NYISO** stamps real-time prices at the **end** of each 5-minute interval in US Eastern prevailing time; the miner converts to the interval **start** in UTC, with daylight-saving handled.
- **MISO** publishes in EST (UTC−5) all year.
- **CAISO** publishes GMT start and end times, used as they are.

## Evidence

| Evidence | Link |
|---|---|
| Daily accuracy runs (public logs and Summary tables) | [Actions → Grid price accuracy](https://github.com/investor567768/telegraph-provider/actions/workflows/accuracy.yml) |
| First run, 24 of 24 | [run 44534807922](https://github.com/investor567768/telegraph-provider/actions/runs/44534807922) |
| Accuracy script (independent of the miner's code) | [test/accuracy.ps1](test/accuracy.ps1) |
| Unit tests (12, including the real CAISO file of 13 Sep 2026) | [test/](test/) · run `npm test` |
| Registered YAML | [miner.yaml](miner.yaml) |

## Honest limits

- **Not covered yet:** ERCOT, PJM, ISO-NE, SPP, CAISO real-time, MISO day-ahead. Each returns a clear 404.
- **MISO** history is limited to the current operating day, because the public feed is a rolling file.
- **Default location:** the Intent's scored question names no location, so a bare "CAISO" is answered for NP15, the most-used CAISO hub. The answer says so. If a truth source uses a different node, a bare "CAISO" question would be scored against it; questions that name a node are unaffected.
- **Scoring:** on 19 Nov 2026 no evaluator was yet ranked for this Intent, so every miner's leaderboard score was 0.000.
- The accuracy job checks against the same public files the miner reads. It proves the miner reads them correctly and on the right interval; it cannot prove the operators' own figures.

## Tests

- `npm test`: 12 unit tests (location matching, daylight saving, NYISO, MISO, CAISO zip parsing and error cases).
- `test/accuracy.ps1`: the live accuracy check, run daily by GitHub Actions.
