"""Bounded title OCR. Text is evidence, never code or geometry."""
import csv
import io
import os
import re
import subprocess
import time
from pathlib import Path
from PIL import Image

OCR_VERSION = 1
# Used only to stop orientation retries, not to determine a building's geometry.
TITLE = re.compile(r'^(?:(?:(?:first|second|third|1st|2nd|3rd|ground|main|upper|lower|basement)\s+)?floor\s+plan(?:\s*\([^)]*\))?|roof(?:\s+deck)?\s+plan|(?:(?:exterior|interior|ext\.)\s+elevations?|elevations)(?:\s*\([^)]*\))?|(?:(?:building|cross|partial|long|short)[ -]+sections?|sections)|(?:site|electrical|power|lighting|framing|foundation)\s+plan|(?:general\s+notes|sheet\s+index|drawing\s+index|index\s+of\s+drawings|drawing\s+list|cover\s+sheet|title\s+sheet)|(?:door|window|door\s*&\s*window)\s+schedules?|(?:[A-Z][A-Z-]*\s+){0,4}details)[,&: ]*$', re.I)

def parse_tsv(data: str, width: int, height: int):
    groups = {}
    for row in csv.DictReader(io.StringIO(data), delimiter='\t', quoting=csv.QUOTE_NONE):
        if row.get('level') != '5' or not row.get('text', '').strip():
            continue
        try:
            confidence = float(row['conf'])
            x, y, w, h = [int(row[k]) for k in ('left', 'top', 'width', 'height')]
        except (ValueError, KeyError):
            continue
        if confidence < 0:
            continue
        key = tuple(row.get(k) for k in ('page_num', 'block_num', 'par_num', 'line_num'))
        groups.setdefault(key, []).append((row['text'].strip(), confidence, x, y, w, h))
    lines = []
    for words in groups.values():
        text = ' '.join(w[0] for w in words)
        confidence = sum(w[1] * len(w[0]) for w in words) / sum(len(w[0]) for w in words)
        if confidence < 60 or len(text) > 250:
            continue
        x0, y0 = min(w[2] for w in words), min(w[3] for w in words)
        x1, y1 = max(w[2]+w[4] for w in words), max(w[3]+w[5] for w in words)
        lines.append(dict(text=text, confidence=round(confidence, 1), region=[round(x0/width,5),round(y0/height,5),round(x1/width,5),round(y1/height,5)]))
    return lines[:1200]

def ocr_file(path: Path, page: int):
    prefix = path.parent / f'title-{page}'
    try:
        subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-cropbox','-singlefile','-scale-to','3600','-gray','-png',str(path),str(prefix)], check=True,timeout=35,capture_output=True)
        image_path = prefix.with_suffix('.png')
        with Image.open(image_path) as original:
            original.load()
            best = []
            best_rotation = 0
            deadline = time.monotonic() + 25
            timed_out = False
            # Start with the usual title-block band; dense drawing notes need not be OCRed.
            attempts = [(0, True), (0, False), (90, True), (270, True), (180, True), (90, False), (270, False), (180, False)]
            for rotation, band in attempts:
                remaining = deadline - time.monotonic()
                if remaining < 1:
                    timed_out = True
                    break
                im = original.convert('L').rotate(rotation, expand=True)
                offset = int(im.width * .75) if band else 0
                crop = im.crop((offset, 0, im.width, im.height))
                crop.save(image_path)
                try:
                    result = subprocess.run([os.getenv('TESSERACT_CMD','tesseract'),str(image_path),'stdout','-l','eng','--psm','11','tsv'],check=True,timeout=min(8,remaining),capture_output=True,text=True,env={**os.environ,'OMP_THREAD_LIMIT':'1'})
                except subprocess.TimeoutExpired:
                    timed_out = True
                    continue
                lines = parse_tsv(result.stdout, crop.width, crop.height)
                for line in lines:
                    region = line['region']
                    region[0] = round((region[0] * crop.width + offset) / im.width, 5)
                    region[2] = round((region[2] * crop.width + offset) / im.width, 5)
                titles = [line for line in lines if TITLE.search(line['text'])]
                if len(titles) > len([line for line in best if TITLE.search(line['text'])]) or not best:
                    best, best_rotation = lines, rotation
                if titles:
                    break
        # Retain high-confidence title-like lines even in densely annotated sheets.
        title_lines = [line for line in best if TITLE.search(line['text'])]
        others = [line for line in best if not TITLE.search(line['text'])]
        selected = title_lines if title_lines else others[:20]
        return dict(version=OCR_VERSION,engine='tesseract',status='complete' if title_lines else ('failed' if timed_out else 'unreadable'),**({'error':'Title OCR reached its time limit. Retry or select this sheet manually.'} if timed_out and not title_lines else {}),rotation=best_rotation,lines=selected,text='\n'.join(line['text'] for line in selected)[-24000:])
    except FileNotFoundError:
        return dict(version=OCR_VERSION,engine='tesseract',status='failed',text='',lines=[],error='Title OCR is unavailable on the PDF worker. Install Tesseract and Poppler.')
    except (subprocess.SubprocessError, OSError):
        return dict(version=OCR_VERSION,engine='tesseract',status='failed',text='',lines=[],error='Title OCR timed out or could not read this sheet. Retry or select it manually.')
