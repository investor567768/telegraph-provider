# Telegraph Provider

**Track:** Miners / Providers · **Network:** Telegraph testnet (Ethereum Sepolia)
**Live endpoint:** https://telegraph-provider.vercel.app/api/grid-price
**Registered miner:** slug `chrysolite-telegraph-provider`, YAML id `7319205`, registration **#6129**, status **LIVE** (registered 19 Nov 2026, tx `0x20364b622e376235…451651e8`)

A Telegraph miner for `GRID_POWER_PRICE_GENERAL` that answers wholesale electricity prices for **three US grid operators (CAISO, NYISO and MISO)** straight from each operator's own public price file. It never estimates: when it cannot answer, it says why.

## How this entry answers the judging rubric (Miners / Providers, 100 points)

Source: the [official Season II rules](https://anjoman.ai/dashboard/hackathon/season-2/rules), section 6, read on 26 Nov 2026. Winning needs 70/100 and at least 24 of the 35 quality points. Each row says what we can show and, where it applies, what we do not claim.

| What the rules score | Points | Our evidence |
|---|---|---|
| Independently evaluated intelligence quality (minimum 24) | 35 | 24 of 24 answers match the operators' own files, rechecked every day on GitHub's servers ([public run](https://github.com/investor567768/telegraph-provider/actions/runs/44534807922)). An independent builder, Jennycruzy, checked 15 answers against files she pulled from the operators herself: 15 of 15 match, after fixes her first test prompted ([Evidence](#evidence)). What it cannot answer is refused with a reason, never guessed. **No live network ranking is claimed.** |
| Reliability, availability, and capacity | 15 | Daily public accuracy workflow; answers are cached; a throttled CAISO request is retried twice before any error; uncovered operators get a clear 404. |
| Verified Intent coverage and application enablement | 10 | `GRID_POWER_PRICE_GENERAL` for three US operators: CAISO (day-ahead), NYISO (real-time and day-ahead, including archived days and the clock-change hour) and MISO (current operating day). Built for Mission 12, Mining & Power. |
| Verified H2 mission application consumption | 10 | Paid usage on Telegraph: **$0.1197 USDC earned across 10 periods** (#18 to #55), shown in Anjoman → Activity. **We do not claim** use by a named mission app, independent app groups or ranked routing beyond what those records show. |
| Cost, latency, and serving economics | 5 | No paid data source and no API key: every answer comes from the operator's own public file. Median response about 0.8 s over 5 live requests from Lagos on 26 Nov 2026 (0.65 to 0.90 s; the first request after idle took 3.2 s because it had to fetch the operator's file). |
| Integration and documentation | 5 | Registered YAML pinned to one commit (#6129), run-it-yourself steps, 26 tests, sample requests and error cases below. |
| Organic growth, education, and developer activation | 20 | An outside developer tested the miner, filed a [public issue](https://github.com/investor567768/telegraph-provider/issues/1), and confirmed the fixes in a rerun. Steps for another developer to try it are in this README. A [2-minute demo video and public post on X](https://x.com/kingChrys494/status/2126013019054633373) (26 Nov 2026) explain the problem and show the miner working, and a [showcase post in the Telegraph Discord](https://discord.com/channels/1438396125609463881/1573045614634209341/1575573243824177152) (26 Nov 2026) shares it with other builders. |

## The five steps the organisers ask judges to take

| Step | What to do here |
|---|---|
| Run it | Ask the live miner something new: [N.Y.C. now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=NYC), [MISO Indiana hub now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=MISO%20Indiana%20hub) or [CAISO SP15](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=SP15). Or sign in at anjoman.ai and follow [Ask it yourself through Telegraph](#ask-it-yourself-through-telegraph). No key needed for the endpoint. |
| Check it | Every answer names the operator, the exact interval in UTC, the operator's own time stamp and the source file. Compare the number with that file, or open the [public accuracy run](https://github.com/investor567768/telegraph-provider/actions/runs/44534807922) (24 of 24 match). |
| Inspect it | Anjoman → Activity shows registration #6129 and its paid periods ([screenshot](miner-6129-earnings.png), $0.1197 USDC across 10 periods). The claim transaction is on the [Sepolia explorer](https://sepolia.etherscan.io/tx/0x81cdf8c69f8b1c9c1b07a4aac21f1a8adc8e5759a8eb4566513cd6a92e7f6f32). |
| Break it | Ask for something it should not answer: [ERCOT](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=ERCOT%20Houston%20hub) (refused with a 404 and a reason), a date in the future, or a place that does not exist. It refuses instead of guessing. |
| Reproduce it | `git clone https://github.com/investor567768/telegraph-provider`, then `npm test` (26 tests, Node 18+). The daily [accuracy workflow](https://github.com/investor567768/telegraph-provider/actions/workflows/accuracy.yml) and [test/accuracy.ps1](test/accuracy.ps1) repeat the live check. |

## For judges (5 minutes)

| Check | Where | Time |
|---|---|---|
| Watch the demo: live answers from all three operators, a refused ERCOT question, the 24 of 24 accuracy run, and the $0.1197 USDC claim | [2-minute demo video on X](https://x.com/kingChrys494/status/2126013019054633373) (26 Nov 2026) | 2 min |
| Ask it the Intent's own scored question (CAISO day-ahead, 2026-09-13 14:00 UTC) | [live answer](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=CAISO&interval_start=2026-09-13T14:00:00Z), expected `38.09459`, the value in CAISO's OASIS file | 30 s |
| See 24 of 24 answers match the operators' files, checked on GitHub's servers | [public accuracy run](https://github.com/investor567768/telegraph-provider/actions/runs/44534807922) (Summary table) | 1 min |
| See that the check repeats every day | [Actions → Grid price accuracy](https://github.com/investor567768/telegraph-provider/actions/workflows/accuracy.yml) | 30 s |
| See that buyers paid for its answers: **$0.1197 USDC earned across 10 periods** (#18 to #55) | [earnings screenshot, 26 Nov 2026](miner-6129-earnings.png) (Anjoman → Activity → Contributions and rewards) | 30 s |
| See that another builder tested it independently: **15 of 15** answers matched the operators' own files, after three fixes | [Evidence table](#evidence): Jennycruzy's report, the fixes and the rerun (26 Nov 2026) | 1 min |
| Read the registered YAML (registration #6129), pinned to one commit | [miner.yaml at e18a1ec](https://raw.githubusercontent.com/investor567768/telegraph-provider/e18a1ec5cf2a70cf8dbbc983b902830549f66418/miner.yaml), SHA-256 `0x678c732b…1b8c7b` | 1 min |
| Try any location yourself | [N.Y.C. now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=NYC) · [MISO Indiana hub now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=MISO%20Indiana%20hub) · [CAISO SP15](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=SP15) · [ERCOT, refused honestly](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=ERCOT%20Houston%20hub) | 2 min |

## Miner–Intent pair and what it enables

| Miner | Intent | Registration | Mission | Network |
|---|---|---|---|---|
| `chrysolite-telegraph-provider` (YAML id `7319205`) | `GRID_POWER_PRICE_GENERAL` | #6129, LIVE | 12 Mining & Power | Telegraph testnet (Ethereum Sepolia) |

**What it enables.** An app that decides when to draw or curtail power (a data-centre scheduler, an EV fleet, a bitcoin miner) can buy an operator-published price for an exact interval, with the source file, instead of a guessed or smoothed number. Mission 12 builders can test an app against it today: [N.Y.C. now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=NYC), [CAISO SP15](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=SP15).

**What we do not claim.** No named H2 mission app and no independent app group has used this miner yet, and we do not claim ranked routing. The paid usage is the $0.1197 USDC shown under [Paid usage on Telegraph](#paid-usage-on-telegraph).

## Missions this miner enables

`GRID_POWER_PRICE_GENERAL` is listed on the mission pages as shared by three missions. We checked every mission page; two list it in their example builds, and the third is not yet confirmed, so it is not claimed here.

| Mission | Where the Intent appears | What a builder can do with this miner | Repeatable test |
|---|---|---|---|
| 12 Mining & Power | Listed as a shared Intent on the mission page | Decide when to run or curtail power-hungry work against a published price for an exact interval | [N.Y.C. now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=NYC) |
| 11 Autonomous Systems | Bought in the example build "A closed economy inside one portfolio", next to sensor and weather checks | Give an autonomous agent a real power price to budget against, from the operator's own file | [MISO Indiana hub now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=MISO%20Indiana%20hub), then compare with [N.Y.C. now](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=NYC) |

Of the 41 miners on this Intent, this is the only one serving NYISO and MISO; the others are mostly CAISO-only or European. A dispatch agent that compares two North American markets therefore needs this miner.

These rows say what the miner can serve. They are not a claim that a mission app has already been accepted on it.

## Paid usage on Telegraph

Buyers on Telegraph have paid for this miner's answers. As of 26 Nov 2026, Anjoman's Activity page shows registration #6129 earned **$0.1197 USDC** in **10 separate periods** between #18 and #55, claimable to the miner's fee wallet `0xd020…8484`. The largest single period was #25 ($0.052 paid). Earnings came back period after period over several weeks, not in one burst. On 26 Nov 2026 the $0.1197 USDC was claimed on camera in the [demo video](https://x.com/kingChrys494/status/2126013019054633373); the claim transaction ([0x81cdf8c6…7f6f32](https://sepolia.etherscan.io/tx/0x81cdf8c69f8b1c9c1b07a4aac21f1a8adc8e5759a8eb4566513cd6a92e7f6f32)) shows Success on the Sepolia testnet explorer: 0.119679 USDC sent to the miner's fee wallet.

![Miner #6129 earnings by period](miner-6129-earnings.png)

## Ask it yourself through Telegraph

1. Sign in at [anjoman.ai](https://anjoman.ai) and click **New job**.
2. Ask a grid price question, for example: `What was the CAISO day-ahead price at NP15 for 2026-09-13 14:00 UTC?` (expected `38.09459` USD/MWh) or `What is the real-time price in New York City right now?`
3. Telegraph routes it to `GRID_POWER_PRICE_GENERAL`, which several miners serve, so your job may or may not land on this one. An answer from this miner names the operator, the interval and the source file. Compare it with the [live endpoint](https://telegraph-provider.vercel.app/api/grid-price?node_or_zone=CAISO&interval_start=2026-09-13T14:00:00Z).

Testnet only (Ethereum Sepolia). Each call costs about $0.01 in testnet USDC.

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
| Unit tests (26, including the real CAISO file of 13 Sep 2026 and a real zip holding the clock-change hour) | [test/](test/) · run `npm test` |
| Independent test, 26 Nov 2026 | Jennycruzy (Discord, builder of [MONEY OWED](https://github.com/Jennycruzy/moneyowed)) checked 12 live answers against files she downloaded from the operators herself: 10 matched, 2 failed. Both fixed in [e9b7551](https://github.com/investor567768/telegraph-provider/commit/e9b7551). Her rerun the same day, again against her own operator files: **15 of 15 match**, including both edges of the repeated clock-change hour (04:55Z, 05:55Z, 06:55Z) and a day from the October monthly archive. This was a reciprocal test between two entrants: we also tested her project and filed [issues #2](https://github.com/Jennycruzy/moneyowed/issues/2) and [#3](https://github.com/Jennycruzy/moneyowed/issues/3) on it. Her report was written on her own and is public. [Her report](https://github.com/investor567768/telegraph-provider/issues/1) |
| Public showcase post, Telegraph Discord (26 Nov 2026) | [Showcase post](https://discord.com/channels/1438396125609463881/1573045614634209341/1575573243824177152) |
| Registered YAML | [miner.yaml](miner.yaml) |
| Paid earnings, 10 periods, $0.1197 USDC (26 Nov 2026) | [miner-6129-earnings.png](miner-6129-earnings.png) |

## Honest limits

- **Not covered yet:** ERCOT, PJM, ISO-NE, SPP, CAISO real-time, MISO day-ahead. Each returns a clear 404.
- **Bug fixed on 20 Nov 2026:** ERCOT names such as `HB_WEST`, `LZ_WEST` and `HB_NORTH` were matched to NYISO zones WEST and NORTH, so an ERCOT question could get a New York price. Reported publicly by the Ballast team (Anjoman rejected the answers). ERCOT names are now refused with a 404, and the generic words `WEST` and `NORTH` only match NYISO when the question says NYISO. A regression test covers it.
- **Bugs fixed on 26 Nov 2026,** found by independent tester Jennycruzy: (1) NYISO answers for 1 Nov 2026, the clock-change day, came back as "not published" because the daily file had rolled into NYISO's monthly archive and the 01:00 hour repeats. The miner now reads the monthly zip and handles the repeated hour (05:00Z gives 33.33, 06:00Z gives 33.46). (2) A CAISO question about a future date gave a vague error; it now says that no price exists yet. (3) When CAISO OASIS throttles a burst of requests, the miner used to answer with an error; it now waits and retries twice (2 s, then 4 s) before giving up. Tests cover all three.
- **MISO** history is limited to the current operating day, because the public feed is a rolling file.
- **Default location:** the Intent's scored question names no location, so a bare "CAISO" is answered for NP15, the most-used CAISO hub. The answer says so. If a truth source uses a different node, a bare "CAISO" question would be scored against it; questions that name a node are unaffected.
- **Scoring:** on 19 Nov 2026 no evaluator was yet ranked for this Intent, so every miner's leaderboard score was 0.000.
- The accuracy job checks against the same public files the miner reads. It proves the miner reads them correctly and on the right interval; it cannot prove the operators' own figures.

## Tests

- `npm test`: 26 unit tests (location matching, daylight saving, NYISO including the clock-change archive, MISO, CAISO zip parsing and error cases, and the CVE truth source).
- `test/accuracy.ps1`: the live accuracy check, run daily by GitHub Actions.

Note (21 Nov 2026): `api/truth/cve.js` is part of my Evaluators entry, not this miner. It was first deployed here by mistake and now lives in [telegraph-evaluator](https://github.com/investor567768/telegraph-evaluator). This copy stays online only because an earlier truth-source submission still points to it.

