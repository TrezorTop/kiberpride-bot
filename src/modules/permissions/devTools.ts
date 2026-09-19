// Owner test tools (decisions 008 §10, 014 §12): «🧪 +10 000 KP Coin», «🧪 Закончить через 2
// минуты». Shown and run only outside production and only for the guild owner; the handler and
// the service both ask this function, so a forged custom_id changes nothing.
import type { MemberFacts } from './service.js';

export function mayUseDevTools(actor: Pick<MemberFacts, 'isGuildOwner'>, nodeEnv: string): boolean {
  return nodeEnv !== 'production' && actor.isGuildOwner;
}
