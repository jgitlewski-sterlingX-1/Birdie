/**
 * Relay Sub-Agent
 *
 * A managed agent scoped to the Relay project. It has full knowledge of the
 * CLAUDE.md operating contract and BUILD_SPEC.md, and operates within those
 * constraints.
 *
 * The orchestrator calls this agent as a tool; this agent uses its own
 * agentic loop with Relay-specific context.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Load Relay's operating contract and build spec at startup
const __dir = dirname(fileURLToPath(import.meta.url));
const relayRoot = resolve(__dir, '../../../relay');

function loadDoc(filename: string): string {
  try {
    return readFileSync(resolve(relayRoot, filename), 'utf-8');
  } catch {
    return `(${filename} not found)`;
  }
}

const claudeMd = loadDoc('CLAUDE.md');
const buildSpec = loadDoc('BUILD_SPEC.md');

const RELAY_SYSTEM_PROMPT = `\
You are the Relay sub-agent, responsible for building and maintaining the Relay \
project inside the Birdie workbench.

Relay is an internal triage workspace for Sterling Lawyers. Your operating \
contract (CLAUDE.md) and full product spec (BUILD_SPEC.md) are loaded below. \
Read them before responding to any task.

The three non-negotiables you must never violate:
1. Per-user isolation (userId on every row, scoped queries + Postgres RLS).
2. Approval-gated outbound actions, atomically logged.
3. The approval log is append-only and immutable.

When you encounter a conflict between CLAUDE.md, BUILD_SPEC.md, or the prototype \
behavior, do NOT silently resolve it — surface the conflict and ask for a \
decision to log in DECISIONS.md.

--- CLAUDE.md ---
${claudeMd}

--- BUILD_SPEC.md ---
${buildSpec}
`;

export async function relayAgent(
  task: string,
  context?: string
): Promise<string> {
  const userContent = context
    ? `Task: ${task}\n\nAdditional context:\n${context}`
    : task;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8096,
    system: RELAY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '(no response from Relay agent)';
}
