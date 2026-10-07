// Session-start preflight (hook in .zcode/config.json). Emits NOTHING when all is well
// (rule plain-language §7); one Russian line per problem otherwise, as hook JSON
// `additionalContext`. Never fails the session.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  // Installed but not running: the db tests and the local database need the Docker engine.
  if (!missing.includes('docker') && sh('docker info --format "{{.ServerVersion}}"', { timeout: 15000 }) === null) {
    lines.push('Docker не запущен — без него не работают база и проверки (npm run check); запусти Docker Desktop (агент может сам: start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe").');
  }
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

// 6. Rules mirror — every rules/*.md is mirrored in full into AGENTS.md, pinned by a hash
//    comment, so every session starts with every rule in context. Both the hash and the body
//    are compared, so a change on either side alone is named. CRLF is normalised so the hash
//    does not depend on the machine's checkout.
function ruleBody(raw) {
  return raw
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^\s+/, '')
    .replace(/^#[^\n]*\n/, '')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');
}
const rulesDir = resolve(root, 'rules');
if (existsSync(rulesDir)) {
  const agentsMd = resolve(root, 'AGENTS.md');
  if (!existsSync(agentsMd)) {
    lines.push('Нет AGENTS.md — зеркалу правил из rules/ некуда писаться; восстанови по FLOW.md Route 3.');
  } else {
    const md = readFileSync(agentsMd, 'utf8').split('\n');
    const slugs = new Set(
      readdirSync(rulesDir).filter((x) => x.endsWith('.md') && x !== 'README.md').map((x) => x.replace(/\.md$/, '')),
    );
    for (const f of [...slugs].sort()) {
      const slug = f;
      const raw = readFileSync(resolve(rulesDir, `${f}.md`), 'utf8').replace(/\r\n/g, '\n');
      const hash = createHash('sha256').update(raw).digest('hex').slice(0, 12);
      const h = md.findIndex((l) => l === `### ${slug}` || l.startsWith(`### ${slug} `));
      const cm = h !== -1 && /^<!-- mirror: ([0-9a-f]{12}) -->$/.exec(md[h + 2] ?? '');
      if (h === -1 || !cm) {
        lines.push(`Правило ${slug} не отзеркалено в AGENTS.md — добавь блок с хешем <!-- mirror: ... --> (FLOW.md Route 3).`);
        continue;
      }
      const body = [];
      for (let i = h + 4; i < md.length && !md[i].startsWith('### ') && !md[i].startsWith('## '); i++) body.push(md[i]);
      if (cm[1] !== hash || body.join('\n').replace(/\s+$/, '') !== ruleBody(raw)) {
        lines.push(`Зеркало правила ${slug} в AGENTS.md расходится с rules/${slug}.md — перенеси правку и обнови хеш (FLOW.md Route 3).`);
      }
    }
    // A mirror block whose rule file is gone (a deletion or rename that left the block behind)
    // would keep feeding a dead rule into every session's context — name it.
    for (let i = 0; i < md.length; i++) {
      const hm = /^### ([a-z0-9-]+)/.exec(md[i] ?? '');
      if (hm && /^<!-- mirror: [0-9a-f]{12} -->$/.test(md[i + 2] ?? '') && !slugs.has(hm[1])) {
        lines.push(`Зеркало правила ${hm[1]} в AGENTS.md осталось без файла rules/${hm[1]}.md — удали блок (FLOW.md Route 3).`);
      }
    }
  }
}

if (lines.length) {
  const text = [
    'Preflight KiberPride Bot — скажи владельцу одной строкой в начале ответа только то, что его касается:',
    ...lines.map((l) => '  • ' + l),
  ].join('\n');
  console.log(JSON.stringify({ additionalContext: text }));
}
