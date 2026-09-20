// The shop screens (decision 014 §10): one brand colour on every embed (decision 012), every
// component id decodes to a route that exists, and the texts that carry a guarantee say it.
import type { ActionRowBuilder, EmbedBuilder, MessageActionRowComponentBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { GoodAdminView, GrantByAdminResult, GrantView, Quote, RevokeItem, ShopOverview } from '../../modules/shop/service.js';
import { DEFAULT_CLAN_PALETTE } from '../../modules/shop/kinds/clanRole.js';
import { buttons } from '../buttons/index.js';
import { decodeCustomId } from '../customId.js';
import { modals } from '../modals/index.js';
import { selects } from '../selects/index.js';
import { domainErrorText } from './messages.js';
import { profileView } from './profile.js';
import {
  buyResultView,
  clanModal,
  clanPanelView,
  dailyClaimedEmbed,
  grantClanPromptView,
  grantGoodResultView,
  grantStateText,
  historyView,
  noRoomView,
  playerNoticeEmbed,
  purchasesView,
  quoteView,
  revokeConfirmView,
  revokeListView,
  revokeResultView,
  roomNameModal,
  roomPanelView,
  shopSettingsView,
  shopView,
} from './shop.js';
import { BRAND_COLOR } from './style.js';

const NOW = new Date('2026-09-20T12:00:00Z');
const DAY = 86_400_000;
const U = '300000000000000001';
const names = new Map([[U, 'Вася']]);

const grant = (over: Partial<GrantView> = {}): GrantView => ({
  purchaseId: 5,
  goodId: 1,
  goodName: 'Доступ к картинкам и GIF',
  kind: 'channel_permission',
  periods: 1,
  grantedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 10 * DAY),
  applied: true,
  ...over,
});
const revokeItem = (over: Partial<RevokeItem> = {}): RevokeItem => ({
  purchaseId: 5,
  goodId: 1,
  goodName: 'Доступ к картинкам и GIF',
  kind: 'channel_permission',
  periods: 1,
  pricePaid: 5000,
  expiresAt: new Date(NOW.getTime() + 10 * DAY),
  applied: true,
  ...over,
});
const offer = { id: 1, slug: 'media_access', name: 'Доступ к картинкам и GIF', description: 'd', price: 5000, kind: 'channel_permission', validityDays: 30, line: 'Картинки, файлы и GIF' };
const grantResult = (over: Partial<GrantByAdminResult> = {}): GrantByAdminResult => ({
  purchaseId: 7,
  userId: U,
  goodName: 'Доступ к картинкам и GIF',
  kind: 'channel_permission',
  days: 30,
  periods: 1,
  extended: false,
  expiresAt: new Date(NOW.getTime() + 30 * DAY),
  applied: true,
  notified: true,
  ...over,
});
const quote = (over: Partial<Quote> = {}): Quote => ({
  good: offer,
  mode: 'new',
  price: 5000,
  balance: 8000,
  shortBy: 0,
  expectedPeriods: 0,
  expiresAt: new Date(NOW.getTime() + 30 * DAY),
  current: null,
  clanForm: false,
  palette: null,
  ...over,
});
const clan = { clanId: 1, purchaseId: 2, goodId: 2, name: 'Волки', color: 0xe74c3c, colorLabel: 'Красный', ownerId: U, memberIds: [U.replace(/1$/, '2')], maxMembers: 10, expiresAt: new Date(NOW.getTime() + 5 * DAY), applied: true, isOwner: true, palette: DEFAULT_CLAN_PALETTE };
const room = {
  roomId: 1,
  purchaseId: 3,
  goodId: 3,
  ownerId: U,
  name: 'Штаб',
  channelId: '500000000000000009',
  userLimit: 5,
  locked: true,
  guestIds: [U],
  expiresAt: new Date(NOW.getTime() + 5 * DAY),
  applied: true,
};
const admin = (kind: string, config: Record<string, unknown>, enabled = false): GoodAdminView => ({
  good: { id: kind === 'channel_permission' ? 1 : kind === 'clan_role' ? 2 : 3, slug: kind, name: kind, description: '', price: 5000, kind, config, validityDays: 30, enabled },
  line: '',
  problems: enabled ? [] : [{ code: 'no_channels' }],
  warnings: [],
});

