# 017. Amendments after the shop review — role ids saved before positioning, visible names, one lock order, filed follow-ups

**Status:** accepted (amends 014 §3.2 and 015 §4)
**Date:** 2026-09-20
**Decided by:** architect (technical), in the «refute this» review of `feat/shop-and-earnings`

## Context
The shop step was reviewed before merge and the verdict was ACCEPTED WITH CHANGES. Every builder
choice was accepted. One of them, never adopting a clan role by name, was accepted on condition
of the first fix below.

## Decision
1. **A created role's id is saved before the role is positioned.** `ensureRole` calls back with
   the id at creation time. Otherwise a failing `setPosition` loses the id, the next pass creates
   another role, and the strays accumulate until the refund. A clan rename edits the role only if
   it exists; creation is left to convergence.
2. **A clan or room name must contain at least one letter, digit or pictographic emoji.**
   Invisible characters, combining marks alone, and punctuation alone are refused.
3. **One lock order for clans:** the Clan row first, then its members. Removal, a member leaving
   the server and expiry all follow it, and they retry on a deadlock (`withTxRetry`).
4. **Forbidden words match only at the start of a word.** «бот» no longer blocks «Работа».
   «mod» still blocks «Modern», because a word-start rule cannot tell it from «ModSquad». The lead
   accepted this: a false refusal costs the buyer a second try, not money.
5. **Accepted as built:**
   - the bot allows itself before denying `@everyone` in an access channel;
   - a refund happens only after a failed apply, when the row is 30 minutes old and the buyer is
     present;
   - clan roles are never adopted by name, media roles are;
   - a clan member cannot buy a clan;
   - startup problems are logged but leave the good enabled;
   - `settings.get` inserts, then reads.

## Rejected
- **Adopting clan roles by name** to recover a lost id. A same-named role made by a moderator
  could hand out a staff role.

## Consequences
Filed follow-ups:
- (F2) **Before go-live on the real server:** removing a channel from the media list resets
  `@everyone` to inherit. A channel that denied images on its own would open up. Record the
  earlier value on the first write and restore it.
- (F3) **Due 2026-09-27:** a good whose configuration breaks mid-life logs every minute for
  every pending key, never refunds unapplied purchases and never cleans ended ones. Report it
  once per good and handle the refund.
- (F4b) **Due 2026-09-27:** a clan role whose positioning failed stays at the bottom until the
  owner renames the clan, because placement runs only at creation and on rename. Convergence
  should re-place a role that is below its anchor.
- (F4) **Before go-live, measured on the test server:**
  - the clan role's position under the anchor after a creation, a rename and a moved anchor;
  - what Embed Links actually covers for GIFs.
