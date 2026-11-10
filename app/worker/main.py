"""Stateless PDF preparation. No AI, credentials, or customer files in the image."""
import base64
import hashlib
import hmac
import io
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import pdfplumber
from fastapi import FastAPI, Header, HTTPException
from PIL import Image
from title_ocr import ocr_file, OCR_VERSION
from pydantic import BaseModel, Field
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import RectangleObject

app = FastAPI(title="Fraaime PDF preparation", docs_url=None, redoc_url=None)

class Input(BaseModel):
    source_url: str
    page: int | None = Field(default=None, ge=1)
    max_pages: int = Field(default=150, ge=1, le=300)
    max_bytes: int = Field(default=125829120, ge=1, le=262144000)

def authorize(authorization: str | None):
    expected = os.getenv("PDF_WORKER_TOKEN", "")
    if not expected or not authorization or not hmac.compare_digest(authorization, "Bearer " + expected):
        raise HTTPException(401, "Unauthorized")

def validate_source(url: str):
    parsed, allowed = urlsplit(url), urlsplit(os.environ.get("APP_ORIGIN", "http://127.0.0.1:5190"))
    if (parsed.scheme, parsed.netloc) != (allowed.scheme, allowed.netloc) or parsed.username or parsed.password or parsed.query or parsed.fragment or not re.fullmatch(r"/api/worker-source/[a-f0-9-]+", parsed.path):
        raise HTTPException(400, "Invalid source URL")

async def download(data: Input, target: Path):
    validate_source(data.source_url)
    size = 0
    async with httpx.AsyncClient(timeout=180, follow_redirects=False, trust_env=False) as client:
        async with client.stream("GET", data.source_url, headers={"Authorization": "Bearer " + os.environ["PDF_WORKER_TOKEN"]}) as response:
            if response.status_code != 200:
                raise HTTPException(422, "Source PDF could not be retrieved")
            with target.open("wb") as f:
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > data.max_bytes:
                        raise HTTPException(413, "PDF exceeds upload limit")
                    f.write(chunk)
    with target.open('rb') as f:
        if f.read(5) != b'%PDF-':
            raise HTTPException(422, "File is not a PDF")

def reader(path: Path, max_pages: int):
    try:
        pdf = PdfReader(path)
        if pdf.is_encrypted:
            raise HTTPException(422, "Password-protected PDFs are not supported. Upload an unlocked copy.")
        if len(pdf.pages) > max_pages:
            raise HTTPException(413, f"PDF exceeds the {max_pages}-page limit")
        if not pdf.pages:
            raise HTTPException(422, "PDF has no pages")
        return pdf
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, "PDF is damaged or unreadable")

def classify(text: str):
    t = text.lower()
    for label, pattern in [('schedule', r'(door|window).{0,20}schedule'), ('roof-plan', r'roof\s+plan'), ('floor-plan', r'(floor|level|ground|main)\s+plan'), ('elevation', r'elevations?'), ('section', r'building\s+sections?')]:
        if re.search(pattern, t):
            return label
    return 'unclassified'

def inspect_file(path: Path, max_pages: int):
    pdf = reader(path, max_pages)
    sheets=[]
    for index, page in enumerate(pdf.pages):
        text = (page.extract_text() or '')[:12000]
        width, height = float(page.cropbox.width), float(page.cropbox.height)
        rotation = int(page.get('/Rotate',0)) % 360
        if rotation in (90,270):
            width,height=height,width
        tags = re.findall(r'\b[A-Z]{1,2}\s?\d{1,2}(?:\.\d{1,2})?\b', text)
        sheets.append(dict(page=index+1,width=width,height=height,rotation=rotation,text=text,kind=classify(text),sheet=tags[-1] if tags else '',revision='',scanned=len(text.strip())<40))
    with path.open('rb') as f:
        digest=hashlib.file_digest(f,'sha256').hexdigest()
    return dict(sha256=digest,pageCount=len(sheets),sheets=sheets,warnings=['Sheet classifications and detected tags are suggestions; verify selected sheets.'])

