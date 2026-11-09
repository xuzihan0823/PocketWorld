import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkMaintenance, acknowledge, git } from './maintenance.mjs';
import { planSetup, applySetup } from './setup-hooks.mjs';
import piAdapter from '../adapters/pi.mjs';
import { apply as dshAdapter } from '../adapters/dsh.mjs';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-maintenance-test-'));
  const root = path.join(parent, 'repo with spaces');
  fs.mkdirSync(root);
  git(root, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(root, 'app.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(root, 'AGENT.md'), '# 项目协作\n');
  git(root, ['add', '--', 'app.ts', 'AGENT.md']);
  git(root, ['-c', 'user.name=Example', '-c', 'user.email=example@users.noreply.github.com', 'commit', '-m', 'test baseline']);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, parent, payload: { cwd: root, session_id: 'session-a', host: 'codex' } };
}

test('变更后定期提醒，结束核对一次，确认后允许结束', async t => {
  const { root, payload } = fixture(t);
  const start = await checkMaintenance({ ...payload, event: 'start' });
  assert.ok(start.message);
  for (let index = 0; index < 12; index += 1) assert.equal((await checkMaintenance({ ...payload, event: 'checkpoint' })).message, '');
  fs.writeFileSync(path.join(root, 'app.ts'), 'export const value = 2;\n');
  for (let index = 0; index < 9; index += 1) assert.equal((await checkMaintenance({ ...payload, event: 'checkpoint' })).message, '');
  assert.ok((await checkMaintenance({ ...payload, event: 'checkpoint' })).message);
  assert.equal((await checkMaintenance({ ...payload, event: 'stop' })).block, true);
  assert.equal((await checkMaintenance({ ...payload, event: 'stop' })).block, false);
  await acknowledge(root, start.token, '已核对内部变更和原 PR', ['AGENT.md']);
  assert.equal((await checkMaintenance({ ...payload, event: 'stop' })).message, '');
  fs.writeFileSync(path.join(root, 'new.ts'), 'export {};\n');
  assert.equal((await checkMaintenance({ ...payload, event: 'stop' })).block, true);
});

test('续跑上限、中断标识和会话隔离', async t => {
  const { root, payload } = fixture(t);
  await checkMaintenance({ ...payload, event: 'start' });
  for (let index = 0; index < 4; index += 1) {
    fs.writeFileSync(path.join(root, 'app.ts'), String(index));
    const result = await checkMaintenance({ ...payload, event: 'stop' });
    assert.equal(result.block, index < 3);
  }
  const other = { ...payload, session_id: 'session-b' };
  const start = await checkMaintenance({ ...other, event: 'start' });
  fs.writeFileSync(path.join(root, 'app.ts'), 'changed');
  assert.equal((await checkMaintenance({ ...other, event: 'stop', stop_hook_active: true })).block, false);
  assert.equal((await checkMaintenance({ ...other, event: 'stop' })).block, true);
  await assert.rejects(acknowledge(root, start.token, '核对', ['../outside.md']));
});

test('worktree 状态隔离，其他任务的确认记录独立', async t => {
  const { root, parent, payload } = fixture(t);
  const otherRoot = path.join(parent, 'other-worktree');
  git(root, ['worktree', 'add', otherRoot, '-b', 'feat/other']);
  const first = await checkMaintenance({ ...payload, event: 'start' });
  await checkMaintenance({ ...payload, cwd: otherRoot, event: 'start' });
  fs.writeFileSync(path.join(root, 'app.ts'), 'changed');
  assert.equal((await checkMaintenance({ ...payload, event: 'stop' })).block, true);
  await acknowledge(otherRoot, first.token, '核对另一工作区');
  assert.ok((await checkMaintenance({ ...payload, event: 'stop' })).message);
  assert.equal((await checkMaintenance({ ...payload, cwd: otherRoot, event: 'stop' })).message, '');
});

test('四宿主注册保留已有配置，重复运行幂等，失效配置在写入前拒绝', t => {
  const { root } = fixture(t);
  const installed = path.join(root, '.agents/skills/project-doc-maintenance');
  fs.cpSync(skill, installed, { recursive: true });
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude/settings.json'), JSON.stringify({
    permissions: { allow: ['Read'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] },
  }));
  const preset = path.join(root, 'agent.cordis.yml');
  fs.writeFileSync(preset, "- id: existing\n  name: existing-plugin\n");
  const hosts = ['codex', 'claude', 'pi', 'dsh'];
  applySetup(root, planSetup(root, installed, hosts, preset));
  assert.equal(planSetup(root, installed, hosts, preset).length, 0);
  const claude = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json')));
  assert.deepEqual(claude.permissions, { allow: ['Read'] });
  assert.equal(claude.hooks.Stop[0].hooks[0].command, 'echo existing');
  assert.ok(fs.readFileSync(preset, 'utf8').startsWith('- id: existing\n'));
  fs.writeFileSync(path.join(root, '.claude/settings.json'), 'invalid');
  assert.throws(() => planSetup(root, installed, hosts, preset));
});

