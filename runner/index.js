#!/usr/bin/env node
// The runner: the half of an agent that lives on your machine.
//
// It polls your MetanoiaDocs instance for runs queued against one agent
// account, hands each one to a coding CLI, and posts back whatever the CLI
// printed. Nothing listens on a port and nothing is exposed — the workspace
// never reaches in here, this reaches out.
//
// Zero dependencies on purpose: `npx metanoiadocs-runner` on a laptop with Node
// and a coding CLI already on it should be the whole install.
import { spawn } from 'node:child_process';
import process from 'node:process';
import { buildPrompt } from './prompt.js';

/**
 * How each supported CLI is started for unattended work. The prompt goes in on
 * stdin in every case, so a preset is only ever the program and its flags.
 *
 * These are a starting point, not a contract: CLI flags move, and yours may
 * already differ. `--command` replaces the whole thing, and anything that reads
 * a prompt on stdin and prints its answer works.
 */
const PRESETS = {
  claude: ['claude', '-p', '--permission-mode', 'acceptEdits'],
  codex: ['codex', 'exec', '-'],
  opencode: ['opencode', 'run'],
  copilot: ['copilot', '-p', '--allow-all-tools'],
};

const HELP = `metanoiadocs-runner — give your MetanoiaDocs agent's work to a coding CLI.

  --url <url>         Your instance, e.g. https://docs.example.com   [METANOIA_URL]
  --token <token>     The agent account's API token                  [METANOIA_TOKEN]
  --agent <preset>    ${Object.keys(PRESETS).join(' | ')}            [METANOIA_AGENT]
  --command "<cmd>"   Run this instead of a preset; prompt on stdin  [METANOIA_COMMAND]
  --cwd <dir>         Where to run it (default: here)                [METANOIA_CWD]
  --interval <sec>    Seconds between polls when idle (default 10)   [METANOIA_INTERVAL]
  --timeout <min>     Kill a run after this long (default 30)        [METANOIA_TIMEOUT]
  --once              Take at most one run, then exit
  --help

The token comes from Settings → API tokens, signed in as the agent account.
An admin marks that account an agent in Settings → Members.`;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'once' || key === 'help') out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(HELP); process.exit(0); }

const config = {
  url: (args.url || process.env.METANOIA_URL || '').replace(/\/+$/, ''),
  token: args.token || process.env.METANOIA_TOKEN || '',
  agent: args.agent || process.env.METANOIA_AGENT || 'claude',
  command: args.command || process.env.METANOIA_COMMAND || '',
  cwd: args.cwd || process.env.METANOIA_CWD || process.cwd(),
  interval: Number(args.interval || process.env.METANOIA_INTERVAL || 10) * 1000,
  timeout: Number(args.timeout || process.env.METANOIA_TIMEOUT || 30) * 60_000,
  once: Boolean(args.once),
};

if (!config.url || !config.token) {
  console.error('Need --url and --token (or METANOIA_URL and METANOIA_TOKEN).\n');
  console.error(HELP);
  process.exit(2);
}
if (!config.command && !PRESETS[config.agent]) {
  console.error(`Unknown agent "${config.agent}". Known: ${Object.keys(PRESETS).join(', ')}.`);
  console.error('Or pass --command "<your command>" — it gets the prompt on stdin.');
  process.exit(2);
}

/** The program and argv this run will be given to. A --command is split on
 *  spaces, which is enough for `npx something --flag` and stops short of being
 *  a shell — quoting rules are exactly the surprise nobody wants here. */
function program() {
  return config.command ? config.command.split(/\s+/).filter(Boolean) : PRESETS[config.agent];
}

const api = async (path, init = {}) => {
  const res = await fetch(`${config.url}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${detail.slice(0, 300)}`);
  }
  return res.json();
};

/** Run the CLI on one prompt. Resolves with what it printed and how it ended —
 *  a non-zero exit is an outcome to report, not an exception to throw. */
function runCli(prompt) {
  return new Promise((resolve) => {
    const [cmd, ...argv] = program();
    const child = spawn(cmd, argv, { cwd: config.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      err += `\n[runner] killed after ${config.timeout / 60000} minutes.`;
      child.kill('SIGKILL');
    }, config.timeout);

    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { err += d; process.stderr.write(d); });
    child.on('error', (e) => {
      clearTimeout(timer);
      // ENOENT here means the CLI is not installed or not on PATH, which is the
      // single most common way this goes wrong — say so instead of "failed".
      resolve({ ok: false, out, err: e.code === 'ENOENT' ? `${cmd} is not on your PATH.` : e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out, err: code === 0 ? '' : (err.trim() || `exited ${code}`) });
    });
    child.stdin.end(prompt);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stopping = false;
process.on('SIGINT', () => { console.log('\nStopping after this run…'); stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function main() {
  const me = await api('/me');
  console.log(`[runner] ${me.name || me.email} on ${config.url}`);
  console.log(`[runner] ${config.command || program().join(' ')} in ${config.cwd}`);

  while (!stopping) {
    let run = null;
    try {
      run = await api('/agent/runs/next');
    } catch (e) {
      // A polling loop that dies on one bad response is a loop somebody has to
      // babysit. Say it and try again on the next tick.
      console.error('[runner]', e.message);
      await sleep(config.interval);
      continue;
    }
    if (!run) {
      if (config.once) break;
      await sleep(config.interval);
      continue;
    }

    console.log(`\n[runner] run ${run.id} — ${run.task?.title || run.trigger}`);
    const { ok, out, err } = await runCli(buildPrompt(run));
    try {
      await api(`/agent/runs/${run.id}/result`, {
        method: 'POST',
        body: JSON.stringify({ ok, result: out.trim().slice(-20000), error: err.slice(-2000) }),
      });
      console.log(`[runner] reported ${ok ? 'done' : 'failed'}`);
    } catch (e) {
      // The work happened; only the report failed. Nothing is lost — the run is
      // still 'running' and the instance hands it back to a poller once it goes
      // stale, so the next attempt starts from the same task.
      console.error('[runner] could not report the result:', e.message);
    }
    if (config.once) break;
  }
}

main().catch((e) => { console.error('[runner]', e.message); process.exit(1); });
