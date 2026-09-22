import { DomainError } from "../../../../shared/errors";
import type { FileInput } from "./files";
import { inspectOfficeZip } from "./inspectOfficeZip";
export function inspectEvidence(bytes: Uint8Array, input: FileInput) {
  if (input.name.toLowerCase().endsWith(".docx") || input.name.toLowerCase().endsWith(".xlsx")) {
    try {
      if (![80, 75, 3, 4].every((value, index) => bytes[index] === value)) throw new Error();
      inspectOfficeZip(bytes, input.name.toLowerCase().endsWith(".docx") ? "docx" : "xlsx");
      return;
    } catch {
      throw new DomainError("FILE_INVALID");
    }
  }
  if (input.mime === "text/plain") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
      if (
        text.includes("\0") ||
        /^\s*(?:<\?xml[^>]*>\s*)?(?:<!doctype\s+html|<html\b|<svg\b)/i.test(text)
      )
        throw new Error();
    } catch {
      throw new DomainError("FILE_INVALID");
    }
    return;
  }
  if (input.mime === "application/pdf") {
    const text = new TextDecoder("latin1").decode(bytes),
      names = text.replace(/#([\da-f]{2})/gi, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    if (
      /^%PDF-\d\.\d[\r\n]/.test(text) &&
      /%%EOF\s*$/.test(text) &&
      !/\/Encrypt(?:\s|[<>[\]()/]|$)/.test(names)
    )
      return;
  }
  if (input.mime === "image/png") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (
      bytes.length >= 45 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n) &&
      view.getUint32(8) === 13 &&
      view.getUint32(12) === 0x49484452 &&
      view.getUint32(16) > 0 &&
      view.getUint32(20) > 0 &&
      view.getUint32(bytes.length - 12) === 0 &&
      view.getUint32(bytes.length - 8) === 0x49454e44
    )
      return;
  }
  if (
    input.mime === "image/jpeg" &&
    bytes.length >= 20 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes.at(-2) === 255 &&
    bytes.at(-1) === 217
  )
    return;
  throw new DomainError("FILE_INVALID");
}
