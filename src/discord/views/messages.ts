// Player-facing text that is not tied to one screen (rule plain-language §8): warm, short,
// always says what to do next. Details of a failure go to the log channel, never here.
import type { DomainErrorCode } from '../../core/errors.js';

export const STALE_COMPONENT = 'Эта кнопка устарела — открой меню заново 🙂';
export const UNEXPECTED_ERROR = 'Что-то пошло не так. Попробуй ещё раз через минуту — администраторы уже в курсе.';
export const WRONG_GUILD = 'Я работаю только на сервере KiberPride 🙂';
export const NOT_READY = 'Я ещё просыпаюсь — попробуй через минуту.';
export const HISTORY_SOON = 'Полная история скоро появится 🙂 Пока последние операции видны в /профиль.';

const DOMAIN_ERROR_TEXT: Record<DomainErrorCode, string> = {
  INSUFFICIENT_FUNDS: 'Не хватает KP 😔 Проверь баланс через /баланс — KP можно заработать в матчах.',
  NOT_ALLOWED: 'Это могут делать только организаторы и администраторы.',
  STALE_PANEL: 'Панель устарела — открой её заново.',
  MATCH_CLOSED: 'Набор уже закрыт — следи за следующими играми!',
  ALREADY_JOINED: 'Ты уже в игре 👍',
  MATCH_ALREADY_FINISHED: 'Этот матч уже завершён.',
  NOT_FOUND: 'Не нашёл это — возможно, его уже удалили. Открой меню заново.',
};

export function domainErrorText(code: DomainErrorCode): string {
  return DOMAIN_ERROR_TEXT[code];
}
