#!/usr/bin/env python3
"""Exercise the real publisher against a fake gh; never access GitHub or Docker."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('publish-release.sh').resolve()
SHA = 'a' * 40
TAG = '22.7-xmw-' + SHA[:12]

MOCK = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['MOCK_LOG'], 'a') as stream:
    stream.write(json.dumps(args) + '\\n')
if args[0] == 'api':
    if '--method' in args:
        sys.exit(int(os.environ.get('MOCK_CREATE_FAILURE', '0')))
    if any('matching-refs/' in arg for arg in args):
        print(os.environ.get('MOCK_TAG_SHA', ''))
        sys.exit(int(os.environ.get('MOCK_LOOKUP_FAILURE', '0')))
    print(os.environ.get('MOCK_RELEASES', '22.7'))
    sys.exit(int(os.environ.get('MOCK_LIST_FAILURE', '0')))
if args[:2] == ['release', 'upload']:
    sys.exit(int(os.environ.get('MOCK_UPLOAD_FAILURE', '0')))
'''


class PublicationTests(unittest.TestCase):
    def invoke(self, *, overrides=None, corrupt=False, plugin=True, corrupt_plugin=False):
        with tempfile.TemporaryDirectory(prefix='xmw-release-test-') as folder:
            root = Path(folder)
            (root / 'dist').mkdir()
            archive = root / 'dist/zentao-22.7-linux-amd64-offline.tar.gz'
            archive.write_bytes(b'tested-package')
            digest = '0' * 64 if corrupt else hashlib.sha256(archive.read_bytes()).hexdigest()
            archive.with_suffix('.gz.sha256').write_text(f'{digest}  {archive.name}\n')
            if plugin:
                package = root / 'dist/xmwprogramgantt-1.0.2.zip'
                package.write_bytes(b'tested-plugin')
                digest = '0' * 64 if corrupt_plugin else hashlib.sha256(package.read_bytes()).hexdigest()
                package.with_suffix('.zip.sha256').write_text(f'{digest}  {package.name}\n')
            (root / 'gh').write_text(MOCK)
            (root / 'gh').chmod(0o700)
            log = root / 'calls.jsonl'
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'],
                       MOCK_LOG=str(log), GH_REPO='example/zentao', GH_TOKEN='test-only',
                       TAG=TAG, TITLE='22.7-XMW (' + SHA[:12] + ')', SOURCE_SHA=SHA, CREATE_TAG='true')
            env.update(overrides or {})
            result = subprocess.run(['bash', str(SCRIPT)], cwd=root, env=env, text=True, capture_output=True)
            calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
            return result, calls

    def test_branch_publishes_new_tag_at_tested_commit(self):
        result, calls = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        creation = next(call for call in calls if '--method' in call)
        self.assertIn('ref=refs/tags/' + TAG, creation)
        self.assertIn('sha=' + SHA, creation)
        self.assertFalse(any(call[:2] == ['release', 'delete'] for call in calls))
        self.assertEqual(calls[-1], ['release', 'edit', TAG, '--draft=false', '--latest'])
        create = next(call for call in calls if call[:2] == ['release', 'create'])
        self.assertIn('--verify-tag', create)
        self.assertIn('--draft', create)
        upload = next(call for call in calls if call[:2] == ['release', 'upload'])
        self.assertEqual(set(upload[3:]), {'zentao-22.7-linux-amd64-offline.tar.gz',
                                         'zentao-22.7-linux-amd64-offline.tar.gz.sha256',
                                         'xmwprogramgantt-1.0.2.zip', 'xmwprogramgantt-1.0.2.zip.sha256'})

    def test_rerun_replaces_only_its_own_release(self):
        result, calls = self.invoke(overrides={'MOCK_TAG_SHA': SHA, 'MOCK_RELEASES': '22.7\n' + TAG})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any('--method' in call for call in calls))
        self.assertIn(['release', 'delete', TAG, '--yes'], calls)
        self.assertNotIn(['release', 'delete', '22.7', '--yes'], calls)

    def test_numeric_tag_path_keeps_original_behavior(self):
        result, calls = self.invoke(overrides={'TAG': '22.7', 'TITLE': '22.7-XMW', 'CREATE_TAG': 'false'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any(any('matching-refs' in arg for arg in call) for call in calls))
        self.assertIn(['release', 'delete', '22.7', '--yes'], calls)

    def test_lookup_or_tag_creation_failure_cannot_delete_release(self):
        for overrides in ({'MOCK_TAG_SHA': 'b' * 40}, {'MOCK_LOOKUP_FAILURE': '1'}, {'MOCK_CREATE_FAILURE': '1'}, {'MOCK_LIST_FAILURE': '1'}):
            with self.subTest(overrides=overrides):
                result, calls = self.invoke(overrides=overrides)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(call[0] == 'release' for call in calls))

    def test_bad_checksum_never_touches_github(self):
        result, calls = self.invoke(corrupt=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_failed_upload_does_not_publish_or_mark_latest(self):
        result, calls = self.invoke(overrides={'MOCK_UPLOAD_FAILURE': '1'})
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[:2] == ['release', 'edit'] for call in calls))

    def test_missing_or_corrupt_plugin_never_touches_github(self):
        for options in ({'plugin': False}, {'corrupt_plugin': True}):
            with self.subTest(options=options):
                result, calls = self.invoke(**options)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