def page_file(path: Path, page_number: int, max_pages: int):
    pdf=reader(path,max_pages)
    if page_number>len(pdf.pages):
        raise HTTPException(422,'Page is outside the document')
    # Normalize a private single-page copy before BOTH rendering and vector extraction.
    # This handles nonzero MediaBox origins, CropBox offsets and /Rotate identically.
    writer = PdfWriter()
    source_page = writer.add_page(pdf.pages[page_number-1])
    original_rotation = source_page.rotation
    source_page.transfer_rotation_to_content()
    box = source_page.cropbox
    width, height = round(float(box.width), 5), round(float(box.height), 5)
    source_page.add_transformation(Transformation().translate(-float(box.left), -float(box.bottom)))
    source_page.mediabox = RectangleObject([0, 0, width, height])
    source_page.cropbox = RectangleObject([0, 0, width, height])
    normalized = path.parent / 'normalized-page.pdf'
    with normalized.open('wb') as f:
        writer.write(f)
    # Poppler renders rotation/crop boxes. Rendering is bounded by pixel dimensions and a timeout.
    prefix=path.parent/'page'
    try:
        subprocess.run(['pdftoppm','-f','1','-l','1','-cropbox','-singlefile','-scale-to','3072','-jpeg','-jpegopt','quality=78',str(normalized),str(prefix)],check=True,timeout=90,capture_output=True)
    except (subprocess.SubprocessError,FileNotFoundError):
        raise HTTPException(422,'Could not render this page')
    images=[]
    with Image.open(prefix.with_suffix('.jpg')) as im:
        for region in [(0,0,1,1),(0,0,.5,.5),(.5,0,1,.5),(0,.5,.5,1),(.5,.5,1,1)]:
            crop=im.crop((int(im.width*region[0]),int(im.height*region[1]),int(im.width*region[2]),int(im.height*region[3])))
            crop.thumbnail((1536,1536))
            buf=io.BytesIO();crop.save(buf,format='JPEG',quality=68)
            images.append(dict(region=region,base64=base64.b64encode(buf.getvalue()).decode()))
    with pdfplumber.open(normalized) as doc:
        page=doc.pages[0]
        lines=[]
        for line in page.lines:
            # Bounding-box corners reverse descending diagonals. Use true endpoints.
            pts=line.get('pts', [])
            if len(pts) != 2:
                continue
            segment=clip_segment([*pts[0], *pts[1]], width, height)
            if segment is not None:
                lines.append(segment)
            if len(lines) >= 2000:
                break
        visible=page.crop((0,0,width,height))
        return dict(evidenceVersion=2,coordinateSpace='displayed-crop-points',page=page_number,width=width,height=height,rotation=0,sourceRotation=original_rotation,text=(visible.extract_text() or '')[:30000],lines=lines,images=images)

def clip_segment(segment, width, height):
    """Liang-Barsky clipping preserves diagonal direction at the visible boundary."""
    x0,y0,x1,y1=map(float,segment)
    dx,dy=x1-x0,y1-y0
    lo,hi=0.0,1.0
    for p,q in [(-dx,x0),(dx,width-x0),(-dy,y0),(dy,height-y0)]:
        if p == 0:
            if q < 0: return None
        elif p < 0:
            lo=max(lo,q/p)
        else:
            hi=min(hi,q/p)
        if lo > hi: return None
    if dx == 0 and dy == 0: return None
    return [round(max(0,min(width,x0+lo*dx)),5),round(max(0,min(height,y0+lo*dy)),5),round(max(0,min(width,x0+hi*dx)),5),round(max(0,min(height,y0+hi*dy)),5)]

@app.get('/health')
def health():
    return {'ok':True,'evidenceVersion':2,'titleOcrVersion':OCR_VERSION,'titleOcrAvailable':bool(shutil.which(os.getenv('TESSERACT_CMD','tesseract')))}

@app.post('/inspect')
async def inspect(data: Input, authorization: str | None=Header(default=None)):
    authorize(authorization)
    with tempfile.TemporaryDirectory(prefix='fraaime-') as folder:
        path=Path(folder)/'source.pdf'
        await download(data,path)
        # Run CPU-bound work off the async server loop.
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(inspect_file,path,data.max_pages)

@app.post('/page')
async def page(data: Input, authorization: str | None=Header(default=None)):
    authorize(authorization)
    if data.page is None:
        raise HTTPException(422,'Page is required')
    with tempfile.TemporaryDirectory(prefix='fraaime-') as folder:
        path=Path(folder)/'source.pdf'
        await download(data,path)
        from starlette.concurrency import run_in_threadpool
        return await run_in_threadpool(page_file,path,data.page,data.max_pages)


@app.post('/ocr')
async def title_ocr(data: Input, authorization: str | None=Header(default=None)):
    authorize(authorization)
    if data.page is None:
        raise HTTPException(422,'Page is required')
    with tempfile.TemporaryDirectory(prefix='fraaime-ocr-') as folder:
        path=Path(folder)/'source.pdf'
        await download(data,path)
        from starlette.concurrency import run_in_threadpool
        def prepare():
            pdf=reader(path,data.max_pages)
            if data.page > len(pdf.pages):
                raise HTTPException(422,'Page is outside the document')
            return ocr_file(path,data.page)
        return await run_in_threadpool(prepare)
