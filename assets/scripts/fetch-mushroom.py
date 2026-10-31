"""Restore the exact CC0 Kenney source and licence; normal asset builds stay offline."""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
dest = root / 'sources/custom/kenney-mushroom'
record = json.loads((dest / 'source.json').read_text())
archive = root / '_downloads/new-platformer-pack.zip'
data = archive.read_bytes() if archive.exists() else b''
if sha256(data).hexdigest() != record['archiveSha256']:
    with urlopen(Request(record['download'], headers={'User-Agent': 'RealmForge asset fetch'}), timeout=120) as response:
        data = response.read()
if sha256(data).hexdigest() != record['archiveSha256']:
    raise ValueError('Kenney archive changed: refusing unverified replacement')
# Read only the pinned members, never extract arbitrary archive paths.
with ZipFile(BytesIO(data)) as source:
    for entry in record['files']:
        content = source.read(entry['archivePath'])
        if sha256(content).hexdigest() != entry['sha256']:
            raise ValueError(f"Source checksum mismatch: {entry['archivePath']}")
        (dest / entry['local']).write_bytes(content)
        print(f"Verified {entry['archivePath']}: {entry['sha256']}")
