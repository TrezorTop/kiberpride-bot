// One firing test per hand-written constraint of the init migration (decision 003): the partial
// unique indexes and CHECKs Prisma cannot express. Each asserts WHICH constraint fired, so a test
// that passes because of an unrelated error (a missing column, a foreign key) is not possible.
// Plain `pg` here, not Prisma: its DatabaseError carries `code` and `constraint` directly.
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from './env.js';

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
afterAll(() => pool.end());

const UNIQUE = '23505';
const CHECK = '23514';
const USER = '300000000000000001';

async function sql(text: string, values: unknown[] = []): Promise<void> {
  await pool.query(text, values);
}

/** Runs the statement and returns what Postgres refused it with; fails the test if it succeeded. */
async function refusal(text: string, values: unknown[] = []): Promise<{ code: string; constraint: string | undefined }> {
  const error = await pool.query(text, values).then(
    () => null,
    (err: unknown) => err,
  );
  if (!(error instanceof pg.DatabaseError)) throw new Error(`expected a database refusal, got ${String(error)}`);
  return { code: error.code ?? '', constraint: error.constraint };
}

let gameId: number;
let goodId: number;

beforeEach(async () => {
  await sql(`INSERT INTO "User" ("id") VALUES ($1)`, [USER]);
  const game = await pool.query<{ id: number }>(
    `INSERT INTO "Game" ("slug", "name", "emoji", "defaultTeamSize") VALUES ('cs2', 'CS2', '🎮', 5) RETURNING "id"`,
  );
  gameId = game.rows[0]!.id;
  const good = await pool.query<{ id: number }>(
    `INSERT INTO "ShopGood" ("slug", "name", "description", "price", "kind", "config")
     VALUES ('gif', 'Доступ к GIF', 'GIF в чате', 500, 'discord_permission', '{}') RETURNING "id"`,
  );
  goodId = good.rows[0]!.id;
});

const insertPurchase = (status: string) =>
  `INSERT INTO "Purchase" ("userId", "goodId", "pricePaid", "status") VALUES ('${USER}', $1, 500, '${status}')`;

const insertMatch = `
  INSERT INTO "Match" ("gameId", "title", "teamSize", "capacity", "participantCount", "teamMode",
                       "createdById", "recruitChannelId", "voiceCategoryId", "rewards")
  VALUES ($1, 'Матч', $2, $3, $4, 'AUTO', '${USER}', '1', '2', '{}')`;

