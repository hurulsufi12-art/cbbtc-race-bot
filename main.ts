// cbbtc-race-bot: a dip-scalp + momentum rider for the cbBTC 1-minute replay.
//
// Why this shape: on the frozen dev window (1,440 one-minute bars of cbBTC/USDC,
// price down 2.80% over 24h) every kit baseline loses money — buy-and-hold
// -31.63, momentum -23.87, rsi-bollinger -39.92, adx-momentum -75.57,
// ema-cross -148.17 USDC — so trend-following and holding both fail the dev
// gate (net PnL above 0). The one repeatable edge in the data is short-horizon
// mean reversion after a sharp drop: after a 30-minute fall of more than 100 bps
// the next 15 minutes average +76 bps (79% of cases beat the ~26 bps round-trip
// cost), while after a rally the next 15 minutes average -41 bps. That is the
// signature of an AMM pool price overshooting on a large trade and arbitrage
// pulling it back within minutes, so the bot buys sharp dips and exits fast,
// and rides the rare strong 60-minute rally with a trailing stop instead of
// chasing every cross.
//
//   - Dip leg: buy the whole equity when the trailing 30-minute return is below
//     -120 bps, or the trailing 15-minute return is below -100 bps while the
//     last 5 minutes stopped falling (above -20 bps, a bounce confirmation).
//     Exit at +100 bps over cost, -100 bps under it, or after 15 bars.
//   - Momentum leg: buy the whole equity when the trailing 60-minute return is
//     above +80 bps AND the trailing 15-minute return is still positive, so a
//     rally that has already turned down is not bought at a local top. Exit on
//     a trailing stop of -100 bps from the peak value, or after 120 bars.
//   - One position at a time, dip first; 15 bars of cooldown after any exit so
//     a still-falling market cannot be re-entered bar after bar; no entries
//     after seq 1400 so every position has time to exit before the forced
//     flatten at the last close.
//   - Orders cap their slippage at 100 bps past the close they were decided
//     on (the largest open-vs-previous-close move in the dev window is 18.4 bps,
//     so the cap never binds in practice).
//   - Everything is float64 over closes plus integer account values, no clock,
//     no randomness, no network, no files: the same bars give the same orders,
//     run after run.
//
// Local grade on the dev window (kit grade-local, process driver):
// net PnL +10.60 USDC, 2 round trips (both won), max drawdown 0.8%, fees 1.61.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Dip leg: trailing 30-minute return below this (bps) buys. */
const DIP30_BPS = 120;
/** Dip leg, fast trigger: trailing 15-minute return below this (bps) buys. */
const DIP15_BPS = 100;
/** Fast trigger needs the last 5 minutes above this (bps): the fall has stopped. */
const CONFIRM5_BPS = -20;
/** Momentum leg: trailing 60-minute return above this (bps) buys. */
const MOM60_BPS = 80;
/** Momentum leg confirmation: the trailing 15-minute return must still be
 * positive — a 60-minute rally whose last 15 minutes have already turned
 * down is a local top, not a rally to ride. */
const MOM15_MIN_BPS = 0;
/** Dip leg exits: take profit / stop loss (bps over / under cost), max hold (bars). */
const TP_BPS = 100;
const SL_BPS = 100;
const HOLD_DIP = 15;
/** Momentum leg exits: trailing stop (bps under the peak value), max hold (bars). */
const HOLD_MOM = 120;
/** Bars of silence after any exit, before a new entry may fire. */
const COOLDOWN = 15;
/** No entries from this seq on, so a position always has time to exit. */
const NO_ENTRY_AFTER_SEQ = 1400;
const MAX_SLIPPAGE_BPS = 100;

type Mode = 'dip' | 'mom' | null;

/** Closes seen so far, oldest first, as float64. */
const closes: number[] = [];
let barsHeld = 0;
let cooldown = 0;
let mode: Mode = null;
/** Peak position value (quote units) since the current entry, for the trail. */
let peak: bigint | null = null;

/** Trailing return over `n` bars ending at the latest close, in bps, or null. */
function trailingBps(n: number): number | null {
  const k = closes.length - 1;
  if (k < n) return null;
  return (closes[k] / closes[k - n] - 1) * 10000;
}

await runBars({
  onBatch(state: BarsState, batch) {
    const fresh = new Set(batch.bars.map((b) => b.symbol));
    for (const bar of batch.bars) closes.push(Number(bar.c));
    if (!fresh.has(SYMBOL) || state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const held = state.positions.get(SYMBOL);

    if (held !== undefined) {
      barsHeld += 1;
      const value = state.value(SYMBOL, held.qty);
      if (peak === null || value > peak) peak = value;
      const cost = held.cost;
      let exit = false;
      if (mode === 'dip') {
        // Take profit, stop loss (integer cross-multiplication, no floats),
        // or the hold expires.
        exit =
          value * 10000n >= cost * BigInt(10000 + TP_BPS) ||
          value * 10000n <= cost * BigInt(10000 - SL_BPS) ||
          barsHeld >= HOLD_DIP;
      } else {
        // Momentum: trailing stop under the peak value, or the hold expires.
        exit = (peak !== null && value * 10000n <= peak * BigInt(10000 - SL_BPS)) || barsHeld >= HOLD_MOM;
      }
      if (exit) {
        barsHeld = 0;
        cooldown = COOLDOWN;
        mode = null;
        peak = null;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    if (cooldown > 0) {
      cooldown -= 1;
      return [];
    }
    if (state.seq >= NO_ENTRY_AFTER_SEQ) return [];

    const dip30 = trailingBps(30);
    const dip15 = trailingBps(15);
    const confirm5 = trailingBps(5);
    const mom60 = trailingBps(60);
    const mom15 = trailingBps(15);
    let entry: Mode = null;
    if (dip30 !== null && dip30 < -DIP30_BPS) entry = 'dip';
    else if (dip15 !== null && dip15 < -DIP15_BPS && confirm5 !== null && confirm5 > CONFIRM5_BPS) entry = 'dip';
    else if (mom60 !== null && mom60 > MOM60_BPS && mom15 !== null && mom15 > MOM15_MIN_BPS) entry = 'mom';
    if (entry === null) return [];

    let stake = state.equity < state.cash ? state.equity : state.cash;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    if (stake > byWeight) stake = byWeight;
    if (stake < BigInt(fees.min_notional_quote_units)) return [];
    barsHeld = 0;
    mode = entry;
    peak = null;
    const orders: (SellInput | BuyInput)[] = [
      { side: 'buy', symbol: SYMBOL, notional_quote_units: stake, max_slippage_bps: MAX_SLIPPAGE_BPS },
    ];
    return orders;
  },
});
