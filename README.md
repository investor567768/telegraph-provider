# Telegraph Provider

**Track:** Miners / Providers · **Network:** Telegraph testnet

A Telegraph Provider that answers mission-critical Intents from public, keyless sources, with explicit errors instead of guessed answers.

| Intent | Endpoint | Covers |
|---|---|---|
| `GRID_POWER_PRICE_GENERAL` | `/api/grid-price` | NYISO zones (real-time, day-ahead), MISO nodes and hubs (real-time) |

## Grid power price (`GRID_POWER_PRICE_GENERAL`)

Answers "what does electricity cost at this grid location right now?" from the grid operators' own public data, with no API key:

- **NYISO** (New York): all 11 load zones, real-time 5-minute and day-ahead hourly.
- **MISO** (central US): any pricing node or trading hub, real-time 5-minute ex-post, current day.

### Request and answer

`GET /api/grid-price?node_or_zone=N.Y.C.&interval_start=2026-11-19T12:07:00Z`

| Field | Meaning |
|---|---|
| `lmp_usd_per_mwh` | Locational marginal price, US dollars per megawatt-hour, exactly as the operator published it |
| `node_or_zone` | The operator's own name for the location (`N.Y.C.`, `INDIANA.HUB`) |
| `market` | Which market the price comes from |
| `interval_start`, `interval_end` | The interval the price covers, in UTC |
| `currency` | `USD` |

Also returned: the operator, the loss and congestion components, the operator's own time stamp, and the source file.

Accepted names include `N.Y.C.`, `NYC`, `New York City`, `NYISO zone J`, `Long Island`, `Capital`, `MISO Indiana hub`, `INDIANA.HUB`, `WEC.OAKCREKC5`. Leave out `interval_start` for the latest price. Add `market=day ahead` for NYISO day-ahead prices.

Errors are explicit, never a guessed price: an unknown location, an operator that is not covered (for example ERCOT), a time outside the published data, or an operator that cannot be reached.

### Time stamps
- NYISO stamps real-time prices at the **end** of each 5-minute interval, in US Eastern time; this miner reports the interval start in UTC (stamp minus 5 minutes).
- MISO publishes in EST (UTC-5) all year.

### Tests
`npm test` runs the matching, time-zone and error-case tests against sample rows copied from the operators' live files on 19 Nov 2026.
