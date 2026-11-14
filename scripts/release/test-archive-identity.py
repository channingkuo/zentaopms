#!/usr/bin/env python3
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile
import tempfile

helper = pathlib.Path(__file__).with_name('archive-identity.py')
ref = 'example/image:1.0'

def encoded(obj):
    return json.dumps(obj, separators=(',', ':')).encode()

def digest(raw):
    return 'sha256:' + hashlib.sha256(raw).hexdigest()

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    config = encoded({'os': 'linux', 'architecture': 'amd64', 'rootfs': {'type': 'layers', 'diff_ids': []}})
    config_id = digest(config)
    config_path = 'blobs/' + config_id.replace(':', '/')
    manifest = encoded({'schemaVersion': 2, 'config': {'digest': config_id}, 'layers': []})
    manifest_id = digest(manifest)
    manifest_path = 'blobs/' + manifest_id.replace(':', '/')
    for mode in ['classic', 'oci', 'partial-index', 'missing-amd64', 'corrupt']:
        files = {config_path: config, manifest_path: manifest,
                 'index.json': encoded({'schemaVersion': 2, 'manifests': [{'digest': manifest_id}]})}
        if mode == 'classic':
            files['manifest.json'] = encoded([{'Config': config_path, 'RepoTags': [ref], 'Layers': []}])
        if mode in ['partial-index', 'missing-amd64']:
            missing_id = 'sha256:' + '0' * 64
            selected = {'digest': manifest_id, 'platform': {'os': 'linux', 'architecture': 'amd64'}}
            missing = {'digest': missing_id, 'platform': {'os': 'linux', 'architecture': 'arm64' if mode == 'partial-index' else 'amd64'}}
            multi = encoded({'schemaVersion': 2, 'manifests': [selected, missing]})
            multi_id = digest(multi)
            files['blobs/' + multi_id.replace(':', '/')] = multi
            files['index.json'] = encoded({'schemaVersion': 2, 'manifests': [{'digest': multi_id}]})
        if mode == 'corrupt':
            files[manifest_path] = b'{}'
        path = root / (mode + '.tar.gz')
        with tarfile.open(path, 'w:gz') as archive:
            for name, data in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        lock = root / (mode + '.lock')
        result = subprocess.run(['python3', str(helper), str(path), ref, str(lock)], capture_output=True, text=True)
        if mode in ['corrupt', 'missing-amd64']:
            assert result.returncode != 0 and not lock.exists()
        else:
            assert result.returncode == 0, result.stderr
            assert result.stdout.strip() == config_id
            expected = {'|'.join([ref, config_id, manifest_id])}
            if mode == 'partial-index':
                expected.add('|'.join([ref, config_id, multi_id]))
            assert set(lock.read_text().splitlines()) == expected
print('PASS: classic/OCI/partial multiarch index; corrupt or missing amd64 blobs rejected')
