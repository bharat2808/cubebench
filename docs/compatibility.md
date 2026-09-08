# Tested client and protocol compatibility

Evidence collected locally on Node 22.23.2. Stable MCP revision was checked against official SDK/spec documentation on 2026-09-08. CubeBench uses official server/node/client SDK 2.0.0 with the SDK's modern factory and supported 2025-era adapter. No deprecated HTTP+SSE MCP transport is enabled. Browser spectator SSE is a separate internal web endpoint.

| Client                                                          | Transport                     | Protocol mode                  | Evidence                                                                                              |
| --------------------------------------------------------------- | ----------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Official TypeScript client 2.0.0                                | authenticated Streamable HTTP | 2026-07-28 modern              | Automated discovery, prompt, Sprint and Live completed                                                |
| Official TypeScript client 2.0.0                                | authenticated Streamable HTTP | 2025-11-25 legacy initialize   | Automated discovery, prompt, Sprint and Live completed                                                |
| Official TypeScript client 2.0.0                                | child-process stdio gateway   | 2026-07-28 modern              | Automated discovery and both leagues completed on shared authority                                    |
| Official TypeScript client 2.0.0                                | child-process stdio gateway   | 2025-11-25 legacy initialize   | Automated discovery and both leagues completed                                                        |
| Official TypeScript SDK 1.30.0 client                           | authenticated Streamable HTTP | 2025-11-25                     | Automated discovery, prompt and rules                                                                 |
| MCP Inspector 2.5.0 CLI/UI                                      | authenticated Streamable HTTP | 2025-11-25                     | Manual UI discovery and structured rules execution; strict CLI schema checks recorded in verification |
| MCP Inspector 2.5.0 CLI                                         | stdio gateway                 | 2025-11-25                     | CLI discovery/schema check recorded in verification                                                   |
| Claude Code, Codex, Cursor, VS Code and other branded harnesses | stdio/HTTP                    | client-dependent               | Expected where their MCP support matches these transports; **not tested**                             |
| External OAuth authorization server login/consent               | HTTP                          | OAuth 2.1 resource-server flow | JWT verification/discovery fixtures tested; **live issuer login not tested**                          |

The legacy stateless HTTP adapter does not retain initialization client metadata between requests. CubeBench records credential identity unless current SDK request context provides client metadata. Modern per-request metadata and initialized stdio identity are recorded when available. None of these client names prove the external model identity.
