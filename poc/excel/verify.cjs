'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ExcelJS = require('./vendor/exceljs.min.js');
const core = require('./core.js');
const scenarios = require('./scenarios.js');
const repo = path.resolve(__dirname, '../..');
const source = process.argv[2];
const official = process.argv[3] || path.join(repo, '.reference/scs-official-20260327.xlsx');
const output = path.join(repo, '.local/excel-result.json');
(async function main() {
  if (!source) throw new Error('Usage: node poc/excel/verify.cjs source.xlsx [official-master.xlsx]');
  const start = performance.now();
  const bundleHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'vendor/exceljs.min.js'))).digest('hex');
  assert.equal(bundleHash, '7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9');
  const publicBytes = fs.readFileSync(official);
  const publicWorkbook = await core.load(ExcelJS, publicBytes);
  const master = core.makeMaster(publicWorkbook.workbook.worksheets[0]);
  assert.equal(master.filter(row => row.level === '★3').length, 81);
  assert.equal(master.filter(row => row.level === '★4').length, 72);
  // Public workbook only: no customer responses are serialized to fixtures or logs.
  fs.writeFileSync(path.join(__dirname, 'master.json'), JSON.stringify(master, null, 2) + '\n');
  const privateBytes = fs.readFileSync(source);
  const loaded = await core.load(ExcelJS, privateBytes);
  const sheet = loaded.workbook.worksheets[0];
  const result = core.parse(sheet, master);
  assert.deepEqual(result.errors.map(error => error.code), []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.star4Found, 72);
  assert.deepEqual(core.counts(result.records), { total: 81, '○': 24, '△': 24, '✖': 28, '未回答': 5, '要確認': 0 });
  let rawEqual = 0, mergedLevels = 0;
  for (const record of result.records) {
    assert.equal(sheet.getCell(`L${record.sourceRow}`).text, record.id);
    assert.equal(record.sourceLevel.text, '★3');
    if (record.sourceLevel.address !== record.sourceLevel.masterAddress) mergedLevels++;
    for (const column of core.RESPONSE_COLUMNS) {
      const sourceCell = sheet.getCell(`${column}${record.sourceRow}`);
      // Assert booleans, rather than assert.deepEqual(raw values): a failure must not leak source text.
      assert.ok(JSON.stringify(record.original[column].value) === JSON.stringify(sourceCell.value), `raw equality ${record.id} ${column}`);
      assert.equal(record.original[column].address, `${column}${record.sourceRow}`);
      assert.equal(record.original[column].masterAddress, sourceCell.master.address);
      rawEqual++;
    }
  }
  assert.ok(mergedLevels > 0);
  const synthetic = await scenarios.run(ExcelJS, core, master);
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out/anonymous-import.xlsx'), synthetic.anonymousWorkbook);
  fs.writeFileSync(path.join(__dirname, 'out/safe-text-roundtrip.xlsx'), synthetic.exportedWorkbook);
  const report = {
    id: 'excel-roundtrip', result: 'verified', confidence: 0.91,
    verifiedAt: new Date().toISOString(), library: 'ExcelJS 4.4.0 browser bundle', bundleSha256: bundleHash,
    officialWorkbookSha256: crypto.createHash('sha256').update(publicBytes).digest('hex'),
    evidence: { counts: core.counts(result.records), star4Additional: result.star4Found, rawOPQREqualityAssertions: rawEqual,
      actualMergedKRows: mergedLevels, sourceZip: loaded.zip, sourceNonemptyCells: loaded.cellCount,
      syntheticAssertions: synthetic.passed, syntheticChecks: synthetic.checks, elapsedMs: Math.round(performance.now() - start) },
    command: 'node poc/excel/verify.cjs [source.xlsx] [official-master.xlsx]',
    browserProbe: 'poc/excel/browser.html; browser artifact uses identical bundle and portable core; see separate browser verification if run',
    browserExecution: 'not yet observed in this process; Node ran the browser-distributed bundle and all portable tests',
    limits: [
      'PoC only; browser UI, actual file picker, production bundle, CPU/memory under hostile workbooks are not validated by Node execution.',
      'ZIP preflight limits declared expanded sizes; malicious metadata can lie. Production requires worker isolation, deadline/termination, and capped streaming decompression before parser allocation.',
      'Current after-load row/column/cell limits do not prevent ExcelJS initial allocation. Keep these limits separate from pre-parser protections.',
      'Only exact current official xlsx layout is accepted. xls/xlsm/zip64/encrypted workbooks are unsupported; unknown headers/IDs/statuses/formulas block commit.',
      'Output is a separate working workbook, not a lossless styling-preserving rewrite of the original government template.',
      'ExcelJS does not calculate formulas. Formula O-R is retained as raw metadata but rejected; cached results are not answers.',
      'Five unanswered actual responses and all missing criteria remain in the 81-criterion denominator. No certification prediction or weighted pass score.'
    ],
    coverageReview: [
      'Plan covers central happy path, missing/unknown/duplicate/formula inputs, source/edit separation and safe export.',
      'Added explicit missing acknowledgement, exact O-R newline/blank/merged origin assertions, public B-N/master match and level mismatch rejection.',
      'Before production add malformed ZIP expansion cap, browser worker timeout/memory tests, official-version migration, date/error/rich-text cells and accessibility/file-picker end-to-end checks.'
    ],
    sources: [
      'https://github.com/exceljs/exceljs/blob/v4.4.0/README.md#browser',
      'https://github.com/exceljs/exceljs/blob/v4.4.0/README.md#merged-cells',
      'https://github.com/exceljs/exceljs/blob/v4.4.0/README.md#formula-value',
      'https://github.com/exceljs/exceljs/blob/v4.4.0/LICENSE'
    ]
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: report.result, confidence: report.confidence, evidence: report.evidence }, null, 2));
})().catch(error => {
  // Sanitized failure output; do not serialize cell values or workbook content.
  console.error(JSON.stringify({ result: 'failed', name: error.name, message: error.message }));
  process.exitCode = 1;
});
