import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { realpathSync } from 'node:fs';
import { checkMaintenance, git } from '../scripts/maintenance.mjs';

export const name = 'project-doc-maintenance';

export function apply(ctx, config) {
  const common = cwd => realpathSync(path.resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir'])));
  const repository = realpathSync(config.repositoryDir);
  const check = async (agent, event) => {
    const cwd = agent.session.header.cwd;
    if (!cwd) return;
    let current;
    try { current = common(cwd); } catch { return; }
    if (current !== repository) return;
    return checkMaintenance({ cwd, session_id: agent.id, event, host: 'dsh' });
  };
  const inject = (agent, text, steer = false) => {
    const message = {
      id: randomUUID(), role: 'user', content: [{ type: 'text', text }],
      source: { kind: 'project-doc-maintenance', form: 'notice', summary: '项目文档维护检查' },
    };
    if (steer) agent.steer(message);
    else agent.inject(message);
  };
  ctx.on('agent/created', async ({ agent }) => {
    const result = await check(agent, 'start');
    if (result?.message) inject(agent, result.message);
  });
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || signal.aborted) return decision;
    const result = await check(agent, 'checkpoint');
    if (result?.message) inject(agent, result.message);
    return decision;
  });
  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    if (signal.aborted) return;
    const result = await check(agent, 'stop');
    if (result?.block) inject(agent, result.message, true);
  });
}
