import http.client
import importlib.util
import json
import tempfile
import threading
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('ballgame_app', ROOT / 'app.py')
app = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(app)


class BallGameApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        app.DATA = Path(self.temp.name)
        app.DB_PATH = app.DATA / 'test.sqlite3'
        app.initialize()
        self.server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def post(self, path, payload, cookie=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        headers = {'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        connection.request('POST', path, json.dumps(payload), headers)
        response = connection.getresponse()
        body = json.loads(response.read().decode())
        set_cookie = response.getheader('Set-Cookie')
        connection.close()
        return response.status, body, set_cookie

    def test_one_phone_can_only_enter_once_per_day(self):
        first = self.post('/ballgame/api/enter', {'phone': '13900001234'})
        second = self.post('/ballgame/api/enter', {'phone': '13900001234'})
        self.assertEqual(first[0], 200)
        self.assertTrue(first[1]['allowed'])
        self.assertIn('HttpOnly', first[2])
        self.assertEqual(second[0], 409)
        self.assertFalse(second[1]['allowed'])

    def test_result_is_saved_against_registered_phone(self):
        status, _, header = self.post('/ballgame/api/enter', {'phone': '13700005678'})
        self.assertEqual(status, 200)
        cookie = header.split(';', 1)[0]
        status, body, _ = self.post('/ballgame/api/result', {
            'outcome': 'completed', 'score': 21, 'distance': 156, 'duration': 60,
        }, cookie)
        self.assertEqual(status, 200)
        self.assertTrue(body['saved'])
        with app.db() as connection:
            row = connection.execute('SELECT * FROM plays').fetchone()
        self.assertEqual(row['phone'], '13700005678')
        self.assertEqual(row['score'], 21)
        self.assertEqual(row['distance'], 156)

    def test_invalid_phone_is_rejected(self):
        status, body, _ = self.post('/ballgame/api/enter', {'phone': '123'})
        self.assertEqual(status, 400)
        self.assertFalse(body['allowed'])


if __name__ == '__main__':
    unittest.main()
