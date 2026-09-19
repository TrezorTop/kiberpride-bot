import { describe, expect, it, vi } from 'vitest';
import type { VoiceMemberState, VoiceSnapshot } from '../core/ports.js';
import { eligibleVoiceUsers, runVoiceTick } from './voice.js';

const A = '300000000000000001';
const B = '300000000000000002';
const C = '300000000000000003';
const BOT = '300000000000000099';
const FAKE = '00000000000000001';

const m = (userId: string, over: Partial<VoiceMemberState> = {}): VoiceMemberState => ({ userId, bot: false, selfDeaf: false, serverDeaf: false, ...over });
const snap = (members: VoiceMemberState[], over: Partial<VoiceSnapshot['channels'][number]> = {}, afk: string | null = null): VoiceSnapshot => ({
  afkChannelId: afk,
  channels: [{ id: '500000000000000001', stage: false, members, ...over }],
});

describe('eligibleVoiceUsers (decision 014 §6)', () => {
  it('pays two people talking, muted or not', () => {
    expect(eligibleVoiceUsers(snap([m(A), m(B)]))).toEqual([A, B]);
  });

  it('never pays someone alone, or alone with bots or fake players', () => {
    expect(eligibleVoiceUsers(snap([m(A)]))).toEqual([]);
    expect(eligibleVoiceUsers(snap([m(A), m(BOT, { bot: true })]))).toEqual([]);
    expect(eligibleVoiceUsers(snap([m(A), m(FAKE)]))).toEqual([]);
  });

  it('never pays a deafened player, and a deafened partner does not count', () => {
    expect(eligibleVoiceUsers(snap([m(A), m(B, { selfDeaf: true })]))).toEqual([]);
    expect(eligibleVoiceUsers(snap([m(A), m(B, { serverDeaf: true })]))).toEqual([]);
    expect(eligibleVoiceUsers(snap([m(A), m(B), m(C, { selfDeaf: true })]))).toEqual([A, B]);
  });

  it('never pays in the AFK channel or a stage channel', () => {
    expect(eligibleVoiceUsers(snap([m(A), m(B)], {}, '500000000000000001'))).toEqual([]);
    expect(eligibleVoiceUsers(snap([m(A), m(B)], { stage: true }))).toEqual([]);
  });

  it('never pays a bot, even with people around', () => {
    expect(eligibleVoiceUsers(snap([m(A), m(B), m(BOT, { bot: true })]))).toEqual([A, B]);
  });
});

describe('runVoiceTick', () => {
  it('hands the eligible players and the clock to the earnings service', async () => {
    const at = new Date('2026-09-20T12:00:30Z');
    const voiceTick = vi.fn(() => Promise.resolve({ credited: 2, paid: [] }));
    const result = await runVoiceTick({
      gateway: { voiceSnapshot: () => Promise.resolve(snap([m(B), m(A)])) },
      earnings: { voiceTick },
      logging: { failure: vi.fn(() => Promise.resolve()) },
      clock: { now: () => at },
    });
    expect(voiceTick).toHaveBeenCalledWith([A, B], at);
    expect(result).toEqual({ eligible: 2, credited: 2, paid: 0 });
  });
});
