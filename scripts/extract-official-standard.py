"""Read official xlsx files; never resave them with openpyxl.

Usage: python scripts/extract-official-standard.py SOURCE_DIRECTORY
The hashes pin the exact IPA 2026-10-29 downloads; changed files require review.
"""
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path
import openpyxl

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
criteria_path = source / 'SCS-400-criteria-v1.1.xlsx'
template_path = source / 'SCS-410AP-self-assess-sheet-v1.0.xlsx'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(criteria_path) == '65fcb51ffe40b09c949d9f113f3a942cf95cda946a9a6a5d59c25ad46f93eed1', 'Review new official criteria before changing the pinned version'
assert sha(template_path) == 'a91cf8bcd798c40a3e2d989bb76c81a0c1da1f5063f062bb9cbbfbc8ec6731e5', 'Review new template before changing the mapping'
canonical = lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
sheet = openpyxl.load_workbook(criteria_path).active
def value(ws, address, seen=None):
    seen = set() if seen is None else seen
    if address in seen:
        raise ValueError('Circular source reference')
    seen.add(address)
    v = ws[address].value
    if isinstance(v, str) and v.startswith('='):
        assert re.fullmatch(r'=[A-Z]+[0-9]+', v), (address, v)
        return value(ws, v[1:], seen)
    return v

all_criteria = []
for row in range(3, sheet.max_row + 1):
    cid = value(sheet, f'L{row}')
    if not cid:
        continue
    assert re.fullmatch(r'\d+-\d+-\d+-\d+', cid)
    all_criteria.append(dict(id=cid, level=value(sheet, f'K{row}'), requirementId=value(sheet, f'F{row}'),
        category=value(sheet, f'C{row}'), requirementText=value(sheet, f'J{row}'),
        officialText=value(sheet, f'M{row}'), sourceRow=row))
criteria = [{k: v for k, v in item.items() if k != 'level'} for item in all_criteria if item['level'] == '★3']
for i, item in enumerate(criteria):
    item['orderNo'] = i + 1
assert len(criteria) == len({c['id'] for c in criteria}) == 81
book = openpyxl.load_workbook(template_path)
assert book.sheetnames == ['【★3・★4共通】適用範囲に関する質問事項', '【★3用】アセスメントシート', '【★4用】アセスメントシート']
ws = book.worksheets[1]
assert ws['I18'].value == '評価基準No.' and ws['R18'].value == '回答欄'
rows = []
template_differences = {}
for row in range(19, 127):
    cid = value(ws, f'I{row}')
    criterion = next(c for c in criteria if c['id'] == cid)
    # Whitespace in the two official documents is not part of the substantive wording.
    if re.sub(r'\s+', '', value(ws, f'J{row}')) != re.sub(r'\s+', '', criterion['officialText']):
        template_differences[cid] = dict(criteria=criterion['officialText'], template=value(ws, f'J{row}'))
    rows.append(dict(key=f'{cid}:{sum(r["criterionId"] == cid for r in rows) + 1}', criterionId=cid,
        row=row, conformity=value(ws, f'N{row}') or '', method=value(ws, f'O{row}') or '',
        question=value(ws, f'Q{row}') or '', resultCell=f'P{row}', answerCell=f'R{row}',
        exclusionCell=f'L{row}', exclusionReasonCell=f'M{row}'))
assert set(r['criterionId'] for r in rows) == set(c['id'] for c in criteria)
scope = [dict(id=str(book.worksheets[0].cell(r, 1).value), question=book.worksheets[0].cell(r, 2).value,
              help=book.worksheets[0].cell(r, 3).value, cell=f'D{r}') for r in range(3, 14)]
scope[0]['options'] = next(iter(book.worksheets[0].data_validations.dataValidation)).formula1.strip('"').split(',')
base_url = 'https://www.ipa.go.jp/security/scs/rcu1hd0000007a2i-att/'
standard = dict(id='scs-20261028-v1.1-star3', publicationDate='2026-10-28', level=3,
    sourceUrl=base_url + criteria_path.name, sourceSha256=sha(criteria_path),
    contentSha256=hashlib.sha256(canonical(criteria).encode()).hexdigest(), expectedCount=81, criteria=criteria)
catalog = dict(standard=standard, template=dict(version='1.0', updatedAt='2026-10-29',
    file=template_path.name, url=base_url + template_path.name, sha256=sha(template_path),
    scopeSheet=book.sheetnames[0], assessmentSheet=book.sheetnames[1]), rows=rows, scopeQuestions=scope, templateDifferences=template_differences)
target = root / 'src/shared/data/official-scs-v1.1.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
assets = root / 'public/official'
assets.mkdir(parents=True, exist_ok=True)
shutil.copyfile(template_path, assets / template_path.name)
quote = lambda v: "'" + str(v).replace("'", "''") + "'"
sql = ['-- Add a sealed version. Existing standards, assessments and report snapshots remain unchanged.',
       'INSERT INTO standards VALUES (' + ','.join(quote(standard[k]) for k in ['id','publicationDate','level','sourceUrl','sourceSha256','contentSha256','expectedCount']) + ',NULL);']
for c in criteria:
    sql.append('INSERT INTO criteria VALUES (' + ','.join(quote(v) for v in [standard['id'], c['id'],c['requirementId'],c['category'],c['orderNo'],c['requirementText'],c['officialText'],c['sourceRow']]) + ');')
sql.append(f"UPDATE standards SET sealed_at='2026-11-03T00:00:00.000Z' WHERE id={quote(standard['id'])};")
(root / 'migrations/0010_official_standard_v1_1.sql').write_text('\n'.join(sql) + '\n', encoding='utf-8')
old = json.loads((root / 'poc/excel/master.json').read_text(encoding='utf-8'))
changes = [c['id'] for c in all_criteria if next(o for o in old if o['id'] == c['id'])['publicCells']['13'] != c['officialText']]
print(json.dumps(dict(criteria=len(criteria), rows=len(rows), questions=sum(bool(r['question']) for r in rows), scope=len(scope), changedIds=changes, templateDifferences=template_differences, criteriaSha256=sha(criteria_path), templateSha256=sha(template_path)), ensure_ascii=False))
