// The kind handler contract (decision 014 §3, replaces 002 §5). A handler never runs per
// purchase in isolation: the shop service converges one (user, good) key at a time (014 §2), so
// apply and revoke are idempotent and a shared resource is never taken back while another ACTIVE
// row still pays for it. The registry itself is ./index.ts.
import { z } from 'zod';
import type { GuildGateway } from '../../../core/ports.js';

export interface GoodRecord<C = unknown> {
  id: number;
  slug: string;
  name: string;
  description: string;
  price: number;
  kind: string;
  config: C;
  /** null = forever, and then there is no renewal (014 §1). */
  validityDays: number | null;
  enabled: boolean;
}

/**
 * Something that stops a good from working, or a warning about it. The Discord layer turns the
 * code into plain Russian for the admin (views/shop.ts); never shown to players.
 */
export interface Problem {
  code: ProblemCode;
  channelId?: string;
  roleIds?: string[];
  missing?: string[];
}

export type ProblemCode =
  | 'unknown_kind'
  | 'bad_config'
  | 'no_manage_roles'
  | 'role_missing'
  | 'role_above_bot'
  | 'no_channels'
  | 'channel_missing'
  | 'channel_perms'
  | 'everyone_has'
  | 'other_role_allows'
  | 'too_many_roles'
  | 'anchor_missing'
  | 'anchor_gone'
  | 'anchor_above_bot'
  | 'no_category'
  | 'category_missing'
  | 'category_perms'
  | 'category_full';

export interface ValidateResult {
  problems: Problem[];
  /** Shown to the admin, never block enabling. */
  warnings: Problem[];
}

/** One grant as a handler needs it: the purchase plus the kind's own rows. */
export interface GrantState {
  purchaseId: number;
  userId: string;
  goodId: number;
  clan: { id: number; name: string; color: number; roleId: string | null; ownerId: string; memberIds: string[] } | null;
  room: { id: number; name: string; channelId: string | null; userLimit: number; locked: boolean; ownerId: string; guestIds: string[] } | null;
}

/** What a handler may touch: the gateway and the few writes that store Discord ids. */
export interface KindEnv {
  gateway: GuildGateway;
  saveGoodConfig(goodId: number, patch: Record<string, unknown>): Promise<void>;
  saveClanRole(clanId: number, roleId: string): Promise<void>;
  saveRoomChannel(roomId: number, channelId: string): Promise<void>;
  /** Channel ids held by every other room: never adopted by name. */
  claimedRoomChannels(exceptRoomId: number): Promise<string[]>;
}

export interface KindHandler<C> {
  configSchema: z.ZodType<C>;
  /** The config keys the shop settings screen may change (014 §7). */
  settable: readonly (keyof C & string)[];
  /** One Discord resource serves every row of a (user, good) key: an ACTIVE row keeps it. */
  sharedResource: boolean;
  /** When a good is enabled, when its settings are saved, and at startup. May repair Discord. */
  validate(good: GoodRecord<C>, env: KindEnv): Promise<ValidateResult>;
  /** Cached checks before any money moves; a problem refuses the purchase (014 §2). */
  precheck(good: GoodRecord<C>, env: KindEnv): Promise<Problem[]>;
  /** `absent` = the buyer is not on the server; the grant is not applied yet. */
  apply(grant: GrantState, good: GoodRecord<C>, env: KindEnv): Promise<'applied' | 'absent'>;
  revoke(grant: GrantState, good: GoodRecord<C>, env: KindEnv): Promise<void>;
  /** One line for the shop view, in the player's language. */
  describe(good: GoodRecord<C>): string;
}

/** A handler bound to one good whose config has been parsed. */
export interface BoundKind {
  sharedResource: boolean;
  settable: readonly string[];
  validate(env: KindEnv): Promise<ValidateResult>;
  precheck(env: KindEnv): Promise<Problem[]>;
  apply(grant: GrantState, env: KindEnv): Promise<'applied' | 'absent'>;
  revoke(grant: GrantState, env: KindEnv): Promise<void>;
  describe(): string;
  /** The parsed config merged with a settings patch, or null when the result is invalid. */
  withPatch(patch: Record<string, unknown>): Record<string, unknown> | null;
  config: Record<string, unknown>;
}

export interface KindEntry {
  bind(good: GoodRecord): BoundKind | null;
}

/** Wraps a typed handler so the registry can hold every kind without `any`. */
export function defineKind<C extends Record<string, unknown>>(handler: KindHandler<C>): KindEntry {
  return {
    bind(good) {
      const parsed = handler.configSchema.safeParse(good.config);
      if (!parsed.success) return null;
      const typed: GoodRecord<C> = { ...good, config: parsed.data };
      return {
        sharedResource: handler.sharedResource,
        settable: handler.settable,
        validate: (env) => handler.validate(typed, env),
        precheck: (env) => handler.precheck(typed, env),
        apply: (grant, env) => handler.apply(grant, typed, env),
        revoke: (grant, env) => handler.revoke(grant, typed, env),
        describe: () => handler.describe(typed),
        withPatch(patch) {
          const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => (handler.settable as readonly string[]).includes(k)));
          const merged = handler.configSchema.safeParse({ ...parsed.data, ...allowed });
          return merged.success ? merged.data : null;
        },
        config: parsed.data,
      };
    },
  };
}

export const snowflake = z.string().regex(/^\d{17,20}$/);
