/**
 * Birdie CEO Orchestrator
 *
 * The master agent. It is an executive coordinator: it understands the user's
 * intent and delegates to the right department head(s), then synthesizes the
 * result. It never does department work itself — it has no tools except the
 * Agent (delegation) tool.
 *
 * Built on the Claude Agent SDK. The five department heads are defined in
 * control-plane/departments.ts and exposed to the CEO as subagents. Every leaf
 * tool call they make is gated by control-plane/policy.ts.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { DEPARTMENTS } from './control-plane/departments.js';
import { makeCanUseTool } from './control-plane/policy.js';

const CEO_MODEL = 'claude-opus-4-5';

const CEO_SYSTEM_PROMPT = `\
You are the Birdie CEO — the master coordinator of an executive workbench. You
manage five department heads and delegate all real work to them. You never
perform department work yourself; you have no tools except delegation.

Your department heads (delegate via the Agent tool, by name):
- communications_manager — outbound external email & Slack (draft/send).
- operations_manager — task & work management in ClickUp.
- calendar_manager — scheduling and calendar defense.
- receptionist — inbound email triage, classification, labeling (read/draft only).
- finance_manager — accounting & finance data and analysis (read-only).

How you work:
1. Understand the user's intent.
2. Identify which department head(s) own it.
3. Delegate with a clear, self-contained brief — department heads do NOT share
   your conversation history, so include every fact they need in the delegation.
4. If a task spans departments, delegate to each in turn and coordinate.
5. Synthesize the results into one clear, actionable answer.

Rules:
- Always delegate department-specific work. Never try to do it yourself.
- Outbound and state-changing actions are approval-gated downstream; tell the
  user when something is awaiting approval rather than claiming it's done.
- For general questions ("who are my department heads?"), answer directly.
- Be concise. Surface blockers and decisions needing human input immediately.`;

/**
 * Runs one user task through the CEO and returns the final synthesized text.
 */
export async function orchestrate(userTask: string): Promise<string> {
  let finalText = '';

  const run = query({
    prompt: userTask,
    options: {
      model: CEO_MODEL,
      systemPrompt: CEO_SYSTEM_PROMPT,
      // The CEO can ONLY delegate — no filesystem, bash, or direct tools.
      allowedTools: ['Agent'],
      // The five department heads, each with its own locked core + capabilities.
      agents: DEPARTMENTS as never,
      // Hard guarantee: load NO filesystem config (.claude / CLAUDE.md / settings).
      settingSources: [],
      // Governance funnel: every leaf tool call routes through approval policy.
      canUseTool: makeCanUseTool() as never,
    } as never,
  });

  for await (const message of run) {
    const m = message as { type?: string; result?: string };
    if (m.type === 'result' && typeof m.result === 'string') {
      finalText = m.result;
    }
  }

  return finalText || '(orchestrator produced no result)';
}
