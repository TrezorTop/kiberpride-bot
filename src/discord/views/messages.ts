// Player-facing text that is not tied to one screen (rule plain-language §8): warm, short,
// always says what to do next. Details of a failure go to the log channel, never here.
import type { DomainErrorCode, DomainErrorParams } from '../../core/errors.js';

export const STALE_COMPONENT = 'Эта кнопка устарела — открой меню заново 🙂';
export const UNEXPECTED_ERROR = 'Что-то пошло не так. Попробуй ещё раз через минуту — администраторы уже в курсе.';
export const WRONG_GUILD = 'Я работаю только на сервере KiberPride 🙂';
export const NOT_READY = 'Я ещё просыпаюсь — попробуй через минуту.';

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
  SHOP_UNAVAILABLE: 'Этот товар сейчас не может быть выдан — администраторы уже в курсе. KP Coin не списаны, попробуй чуть позже 🙏',
  GOOD_DISABLED: 'Этот товар сейчас не продаётся. Загляни в /магазин — там всё, что доступно.',
  ALREADY_OWNED: 'Это у тебя уже есть 👍 Срок видно в /магазин и /профиль.',
  ALREADY_CLAIMED: 'Сегодняшний бонус уже у тебя 🎁 Приходи завтра!',
  DAILY_OFF: 'Ежедневный бонус сейчас выключен.',
  NAME_INVALID: 'Такое название не подойдёт. Придумай другое.',
  NAME_TAKEN: 'Клан с таким названием уже есть — придумай другое 🙂',
  CLAN_FULL: 'В клане больше нет мест.',
  IN_OTHER_CLAN: 'Этот игрок уже в другом клане — в клане можно состоять только в одном.',
  NOT_OWNER: 'Это может делать только владелец.',
  NO_CLAN: 'У тебя нет клана. Клан можно купить в /магазин 🛡️',
  NO_ROOM: 'У тебя нет личной комнаты. Её можно купить в /магазин 🏠',
  ROOM_FULL: 'В комнату больше нельзя добавить гостей.',
  INVALID_TARGET: 'Себя и ботов добавить нельзя 🙂 Выбери других игроков.',
  NOT_A_MEMBER: 'Этого игрока там уже нет — открой панель заново.',
};

/** Why a clan or room name was refused (NameProblem, modules/shop/names.ts). */
const NAME_PROBLEM_TEXT: Record<string, string> = {
  length: 'Название должно быть от 2 до 32 символов.',
  chars: 'В названии можно только буквы, цифры, эмодзи, пробел и - _ . ! ?',
  link: 'Ссылки в названии нельзя.',
  reserved: 'Так назвать нельзя — это слово занято Discord.',
  role_taken: 'На сервере уже есть роль с таким названием.',
  forbidden: 'Название похоже на роль персонала или сервера — придумай другое.',
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
  if (err.code === 'ALREADY_CLAIMED' && err.params?.at) {
    return `Сегодняшний бонус уже у тебя 🎁 Следующий — <t:${Math.floor(err.params.at.getTime() / 1000)}:R>.`;
  }
  if (err.code === 'NAME_INVALID' && err.params?.reason) {
    return `${NAME_PROBLEM_TEXT[err.params.reason] ?? DOMAIN_ERROR_TEXT.NAME_INVALID} Попробуй ещё раз.`;
  }
  return DOMAIN_ERROR_TEXT[err.code];
}
