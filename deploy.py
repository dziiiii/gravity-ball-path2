#!/usr/bin/env python3
"""Deploy ballgame to the existing haoduoo.com Alibaba Cloud host.

Credentials are read from HAODUOO_CREDENTIALS_FILE and are never bundled,
printed, committed, or uploaded.
"""
import base64
import io
import os
import shlex
import subprocess
import tarfile
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SITE = 'ballgame'
PORT = 3021
SERVICE = 'haoduoo-ballgame'
REMOTE_ROOT = '/var/www/haoduoo/sites/ballgame'
REMOTE_DATA = '/var/lib/haoduoo-ballgame'
NGINX_CONF = '/etc/nginx/conf.d/newcake.conf'


def read_env(path):
    result = {}
    for raw in Path(path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        result[key.strip()] = value.strip().strip('"\'')
    return result


EXPECT = r'''
set timeout 60
set password $env(ALIYUN_PASSWORD)
log_user 0
spawn {*}$argv
log_user 1
expect {
  -re {(?i)are you sure you want to continue connecting} { send -- "yes\r"; exp_continue }
  -re {(?i)password:} { send -- "$password\r"; exp_continue }
  timeout { exit 124 }
  eof
}
catch wait result
exit [lindex $result 3]
'''


def run_with_password(arguments, credentials, timeout=90):
    environment = os.environ.copy()
    environment['ALIYUN_PASSWORD'] = credentials['ALIYUN_PASSWORD']
    with tempfile.NamedTemporaryFile(mode='w', suffix='.expect') as script_file:
        script_file.write(EXPECT)
        script_file.flush()
        process = subprocess.run(
            ['expect', script_file.name] + arguments,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            universal_newlines=True,
        )
    if process.returncode:
        raise RuntimeError(process.stdout.strip() or 'remote command failed')
    return process.stdout.strip()


def encoded(content):
    return base64.b64encode(content.encode('utf-8')).decode('ascii')


def build_remote_script(release, archive_path):
    service = '''[Unit]
Description=Haoduoo gravity ball discount game
After=network.target

[Service]
Type=simple
User=haoduoo-ballgame
Group=haoduoo-ballgame
WorkingDirectory=/var/www/haoduoo/sites/ballgame/current
Environment=BALLGAME_DATA=/var/lib/haoduoo-ballgame
Environment=BALLGAME_PORT=3021
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 /var/www/haoduoo/sites/ballgame/current/app.py
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
'''
    nginx_route = '''    # BEGIN HAODUOO BALLGAME
    location = /ballgame {
        return 308 /ballgame/;
    }
    location ^~ /ballgame/ {
        client_max_body_size 4k;
        proxy_pass http://127.0.0.1:3021;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
    # END HAODUOO BALLGAME
'''
    nginx_editor = '''
from pathlib import Path
p=Path(%r)
text=p.read_text()
if '# BEGIN HAODUOO BALLGAME' not in text:
    anchor='    include /etc/nginx/nw4.locations;'
    if text.count(anchor)!=1:
        raise SystemExit('nginx anchor mismatch')
    route=%r
    p.write_text(text.replace(anchor,route+anchor))
''' % (NGINX_CONF, nginx_route)
    return '''#!/bin/bash
set -Eeuo pipefail
root=%s
release=%s
archive=%s
data=%s
conf=%s
stamp=%s
previous="$(readlink "$root/current" 2>/dev/null || true)"
backup="$conf.ballgame-backup-$stamp"
switched=0
nginx_changed=0
rollback() {
  if [ "$nginx_changed" = 1 ] && [ -f "$backup" ]; then cp "$backup" "$conf"; nginx -t && systemctl reload nginx || true; fi
  if [ "$switched" = 1 ] && [ -n "$previous" ]; then ln -s "$previous" "$root/rollback-$stamp"; mv -Tf "$root/rollback-$stamp" "$root/current"; systemctl restart %s || true; fi
}
trap rollback ERR
id %s >/dev/null 2>&1 || useradd --system --home-dir %s --shell /sbin/nologin %s
mkdir -p "$release" "$data"
chown %s:%s "$data"
chmod 700 "$data"
tar -xzf "$archive" -C "$release"
chmod -R a+rX "$release"
/usr/bin/python3 -m py_compile "$release/app.py"
echo %s | base64 -d > /etc/systemd/system/%s.service
chmod 644 /etc/systemd/system/%s.service
ln -s "$release" "$root/next-$stamp"
mv -Tf "$root/next-$stamp" "$root/current"
switched=1
systemctl daemon-reload
systemctl enable %s
systemctl restart %s
healthy=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS --max-time 2 http://127.0.0.1:%d/ballgame/api/health | grep -q '"ok":true'; then healthy=1; break; fi
  sleep 1
done
[ "$healthy" = 1 ]
cp "$conf" "$backup"
chmod 600 "$backup"
echo %s | base64 -d | /usr/bin/python3
nginx_changed=1
nginx -t
systemctl reload nginx
trap - ERR
echo "release=$release"
echo "previous=$previous"
echo "service=$(systemctl is-active %s)"
''' % (
        shlex.quote(REMOTE_ROOT), shlex.quote(release), shlex.quote(archive_path),
        shlex.quote(REMOTE_DATA), shlex.quote(NGINX_CONF), shlex.quote(release.rsplit('/', 1)[-1]),
        SERVICE, SERVICE, REMOTE_DATA, SERVICE, SERVICE, SERVICE,
        encoded(service), SERVICE, SERVICE, SERVICE, SERVICE, PORT,
        encoded(nginx_editor), SERVICE,
    )


def main():
    credentials_path = os.environ.get('HAODUOO_CREDENTIALS_FILE')
    if not credentials_path:
        raise SystemExit('HAODUOO_CREDENTIALS_FILE is required')
    credentials = read_env(credentials_path)
    host = credentials['ALIYUN_HOST']
    user = credentials['ALIYUN_USER']
    destination = '%s@%s' % (user, host)
    ssh_base = ['ssh', '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=5', destination]
    preflight = run_with_password(ssh_base + [
        "systemctl is-active nginx && test -f %s && ( ! ss -ltn | grep -q ':3021 ' || systemctl is-active --quiet %s )" % (shlex.quote(NGINX_CONF), SERVICE)
    ], credentials, timeout=20)
    print('preflight=' + preflight.replace('\n', ','))

    stamp = time.strftime('%Y%m%d-%H%M%S')
    release = REMOTE_ROOT + '/releases/' + stamp
    remote_archive = '/tmp/ballgame-' + stamp + '.tar.gz'
    include = ['app.py', 'index.html', 'css', 'js', 'vendor']
    with tempfile.TemporaryDirectory(prefix='ballgame-deploy-') as temporary:
        archive_path = Path(temporary) / ('ballgame-' + stamp + '.tar.gz')
        with tarfile.open(str(archive_path), 'w:gz') as archive:
            for name in include:
                archive.add(str(ROOT / name), arcname=name)
        run_with_password([
            'scp', '-o', 'ConnectTimeout=5', str(archive_path), destination + ':' + remote_archive
        ], credentials, timeout=40)
    print('upload=ok')

    script = build_remote_script(release, remote_archive)
    command = 'echo %s | base64 -d | bash' % shlex.quote(encoded(script))
    output = run_with_password(ssh_base + [command], credentials, timeout=120)
    print(output)
    print('url=https://haoduoo.com/ballgame/')


if __name__ == '__main__':
    main()
