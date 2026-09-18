import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export const PAGE = { width: 595.28, height: 841.89, left: 46, right: 46, top: 82, bottom: 57 };
const navy = rgb(0.10, 0.19, 0.30);
const blue = rgb(0.13, 0.36, 0.63);
const muted = rgb(0.37, 0.43, 0.49);
const textColor = rgb(0.16, 0.20, 0.25);
const light = rgb(0.94, 0.96, 0.98);
const statusText = { '○': '○（満たしている）', '△': '△（判断微妙）', '✖': '×（不足）', '': '未回答' };

export function freezeSnapshot(rows) {
  const data = structuredClone(rows);
  for (const row of data) Object.freeze(row);
  const counts = { '○': 0, '△': 0, '✖': 0, '': 0 };
  for (const row of data) {
    if (!(row.status in counts)) throw new Error('Unknown status');
    counts[row.status]++;
  }
  return Object.freeze({ id: 'SCS-DEMO-SNAPSHOT-001', date: '2026-09-18', customer: 'サンプル株式会社',
    scope: '対象会社：サンプル株式会社／拠点：本社／部署：全社／システム：社内業務システム',
    criteria: Object.freeze(data), counts: Object.freeze(counts) });
}

// Browser-safe: the only inputs are a frozen snapshot and locally supplied font bytes.
// No DOM, filesystem, network, storage, evidence file, or AI service is referenced.
export async function createReport(snapshot, fontBytes) {
  if (snapshot.criteria.length !== 81 || new Set(snapshot.criteria.map(r => r.id)).size !== 81) throw new Error('Expected 81 unique criteria');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // CFF subsetting produced extractable Unicode but unreadable Japanese glyphs in Poppler.
  // Full embedding is intentional until a separately verified TTF subset is introduced.
  // Noto's locl substitutes ASCII digits with glyphs absent from pdf-lib's Unicode map.
  const font = await doc.embedFont(fontBytes, { subset: false, features: { locl: false, liga: false } });
  const supported = new Set(font.getCharacterSet());
  const trace = [];
  const fields = [];
  const criterionPages = {};
  let page, y, activeId = '';
  const contentWidth = PAGE.width - PAGE.left - PAGE.right;

  function draw(text, x, baseline, size = 10, color = textColor, kind = 'body') {
    for (const ch of text) if (!supported.has(ch.codePointAt(0))) throw new Error(`Unsupported glyph U+${ch.codePointAt(0).toString(16)}: ${ch}`);
    const width = font.widthOfTextAtSize(text, size);
    if (width > contentWidth + 0.01 && kind !== 'footer') throw new Error(`Line overflow: ${width}`);
    page.drawText(text, { x, y: baseline, size, font, color });
    trace.push({ page: doc.getPageCount(), text, x, y: baseline, width, size, kind });
  }
  function newPage(continuation = false) {
    page = doc.addPage([PAGE.width, PAGE.height]);
    page.drawRectangle({ x: 0, y: PAGE.height - 53, width: PAGE.width, height: 53, color: navy });
    draw('SCS DIAGNOSIS / 技術検証用・匿名サンプル', PAGE.left, PAGE.height - 33, 10, rgb(1, 1, 1), 'header');
    y = PAGE.height - PAGE.top;
    if (continuation && activeId) {
      draw(`項目 ${activeId}（続き）`, PAGE.left, y, 10, blue, 'continuation');
      y -= 25;
    }
  }
  function ensure(height) { if (y - height < PAGE.bottom) newPage(true); }
  // Code-point width wrapping. Japanese prohibited line starts/ends are repaired by moving a glyph.
  function wrap(text, size) {
    const lines = [];
    const forbiddenStart = new Set('、。，．）］｝」』】〉》！？：；ー');
    const forbiddenEnd = new Set('（［｛「『【〈《');
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
      const chars = Array.from(paragraph);
      let line = '';
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (line && font.widthOfTextAtSize(line + ch, size) > contentWidth) {
          let tail = '';
          if (forbiddenStart.has(ch) || forbiddenEnd.has(Array.from(line).at(-1))) {
            const previous = Array.from(line); tail = previous.pop(); line = previous.join('');
          }
          if (line) lines.push(line);
          line = tail + ch;
        } else line += ch;
      }
      lines.push(line);
    }
    return lines;
  }
  function paragraph(text, { size = 10, color = textColor, gap = 9, field = null } = {}) {
    const lineHeight = size * 1.65;
    const first = trace.length;
    for (const line of wrap(text, size)) {
      ensure(lineHeight);
      if (line) draw(line, PAGE.left, y, size, color);
      y -= lineHeight;
    }
    y -= gap;
    if (field) fields.push({ field, text, traceStart: first, traceEnd: trace.length });
  }
  function heading(text) {
    ensure(53);
    page.drawRectangle({ x: PAGE.left - 8, y: y - 9, width: contentWidth + 16, height: 29, color: light });
    draw(text, PAGE.left, y, 12, navy);
    y -= 37;
  }

  newPage();
  y -= 32;
  paragraph('SCS ★3 診断レポート', { size: 25, color: navy, gap: 18 });
  paragraph(snapshot.customer, { size: 16, color: blue });
  paragraph(`診断基準：2026年3月27日公表版 / 作成日：${snapshot.date}`, { color: muted });
  paragraph(`スナップショット：${snapshot.id}`, { color: muted });
  paragraph(snapshot.scope);
  y -= 12;
  heading('経営層向けサマリー');
  paragraph('対象は★3の全81基準です。元の自己評価に基づく状況を示しています。達成率や星の取得可否を判定するものではありません。');
  const cards = [['○', '○'], ['△', '△'], ['✖', '×'], ['', '未回答']];
  for (let i = 0; i < cards.length; i++) {
    const x = PAGE.left + i * 127;
    page.drawRectangle({ x, y: y - 66, width: 117, height: 83, color: light });
    draw(cards[i][1], x + 12, y - 4, 11, muted);
    draw(String(snapshot.counts[cards[i][0]]), x + 12, y - 42, 24, navy);
  }
  y -= 102;
  const unreviewed = snapshot.criteria.filter(r => !r.evidenceConfirmed).length;
  const pending = snapshot.criteria.filter(r => !r.adviceConfirmed).length;
  paragraph(`未回答 ${snapshot.counts['']}件 / 証跡未確認 ${unreviewed}件 / 助言未確定 ${pending}件`, { size: 12, color: blue });
  paragraph('未回答・証跡未確認が残っていても出力できます。項目別明細に残件を明記し、確認済みの助言だけを掲載します。作業完了と基準充足の確認は別に行います。');
  paragraph('このPDFは技術検証用です。公開された要件と匿名の自己評価記号を使用し、助言・担当者・証跡確認は架空の例です。顧客の元回答や証跡ファイル本文は含みません。', { color: muted });

  newPage();
  heading('確認を要する項目');
  paragraph(`未回答の基準：${snapshot.criteria.filter(r => !r.status).map(r => r.id).join(' / ')}`, { field: 'unanswered-list' });
  paragraph(`証跡未確認の基準：${snapshot.criteria.filter(r => !r.evidenceConfirmed).map(r => r.id).join(' / ')}`, { field: 'unreviewed-list' });
  paragraph('優先する作業：未回答項目の事実確認、未対応項目の担当者・期限設定、証跡と運用実態の確認。優先順位は担当者が対象範囲と影響を確認して決定します。');
  paragraph('制度資料：IPA「SCS評価制度 要求事項・評価基準」2026年3月27日公表版。項目の公式文言は明細で確認できます。');
  paragraph('https://www.ipa.go.jp/security/scs/requirements-criteria.html', { size: 9, color: blue });

  newPage();
  for (const [index, row] of snapshot.criteria.entries()) {
    if (y - 110 < PAGE.bottom) newPage(false);
    activeId = row.id;
    criterionPages[row.id] = doc.getPageCount();
    heading(`${String(index + 1).padStart(2, '0')} / ${row.id} / ${row.title}`);
    paragraph(`${row.category} > ${row.section}`, { color: muted, size: 9 });
    paragraph(`判定：${statusText[row.status]} / 証跡：${row.evidenceConfirmed ? '確認済み（架空例）' : '未確認'}`, { color: blue, size: 11 });
    paragraph(`要求事項：${row.requirement}`, { field: `${row.id}:requirement` });
    paragraph(`評価基準：${row.criterion}`, { field: `${row.id}:criterion` });
    if (row.adviceConfirmed) paragraph(`確定助言（架空例）：${row.advice}`, { field: `${row.id}:advice` });
    else paragraph('助言：未確定のため掲載していません。担当者が内容を確認して確定してください。');
    paragraph('次の確認：対象範囲、責任者、期限、実施記録を照合し、判断根拠と確認日を記録する。', { color: muted, size: 9, gap: 19 });
  }
  for (const [index, p] of doc.getPages().entries()) {
    page = p;
    draw(`SCS-DEMO-SNAPSHOT-001 / ${index + 1} / ${doc.getPageCount()}`, PAGE.left, 29, 8, muted, 'footer');
  }
  doc.setTitle('SCS ★3 診断レポート - 匿名技術検証');
  doc.setAuthor('SCS diagnosis prototype');
  doc.setSubject('公開81基準・架空助言による日本語PDF検証');
  doc.setCreationDate(new Date('2026-09-18T00:00:00Z'));
  doc.setModificationDate(new Date('2026-09-18T00:00:00Z'));
  return { bytes: await doc.save(), trace, fields, pages: doc.getPageCount(), criterionPages };
}