type Rows = ActionRowBuilder<MessageActionRowComponentBuilder>[];
const views: [string, { embeds: EmbedBuilder[]; components: Rows }][] = [
  ['shop', shopView({ balance: 8000, goods: [{ ...offer, grant: grant() }], grants: [grant()], inClan: true, hasRoom: true } satisfies ShopOverview, NOW)],
  ['shop empty', shopView({ balance: 0, goods: [], grants: [], inClan: false, hasRoom: false }, NOW)],
  ['quote new', quoteView(quote())],
  ['quote renew', quoteView(quote({ mode: 'renew', expectedPeriods: 2, current: grant() }))],
  ['quote short', quoteView(quote({ balance: 1000, shortBy: 4000 }))],
  ['quote pending', quoteView(quote({ mode: 'pending', current: grant({ applied: false }) }))],
  ['quote clan', quoteView(quote({ clanForm: true, palette: DEFAULT_CLAN_PALETTE }))],
  ['bought', buyResultView({ purchaseId: 5, goodName: 'Клановая роль', kind: 'clan_role', periods: 1, renewed: false, expiresAt: NOW, applied: false, balanceAfter: 0 })],
  ['clan owner', clanPanelView(clan, names, NOW)],
  ['clan member', clanPanelView({ ...clan, isOwner: false }, names, NOW)],
  ['room', roomPanelView(room, names, NOW, { note: 'заметка', viewerId: U })],
  ['room seen by an administrator', roomPanelView(room, names, NOW, { viewerId: '300000000000000099' })],
  ['purchases dev', purchasesView([grant()], NOW, { dev: true })],
  ['history', historyView(U, { entries: [{ id: 1, userId: U, amount: 50, balanceAfter: 50, kind: 'DAILY_BONUS', reference: 'x', description: 'ежедневный бонус', createdAt: NOW }], page: 2, pages: 3, total: 23 }, true)],
  [
    'shop settings',
    shopSettingsView(
      [admin('channel_permission', { channelIds: ['500000000000000001'] }), admin('clan_role', { anchorRoleId: null }), admin('personal_room', { categoryId: null }, true)],
      2,
    ),
  ],
  ['profile', profileView({ userId: U, displayName: 'Вася', avatarUrl: null, balance: 10, recent: [], grants: [grant()], dailyLine: '🎁', clan: 'owner', hasRoom: true, devNonce: 'abcdef123456', now: NOW })],
  [
    'notices',
    {
      embeds: [
        dailyClaimedEmbed(50, 150, NOW),
        playerNoticeEmbed({ kind: 'grant_expiring', goodName: 'X', expiresAt: NOW }),
        playerNoticeEmbed({ kind: 'grant_refunded', goodName: 'X', amount: 5000 }),
        playerNoticeEmbed({ kind: 'grant_revoked', goodName: 'X', amount: null }),
        playerNoticeEmbed({ kind: 'grant_revoked', goodName: 'X', amount: 5000 }),
      ],
      components: [],
    },
  ],
  ['revoke list', revokeListView(U, [revokeItem()])],
  ['revoke confirm, gifted', revokeConfirmView(U, revokeItem({ pricePaid: 0 }))],
  [
    'revoke done, gifted',
    revokeResultView({ purchaseId: 5, userId: U, goodName: 'Личная комната', kind: 'personal_room', refunded: 0, balanceAfter: null, cleaned: true, notified: true }),
  ],
  ['grant clan prompt', grantClanPromptView({ goodId: 2, goodName: 'Клановая роль', userId: U, days: 30 })],
  ['grant done', grantGoodResultView(grantResult())],
  ['grant extended, private messages closed', grantGoodResultView(grantResult({ extended: true, applied: false, notified: false }))],
  ['no room', noRoomView(U)],
  ['revoke list empty', revokeListView(U, [])],
  ['revoke confirm', revokeConfirmView(U, revokeItem({ periods: 3, pricePaid: 15_000 }))],
  ['revoke done', revokeResultView({ purchaseId: 5, userId: U, goodName: 'Доступ к картинкам и GIF', kind: 'channel_permission', refunded: 5000, balanceAfter: 6000, cleaned: true, notified: true })],
  [
    'revoke done, private messages closed',
    revokeResultView({ purchaseId: 5, userId: U, goodName: 'Клановая роль', kind: 'clan_role', refunded: null, balanceAfter: null, cleaned: true, notified: false }),
  ],
];

