// What a shop Problem means, in plain Russian for the admin: the log channel lines of this module
// and the shop settings screen both use it, so the admin reads the same words in both places.
import type { Problem } from './kinds/index.js';

const PERMISSION_WORDS: Record<string, string> = {
  NotFound: 'канал не найден',
  ViewChannel: 'видеть канал',
  ManageRoles: 'управлять правами',
  ManageChannels: 'управлять каналами',
  Connect: 'подключаться',
  MoveMembers: 'перемещать участников',
  AttachFiles: 'прикреплять файлы',
  EmbedLinks: 'встраивать ссылки',
};

const words = (missing: readonly string[] | undefined) => (missing ?? []).map((m) => PERMISSION_WORDS[m] ?? m).join(', ');
const where = (p: Problem) => (p.channelId ? ` <#${p.channelId}>` : '');

export function problemText(p: Problem): string {
  switch (p.code) {
    case 'unknown_kind':
      return 'бот не знает такой вид товара — его нужно убрать или поправить';
    case 'bad_config':
      return 'настройки товара испорчены — их нужно поправить';
    case 'no_manage_roles':
      return 'у бота нет права «Управлять ролями» на сервере';
    case 'role_missing':
      return 'роль товара ещё не создана — выбери каналы или включи товар, бот создаст её сам';
    case 'role_above_bot':
      return 'роль товара выше роли бота — перетащи роль бота выше в настройках сервера';
    case 'no_channels':
      return 'не выбраны каналы, где действует доступ';
    case 'channel_missing':
      return `канал${where(p)} не найден — убери его из списка`;
    case 'channel_perms':
      return `в канале${where(p)} боту не хватает прав: ${words(p.missing)}`;
    case 'everyone_has':
      return `в канале${where(p)} это и так разрешено всем — покупка ничего не даст`;
    case 'other_role_allows':
      return `в канале${where(p)} это разрешено и другим ролям: ${(p.roleIds ?? []).map((r) => `<@&${r}>`).join(', ')} — если это не персонал, проверь`;
    case 'too_many_roles':
      return 'на сервере почти 250 ролей — Discord не даст создать новую';
    case 'anchor_missing':
      return 'не выбрана роль, под которой ставить клановые роли';
    case 'anchor_gone':
      return 'роль, под которой ставить клановые роли, удалена — выбери другую';
    case 'anchor_above_bot':
      return 'роль, под которой ставить клановые роли, выше роли бота — выбери роль ниже или подними роль бота';
    case 'no_category':
      return 'не выбрана категория для личных комнат';
    case 'category_missing':
      return 'категория для личных комнат не найдена — выбери другую';
    case 'category_perms':
      return `в категории комнат боту не хватает прав: ${words(p.missing)}`;
    case 'category_full':
      return 'в категории комнат уже 50 каналов — выбери другую';
  }
}

export function problemsText(list: readonly Problem[]): string {
  return list.map(problemText).join('; ');
}
