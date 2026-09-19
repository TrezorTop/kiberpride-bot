import { describe, expect, it } from 'vitest';
import { fakeUserId, type MatchSnapshot, type MatchStatusName, type ParticipantSnapshot } from '../../core/match.js';
import { decodeCustomId } from '../customId.js';
import {
  announcementView,
  finishConfirmView,
  gamesPanelView,
  matchPanelView,
  mvpView,
  recruitmentView,
  resultCard,
  setupCategoryView,
  type View,
} from './matches.js';
import { domainErrorText, missingPermissionsText } from './messages.js';

const CREATOR = '100000000000000001';
const p = (k: number, team: 'A' | 'B' | null = null, left = false): ParticipantSnapshot => ({
  userId: `3${String(k).padStart(17, '0')}`,
  team,
  joinedAt: new Date('2026-09-19T12:00:00Z'),
  leftServerAt: left ? new Date('2026-09-19T13:00:00Z') : null,
});

function snap(over: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    id: 12,
    game: { id: 1, name: 'CS2', emoji: '🔫' },
    title: 'Собираем игроков на матч',
    teamSize: 2,
    capacity: 4,
    teamMode: 'AUTO',
    status: 'RECRUITING',
    version: 3,
    syncedVersion: 3,
    announcedStatus: null,
    participantCount: 0,
    createdById: CREATOR,
    recruitChannelId: '500000000000000002',
    recruitMessageId: null,
    voiceCategoryId: '500000000000000001',
    voiceChannelAId: null,
    voiceChannelBId: null,
    rewards: { participation: 25, win: 100, mvp: 50, draw: 0 },
    special: false,
    winner: null,
    mvpUserId: null,
    createdAt: new Date('2026-09-19T12:00:00Z'),
    endedAt: null,
    endedById: CREATOR,
    participants: [],
    ...over,
  };
}

const teams = [p(1, 'A'), p(2, 'A'), p(3, 'B'), p(4, 'B')];

/** Every custom_id on a view, decoded to `action:args`. */
function actions(view: View): string[] {
  return view.components.flatMap((r) =>
    r.toJSON().components.map((c) => {
      const decoded = decodeCustomId((c as { custom_id?: string }).custom_id ?? '');
      return decoded ? [decoded.action, ...decoded.args].join(':') : 'undecodable';
    }),
  );
}
const text = (view: View) => JSON.stringify(view.embeds.map((e) => e.toJSON())) + (view.content ?? '');

describe('recruitment message by status (008 §4)', () => {
  const cases: [MatchStatusName, Partial<MatchSnapshot>, string[]][] = [
    ['RECRUITING', {}, ['mjoin:12', 'mleave:12', 'mpan:12']],
    ['TEAMS_PENDING', { participants: [p(1), p(2), p(3), p(4)], participantCount: 4 }, ['mpan:12']],
    ['IN_PROGRESS', { participants: teams, participantCount: 4 }, ['mfin:12', 'mpan:12']],
    ['FINISHED', { participants: teams, winner: 'A', participantCount: 4 }, []],
    ['CANCELLED', {}, []],
  ];
  for (const [status, over, expected] of cases) {
    it(`${status}: buttons ${expected.join(', ') || 'none'}`, () => {
      expect(actions(recruitmentView(snap({ status, ...over })))).toEqual(expected);
    });
  }

  it('shows the counter, the rewards and the ×2 mark of a special match', () => {
    const view = recruitmentView(snap({ special: true, participantCount: 1, participants: [p(1)], rewards: { participation: 50, win: 200, mvp: 100, draw: 0 } }));
    expect(text(view)).toContain('👥 Участники: 1/4');
    expect(text(view)).toContain('⭐ Особый матч — награды ×2');
    expect(text(view)).toContain('+200 KP Coin');
    expect(text(recruitmentView(snap()))).not.toContain('Особый матч');
  });

  it('links the team voice channels while the match runs', () => {
    const view = recruitmentView(snap({ status: 'IN_PROGRESS', participants: teams, voiceChannelAId: '700000000000000001', voiceChannelBId: '700000000000000002' }));
    expect(text(view)).toContain('<#700000000000000001>');
    expect(text(view)).toContain('<#700000000000000002>');
  });

  it('renders fake players as test players, never as mentions', () => {
    const fake = fakeUserId(3);
    const view = recruitmentView(snap({ participants: [{ ...p(1), userId: fake }], participantCount: 1 }));
    expect(text(view)).toContain('🧪 Тестовый игрок 3');
    expect(text(view)).not.toContain(`<@${fake}>`);
  });

  it('says a timed-out recruitment was closed by time', () => {
    expect(text(recruitmentView(snap({ status: 'CANCELLED', endedById: null })))).toContain('набор закрыт по времени');
  });
});

describe('result card and announcements (008 §8, 009 §3)', () => {
  it('says «MVP не выбран» when finished without an MVP, and lists paid and withheld amounts', () => {
    const card = JSON.stringify(
      resultCard(snap({ status: 'FINISHED', winner: 'A', participants: [p(1, 'A'), p(2, 'A', true), p(3, 'B'), p(4, 'B')] })).toJSON(),
    );
    expect(card).toContain('MVP не выбран');
    expect(card).toContain('+125 KP Coin'); // player 1: 25 + 100
    expect(card).toContain('Удержано');
  });

  it('pings the creator for teams, the present real players at start and on cancel, nobody on the result', () => {
    const roster = [p(1, 'A'), p(2, 'A', true), p(3, 'B'), { ...p(4, 'B'), userId: fakeUserId(1) }];
    const m = snap({ participants: roster });
    expect(announcementView(m, 'TEAMS_PENDING').pingUserIds).toEqual([CREATOR]);
    expect(announcementView(m, 'IN_PROGRESS').pingUserIds).toEqual([p(1).userId, p(3).userId]);
    expect(announcementView(m, 'CANCELLED').pingUserIds).toEqual([p(1).userId, p(3).userId]);
    expect(announcementView({ ...m, winner: 'B' }, 'FINISHED').pingUserIds).toEqual([]);
    expect(announcementView({ ...m, endedById: null }, 'CANCELLED').content).toContain('набор закрыт по времени');
  });
});

