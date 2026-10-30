"""Fetch official Kenney packs, verify CC0 pages, extract and record SHA-256 hashes."""
import urllib.request,re,json,zipfile,hashlib,concurrent.futures,http.cookiejar
from pathlib import Path
root=Path(__file__).resolve().parents[1]
packs=['new-platformer-pack','ui-pack','interface-sounds','music-jingles','game-icons','pixel-platformer','pixel-platformer-blocks','platformer-art-requests']
# The main archive needs static HTTP Range support on interrupted transfers.
static={'new-platformer-pack':'https://kenney.nl/media/pages/assets/new-platformer-pack/1896103897-1764756702/kenney_new-platformer-pack-1.1.zip'}
def download(slug):
 url='https://kenney.nl/assets/'+slug
 op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
 op.addheaders=[('User-Agent','Mozilla/5.0'),('Referer',url)]
 html=op.open(url,timeout=40).read().decode();(root/'licenses'/f'{slug}.html').write_text(html)
 assert 'Creative Commons CC0' in html,slug
 dest=root/'_downloads'/f'{slug}.zip';dest.parent.mkdir(parents=True,exist_ok=True)
 link=static.get(slug)
 if not dest.exists() or not zipfile.is_zipfile(dest):
  if not link:
   links=re.findall(r'https://[^\s"<>]+\.zip',html)
   if links:link=links[0]
   else:
    token=re.search(r"data-download-id='([^']+)'",html)[1]
    link=json.loads(op.open('https://kenney.nl/download-link/'+token,timeout=40).read())['url']
  for attempt in range(10):
   offset=dest.stat().st_size if dest.exists() else 0
   req=urllib.request.Request(link,headers={'Range':f'bytes={offset}-'} if offset else {})
   with op.open(req,timeout=120) as res,dest.open('ab' if offset and res.status==206 else 'wb') as out:
    while chunk:=res.read(65536):out.write(chunk)
   if zipfile.is_zipfile(dest):break
   print(slug,'incomplete; retry',attempt+1,flush=True)
  assert zipfile.is_zipfile(dest),f'Incomplete download: {slug}'
 with zipfile.ZipFile(dest) as z:
  assert z.testzip() is None
  assert all(not Path(n).is_absolute() and '..' not in Path(n).parts for n in z.namelist())
  z.extractall(root/'_downloads'/slug)
 lic=next(p for p in (root/'_downloads'/slug).iterdir() if p.name.lower()=='license.txt')
 assert 'CC0' in lic.read_text(),slug
 (root/'licenses'/f'{slug}.txt').write_bytes(lic.read_bytes())
 return {'id':slug,'author':'Kenney','url':url,'download':static.get(slug) or url,'license':'CC0-1.0','sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size}
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(download,packs))
 (root/'sources'/'packs.json').write_text(json.dumps(results,indent=2)+'\n')
 for r in results:print(r)
