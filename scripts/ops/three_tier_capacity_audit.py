#!/usr/bin/env python3
"""Read-only live capacity probe for the Oracle task runner and GitHub Actions pool.

Secrets are consumed from the environment and never printed. Only an allowlisted
subset of runner and host status is written to the audit artifact.
"""
from __future__ import annotations
import hashlib
import json
import os
import platform
import shutil
import urllib.error
import urllib.request

REPO = 'jonsnow-org/Ttbik'
ORACLE = 'https://89-168-89-15.sslip.io'

def get_json(url: str, headers: dict[str, str] | None = None, timeout: int = 15):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)

def main() -> int:
    out: dict = {'observed_at': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()}
    memory: dict[str, float] = {}
    try:
        for line in open('/proc/meminfo', encoding='utf-8'):
            if line.startswith(('MemTotal:', 'MemAvailable:')):
                key, value = line.split(':', 1)
                memory[key] = round(int(value.strip().split()[0]) / 1024, 1)
    except OSError:
        pass
    disk = shutil.disk_usage('/')
    out['github_runner'] = {
        'platform': platform.platform(),
        'cpu_count': os.cpu_count(),
        'memory_mb': memory,
        'root_disk_gb': {'total': round(disk.total / 2**30, 2), 'free': round(disk.free / 2**30, 2)},
        'repo_visibility': 'public',
        'runner_name': os.getenv('RUNNER_NAME', 'unknown'),
    }
    token = os.getenv('GH_TOKEN', '')
    if token:
        queue: dict[str, int | str] = {}
        for status in ('queued', 'in_progress'):
            url = f'https://api.github.com/repos/{REPO}/actions/runs?per_page=100&status={status}'
            try:
                data = get_json(url, {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
                queue[status + '_workflow_runs'] = int(data.get('total_count', 0))
            except urllib.error.HTTPError as exc:
                queue[status + '_http'] = exc.code
            except Exception as exc:  # noqa: BLE001
                queue[status + '_error'] = type(exc).__name__
        out['github_actions_queue'] = queue
    else:
        out['github_actions_queue'] = {'error': 'GITHUB_TOKEN unavailable'}

    bot_token = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
    if bot_token:
        runner_key = hashlib.sha256(('coder-sandbox:' + bot_token).encode()).hexdigest()[:48]
        try:
            data = get_json(ORACLE + '/coder-sbx/health', {'x-runner-key': runner_key})
            allowed = ('ok', 'mode', 'accepting', 'reason', 'active', 'max', 'freeMb', 'limits')
            out['oracle_runner'] = {key: data[key] for key in allowed if key in data}
        except urllib.error.HTTPError as exc:
            out['oracle_runner'] = {'http': exc.code}
        except Exception as exc:  # noqa: BLE001
            out['oracle_runner'] = {'error': type(exc).__name__}
    else:
        out['oracle_runner'] = {'error': 'TELEGRAM_BOT_TOKEN GitHub secret unavailable'}

    try:
        status = get_json(ORACLE + '/api/ops/oracle-status')
        allowed = ('received_at', 'commit', 'status', 'stale', 'site')
        out['oracle_public_status'] = {key: status[key] for key in allowed if key in status}
    except urllib.error.HTTPError as exc:
        out['oracle_public_status'] = {'http': exc.code}
    except Exception as exc:  # noqa: BLE001
        out['oracle_public_status'] = {'error': type(exc).__name__}

    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
