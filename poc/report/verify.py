"""Independent PDF extraction + pixel renders. No customer workbook is read."""
import json, re, subprocess, hashlib
from pathlib import Path
import pdfplumber

ROOT = Path(__file__).resolve().parent
out = ROOT / 'output'
layout = json.loads((out / 'layout.json').read_text(encoding='utf-8'))
snapshot = json.loads((out / 'snapshot.json').read_text(encoding='utf-8'))
generated = json.loads((out / 'generation-result.json').read_text(encoding='utf-8'))
normal = lambda s: re.sub(r'\s+', '', s)
with pdfplumber.open(out / 'scs-star3-anonymous.pdf') as pdf:
    pages = [page.extract_text(x_tolerance=1, y_tolerance=3) or '' for page in pdf.pages]
    assert len(pages) == generated['pages']
    # Every drawn line must be extractable from the actual PDF page.
    checked = 0
    for line in layout['trace']:
        if line['kind'] == 'footer':
            continue
        assert normal(line['text']) in normal(pages[line['page'] - 1]), (line['page'], line['text'])
        checked += 1
    # Remove only known running headers/continuation headings/footer, preserving all body characters.
    body = '\n'.join('\n'.join(line for line in text.splitlines()
        if not line.startswith('SCS DIAGNOSIS /')
        and not re.fullmatch(r'項目 [\d-]+（続き）', line)
        and not line.startswith('SCS-DEMO-SNAPSHOT-001 /')) for text in pages)
    normalized_body = normal(body)
    for field in layout['fields']:
        assert normal(field['text']) in normalized_body, field['field']
    for row in snapshot['criteria']:
        assert row['id'] in body, row['id']
        assert normal(row['criterion']) in normalized_body, row['id']
    assert '未回答 5件 / 証跡未確認 60件 / 助言未確定 11件' in body
    assert 'UNCONFIRMED_DRAFT' not in body
    assert '長文検証001' in body and '長文検証018' in body and '長文検証036' in body
    char_count = sum(len(page.chars) for page in pdf.pages)
    # Independent glyph bounding boxes catch off-page output, including header/footer.
    for i, page in enumerate(pdf.pages):
        for c in page.chars:
            assert c['x0'] >= 0 and c['x1'] <= page.width + 0.1, (i, c)
            assert c['top'] >= 0 and c['bottom'] <= page.height + 0.1, (i, c)
render_pages = sorted({1, (len(pages) + 1) // 2, len(pages), generated['longAdvicePages'][0], generated['longAdvicePages'][1]})
for n in render_pages:
    subprocess.run(['pdftoppm', '-f', str(n), '-l', str(n), '-singlefile', '-r', '100', '-png', str(out / 'scs-star3-anonymous.pdf'), str(out / f'page-{n:03d}')], check=True, capture_output=True)
result = { 'passed': True, 'all81Ids': True, 'all81CriterionTexts': True, 'allFieldTexts': len(layout['fields']), 'extractedLineChecks': checked, 'glyphBoundsChecks': char_count, 'longAdviceEntireTextPresent': True, 'unconfirmedDraftExcluded': True, 'renderedPages': render_pages, 'sha256': hashlib.sha256((out / 'scs-star3-anonymous.pdf').read_bytes()).hexdigest() }
(out / 'extraction-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result))
