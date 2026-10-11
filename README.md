# GEX Terminal — SPX/SPY Gamma Exposure Dashboard

Intraday GEX (Gamma Exposure) analytics for SPX/SPY options, mapped to ES
futures levels. Built with Next.js 16 (App Router), TypeScript, Tailwind
CSS, Recharts, and Lucide icons.

## 1. Folder structure

```
.
├── app/
│   ├── api/gex/route.ts     Step 2 — GET /api/gex: validates query params,
│   │                        fetches the chain via dataService, runs it
│   │                        through gexEngine, returns typed JSON
│   ├── layout.tsx           Step 5 — root layout (dark theme shell, metadata)
│   ├── globals.css          Step 5 — Tailwind directives + base styles
│   └── page.tsx             Step 5 — main dashboard page: owns all state,
│                            fetch/polling logic, loading/error UI, and
│                            wires HeaderControls + PivotCards + GexChart +
│                            StrikeTable together
│
├── components/
│   ├── HeaderControls.tsx   Step 3 — ticker/expiry/offset/refresh controls
│   ├── PivotCards.tsx       Step 3 — regime banner + 4 pivot-level cards
│   ├── GexChart.tsx         Step 4 — horizontal GEX profile bar chart
│   └── StrikeTable.tsx      Step 4 — strike-by-strike data table
│
├── lib/
│   ├── gexEngine.ts         Step 1 — the math: dollar GEX, zero gamma,
│   │                        call/put wall, regime, ES conversion
│   ├── format.ts            Step 3 — shared price/currency/time formatters
│   └── services/
│       └── dataService.ts   Step 2 — mock chain generator + Polygon.io
│                            live fetcher with automatic fallback
│
├── types/
│   ├── gex.ts                Step 1 — OptionContract, StrikeGexSummary,
│   │                          GexAnalysisResult, UnderlyingSymbol, etc.
│   └── api.ts                 Step 2 — GexApiResponse, GexApiErrorResponse,
│                               ExpiryFilter, DataSource
│
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── next.config.js
└── next-env.d.ts
```

Every file above has already been type-checked in strict mode, and the
whole app has been built (`next build`) and smoke-tested against a running
production server (`next start`), including the API route's validation,
error responses, and mock-data fallback.

## 2. Running locally

**Requirements:** Node.js 18.18+ (Next.js 16 requirement), npm.

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev

# 3. Open the app
# http://localhost:3000
```

With no further configuration, the app runs entirely on **mock data** —
`lib/services/dataService.ts` generates a realistic SPX/SPY chain (proper
Black-Scholes gamma, IV skew, OI/volume modeling) whenever no API key is
present. The "Demo Data" badge in the header reflects this.

### Connecting live data (optional)

To pull real chains from Polygon.io instead of mock data:

```bash
# .env.local
POLYGON_API_KEY=your_key_here
```

Restart the dev server after adding this. The header badge will switch to
"Live" once a request succeeds. If a live fetch ever fails for any reason
(rate limit, network error, plan tier missing greeks), the endpoint
automatically and silently falls back to mock data rather than breaking —
check your server logs for the `[dataService] Polygon fetch failed...`
warning if that happens unexpectedly.

### Other commands

```bash
npm run build   # production build
npm run start   # run the production build (after npm run build)
npm run lint    # Next.js's built-in ESLint check
```

## 3. Known limitations to be aware of

- **Ticker selector offers "QQQ"**, but `lib/services/dataService.ts` and
  `types/gex.ts` (`UnderlyingSymbol`) only compute GEX for `"SPX" | "SPY"`
  today. Selecting QQQ shows a "coming soon" placeholder instead of data,
  rather than silently mislabeling another instrument's numbers as QQQ.
- **"Next Expiry" filter** is offered in the UI but the backend
  (`types/api.ts` `ExpiryFilter`) only supports `"0DTE" | "ALL"`.
  Selecting it currently falls back to `"ALL"` with a visible notice
  banner, rather than sending an invalid request.
- Extending either of these to real functionality means: adding the new
  literal to the relevant type union, teaching `dataService.ts` how to
  fetch/generate that data, and removing the corresponding fallback logic
  in `app/page.tsx`.

## 4. Customization guide

### Changing chart bar colors

`components/GexChart.tsx` defines the positive/negative bar colors as
plain constants at the top of the file:

```ts
const POSITIVE_COLOR = "#22c55e"; // green-500
const NEGATIVE_COLOR = "#ef4444"; // red-500
const SPOT_COLOR = "#22d3ee";     // cyan-400
const ZERO_GAMMA_COLOR = "#fbbf24"; // amber-400
```

Change the hex values directly — they feed both the `<Cell fill=.../>`
bar coloring and the reference-line strokes, so a single edit keeps the
chart and its legend in sync.

### Changing the dashboard's color theme

The rest of the UI (cards, badges, table highlights) uses Tailwind
utility classes rather than a central token file — e.g. `bg-emerald-500`,
`text-rose-400`, `border-slate-800`. To re-theme:

- Swap `emerald` → your "long gamma / positive" color throughout
  `PivotCards.tsx` and `StrikeTable.tsx`.
- Swap `rose` → your "short gamma / negative" color the same way.
- `slate-900` / `zinc-950` are the panel/page background tones set in
  `app/layout.tsx` and each component's `bg-*` classes.

If you plan to reskin extensively, consider extracting these into
`tailwind.config.ts` under `theme.extend.colors` (e.g. `gex.positive`,
`gex.negative`) and doing a find-and-replace once — the config file is
already set up and ready for that.

### Changing the GEX formulas

All the math lives in one file: `lib/gexEngine.ts`. Each function has a
single responsibility and is independently exported, so formulas can be
swapped without touching the API route or any UI component:

| To change...                          | Edit this function              |
|----------------------------------------|----------------------------------|
| The dollar-GEX-per-contract formula     | `calculateContractGex`          |
| How zero gamma is located               | `findZeroGamma`                 |
| Call Wall / Put Wall selection logic    | `findCallWall` / `findPutWall`  |
| Market regime classification            | `determineMarketRegime`         |
| SPX/SPY → ES conversion / basis logic   | `convertToFuturesLevel`         |

`findZeroGamma` currently uses a documented simplified approach (walking
the strike ladder using each contract's already-computed gamma at current
spot, then linearly interpolating the crossing). If you later want the
more rigorous version — recomputing Black-Scholes gamma across a grid of
hypothetical spot prices — that's a self-contained change inside this one
function; nothing else depends on its internals beyond the return type
(`number | null`).

### Changing mock data realism

`lib/services/dataService.ts` — `generateMockOptionChain()` and its
helpers (`computeSkewedIv`, `estimateOpenInterest`, `blackScholesGamma`,
etc.) control the simulated chain. Constants like `RISK_FREE_RATE`,
`DIVIDEND_YIELD`, and the OI side-multipliers are grouped near the top of
each relevant section for easy tuning.
