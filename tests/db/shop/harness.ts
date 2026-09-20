// Wiring for the shop db tests: the real shop, clan, room and economy services on the test
// database, a fake gateway, a recording logger, a movable clock, three configured goods, and the
// money invariant every test re-checks (decision 014 Consequences: sum(ledger) = balance).
import { expect } from 'vitest';
import { createEconomyService, TxKind, type EconomyService } from '../../../src/modules/economy/service.js';
import { createPermissionsService, dbPermissionSources, type MemberFacts } from '../../../src/modules/permissions/service.js';
import { createClanService, type ClanService } from '../../../src/modules/shop/clan.js';
import type { ChannelPermissionConfig } from '../../../src/modules/shop/kinds/channelPermission.js';
import { DEFAULT_CLAN_PALETTE, DEFAULT_FORBIDDEN_WORDS, type ClanRoleConfig } from '../../../src/modules/shop/kinds/clanRole.js';
import type { PersonalRoomConfig } from '../../../src/modules/shop/kinds/personalRoom.js';
import { createRoomService, type RoomService } from '../../../src/modules/shop/room.js';
import { createShopService, type ShopService } from '../../../src/modules/shop/service.js';
import { FakeGateway } from '../../fakes/gateway.js';
import { testDb } from '../helpers.js';
import { recordingLogging, TestClock } from '../matches/harness.js';

export const ACCESS_CHANNEL_A = '700000000000000001';
export const ACCESS_CHANNEL_B = '700000000000000002';
export const ROOM_CATEGORY = '700000000000000010';
export const ANCHOR_ROLE = '700000000000000020';
export const ADMIN: MemberFacts = { userId: '100000000000000009', roleIds: [], isGuildOwner: false, isAdministrator: true };

/** Real-looking buyer ids, 18 digits; ascending with k. */
export const buyer = (k: number) => `4${String(k).padStart(17, '0')}`;

export interface ShopHarness {
  shop: ShopService;
  clans: ClanService;
  rooms: RoomService;
  economy: EconomyService;
  gateway: FakeGateway;
  logging: ReturnType<typeof recordingLogging>;
  clock: TestClock;
  goods: { media: number; clan: number; room: number };
  /** A fresh service on the same database and gateway: «the bot restarted». */
  restart(nodeEnv?: string): ShopService;
}

export async function shopHarness(opts: { maxMembers?: number; applyWaitMs?: number; nodeEnv?: string } = {}): Promise<ShopHarness> {
  const db = testDb();
  const gateway = new FakeGateway();
  gateway.accessChannels.set(ACCESS_CHANNEL_A, { everyoneHas: true, otherRoleIds: [], missing: [] });
  gateway.accessChannels.set(ACCESS_CHANNEL_B, { everyoneHas: true, otherRoleIds: [], missing: [] });
  gateway.extraRoles.add(ANCHOR_ROLE);

  const media: ChannelPermissionConfig = { permissions: ['AttachFiles', 'EmbedLinks'], channelIds: [ACCESS_CHANNEL_A], roleId: null };
  const clan: ClanRoleConfig = { maxMembers: opts.maxMembers ?? 10, forbiddenWords: DEFAULT_FORBIDDEN_WORDS, palette: DEFAULT_CLAN_PALETTE, anchorRoleId: ANCHOR_ROLE };
  const room: PersonalRoomConfig = { categoryId: ROOM_CATEGORY };
  const created = await Promise.all([
    db.shopGood.create({ data: { slug: 'media_access', name: 'Доступ к картинкам и GIF', description: 'картинки', price: 5000, kind: 'channel_permission', config: media, validityDays: 30, enabled: true, sortOrder: 10 } }),
    db.shopGood.create({ data: { slug: 'clan_role', name: 'Клановая роль', description: 'клан', price: 15000, kind: 'clan_role', config: clan, validityDays: 30, enabled: true, sortOrder: 20 } }),
    db.shopGood.create({ data: { slug: 'personal_room', name: 'Личная комната', description: 'комната', price: 10000, kind: 'personal_room', config: room, validityDays: 30, enabled: true, sortOrder: 30 } }),
  ]);

  const logging = recordingLogging();
  const clock = new TestClock(new Date('2026-09-20T12:00:00Z'));
  const economy = createEconomyService(db);
  const permissions = createPermissionsService(dbPermissionSources(db));
  const make = (nodeEnv = opts.nodeEnv ?? 'test') =>
    createShopService({ db, economy, permissions, logging, gateway, nodeEnv, clock, applyWaitMs: opts.applyWaitMs ?? 5_000 });
  const shop = make();
  // The media good's role exists from its first validate, as after «✅ Включить» (014 §7).
  const [mediaView] = (await shop.adminList(ADMIN)).filter((v) => v.good.kind === 'channel_permission');
  if (mediaView) await shop.configure(ADMIN, mediaView.good.id, { channelIds: [ACCESS_CHANNEL_A] });

  return {
    shop,
    clans: createClanService({ db, shop, logging, gateway, clock }),
    rooms: createRoomService({ db, shop, logging, gateway, clock }),
    economy,
    gateway,
    logging,
    clock,
    goods: { media: created[0].id, clan: created[1].id, room: created[2].id },
    restart: make,
  };
}

