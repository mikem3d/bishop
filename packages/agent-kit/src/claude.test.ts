import { describe, expect, it } from 'vitest';
import { buildPrompt, capabilitiesFromServers, parseMcpList, parseStreamLine, toolLabel } from './claude.js';
import { agentIdFromToken } from './agent-api.js';
import { branchName, slug } from './workdir.js';

describe('stream parsing', () => {
  it('reads init, text, tools, and the result', () => {
    expect(parseStreamLine('{"type":"system","subtype":"init","session_id":"s","mcp_server_errors":[]}')).toEqual([
      { type: 'init', sessionId: 's', mcpErrors: [] },
    ]);
    const a = parseStreamLine(
      JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: ' hi ' }, { type: 'tool_use', name: 'mcp__bishop__comment' }] } }),
    );
    expect(a).toEqual([{ type: 'text', text: 'hi' }, { type: 'tool', name: 'mcp__bishop__comment' }]);
    const r = parseStreamLine('{"type":"result","subtype":"error_max_turns","is_error":true,"total_cost_usd":1.5,"num_turns":30}');
    expect(r[0]).toMatchObject({ type: 'result', summary: { isError: true, subtype: 'error_max_turns', costUsd: 1.5, turns: 30 } });
  });

  it('ignores sub-agent chatter, noise and bad JSON', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'inner' }] } }))).toEqual([]);
    expect(parseStreamLine('not json')).toEqual([]);
    expect(parseStreamLine('{"type":"user"}')).toEqual([]);
  });

  it('labels tools readably', () => {
    expect(toolLabel('mcp__bishop__update_status')).toBe('bishop: update_status');
    expect(toolLabel('Edit')).toBe('Edit');
  });
});

describe('capabilities', () => {
  it('maps MCP server names to routing capabilities', () => {
    const names = parseMcpList('atlassian: https://mcp.atlassian.com - ✓ Connected\ngithub: npx -y gh - ✓ Connected\nbishop: node x - ✓\nChecking MCP server health...\n');
    expect(names).toEqual(['atlassian', 'github']);
    expect(capabilitiesFromServers(names)).toEqual(['code', 'github', 'jira']);
  });
});

describe('naming', () => {
  it('makes safe branch names', () => {
    expect(slug('Fix: checkout retries (double-charge!)')).toBe('fix-checkout-retries-double-charge');
    expect(branchName('0a1b2c3d-1111-2222-3333-444455556666', '???')).toBe('bishop/0a1b2c3d-task');
  });
  it('reads the agent id from a token', () => {
    expect(agentIdFromToken('bsh_0a1b2c3d-1111-2222-3333-444455556666_abc123')).toBe('0a1b2c3d-1111-2222-3333-444455556666');
    expect(agentIdFromToken('nope')).toBeNull();
  });
  it('tells a re-run to read the thread', () => {
    const p = buildPrompt({ taskId: 't', title: 'X', projectName: 'Shop', workdir: '/w', branch: null, isRerun: true });
    expect(p).toContain('This task ran before');
    expect(p).not.toContain('Git branch');
  });
});
