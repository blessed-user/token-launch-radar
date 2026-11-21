// radar-2: the scoring model behind the token radar.
//
// One sealed snapshot goes in, one ranked board comes out. The board's floor is
// the snapshot's watchlist: every slug on it is ranked. On top of that the radar
// adds early rows, pre-token protocols below the watchlist floor, strongest TVL
// first, because those are the launches nobody is watching yet. Live-token
// protocols are never ranked; they are the market's own evidence, kept apart
// and shown with their market caps.
//
// A protocol counts as pre-token when its snapshot entry records no token at
// all: no market cap, no CoinGecko id, no symbol. Nothing about a name is ever
// special-cased; the same scoring function runs over every row, and the one
// number that tunes it, the category multiple, is calibrated from this very
// snapshot on every run, never chosen by hand.
//
// How the implied value is built, from the snapshot's own figures only:
//
//   multiple:  per category, the median of mcap_usd / tvl_usd across that
//     category's live-token protocols (a token that trades, positive market cap
//     and positive TVL). A category's own median is trusted only when it has at
//     least five such comps; with fewer, the category falls back to the overall
//     live median. A trusted median is shrunk toward the overall, 60% overall
//     plus 40% category, then clamped into [0.10, 0.50]. That is the whole
//     defence against a single outlier naming a multiple: Risk Curators has one
//     live comp (Api3, ratio 2.97) and Chain has one (ratio 3.03), and neither
//     raw median is used. A protocol with no category takes the overall median.
//   growth:    the seven-day change, clamped into [-60, +120] per cent, then
//     growth multiplier = 1 + (growth / 100) x 0.5.
//   maturity:  0.6 + min(age in days, 1095) / 1095 x 0.4; a protocol whose
//     listing date is unknown is treated as 365 days old.
//   breadth:   1 + 0.03 per chain beyond the first, at most three extra, so the
//     multiplier tops out at 1.09: chains a protocol already runs on are
//     distribution its token would inherit, worth a small premium, never the
//     deciding factor.
//   implied:   max(1, round(tvl_usd x multiple x growth x maturity x breadth))
//
// The dashboard shows the same arithmetic and recomputes each row in the page,
// so a reader can check the board's numbers against the model directly.

/** One protocol entry from the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document as a whole. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/**
 * The model's tuning, as the dashboard states it. The multiple is NOT one of
 * these numbers: it is calibrated from the snapshot on every run (see
 * computeCalibration). The overall median the calibration falls back to is
 * computed, never hand-picked; these constants only shape how the snapshot's
 * own figures combine.
 */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Live comps a category needs before its own median may be trusted. */
  min_category_n: number;
  /** Shrinkage: multiple = shrink_overall x overall + shrink_category x category. */
  shrink_overall: number;
  shrink_category: number;
  multiple_min: number;
  multiple_max: number;
  /** Breadth premium per extra chain, and how many extra chains count. */
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 1 / 2,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 3 / 5,
  maturity_range: 2 / 5,
  maturity_days: 3 * 365,
  unknown_age_days: 365,
  min_category_n: 5,
  shrink_overall: 3 / 5,
  shrink_category: 2 / 5,
  multiple_min: 1 / 10,
  multiple_max: 1 / 2,
  chain_step: 3 / 100,
  chain_max_extra: 3,
};

/** The model's version label, which the dashboard names and the rules quote. */
export const MODEL_VERSION = 'radar-2';

/** Early rows the radar carries below the watchlist floor, strongest TVL first. */
export const EARLY_ROWS = 200;

/** Live-token protocols the dashboard's Live view carries, biggest market cap first. */
export const LIVE_ROWS = 24;

/** One category's calibration: its live comps, their median mcap/TVL, and the
 * multiple the board actually uses. `median` is null below min_category_n: the
 * category median is not trusted on so few comps, and `multiple` is then the
 * overall median. */
export interface CategoryComp {
  category: string | null;
  n: number;
  median: number | null;
  multiple: number;
  used_category_median: boolean;
}

/** The calibration a snapshot produced: the overall live median and one entry
 * per category on the board. The dashboard prints this table whole, so every
 * multiple can be checked. */
export interface Calibration {
  overall_median: number;
  overall_n: number;
  categories: CategoryComp[];
}

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row slimmed down for data.js; the page builds the farm plan itself. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's
 * own value for it, never a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders: board, live set, calibration, model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** The board's headline figures. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, or `fallback` when the value is missing or not finite. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Round to four decimals, the precision the board's multiples are stored at. */
