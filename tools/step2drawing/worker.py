"""Queue worker for the portal's R&D → Drawings tab.

Polls public.step_drawing_jobs for queued rows, downloads the STEP file (from the
private `step-drawings` bucket, or for project jobs from the project file itself),
runs step2drawing.make_drawing, uploads the PDF and a PNG preview to out/<job id>/,
and marks the row done (or error). Project jobs (queued by DB triggers once a
project reaches Prototype) also save the PDF to the project's Drive folder as
<drawing number>.pdf via the google-drive edge function.

Runs on the R&D PC because build123d/OpenCascade is too large for Vercel or edge
functions. Started by tools/step-drawings-worker-scheduled.ps1 (Task Scheduler,
at logon + every 5 min, IgnoreNew) which supplies STEP_WORKER_SERVICE_ROLE_KEY.

Stdlib only for HTTP, so it runs in the same venv as step2drawing.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import os
import ssl
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://nvlezbqolzwixquusbfo.supabase.co").rstrip("/")
KEY = os.environ.get("STEP_WORKER_SERVICE_ROLE_KEY", "")
BUCKET = "step-drawings"
TABLE = "step_drawing_jobs"
POLL_SECONDS = 5
STALE_MINUTES = 15  # a 'running' job older than this was orphaned by a crash/reboot
LOG = HERE.parent / "logs" / "step-drawings-worker.log"

# Python 3.13+ enables VERIFY_X509_STRICT, which rejects the office content filter's
# re-signed certificates (no Authority Key Identifier). Chain + hostname checks stay on.
SSL_CTX = ssl.create_default_context()
SSL_CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT


def log(msg: str) -> None:
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}  {msg}"
    print(line, flush=True)
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        if LOG.exists() and LOG.stat().st_size > 2_000_000:
            LOG.replace(LOG.with_suffix(".log.1"))
        with LOG.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def http(method: str, path: str, *, body: bytes | None = None, headers: dict | None = None, timeout: int = 60) -> bytes:
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    h.update(headers or {})
    req = urllib.request.Request(SUPABASE_URL + path, data=body, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as resp:
        return resp.read()


def rest(method: str, query: str, payload: dict | None = None) -> list[dict]:
    raw = http(method, f"/rest/v1/{TABLE}?{query}",
               body=json.dumps(payload).encode() if payload is not None else None,
               headers={"Content-Type": "application/json", "Prefer": "return=representation"})
    return json.loads(raw or b"[]")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def requeue_stale() -> None:
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=STALE_MINUTES)).isoformat()
    rows = rest("PATCH", f"status=eq.running&started_at=lt.{urllib.parse.quote(cutoff)}", {"status": "queued", "started_at": None})
    for r in rows:
        log(f"requeued stale job {r['id']} ({r['file_name']})")


def claim_next() -> dict | None:
    queued = rest("GET", "status=eq.queued&order=created_at.asc&limit=1&select=id")
    if not queued:
        return None
    jid = queued[0]["id"]
    # Conditional update = claim; empty result means another worker got it first.
    rows = rest("PATCH", f"id=eq.{jid}&status=eq.queued", {"status": "running", "started_at": now_iso(), "error": None})
    return rows[0] if rows else None


def object_path(p: str) -> str:
    return "/".join(urllib.parse.quote(seg) for seg in p.split("/"))


def edge(fn: str, payload: dict, timeout: int = 180) -> dict:
    raw = http("POST", f"/functions/v1/{fn}", body=json.dumps(payload).encode(),
               headers={"Content-Type": "application/json"}, timeout=timeout)
    return json.loads(raw or b"{}")


def fetch_step(job: dict) -> bytes:
    """STEP bytes: uploaded to the Drawings tab, or the project file the job came from."""
    if job.get("step_path"):
        return http("GET", f"/storage/v1/object/{BUCKET}/{object_path(job['step_path'])}", timeout=300)
    rows = json.loads(http("GET", f"/rest/v1/files?id=eq.{job['source_file_id']}&select=source,file_url,drive_file_id"))
    if not rows:
        raise ValueError("project file no longer exists")
    f = rows[0]
    if f["source"] == "drive" and f.get("drive_file_id"):
        data = edge("google-drive", {"action": "download_bytes", "drive_file_id": f["drive_file_id"]}, timeout=300)
        if "base64" not in data:
            raise ValueError(f"Drive download failed: {data.get('error') or data}")
        return base64.b64decode(data["base64"])
    req = urllib.request.Request(f["file_url"])
    with urllib.request.urlopen(req, timeout=300, context=SSL_CTX) as resp:
        return resp.read()


def process(job: dict, make_drawing, render_preview, fmt) -> None:
    jid = job["id"]
    log(f"start {jid} {job['file_name']}")
    with tempfile.TemporaryDirectory(prefix="step2drawing-") as tmp:
        tmp = Path(tmp)
        step = tmp / f"{job['part_name']}{Path(job['file_name']).suffix.lower() or '.step'}"
        step.write_bytes(fetch_step(job))

        pdf = tmp / f"{job['part_name']}.pdf"
        info = make_drawing(step, pdf, drawn_by=job.get("drawn_by") or "",
                            material=job.get("material") or "", finish=job.get("finish") or "",
                            date=dt.date.today().strftime("%d/%m/%Y"), logo=HERE / "assets" / "aga-logo.png")
        png = render_preview(pdf, dpi=130)

        out_pdf = f"out/{jid}/{pdf.name}"
        out_png = f"out/{jid}/{png.name}"
        for local, remote, ctype in ((pdf, out_pdf, "application/pdf"), (png, out_png, "image/png")):
            http("POST", f"/storage/v1/object/{BUCKET}/{object_path(remote)}", body=local.read_bytes(),
                 headers={"Content-Type": ctype, "x-upsert": "true"}, timeout=300)

        if job.get("project_id"):  # project drawing → its Drive folder, named by drawing number
            res = edge("google-drive", {"action": "save_drawing", "project_id": job["project_id"],
                                        "filename": pdf.name, "base64": base64.b64encode(pdf.read_bytes()).decode()})
            log(f"drive {jid} {pdf.name}: {res.get('error') or res.get('skipped') or ('replaced' if res.get('replaced') else 'saved')}")

    holes = ", ".join(f"{q}× Ø{fmt(d)}" if q > 1 else f"Ø{fmt(d)}" for q, d in info["holes"])
    rest("PATCH", f"id=eq.{jid}", {
        "status": "done", "finished_at": now_iso(), "pdf_path": out_pdf, "png_path": out_png,
        "scale": info["scale"], "envelope": " × ".join(fmt(v) for v in info["size"]),
        "holes": holes or None, "error": None,
    })
    log(f"done  {jid} scale {info['scale']}")


def main() -> int:
    if not KEY:
        log("STEP_WORKER_SERVICE_ROLE_KEY is not set")
        return 1
    log("worker starting (loading build123d)")
    from step2drawing import fmt, make_drawing, render_preview  # slow import, once

    log("worker ready")
    last_stale_check = 0.0
    while True:
        try:
            if time.monotonic() - last_stale_check > 60:
                requeue_stale()
                last_stale_check = time.monotonic()
            job = claim_next()
            if not job:
                time.sleep(POLL_SECONDS)
                continue
            try:
                process(job, make_drawing, render_preview, fmt)
            except Exception as exc:  # job-level failure: record it, keep serving
                msg = str(exc) or exc.__class__.__name__
                if "no geometry" not in msg:
                    log(traceback.format_exc())
                log(f"error {job['id']}: {msg}")
                rest("PATCH", f"id=eq.{job['id']}", {"status": "error", "finished_at": now_iso(), "error": msg[:500]})
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:  # network blip
            log(f"network: {exc}")
            time.sleep(30)


if __name__ == "__main__":
    sys.exit(main())
