"""Read-only, opt-in import of Tingji SQLite meetings into Tingo folders.

The full source snapshot is retained beside the native transcript. Audio is not
copied or reprocessed; callers can choose to import it separately.
"""
from __future__ import annotations

import hashlib
from datetime import datetime
import json
import sqlite3
import tempfile
from pathlib import Path

from .transcript import Sentence, Transcript


def _json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def import_workbench(database: Path, destination: Path) -> dict:
    database = database.resolve(strict=True)
    destination.mkdir(parents=True, exist_ok=True)
    result = {"imported": [], "skipped": []}
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute("BEGIN")  # One consistent snapshot, including WAL contents.
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "meetings" not in tables:
            raise ValueError("Not a Tingji workbench database")
        for row in db.execute("SELECT * FROM meetings ORDER BY date,id"):
            meeting = dict(row)
            identity = hashlib.sha256(str(meeting["id"]).encode()).hexdigest()[:24]
            stamp = datetime.fromisoformat(meeting["date"]).strftime("%Y-%m-%d_%H%M")
            folder = destination / (stamp + "_tingji-" + identity)
            if folder.exists():
                result["skipped"].append(meeting["id"])
                continue
            snapshot = {"version": 1, "meeting": meeting}
            for table in ("tasks", "term_annotations", "asr_originals"):
                snapshot[table] = [dict(r) for r in db.execute(
                    f"SELECT * FROM {table} WHERE meeting_id=?", (meeting["id"],)
                )] if table in tables else []
            snapshot["questions"] = [dict(r) for r in db.execute(
                "SELECT * FROM questions WHERE scope=?", (meeting["id"],)
            )] if "questions" in tables else []
            segments = json.loads(meeting.get("dialogue") or "[]") or json.loads(meeting.get("segments") or "[]")
            sentences = []
            speakers = {}
            for i, segment in enumerate(segments):
                label = str(segment.get("speaker", "unknown"))
                speaker = speakers.setdefault(label, len(speakers))
                start = max(0, int(float(segment.get("start", 0)) * 1000))
                fallback = segments[i + 1].get("start", segment.get("start", 0)) if i + 1 < len(segments) else segment.get("start", 0)
                end = max(start, int(float(segment.get("end", fallback)) * 1000))
                sentences.append(Sentence(speaker, start, end, segment["text"]))
            if not sentences and meeting.get("transcript"):
                sentences = [Sentence(0, 0, 0, meeting["transcript"])]
            summary = json.loads(meeting.get("summary") or "{}")
            lines = ["# " + meeting["title"], "", summary.get("summary", ""), "", "## 待办", ""]
            lines += ["", "## 决定", ""]
            lines += ["- " + item.get("text", "") for item in summary.get("decisions", [])]
            for topic in summary.get("topics", []):
                lines += ["", "## " + topic.get("title", ""), ""]
                lines += ["- " + point.get("text", "") for point in topic.get("points", [])]
            lines += ["", "## 遗留问题与风险", ""]
            lines += ["- " + item.get("text", "") for item in summary.get("risks", [])]
            insight_lines = []
            for key, label in [("diagnosis", "全局诊断"), ("observations", "关键洞察"), ("scenarios", "未来推演"), ("recommendations", "决策建议"), ("questions", "值得追问")]:
                for section in summary.get("insights", {}).get(key, []):
                    insight_lines += [label + " · " + section.get("title", "")]
                    insight_lines += ["- " + point.get("text", "") for point in section.get("points", [])]
            if insight_lines:
                lines += ["", "## AI 分析与建议（非会议决定）", "", *insight_lines]
            lines += ["", "## 待办", ""]
            for task in snapshot["tasks"]:
                lines.append(f"- [{'x' if task['done'] else ' '}] {task['text']}（{task['owner']} · {task['due']}）")
            # Publish each complete meeting atomically; failure leaves no partial folder.
            with tempfile.TemporaryDirectory(prefix=".tingji-", dir=destination) as tmp:
                staging = Path(tmp) / "meeting"
                staging.mkdir()
                _json(staging / "tingji-source.json", snapshot)
                _json(staging / "workbench.json", {
                    "confirmed": bool(meeting.get("confirmed")),
                    "tasks": [{"text": t["text"], "owner": t["owner"], "due": t["due"], "done": bool(t["done"])} for t in snapshot["tasks"]],
                    "imported_insights": summary.get("insights", {}),
                    "insights": {"parts": [{"answer": "\n".join(insight_lines), "citations": []}], "sentences_reviewed": len(sentences)},
                    "corrections": snapshot["term_annotations"],
                    "questions": snapshot["questions"],
                })
                if snapshot["asr_originals"]:
                    _json(staging / "tingji-original.json", snapshot["asr_originals"][0])
                _json(staging / "meta.json", {"title": meeting["title"], "tags": [meeting.get("category") or meeting.get("project") or "未分类"], "archived": False})
                if sentences:
                    transcript = Transcript(meeting["source"], max(s.end_ms for s in sentences), sentences)
                    transcript.save(staging / "transcript.json")
                    (staging / "转写.md").write_text(transcript.to_markdown(), encoding="utf-8")
                if summary:
                    (staging / "纪要.md").write_text("\n".join(lines), encoding="utf-8")
                staging.rename(folder)
            result["imported"].append(meeting["id"])
        # Global records remain separate: never pretend global answers are meeting-scoped.
        shared = {}
        for table in ("glossary", "questions"):
            if table in tables:
                shared[table] = [dict(r) for r in db.execute(f"SELECT * FROM {table}")]
        glossary_path = destination / "glossary.json"
        if not glossary_path.exists():
            glossary = []
            for term in shared.get("glossary", []):
                if term.get("deleted"):
                    continue
                glossary.append({"name": term["term"], "aliases": json.loads(term.get("names") or "[]"),
                                 "errors": [term["alias"]] if term.get("alias") else [], "enabled": bool(term.get("enabled", 1))})
            with glossary_path.open("x", encoding="utf-8") as stream:
                json.dump(glossary, stream, ensure_ascii=False, indent=2)
        shared_path = destination / "tingji-shared-snapshot.json"
        if not shared_path.exists():
            with shared_path.open("x", encoding="utf-8") as stream:
                json.dump(shared, stream, ensure_ascii=False, indent=2)
    return result
