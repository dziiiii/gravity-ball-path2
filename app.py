#!/usr/bin/env python3
import datetime
import hashlib
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import socketserver
import time
from http import cookies
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

BASE_PATH = '/ballgame'
ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT
DATA = Path(os.environ.get('BALLGAME_DATA', str(ROOT / 'data')))
DB_PATH = DATA / 'ballgame.sqlite3'
PORT = int(os.environ.get('BALLGAME_PORT', '3021'))
PHONE_PATTERN = re.compile(r'^1[3-9][0-9]{9}$')
SESSION_SECONDS = 26 * 60 * 60
MAX_BODY = 4096


class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True


def now_ts():
    return int(time.time())


def business_day(timestamp=None):
    timestamp = now_ts() if timestamp is None else timestamp
    utc = datetime.datetime.utcfromtimestamp(timestamp)
    return (utc + datetime.timedelta(hours=8)).strftime('%Y-%m-%d')


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def db():
    connection = sqlite3.connect(str(DB_PATH), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys=ON')
    return connection


def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    with db() as connection:
        connection.execute('PRAGMA journal_mode=WAL')
        connection.executescript('''
            CREATE TABLE IF NOT EXISTS plays (
                id TEXT PRIMARY KEY,
                phone TEXT NOT NULL,
                play_day TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                outcome TEXT,
                score INTEGER,
                distance INTEGER,
                duration INTEGER,
                ip_hash TEXT,
                UNIQUE(phone, play_day)
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                play_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY(play_id) REFERENCES plays(id)
            );
            CREATE INDEX IF NOT EXISTS plays_day_idx ON plays(play_day, started_at);
        ''')


class Handler(BaseHTTPRequestHandler):
    server_version = 'BallGame/1.0'

    def log_message(self, format_string, *args):
        # Never log request bodies, query strings, cookies, or phone numbers.
        print('%s - %s' % (self.address_string(), format_string % args))

    def send_json(self, status, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            raise ValueError('请求格式错误')
        if length < 1 or length > MAX_BODY:
            raise ValueError('请求大小不正确')
        try:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError('请求格式错误')

    def session_play(self):
        jar = cookies.SimpleCookie()
        try:
            jar.load(self.headers.get('Cookie', ''))
        except cookies.CookieError:
            return None
        morsel = jar.get('ballgame_session')
        if not morsel:
            return None
        with db() as connection:
            return connection.execute('''
                SELECT p.* FROM sessions s JOIN plays p ON p.id=s.play_id
                WHERE s.token_hash=? AND s.expires_at>?
            ''', (digest(morsel.value), now_ts())).fetchone()

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == BASE_PATH + '/api/health':
            self.send_json(200, {'ok': True, 'day': business_day()})
            return
        if path == BASE_PATH:
            self.send_response(308)
            self.send_header('Location', BASE_PATH + '/')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if not path.startswith(BASE_PATH + '/'):
            self.send_error(404)
            return
        relative = path[len(BASE_PATH) + 1:] or 'index.html'
        target = (PUBLIC / relative).resolve()
        if PUBLIC.resolve() not in target.parents and target != PUBLIC.resolve():
            self.send_error(404)
            return
        if not target.is_file() or target.name in {'app.py', 'deploy.py'} or '.git' in target.parts:
            self.send_error(404)
            return
        content = target.read_bytes()
        media_type = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        self.send_response(200)
        self.send_header('Content-Type', media_type + ('; charset=utf-8' if media_type.startswith(('text/', 'application/javascript')) else ''))
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-cache' if target.name == 'index.html' else 'public, max-age=300')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        self.send_header('Permissions-Policy', 'accelerometer=(self), gyroscope=(self)')
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_json()
        except ValueError as error:
            self.send_json(400, {'error': str(error)})
            return

        if path == BASE_PATH + '/api/enter':
            phone = str(body.get('phone', '')).strip()
            if not PHONE_PATTERN.fullmatch(phone):
                self.send_json(400, {'allowed': False, 'error': '请输入正确的11位手机号'})
                return
            play_id = secrets.token_hex(16)
            token = secrets.token_urlsafe(32)
            timestamp = now_ts()
            day = business_day(timestamp)
            ip_hash = digest(self.client_address[0])[:24]
            try:
                with db() as connection:
                    connection.execute('BEGIN IMMEDIATE')
                    connection.execute('''
                        INSERT INTO plays(id,phone,play_day,started_at,ip_hash)
                        VALUES(?,?,?,?,?)
                    ''', (play_id, phone, day, timestamp, ip_hash))
                    connection.execute('''
                        INSERT INTO sessions(token_hash,play_id,expires_at) VALUES(?,?,?)
                    ''', (digest(token), play_id, timestamp + SESSION_SECONDS))
            except sqlite3.IntegrityError:
                self.send_json(409, {'allowed': False, 'error': '该手机号今天已经参与过了，请明天再来'})
                return
            cookie = 'ballgame_session=%s; Path=%s; HttpOnly; Secure; SameSite=Lax; Max-Age=%d' % (token, BASE_PATH, SESSION_SECONDS)
            self.send_json(200, {'allowed': True, 'day': day}, cookie)
            return

        if path == BASE_PATH + '/api/result':
            play = self.session_play()
            if not play:
                self.send_json(401, {'error': '本局登记已失效'})
                return
            outcome = str(body.get('outcome', ''))
            if outcome not in ('completed', 'fell'):
                self.send_json(400, {'error': '结算状态无效'})
                return
            def safe_int(name, minimum, maximum):
                try:
                    return max(minimum, min(maximum, int(body.get(name, 0))))
                except (TypeError, ValueError):
                    return minimum
            score = safe_int('score', 0, 500)
            distance = safe_int('distance', 0, 5000)
            duration = safe_int('duration', 1, 60)
            with db() as connection:
                connection.execute('''
                    UPDATE plays SET finished_at=?,outcome=?,score=?,distance=?,duration=?
                    WHERE id=? AND finished_at IS NULL
                ''', (now_ts(), outcome, score, distance, duration, play['id']))
            self.send_json(200, {'saved': True})
            return

        self.send_json(404, {'error': '接口不存在'})


if __name__ == '__main__':
    initialize()
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('ballgame listening on 127.0.0.1:%d' % PORT)
    server.serve_forever()
