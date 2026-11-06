#!/usr/bin/env python3
"""Finalize a notarized app's updater archive, signature, manifest and release checksums."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile


def manifest(version, signature, notes):
    return {
        'version': version,
        'notes': notes,
        'pub_date': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
        'platforms': {'darwin-aarch64': {
            'signature': signature.strip(),
            'url': f'https://github.com/tancheng33/tingo/releases/download/v{version}/Tingo.app.tar.gz',
        }},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--notes', required=True, type=Path)
    args = parser.parse_args()
    app_dir = Path(__file__).resolve().parents[1]
    cfg = json.loads((app_dir / 'src-tauri/tauri.conf.json').read_text())
    version = cfg['version']
    bundle = app_dir / 'src-tauri/target/release/bundle'
    app = bundle / 'macos/Tingo.app'
    dmg = bundle / f'dmg/Tingo_{version}_aarch64.dmg'
    key = Path(os.environ.get('TAURI_SIGNING_PRIVATE_KEY', str(Path.home() / '.config/tingo-signing/updater.key')))
    if not key.is_file():
        raise SystemExit('Updater signing key is missing')
    requirement = '=identifier "io.github.tancheng33.tingo" and anchor apple generic and certificate leaf[subject.OU] = "9YJL5M4BY8"'
    subprocess.run(['codesign', '--verify', '--deep', '--strict', '-R', requirement, str(app)], check=True)
    subprocess.run(['spctl', '--assess', '--type', 'execute', str(app)], check=True)
    subprocess.run(['xcrun', 'stapler', 'staple', str(app)], check=True)
    subprocess.run(['xcrun', 'stapler', 'validate', str(app)], check=True)
    subprocess.run(['xcrun', 'stapler', 'validate', str(dmg)], check=True)
    archive = bundle / 'macos/Tingo.app.tar.gz'
    # The archive must contain the stapled app, not the pre-notarization copy from tauri build.
    with tarfile.open(archive, 'w:gz') as tar:
        tar.add(app, arcname='Tingo.app')
    subprocess.run(['npm', 'run', 'tauri', '--', 'signer', 'sign', '-f', str(key),
                    '--app-version', version, str(archive)], cwd=app_dir, check=True,
                   env={**os.environ, 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': os.environ.get('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', '')},
                   stdout=subprocess.DEVNULL)
    signature = Path(str(archive) + '.sig')
    latest = bundle / 'macos/latest.json'
    latest.write_text(json.dumps(manifest(version, signature.read_text(), args.notes.read_text()), ensure_ascii=False, indent=2) + '\n')
    assets = [dmg, archive, signature, latest]
    checksums = bundle / 'dmg/checksums.txt'
    checksums.write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n' for p in assets))
    print('Ready to upload:')
    for p in [*assets, checksums]:
        print(p)


if __name__ == '__main__':
    main()
