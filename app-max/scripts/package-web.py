"""Package the already-built exact CI revision; no credentials or Android files."""
import hashlib,json,os,pathlib,re,sys,zipfile
root=pathlib.Path(__file__).resolve().parents[1]
sha=os.environ.get('IMAX_BUILD_SHA','')
assert re.fullmatch('[a-f0-9]{40}',sha), 'Exact build SHA required'
version=json.loads((root/'package.json').read_text())['version']
assert json.loads((root/'dist/build-info.json').read_text())=={'version':version,'commit':sha}
out=root/'web-artifact';out.mkdir(exist_ok=True)
files=[]
for name in ['dist','assets']:
    files.extend(p for p in (root/name).rglob('*') if p.is_file())
files.extend(root.glob('*.mjs'))
files.extend(root/name for name in ['package.json','package-lock.json','scripts/media-device-code.mjs'])
manifest={'sourceCommit':sha,'version':version,'files':{}}
archive=out/f'I-MAX-{version}-web-{sha[:8]}.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for path in sorted(set(files)):
        relative=path.relative_to(root).as_posix();data=path.read_bytes()
        assert not path.is_symlink() and not relative.endswith(('.env','.jks','.keystore','.apk'))
        z.writestr(relative,data)
        manifest['files'][relative]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
(out/'BUILD_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
(out/'SHA256SUMS.txt').write_text(digest+'  '+archive.name+'\n')
print(json.dumps({'commit':sha,'version':version,'zip':archive.name,'sha256':digest,'files':len(files)}))
