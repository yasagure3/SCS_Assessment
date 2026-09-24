import { PDFDocument, rgb, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReportSnapshot } from "../../shared/contracts/reports";
import { reportPdfSections, wrapReportText } from "./reportPdfContent";

const pageSize = { width: 595.28, height: 841.89, left: 46, top: 82, bottom: 57 };
const navy = rgb(0.1, 0.19, 0.3),
  blue = rgb(0.13, 0.36, 0.63),
  muted = rgb(0.37, 0.43, 0.49);
const contentWidth = pageSize.width - 2 * pageSize.left;

// Pure conversion: the caller supplies the fixed snapshot, verified font bytes and progress sink.
export async function createReportPdf(
  snapshot: ReportSnapshot,
  fontBytes: Uint8Array,
  progress: (percent: number) => void,
) {
  const sections = reportPdfSections(snapshot);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  // Required by the Japanese CFF visual PoC: subsetting corrupts visible glyphs,
  // and locl/ligatures can select glyphs without a matching ToUnicode mapping.
  const font = await document.embedFont(fontBytes, {
    subset: false,
    features: { locl: false, liga: false },
  });
  const supported = new Set(font.getCharacterSet());
  function assertGlyphs(text: string) {
    for (const character of text) {
      const code = character.codePointAt(0)!;
      if (!supported.has(code))
        throw new Error(`PDF_GLYPH_MISSING:U+${code.toString(16).toUpperCase()}`);
    }
  }
  // Fail before drawing any output if one printable character cannot be represented.
  for (const section of sections)
    for (const text of [section.title, ...section.paragraphs])
      assertGlyphs(text.replace(/[\r\n\t]/g, ""));
  progress(15);
  let page: PDFPage,
    y = 0,
    title = "";
  function draw(text: string, baseline: number, size = 10, color = navy) {
    assertGlyphs(text);
    if (font.widthOfTextAtSize(text, size) > contentWidth + 0.1)
      throw new Error("PDF_LAYOUT_FAILED");
    page.drawText(text, { x: pageSize.left, y: baseline, size, font, color });
  }
  function newPage(continued: boolean) {
    page = document.addPage([pageSize.width, pageSize.height]);
    page.drawRectangle({
      x: 0,
      y: pageSize.height - 53,
      width: pageSize.width,
      height: 53,
      color: navy,
    });
    draw("SCS DIAGNOSIS / 診断報告", pageSize.height - 33, 10, rgb(1, 1, 1));
    y = pageSize.height - pageSize.top;
    if (continued) {
      draw(`${title}（続き）`, y, 11, blue);
      y -= 28;
    }
  }
  function paragraph(text: string, size = 10, color = navy) {
    const normalized = text.replaceAll("\t", "    ");
    for (const line of wrapReportText(
      normalized,
      (s) => font.widthOfTextAtSize(s, size),
      contentWidth,
    )) {
      if (y - size * 1.65 < pageSize.bottom) newPage(true);
      if (line) draw(line, y, size, color);
      y -= size * 1.65;
    }
    y -= 8;
  }
  for (const [index, section] of sections.entries()) {
    title = section.title;
    newPage(false);
    paragraph(title, index === 0 ? 25 : 16, blue);
    y -= 8;
    for (const text of section.paragraphs) paragraph(text);
    progress(15 + Math.floor(((index + 1) / sections.length) * 70));
  }
  const pages = document.getPageCount();
  for (const [index, item] of document.getPages().entries()) {
    page = item;
    draw(`${snapshot.reportId} / ${index + 1} / ${pages}`, 29, 8, muted);
  }
  document.setTitle(`SCS ★3 診断レポート - ${snapshot.customer.name}`);
  document.setAuthor("SCS Assessment");
  document.setSubject(`固定報告版 ${snapshot.reportId}`);
  document.setCreationDate(new Date(snapshot.createdAt));
  document.setModificationDate(new Date(snapshot.createdAt));
  progress(90);
  const bytes = await document.save();
  progress(100);
  return { bytes, pages };
}
