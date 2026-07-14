from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class AstrailError(Exception):
    def __init__(
        self,
        message: str,
        code: int | None = None,
        data: Any | None = None,
        status: int | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.data = data
        self.status = status


class AstrailClient:
    def __init__(
        self,
        endpoint: str | None = None,
        base_url: str | None = None,
        server_id: str | None = None,
        api_key: str | None = None,
        timeout: float = 30.0,
        headers: dict[str, str] | None = None,
    ):
        if endpoint is None and server_id:
            endpoint = f"{(base_url or '').rstrip('/')}/api/mcp/{server_id}"
        if not endpoint or not (endpoint.startswith("http://") or endpoint.startswith("https://")):
            raise ValueError("AstrailClient requires an endpoint or base_url + server_id.")
        self.endpoint = endpoint
        self.api_key = api_key if api_key is not None else os.environ.get("ASTRAIL_API_KEY")
        self.timeout = timeout
        self.headers = headers or {}
        self._next_id = 1

    def initialize(self) -> dict[str, Any]:
        return self.rpc("initialize", {})

    def list_tools(self) -> list[dict[str, Any]]:
        result = self.rpc("tools/list", {})
        return list(result.get("tools", []))

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        result = self.call_tool_raw(name, arguments)
        return parse_tool_result(result)

    def call_tool_raw(self, name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.rpc("tools/call", {
            "name": name,
            "arguments": arguments or {},
        })

    def call_endpoint(
        self,
        endpoint_id: str,
        arguments: dict[str, Any] | None = None,
        tool_name: str | None = None,
        dynamic: bool = True,
    ) -> Any:
        safe_arguments = arguments or {}
        if tool_name and not dynamic:
            return self.call_tool(tool_name, safe_arguments)
        if tool_name:
            try:
                return self.call_tool("invoke_api_endpoint", {
                    "endpoint_id": endpoint_id,
                    "arguments": safe_arguments,
                })
            except AstrailError as error:
                if error.code == -32601:
                    return self.call_tool(tool_name, safe_arguments)
                raise
        return self.call_tool("invoke_api_endpoint", {
            "endpoint_id": endpoint_id,
            "arguments": safe_arguments,
        })

    def search_docs(self, query: str | dict[str, Any], **kwargs: Any) -> Any:
        if isinstance(query, str):
            payload = {"query": query, **kwargs}
        else:
            payload = {**query, **kwargs}
        return self.call_tool("search_docs", payload)

    def execute(self, code: str | dict[str, Any], **kwargs: Any) -> Any:
        if isinstance(code, str):
            payload = {"code": code, **kwargs}
        else:
            payload = {**code, **kwargs}
        return self.call_tool("execute", payload)

    def rpc(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        request_id = self._next_id
        self._next_id += 1
        body = json.dumps({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }).encode("utf-8")
        headers = {**self.headers, "content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"

        request = Request(self.endpoint, data=body, headers=headers, method="POST")
        status = 200
        try:
            with urlopen(request, timeout=self.timeout) as response:
                status = response.status
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            status = error.code
            raw = error.read().decode("utf-8")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise AstrailError(f"Astrail request failed with HTTP {error.code}.", error.code, raw[:500], error.code) from exc
        except URLError as error:
            raise AstrailError(f"Astrail request failed: {error.reason}", -32000) from error
        except TimeoutError as error:
            raise AstrailError(f"Astrail request timed out after {self.timeout}s.", -32000) from error
        except json.JSONDecodeError as error:
            raise AstrailError(f"Astrail returned a non-JSON response with HTTP {status}.", status, status=status) from error

        rpc_error = payload.get("error")
        if rpc_error:
            raise AstrailError(
                rpc_error.get("message", "Astrail JSON-RPC error."),
                rpc_error.get("code"),
                rpc_error.get("data"),
                status,
            )
        if "result" not in payload:
            raise AstrailError("Astrail returned an empty JSON-RPC result.", -32603, status=status)
        return payload["result"]


def parse_tool_result(result: dict[str, Any]) -> Any:
    if "structuredContent" in result:
        return result["structuredContent"]
    content = result.get("content") or []
    text = ""
    for item in content:
        if isinstance(item, dict) and item.get("type") == "text":
            text = item.get("text", "")
            break
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text