const round4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from `listedAt` to `asOf`, never below zero; null when either
 * date is missing or unparseable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const snapshotDay = Date.parse(`${asOf}T00:00:00Z`);
  const listedDay = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(snapshotDay) || !Number.isFinite(listedDay)) return null;
  return Math.max(0, Math.floor((snapshotDay - listedDay) / DAY_MS));
}

/** The median of a non-empty list. */
function medianOf(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

/**
 * Calibrate the multiples from the snapshot's own live-token protocols. A comp
 * is a protocol that records a token, with a positive market cap and positive
 * TVL: a market cap of 0 (or the -1 the feed writes for one protocol) records
 * no tradable market and is no comparable. The overall median runs over every
 * comp; a category's median runs over its own comps and is used only at
 * min_category_n comps or more, shrunk 60/40 toward the overall and clamped.
 * On this snapshot the overall median lands near 0.21 over 128 comps, and the
 * traps it steps around are Risk Curators (one live comp, ratio 2.97) and
 * Chain (one live comp, ratio 3.03).
 */
export function computeCalibration(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const comps = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0,
  );
  const overall = comps.length > 0 ? medianOf(comps.map((p) => p.mcap_usd! / p.tvl_usd)) : 0.2;
  const ratiosByCategory = new Map<string | null, number[]>();
  for (const p of comps) {
    const ratios = ratiosByCategory.get(p.category) ?? [];
    ratios.push(p.mcap_usd! / p.tvl_usd);
    ratiosByCategory.set(p.category, ratios);
  }
  const byCategoryThenNull = (a: string | null, b: string | null): number =>
    a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0;
  const categories = [...ratiosByCategory.keys()].sort(byCategoryThenNull).map((category) => {
    const ratios = ratiosByCategory.get(category)!;
    const n = ratios.length;
    if (n >= model.min_category_n) {
      const ownMedian = medianOf(ratios);
      const shrunk = model.shrink_overall * overall + model.shrink_category * ownMedian;
      const multiple = Math.min(model.multiple_max, Math.max(model.multiple_min, shrunk));
      return { category, n, median: round4dp(ownMedian), multiple: round4dp(multiple), used_category_median: true };
    }
    return {
      category,
      n,
      median: n > 0 ? round4dp(medianOf(ratios)) : null,
      multiple: round4dp(overall),
      used_category_median: false,
    };
  });
  return { overall_median: round4dp(overall), overall_n: comps.length, categories };
}

/** The calibration cut down to the categories a board actually uses, same order. */
export function calibrationForBoard(
  snapshot: Snapshot,
  boardCategories: (string | null)[],
  model: ModelConstants = MODEL,
): Calibration {
  const full = computeCalibration(snapshot, model);
  const wanted = new Set(boardCategories);
  return {
    overall_median: full.overall_median,
    overall_n: full.overall_n,
    categories: full.categories.filter((c) => wanted.has(c.category)),
  };
}

/** The multiple a category gets under a calibration: its own shrunk multiple
 * when it earned one, otherwise the overall median. */
export function categoryMultiple(calibration: Calibration, category: string | null): number {
  const entry = calibration.categories.find((c) => c.category === category);
  return entry !== undefined ? entry.multiple : calibration.overall_median;
}

/** The breadth multiplier: 1 + 0.03 per extra chain, at most 1.09. */
export function chainMultiplier(chains: string[], model: ModelConstants = MODEL): number {
  const extra = Math.min(Math.max(chains.length - 1, 0), model.chain_max_extra);
  return round4dp(1 + model.chain_step * extra);
}

/** The score one protocol earns, with every multiplier that produced it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  calibration: Calibration,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  categoryMultiple: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finiteOr(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageUsed = age ?? model.unknown_age_days;
  const ageCapped = Math.min(Math.max(ageUsed, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (ageCapped / model.maturity_days) * model.maturity_range;
  const catMult = categoryMultiple(calibration, protocol.category);
  const chainMult = chainMultiplier(protocol.chains, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * catMult * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, categoryMultiple: catMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of
 * another protocol, not a protocol of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange,
 * not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocols keyed by slug, for watchlist lookups. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** The protocols the board ranks, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = computeCalibration(snapshot, model);
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor, never a ceiling: every slug on it is ranked,
  // even one the snapshot no longer carries (it cannot, but the board's
  // coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar: pre-token protocols below the watchlist floor, strongest
  // TVL first, capped. A protocol already chosen stays chosen; the early rows
  // add to the watchlist, they never replace a row on it.
  const byTvlThenSlug = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
    b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort(byTvlThenSlug)
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const byImpliedThenSlug = (
    a: { implied: number; p: SnapshotProtocol },
    b: { implied: number; p: SnapshotProtocol },
  ): number => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0);
  const scored = [...chosen.values()]
    .map((p) => {
      const score = impliedValue(p, snapshot.as_of, model, calibration);
      return { p, ...score };
    })
    .sort(byImpliedThenSlug);
  return scored.map((s, position) => ({
    rank: position + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.categoryMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4dp(s.growthMult),
      maturity_multiplier: round4dp(s.maturityMult),
      chain_multiplier: s.chainMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** One step as a single string: its action, then its cost and time, inside
 * the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let rendered = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (rendered.length > 600) rendered = `${rendered.slice(0, 596)}...`;
  if (rendered.length < 20) rendered = `${rendered} Hold the position and check the protocol's own page.`;
  return rendered;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer
 * qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The farm action for a category, as a table, first matching rule wins. Each
 * rule names the words that select it and the sentence a farmer follows; the
 * rules run in this order, so a category matching two rules takes the earlier
 * one. No protocol name appears anywhere in the table.
 */
