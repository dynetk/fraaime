"""Load only worker configuration from ignored .env.local, without printing secrets."""
import os
from pathlib import Path
for line in Path('.env.local').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        key,value=line.split('=',1)
        if key in ('APP_ORIGIN','PDF_WORKER_TOKEN'):
            os.environ[key]=value
os.execv('worker/.venv/bin/python',['python','-m','uvicorn','main:app','--app-dir','worker','--host','127.0.0.1','--port','5191'])
