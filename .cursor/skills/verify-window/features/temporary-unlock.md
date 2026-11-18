# Temporary unlock

Temporary unlock lets a user spend points to open the currently blocked site for a fixed window without ending the focus block. Each purchase costs more than the last within the same focus block, and the countdown is visible on the blocked page until the unlock expires.

## Sub-features

- `unlock-cost` shows the next unlock price (`Next unlock cost`, starting at 25 pts) and disables the button without sufficient balance (`Not enough points`).
- `unlock-spend` spends the points, shows `Unlock purchased`, and reopens the site in the same tab.
- `unlock-countdown` shows the remaining unlock time (`Unlock active`) until Window locks back in.

## How to get to it (user POV)

- On the blocked page `Temporary unlock` card, choose `Spend N points` (or read `Not enough points` when the balance is too low).

## Driving it with control-window

Preconditions:

- `control-window doctor` passes and the run launched via `control-window launch`.
- The blocked page shows a points balance (demo seed starts above zero); read it with `control-window drive snapshot "blocked?blocked=example.com"`.
- Only attempt `unlock-spend` when the shown balance covers `Next unlock cost`; otherwise verify `unlock-cost` (disabled button) and stop — do not farm points to force the spend path.

- **Read price and balance.** Open the card. Run `control-window drive snapshot "blocked?blocked=example.com" --out "$VERIFY_OUT/unlock"`. The snapshot contains `Temporary unlock`, `Next unlock cost`, a points total, and either `Spend <N> points` or `Not enough points`.
- **Spend.** Drive the real button. Run `control-window drive spend --out "$VERIFY_OUT/unlock"`. The command clicks the button whose text starts with `Spend` on the blocked page and waits for `Unlock purchased` with the spent cost.
- **Confirm side effects.** Read the stored value twice. `state.json` (via `control-window drive state`) shows the reduced points total, and the unlock countdown (`Unlock active`) is visible in a second snapshot taken after the purchase.
- **Proof.** The `--out` directory holds the pre-purchase snapshot (price plus balance), the post-purchase screenshot (`Unlock purchased` / `Unlock active`), and `state.json` with the deducted total. All artifacts record the `unlock-spend` entry point.

## Gotchas

- Costs escalate per purchase within one focus block; assert the exact cost from the pre-purchase snapshot, never a constant.
- The purchase redirects back to the blocked site after a short delay; wait for the `Unlock purchased` confirmation, not the navigation.
- A zero-balance profile is a valid fixture for `unlock-cost`, not a broken setup — use it to prove the disabled path instead of working around it.
