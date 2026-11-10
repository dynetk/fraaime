import os
import sys
import shutil
from pathlib import Path
import pytest
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
sys.path.insert(0,str(Path(__file__).parents[1]))
from title_ocr import parse_tsv, ocr_file

def test_confidence_and_coordinate_filtering():
    header='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
    rows='5\t1\t1\t1\t1\t1\t10\t20\t40\t10\t95\tFLOOR\n5\t1\t1\t1\t1\t2\t55\t20\t30\t10\t90\tPLAN\n5\t1\t2\t1\t1\t1\t10\t50\t30\t10\t12\tnoise\n'
    lines=parse_tsv(header+rows,100,100)
    assert len(lines)==1
    assert lines[0]['text']=='FLOOR PLAN'
    assert lines[0]['region']==[.1,.2,.85,.3]
    assert lines[0]['confidence']>90

@pytest.mark.parametrize('rotation',[0,90,180,270])
def test_actual_ocr_reads_rotated_scanned_title(tmp_path,rotation):
    if not shutil.which(os.getenv('TESSERACT_CMD','tesseract')):
        pytest.skip('Install Tesseract to run OCR integration tests')
    im=Image.new('RGB',(1800,1200),'white')
    ImageDraw.Draw(im).text((1300,900),'FIRST\nFLOOR PLAN',font=ImageFont.load_default(size=65),fill='black')
    raw=tmp_path/'scan.pdf';im.save(raw,'PDF',resolution=120)
    writer=PdfWriter();writer.add_page(PdfReader(raw).pages[0]).rotate(rotation)
    source=tmp_path/'source.pdf'
    with source.open('wb') as f:writer.write(f)
    result=ocr_file(source,1)
    assert result['status']=='complete'
    assert 'FLOOR PLAN' in result['text']
    assert all(line['confidence']>=60 for line in result['lines'])

def test_missing_engine_is_explicit(tmp_path,monkeypatch):
    monkeypatch.setattr('title_ocr.subprocess.run',lambda *a,**k: (_ for _ in ()).throw(FileNotFoundError()))
    result=ocr_file(tmp_path/'source.pdf',1)
    assert result['status']=='failed'
    assert 'unavailable' in result['error']

def test_multiline_titles_do_not_join_unrelated_columns():
    from title_ocr import title_lines
    lines=[dict(text='ROOF FRAMING',confidence=95,region=[.8,.7,.95,.72]),dict(text='PLAN',confidence=90,region=[.8,.725,.9,.745])]
    assert title_lines(lines)[0]['text']=='ROOF FRAMING PLAN'
    lines[1]['region']=[.1,.725,.2,.745]
    assert not title_lines(lines)

def test_recognition_timeouts_remain_explicit(tmp_path,monkeypatch):
    import subprocess
    import title_ocr
    real=title_ocr.subprocess.run
    def run(args,**kwargs):
        if args[0]=='pdftoppm':
            Image.new('L',(1000,800),255).save(args[-1]+'.png')
            return subprocess.CompletedProcess(args,0)
        raise subprocess.TimeoutExpired(args,kwargs['timeout'])
    monkeypatch.setattr(title_ocr.subprocess,'run',run)
    result=title_ocr.ocr_file(tmp_path/'source.pdf',1)
    assert result['status']=='failed'
    assert result['timedOutAttempts']==result['attempts']==16
    assert 'timed out' in result['error']
