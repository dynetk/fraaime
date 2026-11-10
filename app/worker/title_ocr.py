"""Bounded title OCR. Text is evidence, never code or geometry."""
import csv
import io
import os
import re
import subprocess
import time
import tempfile
from pathlib import Path
from PIL import Image

OCR_VERSION = 2
# Used only to stop orientation retries, not to determine a building's geometry.
TITLE = re.compile(r'^(?:(?:(?:first|second|third|1st|2nd|3rd|ground|main|upper|lower|basement)\s+)?floor\s+plan(?:\s*\([^)]*\))?|roof(?:\s+(?:deck|framing))?\s+plan|(?:(?:exterior|interior|ext\.)\s+elevations?|elevations)(?:\s*\([^)]*\))?|(?:(?:building|cross|partial|long|short)[ -]+sections?|sections)|(?:site|electrical|power|lighting|framing|foundation)\s+plan|(?:not\s+used|slab\s+plan|general\s+notes|sheet\s+index|drawing\s+index|index\s+of\s+drawings|drawing\s+list|cover\s+sheet|title\s+sheet)|(?:(?:door|window|door\s*&\s*window)\s+)?schedules?(?:\s*&\s*details)?|(?:[A-Z][A-Z-]*\s+){0,4}details)[,&: ]*$', re.I)

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

def title_lines(lines):
    """Join adjacent short title lines, without joining unrelated columns."""
    found = [line for line in lines if TITLE.search(line['text'])]
    for i, first in enumerate(lines):
        group = [first]
        for nxt in lines[i+1:i+3]:
            previous = group[-1]['region']; r = nxt['region']
            overlap = min(previous[2], r[2]) - max(previous[0], r[0])
            if overlap <= 0 or not -0.005 <= r[1]-previous[3] <= 0.035:
                break
            group.append(nxt)
            text = ' '.join(x['text'] for x in group)
            if len(text) <= 100 and TITLE.search(text):
                found.append(dict(text=text, confidence=min(x['confidence'] for x in group), region=[min(x['region'][0] for x in group),min(x['region'][1] for x in group),max(x['region'][2] for x in group),max(x['region'][3] for x in group)]))
    # More specific joined titles precede shorter fragments.
    return sorted(found, key=lambda x: -len(x['text']))


def ocr_file(path: Path, page: int):
    started = time.monotonic()
    attempts = 0
    timeouts = 0
    best = []
    best_rotation = 0
    def result(status, lines=None, error=None):
        selected = (lines if lines is not None else best[:20])
        value = dict(version=OCR_VERSION, engine='tesseract', status=status, rotation=best_rotation, lines=selected, text='\n'.join(x['text'] for x in selected)[-24000:], attempts=attempts, timedOutAttempts=timeouts, durationMs=round((time.monotonic()-started)*1000))
        if error: value['error'] = error
        return value
    try:
        # Separate high-resolution rendering from small, bounded recognition tasks.
        # Never overwrite the source render while testing another orientation.
        with tempfile.TemporaryDirectory(prefix='fraaime-title-') as folder:
            prefix = Path(folder)/'render'
            subprocess.run(['pdftoppm','-f',str(page),'-l',str(page),'-cropbox','-singlefile','-scale-to','5000','-gray','-png',str(path),str(prefix)],check=True,timeout=60,capture_output=True)
            with Image.open(prefix.with_suffix('.png')) as original:
                original.load()
                deadline = time.monotonic() + 90
                # Read likely title areas in every orientation before scanning notes.
                regions = [(0.72,0.5,1,1),(0,0.82,1,1),(0.78,0,1,1),(0,0,1,1)]
                for region in regions:
                    for rotation in [0,90,270,180]:
                        remaining = deadline-time.monotonic()
                        if remaining < 1:
                            return result('failed', error='Title recognition reached its processing budget. Review this page or retry OCR.')
                        im = original.rotate(rotation,expand=True)
                        x0,y0,x1,y1 = [round(region[i]*[im.width,im.height,im.width,im.height][i]) for i in range(4)]
                        crop = im.crop((x0,y0,x1,y1))
                        # Full sheets are only a last fallback; limit dense-note cost.
                        if region == (0,0,1,1): crop.thumbnail((2400,2400))
                        else: crop.thumbnail((2200,2200))
                        image_path = Path(folder)/'crop.png';crop.save(image_path)
                        attempts += 1
                        try:
                            raw = subprocess.run([os.getenv('TESSERACT_CMD','tesseract'),str(image_path),'stdout','-l','eng','--psm','11','tsv'],check=True,timeout=min(12,remaining),capture_output=True,text=True,env={**os.environ,'OMP_THREAD_LIMIT':'1'})
                        except subprocess.TimeoutExpired:
                            timeouts += 1
                            continue
                        lines = parse_tsv(raw.stdout,crop.width,crop.height)
                        for line in lines:
                            r=line['region']
                            line['region']=[round((r[0]*(x1-x0)+x0)/im.width,5),round((r[1]*(y1-y0)+y0)/im.height,5),round((r[2]*(x1-x0)+x0)/im.width,5),round((r[3]*(y1-y0)+y0)/im.height,5)]
                        if len(lines)>len(best): best,best_rotation=lines,rotation
                        titles=title_lines(lines)
                        if titles:
                            best_rotation=rotation
                            return result('complete',titles)
                if timeouts:
                    return result('failed',error='Some title-reading attempts timed out. Review this page or retry OCR; its drawing can still be included.')
                return result('unreadable',error='No drawing title was recognized. This page is unselected by default; select it if it belongs in the model.')
    except FileNotFoundError:
        return result('failed',error='Title OCR is unavailable on the PDF worker. Install Tesseract and Poppler.')
    except (subprocess.SubprocessError,OSError):
        return result('failed',error='Could not render or read this title. View the drawing and include it or retry OCR.')
