#!/usr/bin/env bash
set -Eeuo pipefail
# Called by exact-SHA deployment after its backup; this file contains only I-MAX locations.
python3 - <<'PY'
from pathlib import Path
import re
p=Path('/etc/nginx/snippets/itus-max.conf')
text=p.read_text()
if 'location ^~ /p/max-service/' not in text or text.count('proxy_pass ') != 1 or text.count('proxy_connect_timeout 10s;') != 1:
    raise SystemExit('Unexpected I-MAX nginx layout; no configuration changed')
for directive,value in [('client_max_body_size','0'),('proxy_read_timeout','1200s')]:
    text,count=re.subn(r'(?m)^\s*'+directive+r'\s+[^;]+;', '    '+directive+' '+value+';',text)
    if count != 1: raise SystemExit('Expected exactly one '+directive)
for directive,value in [('proxy_request_buffering','off'),('proxy_send_timeout','1200s'),('client_body_timeout','120s')]:
    pattern=r'(?m)^\s*'+directive+r'\s+[^;]+;'
    if re.search(pattern,text): text=re.sub(pattern,'    '+directive+' '+value+';',text)
    else: text=text.replace('    proxy_connect_timeout 10s;','    proxy_connect_timeout 10s;\n    '+directive+' '+value+';')
p.write_text(text)
PY
nginx -t
systemctl reload nginx
