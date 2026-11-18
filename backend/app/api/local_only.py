"""`require_local_ui`: FastAPI dependency for routes that may only be called from this computer.

Why (decision D18): the backend listens on `0.0.0.0` with open CORS and no authentication, so without this guard any
device on the network, or any web page open in the browser, could trigger sensitive routes.

Rules (architecture.md 14.2):
1. The peer address must be `127.0.0.1` or `::1`.
2. If the request carries an `Origin` header, its host must be `localhost` or `127.0.0.1` (any port).
Otherwise: `403 { "detail": "...", "code": "local_only" }`.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import HTTPException, Request

LOCAL_ONLY_DETAIL = "Esta ação só pode ser feita neste computador."

_LOCAL_PEERS = frozenset({"127.0.0.1", "::1", "::ffff:127.0.0.1"})
_LOCAL_ORIGIN_HOSTS = frozenset({"localhost", "127.0.0.1"})


def _forbidden() -> HTTPException:
    return HTTPException(status_code=403, detail={"detail": LOCAL_ONLY_DETAIL, "code": "local_only"})


def _origin_is_local(origin: str) -> bool:
    try:
        host = urlsplit(origin).hostname
    except ValueError:
        return False
    return host is not None and host.lower() in _LOCAL_ORIGIN_HOSTS


async def require_local_ui(request: Request) -> None:
    client = request.client
    peer = client.host if client is not None else None
    if peer not in _LOCAL_PEERS:
        raise _forbidden()
    origin = request.headers.get("origin")
    if origin is not None and not _origin_is_local(origin):
        raise _forbidden()
