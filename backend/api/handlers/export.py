import csv
import io
import re
from datetime import datetime

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from fpdf import FPDF

from api.deps import get_current_user
from models.check_result import CheckResult
from models.endpoint import Endpoint
from models.user import User

router = APIRouter(prefix="/export", tags=["export"])


@router.get("/dashboard/pdf")
async def export_dashboard_pdf(user: User = Depends(get_current_user)):
    endpoints = await Endpoint.find_all().sort("-created_at").to_list()

    total = len(endpoints)
    up = sum(1 for e in endpoints if e.last_status == "UP")
    down = sum(1 for e in endpoints if e.last_status == "DOWN")
    degraded = sum(1 for e in endpoints if e.last_status == "DEGRADED")
    avg_uptime = f"{sum(e.uptime_percentage for e in endpoints) / total:.2f}" if total else "100.00"

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 10, "Pulse Dashboard Summary", new_x="LMARGIN", new_y="NEXT")

    pdf.set_draw_color(232, 135, 30)
    pdf.set_line_width(0.8)
    pdf.line(14, pdf.get_y(), pdf.w - 14, pdf.get_y())
    pdf.ln(6)

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(107, 114, 128)
    pdf.cell(0, 6, f"Generated: {datetime.utcnow().isoformat()}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    stats = [
        ("Total Endpoints", str(total)),
        ("UP", str(up)),
        ("DOWN", str(down)),
        ("Avg Uptime", f"{avg_uptime}%"),
    ]
    box_w = (pdf.w - 28 - 18) / 4
    y = pdf.get_y()
    for i, (label, value) in enumerate(stats):
        x = 14 + i * (box_w + 6)
        pdf.set_fill_color(249, 250, 251)
        pdf.set_draw_color(229, 231, 235)
        pdf.rect(x, y, box_w, 24, "FD")
        pdf.set_xy(x, y + 4)
        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(box_w, 8, value, align="C")
        pdf.set_xy(x, y + 14)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(107, 114, 128)
        pdf.cell(box_w, 6, label, align="C")

    pdf.set_y(y + 30)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"Degraded: {degraded}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(0, 8, "All Endpoints", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 7)
    pdf.set_fill_color(232, 135, 30)
    pdf.set_text_color(255, 255, 255)
    col_widths = [30, 50, 18, 20, 20, 42]
    headers = ["Name", "URL", "Status", "Uptime", "Response", "Last Check"]
    for w, h in zip(col_widths, headers):
        pdf.cell(w, 7, h, border=1, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(30, 30, 30)
    for ep in endpoints:
        url_display = ep.url[:47] + "..." if len(ep.url) > 50 else ep.url
        row = [
            ep.name[:30],
            url_display,
            ep.last_status or "PENDING",
            f"{ep.uptime_percentage:.2f}%",
            f"{ep.last_response_time:.0f}ms" if ep.last_response_time else "-",
            ep.last_checked_at.strftime("%Y-%m-%d %H:%M") if ep.last_checked_at else "Never",
        ]
        for w, val in zip(col_widths, row):
            pdf.cell(w, 6, val, border=1)
        pdf.ln()

    buf = io.BytesIO(pdf.output())
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="pulse-dashboard-summary.pdf"'},
    )


