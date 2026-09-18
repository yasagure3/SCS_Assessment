(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScsExcelScenarios = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function fixture(ExcelJS, core, master) {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('匿名検証');
    for (const [col, header] of Object.entries(core.EXPECTED_HEADERS)) sheet.getCell(`${col}2`).value = header;
    let index = 0;
    master.forEach((item, i) => {
      const row = i + 3;
      for (const [col, value] of Object.entries(item.publicCells)) sheet.getCell(row, Number(col)).value = value;
      if (item.level !== '★3') return;
      sheet.getCell(`O${row}`).value = index < 24 ? '○' : index < 48 ? '△' : index < 76 ? '✖' : null;
      sheet.getCell(`P${row}`).value = `匿名理由-${item.id}\n2行目`;
      sheet.getCell(`Q${row}`).value = index % 2 ? `匿名証跡-${item.id}` : '';
      sheet.getCell(`R${row}`).value = `匿名補足-${item.id}`;
      index++;
    });
    // Merge consecutive same-level cells, testing a boundary when the level changes.
    let start = 3;
    for (let row = 4; row <= master.length + 3; row++) {
      if (row === master.length + 3 || sheet.getCell(`K${row}`).value !== sheet.getCell(`K${start}`).value) {
        if (row - start > 1) sheet.mergeCells(`K${start}:K${row - 1}`);
        start = row;
      }
    }
    return { workbook, sheet };
  }
  async function run(ExcelJS, core, master) {
    const assertions = [];
    function check(condition, label) { if (!condition) throw new Error(`ASSERTION_FAILED: ${label}`); assertions.push(label); }
    async function parsed(change) {
      const value = fixture(ExcelJS, core, master);
      if (change) change(value.sheet);
      const bytes = new Uint8Array(await value.workbook.xlsx.writeBuffer());
      const loaded = await core.load(ExcelJS, bytes);
      return { ...loaded, bytes, result: core.parse(loaded.workbook.worksheets[0], master) };
    }
    const good = await parsed();
    check(good.result.errors.length === 0, 'anonymous baseline has no blocking errors');
    check(good.result.records.length === 81 && good.result.star4Found === 72, 'anonymous baseline 81 plus 72');
    const totals = core.counts(good.result.records);
    check(totals['○'] === 24 && totals['△'] === 24 && totals['✖'] === 28 && totals['未回答'] === 5, 'anonymous baseline 24/24/28/5');
    const first = good.result.records[0], firstRow = first.sourceRow;
    check(first.original.P.text === `匿名理由-${first.id}\n2行目`, 'P exact ID keyed text and newline');
    check(first.original.Q.text === '', 'Q blank remains blank');
    check(first.original.R.text === `匿名補足-${first.id}`, 'R exact ID keyed text');
    check(first.original.O.text === '○' && first.original.O.address === `O${firstRow}`, 'O exact status and source cell');
    check(master[firstRow - 3].id === first.id, 'ID and source row alignment');
    let merged = 0, boundaries = 0;
    for (const record of good.result.records) {
      check(record.sourceLevel.text === '★3' && record.level === '★3', 'merged K resolves to official level');
      if (record.sourceLevel.masterAddress !== record.sourceLevel.address) merged++;
    }
    for (let i = 1; i < master.length; i++) {
      if (master[i].level !== master[i - 1].level) {
        check(core.cellData(good.workbook.worksheets[0].getCell(`K${i + 3}`)).text === master[i].level, 'K merged boundary does not bleed into next level');
        boundaries++;
      }
    }
    check(merged > 0 && boundaries > 0, 'fixture exercised merged K and level boundaries');
    check(Object.isFrozen(first.original) && Object.isFrozen(first.original.P), 'original response object is deeply frozen');
    const before = JSON.stringify(first.original);
    first.edited.reason = '編集後の匿名理由';
    check(JSON.stringify(first.original) === before && first.edited.reason !== first.original.P.text, 'edited and original values remain independent');
    const expectError = async (change, code, label) => {
      const next = await parsed(change);
      check(next.result.errors.some(error => error.code === code) && !core.canCommit(next.result, { acknowledgeMissing: true }), label);
      return next;
    };
    await expectError(sheet => { sheet.getCell(`L${firstRow}`).value = '99-99-99-99'; }, 'UNKNOWN_ID', 'unknown ID rejected');
    await expectError(sheet => { sheet.getCell(`L${firstRow}`).value = 'invalid'; }, 'INVALID_ID', 'malformed ID rejected');
    await expectError(sheet => { sheet.getCell(`L${firstRow}`).value = good.result.records[1].id; }, 'DUPLICATE_ID', 'duplicate ID rejected');
    await expectError(sheet => { sheet.getCell(`O${firstRow}`).value = 'OK'; }, 'UNKNOWN_STATUS', 'unknown status rejected without implicit mapping');
    await expectError(sheet => { sheet.getCell(`K${firstRow}`).value = '★4'; }, 'LEVEL_MISMATCH', 'K level mismatch rejected using official master');
    await expectError(sheet => { sheet.getCell(`M${firstRow}`).value = '匿名改変要件'; }, 'PUBLIC_MASTER_MISMATCH', 'modified criterion rejected using versioned official master');
    await expectError(sheet => { sheet.getCell('Q2').value = '削除された列'; }, 'HEADER_MISMATCH', 'missing or remapped column rejected');
    await expectError(sheet => { sheet.getCell(`L${firstRow}`).value = { formula: '1+1', result: first.id }; }, 'FORMULA_ID', 'formula ID rejected despite cached result');
    for (const column of ['O', 'P', 'Q', 'R']) {
      const next = await expectError(sheet => { sheet.getCell(`${column}${firstRow}`).value = { formula: '1+1', result: column === 'O' ? '○' : 'cached' }; }, 'FORMULA_RESPONSE', `${column} formula rejected despite cached result`);
      check(next.result.records[0].original[column].formula && next.result.records[0].original[column].text === '', `${column} formula preserved as raw metadata and never evaluated`);
    }
    const missing = await parsed(sheet => {
      sheet.getCell(`L${firstRow}`).value = null;
      ['O', 'P', 'Q', 'R'].forEach(col => { sheet.getCell(`${col}${firstRow}`).value = null; });
    });
    check(missing.result.records.length === 81 && missing.result.records[0].missing && missing.result.records[0].edited.status === '未回答', 'missing criterion keeps denominator 81 and becomes unanswered');
    check(missing.result.warnings.length === 1 && !core.canCommit(missing.result), 'missing criterion requires acknowledgement');
    check(core.canCommit(missing.result, { acknowledgeMissing: true }), 'missing criterion acknowledged explicitly');
    const adjacent = master.findIndex((row, i) => i > 0 && row.level === '★3' && master[i - 1].level === '★3');
    const mergedResponses = await parsed(sheet => {
      sheet.getCell(`P${adjacent + 2}`).value = '結合理由\n同じ原文';
      sheet.mergeCells(`P${adjacent + 2}:P${adjacent + 3}`);
    });
    const mergedRecord = mergedResponses.result.records.find(row => row.sourceRow === adjacent + 3);
    check(mergedRecord.original.P.text === '結合理由\n同じ原文' && mergedRecord.original.P.masterAddress === `P${adjacent + 2}`, 'merged response retains exact text and origin');
    const literals = ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '\t=HYPERLINK("https://example.invalid","x")', '改行\n空欄前後  ', ''];
    const exportRows = good.result.records.slice(0, literals.length).map((record, i) => ({ ...record,
      edited: { ...record.edited, reason: literals[i], evidenceAndActions: literals[i], supplement: literals[i] } }));
    const exported = await core.exportWorking(ExcelJS, exportRows);
    const exportedLoaded = await core.load(ExcelJS, exported);
    exportRows.forEach((record, i) => {
      const row = exportedLoaded.workbook.worksheets[0].getRow(i + 2);
      for (const col of [8, 9, 10]) {
        check(row.getCell(col).text === literals[i], 'Excel export preserves exact string');
        check(row.getCell(col).type !== ExcelJS.ValueType.Formula && row.getCell(col).formula === undefined, 'formula-looking export remains a string');
      }
      check(row.getCell(4).text === record.original.P.text, 'export retains original P separately');
    });
    const zipBombDeclared = new Uint8Array(good.bytes);
    const zipView = new DataView(zipBombDeclared.buffer);
    for (let pos = 0; pos < zipBombDeclared.length - 46; pos++) {
      if (zipView.getUint32(pos, true) === 0x02014b50) { zipView.setUint32(pos + 24, core.LIMITS.entryBytes + 1, true); break; }
    }
    let zipCode;
    try { core.inspectZip(zipBombDeclared); } catch (error) { zipCode = error.code; }
    check(zipCode === 'ZIP_ENTRY_SIZE_LIMIT', 'declared ZIP expansion rejected before ExcelJS load');
    let invalidCode;
    try { core.inspectZip(new Uint8Array([1, 2, 3])); } catch (error) { invalidCode = error.code; }
    check(invalidCode === 'INVALID_ZIP', 'non-ZIP file rejected');
    return { passed: assertions.length, checks: [...new Set(assertions)], totals, mergedRows: merged, boundaries,
      anonymousWorkbook: good.bytes, exportedWorkbook: exported };
  }
  return { fixture, run };
});
