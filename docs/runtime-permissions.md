# Runtime Permissions

Astrail hosted runtimes can carry an optional `runtime_policy` object on an MCP server record. The policy is evaluated before Astrail injects credentials or calls an upstream endpoint.

```json
{
  "read_only": true,
  "allow_http_gets": true,
  "allowed_methods": [
    "client.store.getInventory",
    { "pattern": "^GET /store", "regex": true, "match": "method_path" }
  ],
  "blocked_methods": [
    "client.pet.deletePet",
    { "pattern": "delete.*", "regex": true, "match": "operation_id" }
  ],
  "allowed_resources": [
    { "pattern": "^(store|inventory)$", "regex": true, "match": "resource" }
  ],
  "blocked_resources": []
}
```

`allowed_methods` and `blocked_methods` match SDK method names such as `client.store.getInventory`, endpoint IDs, tool names, operation IDs, `METHOD /path`, HTTP methods, paths, resources, and tags. Pattern objects can set `match` to scope matching to one field and `regex: true` for regular expressions.

`read_only` blocks non-read operations. `allow_http_gets` treats `GET`, `HEAD`, and `OPTIONS` as readable when OpenAPI operation metadata is missing. `blocked_methods` and `blocked_resources` win before allow lists.

When a call is denied, Astrail returns an MCP tool result with `status: "permission_denied"`, `error_code: "runtime_permission_denied"`, and a `trace_id`.

These permissions are operational guardrails, not a security boundary. Production servers must still use least-privilege provider credentials, upstream OAuth scopes, and provider-side authorization.
