import os
import sys
from pathlib import Path
import pytest
from pypdf import PdfWriter
from fastapi import HTTPException
sys.path.insert(0,str(Path(__file__).parents[1]))
from main import inspect_file,page_file,validate_source,authorize,classify

def write_pdf(path,encrypted=False):
    w=PdfWriter();w.add_blank_page(width=612,height=792).rotate(90)
    if encrypted:w.encrypt('secret')
    with open(path,'wb') as f:w.write(f)

def test_rotated_scan(tmp_path):
    path=tmp_path/'scan.pdf';write_pdf(path)
    m=inspect_file(path,5)
    assert m['sheets'][0]['rotation']==90
    assert m['sheets'][0]['width']==792
    assert m['sheets'][0]['scanned']
    evidence=page_file(path,1,5)
    assert len(evidence['images'])==5
    assert evidence['width']==792

def test_encrypted_and_corrupt(tmp_path):
    path=tmp_path/'locked.pdf';write_pdf(path,True)
    with pytest.raises(HTTPException,match='Password-protected'):inspect_file(path,5)
    path.write_bytes(b'not a PDF')
    with pytest.raises(HTTPException,match='damaged'):inspect_file(path,5)

def test_source_restrictions(monkeypatch):
    monkeypatch.setenv('APP_ORIGIN','https://app.example.com')
    validate_source('https://app.example.com/api/worker-source/abc-123')
    for url in ['http://169.254.169.254/','https://app.example.com.evil.test/api/worker-source/a','https://app.example.com/api/worker-source/a?url=other','file:///etc/passwd']:
        with pytest.raises(HTTPException):validate_source(url)

def test_auth_and_classification(monkeypatch):
    monkeypatch.setenv('PDF_WORKER_TOKEN','test-secret')
    authorize('Bearer test-secret')
    with pytest.raises(HTTPException):authorize('Bearer wrong')
    assert classify('Main floor plan')=='floor-plan'
    assert classify('Window schedule')=='schedule'

@pytest.mark.parametrize('rotation',[0,90,180,270])
def test_nonzero_origin_crop_rotation_and_diagonal_match_render(tmp_path, rotation, monkeypatch):
    import base64, io
    from PIL import Image
    from pypdf.generic import RectangleObject, DecodedStreamObject, NameObject
    w=PdfWriter(); p=w.add_blank_page(width=400,height=300)
    p.mediabox=RectangleObject([-100,-50,300,250])
    p.cropbox=RectangleObject([-50,0,250,200]); p.rotate(rotation)
    stream=DecodedStreamObject()
    # A descending screen diagonal and a second line crossing the crop boundary.
    stream.set_data(b'1 0 0 RG 3 w -25 25 m 225 175 l S -100 100 m 300 100 l S')
    p[NameObject('/Contents')]=w._add_object(stream)
    path=tmp_path/'source.pdf'
    with path.open('wb') as f:w.write(f)
    evidence=page_file(path,1,2)
    assert evidence['evidenceVersion']==2
    assert evidence['rotation']==0
    assert evidence['sourceRotation']==rotation
    assert evidence['width']==pytest.approx(200 if rotation in [90,270] else 300)
    assert evidence['height']==pytest.approx(300 if rotation in [90,270] else 200)
    assert len(evidence['lines'])==2
    image=Image.open(io.BytesIO(base64.b64decode(evidence['images'][0]['base64']))).convert('RGB')
    for x0,y0,x1,y1 in evidence['lines']:
        assert 0<=x0<=evidence['width'] and 0<=x1<=evidence['width']
        assert 0<=y0<=evidence['height'] and 0<=y1<=evidence['height']
        for t in [.2,.5,.8]:
            px=int((x0+t*(x1-x0))/evidence['width']*image.width)
            py=int((y0+t*(y1-y0))/evidence['height']*image.height)
            colors=[image.getpixel((x,y)) for x in range(max(0,px-3),min(image.width,px+4)) for y in range(max(0,py-3),min(image.height,py+4))]
            assert any(r>150 and r>g*1.5 and r>b*1.5 for r,g,b in colors)
    # A parser-limit fallback must preserve the exact displayed crop in all rotations.
    from pypdf import PageObject
    from pypdf.errors import LimitReachedError
    def limited(*args,**kwargs): raise LimitReachedError('test parsing limit')
    monkeypatch.setattr(PageObject,'add_transformation',limited)
    fallback=page_file(path,1,2)
    assert fallback['lines']==[]
    assert fallback['warnings']
    assert (fallback['width'],fallback['height'])==(evidence['width'],evidence['height'])
    rendered=Image.open(io.BytesIO(base64.b64decode(fallback['images'][0]['base64']))).convert('RGB')
    assert rendered.size==image.size
    for x0,y0,x1,y1 in evidence['lines']:
        for t in [.2,.5,.8]:
            px=int((x0+t*(x1-x0))/evidence['width']*rendered.width)
            py=int((y0+t*(y1-y0))/evidence['height']*rendered.height)
            colors=[rendered.getpixel((x,y)) for x in range(max(0,px-3),min(rendered.width,px+4)) for y in range(max(0,py-3),min(rendered.height,py+4))]
            assert any(r>150 and r>g*1.5 and r>b*1.5 for r,g,b in colors)

def test_inspection_recovers_one_page_without_losing_other_sheets(tmp_path,monkeypatch):
    import main
    from pypdf import PageObject
    from pypdf.errors import LimitReachedError
    path=tmp_path/'source.pdf'
    writer=PdfWriter();writer.add_blank_page(width=100,height=200);writer.add_blank_page(width=300,height=400)
    with path.open('wb') as f:writer.write(f)
    def text(page,*args,**kwargs):
        if float(page.mediabox.width)==100:raise LimitReachedError('test limit')
        return 'BUILDING SECTIONS\nA4.00'
    monkeypatch.setattr(PageObject,'extract_text',text)
    monkeypatch.setattr(main,'fallback_text',lambda *args:('FLOOR PLAN\nA2.00','poppler'))
    result=inspect_file(path,5)
    assert result['pageCount']==2
    assert [s['page'] for s in result['sheets']]==[1,2]
    assert [s['kind'] for s in result['sheets']]==['floor-plan','section']
    assert result['sheets'][0]['textSource']=='poppler'
    assert result['sheets'][1]['textSource']=='pypdf'
    assert len(result['warnings'])==2
    monkeypatch.setattr(main,'fallback_text',lambda *args:('','unavailable'))
    result=inspect_file(path,5)
    assert result['pageCount']==2 and result['sheets'][0]['scanned']
    assert result['sheets'][0]['kind']=='unclassified'
    assert 'title OCR' in result['warnings'][1]

def test_poppler_text_failure_is_bounded_and_does_not_hide_sheet(tmp_path,monkeypatch):
    import main,subprocess
    def timeout(cmd,**kwargs):
        assert kwargs['timeout']==30
        raise subprocess.TimeoutExpired(cmd,30)
    monkeypatch.setattr(main.subprocess,'run',timeout)
    assert main.fallback_text(tmp_path/'source.pdf',2,12000)==('','unavailable')


def test_clipping_preserves_direction_and_rejects_invisible():
    from main import clip_segment
    assert clip_segment([-10,110,110,-10],100,100)==[0,100,100,0]
    assert clip_segment([-10,0,-10,100],100,100) is None
