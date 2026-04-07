import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_current_user
from models.user import User

router = APIRouter(prefix="/discover", tags=["discover"])

SPEC_PATHS = [
    "/openapi.json",
    "/swagger.json",
    "/api-docs",
    "/docs/openapi.json",
    "/v1/openapi.json",
    "/v2/openapi.json",
    "/v3/openapi.json",
    "/swagger/v1/swagger.json",
    "/api/openapi.json",
    "/api/swagger.json",
    "/api/v1/openapi.json",
    "/.well-known/openapi.json",
]

HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head"}


class DiscoverRequest(BaseModel):
    base_url: str


def parse_endpoints(spec: dict, base_url: str) -> list[dict]:
    paths = spec.get("paths", {})
    resolved_base = base_url.rstrip("/")

    if spec.get("servers") and spec["servers"][0].get("url"):
        server_url = spec["servers"][0]["url"].rstrip("/")
        if server_url.startswith("http"):
            resolved_base = server_url
        elif not resolved_base.endswith(server_url):
            resolved_base = resolved_base + server_url
    elif spec.get("host"):
        scheme = (spec.get("schemes") or ["https"])[0]
        resolved_base = f"{scheme}://{spec['host']}{spec.get('basePath', '')}".rstrip("/")

    try:
        from urllib.parse import urlparse
        parsed = urlparse(resolved_base)
        base_path = parsed.path.rstrip("/")
        origin = f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        base_path = ""
        origin = resolved_base

    endpoints = []
    for path, methods in paths.items():
        for method, details in methods.items():
            if method.lower() not in HTTP_METHODS:
                continue
            if base_path and path.startswith(base_path):
                full_url = f"{origin}{path}"
            else:
                full_url = f"{resolved_base}{path}"
            endpoints.append({
                "method": method.upper(),
                "path": path,
                "full_url": full_url,
                "summary": details.get("summary") or details.get("description") or "",
                "operation_id": details.get("operationId") or "",
            })

    endpoints.sort(key=lambda e: (0 if e["method"] == "GET" else 1, e["path"]))
    return endpoints


@router.post("")
async def discover_api(body: DiscoverRequest, user: User = Depends(get_current_user)):
    normalized = body.base_url.rstrip("/")

    async with httpx.AsyncClient(timeout=8) as client:
        for spec_path in SPEC_PATHS:
            url = f"{normalized}{spec_path}"
            try:
                resp = await client.get(url, headers={"Accept": "application/json"})
                if resp.status_code != 200:
                    continue
                content_type = resp.headers.get("content-type", "")
                if "json" not in content_type:
                    continue
                spec = resp.json()
                if not isinstance(spec.get("paths"), dict):
                    continue

                endpoints = parse_endpoints(spec, normalized)
                return {
                    "spec_url": url,
                    "api_title": spec.get("info", {}).get("title", "Unknown API"),
                    "api_version": spec.get("info", {}).get("version", ""),
                    "endpoints": endpoints,
                }
            except Exception:
                continue

    raise HTTPException(
        status_code=404,
        detail="Could not find an OpenAPI/Swagger spec. Tried common paths like /openapi.json, /swagger.json, /api-docs.",
    )
