// PreToolUse gate (hook in .claude/settings.json). Reads the hook JSON on stdin.
//   node tools/gate.mjs shell        — Bash / PowerShell: no shell edits of repo files, no
//                                      `git add` of secrets, no direct push to main
//   node tools/gate.mjs spawn        — Agent: calibre declared, never fable (rule model-roles)
//   node tools/gate.mjs --self-test  — runs the cases below, exit 1 on a failure
// A refusal is exit 2 with the reason on stderr (Claude Code blocks the call and shows it).
// The gate is a seatbelt against forgetting, not a wall: the escapes are literal and named.
import { execSync } from 'node:child_process';

const ROLES = new Set(['architect', 'builder', 'explorer', 'prober']);

export function checkShell(command) {
  const c = String(command ?? '');
  if (/(^|[;&|]\s*)ssh\s/.test(c)) return null; // the ssh COMMAND: remote edits per runbook (rule edit-with-tools §4)
  if (/#\s*SHELL-EDIT:\s*\S/.test(c)) return null; // named last resort, counted in the report

  const shellEdit =
    /(^|[;&|\s])(sed|perl)\s+(-[a-zA-Z]*i\b|--in-place)/.test(c) ||
    /<<-?\s*['"]?[A-Za-z_]+['"]?[^\n]*\s>>?\s*[^\s&|]/.test(c) || // cat <<EOF > file
    /\s>>?\s*[^\s&|]+\s*<<-?\s*['"]?[A-Za-z_]+/.test(c) || // cat > file <<EOF
    /(^|[;&|\s])echo\b[^\n|;]*\s>>?\s*[A-Za-z0-9_./\\-]+\.(md|ts|js|mjs|json|yml|yaml|env|prisma|toml)\b/.test(c) ||
    /\bnode\s+-e\b[\s\S]*writeFile/.test(c) ||
    /\bpython3?\s+-c\b[\s\S]*open\([^)]*['"][wa]/.test(c) ||
    /\bSet-Content\b|\bOut-File\b|\bAdd-Content\b/.test(c);
  if (shellEdit) {
    return 'Shell edit of a repository file refused (rule edit-with-tools): use Edit/Write. Last resort: add `# SHELL-EDIT: <reason>` to the command.';
  }

  if (/\bgit\s+add\b/.test(c) && /(^|[\s"'])(\.env(?!\.example)[^\s"']*|[^\s"']*(id_ed25519|id_rsa|kiberpride-bot)(?!\.pub)[^\s"']*|[^\s"']*\.pem|deploy\/inventory\.local|[^\s"']*\.dump)(?=[\s"']|$)/.test(c)) {
    return 'Refused: `git add` of a secret-shaped file (rule no-secrets-in-git). Secrets stay in .env / key files, ignored by git.';
  }

  if (/\bgit\s+push\b/.test(c) && !/#\s*DIRECT-PUSH:\s*\S/.test(c) && !/--delete\b|\s:[\w/-]+/.test(c)) {
    const explicit = c.match(/\bgit\s+push\b[^\n;&|]*?\s(?:origin\s+)?([\w./-]+)\s*(?:$|[;&|#])/);
    let target = explicit?.[1];
    if (!target || target.startsWith('-')) {
      try {
        target = execSync('git rev-parse --abbrev-ref HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      } catch {
        target = '';
      }
    }
    if (target === 'main' || target === 'HEAD:main') {
      return 'Refused: direct push to main (rule github-flow). Go by branch and pull request; last resort `# DIRECT-PUSH: <reason>` in the command.';
    }
  }
  return null;
}

export function checkSpawn(input) {
  const model = String(input?.model ?? '').toLowerCase();
  const role = String(input?.subagent_type ?? '');
  const prompt = String(input?.prompt ?? '');
  if (model === 'fable') return 'Refused: fable is not available on this project (rule model-roles) — the ceiling is opus.';
  if (ROLES.has(role)) {
    if (model) return `Refused: role ${role} fixes its own model and effort — drop \`model\` (rule model-roles §5).`;
    return null;
  }
  if (!model) return 'Refused: delegation without a calibre (rule model-roles §5) — use a role from .claude/agents/ or pass `model` plus a `ROLE:` line.';
  if (!/^ROLE:\s*\S/m.test(prompt)) return 'Refused: an explicit `model` needs a `ROLE: <what this helper is>` line in the prompt (rule model-roles §5).';
  return null;
}

function selfTest() {
  const cases = [
    ['shell', { command: 'sed -i "s/a/b/" rules/x.md' }, true],
    ['shell', { command: 'cat <<EOF > product/spec.md\nhi\nEOF' }, true],
    ['shell', { command: 'cat > x.ts <<EOF\nhi\nEOF' }, true],
    ['shell', { command: 'sed -n "1,20p" rules/x.md' }, false],
    ['shell', { command: 'grep -rn foo src/' }, false],
    ['shell', { command: "ssh kiberpride 'cat > /opt/kiberpride-bot/.env' < .env.server" }, false],
    ['shell', { command: 'sed -i "s/a/b/" x.md # SHELL-EDIT: bulk rename, dry-run checked' }, false],
    ['shell', { command: 'git add .env' }, true],
    ['shell', { command: 'git add .env.example' }, false],
    ['shell', { command: 'git add ~/.ssh/kiberpride-bot' }, true],
    ['shell', { command: 'git add src/ && git commit -m "x"' }, false],
    ['shell', { command: 'git push origin main' }, true],
    ['shell', { command: 'git push origin feat/x' }, false],
    ['shell', { command: 'git push origin main # DIRECT-PUSH: bootstrap' }, false],
    ['shell', { command: 'git push origin --delete feat/x' }, false],
    ['spawn', { subagent_type: 'architect', prompt: 'x' }, false],
    ['spawn', { subagent_type: 'architect', model: 'opus', prompt: 'x' }, true],
    ['spawn', { subagent_type: 'general-purpose', prompt: 'x' }, true],
    ['spawn', { subagent_type: 'general-purpose', model: 'opus', prompt: 'ROLE: probe\nx' }, false],
    ['spawn', { subagent_type: 'general-purpose', model: 'opus', prompt: 'x' }, true],
    ['spawn', { model: 'fable', prompt: 'ROLE: x' }, true],
  ];
  let failed = 0;
  for (const [mode, input, shouldRefuse] of cases) {
    const r = mode === 'shell' ? checkShell(input.command) : checkSpawn(input);
    const ok = Boolean(r) === shouldRefuse;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${mode} ${JSON.stringify(input).slice(0, 70)} → ${r ? 'refused' : 'allowed'}`);
  }
  console.log(failed ? `${failed} FAILED` : `all ${cases.length} passed`);
  process.exit(failed ? 1 : 0);
}

async function main() {
  const mode = process.argv[2];
  if (mode === '--self-test') return selfTest();
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let hook = {};
  try {
    hook = JSON.parse(raw || '{}');
  } catch {
    return; // unreadable input: never block on a parser error
  }
  const input = hook.tool_input ?? {};
  const reason = mode === 'shell' ? checkShell(input.command) : mode === 'spawn' ? checkSpawn(input) : null;
  if (reason) {
    console.error(reason);
    process.exit(2);
  }
}

main();
