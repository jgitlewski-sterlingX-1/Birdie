/**
 * Birdie Master Orchestrator
 *
 * Routes incoming tasks to the correct project sub-agent.
 * Sub-agents are called as tools — the orchestrator decides which agent(s)
 * to invoke and synthesizes a final response.
 */

import Anthropic from '@anthropic-ai/sdk';
import { relayAgent } from './agents/relay.js';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ── Tool definitions ──────────────────────────────────────────────────────────
// Each project sub-agent is exposed as a tool the orchestrator can call.

const tools: Anthropic.Tool[] = [
  {
    name: 'relay_agent',
    description:
      'Delegate a task to the Relay sub-agent. ' +
      'Relay is an internal triage workspace for Sterling Lawyers built on ' +
      'Next.js / TypeScript / GCP. Use this for any task related to the Relay ' +
      'project: building features, reviewing code, answering architecture ' +
      'questions, running phases, or checking on build status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: 'The specific task or question for the Relay sub-agent.',
        },
        context: {
          type: 'string',
          description:
            'Optional additional context to pass to the sub-agent ' +
            '(e.g. file contents, error messages, prior decisions).',
        },
      },
      required: ['task'],
    },
  },
];

// ── Tool dispatcher ───────────────────────────────────────────────────────────

async function dispatchTool(
  name: string,
  input: Record<string, string>
): Promise<string> {
  switch (name) {
    case 'relay_agent':
      return relayAgent(input.task, input.context);
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Orchestrate ───────────────────────────────────────────────────────────────

export async function orchestrate(userTask: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userTask },
  ];

  // Agentic loop — continues until the model stops calling tools
  while (true) {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 8096,
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      tools,
      messages,
    });

    // Append assistant turn
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // Extract final text
      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock ? textBlock.text : '(no response)';
    }

    if (response.stop_reason === 'tool_use') {
      // Execute each tool call and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        console.log(`  → calling ${block.name}...`);
        const result = await dispatchTool(
          block.name,
          block.input as Record<string, string>
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason
    break;
  }

  return '(orchestrator stopped unexpectedly)';
}

// ── System prompt ─────────────────────────────────────────────────────────────

const ORCHESTRATOR_SYSTEM_PROMPT = `\
You are the Birdie Orchestrator — the master agent for the Birdie software \
workbench. Birdie is a collection of product projects, each managed by a \
dedicated sub-agent you can delegate to.

Current projects:
- **Relay** (relay_agent): Internal triage workspace for Sterling Lawyers. \
  Next.js / TypeScript / GCP stack. Has a full build spec and operating contract.

Your job:
1. Understand the user's task or question.
2. Identify which project(s) it concerns.
3. Delegate to the appropriate sub-agent(s) using the available tools.
4. Synthesize the sub-agent results into a clear, actionable response for the user.

Rules:
- Always delegate project-specific work to the correct sub-agent — never attempt \
  to implement code yourself.
- If a task spans multiple projects, call each sub-agent in turn.
- If a task is general (e.g. "what projects are in Birdie?"), answer directly \
  without calling any tool.
- Be concise. Surface blockers and decisions that need human input immediately.
`;