interface FarmRule {
  words: string[];
  action: (name: string, capital: number, chain: string) => string;
}

const FARM_RULES: FarmRule[] = [
  {
    words: ['lend', 'cdp', 'collateral'],
    action: (name, capital, chain) => `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`,
  },
  {
    words: ['dex', 'yield', 'leveraged farm'],
    action: (name, capital, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
  },
  {
    words: ['bridge'],
    action: (name, capital, chain) => `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
  },
  {
    words: ['staking', 'restak'],
    action: (name, capital, chain) => `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`,
  },
  {
    words: ['perpetual', 'derivative'],
    action: (name, capital, chain) => `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`,
  },
  {
    words: ['prediction'],
    action: (name, capital, chain) => `Fund $${capital} and place one market position on ${name}.`,
  },
  {
    words: ['curator', 'allocator'],
    action: (name, capital, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`,
  },
  {
    words: ['stable'],
    action: (name, capital, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
  },
  {
    words: ['rwa'],
    action: (name, capital, chain) => `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`,
  },
  {
    words: ['insurance'],
    action: (name, capital, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`,
  },
];

/** The farm action for one protocol: the first rule its category matches, or
 * the plain deposit when no rule does. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const rule of FARM_RULES) {
    if (rule.words.some((word) => category.includes(word))) return rule.action(p.name, capital, chain);
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  const plan: [string, string, string][] = [
    [
      'Use a fresh wallet that holds only the funds you plan to farm, ' +
        'and keep its seed phrase offline.',
      'under $3 of gas for the first transaction',
      '5 minutes',
    ],
    [action, `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'],
    [
      `Make one qualifying action each week on ${chain}, such as a deposit, a borrow, a swap or a vote.`,
      'about $2 of gas a week',
      '10 minutes a week',
    ],
    [
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ],
    [
      "Before you withdraw, open the protocol's own points or rewards page " +
        "from its own site and claim only from the link it publishes there; " +
        "never pay to claim, and remember no token is guaranteed.",
      'no fee to check; a fee to claim is a scam',
      '10 minutes',
    ],
    [
      'Write the wallet, the dates and every transaction in a farm log ' +
        'so you can repeat the position or unwind it.',
      'nothing but the log',
      '5 minutes',
    ],
  ];
  return plan.map(([text, cost, time]) => ({ text, cost, time }));
}

/** The live-token protocols, biggest market cap first, for the dashboard's
 * Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const byMcapThenTvl = (a: SnapshotProtocol, b: SnapshotProtocol): number =>
    (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd;
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(byMcapThenTvl)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in
 * the page instead of shipped. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const earlyCount = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const calibration = calibrationForBoard(
    snapshot,
    board.map((r) => r.category),
    model,
  );
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
    watchlist: [...snapshot.watchlist].sort(),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** A string field of a snapshot object, or null when it is absent or not a string. */
function textOrNull(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? (record[key] as string) : null;
}

/** A finite number field of a snapshot object, or null when it is absent or
 * not a finite number. */
function numberOrNull(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The snapshot out of a file's text, refused unless it is the shape the
 * model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    const chains = Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [];
    return {
      slug: p.slug,
      name: p.name,
      category: textOrNull(p, 'category'),
      chains,
      tvl_usd: p.tvl_usd,
      change_7d: numberOrNull(p, 'change_7d'),
      mcap_usd: numberOrNull(p, 'mcap_usd'),
      listed_at: textOrNull(p, 'listed_at'),
      gecko_id: textOrNull(p, 'gecko_id'),
      symbol: textOrNull(p, 'symbol'),
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks,
 * order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch
 * and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
