"""Read-only, opt-in import of Tingji SQLite meetings into Tingo folders.

The full source snapshot is retained beside the native transcript. Audio can be copied with SHA-256 verification; it is never reprocessed.
"""
from __future__ import annotations

import hashlib
from datetime import datetime
import json
import sqlite3
import shutil
import tempfile
from pathlib import Path

from .transcript import Sentence, Transcript


def _json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def import_workbench(database: Path, destination: Path, *, copy_audio: bool = False) -> dict:
    database = database.resolve(strict=True)
    destination.mkdir(parents=True, exist_ok=True)
    result = {"imported": [], "skipped": []}
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute("BEGIN")  # One consistent snapshot, including WAL contents.
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "meetings" not in tables:
            raise ValueError("Not a Tingji workbench database")
        source_meetings = {}
        folder_ids = {}
        for row in db.execute("SELECT * FROM meetings ORDER BY date,id"):
            meeting = dict(row)
            identity = hashlib.sha256(str(meeting["id"]).encode()).hexdigest()[:24]
            stamp = datetime.fromisoformat(meeting["date"]).strftime("%Y-%m-%d_%H%M")
            folder = destination / (stamp + "_tingji-" + identity)
            source_meetings[meeting["id"]] = meeting
            folder_ids[meeting["id"]] = folder.name
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
            lines = ["# " + meeting["title"], "", summary.get("summary", "")]
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
                audio_name = None
                if copy_audio:
                    source = Path(meeting["source"])
                    if not source.is_file():
                        raise FileNotFoundError(f"Missing source audio: {source}")
                    audio_name = "录音" + source.suffix.lower()
                    copied = staging / audio_name
                    shutil.copy2(source, copied)
                    def digest(path):
                        h = hashlib.sha256()
                        with path.open("rb") as stream:
                            for block in iter(lambda: stream.read(1024 * 1024), b""):
                                h.update(block)
                        return h.hexdigest()
                    checksum = digest(source)
                    if digest(copied) != checksum:
                        raise ValueError("Audio copy checksum mismatch")
                    _json(staging / "audio-import.json", {"source": str(source), "file": audio_name, "sha256": checksum, "bytes": copied.stat().st_size})
                if sentences:
                    transcript = Transcript(str(folder / audio_name) if audio_name else meeting["source"], max(s.end_ms for s in sentences), sentences,
                                            {index: label for label, index in speakers.items() if label != "unknown"})
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
        history_path = destination / "questions.json"
        history = json.loads(history_path.read_text()) if history_path.exists() else []
        imported_ids = {q.get("imported_id") for q in history}
        for question in shared.get("questions", []):
            imported_id = "tingji:" + str(question["id"])
            if imported_id in imported_ids:
                continue
            citations = []
            for citation in json.loads(question.get("citations") or "[]"):
                meeting_id = citation.get("meeting_id")
                source = source_meetings.get(meeting_id)
                if not source:
                    continue
                for segment in json.loads(source.get("segments") or "[]"):
                    quote = citation.get("quote", "")
                    if segment.get("segment") == citation.get("segment") and quote and quote in segment.get("text", ""):
                        citations.append({"meeting": folder_ids[meeting_id], "start_ms": max(0, int(float(segment.get("start", 0))*1000)), "quote": quote})
                        break
            history.append({"imported_id": imported_id, "scope": folder_ids.get(question["scope"], question["scope"]),
                            "question": question["question"], "parts": [{"answer": question.get("answer") or question.get("error") or "", "citations": citations}],
                            "sentences_reviewed": 0, "imported_coverage": question.get("coverage", ""), "status": question.get("status"), "created": question.get("created")})
        if shared.get("questions"):
            temporary = history_path.with_suffix(".tmp")
            _json(temporary, history)
            temporary.replace(history_path)
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
