// «🧪 Добавить тестовых игроков» (decision 008 §10): one person tests a ten-seat match. Shown
// and run only outside production and only for the guild owner; the handler and the service
// both ask this function.
import type { MemberFacts } from '../permissions/service.js';

export function mayAddTestPlayers(actor: Pick<MemberFacts, 'isGuildOwner'>, nodeEnv: string): boolean {
  return nodeEnv !== 'production' && actor.isGuildOwner;
}
