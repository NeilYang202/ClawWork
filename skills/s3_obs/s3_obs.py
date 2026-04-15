#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import os
import posixpath
import re
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ENV_FILE_PATH = "/appl/openclaw-server/.env"


@dataclass
class S3Settings:
    endpoint_url: str
    access_key: str
    secret_key: str
    bucket: str

    @classmethod
    def from_env_file(cls, env_file: str = ENV_FILE_PATH) -> "S3Settings":
        env_path = Path(env_file).expanduser()
        if not env_path.is_absolute():
            raise ValueError("ENV_FILE_PATH must be an absolute path")
        if not env_path.exists():
            raise FileNotFoundError(f".env file not found: {env_path}")
        if not env_path.is_file():
            raise ValueError(f".env path is not a file: {env_path}")

        skill_root = Path(__file__).resolve().parent
        resolved_env = env_path.resolve()
        is_inside_skill_dir = False
        try:
            resolved_env.relative_to(skill_root)
            is_inside_skill_dir = True
        except ValueError:
            is_inside_skill_dir = False
        if is_inside_skill_dir:
            raise ValueError(".env file must not be inside skills/s3_obs directory")

        values = _load_env_file(resolved_env)
        endpoint_url = values.get("OBS_URL", "").strip()
        access_key = values.get("OBS_AK", "").strip()
        secret_key = values.get("OBS_SK", "").strip()
        bucket = values.get("OBS_BUCKET", "").strip()

        missing = []
        if not endpoint_url:
            missing.append("OBS_URL")
        if not access_key:
            missing.append("OBS_AK")
        if not secret_key:
            missing.append("OBS_SK")
        if not bucket:
            missing.append("OBS_BUCKET")
        if missing:
            raise ValueError(f"missing required env: {', '.join(missing)}")

        return cls(
            endpoint_url=endpoint_url,
            access_key=access_key,
            secret_key=secret_key,
            bucket=bucket,
        )


def _s3_client(cfg: S3Settings):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=cfg.endpoint_url,
        aws_access_key_id=cfg.access_key,
        aws_secret_access_key=cfg.secret_key,
        region_name="us-east-1",
        verify=True,
        config=Config(s3={"addressing_style": "path"}),
    )


def _safe_slug(value: str, fallback: str) -> str:
    text = (value or "").strip()
    if not text:
        return fallback
    text = re.sub(r"[^a-zA-Z0-9._-]+", "-", text)
    text = text.strip("-._")
    return text or fallback


def _norm_rel_path(base: Path, target: Path) -> str:
    rel = target.resolve().relative_to(base.resolve())
    return rel.as_posix()


def _build_key(user_id: str, session_id: str, rel_file: str) -> str:
    user = _safe_slug(user_id, "unknown-user")
    session = _safe_slug(session_id, "default-session")
    return posixpath.join("users", user, "sessions", session, rel_file)


def _public_download_url(cfg: S3Settings, bucket: str, key: str) -> str:
    endpoint = cfg.endpoint_url.rstrip("/")
    return f"{endpoint}/{bucket}/{key}"


def _load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key:
            values[key] = value
    return values


def _head_bytes(path: Path, size: int = 65536) -> bytes:
    with path.open("rb") as f:
        return f.read(size)


def _looks_text(data: bytes) -> bool:
    if not data:
        return True
    if b"\x00" in data:
        return False
    text = data.decode("utf-8", errors="ignore")
    if not text:
        return False
    printable = sum(ch.isprintable() or ch in "\r\n\t" for ch in text)
    return printable / max(len(text), 1) > 0.95


def _is_csv_text(data: bytes) -> bool:
    if not _looks_text(data):
        return False
    text = data.decode("utf-8", errors="ignore")
    lines = [line for line in text.splitlines()[:20] if line.strip()]
    if len(lines) < 2:
        return False
    delimiter_scores: dict[str, int] = {}
    for delim in [",", ";", "\t", "|"]:
        counts = [line.count(delim) for line in lines]
        if min(counts, default=0) > 0 and len(set(counts)) <= 3:
            delimiter_scores[delim] = sum(counts)
    if not delimiter_scores:
        return False
    best = max(delimiter_scores, key=delimiter_scores.get)
    sample = "\n".join(lines[:5])
    try:
        csv.Sniffer().sniff(sample, delimiters=[best])
        return True
    except csv.Error:
        return False


def detect_extension(path: Path, original_name: str = "") -> str:
    data = _head_bytes(path)

    if data.startswith(b"%PDF-"):
        return ".pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return ".gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    if data.startswith(b"BM"):
        return ".bmp"
    if data.startswith(b"PK\x03\x04") or data.startswith(b"PK\x05\x06") or data.startswith(b"PK\x07\x08"):
        try:
            with zipfile.ZipFile(path, "r") as zf:
                names = set(zf.namelist())
            if "[Content_Types].xml" in names:
                if any(n.startswith("word/") for n in names):
                    return ".docx"
                if any(n.startswith("xl/") for n in names):
                    return ".xlsx"
                if any(n.startswith("ppt/") for n in names):
                    return ".pptx"
            return ".zip"
        except zipfile.BadZipFile:
            return ".zip"
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        lower = original_name.lower()
        if lower.endswith(".doc"):
            return ".doc"
        if lower.endswith(".xls"):
            return ".xls"
        if lower.endswith(".ppt"):
            return ".ppt"
        return ".doc"
    if data.startswith(b"{") or data.startswith(b"["):
        if _looks_text(data):
            return ".json"
    if data.lstrip().lower().startswith(b"<!doctype html") or b"<html" in data.lower():
        return ".html"
    if data.lstrip().startswith(b"<?xml"):
        return ".xml"
    if _is_csv_text(data):
        return ".csv"
    if _looks_text(data):
        return ".txt"

    guessed, _ = mimetypes.guess_type(original_name)
    if guessed:
        ext = mimetypes.guess_extension(guessed)
        if ext:
            return ext
    return ".bin"


