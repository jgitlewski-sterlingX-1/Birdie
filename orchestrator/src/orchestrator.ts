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

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { DEPARTMENTS } from './control-plane/departments.js';
import { makeCanUseTool } from './control-plane/policy.js';

const __dir = dirname(fileURLToPath(import.meta.url));
// src/ -> ../../managed-agents ; dist/ -> ../../managed-agents
const ceoContract = (() => {
  try {
    return readFileSync(resolve(__dir, '../../managed-agents/ceo-orchestrator.md'), 'utf-8');
  } catch {
    return '(CEO operating contract not found)';
  }
})();

export const CEO_MODEL = 'claude-opus-4-8';

const CEO_SYSTEM_PROMPT = `\
You are the Birdie CEO — the master coordinator of an executive workbench. You
manage five department heads and delegate all real work to them. You have no
tools except delegation (the Agent tool).

--- CEO OPERATING CONTRACT ---
${ceoContract}`;

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
