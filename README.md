# Hold-n-Fold — Play-Money MVP

This is a working proof of concept for the platform described in `Hold'n'Fold.pdf`:
real-time, multiplayer Texas Hold'em sit-n-go tournaments on hourly public
tables, plus profile/leaderboard dashboards. It runs entirely on **play-money
chips** — no real crypto, no deposits, no KYC — so you can start recruiting
testers and first players immediately, at zero infrastructure cost.

## Why play-money first (read this before wiring in real crypto)

The original doc's plan (real USDC buy-ins, "crypto-tax-free" jurisdiction,
minimal KYC) describes what is, functionally, **real-money online poker** —
almost every jurisdiction treats that as a licensed gambling activity,
independent of whether it settles in fiat or crypto. Operating it without a
license is a real legal and financial risk to you personally, not just a
compliance nice-to-have. That risk is separate from — and much bigger than —
the product-engineering problem. Standard, low-cost way to de-risk both at
once: prove people actually want to play (this MVP) before spending anything
on gaming licenses, KYC/AML vendors, or custody infrastructure. Talk to a
gaming/fintech attorney before any build accepts real deposits. Nothing here
should be read as legal advice.

## What's actually built

- Real Texas Hold'em engine: shuffling, hole cards, flop/turn/river, side pots for all-ins, full 7-card hand evaluation and tie-breaking.
- Sit-n-go tournaments: up to 10 seats, rising blinds, play continues until one player has all the chips; 1st/2nd/3rd split a prize pool built from everyone's buy-in, minus a configurable house rake (defaults: 50/30/20 split, 10% rake — see `server/table.js`).
- A public **hourly table** that opens automatically, 24/7 (`server/lobby.js`). If fewer than 2 people are seated at the top of the hour, it's cancelled with no charge (no real money is at risk anyway).
- An instant **demo table** anyone can join right now, so you (or a tester) never have to wait for the clock to try the game.
- Lightweight profile system: pick a display name, get 1,000 starter chips, play. Dashboard shows games played, wins, top-3 cashes, and a public leaderboard. No email/phone/password — that's deliberately deferred (see Roadmap) since there's no real money to protect yet.
- Single Node process, one JSON file for storage (`data/users.json`) — no paid database, no paid blockchain RPC, no paid anything. Free to run.

## What's deliberately NOT built yet

Parallel tables, customizable/private friend tables, community-leader tables, real USDC deposits/withdrawals, Uniswap conversion, wallet provisioning, native iOS/Android/desktop apps, KYC. These are all in the original vision doc — cut from v1 to keep testing cheap and fast per your instruction. See Roadmap below for the order to add them back once the core loop is proven.

## Running it locally

Requires Node.js 18+ (nothing else — no Docker, no cloud account needed).

```
                      cd holdnfold-mvp
                      npm install
                      npm start
                      ```

                      Open `http://localhost:3000` in a couple of browser tabs (or send the link
                      to a friend on your network) to play a demo table against a real second
                      player.

                      ## Verifying it (before you trust it with testers)

                      ```
                      npm run simulate
                      ```

                      This runs 25 full randomized tournaments (2–9 bot players each) headlessly
                      and asserts: the hand evaluator scores hands correctly, every tournament
                      actually finishes, chip totals reconcile exactly (payouts = prize pool, prize
                      pool + rake = total buy-ins), and nothing throws. All 25 passed as of this
                      build. Re-run it any time you change `server/table.js` or
                      `server/handEvaluator.js`.

                      ## Putting it in front of testers for $0

                      Any Node-friendly free tier works; Render is the easiest to set up with no
                      credit card:

1. Push this folder to a new GitHub repo (private is fine).
2. Go to render.com → New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`. Instance type: Free.
4. Deploy. Render gives you a public `https://your-app.onrender.com` URL — that's what you share in your PR / with testers.

                              Caveat of the free tier: the service sleeps after ~15 minutes idle and takes
                            ~30-60s to wake on the next visit. Fine for early testers; if it becomes
                            annoying, a $7/mo "always on" tier removes it — still far cheaper than any
                            paid database or blockchain infra.



                            ## Known MVP limitations (fine for testing, not for real money)

- In-memory game state: restarting the server mid-tournament loses that table's game (players keep their chip balance from before they joined, since the buy-in was already deducted — you may want to manually refund testers if you restart mid-game during the test period).
- No reconnect-mid-hand support yet: a dropped connection auto-folds the player's hand each turn until they're blinded out.
- No chat, no mobile-native wrapper, no anti-bot/anti-collusion detection. None of that matters for play-money testing; all of it matters before real money is involved.

## Roadmap back to the full vision (suggested order, cheapest risk-reduction first)
        
           1. **Validate the game loop** (this build): get real people playing hourly tables, watch the dashboard/leaderboard for engagement, fix UX friction.
             2. **Talk to a gaming/fintech lawyer** in parallel — figure out which jurisdictions you can legally operate real-money poker in, and what licensing/KYC/AML that actually requires. This determines almost everything about phase 3+, so it's worth doing before writing more code.
             3. **Add accounts with real identity** (email + phone, matching the original doc) once you know your KYC requirement — cheap either way, but the specifics depend on step 2.
             4. **Wire in one real stablecoin path** (e.g. USDC on a low-fee chain, or a custodial on/off-ramp provider) behind the same play-money table logic — the game engine doesn't need to change, only how buy-ins are funded and payouts are withdrawn.
             5. **Then** layer back in parallel tables, customizable/private tables, and community-leader tables — all are variations on the same `Table` class already built, not new engines.
             6. **Native apps / app-store builds** last — a responsive web app (what you have now) reaches phones and desktops today for $0; store builds add real cost (developer accounts, review cycles) that's better spent once you know people want to keep playing.


## File map

```
holdnfold-mvp/
  server/
    handEvaluator.js   7-card hand ranking + tie-breaks
    pokerEngine.js     deck/shuffle/card utilities
    table.js           sit-n-go tournament state machine (the core game logic)
    lobby.js           hourly scheduler + demo tables
    store.js           file-based user profiles/stats/leaderboard
    server.js          Express + Socket.io wiring, REST + realtime events
  public/              the whole frontend (plain HTML/CSS/JS, no build step)
  test/simulate.js     headless correctness test (npm run simulate)
  data/users.json      created on first run — your local play-money "database"
```
