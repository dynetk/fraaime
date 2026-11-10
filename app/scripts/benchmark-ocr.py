"""Local, zero-LLM OCR ablation. Keep inputs and outputs in ignored private storage.
Cases JSON: [{"name":"short-id", "pdf":"/absolute/private/source.pdf"}].
Runs native inspection, production title OCR on EVERY page, and full-page OCR.
No API keys, network calls, production database writes, or geometry generation.
"""
import argparse,csv,hashlib,io,json,os,re,subprocess,sys,tempfile,time
from concurrent.futures import ThreadPoolExecutor,as_completed
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'worker'))
from main import inspect_file
from title_ocr import ocr_file

def full_ocr(pdf,page,rotation,folder):
    prefix=folder/'full'
    started=time.monotonic()
    try:
        subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-cropbox','-singlefile','-scale-to','3600','-gray','-png',str(pdf),str(prefix)],check=True,timeout=35,capture_output=True)
        with Image.open(prefix.with_suffix('.png')) as im:
            im.convert('L').rotate(rotation,expand=True).save(prefix.with_suffix('.png'))
        raw=subprocess.run([os.getenv('TESSERACT_CMD','tesseract'),str(prefix.with_suffix('.png')),'stdout','-l','eng','--psm','11','tsv'],check=True,timeout=25,capture_output=True,text=True,env={**os.environ,'OMP_THREAD_LIMIT':'1'})
        lines={};conf=[]
        for row in csv.DictReader(io.StringIO(raw.stdout),delimiter='\t',quoting=csv.QUOTE_NONE):
            if row.get('level')!='5' or not row.get('text','').strip():continue
            key=tuple(row.get(k) for k in ('block_num','par_num','line_num'))
            lines.setdefault(key,[]).append(row['text'])
            try:conf.append(float(row['conf']))
            except ValueError:pass
        return {'status':'complete','text':'\n'.join(' '.join(w) for w in lines.values()),'meanWordConfidence':round(sum(conf)/len(conf),2) if conf else None,'words':len(conf),'rotation':rotation,'seconds':round(time.monotonic()-started,3)}
    except (subprocess.SubprocessError,OSError) as e:
        return {'status':'failed','text':'','error':type(e).__name__,'seconds':round(time.monotonic()-started,3)}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--cases',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--workers',type=int,default=3);p.add_argument('--native-cache',type=Path,help='Reuse inspected manifests after verifying PDF hashes');p.add_argument('--title-only',action='store_true',help='Compare title recognition without full-page OCR');a=p.parse_args()
    if not 1<=a.workers<=4:p.error('Use 1-4 workers to bound CPU and memory')
    a.out.mkdir(parents=True,exist_ok=True)
    version=subprocess.run([os.getenv('TESSERACT_CMD','tesseract'),'--version'],capture_output=True,text=True,check=True).stdout.splitlines()[0]
    started=time.monotonic();cases=[];tasks=[]
    fingerprint=hashlib.sha256((Path(__file__).read_bytes()+Path(__file__).resolve().parents[1].joinpath('worker/title_ocr.py').read_bytes()+version.encode()+str(a.title_only).encode())).hexdigest()
    for case in json.loads(a.cases.read_text()):
        if not re.fullmatch('[a-z0-9_-]+',case['name']):raise ValueError('Case names must be safe short identifiers')
        pdf=Path(case['pdf']).resolve();t=time.monotonic()
        cache=json.loads(a.native_cache.read_text()) if a.native_cache else []
        cached=next((c for c in cache if c['name']==case['name']),None)
        if cached:
            with pdf.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
            if cached['sha256'] != digest: raise ValueError('Native cache source hash mismatch')
        manifest=cached['manifest'] if cached else inspect_file(pdf,300)
        entry={'name':case['name'],'sha256':manifest['sha256'],'manifest':manifest,'nativeSeconds':round(time.monotonic()-t,3)}
        cases.append(entry)
        for sheet in manifest['sheets']:tasks.append((case['name'],pdf,sheet['page'],manifest['sha256']))
    (a.out/'native.json').write_text(json.dumps(cases))
    def task(row):
        name,pdf,page,digest=row;target=a.out/f'{name}-{page}.json'
        if target.exists():
            existing=json.loads(target.read_text())
            if existing.get('fingerprint')==fingerprint and existing.get('sha256')==digest:return name,page,existing,True
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);local=folder/'source.pdf';local.symlink_to(pdf)
            t=time.monotonic();ocr=ocr_file(local,page);seconds=round(time.monotonic()-t,3)
            full={'status':'skipped','text':'','seconds':0} if a.title_only else full_ocr(local,page,ocr.get('rotation',0),folder)
            result={'sha256':digest,'fingerprint':fingerprint,'title':ocr,'titleSeconds':seconds,'full':full}
            target.write_text(json.dumps(result))
            return name,page,result,False
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        for i,f in enumerate(as_completed(pool.submit(task,row) for row in tasks),1):
            name,page,r,cached=f.result()
            print(json.dumps({'done':i,'total':len(tasks),'case':name,'page':page,'title':r['title']['status'],'full':r['full']['status'],'seconds':round(r['titleSeconds']+r['full']['seconds'],2),'cached':cached}),flush=True)
    meta={'engine':version,'fingerprint':fingerprint,'pages':len(tasks),'workers':a.workers,'elapsedSeconds':round(time.monotonic()-started,3),'aiCalls':0,'aiCostUsd':0,'fullPageMethod':'3600px long edge, PSM 11, orientation from production title pass; no confidence filtering of full-page text','titleMethod':'Unmodified production title OCR on every page; derive selective fallback from native needsTitleOcr in report'}
    (a.out/'run.json').write_text(json.dumps(meta,indent=2));print(json.dumps(meta),flush=True)
if __name__=='__main__':main()
