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
