import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export function git(root, args) {
  return execFileSync('git', ['--no-pager', '-C', root, ...args], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function snapshot(root) {
  let head = 'unborn';
  try { head = git(root, ['rev-parse', 'HEAD']); } catch {}
  const tracked = head === 'unborn'
    ? git(root, ['ls-files', '-z'])
    : git(root, ['diff', '--no-ext-diff', '--name-only', '-z', 'HEAD']);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const names = [...new Set(`${tracked}\0${untracked}`.split('\0').filter(Boolean))].sort();
  const hash = createHash('sha256').update(head);
  for (const name of names) {
    hash.update(JSON.stringify(name));
    const file = path.join(root, name);
    try {
      const stat = fs.lstatSync(file);
      hash.update(String(stat.mode));
      if (stat.isSymbolicLink()) hash.update(fs.readlinkSync(file));
      else if (stat.isFile()) hash.update(fs.readFileSync(file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('deleted');
    }
  }
  return hash.digest('hex');
}

async function withState(cwd, token, operation) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const directory = path.resolve(root, git(root, ['rev-parse', '--git-path', 'project-doc-maintenance']));
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${token}.json`);
  const lock = `${file}.lock`;
  let descriptor;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      descriptor = fs.openSync(lock, 'wx');
      fs.writeFileSync(descriptor, String(process.pid));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const owner = Number(fs.readFileSync(lock, 'utf8'));
        if (owner > 0) process.kill(owner, 0);
      } catch (ownerError) {
        if (ownerError.code === 'ESRCH') fs.rmSync(lock, { force: true });
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  if (descriptor === undefined) throw new Error('维护状态正在被其他调用更新，请稍后重试');
  try {
    let state = {};
    if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const result = operation(state, root);
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temporary, file);
    return result;
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lock, { force: true });
  }
}

function reminder(token) {
  return `使用 project-doc-maintenance 核对当前改动涉及的规范、接口、交互契约和原 PR 进度，完成必要更新或记录无需调整的理由。核对后运行本技能 scripts/maintenance.mjs ack --session ${token} --note "核对结果与验证说明"，需要时以 --document 指定已核对文档。`;
}

export async function checkMaintenance({ cwd, session_id, agent_id = '', event, host, interval = 10, stop_hook_active = false }) {
  if (!cwd || !session_id) throw new Error('维护 hook 缺少工作目录或会话标识');
  const token = createHash('sha256').update(`${host}\0${session_id}\0${agent_id}`).digest('hex').slice(0, 24);
  return withState(cwd, token, (state, root) => {
    const current = snapshot(root);
    state.host = host;
    state.lastEvent = event;
    state.lastSeen = new Date().toISOString();
    if (!state.snapshot) {
      Object.assign(state, { snapshot: current, pending: false, ticks: 0, blocks: 0 });
      return { token, message: '已启用 project-doc-maintenance。按项目规范开发，变更期间定期核对文档与原 PR，内容合入 main 后及时清理已交付分支。', block: false };
    }
    if (state.snapshot !== current) {
      if (!state.pending) state.ticks = 0;
      state.snapshot = current;
      state.pending = true;
    }
    if (event === 'checkpoint') state.ticks += 1;
    const message = reminder(token);
    if (event === 'stop' && state.pending) {
      const block = !stop_hook_active && state.blockedSnapshot !== current && state.blocks < 3;
      if (block) {
        state.blockedSnapshot = current;
        state.blocks += 1;
      }
      return { token, message, block };
    }
    if (state.pending && (event === 'compact' || state.ticks >= interval)) {
      state.ticks = 0;
      return { token, message, block: false };
    }
    return { token, message: '', block: false };
  });
}

export async function acknowledge(cwd, token, note, documents = []) {
  if (!/^[a-f0-9]{24}$/.test(token) || !note?.trim()) throw new Error('请提供有效会话标识和具体核对说明');
  return withState(cwd, token, (state, root) => {
    if (!state.snapshot) throw new Error('会话尚未收到 hook 事件，请先检查注册和宿主加载状态');
    for (const document of documents) {
      const resolved = fs.realpathSync(path.resolve(root, document));
      const relative = path.relative(root, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(resolved).isFile()) {
        throw new Error('核对文档必须是目标仓库内的文件');
      }
    }
    Object.assign(state, {
      snapshot: snapshot(root), pending: false, ticks: 0, blocks: 0,
      note: note.trim(), documents, reviewedAt: new Date().toISOString(),
    });
    delete state.blockedSnapshot;
  });
}

async function main() {
  const { values, positionals } = parseArgs({ options: {
    host: { type: 'string' }, session: { type: 'string' }, note: { type: 'string' },
    document: { type: 'string', multiple: true }, interval: { type: 'string', default: '10' },
  }, allowPositionals: true });
  if (positionals[0] === 'ack') {
    await acknowledge(process.cwd(), values.session, values.note, values.document);
    process.stdout.write('文档维护核对已记录\n');
    return;
  }
  if (!['codex', 'claude'].includes(values.host)) throw new Error('命令 hook 需要 --host codex 或 claude');
  const interval = Number(values.interval);
  if (!Number.isInteger(interval) || interval < 1) throw new Error('interval 必须为正整数');
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  const events = { SessionStart: 'start', UserPromptSubmit: 'prompt', PostToolUse: 'checkpoint', PreCompact: 'compact', Stop: 'stop' };
  const event = events[payload.hook_event_name];
  if (!event) return;
  const result = await checkMaintenance({ ...payload, event, host: values.host, interval });
  let output = {};
  if (result.block) output = { decision: 'block', reason: result.message };
  else if (result.message && ['SessionStart', 'UserPromptSubmit', 'PostToolUse'].includes(payload.hook_event_name)) {
    output = { hookSpecificOutput: { hookEventName: payload.hook_event_name, additionalContext: result.message } };
  } else if (result.message) output = { systemMessage: result.message };
  process.stdout.write(JSON.stringify(output));
}

if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`project-doc-maintenance hook 失败。${error.message}\n`);
    process.exitCode = 1;
  });
}
