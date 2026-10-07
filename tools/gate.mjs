// PreToolUse gate (hook in .zcode/config.json). Reads the hook JSON on stdin.
//   node tools/gate.mjs shell        — Bash: no shell edits of repo files, no `git add` of
//                                      secrets, no direct push to main
//   node tools/gate.mjs spawn        — Agent: a `ROLE:` line, never a `model` (rule model-roles)
//   node tools/gate.mjs --self-test  — runs the cases below, exit 1 on a failure
// A refusal is exit 2 with the reason on stderr (the hook runner blocks the call and shows it).
// The gate is a seatbelt against forgetting, not a wall: the escapes are literal and named.
import { execSync } from 'node:child_process';

// A redirection or tee target that looks like a tracked repository file (rule edit-with-tools §2).
const REPO_TARGET =
  /\.(md|markdown|ts|tsx|js|jsx|mjs|cjs|json|yml|yaml|env|prisma|toml|sql|graphql|gql|sh|bash|ps1|bat|cmd|gitignore|dockerignore|editorconfig|prettierignore|npmrc|lock)(?![\w.-])|(^|[\\\/])Dockerfile(?![\w.-])/i;

export function checkShell(command) {
  const c = String(command ?? '');
  if (/(^|[;&|]\s*)ssh\s/.test(c)) return null; // the ssh COMMAND: remote edits per runbook (rule edit-with-tools §4)
  if (/#\s*SHELL-EDIT:\s*\S/.test(c)) return null; // named last resort, counted in the report

  // sed/perl with an in-place flag, bundled or split: `sed -i`, `sed -s -i`, `sed -f s.sed -i`, `perl -pi -e`
  const sedInPlace = [...c.matchAll(/(^|[;&|\s])(?:sudo\s+)?(?:g?sed|perl)\s+([^&|;\n]+)/g)].some((m) =>
    /(^|\s)-{1,2}[a-zA-Z.]*i[a-zA-Z.]*\b/.test(m[2]),
  );
  const teeEdit = [...c.matchAll(/(^|[;&|\s])tee\s+((?:-{1,2}[\w-]+\s+)*)([^\s&|;]+)/g)].some((m) =>
    REPO_TARGET.test(m[3]),
  );
  const echoEdit = /(^|[;&|\s])echo\b[^\n|;]*\s>>?\s*([^\s&|]+)/.exec(c);
  const shellEdit =
    sedInPlace ||
    /<<-?\s*['"]?[A-Za-z_]+['"]?[^\n]*\s>>?\s*[^\s&|]/.test(c) || // cat <<EOF > file
    /\s>>?\s*[^\s&|]+\s<<-?\s*['"]?[A-Za-z_]+/.test(c) || // cat > file <<EOF
    (echoEdit !== null && REPO_TARGET.test(echoEdit[2])) ||
    teeEdit ||
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
  const model = String(input?.model ?? '');
  const role = String(input?.subagent_type ?? '');
  const prompt = String(input?.prompt ?? '');
  if (model) {
    return 'Refused: a delegation carries no `model` (rule model-roles §4) — every role runs on the session model; drop the field.';
  }
  if (/(^|:)visual-judge$/.test(role)) return null; // the render judges run their own delivery protocol
  if (!/^ROLE:\s*\S/m.test(prompt)) {
    return 'Refused: delegation without a role (rule model-roles §5) — open the prompt with `ROLE: <name>` and carry the spec from agents/.';
  }
  return null;
}

function selfTest() {
  const cases = [
    ['shell', { command: 'sed -i "s/a/b/" rules/x.md' }, true],
    ['shell', { command: 'sed -s -i "s/a/b/" x.md' }, true],
    ['shell', { command: 'sed -f s.sed -i x.md' }, true],
    ['shell', { command: 'perl -pi -e "s/a/b/" x.md' }, true],
    ['shell', { command: "sed 's/a/b/' rules/x.md | tee rules/x.md" }, true],
    ['shell', { command: 'docker logs x | tee out.log' }, false],
    ['shell', { command: 'cat <<EOF > product/spec.md\nhi\nEOF' }, true],
    ['shell', { command: 'cat > x.ts <<EOF\nhi\nEOF' }, true],
    ['shell', { command: 'sed -n "1,20p" rules/x.md' }, false],
    ['shell', { command: 'grep -rn foo src/' }, false],
    ['shell', { command: 'ssh kiberpride "cat > /opt/ruslan-bot/.env" < .env.server' }, false],
    ['shell', { command: 'sed -i "s/a/b/" x.md # SHELL-EDIT: bulk rename, dry-run checked' }, false],
    ['shell', { command: 'echo x > .gitignore' }, true],
    ['shell', { command: 'echo x > Dockerfile' }, true],
    ['shell', { command: 'git add .env' }, true],
    ['shell', { command: 'git add .env.example' }, false],
    ['shell', { command: 'git add ~/.ssh/kiberpride-bot' }, true],
    ['shell', { command: 'git add src/ && git commit -m "x"' }, false],
    ['shell', { command: 'git push origin main' }, true],
    ['shell', { command: 'git push origin feat/x' }, false],
    ['shell', { command: 'git push origin main # DIRECT-PUSH: bootstrap' }, false],
    ['shell', { command: 'git push origin --delete feat/x' }, false],
    ['spawn', { subagent_type: 'Explore', prompt: 'ROLE: architect\nrefute this branch' }, false],
    ['spawn', { subagent_type: 'general-purpose', prompt: 'ROLE: builder\nscaffold per decision 002' }, false],
    ['spawn', { subagent_type: 'Explore', prompt: 'map the shop module' }, true],
    ['spawn', { subagent_type: 'general-purpose', prompt: 'x' }, true],
    ['spawn', { subagent_type: 'general-purpose', model: 'glm-5.3', prompt: 'ROLE: builder\nx' }, true],
    ['spawn', { subagent_type: 'documents:visual-judge', prompt: 'judge pages 1-3' }, false],
    ['spawn', { model: 'opus', prompt: 'ROLE: probe' }, true],
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
