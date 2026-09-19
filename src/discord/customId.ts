// custom_id codec (decision 002 §4): `kp1:<action>:<arg>[:<arg>…]`, at most 100 characters.
// Arguments are database ids, snowflakes or one-letter choices — never names or amounts, and
// never trusted: every handler looks the ids up and re-checks them.
import { z } from 'zod';

export const SCHEME = 'kp1';
export const MAX_CUSTOM_ID_LENGTH = 100;

const actionSchema = z.string().regex(/^[a-z][a-z0-9]{1,7}$/);
const argSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const decodedSchema = z.object({
  scheme: z.literal(SCHEME),
  action: actionSchema,
  args: z.array(argSchema).max(8),
});

export interface DecodedCustomId {
  action: string;
  args: string[];
}

export function encodeCustomId(action: string, ...args: (string | number)[]): string {
  const parts = [action, ...args.map(String)];
  const parsed = decodedSchema.safeParse({ scheme: SCHEME, action, args: parts.slice(1) });
  if (!parsed.success) throw new Error(`invalid custom_id parts: ${parts.join(':')}`);
  const id = [SCHEME, ...parts].join(':');
  if (id.length > MAX_CUSTOM_ID_LENGTH) throw new Error(`custom_id longer than ${MAX_CUSTOM_ID_LENGTH}: ${id}`);
  return id;
}

/** Null for anything that is not a valid `kp1` id — the router answers «кнопка устарела». */
export function decodeCustomId(raw: string): DecodedCustomId | null {
  if (raw.length > MAX_CUSTOM_ID_LENGTH) return null;
  const [scheme, action, ...args] = raw.split(':');
  const parsed = decodedSchema.safeParse({ scheme, action, args });
  return parsed.success ? { action: parsed.data.action, args: parsed.data.args } : null;
}

/** A positive database id, or null. */
export function intArg(value: string | undefined): number | null {
  if (value === undefined || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const n = Number(value);
  return n <= 2_147_483_647 ? n : null;
}

/** A Discord snowflake, or null. */
export function snowflakeArg(value: string | undefined): string | null {
  return value !== undefined && /^\d{17,20}$/.test(value) ? value : null;
}
