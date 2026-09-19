// The shop kind registry (decision 002 §5): a new kind of good is one file in this folder plus
// one line in `kinds`. At startup a good whose kind is unknown or whose config fails
// `configSchema` is disabled and logged. Empty until the shop step.
import type { z } from 'zod';
import type { GuildGateway } from '../../../core/ports.js';

export interface GoodRecord {
  id: number;
  kind: string;
  config: unknown;
}

export interface PurchaseRecord {
  id: number;
  userId: string;
  goodId: number;
}

export interface KindHandler<C = unknown> {
  configSchema: z.ZodType<C>;
  /** Called when a good is enabled and at startup; throws with a reason if unusable. */
  validate(good: GoodRecord, gateway: GuildGateway): Promise<void>;
  /** Idempotent: applying twice leaves the same Discord state. */
  apply(purchase: PurchaseRecord, gateway: GuildGateway): Promise<void>;
  /** Idempotent. */
  revoke(purchase: PurchaseRecord, gateway: GuildGateway): Promise<void>;
  /** One line for the shop view, in the player's language. */
  describe(good: GoodRecord): string;
}

export const kinds: Readonly<Record<string, KindHandler>> = {};