@router.get("/endpoints/{endpoint_id}/pdf")
async def export_endpoint_pdf(
    endpoint_id: str,
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    user: User = Depends(get_current_user),
):
    ep = await Endpoint.get(PydanticObjectId(endpoint_id))
    if not ep:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    query = {"endpoint_id": PydanticObjectId(endpoint_id)}
    if from_date or to_date:
        query["checked_at"] = {}
        if from_date:
            query["checked_at"]["$gte"] = datetime.fromisoformat(from_date)
        if to_date:
            query["checked_at"]["$lte"] = datetime.fromisoformat(to_date)

    results = await CheckResult.find(query).sort("-checked_at").limit(500).to_list()

    up_count = sum(1 for r in results if r.status == "UP")
    down_count = sum(1 for r in results if r.status == "DOWN")
    degraded_count = sum(1 for r in results if r.status == "DEGRADED")
    rts = [r.response_time for r in results if r.response_time is not None]
    avg_rt = round(sum(rts) / len(rts)) if rts else 0

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20)
    pdf.cell(0, 10, "Pulse Endpoint Report", new_x="LMARGIN", new_y="NEXT")

    pdf.set_draw_color(232, 135, 30)
    pdf.set_line_width(0.8)
    pdf.line(14, pdf.get_y(), pdf.w - 14, pdf.get_y())
    pdf.ln(6)

    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(107, 114, 128)
    pdf.cell(0, 6, f"Endpoint: {ep.name}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"URL: {ep.url}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Method: {ep.method} | Expected: {ep.expected_status_code}", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, f"Generated: {datetime.utcnow().isoformat()}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    stats = [
        ("Uptime", f"{ep.uptime_percentage:.2f}%"),
        ("UP Checks", str(up_count)),
        ("DOWN Checks", str(down_count)),
        ("Avg Response", f"{avg_rt}ms"),
    ]
    box_w = (pdf.w - 28 - 18) / 4
    y = pdf.get_y()
    for i, (label, value) in enumerate(stats):
        x = 14 + i * (box_w + 6)
        pdf.set_fill_color(249, 250, 251)
        pdf.set_draw_color(229, 231, 235)
        pdf.rect(x, y, box_w, 24, "FD")
        pdf.set_xy(x, y + 4)
        pdf.set_font("Helvetica", "B", 14)
        pdf.set_text_color(30, 30, 30)
        pdf.cell(box_w, 8, value, align="C")
        pdf.set_xy(x, y + 14)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(107, 114, 128)
        pdf.cell(box_w, 6, label, align="C")

    pdf.set_y(y + 30)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, f"Total checks: {len(results)} | Degraded: {degraded_count}", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(30, 30, 30)
    pdf.cell(0, 8, "Check History", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(232, 135, 30)
    pdf.set_text_color(255, 255, 255)
    col_widths = [45, 20, 25, 90]
    headers = ["Time", "Status", "Response", "Error"]
    for w, h in zip(col_widths, headers):
        pdf.cell(w, 7, h, border=1, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(30, 30, 30)
    for r in results[:100]:
        row = [
            r.checked_at.strftime("%Y-%m-%d %H:%M:%S"),
            r.status,
            f"{r.response_time:.0f}ms" if r.response_time else "-",
            (r.error or "-")[:80],
        ]
        for w, val in zip(col_widths, row):
            pdf.cell(w, 6, val, border=1)
        pdf.ln()

    buf = io.BytesIO(pdf.output())
    safe_name = re.sub(r"[^a-zA-Z0-9]", "-", ep.name)
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="pulse-report-{safe_name}.pdf"'},
    )


@router.get("/endpoints/{endpoint_id}/csv")
async def export_endpoint_csv(
    endpoint_id: str,
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    user: User = Depends(get_current_user),
):
    query = {"endpoint_id": PydanticObjectId(endpoint_id)}
    if from_date or to_date:
        query["checked_at"] = {}
        if from_date:
            query["checked_at"]["$gte"] = datetime.fromisoformat(from_date)
        if to_date:
            query["checked_at"]["$lte"] = datetime.fromisoformat(to_date)

    results = await CheckResult.find(query).sort("-checked_at").to_list()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["timestamp", "status", "status_code", "response_time_ms", "error"])
    for r in results:
        writer.writerow([
            r.checked_at.isoformat(),
            r.status,
            r.status_code or "",
            r.response_time or "",
            r.error or "",
        ])

    buf = io.BytesIO(output.getvalue().encode())
    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="endpoint-{endpoint_id}-history.csv"'},
    )
