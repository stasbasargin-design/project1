from pathlib import Path
p=Path(__file__).parent
h=(p/'index.html').read_text(encoding='utf-8')
for s in ('styles.css','skin.css'):
    h=h.replace(f'<link rel="stylesheet" href="src/{s}">', '<style>\n'+(p/'src'/s).read_text(encoding='utf-8')+'\n</style>')
h=h.replace('<script src="src/app.js"></script>','<script>\n'+(p/'src/app.js').read_text(encoding='utf-8')+'\n</script>')
(p/'AlfaAuto_Trainer_v7.html').write_text(h,encoding='utf-8')
print(len(h), 'characters')
