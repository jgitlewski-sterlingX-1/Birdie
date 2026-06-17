/**
 * MCP server registry — the "base capabilities" control plane.
 *
 * Every tool a department head can reach comes from one of these remote MCP
 * servers. Endpoints and auth are env-driven so the managed core stays in code
 * while deployment config stays out of the repo.
 *
 * Server KEYS here become the tool prefix: a server registered under `slack`
 * exposes its tools to the model as `mcp__slack__<toolName>`. The per-department
 * `tools` allowlists in departments.ts must use those exact names.
 *
 * To wire a real server: set <KEY>_MCP_URL (and optionally <KEY>_MCP_TOKEN) in
 * the orchestrator's .env. Unset servers boot but fail on first call — which is
 * fine for scaffolding and surfaces clearly in the audit log.
 */

export type HttpMcpServer = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
};

function http(urlEnvVar: string, tokenEnvVar?: string): HttpMcpServer {
  const url = process.env[urlEnvVar];
  if (!url) {
    console.warn(
      `[birdie] ${urlEnvVar} is not set — the MCP server it backs will be ` +
        `unavailable until configured.`
    );
  }
  const token = tokenEnvVar ? process.env[tokenEnvVar] : undefined;
  return {
    type: 'http',
    url: url ?? `https://unconfigured.invalid/${urlEnvVar}`,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  };
}

/**
 * Factory functions (not eager values) so an unconfigured server only warns
 * for the departments that actually use it.
 */
export const MCP = {
  gmail: () => http('GMAIL_MCP_URL', 'GMAIL_MCP_TOKEN'),
  gcal: () => http('GCAL_MCP_URL', 'GCAL_MCP_TOKEN'),
  slack: () => http('SLACK_MCP_URL', 'SLACK_MCP_TOKEN'),
  clickup: () => http('CLICKUP_MCP_URL', 'CLICKUP_MCP_TOKEN'),
  bigquery: () => http('BIGQUERY_MCP_URL', 'BIGQUERY_MCP_TOKEN'),
} as const;
