#!/usr/bin/env python3
"""Build a local-install ZenTao extension ZIP with an explicit file allowlist."""
from pathlib import Path
import hashlib
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CODE = 'xmwprogramgantt'
VERSION = '1.0.0'
files = [
    'extension/custom/program/ext/model/class/programgantt.class.php',
    'extension/custom/program/ext/control/gantt.php',
    'extension/custom/program/ext/control/ganttedit.php',
    'extension/custom/program/ext/control/ganttexport.php',
    'extension/custom/program/ext/ui/gantt.html.php',
    'extension/custom/program/ext/js/gantt/programgantt.ui.js',
    'extension/custom/program/ext/css/gantt/programgantt.ui.css',
    'extension/custom/group/ext/config/programgantt.php',
]
for module in ('common', 'program', 'group'):
    for locale in ('en', 'zh-cn', 'zh-tw', 'de', 'fr'):
        files.append(f'extension/custom/{module}/ext/lang/{locale}/programgantt.php')

output = ROOT / 'dist' / f'{CODE}-{VERSION}.zip'
output.parent.mkdir(exist_ok=True)
metadata = f'''name: XMW Program Gantt
code: {CODE}
version: {VERSION}
author: XMW
license: AGPL-3.0-or-later
type: extension
desc: Program hierarchy, permission-aware schedule editing and local PNG/PDF export.
zentao:
  compatible: "22.7"
  incompatible: ""
'''
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    def add(name, data):
        info = zipfile.ZipInfo(f'{CODE}/{name}', (2026, 11, 14, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data)
    for name in sorted(files):
        source = ROOT / name
        if not source.is_file() or source.is_symlink():
            raise SystemExit(f'Missing or unsafe package input: {name}')
        add(name, source.read_bytes())
    for locale in ('en', 'zh-cn'):
        add(f'doc/{locale}.yaml', metadata)
    add('doc/README.md', (ROOT / 'scripts/program-gantt/README.md').read_bytes())
    add('doc/LICENSE', (ROOT / 'COPYING').read_bytes())
checksum = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix('.zip.sha256').write_text(f'{checksum}  {output.name}\n')
print(f'{output}\nSHA-256: {checksum}\n{len(files)} extension files; no core replacements or database migrations.')
