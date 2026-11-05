import json
import sqlite3
from tingo.workbench_import import import_workbench
from tingo.transcript import Transcript


def test_import_preserves_state_and_never_overwrites(tmp_path):
    source = tmp_path / 'source.sqlite3'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE meetings(id,title,date,source,transcript,segments,summary,confirmed)')
        db.execute('INSERT INTO meetings VALUES(?,?,?,?,?,?,?,?)', (
            '../escape', '会议', '2026-11-05', '/missing/audio.wav', '原话',
            '[{"start":1,"text":"原话"}]', '{"summary":"概览","insights":{"questions":[]}}', 1))
        db.execute('CREATE TABLE tasks(meeting_id,text,owner,due,done)')
        db.execute('INSERT INTO tasks VALUES(?,?,?,?,?)', ('../escape', '核对', '甲', '', 1))
    before = source.read_bytes()
    out = tmp_path / 'output'
    assert import_workbench(source, out)['imported'] == ['../escape']
    folder = next(p for p in out.iterdir() if p.is_dir())
    assert Transcript.load(folder / 'transcript.json').sentences[0].start_ms == 1000
    snapshot = json.loads((folder / 'tingji-source.json').read_text())
    assert snapshot['meeting']['confirmed'] == 1
    assert snapshot['tasks'][0]['done'] == 1
    (folder / '纪要.md').write_text('人工修改')
    assert import_workbench(source, out)['skipped'] == ['../escape']
    assert (folder / '纪要.md').read_text() == '人工修改'
    assert source.read_bytes() == before


if __name__ == "__main__":
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        test_import_preserves_state_and_never_overwrites(Path(tmp))
    print("PASS: conversion, preservation, idempotence, traversal, read-only source")
