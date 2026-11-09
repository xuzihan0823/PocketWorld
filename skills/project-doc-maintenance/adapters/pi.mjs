import { checkMaintenance } from '../scripts/maintenance.mjs';

export default function projectDocMaintenance(pi) {
  const check = (ctx, event) => checkMaintenance({
    cwd: ctx.cwd, session_id: ctx.sessionManager.getSessionId(), host: 'pi', event,
  });
  const message = content => ({ customType: 'project-doc-maintenance', content, display: false });

  pi.on('session_start', async (_event, ctx) => {
    const result = await check(ctx, 'start');
    if (result.message) pi.sendMessage(message(result.message));
  });
  pi.on('tool_result', async (_event, ctx) => {
    const result = await check(ctx, 'checkpoint');
    if (result.message) pi.sendMessage(message(result.message));
  });
  pi.on('session_before_compact', async (_event, ctx) => {
    const result = await check(ctx, 'compact');
    if (result.message) pi.sendMessage(message(result.message));
  });
  pi.on('agent_before_settle', async (event, ctx) => {
    if (event.outcome !== 'completed' || !event.context.canContinue) return;
    const result = await check(ctx, 'stop');
    if (result.block) return {
      entries: [...event.entries, { type: 'custom_message', ...message(result.message) }],
      continue: true,
    };
    if (result.message) ctx.ui?.notify(result.message, 'warning');
  });
}
