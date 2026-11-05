from fastapi.testclient import TestClient
from tingo.server import create_app


def test_browser_surface_is_read_only(tmp_path):
    with TestClient(create_app(tmp_path, read_only=True)) as client:
        assert client.get('/api/env').json()['read_only']
        assert client.get('/api/meetings').status_code == 200
        assert client.get('/api/config').status_code == 403
        assert client.post('/api/record/start', json={}).status_code == 403
        assert client.post('/api/import', json={}).status_code == 403
        assert client.delete('/api/meetings/missing').status_code == 403
