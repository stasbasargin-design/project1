from pathlib import Path

root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text(encoding='utf-8')
for filename in ('styles.css', 'skin.css'):
    html = html.replace(
        f'<link rel="stylesheet" href="src/{filename}">',
        '<style>\n' + (root / 'src' / filename).read_text(encoding='utf-8') + '\n</style>'
    )
html = html.replace(
    '<script src="src/app.js"></script>',
    '<script>\n' + (root / 'src' / 'app.js').read_text(encoding='utf-8') + '\n</script>'
)
assert '<script src="src/' not in html
assert '<link rel="stylesheet" href="src/' not in html
(root / 'AlfaAuto_Trainer_v5.html').write_text(html, encoding='utf-8')
print('Standalone HTML generated:', len(html), 'characters')
