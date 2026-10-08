"""Register this workspace's host for exactly this installed extension, per user."""
import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
HOST = 'com.korail.personal_input'


def discover(profile_root):
    matches = set()
    for profile in profile_root.iterdir():
        if not profile.is_dir():
            continue
        for name in ('Preferences', 'Secure Preferences'):
            try:
                settings = json.loads((profile/name).read_text(encoding='utf-8'))['extensions']['settings']
            except (OSError, ValueError, KeyError):
                continue
            for extension_id, item in settings.items():
                path = item.get('path', '')
                if path and Path(path).is_absolute() and Path(path).resolve() == (ROOT/'extension').resolve():
                    matches.add(extension_id)
    return matches


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--extension-id')
    parser.add_argument('--profile-root', type=Path, default=Path.home()/'AppData/Local/Google/Chrome/User Data')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    extension_id = args.extension_id
    if not extension_id:
        matches = discover(args.profile_root)
        if len(matches) != 1:
            raise SystemExit('Specify --extension-id with the ID shown at chrome://extensions (exactly one match required).')
        extension_id = matches.pop()
    if not re.fullmatch('[a-p]{32}', extension_id):
        raise SystemExit('Invalid extension ID.')
    runtime = ROOT/'.runtime/native-input'
    runtime.mkdir(parents=True, exist_ok=True)
    # CMD launcher contains only fixed quoted workspace paths, never message data.
    python = ROOT/'.venv/Scripts/python.exe'
    if not python.is_file():
        raise SystemExit('Workspace Python environment missing.')
    launcher = runtime/'host.cmd'
    launcher.write_text('@echo off\r\nchcp 65001 >nul\r\n"'+str(python)+'" "'+str(ROOT/'native_input/host.py')+'"\r\n', encoding='utf-8')
    manifest = runtime/'host.json'
    manifest.write_text(json.dumps({'name': HOST, 'description': 'Korail foreground mouse input',
        'path': str(launcher), 'type': 'stdio', 'allowed_origins': ['chrome-extension://'+extension_id+'/']}, indent=2), encoding='utf-8')
    if not args.prepare_only:
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, 'Software\\Google\\Chrome\\NativeMessagingHosts\\'+HOST) as key:
            winreg.SetValueEx(key, '', 0, winreg.REG_SZ, str(manifest))
    print(('Prepared' if args.prepare_only else 'Registered')+' host for '+extension_id)


if __name__ == '__main__':
    main()
