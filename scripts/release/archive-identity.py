#!/usr/bin/env python3
"""Bind classic config IDs and OCI manifest/index IDs from a Docker save archive."""
import hashlib
import json
import sys
import tarfile

archive_path, ref, identities_path = sys.argv[1:]
with tarfile.open(archive_path, 'r:gz') as archive:
    names = set(archive.getnames())
    config_id = None
    if 'manifest.json' in names:
        entries = [entry for entry in json.load(archive.extractfile('manifest.json'))
                   if ref in (entry.get('RepoTags') or [])]
        if len(entries) != 1:
            raise ValueError('Expected exactly one saved image for ' + ref)
        raw_config = archive.extractfile(entries[0]['Config']).read()
        config_id = 'sha256:' + hashlib.sha256(raw_config).hexdigest()
        config = json.loads(raw_config)
        if (config['os'], config['architecture']) != ('linux', 'amd64'):
            raise ValueError('Expected linux/amd64 image')
    identities = {}

    def read_blob(digest):
        if not digest.startswith('sha256:') or len(digest) != 71:
            raise ValueError('Unsupported digest')
        raw = archive.extractfile('blobs/' + digest.replace(':', '/')).read()
        if 'sha256:' + hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError('OCI descriptor checksum mismatch')
        return json.loads(raw)

    def visit(descriptor):
        digest = descriptor['digest']
        manifest = read_blob(digest)
        matched = set()
        if 'manifests' in manifest:
            for child in manifest['manifests']:
                matched.update(visit(child))
        else:
            cfg_id = manifest['config']['digest']
            cfg = read_blob(cfg_id)
            if (cfg.get('os'), cfg.get('architecture')) == ('linux', 'amd64'):
                matched.add(cfg_id)
        for cfg_id in matched:
            identities.setdefault(cfg_id, set()).add(digest)
        return matched

    if 'index.json' in names:
        index = json.load(archive.extractfile('index.json'))
        for descriptor in index['manifests']:
            visit(descriptor)
        if config_id is None:
            if len(identities) != 1:
                raise ValueError('Expected one linux/amd64 config in OCI export')
            config_id = next(iter(identities))
        if config_id not in identities:
            raise ValueError('OCI index does not reference the saved config')
    if config_id is None:
        raise ValueError('Missing Docker/OCI image metadata')
with open(identities_path, 'a') as output:
    for digest in sorted(identities.get(config_id, set())):
        output.write(f'{ref}|{config_id}|{digest}\n')
print(config_id)
