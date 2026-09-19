import { Inflate } from "fflate";
export const OFFICE_ZIP_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  expandedBytes: 50 * 1024 * 1024,
  entryBytes: 10 * 1024 * 1024,
  entries: 500,
};
function fail(code: string): never {
  throw new Error(code);
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
// Adapted from the import inspector; attachments also accept DOCX, without workbook row limits.
// Every entry is expanded. 512-byte compressed
// chunks bound the inflater's temporary output before the per-entry/global counters run.
export function inspectOfficeZip(
  bytes: Uint8Array,
  kind: "docx" | "xlsx",
  limits = OFFICE_ZIP_LIMITS,
) {
  if (bytes.byteLength > limits.fileBytes) fail("FILE_SIZE_LIMIT");
  if (bytes.length < 22) fail("INVALID_ZIP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (
      view.getUint32(p, true) === 0x06054b50 &&
      p + 22 + view.getUint16(p + 20, true) === bytes.length
    ) {
      end = p;
      break;
    }
  if (end < 0) fail("INVALID_ZIP");
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail("MULTIDISK_UNSUPPORTED");
  const count = view.getUint16(end + 10, true),
    start = view.getUint32(end + 16, true),
    directoryLength = view.getUint32(end + 12, true);
  if (count === 65535 || start === 0xffffffff || directoryLength === 0xffffffff)
    fail("ZIP64_UNSUPPORTED");
  if (view.getUint16(end + 8, true) !== count || start + directoryLength !== end)
    fail("INVALID_ZIP_DIRECTORY");
  if (count > limits.entries) fail("ZIP_ENTRY_LIMIT");
  const names = new Set<string>(),
    ranges: { start: number; end: number }[] = [];
  let pos = start,
    expandedBytes = 0;
  let mainContentType = false;
  function checkExtra(from: number, to: number) {
    while (from < to) {
      if (from + 4 > to) fail("INVALID_ZIP");
      const tag = view.getUint16(from, true),
        length = view.getUint16(from + 2, true);
      if (tag === 1) fail("ZIP64_UNSUPPORTED");
      // JSZip can substitute this field for the header name. Reject it in both
      // directories rather than inspect a different name from the one ExcelJS uses.
      if (tag === 0x7075) fail("ZIP_FILENAME_METADATA_UNSUPPORTED");
      from += 4 + length;
    }
    if (from !== to) fail("INVALID_ZIP");
  }
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) fail("INVALID_ZIP_DIRECTORY");
    const flags = view.getUint16(pos + 8, true),
      method = view.getUint16(pos + 10, true),
      expectedCrc = view.getUint32(pos + 16, true),
      compressed = view.getUint32(pos + 20, true),
      size = view.getUint32(pos + 24, true),
      nameLength = view.getUint16(pos + 28, true),
      extraLength = view.getUint16(pos + 30, true),
      commentLength = view.getUint16(pos + 32, true),
      local = view.getUint32(pos + 42, true),
      next = pos + 46 + nameLength + extraLength + commentLength;
    if (next > end || local + 30 > start) fail("INVALID_ZIP_DIRECTORY");
    if (flags & 0x2041) fail("ENCRYPTED_UNSUPPORTED");
    if (![0, 8].includes(method)) fail("COMPRESSION_UNSUPPORTED");
    if ([compressed, size, local].includes(0xffffffff) || view.getUint16(pos + 34, true))
      fail("ZIP64_UNSUPPORTED");
    if (size > limits.entryBytes) fail("ZIP_ENTRY_SIZE_LIMIT");
    checkExtra(pos + 46 + nameLength, pos + 46 + nameLength + extraLength);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    if (names.has(name)) fail("ZIP_DUPLICATE_PATH");
    const pathParts = (name.endsWith("/") ? name.slice(0, -1) : name).split("/");
    if (
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      pathParts.some((part) => part === "" || part === ".")
    )
      fail("ZIP_PATH_UNSUPPORTED");
    if (/vbaProject|externalLinks|(^|\/)embeddings\//i.test(name)) fail("UNSUPPORTED_PACKAGE");
    names.add(name);
    if (
      view.getUint32(local, true) !== 0x04034b50 ||
      view.getUint16(local + 6, true) !== flags ||
      view.getUint16(local + 8, true) !== method
    )
      fail("INVALID_ZIP_HEADER");
    const localNameLength = view.getUint16(local + 26, true),
      localExtra = view.getUint16(local + 28, true),
      dataStart = local + 30 + localNameLength + localExtra,
      dataEnd = dataStart + compressed;
    if (
      dataEnd > start ||
      dataStart > start ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name
    )
      fail("INVALID_ZIP_HEADER");
    checkExtra(local + 30 + localNameLength, dataStart);
    if (
      !(flags & 8) &&
      (view.getUint32(local + 14, true) !== expectedCrc ||
        view.getUint32(local + 18, true) !== compressed ||
        view.getUint32(local + 22, true) !== size)
    )
      fail("INVALID_ZIP_HEADER");
    let rangeEnd = dataEnd;
    if (flags & 8) {
      let d = dataEnd;
      if (d + 4 > start) fail("INVALID_ZIP_HEADER");
      if (view.getUint32(d, true) === 0x08074b50) d += 4;
      if (
        d + 12 > start ||
        view.getUint32(d, true) !== expectedCrc ||
        view.getUint32(d + 4, true) !== compressed ||
        view.getUint32(d + 8, true) !== size
      )
        fail("INVALID_ZIP_HEADER");
      rangeEnd = d + 12;
    }
    if (ranges.some((r) => local < r.end && rangeEnd > r.start)) fail("ZIP_OVERLAP");
    ranges.push({ start: local, end: rangeEnd });
    let actual = 0,
      crc = 0xffffffff,
      xml = "";
    const inspectXml = /\.(xml|rels)$/i.test(name);
    const xmlChunks: Uint8Array[] = [];
    function receive(chunk: Uint8Array, _final: boolean) {
      actual += chunk.length;
      expandedBytes += chunk.length;
      if (actual > limits.entryBytes) fail("ZIP_ENTRY_SIZE_LIMIT");
      if (expandedBytes > limits.expandedBytes) fail("ZIP_EXPANDED_SIZE_LIMIT");
      for (const b of chunk) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
      if (inspectXml) xmlChunks.push(chunk.slice());
    }
    if (method === 0) {
      for (let offset = dataStart; offset < dataEnd; offset += 512)
        receive(bytes.subarray(offset, Math.min(offset + 512, dataEnd)), offset + 512 >= dataEnd);
    } else {
      const inflate = new Inflate(receive);
      try {
        if (!compressed) fail("INVALID_DEFLATE");
        for (let offset = dataStart; offset < dataEnd; offset += 512)
          inflate.push(
            bytes.subarray(offset, Math.min(offset + 512, dataEnd)),
            offset + 512 >= dataEnd,
          );
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("ZIP_")) throw error;
        fail("INVALID_DEFLATE");
      }
    }
    if (actual !== size) fail("ZIP_SIZE_MISMATCH");
    if ((crc ^ 0xffffffff) >>> 0 !== expectedCrc) fail("ZIP_CRC_MISMATCH");
    if (inspectXml) {
      const xmlBytes = new Uint8Array(actual);
      let offset = 0;
      for (const chunk of xmlChunks) {
        xmlBytes.set(chunk, offset);
        offset += chunk.length;
      }
      const encoding =
        xmlBytes[0] === 255 && xmlBytes[1] === 254
          ? "utf-16le"
          : xmlBytes[0] === 254 && xmlBytes[1] === 255
            ? "utf-16be"
            : xmlBytes[0] === 60 && xmlBytes[1] === 0
              ? "utf-16le"
              : xmlBytes[0] === 0 && xmlBytes[1] === 60
                ? "utf-16be"
                : "utf-8";
      xml = new TextDecoder(encoding, { fatal: true, ignoreBOM: false }).decode(xmlBytes);
      if (xml.includes("\0") || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(xml))
        fail("INVALID_XML");
    }
    const decodedXml = xml.replace(/&#(x[\da-f]+|\d+);/gi, (_match: string, value: string) => {
      const code =
        value[0].toLowerCase() === "x" ? Number.parseInt(value.slice(1), 16) : Number(value);
      if (code > 0x10ffff) fail("INVALID_XML");
      return String.fromCodePoint(code);
    });
    if (
      (name.endsWith(".rels") && /TargetMode\s*=\s*["']\s*External\s*["']/i.test(decodedXml)) ||
      /<!DOCTYPE|<!ENTITY/i.test(decodedXml)
    )
      fail("EXTERNAL_REFERENCE");
    if (name === "[Content_Types].xml" && /macroEnabled|vbaProject/i.test(decodedXml))
      fail("UNSUPPORTED_PACKAGE");
    if (name === "[Content_Types].xml") {
      const expected =
        kind === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
      mainContentType = decodedXml.includes(expected);
    }
    pos = next;
  }
  if (
    pos !== end ||
    !mainContentType ||
    !names.has("[Content_Types].xml") ||
    !names.has(kind === "xlsx" ? "xl/workbook.xml" : "word/document.xml")
  )
    fail("NOT_OFFICE_DOCUMENT");
  return { entries: count, expandedBytes, fileBytes: bytes.length };
}
