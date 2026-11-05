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


def test_complete_import_copies_audio_and_preserves_speakers(tmp_path):
    import hashlib
    source = tmp_path / 'source.sqlite3'
    audio = tmp_path / 'original.wav'
    audio.write_bytes(b'local audio fixture')
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE meetings(id,title,date,source,transcript,segments,dialogue,summary,confirmed)')
        db.execute('INSERT INTO meetings VALUES(?,?,?,?,?,?,?,?,?)', (
            'one', '会议', '2026-11-05', str(audio), '原话', '[]',
            '[{"start":1,"end":3,"speaker":"李老师","text":"原话"}]', '{}', 1))
    out = tmp_path / 'output'
    import_workbench(source, out, copy_audio=True)
    folder = next(p for p in out.iterdir() if p.is_dir())
    assert (folder / '录音.wav').read_bytes() == audio.read_bytes()
    manifest = json.loads((folder / 'audio-import.json').read_text())
    assert manifest['sha256'] == hashlib.sha256(audio.read_bytes()).hexdigest()
    transcript = Transcript.load(folder / 'transcript.json')
    assert transcript.speaker_names == {0: '李老师'}
    assert transcript.source == str(folder / '录音.wav')
    assert audio.exists()
    # Missing audio must never publish a partial meeting that could pass migration validation.
    audio.unlink()
    import pytest
    failed = tmp_path / 'failed'
    with pytest.raises(FileNotFoundError): import_workbench(source, failed, copy_audio=True)
    assert list(failed.iterdir()) == []


def test_import_maps_question_scopes_and_validates_citations(tmp_path):
    source = tmp_path / 'source.sqlite3'
    with sqlite3.connect(source) as db:
        db.execute('CREATE TABLE meetings(id,title,date,source,transcript,segments,summary,confirmed)')
        db.execute('INSERT INTO meetings VALUES(?,?,?,?,?,?,?,?)', ('meeting-id','会议','2026-11-05','missing.wav','原话','[{"segment":2,"start":3,"text":"原话"}]','{}',1))
        db.execute('CREATE TABLE questions(id,scope,question,answer,citations,status)')
        db.execute('INSERT INTO questions VALUES(?,?,?,?,?,?)', ('q1','meeting-id','问题','回答', '[{"meeting_id":"meeting-id","segment":2,"quote":"原话"},{"meeting_id":"meeting-id","segment":2,"quote":"编造"}]','done'))
    out = tmp_path / 'output'
    import_workbench(source, out)
    import_workbench(source, out)
    history = json.loads((out/'questions.json').read_text())
    assert len(history) == 1
    entry = history[0]
    assert (out/entry['scope']/'transcript.json').is_file()
    assert entry['parts'][0]['answer'] == '回答'
    assert entry['parts'][0]['citations'] == [{'meeting':entry['scope'],'start_ms':3000,'quote':'原话'}]


if __name__ == "__main__":
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        test_import_preserves_state_and_never_overwrites(Path(tmp))
    print("PASS: conversion, preservation, idempotence, traversal, read-only source")
