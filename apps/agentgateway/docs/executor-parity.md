# Executor Parity Notes

Last updated: 2026-07-12

Executor positions itself as an open integration layer that connects agents to MCP servers, OpenAPI specs, GraphQL APIs, Google Discovery APIs, and plugin-backed toolkits across cloud, CLI, desktop, and self-hosted surfaces.

Astrail should not copy that product shape blindly. Astrail's stronger wedge is the hosted deterministic runtime: one generated MCP endpoint, endpoint-map execution, managed auth boundaries, billing limits, logs, SDK export, and no-eval Code Mode. Parity work should pull in the useful source coverage from Executor while keeping Astrail's runtime stricter.

## Built Now

- OpenAPI and Swagger URL/raw import.
- Swagger UI, Redoc, and docs-page discovery.
- Google Discovery REST document import, including common Discovery parameters, schemas, OAuth scopes, and API-key security.
- GraphQL introspection JSON import, including query/mutation endpoint maps and variable-only tool inputs.
- Static tools, dynamic catalog tools, and Code Mode.
- Hosted MCP endpoint with endpoint-map execution.
- SDK export and first-party TypeScript/Python clients with timeout, custom headers, environment API-key fallback, and structured errors.

## Executor Gaps To Close

- GraphQL live URL introspection and SDL import.
- Existing MCP-server ingestion so Astrail can front external MCP servers with auth, policy, billing, and logs.
- Rich policy UI for allow, approval-required, and blocked tools.
- Local CLI for install, status, tool search, and test calls.
- Desktop/self-host packaging after the hosted path has regression coverage.

## Product Rule

Only claim a source type as supported when it can generate a real endpoint map and pass local generation smoke tests. Roadmap items can be named, but they should not appear as completed capabilities in public copy.
