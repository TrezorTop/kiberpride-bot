import { describe, expect, it } from 'vitest';
import { CAPABILITIES, type RightsMap } from '../../modules/permissions/service.js';
import { CAPABILITY_TEXT, NOT_SET, rightsLogLine, rightsView } from './rights.js';

const ORGANISER = '600000000000000001';
const MOD = '600000000000000002';

const rights = (over: Partial<RightsMap> = {}): RightsMap => {
  const empty = Object.fromEntries(CAPABILITIES.map((c) => [c, [] as string[]])) as unknown as RightsMap;
  return { ...empty, ...over };
};

const fieldsOf = (view: ReturnType<typeof rightsView>) => view.embeds[0]?.toJSON().fields ?? [];

describe('the /права screen', () => {
  it('shows every right with a plain-Russian line and who holds it', () => {
    const view = rightsView(rights({ ACTIVITY_CREATE: [ORGANISER, MOD] }), null);
    const fields = fieldsOf(view);
    expect(fields).toHaveLength(CAPABILITIES.length);
    for (const capability of CAPABILITIES) {
      expect(fields.some((f) => f.name.includes(CAPABILITY_TEXT[capability].line))).toBe(true);
    }
    const create = fields.find((f) => f.name.includes(CAPABILITY_TEXT.ACTIVITY_CREATE.line));
    expect(create?.value).toBe(`<@&${ORGANISER}>, <@&${MOD}>`);
  });

  it('says «не задано» for a right nobody holds', () => {
    const fields = fieldsOf(rightsView(rights(), null));
    expect(fields.every((f) => f.value === NOT_SET)).toBe(true);
  });

  it('offers the role picker only after a right is chosen, pre-filled with its roles', () => {
    expect(rightsView(rights(), null).components).toHaveLength(1);

    const view = rightsView(rights({ MATCH_MANAGE_ANY: [MOD] }), 'MATCH_MANAGE_ANY');
    expect(view.components).toHaveLength(2);
    const picker = view.components[1]?.toJSON().components[0] as { custom_id: string; default_values?: { id: string }[]; min_values?: number };
    expect(picker.custom_id).toBe('kp1:rrol:MATCH_MANAGE_ANY');
    expect(picker.default_values?.map((v) => v.id)).toEqual([MOD]);
    // 0 is how a right is taken away from every role.
    expect(picker.min_values).toBe(0);
  });

  it('marks the chosen right in the menu', () => {
    const menu = rightsView(rights(), 'SHOP_MANAGE').components[0]?.toJSON().components[0] as { options: { value: string; default?: boolean }[] };
    expect(menu.options.filter((o) => o.default).map((o) => o.value)).toEqual(['SHOP_MANAGE']);
  });

  it('names the roles and the right in the log line', () => {
    const line = rightsLogLine('100000000000000001', 'ACTIVITY_CREATE', { added: [ORGANISER], removed: [MOD] });
    expect(line).toContain('<@100000000000000001>');
    expect(line).toContain(`<@&${ORGANISER}>`);
    expect(line).toContain(`<@&${MOD}>`);
    expect(line).toContain(CAPABILITY_TEXT.ACTIVITY_CREATE.line);
  });
});