/** Gives a player KP through the ledger (never a raw balance write). */
export async function fund(h: ShopHarness, userId: string, amount: number, tag = 'seed'): Promise<void> {
  await h.economy.move({ userId, amount, kind: TxKind.ADMIN_ADJUST, reference: `admin:${tag}:${userId}`, description: 'тестовое начисление' });
}

export async function mediaRoleId(h: ShopHarness): Promise<string | null> {
  const good = await testDb().shopGood.findUniqueOrThrow({ where: { id: h.goods.media } });
  return (good.config as { roleId: string | null }).roleId;
}

export async function balanceOf(userId: string): Promise<number> {
  return (await testDb().user.findUnique({ where: { id: userId } }))?.balance ?? 0;
}

/**
 * sum(ledger) = balance for every user; memberCount = count(ClanMember) for every clan;
 * guestCount = count(RoomGuest) for every room; at most one ACTIVE purchase per (user, good).
 */
export async function expectShopInvariants(): Promise<void> {
  const db = testDb();
  const drift = await db.$queryRaw<{ id: string; balance: number; ledger: bigint | null }[]>`
    SELECT u."id", u."balance", (SELECT sum(t."amount") FROM "KpTransaction" t WHERE t."userId" = u."id") AS ledger FROM "User" u`;
  for (const d of drift) expect({ user: d.id, balance: d.balance }).toEqual({ user: d.id, balance: Number(d.ledger ?? 0) });

  const clans = await db.$queryRaw<{ id: number; memberCount: number; rows: bigint }[]>`
    SELECT c."id", c."memberCount", count(m."id") AS rows FROM "Clan" c LEFT JOIN "ClanMember" m ON m."clanId" = c."id" GROUP BY c."id"`;
  for (const c of clans) expect({ clan: c.id, count: c.memberCount }).toEqual({ clan: c.id, count: Number(c.rows) });

  const rooms = await db.$queryRaw<{ id: number; guestCount: number; rows: bigint }[]>`
    SELECT r."id", r."guestCount", count(g."id") AS rows FROM "PersonalRoom" r LEFT JOIN "RoomGuest" g ON g."roomId" = r."id" GROUP BY r."id"`;
  for (const r of rooms) expect({ room: r.id, count: r.guestCount }).toEqual({ room: r.id, count: Number(r.rows) });

  // Every paid period is exactly one ledger row: pricePaid = -sum(purchase rows of that purchase).
  const paid = await db.$queryRaw<{ id: number; pricePaid: number; status: string; charged: bigint | null; refunded: bigint | null }[]>`
    SELECT p."id", p."pricePaid", p."status"::text AS status,
      (SELECT -sum(t."amount") FROM "KpTransaction" t WHERE t."purchaseId" = p."id" AND t."kind" = 'PURCHASE') AS charged,
      (SELECT sum(t."amount") FROM "KpTransaction" t WHERE t."purchaseId" = p."id" AND t."kind" = 'REFUND') AS refunded
    FROM "Purchase" p`;
  for (const p of paid) {
    expect({ purchase: p.id, charged: Number(p.charged ?? 0) }).toEqual({ purchase: p.id, charged: p.pricePaid });
    // A refund is all of it or none of it, and it happens at most once: `refund:<id>` is unique.
    // REFUNDED always gave the money back (014 §2); REVOKED gave it back only if the
    // administrator chose to (decision 023 §1); every other status never did.
    const refunded = Number(p.refunded ?? 0);
    const allowed = p.status === 'REFUNDED' ? [p.pricePaid] : p.status === 'REVOKED' ? [0, p.pricePaid] : [0];
    expect({ purchase: p.id, status: p.status, refunded }).toEqual({ purchase: p.id, status: p.status, refunded: allowed.includes(refunded) ? refunded : allowed[0] });
  }
}

export function codes(results: PromiseSettledResult<unknown>[]): (string | null)[] {
  return results.map((r) => (r.status === 'fulfilled' ? null : ((r.reason as { code?: string }).code ?? String(r.reason))));
}

export const DAY = 86_400_000;
