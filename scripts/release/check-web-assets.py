#!/usr/bin/env python3
"""Check installer asset URLs and MIME types, not only HTTP page availability."""
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.request import urlopen
import sys

base = sys.argv[1]
with urlopen(base, timeout=30) as response:
    page_url = response.url
    html = response.read().decode('utf-8')

class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items = []
        self.ids = set()

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            self.items.append((attrs['href'], 'css'))
        elif tag == 'script' and attrs.get('src'):
            self.items.append((attrs['src'], 'js'))
        else:
            return
        if attrs.get('id'):
            self.ids.add(attrs['id'])

assets = Assets()
assets.feed(html)
if not {'zuiCSS', 'zuiTheme', 'zuiJS'} <= assets.ids:
    raise ValueError('Installer did not include expected ZUI resources')
for path, kind in assets.items:
    if path.startswith('//'):
        raise ValueError('Invalid protocol-relative asset URL: ' + path)
    url = urljoin(page_url, path)
    if urlsplit(url).netloc != urlsplit(base).netloc:
        raise ValueError('Unexpected asset host: ' + url)
    with urlopen(url, timeout=30) as response:
        content_type = response.headers.get_content_type()
        accepted = {'text/css'} if kind == 'css' else {'application/javascript', 'text/javascript'}
        if response.status != 200 or content_type not in accepted or not response.read(100):
            raise ValueError('Invalid asset response: ' + url + ' (' + content_type + ')')
print(f'PASS: {len(assets.items)} CSS/JS asset URLs, HTTP responses and MIME types')
