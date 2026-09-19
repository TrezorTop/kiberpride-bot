// Session-start preflight (hook in .claude/settings.json). Prints NOTHING when all is well
// (rule plain-language §7); one Russian line per problem otherwise. Never fails the session.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lines = [];

function sh(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, ...opts })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// 1. Toolchain — what /init-project and every later session need.
const tools = [
  ['git', 'git --version'],
  ['gh', 'gh --version'],
  ['docker', 'docker --version'],
  ['ssh', 'ssh -V'],
];
const missing = tools.filter(([, cmd]) => sh(cmd) === null).map(([name]) => name);
if (missing.length) {
  lines.push(`Не хватает инструментов: ${missing.join(', ')} — runbooks/workstation-setup.md (или /init-project).`);
}

// 2. Git state — fetch, lag behind origin/main, uncommitted work, branch.
if (!missing.includes('git') && existsSync(resolve(root, '.git'))) {
  const fetched = sh('git fetch -q origin') !== null;
  if (!fetched) lines.push('Не удалось связаться с GitHub (git fetch) — проверь сеть; работа возможна, но без свежего main.');
  const branch = sh('git rev-parse --abbrev-ref HEAD') ?? '?';
  const hasRemoteMain = sh('git rev-parse --verify -q origin/main') !== null;
  if (hasRemoteMain) {
    const behind = Number(sh('git rev-list --count HEAD..origin/main') ?? 0);
    if (branch === 'main' && behind > 0) lines.push(`main отстаёт от GitHub на ${behind} коммит(а) — сделай git pull --ff-only до первой правки.`);
    if (branch !== 'main') {
      const behindMain = Number(sh('git rev-list --count HEAD..origin/main') ?? 0);
      if (behindMain > 0) lines.push(`Ветка ${branch} не содержит ${behindMain} свежих коммитов main — слей origin/main до pull request (rule github-flow).`);
    }
  } else if (fetched) {
    lines.push('На GitHub ещё нет main — первый push сделает его (rule github-flow, runbooks/workstation-setup.md §4).');
  }
  const dirty = (sh('git status --porcelain') ?? '').split('\n').filter(Boolean).length;
  if (dirty > 0) lines.push(`Незакоммиченные изменения: ${dirty} файл(ов) — прошлая сессия не закончила; доделай или отложи с пометкой (rule github-flow §7).`);
}

// 3. Project stage — before /init-project there is no src/.
const hasSrc = existsSync(resolve(root, 'src'));
if (!hasSrc) {
  lines.push('Кода ещё нет — единственный маршрут этой сессии: /init-project (FLOW.md Route 0).');
} else {
  if (!existsSync(resolve(root, '.env'))) lines.push('Нет файла .env — токен бота не задан; runbooks/discord-app-setup.md §2.');
  if (missing.length === 0 && sh('node --version') === null) lines.push('Node.js не найден в PATH.');
}

// 4. Open product questions — a count, so the lead asks them when the work arrives there.
const oq = resolve(root, 'product', 'open-questions.md');
if (existsSync(oq)) {
  const n = (readFileSync(oq, 'utf8').match(/^## Q\d+\./gm) ?? []).length;
  if (n > 0 && hasSrc) lines.push(`Открытых продуктовых вопросов: ${n} (product/open-questions.md) — задавай владельцу по одному, когда работа дойдёт.`);
}

// 5. Stale «Last verified» footers older than 60 days in runbooks and product docs.
const stale = [];
for (const dir of ['runbooks', 'product']) {
  const list = sh(`git ls-files ${dir}`) ?? '';
  for (const f of list.split('\n').filter((x) => x.endsWith('.md'))) {
    const m = readFileSync(resolve(root, f), 'utf8').match(/Last verified: (\d{4}-\d{2}-\d{2})/);
    if (m && (Date.now() - Date.parse(m[1])) / 864e5 > 60) stale.push(f);
  }
}
if (stale.length) lines.push(`Давно не сверялись с реальностью (>60 дней): ${stale.join(', ')} — сверь и обнови дату.`);

if (lines.length) {
  console.log('Preflight KiberPride Bot — скажи владельцу одной строкой в начале ответа только то, что его касается:');
  for (const l of lines) console.log('  • ' + l);
}
