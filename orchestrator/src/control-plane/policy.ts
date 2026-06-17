/**
 * Approval policy — the governance funnel.
 *
 * Every tool call any department head attempts passes through `canUseTool`
 * before it runs. Read-only tools auto-allow; anything that mutates state or
 * sends something outbound is routed to `requestApproval`, which is where your
 * workbench UI plugs in (the "approval inbox").
 *
 * This is the layer that makes outbound actions approval-gated — a Birdie
 * non-negotiable carried over from the Relay contract.
 */

/** Tools whose names look purely read-only — safe to auto-allow. */
const READ_ONLY = /(^|__|_)(search|read|list|get|find|filter|suggest|metadata|resolve|hierarchy|members)(_|$)/i;

/** Tools that mutate state or send something outbound — require approval. */
const MUTATING = /(send|create|update|delete|draft|attach|schedule|move|merge|remove|add|start|stop|respond|copy|label|unlabel)/i;

export type ApprovalRequest = {
  toolName: string;
  input: Record<string, unknown>;
  agentID?: string;
  toolUseID?: string;
};

export type ApprovalDecision = {
  approved: boolean;
  reason?: string;
  /** Optional edited input the human approved instead of the original. */
  editedInput?: Record<string, unknown>;
};

function classify(toolName: string): 'allow' | 'review' {
  if (MUTATING.test(toolName)) return 'review';
  if (READ_ONLY.test(toolName)) return 'allow';
  // Unknown verb → fail safe: require review.
  return 'review';
}

/**
 * The seam your workbench implements. Default behavior is controlled by
 * BIRDIE_APPROVAL_MODE so the orchestrator is safe out of the box:
 *   - "deny"  (default): park the request and deny — nothing outbound happens
 *                        until a real approver is wired in.
 *   - "allow"          : auto-approve (dev only).
 *
 * Replace this with a call into your approval inbox (await a human, then
 * resolve). Every call is logged for the audit trail regardless of mode.
 */
export async function requestApproval(
  req: ApprovalRequest
): Promise<ApprovalDecision> {
  const mode = (process.env.BIRDIE_APPROVAL_MODE ?? 'deny').toLowerCase();
  console.log(
    `[birdie:approval] ${req.agentID ?? 'agent'} → ${req.toolName} ` +
      `(mode=${mode}) input=${JSON.stringify(req.input)}`
  );
  if (mode === 'allow') {
    return { approved: true };
  }
  return {
    approved: false,
    reason:
      'Outbound/mutating action requires approval. No approver is wired in ' +
      '(BIRDIE_APPROVAL_MODE=deny). Connect the workbench approval inbox to ' +
      'requestApproval() to enable this action.',
  };
}

/**
 * Builds the `canUseTool` callback passed to the SDK `query()`. Kept loosely
 * typed at the boundary so it stays compatible across SDK minor versions.
 */
export function makeCanUseTool() {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    ctx: { toolUseID?: string; agentID?: string }
  ): Promise<
    | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
    | { behavior: 'deny'; message: string }
  > => {
    // Delegation itself (the Agent tool) is always allowed — it's how the CEO
    // routes work; the real gating happens on the leaf tools each head calls.
    if (toolName === 'Agent') return { behavior: 'allow' };

    if (classify(toolName) === 'allow') {
      return { behavior: 'allow' };
    }

    const decision = await requestApproval({
      toolName,
      input,
      agentID: ctx.agentID,
      toolUseID: ctx.toolUseID,
    });
    return decision.approved
      ? { behavior: 'allow', updatedInput: decision.editedInput ?? input }
      : {
          behavior: 'deny',
          message: decision.reason ?? 'Denied by approval policy.',
        };
  };
}