def _parse_s3_source(source: str, default_bucket: str, endpoint_url: str) -> tuple[str, str]:
    src = source.strip()
    if src.startswith("s3://") or src.startswith("obs://"):
        parsed = urlparse(src)
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        if not bucket or not key:
            raise ValueError("invalid object uri")
        return bucket, key

    parsed = urlparse(src)
    if parsed.scheme in {"http", "https"}:
        path = parsed.path.lstrip("/")
        if not path:
            raise ValueError("invalid http(s) source")
        endpoint_host = urlparse(endpoint_url).netloc
        req_host = parsed.netloc
        if endpoint_host and req_host and req_host != endpoint_host and req_host.endswith("." + endpoint_host):
            bucket = req_host[: -(len(endpoint_host) + 1)]
            if bucket and path:
                return bucket, path
        parts = path.split("/", 1)
        if len(parts) == 2 and parts[0]:
            return parts[0], parts[1]
        return default_bucket, path

    if src:
        clean = src.lstrip("/")
        if "/" in clean:
            maybe_bucket, maybe_key = clean.split("/", 1)
            if maybe_bucket and maybe_key:
                if maybe_bucket == default_bucket:
                    return default_bucket, maybe_key
                if "." not in maybe_bucket and ":" not in maybe_bucket:
                    return maybe_bucket, maybe_key
        return default_bucket, clean
    raise ValueError("empty source")


def cmd_upload(args: argparse.Namespace) -> dict[str, Any]:
    cfg = S3Settings.from_env_file()
    workspace = Path(args.workspace).expanduser().resolve()
    file_path = Path(args.file).expanduser().resolve()

    if not file_path.exists():
        raise FileNotFoundError(f"file not found: {file_path}")
    if not file_path.is_file():
        raise ValueError(f"not a file: {file_path}")

    rel_file = _norm_rel_path(workspace, file_path)
    key = _build_key(args.user_id, args.session_id, rel_file)

    s3 = _s3_client(cfg)
    content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    with file_path.open("rb") as f:
        resp = s3.put_object(
            Bucket=cfg.bucket,
            Key=key,
            Body=f,
            ContentType=content_type,
        )

    return {
        "ok": True,
        "action": "upload",
        "bucket": cfg.bucket,
        "key": key,
        "size": file_path.stat().st_size,
        "etag": resp.get("ETag", ""),
        "downloadUrl": _public_download_url(cfg, cfg.bucket, key),
        "obsUri": f"s3://{cfg.bucket}/{key}",
        "openclawPath": f"s3://{cfg.bucket}/{key}",
    }


def cmd_download(args: argparse.Namespace) -> dict[str, Any]:
    cfg = S3Settings.from_env_file()
    workspace = Path(args.workspace).expanduser().resolve()
    inbox = workspace / args.inbox_dir
    inbox.mkdir(parents=True, exist_ok=True)

    bucket, key = _parse_s3_source(args.source, cfg.bucket, cfg.endpoint_url)
    s3 = _s3_client(cfg)
    obj = s3.get_object(Bucket=bucket, Key=key)
    body = obj["Body"].read()

    user = _safe_slug(args.user_id, "unknown-user")
    session = _safe_slug(args.session_id, "default-session")
    base_name = _safe_slug(args.target_name or Path(key).name, "downloaded-file")
    temp_path = inbox / f"{base_name}.tmp"
    temp_path.write_bytes(body)

    detected_ext = detect_extension(temp_path, original_name=Path(key).name)
    final_name = base_name if base_name.lower().endswith(detected_ext) else f"{base_name}{detected_ext}"
    final_dir = inbox / user / session
    final_dir.mkdir(parents=True, exist_ok=True)
    final_path = final_dir / final_name
    temp_path.replace(final_path)

    return {
        "ok": True,
        "action": "download",
        "source": args.source,
        "savedPath": str(final_path),
        "detectedExtension": detected_ext,
        "size": final_path.stat().st_size,
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="S3/OBS workspace sync tool")
    sub = parser.add_subparsers(dest="command", required=True)

    up = sub.add_parser("upload", help="Upload workspace file to OBS")
    up.add_argument("--workspace", required=True, help="Workspace root path")
    up.add_argument("--file", required=True, help="Local file absolute path under workspace")
    up.add_argument("--user-id", required=True, help="User id")
    up.add_argument("--session-id", required=True, help="Session id")

    down = sub.add_parser("download", help="Download OBS file to workspace")
    down.add_argument("--workspace", required=True, help="Workspace root path")
    down.add_argument("--source", required=True, help="s3://bucket/key or key or URL")
    down.add_argument("--user-id", required=True, help="User id")
    down.add_argument("--session-id", required=True, help="Session id")
    down.add_argument("--target-name", default="", help="Optional output base name")
    down.add_argument("--inbox-dir", default="inbox", help="Workspace relative inbox dir")

    return parser


def main() -> int:
    parser = _build_parser()
    args = parser.parse_args()
    try:
        if args.command == "upload":
            result = cmd_upload(args)
        elif args.command == "download":
            result = cmd_download(args)
        else:
            raise ValueError(f"unsupported command: {args.command}")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(exc),
                    "command": getattr(args, "command", ""),
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
