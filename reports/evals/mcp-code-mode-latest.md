# Astrail MCP Code Mode Eval

Status: **PASS**

Generated at: 2026-07-07T14:10:54.182Z

Base URL: `http://localhost:3217`

## Summary

| Metric | Value |
| --- | ---: |
| Tasks passed | 9/9 |
| Completeness | 100.0% |
| Average turns | 1.67 |
| Unexpected error rate | 0.0% |
| Average latency | 388 ms |
| Deterministic exactness checks | 32 |

## Task Results

| Status | Task | Mode | Turns | Latency | Failed checks |
| --- | --- | --- | ---: | ---: | --- |
| PASS | `static.helpdesk.list_tickets` | static | 2 | 727 ms | - |
| PASS | `static.helpdesk.validation` | static | 1 | 42 ms | - |
| PASS | `dynamic.helpdesk.catalog_invoke` | dynamic | 3 | 449 ms | - |
| PASS | `dynamic.helpdesk.invalid_arguments` | dynamic | 2 | 53 ms | - |
| PASS | `static.helpdesk.auth_required` | static | 1 | 43 ms | - |
| PASS | `code.helpdesk.search_execute` | code | 2 | 591 ms | - |
| PASS | `code.petstore.public_demo` | code | 2 | 1534 ms | - |
| PASS | `code.helpdesk.typecheck` | code | 1 | 42 ms | - |
| PASS | `code.helpdesk.sandbox_runtime_block` | code | 1 | 10 ms | - |

## Metric Notes

- Completeness: fraction of tasks whose required checks passed.
- Efficiency/turn count: MCP JSON-RPC calls made by the task flow, excluding fixture generation.
- Unexpected error rate: tasks with failed checks, excluding expected validation/typecheck failures that returned the correct structured error.
- Latency: wall-clock HTTP latency observed by the harness for MCP calls.
- Deterministic exactness: exact checks against stable fields such as echoed arguments, SDK method names, execution model, and error codes.
