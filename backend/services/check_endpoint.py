import httpx

from models.endpoint import Endpoint


async def check_endpoint(endpoint: Endpoint) -> dict:
    start = 0
    try:
        headers = dict(endpoint.headers) if endpoint.headers else {}
        body_content = endpoint.body if endpoint.method in ("POST", "PUT", "PATCH") and endpoint.body else None

        async with httpx.AsyncClient(timeout=endpoint.timeout) as client:
            import time
            start = time.monotonic()
            resp = await client.request(
                method=endpoint.method,
                url=endpoint.url,
                headers=headers,
                content=body_content,
            )
            response_time = round((time.monotonic() - start) * 1000, 2)

        if resp.status_code == endpoint.expected_status_code:
            status = "UP"
        elif resp.status_code >= 500:
            status = "DOWN"
        else:
            status = "DEGRADED"

        return {
            "status": status,
            "status_code": resp.status_code,
            "response_time": response_time,
            "error": None,
        }
    except Exception as exc:
        import time
        response_time = round((time.monotonic() - start) * 1000, 2) if start else 0
        return {
            "status": "DOWN",
            "status_code": None,
            "response_time": response_time,
            "error": str(exc),
        }
