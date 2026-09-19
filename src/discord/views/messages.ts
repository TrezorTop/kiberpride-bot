// Player-facing text that is not tied to one screen (rule plain-language §8): warm, short,
// always says what to do next. Details of a failure go to the log channel, never here.
import type { DomainErrorCode, DomainErrorParams } from '../../core/errors.js';

export const STALE_COMPONENT = 'Эта кнопка устарела — открой меню заново 🙂';
export const UNEXPECTED_ERROR = 'Что-то пошло не так. Попробуй ещё раз через минуту — администраторы уже в курсе.';
export const WRONG_GUILD = 'Я работаю только на сервере KiberPride 🙂';
export const NOT_READY = 'Я ещё просыпаюсь — попробуй через минуту.';
export const HISTORY_SOON = 'Полная история скоро появится 🙂 Пока последние операции видны в /профиль.';

const DOMAIN_ERROR_TEXT: Record<DomainErrorCode, string> = {
  INSUFFICIENT_FUNDS: 'Не хватает KP Coin 😔 Проверь баланс через /баланс — KP Coin можно заработать в матчах.',
  NOT_ALLOWED: 'Это могут делать только организаторы и администраторы.',
  STALE_PANEL: 'Панель устарела — открой её заново.',
  MATCH_CLOSED: 'Набор уже закрыт — следи за следующими играми!',
  ALREADY_JOINED: 'Ты уже в игре 👍',
  MATCH_ALREADY_FINISHED: 'Этот матч уже завершён.',
  MATCH_CANCELLED: 'Этот матч отменён.',
  NOT_FOUND: 'Не нашёл это — возможно, его уже удалили. Открой меню заново.',
  SETUP_REQUIRED: 'Сначала нужно выбрать категорию для голосовых каналов: /игры → «⚙️ Настройки». Это может сделать администратор.',
  BOT_MISSING_PERMISSIONS: 'Мне не хватает прав. Попроси администратора выдать их боту и попробуй ещё раз.',
  NOT_A_PARTICIPANT: 'Этого игрока нет в составе матча — открой панель заново.',
  TEAMS_NOT_READY: 'Команды ещё не готовы: в каждой должно быть одинаковое число игроков. Распредели их и попробуй снова.',
  NOT_IN_MATCH: 'Тебя нет в этой игре 🙂 Жми «🎮 Участвовать», чтобы записаться.',
  BUSY_IN_MATCH: 'Ты сейчас в матче — дождись его конца, потом записывайся в новый 🎮',
  ROSTER_LOCKED: 'Состав уже собран — если не можешь играть, напиши организатору 🙏',
  MATCH_STARTED: 'Матч уже начался — состав больше не меняется.',
  SPECIAL_ONLY_RECRUITING: 'Сделать матч особым можно только пока идёт набор.',
};

/** Discord permission flag names the bot may lack → what the admin sees (decision 008 §2). */
const PERMISSION_TEXT: Record<string, string> = {
  NotFound: 'канал не найден — выбери другой',
  ViewChannel: 'видеть канал',
  SendMessages: 'отправлять сообщения',
  EmbedLinks: 'встраивать ссылки',
  ReadMessageHistory: 'читать историю сообщений',
  Connect: 'подключаться',
  ManageChannels: 'управлять каналами',
  ManageRoles: 'управлять правами',
  MoveMembers: 'перемещать участников',
};

const WHERE_TEXT: Record<string, string> = { recruit: 'в канале набора', voice: 'в категории голосовых' };

/** «в канале набора: отправлять сообщения; в категории голосовых: перемещать участников». */
export function missingPermissionsText(missing: readonly string[]): string {
  const groups = new Map<string, string[]>();
  for (const item of missing) {
    const [where, flag] = item.includes(':') ? (item.split(':', 2) as [string, string]) : ['', item];
    const list = groups.get(where) ?? [];
    list.push(PERMISSION_TEXT[flag] ?? flag);
    groups.set(where, list);
  }
  return [...groups].map(([where, flags]) => `${WHERE_TEXT[where] ?? 'здесь'}: ${flags.join(', ')}`).join('; ');
}

export function domainErrorText(err: { code: DomainErrorCode; params?: DomainErrorParams }): string {
  if (err.code === 'BOT_MISSING_PERMISSIONS' && err.params?.missing?.length) {
    return `Мне не хватает прав — ${missingPermissionsText(err.params.missing)}. Попроси администратора выдать их боту и попробуй ещё раз.`;
  }
  return DOMAIN_ERROR_TEXT[err.code];
}