describe('organiser panel by status (008 §6, 009 §1)', () => {
  const names = new Map<string, string>();

  it('RECRUITING: remove select, ×2 toggle, test players when allowed, cancel with the version', () => {
    const m = snap({ participants: [p(1)], participantCount: 1 });
    expect(actions(matchPanelView(m, names, { canTest: true }))).toEqual(['mrm:12', 'mspc:12:1', 'mtest:12', 'mcan:12:3']);
    expect(actions(matchPanelView(m, names, { canTest: false }))).toEqual(['mrm:12', 'mspc:12:1', 'mcan:12:3']);
    expect(actions(matchPanelView({ ...m, special: true }, names, { canTest: false }))).toContain('mspc:12:0');
  });

  it('TEAMS_PENDING: the exact-size A picker with current A as defaults, confirm disabled until teams are full', () => {
    const m = snap({ status: 'TEAMS_PENDING', participants: [p(1, 'A'), p(2), p(3), p(4)], participantCount: 4 });
    const view = matchPanelView(m, names, { canTest: true });
    expect(actions(view)).toEqual(['mteam:12', 'mrm:12', 'mtok:12:3', 'mcan:12:3']);
    const picker = view.components[0]!.toJSON().components[0] as { min_values: number; max_values: number; options: { value: string; default?: boolean }[] };
    expect([picker.min_values, picker.max_values]).toEqual([2, 2]);
    expect(picker.options.filter((o) => o.default).map((o) => o.value)).toEqual([p(1).userId]);
    const confirm = view.components[2]!.toJSON().components[0] as { disabled?: boolean };
    expect(confirm.disabled).toBe(true);
    const ready = matchPanelView({ ...m, participants: teams }, names, { canTest: true });
    expect((ready.components[2]!.toJSON().components[0] as { disabled?: boolean }).disabled).toBe(false);
  });

  it('IN_PROGRESS: finish and cancel; terminal: nothing', () => {
    expect(actions(matchPanelView(snap({ status: 'IN_PROGRESS', participants: teams }), names, { canTest: true }))).toEqual(['mfin:12', 'mcan:12:3']);
    expect(actions(matchPanelView(snap({ status: 'FINISHED', participants: teams, winner: 'A' }), names, { canTest: true }))).toEqual([]);
  });
});

describe('finish flow (004 §4, 009 §3)', () => {
  it('the MVP select starts with «Без MVP» (value 0) and lists only players with a team', () => {
    const view = mvpView(snap({ status: 'IN_PROGRESS', participants: [...teams, p(5)] }), 'A', new Map());
    expect(actions(view)).toEqual(['mmvp:12:3:A']);
    const options = (view.components[0]!.toJSON().components[0] as { options: { value: string; label: string }[] }).options;
    expect(options[0]).toMatchObject({ value: '0', label: 'Без MVP' });
    expect(options.map((o) => o.value)).not.toContain(p(5).userId);
    expect(options).toHaveLength(5);
  });

  it('the confirm button carries 0 for «Без MVP» and the snowflake otherwise', () => {
    const m = snap({ status: 'IN_PROGRESS', participants: teams });
    expect(actions(finishConfirmView(m, 'DRAW', null))).toEqual(['mcfm:12:3:D:0']);
    expect(actions(finishConfirmView(m, 'B', p(3).userId))).toEqual([`mcfm:12:3:B:${p(3).userId}`]);
    expect(text(finishConfirmView(m, 'A', null))).toContain('не выбран');
  });
});

describe('/игры panel and settings', () => {
  it('shows create and settings only to those who may, and lists open matches', () => {
    const open = [snap(), snap({ id: 13, status: 'IN_PROGRESS', participants: teams })];
    expect(actions(gamesPanelView(open, { canCreate: true, canSettings: true }))).toEqual(['mnew', 'mset', 'mopen']);
    expect(actions(gamesPanelView([], { canCreate: true, canSettings: false }))).toEqual(['mnew']);
  });

  it('asks for the voice category once, «Продолжить» enabled only after it is saved', () => {
    const before = setupCategoryView(false);
    expect(actions(before)).toEqual(['svc:n', 'mnew']);
    expect((before.components[1]!.toJSON().components[0] as { disabled?: boolean }).disabled).toBe(true);
    expect((setupCategoryView(true).components[1]!.toJSON().components[0] as { disabled?: boolean }).disabled).toBe(false);
  });
});

describe('error texts', () => {
  it('names the missing permissions and where', () => {
    expect(missingPermissionsText(['recruit:SendMessages', 'voice:MoveMembers', 'voice:ManageRoles'])).toBe(
      'в канале набора: отправлять сообщения; в категории голосовых: перемещать участников, управлять правами',
    );
    expect(domainErrorText({ code: 'BOT_MISSING_PERMISSIONS', params: { missing: ['recruit:NotFound'] } })).toContain('канал не найден');
    expect(domainErrorText({ code: 'BUSY_IN_MATCH' })).toBe('Ты сейчас в матче — дождись его конца, потом записывайся в новый 🎮');
  });
});