test('命令 hooks 使用官方输入输出协议，并发检查保留计数', async t => {
  const { root, payload } = fixture(t);
  const script = path.join(skill, 'scripts/maintenance.mjs');
  for (const host of ['codex', 'claude']) {
    const invoke = hook_event_name => JSON.parse(execFileSync(process.execPath, [script, '--host', host], {
      cwd: root, encoding: 'utf8', input: JSON.stringify({ ...payload, hook_event_name }),
    }));
    assert.equal(invoke('SessionStart').hookSpecificOutput.hookEventName, 'SessionStart');
    fs.writeFileSync(path.join(root, 'app.ts'), host);
    assert.equal(invoke('Stop').decision, 'block');
    assert.equal(invoke('Stop').decision, undefined);
  }
  const start = await checkMaintenance({ ...payload, session_id: 'parallel', event: 'start' });
  fs.writeFileSync(path.join(root, 'app.ts'), 'parallel');
  await Promise.all(Array.from({ length: 12 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--host', 'codex'], { cwd: root, stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(error)));
    child.stdin.end(JSON.stringify({ ...payload, session_id: 'parallel', hook_event_name: 'PostToolUse' }));
  })));
  const stateDirectory = path.resolve(root, git(root, ['rev-parse', '--git-path', 'project-doc-maintenance']));
  const state = JSON.parse(fs.readFileSync(path.join(stateDirectory, `${start.token}.json`)));
  assert.equal(state.ticks, 2);
});

test('Pi 的原生结束边界续跑一次，错误或中断遵守宿主状态', async t => {
  const { root } = fixture(t);
  const events = new Map();
  const messages = [];
  piAdapter({ on: (name, handler) => events.set(name, handler), sendMessage: message => messages.push(message) });
  const ctx = { cwd: root, sessionManager: { getSessionId: () => 'pi-session' }, ui: { notify() {} } };
  await events.get('session_start')({}, ctx);
  fs.writeFileSync(path.join(root, 'app.ts'), 'pi');
  await events.get('tool_result')({}, ctx);
  const event = { outcome: 'completed', context: { canContinue: true }, entries: [] };
  const result = await events.get('agent_before_settle')(event, ctx);
  assert.equal(result.continue, true);
  assert.equal(result.entries[0].type, 'custom_message');
  assert.equal(await events.get('agent_before_settle')(event, ctx), undefined);
  assert.equal(await events.get('agent_before_settle')({ ...event, outcome: 'aborted' }, ctx), undefined);
  assert.equal(messages.length, 1);
});

test('DSH 的原生插件限定仓库，使用注入与 steering 协调维护', async t => {
  const { root, parent } = fixture(t);
  const events = new Map();
  const injected = [];
  const steering = [];
  dshAdapter({ on: (name, handler) => events.set(name, handler) }, { repositoryDir: path.join(root, '.git') });
  const agent = { id: 'dsh-session', session: { header: { cwd: root } }, inject: item => injected.push(item), steer: item => steering.push(item) };
  await events.get('agent/created')({ agent });
  fs.writeFileSync(path.join(root, 'app.ts'), 'dsh');
  const signal = new AbortController().signal;
  const decision = { kind: 'enter', messages: [] };
  assert.equal(await events.get('agent/pre-step')({ agent, signal }, async () => decision), decision);
  await events.get('agent/turn-stopping')({ agent, signal });
  await events.get('agent/turn-stopping')({ agent, signal });
  assert.equal(steering.length, 1);
  assert.equal(injected[0].source.kind, 'project-doc-maintenance');
  agent.session.header.cwd = parent;
  await events.get('agent/created')({ agent });
  assert.equal(injected.length, 1);
});

test('DSH 运行文件独立于任务 worktree，同一 preset 可维护多个仓库', async t => {
  const { root, parent } = fixture(t);
  const task = path.join(parent, 'task');
  git(root, ['worktree', 'add', task, '-b', 'feat/task']);
  const installed = path.join(task, '.agents/skills/project-doc-maintenance');
  fs.cpSync(skill, installed, { recursive: true });
  const preset = path.join(parent, 'agent.cordis.yml');
  fs.writeFileSync(preset, '- id: existing\n  name: existing-plugin\n');
  applySetup(task, planSetup(task, installed, ['dsh'], preset));
  const text = fs.readFileSync(preset, 'utf8');
  const runtime = JSON.parse(text.match(/  name: ("[^"]+")/)[1]);
  fs.rmSync(task, { recursive: true, force: true });
  assert.ok(fs.existsSync(runtime));
  assert.ok(fs.existsSync(path.resolve(path.dirname(runtime), '../scripts/maintenance.mjs')));
  const other = fixture(t).root;
  const otherSkill = path.join(other, '.agents/skills/project-doc-maintenance');
  fs.cpSync(skill, otherSkill, { recursive: true });
  applySetup(other, planSetup(other, otherSkill, ['dsh'], preset));
  assert.equal(fs.readFileSync(preset, 'utf8').match(/# BEGIN project-doc-maintenance managed/g).length, 2);
});
