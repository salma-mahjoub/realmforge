import urllib.request,re,json,zipfile,hashlib,concurrent.futures
from pathlib import Path
root=Path(__file__).resolve().parents[1]
entries=[('music-overworld','overworld-theme-0','platformer.ogg'),('music-sprinter','pixel-sprinter','pixel_sprinter_loop.ogg'),('music-bass','subtle-bass','bassy_tune.ogg')]
def go(e):
 id,slug,file=e;url='https://opengameart.org/content/'+slug
 try:
  html=urllib.request.urlopen(url,timeout=40).read().decode();(root/'licenses'/f'{id}.html').write_text(html)
  assert "license-name'>CC0" in html or 'license-name">CC0' in html
  links=re.findall(r'href="(https://opengameart.org/sites/default/files/[^"<>]+\.(?:zip|ogg))"',html)
  link='https://opengameart.org/sites/default/files/'+urllib.parse.quote(file) if file else next(x for x in links if x.endswith('.zip'))
  dest=root/'_downloads'/(id+('.zip' if link.endswith('.zip') else '.ogg'))
  with urllib.request.urlopen(link,timeout=180) as res, dest.open('wb') as out:
   while data:=res.read(262144):out.write(data)
  if dest.suffix=='.zip':
   with zipfile.ZipFile(dest) as z:z.extractall(root/'_downloads'/id)
  return dict(id=id,url=url,download=link,license='CC0-1.0',sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),bytes=dest.stat().st_size)
 except Exception as ex:return dict(id=id,error=str(ex),url=url)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 results=list(pool.map(go,entries))
(root/'sources'/'oga-packs.json').write_text(json.dumps(results,indent=2)+'\n')
for r in results:print(r,flush=True)
