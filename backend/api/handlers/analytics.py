import json

import httpx
from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException

from api.deps import get_current_user
from core.config import settings
from models.check_result import CheckResult
from models.endpoint import Endpoint
from models.user import User

router = APIRouter(prefix="/analytics", tags=["analytics"])


async def call_llm(prompt: str) -> str:
    if not settings.LLM_URL:
        raise HTTPException(status_code=501, detail="LLM_URL not configured")

    url = f"{settings.LLM_URL.rstrip('/')}/api/chat"
    headers = {"Content-Type": "application/json"}
    if settings.LLM_KEY:
        headers["Authorization"] = f"Bearer {settings.LLM_KEY}"

    payload = {
        "model": settings.LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"LLM request failed ({resp.status_code})")
        data = resp.json()
        return data.get("message", {}).get("content", "")


@router.get("")
async def get_analytics(
    endpoint_id: str | None = None,
    user: User = Depends(get_current_user),
):
    if not settings.LLM_URL:
        raise HTTPException(
            status_code=501,
            detail="LLM_URL not configured. Set LLM_URL, LLM_KEY, and LLM_MODEL in environment variables.",
        )

    if endpoint_id:
        ep = await Endpoint.get(PydanticObjectId(endpoint_id))
        if not ep:
            raise HTTPException(status_code=404, detail="Endpoint not found")
        endpoints = [ep]
    else:
        endpoints = await Endpoint.find_all().sort("-created_at").to_list()

    endpoint_data = []
    for ep in endpoints:
        results = (
            await CheckResult.find(CheckResult.endpoint_id == ep.id)
            .sort("-checked_at")
            .limit(50)
            .to_list()
        )
        response_times = [r.response_time for r in results if r.response_time is not None]

        endpoint_data.append({
            "name": ep.name,
            "url": ep.url,
            "method": ep.method,
            "status": ep.last_status,
            "is_active": ep.is_active,
            "uptime_percentage": ep.uptime_percentage,
            "total_checks": ep.total_checks,
            "consecutive_failures": ep.consecutive_failures,
            "avg_response_time": round(sum(response_times) / len(response_times)) if response_times else None,
            "min_response_time": min(response_times) if response_times else None,
            "max_response_time": max(response_times) if response_times else None,
            "recent_checks": [
                {
                    "status": r.status,
                    "response_time": r.response_time,
                    "error": r.error,
                    "checked_at": r.checked_at.isoformat(),
                }
                for r in results[:20]
            ],
            "status_breakdown": {
                "up": sum(1 for r in results if r.status == "UP"),
                "down": sum(1 for r in results if r.status == "DOWN"),
                "degraded": sum(1 for r in results if r.status == "DEGRADED"),
            },
        })

    prompt = f"""You are an API reliability engineer analyzing health check data from a monitoring system. Analyze the following endpoint data and provide actionable insights.

DATA:
{json.dumps(endpoint_data, indent=2)}

Provide your analysis in this exact JSON format (no markdown, no code fences, just raw JSON):
{{
  "summary": "One paragraph overall health summary",
  "score": <0-100 health score>,
  "insights": [
    {{
      "type": "warning|info|critical|success",
      "title": "Short title",
      "description": "Detailed explanation and recommendation"
    }}
  ],
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2"]
}}

Focus on:
- Uptime patterns and trends from recent checks
- Response time anomalies (spikes, increasing latency)
- Endpoints at risk of going down
- Performance optimization suggestions
- Any endpoints with concerning error patterns

Be specific with numbers. If there are no issues, say so. Return ONLY the JSON object, nothing else."""

    text = await call_llm(prompt)

    json_str = text.strip()
    fence_start = json_str.find("```")
    if fence_start != -1:
        fence_end = json_str.find("```", fence_start + 3)
        content = json_str[fence_start + 3 : fence_end] if fence_end != -1 else json_str[fence_start + 3 :]
        if content.startswith("json"):
            content = content[4:]
        json_str = content.strip()

    try:
        analysis = json.loads(json_str)
    except json.JSONDecodeError:
        analysis = {"summary": text, "score": None, "insights": [], "recommendations": []}

    from datetime import datetime, timezone

    return {
        "analysis": analysis,
        "endpoint_count": len(endpoints),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
