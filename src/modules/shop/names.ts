// Clan and room names (decision 014 §3.2): pure rules, checked in the service before any money
// moves and again at rename. No profanity filter — names and renames are logged instead.

export const NAME_MIN = 2;
export const NAME_MAX = 32;

/** Why a name was refused; the Discord layer turns it into words (views/messages.ts). */
export type NameProblem = 'length' | 'chars' | 'link' | 'reserved' | 'role_taken' | 'forbidden';

/** Trimmed, every run of whitespace collapsed to one space. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ');
}

// Letters, digits, spaces, `-_.!?` and emoji (with their joiners, variation selectors, skin
// tones, flags and keycaps). Everything else — `@ # : \`` included — is refused.
const ALLOWED = /^(?:[\p{L}\p{M}\p{N} _.!?-]|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|⃣)+$/u;
// …and something visible (017 §2): a name of joiners, variation selectors, combining marks or
// punctuation alone would show as nothing. Flag letters count: «🇷🇺🇷🇺» is a visible name.
const VISIBLE = /[\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const LINK = /(?:discord\s*\.\s*gg|discord(?:app)?\s*\.\s*com|www\s*\.|[\p{L}\p{N}-]+\s*\.\s*(?:com|ru|gg|net|org|io|me|su|xyz|tv|рф)(?![\p{L}\p{N}]))/iu;
const RESERVED = new Set(['everyone', 'here']);

export interface NameRules {
  /** Words no word of a clan name may start with, any case (017 §4). */
  forbiddenWords?: readonly string[];
  /** Role names already on the server; a clan may not look like one of them. */
  roleNames?: readonly string[];
}

/** The first problem with an already normalized name, or null when it may be used. */
export function nameProblem(name: string, rules: NameRules = {}): NameProblem | null {
  const length = [...name].length;
  if (length < NAME_MIN || length > NAME_MAX) return 'length';
  if (!ALLOWED.test(name) || !VISIBLE.test(name)) return 'chars';
  if (LINK.test(name)) return 'link';
  const lower = name.toLocaleLowerCase('ru');
  if (RESERVED.has(lower)) return 'reserved';
  if (rules.roleNames?.some((r) => r.toLocaleLowerCase('ru') === lower)) return 'role_taken';
  if (rules.forbiddenWords?.some((w) => w.length > 0 && startsAWord(lower, w.toLocaleLowerCase('ru')))) return 'forbidden';
  return null;
}

// Forbidden words match at the start of a word only (017 §4): «бот» must not block «Работа» or
// «Суббота». So «Админы», «ModSquad», «Супер Админы» are refused — and «Modern» too; a word glued
// on after a letter («ТопАдмин») is not — the log of names and renames covers that.
function startsAWord(lower: string, word: string): boolean {
  for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
    if (at === 0 || !/\p{L}/u.test(String.fromCodePoint(lower.codePointAt(at - 1) ?? 0))) return true;
  }
  return false;
}