describe('shop views', () => {
  it.each(views)('%s: every embed is in the brand colour (decision 012)', (_name, view) => {
    expect(view.embeds.length).toBeGreaterThan(0);
    for (const e of view.embeds) expect(e.toJSON().color).toBe(BRAND_COLOR);
  });

  it.each(views)('%s: every component id decodes to a registered route, at most 5 rows', (_name, view) => {
    expect(view.components.length).toBeLessThanOrEqual(5);
    for (const row of view.components) {
      for (const c of row.toJSON().components) {
        const decoded = decodeCustomId((c as { custom_id?: string }).custom_id ?? '');
        expect(decoded).not.toBeNull();
        const action = decoded?.action ?? '';
        expect(buttons.has(action) || selects.has(action)).toBe(true);
      }
    }
  });

  it('the modals submit to registered routes', () => {
    const forms = [
      clanModal(DEFAULT_CLAN_PALETTE, { goodId: 2 }),
      clanModal(DEFAULT_CLAN_PALETTE, { goodId: 2, userId: U, days: 30 }),
      clanModal(DEFAULT_CLAN_PALETTE, { rename: true }, { name: 'А', color: 0 }),
      roomNameModal(1, 'Штаб'),
    ];
    for (const modal of forms) {
      const decoded = decodeCustomId(modal.toJSON().custom_id);
      expect(modals.has(decoded?.action ?? '')).toBe(true);
    }
  });

  it('shows «⏳ заканчивается» within a day of the end, «⏳ выдаётся» before it is applied (015 §1)', () => {
    expect(grantStateText(grant({ expiresAt: new Date(NOW.getTime() + DAY - 1000) }), NOW)).toMatch(/^⏳ заканчивается <t:\d+:R>$/);
    expect(grantStateText(grant(), NOW)).toMatch(/^✅ до <t:\d+:D>$/);
    expect(grantStateText(grant({ applied: false }), NOW)).toBe('⏳ выдаётся');
  });

  it('a player who is short sees a disabled button and by how much', () => {
    const view = quoteView(quote({ balance: 1000, shortBy: 4000 }));
    expect(view.embeds[0]?.toJSON().description).toContain('не хватает **4 000 KP Coin**');
    expect((view.components[0]?.toJSON().components[0] as { disabled?: boolean }).disabled).toBe(true);
  });

  it('a renewal carries the expected period count, never an amount (014 §1)', () => {
    const view = quoteView(quote({ mode: 'renew', expectedPeriods: 2, current: grant() }));
    const id = (view.components[0]?.toJSON().components[0] as { custom_id?: string }).custom_id;
    expect(decodeCustomId(id ?? '')).toEqual({ action: 'shbuy', args: ['1', '2'] });
  });

  it('the dev buttons appear only when asked for', () => {
    const plain = profileView({ userId: U, displayName: 'Вася', avatarUrl: null, balance: 0, recent: [], devNonce: null });
    const ids = plain.components.flatMap((r) => r.toJSON().components.map((c) => (c as { custom_id?: string }).custom_id ?? ''));
    expect(ids.some((i) => i.startsWith('kp1:dtop'))).toBe(false);
    expect(purchasesView([grant()], NOW, { dev: false }).components).toEqual([]);
  });

  it('a player with nothing active gets a clear message and no select (023 §1)', () => {
    const view = revokeListView(U, []);
    expect(view.components).toEqual([]);
    expect(view.embeds[0]?.toJSON().description).toContain('нет активных покупок');
  });

  it('the list picks a purchase through a select that carries the player (023 §1)', () => {
    const view = revokeListView(U, [revokeItem()]);
    const select = view.components[0]?.toJSON().components[0] as { custom_id?: string; options?: { value: string }[] };
    expect(decodeCustomId(select.custom_id ?? '')).toEqual({ action: 'rvksel', args: [U] });
    expect(select.options?.map((o) => o.value)).toEqual(['5']);
  });

  it('both buttons carry the purchase and its period count as the guard, never an amount (002 §4, 023 §1)', () => {
    const ids = revokeConfirmView(U, revokeItem({ periods: 3, pricePaid: 15_000 }))
      .components[0]?.toJSON()
      .components.map((c) => (c as { custom_id?: string }).custom_id ?? '');
    expect(ids?.map((id) => decodeCustomId(id))).toEqual([
      { action: 'rvk', args: ['5', '3', '0'] },
      { action: 'rvk', args: ['5', '3', '1'] },
    ]);
    for (const id of ids ?? []) expect(id).not.toContain('15000');
  });

  it('a purchase nobody paid for never talks about «0 KP Coin» (023 F5, 024)', () => {
    const confirm = revokeConfirmView(U, revokeItem({ pricePaid: 0 }));
    expect(confirm.embeds[0]?.toJSON().description).toContain('возвращать нечего — товар был выдан вручную');
    expect(confirm.embeds[0]?.toJSON().description).not.toContain('0 KP Coin');
    // Nothing was paid, so the «вернуть монеты» choice is not offered at all.
    expect(confirm.components[0]?.toJSON().components).toHaveLength(1);
    expect(revokeListView(U, [revokeItem({ pricePaid: 0 })]).embeds[0]?.toJSON().description).toContain('выдан вручную');

    const done = revokeResultView({ purchaseId: 5, userId: U, goodName: 'X', kind: 'personal_room', refunded: 0, balanceAfter: null, cleaned: true, notified: true });
    expect(done.embeds[0]?.toJSON().description).toContain('Возвращать нечего — товар был выдан вручную.');
    expect(done.embeds[0]?.toJSON().description).not.toContain('0 KP Coin');
    expect(playerNoticeEmbed({ kind: 'grant_revoked', goodName: 'X', amount: 0 }).toJSON().description).not.toContain('0 KP Coin');
  });

  it('a hand-out says who got what, until when, and that nothing was paid (024 §1)', () => {
    const text = grantGoodResultView(grantResult()).embeds[0]?.toJSON().description ?? '';
    expect(text).toContain(`<@${U}>`);
    expect(text).toContain('30 дн.');
    expect(text).toContain('KP Coin с игрока не списаны');
    expect(grantGoodResultView(grantResult({ notified: false })).embeds[0]?.toJSON().description).toContain('закрыта личка');
    expect(grantGoodResultView(grantResult({ extended: true })).embeds[0]?.toJSON().title).toBe('🎁 Срок продлён');
    expect(playerNoticeEmbed({ kind: 'grant_gifted', goodName: 'X', expiresAt: NOW, extended: false }).toJSON().description).toContain('не списывались');
  });

  it('the clan hand-out form carries the player and the days, never a name (002 §4, 024 §1)', () => {
    const id = (grantClanPromptView({ goodId: 2, goodName: 'Клановая роль', userId: U, days: 45 }).components[0]?.toJSON().components[0] as { custom_id?: string }).custom_id;
    expect(decodeCustomId(id ?? '')).toEqual({ action: 'shgcn', args: ['2', U, '45'] });
    expect(decodeCustomId(clanModal(DEFAULT_CLAN_PALETTE, { goodId: 2, userId: U, days: 45 }).toJSON().custom_id)).toEqual({ action: 'shgcl', args: ['2', U, '45'] });
  });

  it('every button of a room panel carries the room, so an administrator presses on the right one (024 §4)', () => {
    const view = roomPanelView(room, names, NOW, { viewerId: '300000000000000099' });
    const ids = view.components.flatMap((r) => r.toJSON().components.map((c) => (c as { custom_id?: string }).custom_id ?? ''));
    for (const id of ids) expect(decodeCustomId(id)?.args[0]).toBe(String(room.roomId));
    expect(view.embeds[0]?.toJSON().description).toContain(`Комната <@${room.ownerId}>`);
    expect(roomPanelView(room, names, NOW, { viewerId: room.ownerId }).embeds[0]?.toJSON().description).not.toContain('как администратор');
    expect(decodeCustomId(roomNameModal(room.roomId, 'Штаб').toJSON().custom_id)).toEqual({ action: 'rmnamef', args: [String(room.roomId)] });
  });

  it('the private message says whether the KP Coin came back (023 §5)', () => {
    expect(playerNoticeEmbed({ kind: 'grant_revoked', goodName: 'X', amount: null }).toJSON().description).toContain('не возвращаются');
    expect(playerNoticeEmbed({ kind: 'grant_revoked', goodName: 'X', amount: 5000 }).toJSON().description).toContain('5 000 KP Coin');
  });

  it('error texts say what to do next', () => {
    expect(domainErrorText({ code: 'ALREADY_CLAIMED', params: { at: NOW } })).toContain(`<t:${NOW.getTime() / 1000}:R>`);
    expect(domainErrorText({ code: 'NAME_INVALID', params: { reason: 'link' } })).toContain('Ссылки');
    expect(domainErrorText({ code: 'SHOP_UNAVAILABLE' })).toContain('KP Coin не списаны');
  });
});
