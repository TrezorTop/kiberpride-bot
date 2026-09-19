# shop — goods and purchases

- **Owns:** `ShopGood` and `Purchase` (a purchase and its grant are one row, decision 003 §5–6).
- **Interface:** `ShopService` in `service.ts` — `listEnabled`, `buy` (interface only; not built yet).
- **Extension point:** the kind registry `kinds/index.ts` — a new kind of good is one file plus one line (decision 002 §5).
- **Invariant:** partial unique index `(userId, goodId) WHERE status = 'ACTIVE'`; KP moves only through `economy.move` with `purchase:<id>`.
- **Depends on:** `economy`, `permissions`, `settings`, `logging`.
