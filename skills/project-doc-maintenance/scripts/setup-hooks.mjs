import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { git } from './maintenance.mjs';

const marker = 'project-doc-maintenance managed';

function read(file) {
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`请先确认配置符号链接的实际维护位置。${file}`);
  return fs.readFileSync(file, 'utf8');
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function jsonHooks(file, command) {
  const before = read(file);
  const config = before === null ? {} : JSON.parse(before);
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error(`配置须为 JSON 对象。${file}`);
  config.hooks ??= {};
  if (Array.isArray(config.hooks) || typeof config.hooks !== 'object' || config.hooks === null) throw new Error(`hooks 须为对象。${file}`);
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreCompact', 'Stop']) {
    const groups = config.hooks[event] ?? [];
    if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group.hooks))) throw new Error(`hook 组格式无效。${file}`);
    config.hooks[event] = groups.map(group => ({
      ...group,
      hooks: group.hooks.filter(hook => !hook.command?.includes('/project-doc-maintenance/scripts/maintenance.mjs')),
    })).filter(group => group.hooks.length);
    config.hooks[event].push({ hooks: [{ type: 'command', command, timeout: 15 }] });
  }
  return { file, before, after: `${JSON.stringify(config, null, 2)}\n` };
}

export function planSetup(root, skill, hosts, preset) {
  const relative = path.relative(root, skill).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('请先将技能安装到目标项目，再从该项目运行注册命令');
  if (!hosts.length || hosts.some(host => !['codex', 'claude', 'pi', 'dsh'].includes(host))) throw new Error('hosts 支持 codex,claude,pi,dsh');
  const changes = [];
  for (const host of new Set(hosts)) {
    if (host === 'codex' || host === 'claude') {
      const directory = host === 'codex' ? '.codex' : '.claude';
      const file = path.join(root, directory, host === 'codex' ? 'hooks.json' : 'settings.json');
      const command = `node "$(git rev-parse --show-toplevel)/${relative}/scripts/maintenance.mjs" --host ${host}`;
      changes.push(jsonHooks(file, command));
    }
    if (host === 'pi') {
      const file = path.join(root, '.pi/extensions/project-doc-maintenance.ts');
      const before = read(file);
      if (before !== null && !before.startsWith(`// ${marker}\n`)) throw new Error(`目标扩展已有其他内容。${file}`);
      const target = path.relative(path.dirname(file), path.join(skill, 'adapters/pi.mjs')).split(path.sep).join('/');
      changes.push({ file, before, after: `// ${marker}\nexport { default } from ${JSON.stringify(target)};\n` });
    }
    if (host === 'dsh') {
      if (!preset) throw new Error('DSH 需要 --dsh-preset 指向当前使用的 agent.cordis.yml');
      const file = path.resolve(preset);
      const before = read(file);
      if (before === null) throw new Error('DSH preset 文件不存在，请确认实际启用的配置');
      const first = before.split('\n').find(line => line.trim() && !line.trim().startsWith('#') && line.trim() !== '---');
      if (first && !first.startsWith('- ')) throw new Error('DSH preset 应为插件行列表，请确认 agent.cordis.yml 的格式');
      const common = fs.realpathSync(path.resolve(root, git(root, ['rev-parse', '--git-common-dir'])));
      const repositoryId = createHash('sha256').update(common).digest('hex').slice(0, 12);
      const runtime = path.join(common, 'project-doc-maintenance/runtime');
      for (const resource of ['adapters/dsh.mjs', 'scripts/maintenance.mjs']) {
        const target = path.join(runtime, resource);
        changes.push({ file: target, before: read(target), after: fs.readFileSync(path.join(skill, resource), 'utf8') });
      }
      const begin = `# BEGIN ${marker} ${repositoryId}`;
      const end = `# END ${marker} ${repositoryId}`;
      const expression = new RegExp(`\\n?${begin}[\\s\\S]*?${end}\\n?`, 'g');
      const base = before.replace(expression, '').trimEnd();
      const plugin = JSON.stringify(path.join(runtime, 'adapters/dsh.mjs'));
      const repository = JSON.stringify(common);
      const after = `${base}\n\n${begin}\n- id: project-doc-maintenance-${repositoryId}\n  name: ${plugin}\n  config:\n    repositoryDir: ${repository}\n${end}\n`;
      changes.push({ file, before, after });
    }
  }
  return changes.filter(change => change.before !== change.after);
}

export function applySetup(root, changes) {
  const backup = path.resolve(root, git(root, ['rev-parse', '--git-path', 'project-doc-maintenance/config-backups']));
  const applied = [];
  try {
    for (const change of changes) {
      if (change.before !== null) {
        const name = `${Date.now()}-${applied.length}-${path.basename(change.file)}`;
        writeAtomic(path.join(backup, name), change.before);
      }
      writeAtomic(change.file, change.after);
      applied.push(change);
    }
  } catch (error) {
    for (const change of applied.reverse()) {
      if (change.before === null) fs.rmSync(change.file, { force: true });
      else writeAtomic(change.file, change.before);
    }
    throw error;
  }
}

function main() {
  const { values } = parseArgs({ options: {
    hosts: { type: 'string', default: 'codex' }, 'dsh-preset': { type: 'string' }, check: { type: 'boolean' },
  } });
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const changes = planSetup(root, skill, values.hosts.split(','), values['dsh-preset']);
  if (values.check) {
    process.stdout.write(changes.length ? '部分 hooks 配置缺失或需要更新\n' : 'hooks 注册配置检查通过\n');
    process.exitCode = changes.length ? 1 : 0;
    return;
  }
  applySetup(root, changes);
  process.stdout.write(`已更新 ${changes.length} 个宿主配置。请按宿主要求信任配置并重载或新建会话，再检查实际 hook 事件。\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    process.stderr.write(`hooks 注册失败。${error.message}\n`);
    process.exitCode = 1;
  }
}