describe('Purchase_one_active_per_user_good', () => {
  it('refuses a second ACTIVE purchase of the same good by the same user', async () => {
    await sql(insertPurchase('ACTIVE'), [goodId]);
    expect(await refusal(insertPurchase('ACTIVE'), [goodId])).toEqual({ code: UNIQUE, constraint: 'Purchase_one_active_per_user_good' });
  });

  it('allows an ACTIVE purchase next to an EXPIRED one', async () => {
    await sql(insertPurchase('EXPIRED'), [goodId]);
    await sql(insertPurchase('ACTIVE'), [goodId]);
    const count = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM "Purchase"`);
    expect(count.rows[0]!.n).toBe('2');
  });
});

describe('RewardRule_event_default_key', () => {
  it('refuses a second default rule (gameId NULL) for the same event', async () => {
    await sql(`INSERT INTO "RewardRule" ("event", "gameId", "amount") VALUES ('WIN', NULL, 100)`);
    expect(await refusal(`INSERT INTO "RewardRule" ("event", "gameId", "amount") VALUES ('WIN', NULL, 150)`)).toEqual({
      code: UNIQUE,
      constraint: 'RewardRule_event_default_key',
    });
  });
});

describe('RewardRule_amount_nonnegative (decision 008 §11)', () => {
  it('refuses a negative reward, which would debit players at finish', async () => {
    expect(await refusal(`INSERT INTO "RewardRule" ("event", "gameId", "amount") VALUES ('WIN', NULL, -1)`)).toEqual({
      code: CHECK,
      constraint: 'RewardRule_amount_nonnegative',
    });
  });

  it('accepts 0 (a draw that pays nothing extra)', async () => {
    await sql(`INSERT INTO "RewardRule" ("event", "gameId", "amount") VALUES ('DRAW', NULL, 0)`);
  });
});

describe('GuildSettings_recruitTimeoutHours_nonnegative (decision 009 §5)', () => {
  it('defaults to 3 hours and refuses a negative timeout', async () => {
    const row = await pool.query<{ h: number }>(`INSERT INTO "GuildSettings" ("id") VALUES (1) RETURNING "recruitTimeoutHours" AS h`);
    expect(row.rows[0]!.h).toBe(3);
    expect(await refusal(`UPDATE "GuildSettings" SET "recruitTimeoutHours" = -1 WHERE "id" = 1`)).toEqual({
      code: CHECK,
      constraint: 'GuildSettings_recruitTimeoutHours_nonnegative',
    });
  });
});

describe('KpTransaction_amount_nonzero', () => {
  it('refuses a ledger row of 0 KP', async () => {
    const zero = `INSERT INTO "KpTransaction" ("userId", "amount", "balanceAfter", "kind", "reference", "description")
                  VALUES ('${USER}', 0, 0, 'ADMIN_ADJUST', 'admin:zero', 'ноль')`;
    expect(await refusal(zero)).toEqual({ code: CHECK, constraint: 'KpTransaction_amount_nonzero' });
  });
});

describe('ShopGood_price_positive', () => {
  it('refuses a good priced at 0 KP', async () => {
    const free = `INSERT INTO "ShopGood" ("slug", "name", "description", "price", "kind", "config")
                  VALUES ('free', 'Даром', 'даром', 0, 'discord_permission', '{}')`;
    expect(await refusal(free)).toEqual({ code: CHECK, constraint: 'ShopGood_price_positive' });
  });
});

// ─── Shop and earnings (decision 014 §8) ───────────────────────────────────

describe('Purchase_periods_positive', () => {
  it('refuses a purchase with no paid period', async () => {
    const zero = `INSERT INTO "Purchase" ("userId", "goodId", "pricePaid", "periods") VALUES ('${USER}', $1, 500, 0)`;
    expect(await refusal(zero, [goodId])).toEqual({ code: CHECK, constraint: 'Purchase_periods_positive' });
  });
});

describe('GuildSettings earnings CHECKs', () => {
  it('defaults to 50 / 10 / 60 and refuses a negative amount in each column', async () => {
    const row = await pool.query<{ d: number; v: number; c: number }>(
      `INSERT INTO "GuildSettings" ("id") VALUES (1) RETURNING "dailyBonusAmount" AS d, "voiceKpPerHour" AS v, "voiceDailyCapKp" AS c`,
    );
    expect(row.rows[0]).toEqual({ d: 50, v: 10, c: 60 });
    for (const column of ['dailyBonusAmount', 'voiceKpPerHour', 'voiceDailyCapKp']) {
      expect(await refusal(`UPDATE "GuildSettings" SET "${column}" = -1 WHERE "id" = 1`)).toEqual({
        code: CHECK,
        constraint: `GuildSettings_${column}_nonnegative`,
      });
    }
  });
});

describe('Clan constraints', () => {
  const purchase = async () =>
    (await pool.query<{ id: number }>(`INSERT INTO "Purchase" ("userId", "goodId", "pricePaid") VALUES ('${USER}', $1, 500) RETURNING "id"`, [goodId])).rows[0]!.id;
  const clan = (purchaseId: number, name: string, extra = '', extraValue = '') =>
    `INSERT INTO "Clan" ("purchaseId", "ownerId", "name", "color"${extra}) VALUES (${purchaseId}, '${USER}', '${name}', 0${extraValue})`;

  it('Clan_memberCount_range: refuses more than 25 members', async () => {
    expect(await refusal(clan(await purchase(), 'Волки', ', "memberCount"', ', 26'))).toEqual({ code: CHECK, constraint: 'Clan_memberCount_range' });
  });

  it('Clan_open_name_key: two open clans cannot share a name in any case; a closed one frees it', async () => {
    const first = await purchase();
    await sql(`UPDATE "Purchase" SET "status" = 'EXPIRED' WHERE "id" = ${first}`);
    await sql(clan(first, 'Волки'));
    const second = await purchase();
    expect(await refusal(clan(second, 'ВОЛКИ'))).toEqual({ code: UNIQUE, constraint: 'Clan_open_name_key' });
    await sql(`UPDATE "Clan" SET "closedAt" = now() WHERE "purchaseId" = ${first}`);
    await sql(clan(second, 'ВОЛКИ'));
  });
});

describe('PersonalRoom CHECKs', () => {
  const room = async (column: string, value: number) => {
    const p = (await pool.query<{ id: number }>(`INSERT INTO "Purchase" ("userId", "goodId", "pricePaid") VALUES ('${USER}', $1, 500) RETURNING "id"`, [goodId])).rows[0]!.id;
    return refusal(`INSERT INTO "PersonalRoom" ("purchaseId", "ownerId", "name", "${column}") VALUES (${p}, '${USER}', 'Комната', ${value})`);
  };

  it('PersonalRoom_userLimit_range: refuses a limit over 99', async () => {
    expect(await room('userLimit', 100)).toEqual({ code: CHECK, constraint: 'PersonalRoom_userLimit_range' });
  });

  it('PersonalRoom_guestCount_range: refuses more than 25 guests', async () => {
    expect(await room('guestCount', 26)).toEqual({ code: CHECK, constraint: 'PersonalRoom_guestCount_range' });
  });
});

describe('VoiceDay CHECKs', () => {
  it('refuses negative minutes and negative paid hours', async () => {
    const insert = (minutes: number, hours: number) =>
      `INSERT INTO "VoiceDay" ("userId", "day", "minutes", "paidHours", "lastTickAt") VALUES ('${USER}', '2026-09-20', ${minutes}, ${hours}, now())`;
    expect(await refusal(insert(-1, 0))).toEqual({ code: CHECK, constraint: 'VoiceDay_minutes_nonnegative' });
    expect(await refusal(insert(0, -1))).toEqual({ code: CHECK, constraint: 'VoiceDay_paidHours_nonnegative' });
  });
});

describe('Match CHECKs', () => {
  it('accepts a well-formed 5×5 match (the baseline the refusals below differ from)', async () => {
    await sql(insertMatch, [gameId, 5, 10, 10]);
  });

  it('Match_teamSize_range: refuses a team of 11', async () => {
    expect(await refusal(insertMatch, [gameId, 11, 22, 0])).toEqual({ code: CHECK, constraint: 'Match_teamSize_range' });
  });

  it('Match_capacity_twice_teamSize: refuses capacity other than 2 × teamSize', async () => {
    expect(await refusal(insertMatch, [gameId, 5, 9, 0])).toEqual({ code: CHECK, constraint: 'Match_capacity_twice_teamSize' });
  });

  it('Match_participantCount_range: refuses more participants than capacity', async () => {
    expect(await refusal(insertMatch, [gameId, 5, 10, 11])).toEqual({ code: CHECK, constraint: 'Match_participantCount_range' });
  });
});
