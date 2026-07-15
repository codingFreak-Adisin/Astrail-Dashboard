# Astrail MCP Code Mode Eval

Status: **PASS**

Generated at: 2026-07-14T20:40:50.202Z

Base URL: `http://localhost:3217`

## Summary

| Metric | Value |
| --- | ---: |
| Tasks passed | 9/9 |
| Completeness | 100.0% |
| Average turns | 1.89 |
| Unexpected error rate | 0.0% |
| Average latency | 492 ms |
| Deterministic exactness checks | 32 |

## Task Results

| Status | Task | Mode | Turns | Latency | Failed checks |
| --- | --- | --- | ---: | ---: | --- |
| PASS | `static.helpdesk.list_tickets` | static | 2 | 392 ms | - |
| PASS | `static.helpdesk.validation` | static | 1 | 21 ms | - |
| PASS | `dynamic.helpdesk.catalog_invoke` | dynamic | 3 | 277 ms | - |
| PASS | `dynamic.helpdesk.invalid_arguments` | dynamic | 2 | 25 ms | - |
| PASS | `static.helpdesk.auth_required` | static | 1 | 13 ms | - |
| PASS | `code.helpdesk.search_execute` | code | 3 | 884 ms | - |
| PASS | `code.petstore.public_demo` | code | 3 | 2691 ms | - |
| PASS | `code.helpdesk.typecheck` | code | 1 | 72 ms | - |
| PASS | `code.helpdesk.sandbox_runtime_block` | code | 1 | 50 ms | - |

## Metric Notes

- Completeness: fraction of tasks whose required checks passed.
- Efficiency/turn count: MCP JSON-RPC calls made by the task flow, excluding fixture generation.
- Unexpected error rate: tasks with failed checks, excluding expected validation/typecheck failures that returned the correct structured error.
- Latency: wall-clock HTTP latency observed by the harness for MCP calls.
- Deterministic exactness: exact checks against stable fields such as echoed arguments, SDK method names, execution model, and error codes.
