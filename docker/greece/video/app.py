"""Video service for FixMyStreets (Greece cobrand).

FixMyStreet (App::Controller::GreeceVideo) writes an uploaded clip to the shared videos volume as
incoming/<id>/upload and asks here, POST /transcode {"id": "<id>"}, to check and re-encode it. The
answer is immediate; the work runs in the background, one clip at a time, and its outcome is written
to incoming/<id>/status.json, which FixMyStreet reads when the page asks how it is going:

    {"state": "working"}                                        while it runs
    {"state": "ready", "duration": 31.2, "bytes": 8123456}      ready/<id>.mp4 is written
    {"state": "error", "reason": "too_long" | "not_video" | "failed"}

The clip is untrusted input, so ffprobe and ffmpeg only read local files (protocol whitelist), only
a few container formats are accepted, and each step has a time limit. Output: H.264 at most 1280px
on the long side (720p), AAC mono 96k, faststart, with all metadata (GPS, device) removed.
"""
import json
import logging
import os
import queue
import re
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.environ.get("VIDEO_ROOT", "/var/lib/fms-videos")
MAX_SECONDS = float(os.environ.get("VIDEO_MAX_SECONDS", "45.5"))
FORMATS = {"mov", "mp4", "m4a", "3gp", "3g2", "mj2", "matroska", "webm"}
ID = re.compile(r"^[0-9a-f]{32}$")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("video")
jobs = queue.Queue()


def status(clip_id, **data):
    path = os.path.join(ROOT, "incoming", clip_id, "status.json")
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.replace(tmp, path)


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-protocol_whitelist", "file", "-print_format", "json",
         "-show_format", "-show_streams", path],
        capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        return None
    return json.loads(out.stdout or "{}")


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def decoded_seconds(path):
    """How long the video plays, by decoding it (at most 46 s of it): browser recordings (WebM from
    MediaRecorder) often say nothing about their length."""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-protocol_whitelist", "file", "-i", path, "-t", "46", "-map", "0:v:0",
         "-f", "null", "-", "-progress", "pipe:1", "-nostats"],
        capture_output=True, text=True, timeout=180)
    secs = 0.0
    for line in out.stdout.splitlines():
        if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
            secs = max(secs, num(line.split("=", 1)[1]) / 1e6)
    return secs


def work(clip_id):
    folder = os.path.join(ROOT, "incoming", clip_id)
    src = os.path.join(folder, "upload")
    os.makedirs(os.path.join(ROOT, "ready"), exist_ok=True)
    dst = os.path.join(ROOT, "ready", clip_id + ".mp4")
    tmp = dst + ".part.mp4"
    try:
        info = probe(src)
        fmt = (info or {}).get("format", {})
        names = set((fmt.get("format_name") or "").split(","))
        streams = (info or {}).get("streams", [])
        if not info or not (names & FORMATS) or not any(s.get("codec_type") == "video" for s in streams):
            return status(clip_id, state="error", reason="not_video")
        duration = max([num(fmt.get("duration"))] + [num(s.get("duration")) for s in streams if s.get("codec_type") == "video"])
        if duration <= 0:
            duration = decoded_seconds(src)
            if duration >= 46:
                duration = 999
        if duration <= 0 or duration > MAX_SECONDS:
            return status(clip_id, state="error", reason="too_long" if duration > MAX_SECONDS else "not_video")
        has_audio = any(s.get("codec_type") == "audio" for s in streams)
        cmd = ["ffmpeg", "-v", "error", "-y", "-protocol_whitelist", "file", "-threads", "2", "-i", src,
               "-map", "0:v:0"] + (["-map", "0:a:0"] if has_audio else []) + [
               "-map_metadata", "-1", "-map_chapters", "-1",
               "-vf", "scale='if(gt(iw,ih),min(1280,iw),-2)':'if(gt(iw,ih),-2,min(1280,ih))',format=yuv420p",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-profile:v", "main", "-threads", "2",
               "-movflags", "+faststart"] + (["-c:a", "aac", "-b:a", "96k", "-ac", "1"] if has_audio else ["-an"]) + [tmp]
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if out.returncode != 0 or not os.path.exists(tmp):
            log.warning("ffmpeg failed for %s: %s", clip_id, out.stderr[-500:])
            return status(clip_id, state="error", reason="failed")
        os.replace(tmp, dst)
        status(clip_id, state="ready", duration=round(duration, 1), bytes=os.path.getsize(dst))
        log.info("ready %s %.1fs %d bytes", clip_id, duration, os.path.getsize(dst))
    except subprocess.TimeoutExpired:
        status(clip_id, state="error", reason="failed")
    except Exception:
        log.exception("job %s", clip_id)
        status(clip_id, state="error", reason="failed")
    finally:
        for p in (src, tmp):
            try:
                os.remove(p)
            except OSError:
                pass


def worker():
    while True:
        clip_id = jobs.get()
        work(clip_id)
        jobs.task_done()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def reply(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ok": True, "queued": jobs.qsize()})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/transcode":
            return self.reply(404, {"error": "not found"})
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 1024)
            clip_id = json.loads(self.rfile.read(length) or b"{}").get("id", "")
        except (ValueError, AttributeError):
            clip_id = ""
        if not ID.match(clip_id) or not os.path.exists(os.path.join(ROOT, "incoming", clip_id, "upload")):
            return self.reply(400, {"error": "id"})
        status(clip_id, state="working")
        jobs.put(clip_id)
        self.reply(202, {"queued": jobs.qsize()})


if __name__ == "__main__":
    threading.Thread(target=worker, daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
