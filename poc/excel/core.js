/* Portable PoC core: no Node, network, DOM, or customer-data logging. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScsExcelPoc = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ fileBytes: 10 * 1024 * 1024, expandedBytes: 50 * 1024 * 1024,
    entryBytes: 10 * 1024 * 1024, entries: 500, rows: 2000, columns: 64, sheets: 5, cells: 100000 });
  const PUBLIC_COLUMNS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const RESPONSE_COLUMNS = ['O', 'P', 'Q', 'R'];
  const EXPECTED_HEADERS = { K: '★3/★4', L: '評価基準No.', M: '評価基準',
    O: '自己評価', P: '理由', Q: '根拠および実施する事', R: '補足情報' };
  const ID = /^\d+-\d+-\d+-\d+$/;
  const clone = value => value == null ? null : structuredClone(value);
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
  function fail(code) { const err = new Error(code); err.code = code; throw err; }
  function cellData(cell) {
    const value = clone(cell.value);
    const formula = !!(value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value));
    const text = formula ? '' : value == null ? '' : typeof value === 'string' ? value
      : typeof value === 'number' || typeof value === 'boolean' ? String(value)
      : value.richText ? value.richText.map(part => part.text).join('')
      : typeof value.text === 'string' ? value.text : '';
    return { value, text, type: cell.type, formula, address: cell.address,
      masterAddress: cell.master ? cell.master.address : cell.address };
  }
  function publicData(sheet, row) {
    return Object.fromEntries(PUBLIC_COLUMNS.map(col => [col, cellData(sheet.getCell(row, col)).text]));
  }
  // Declared-size guard only. A hostile ZIP can lie about these values; see README.
  function inspectZip(input, limits = LIMITS) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength > limits.fileBytes) fail('FILE_SIZE_LIMIT');
    if (bytes.byteLength < 22) fail('INVALID_ZIP');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos--) {
      if (view.getUint32(pos, true) === 0x06054b50 && pos + 22 + view.getUint16(pos + 20, true) === bytes.length) { end = pos; break; }
    }
    if (end < 0) fail('INVALID_ZIP');
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail('MULTIDISK_UNSUPPORTED');
    const entries = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true);
    const directoryBytes = view.getUint32(end + 12, true);
    if (entries === 65535 || start === 0xffffffff || directoryBytes === 0xffffffff) fail('ZIP64_UNSUPPORTED');
    if (entries > limits.entries) fail('ZIP_ENTRY_LIMIT');
    if (start + directoryBytes > end) fail('INVALID_ZIP_DIRECTORY');
    let pos = start, expanded = 0;
    const names = [], unique = new Set();
    const decoder = new TextDecoder();
    for (let i = 0; i < entries; i++) {
      if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) fail('INVALID_ZIP_DIRECTORY');
      const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
      const length = view.getUint32(pos + 24, true), nameLength = view.getUint16(pos + 28, true);
      const next = pos + 46 + nameLength + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
      if (flags & 1) fail('ENCRYPTED_UNSUPPORTED');
      if (![0, 8].includes(method)) fail('COMPRESSION_UNSUPPORTED');
      if (length === 0xffffffff) fail('ZIP64_UNSUPPORTED');
      if (next > end) fail('INVALID_ZIP_DIRECTORY');
      if (length > limits.entryBytes) fail('ZIP_ENTRY_SIZE_LIMIT');
      expanded += length;
      if (expanded > limits.expandedBytes) fail('ZIP_EXPANDED_SIZE_LIMIT');
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
      if (unique.has(name)) fail('ZIP_DUPLICATE_PATH');
      if (/vbaProject\.bin$/i.test(name)) fail('MACROS_UNSUPPORTED');
      if (name.includes('..') || name.startsWith('/') || name.includes('\\')) fail('ZIP_PATH_UNSUPPORTED');
      unique.add(name); names.push(name); pos = next;
    }
    if (pos !== start + directoryBytes || !unique.has('[Content_Types].xml') || !unique.has('xl/workbook.xml')) fail('NOT_XLSX');
    return { entries, declaredExpandedBytes: expanded, fileBytes: bytes.byteLength };
  }
  async function load(ExcelJS, bytes) {
    const zip = inspectZip(bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    if (workbook.worksheets.length > LIMITS.sheets) fail('SHEET_LIMIT');
    let cellCount = 0;
    workbook.eachSheet(sheet => {
      if (sheet.rowCount > LIMITS.rows || sheet.columnCount > LIMITS.columns) fail('SHEET_DIMENSION_LIMIT');
      sheet.eachRow(row => row.eachCell(() => { cellCount++; }));
    });
    if (cellCount > LIMITS.cells) fail('CELL_LIMIT');
    return { workbook, zip, cellCount };
  }
  function makeMaster(sheet) {
    const rows = [];
    sheet.eachRow(row => {
      const id = cellData(row.getCell(12)).text;
      if (!ID.test(id)) return;
      const level = cellData(row.getCell(11)).text;
      if (!['★3', '★4'].includes(level)) fail('INVALID_MASTER_LEVEL');
      rows.push({ id, level, publicCells: publicData(sheet, row.number) });
    });
    if (new Set(rows.map(row => row.id)).size !== rows.length) fail('DUPLICATE_MASTER');
    return freeze(rows);
  }
  function parse(sheet, master) {
    const byId = new Map(master.map(row => [row.id, row])), seen = new Set(), found = new Map(), errors = [], warnings = [];
    const issue = (code, row, column, id) => errors.push({ code, row, column, ...(id ? { id } : {}) });
    for (const [column, expected] of Object.entries(EXPECTED_HEADERS)) {
      if (cellData(sheet.getCell(`${column}2`)).text !== expected) issue('HEADER_MISMATCH', 2, column);
    }
    for (let row = 3; row <= sheet.rowCount; row++) {
      const idCell = cellData(sheet.getCell(`L${row}`));
      const responses = Object.fromEntries(RESPONSE_COLUMNS.map(column => [column, cellData(sheet.getCell(`${column}${row}`))]));
      if (idCell.formula) { issue('FORMULA_ID', row, 'L'); continue; }
      const id = idCell.text;
      if (!id && !Object.values(responses).some(cell => cell.text !== '' || cell.formula)) continue;
      if (!ID.test(id)) { issue('INVALID_ID', row, 'L'); continue; }
      if (!byId.has(id)) { issue('UNKNOWN_ID', row, 'L', id); continue; }
      if (seen.has(id)) { issue('DUPLICATE_ID', row, 'L', id); continue; }
      seen.add(id);
      const official = byId.get(id), levelCell = cellData(sheet.getCell(`K${row}`));
      if (levelCell.formula) issue('FORMULA_LEVEL', row, 'K', id);
      if (levelCell.text !== official.level) issue('LEVEL_MISMATCH', row, 'K', id);
      const providedPublic = publicData(sheet, row);
      if (PUBLIC_COLUMNS.some(col => providedPublic[col] !== official.publicCells[col])) issue('PUBLIC_MASTER_MISMATCH', row, 'B:N', id);
      for (const [column, cell] of Object.entries(responses)) {
        if (cell.formula) issue('FORMULA_RESPONSE', row, column, id);
        if (cell.value && typeof cell.value === 'object' && !cell.formula && !('text' in cell.value) && !('richText' in cell.value)) issue('UNSUPPORTED_RESPONSE_TYPE', row, column, id);
      }
      const rawStatus = responses.O.text;
      if (!responses.O.formula && !['', '○', '△', '✖'].includes(rawStatus)) issue('UNKNOWN_STATUS', row, 'O', id);
      const status = ['', '○', '△', '✖'].includes(rawStatus) ? rawStatus || '未回答' : '要確認';
      found.set(id, { id, level: official.level, sourceRow: row, sourceLevel: freeze(levelCell),
        original: freeze(responses), edited: { status, reason: responses.P.text, evidenceAndActions: responses.Q.text, supplement: responses.R.text }, missing: false });
    }
    const records = master.filter(row => row.level === '★3').map(row => {
      if (found.has(row.id)) return found.get(row.id);
      warnings.push({ code: 'MISSING_CRITERION', id: row.id });
      return { id: row.id, level: row.level, sourceRow: null, sourceLevel: null, original: null,
        edited: { status: '未回答', reason: '', evidenceAndActions: '', supplement: '' }, missing: true };
    });
    return { records, errors, warnings, star4Found: [...found.values()].filter(row => row.level === '★4').length,
      canCommit: errors.length === 0 && warnings.length === 0 };
  }
  function canCommit(result, { acknowledgeMissing = false } = {}) {
    return result.errors.length === 0 && (result.warnings.length === 0 || acknowledgeMissing);
  }
  function counts(records) {
    const result = { total: records.length, '○': 0, '△': 0, '✖': 0, '未回答': 0, '要確認': 0 };
    for (const record of records) result[record.edited.status]++;
    return result;
  }
  async function exportWorking(ExcelJS, records) {
    const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('作業用診断');
    const headers = ['評価基準No.', '取込行', 'O原文', 'P原文', 'Q原文', 'R原文', '編集判定', '編集理由', '証跡と実施内容', '補足'];
    sheet.addRow(headers);
    for (const record of records) {
      const raw = RESPONSE_COLUMNS.map(col => record.original?.[col]?.text ?? '');
      const values = [record.id, record.sourceRow ?? '', ...raw, record.edited.status, record.edited.reason, record.edited.evidenceAndActions, record.edited.supplement];
      const row = sheet.addRow(values.map(value => String(value)));
      row.eachCell(cell => { cell.numFmt = '@'; cell.alignment = { wrapText: true, vertical: 'top' }; });
    }
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((col, i) => { col.width = i < 2 ? 16 : 36; });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return new Uint8Array(await book.xlsx.writeBuffer());
  }
  return { LIMITS, PUBLIC_COLUMNS, RESPONSE_COLUMNS, EXPECTED_HEADERS, cellData, publicData, inspectZip, load, makeMaster, parse, canCommit, counts, exportWorking };
});
