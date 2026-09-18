import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createReport, freezeSnapshot, PAGE } from './output/report.browser.mjs';

const source = JSON.parse(await fs.readFile('fixture.json', 'utf8'));
const rows = source.map((r, i) => ({ ...r, status: r.status === '未回答' ? '' : r.status, evidenceConfirmed: i % 4 === 0, adviceConfirmed: i % 7 !== 0,
  advice: `「${r.title}」について、対象範囲に含む部署とシステムを一覧に整理する。責任者が現状と要求事項を照合し、不足する運用手順を文書化する。実施担当者と期限を定め、運用記録と確認日を残す。確認者は記録を読み、対象範囲全体で継続運用されているか確認する。`,
  draftAdvice: 'UNCONFIRMED_DRAFT_MUST_NOT_APPEAR' }));
rows[0].adviceConfirmed = true;
rows[0].advice = Array.from({ length: 36 }, (_, n) => `長文検証${String(n + 1).padStart(3, '0')}：役割と責任を整理するため、各部署から現状の運用方法と担当者の一覧を収集する。責任者は対象範囲に不足がないことを確認し、連絡網と権限表を更新する。担当部署は定期点検の日程を設定し、点検の実施記録と是正内容を保存する。確認者は変更前後を比較し、未対応の事項と次回の期限を明記する。完了後も継続して記録を確認し、実際の運用に合わせて手順を見直す。`).join('\n');
const snapshot = freezeSnapshot(rows);
assert.deepEqual(snapshot.counts, { '○': 24, '△': 24, '✖': 28, '': 5 });
rows[0].status = '✖'; rows[0].criterion = 'changed after snapshot'; rows[0].advice = 'changed';
assert.equal(snapshot.criteria[0].status, '○');
assert.notEqual(snapshot.criteria[0].criterion, 'changed after snapshot');
assert.throws(() => { snapshot.criteria[0].status = ''; }, TypeError);
const started = performance.now();
const fontBytes = await fs.readFile('fonts/NotoSansCJKjp-Regular.otf');
const report = await createReport(snapshot, fontBytes);
const elapsedMs = Math.round(performance.now() - started);
assert.equal(Object.keys(report.criterionPages).length, 81);
for (const line of report.trace.filter(l => l.kind === 'body')) {
  assert.ok(line.y >= PAGE.bottom && line.y + line.size <= PAGE.height - 60);
  assert.ok(line.x >= PAGE.left && line.x + line.width <= PAGE.width - PAGE.right + 0.01);
}
const longAdvice = report.fields.find(f => f.field === `${source[0].id}:advice`);
const longTrace = report.trace.slice(longAdvice.traceStart, longAdvice.traceEnd).filter(t => t.kind === 'body');
const longPages = [...new Set(longTrace.map(t => t.page))];
assert.ok(longPages.length >= 3);
assert.ok(!report.trace.some(t => t.text.includes('UNCONFIRMED_DRAFT')));
assert.equal(report.fields.filter(f => f.field.endsWith(':criterion')).length, 81);
await fs.mkdir('output', { recursive: true });
await fs.writeFile('output/scs-star3-anonymous.pdf', report.bytes);
await fs.writeFile('output/snapshot.json', JSON.stringify(snapshot, null, 2));
await fs.writeFile('output/layout.json', JSON.stringify({ ...report, bytes: undefined }, null, 2));
const result = { passed: true, pages: report.pages, bytes: report.bytes.length, elapsedMs, fontBytes: fontBytes.length, longAdviceCharacters: snapshot.criteria[0].advice.length, longAdvicePages: longPages, counts: snapshot.counts, criteria: 81, boundsAssertions: report.trace.filter(l => l.kind === 'body').length, generatedWithBrowserBundle: true };
await fs.writeFile('output/generation-result.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
