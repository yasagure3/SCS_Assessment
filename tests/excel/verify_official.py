"""Independent read-only verification of the browser-downloaded representative workbook."""
import json
import re
import sys
import warnings
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
import openpyxl

warnings.filterwarnings('ignore', message='Cannot parse header or footer')
root = Path(__file__).resolve().parents[2]
catalog = json.loads((root / 'src/shared/data/official-scs-v1.1.json').read_text(encoding='utf-8'))
output = Path(sys.argv[1])
template = root / 'public/official' / catalog['template']['file']
before, after = zipfile.ZipFile(template), zipfile.ZipFile(output)
assert set(before.namelist()) == set(after.namelist())
changed = [name for name in before.namelist() if before.read(name) != after.read(name)]
assert sorted(changed) == ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
allowed = {'xl/worksheets/sheet1.xml': {q['cell'] for q in catalog['scopeQuestions']},
           'xl/worksheets/sheet2.xml': {'P2','P3','P4','P5','P13','P14'}}
for r in catalog['rows']:
    allowed['xl/worksheets/sheet2.xml'].update([r['exclusionCell'],r['exclusionReasonCell'],r['resultCell']])
    if r['question']:
        allowed['xl/worksheets/sheet2.xml'].add(r['answerCell'])
formulas = 0
for name in before.namelist():
    if not re.fullmatch(r'xl/worksheets/sheet\d+\.xml', name):
        continue
    original, exported = ET.fromstring(before.read(name)), ET.fromstring(after.read(name))
    original_cells = {c.attrib['r']: c for c in original.findall('.//m:sheetData/m:row/m:c', ns)}
    output_cells = {c.attrib['r']: c for c in exported.findall('.//m:sheetData/m:row/m:c', ns)}
    assert set(original_cells) == set(output_cells)
    for address, cell in original_cells.items():
        actual = output_cells[address]
        if cell.find('m:f', ns) is not None:
            formulas += 1
        if address not in allowed.get(name, set()):
            assert ET.tostring(cell) == ET.tostring(actual), (name, address)
        else:
            assert actual.attrib.get('s') == cell.attrib.get('s')
            assert actual.find('m:f', ns) is None, address
book = openpyxl.load_workbook(output, data_only=False)
assert book.sheetnames == [catalog['template']['scopeSheet'],catalog['template']['assessmentSheet'],'【★4用】アセスメントシート']
ws = book.worksheets[1]
assert ws['P2'].value == '公式Excel検証株式会社'
assert ws['P3'].value == '東京都千代田区（検証用）'
assert book.worksheets[0]['D3'].value == 'a.法人全体'
assert ws['P19'].value == '適合' and ws['P20'].value == '不適合'
assert ws['R19'].value == '情報セキュリティ規程 第2章\n組織図2026 & <確認済み>'
assert ws['P126'].value == '適合'
assert ws['R126'].value == '=HYPERLINK("https://example.invalid")\n復旧手順 第8章'
assert ws['R126'].data_type == 's'
for row in catalog['rows']:
    if row['criterionId'] == '3-1-3-1':
        assert ws[row['exclusionCell']].value == '○'
        assert ws[row['exclusionReasonCell']].value == '外部情報サービスを使用していない'
    if row['resultCell'] not in ['P19','P20','P126']:
        assert ws[row['resultCell']].value in ['', None]
for cell in ['P7','P8','P9','P10','P12','P15','P16']:
    assert ws[cell].value is None, 'No automatic attestation or signature'
print(json.dumps({'result':'PASS','sheets':len(book.worksheets),'formulasPreserved':formulas,'unchangedPackageParts':len(before.namelist())-2,'verifiedInputCells':sum(map(len, allowed.values())),'file':str(output)}, ensure_ascii=False))
