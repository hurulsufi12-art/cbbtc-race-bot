# cbbtc-race-bot

[![btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/hurulsufi12-art/cbbtc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/hurulsufi12-art/cbbtc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444)

A bot that trades Coinbase Wrapped BTC (cbBTC) minute by minute on its on-chain
Orca prices, for the make.fun bounty
[Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261118-1444)
($250 USDC, 10 places, 1st $60).

## Strategy

On the frozen dev window every kit baseline loses money (buy-and-hold −$31.63,
momentum −$23.87, rsi-bollinger −$39.92, adx-momentum −$75.57, ema-cross
−$148.17), so holding and trend-crossing both fail the dev gate. The one
repeatable edge in the data is short-horizon mean reversion after a sharp drop:
after a 30-minute fall of more than 100 bps the next 15 minutes average +76 bps,
while after a rally the next 15 minutes average −41 bps — an AMM pool price
overshooting on a large trade and arbitrage pulling it back within minutes.

- **Dip-scalp:** buy the whole equity when the trailing 30-minute return is
  below −120 bps, or the trailing 15-minute return is below −100 bps while the
  last 5 minutes stopped falling (above −20 bps). Exit at +100 bps over cost,
  −100 bps under it, or after 15 bars.
- **Momentum rider:** buy the whole equity when the trailing 60-minute return
  is above +80 bps AND the trailing 15-minute return is still positive (the
  rally is alive; a 60-minute rally whose last 15 minutes turned down is a
  local top, not a ride) but below +150 bps — a vertical spike top is not
  chased (after a 15-minute rally over 60 bps the next 15 minutes average
  −41 bps). Exit on a trailing stop of −100 bps from the peak value,
  or after 120 bars.
- One position at a time, dip first; 15 bars of cooldown after any exit; no
  entries after seq 1400. Orders cap slippage at 100 bps. Fully deterministic:
  float64 over closes plus integer account values — no clock, no randomness,
  no network, no files.

## Local grade (dev window)

`node cli/makefun.mjs grade-local --kit . --bot <repo> --driver process`:

- **Net PnL +10.60 USDC**, 2 round trips (both won), max drawdown 0.8%, fees 1.61

## Files

- `main.ts` — the bot (TypeScript, Node 22, stdlib-free of dependencies)
- `vendor/makefun-bars.ts` — the kit's bars-replay/v1 SDK shim, byte-identical
  copy of `sdk/makefun-bars.ts`
- `LICENSE` — MIT

## Run it

```bash
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```
