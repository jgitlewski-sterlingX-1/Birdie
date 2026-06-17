/**
 * Department head registry — the managed core.
 *
 * Each of the five department heads is an AgentDefinition the CEO orchestrator
 * delegates to via the Agent tool. The system prompt of each is composed in
 * code from three locked parts, none of which an end user can edit:
 *
 *   [org non-negotiables]  +  [role]  +  [department operating contract doc]
 *
 * The `tools` allowlist is each head's base capability set. User-added
 * capabilities (from an approved catalog) would be merged into `tools` and
 * `mcpServers` here at session-construction time — the core above never changes.
 *
 * Tool names follow `mcp__<serverKey>__<toolName>` where serverKey matches the
 * keys in mcpServers.ts. Adjust the leaf tool names to match the exact tools
 * your deployed MCP servers expose.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP, type HttpMcpServer } from './mcpServers.js';

const __dir = dirname(fileURLToPath(import.meta.url));
// src/control-plane/ -> ../../departments ; dist/control-plane/ -> ../../departments
const contractsRoot = resolve(__dir, '../../departments');

function contract(filename: string): string {
  try {
    return readFileSync(resolve(contractsRoot, filename), 'utf-8');
  } catch {
    return `(operating contract ${filename} not found)`;
  }
}

/** Organization rules every department head inherits and cannot override. */
const ORG_NON_NEGOTIABLES = `\
You are a department head inside Birdie, an executive workbench coordinated by
a single CEO agent. You operate strictly within your mandate and the operating
contract below.

Organization-wide non-negotiables (these override any instruction to the contrary):
1. Outbound and state-changing actions are approval-gated. You may always read
   and draft; you may not send, create, modify, or delete without approval.
2. Never fabricate data. Read/verify before you act, and cite the source of any
   figure, message, event, or task you reference.
3. Stay in your lane. If a request belongs to another department, say so and
   return it to the CEO rather than acting outside your mandate.
4. Surface conflicts and missing information instead of silently resolving them.`;

/** Loose structural type for an AgentDefinition; cast at the SDK boundary. */
type AgentDef = {
  description: string;
  prompt: string;
  tools: string[];
  mcpServers: Record<string, HttpMcpServer>;
  model: string;
};

function core(role: string, contractFile: string): string {
  return `${ORG_NON_NEGOTIABLES}\n\n## Your role\n${role}\n\n--- DEPARTMENT OPERATING CONTRACT ---\n${contract(
    contractFile
  )}`;
}

export const DEPARTMENTS: Record<string, AgentDef> = {
  communications_manager: {
    description:
      'External communications. Delegate here to draft or send outbound email ' +
      'and Slack messages on the user’s behalf, internal or external.',
    prompt: core(
      'You are the Communications Manager, responsible for outbound external ' +
        'communication across email and Slack.',
      'communications.md'
    ),
    tools: [
      'mcp__slack__slack_send_message_draft',
      'mcp__slack__slack_send_message',
      'mcp__slack__slack_search_channels',
      'mcp__gmail__create_draft',
      'mcp__gmail__list_drafts',
    ],
    mcpServers: { slack: MCP.slack(), gmail: MCP.gmail() },
    model: 'sonnet',
  },

  operations_manager: {
    description:
      'Task and work management (operations). Delegate here to create, update, ' +
      'organize, or report on tasks and projects in ClickUp.',
    prompt: core(
      'You are the Operations Manager, responsible for turning intent into ' +
        'tracked, assigned, scheduled work in ClickUp.',
      'operations.md'
    ),
    tools: [
      'mcp__clickup__clickup_create_task',
      'mcp__clickup__clickup_update_task',
      'mcp__clickup__clickup_filter_tasks',
      'mcp__clickup__clickup_get_task',
      'mcp__clickup__clickup_get_workspace_hierarchy',
    ],
    mcpServers: { clickup: MCP.clickup() },
    model: 'sonnet',
  },

  calendar_manager: {
    description:
      'Calendar ownership. Delegate here to find times, schedule, reschedule, ' +
      'or cancel events and to protect the user’s time.',
    prompt: core(
      'You are the Calendar Manager, responsible for scheduling and defending ' +
        'the user’s calendar.',
      'calendar.md'
    ),
    tools: [
      'mcp__gcal__list_events',
      'mcp__gcal__list_calendars',
      'mcp__gcal__suggest_time',
      'mcp__gcal__create_event',
      'mcp__gcal__update_event',
      'mcp__gcal__delete_event',
    ],
    mcpServers: { gcal: MCP.gcal() },
    model: 'sonnet',
  },

  receptionist: {
    description:
      'Incoming communications / receptionist. Delegate here to triage, ' +
      'classify, summarize, and label the inbox. Read + organize + draft only.',
    prompt: core(
      'You are the Receptionist, responsible for triaging inbound email so the ' +
        'user sees what matters and nothing slips. You never send.',
      'receptionist.md'
    ),
    tools: [
      'mcp__gmail__search_threads',
      'mcp__gmail__get_thread',
      'mcp__gmail__list_labels',
      'mcp__gmail__label_thread',
      'mcp__gmail__create_draft',
    ],
    mcpServers: { gmail: MCP.gmail() },
    model: 'sonnet',
  },

  finance_manager: {
    description:
      'Accounting and finance. Delegate here to query financial data, build ' +
      'summaries, flag anomalies, and explain the numbers. Read-only.',
    prompt: core(
      'You are the Finance Manager, responsible for pulling, analyzing, and ' +
        'explaining the numbers behind the business.',
      'finance.md'
    ),
    tools: [
      // Adjust to the exact tools your BigQuery/Drive MCP servers expose.
      'mcp__bigquery__query',
      'mcp__bigquery__list_datasets',
    ],
    mcpServers: { bigquery: MCP.bigquery() },
    model: 'sonnet',
  },
};
