import * as XLSX from "xlsx";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5MB — plenty for a few thousand catalog rows
export type ImportFileFormat = "csv" | "xlsx";
export type RawImportRow = Record<string, string>;

export class InvalidImportFileError extends Error {}

/**
 * Lightweight content check, not a full MIME sniff (lib/storage/mime.ts is
 * for public applicant uploads and doesn't apply here): this endpoint is
 * admin-only (owner/ai_operator authenticated), a much lower risk profile.
 * .xlsx is a ZIP container (PK magic bytes); .csv has no reliable magic
 * bytes, so it's accepted by extension and validated by whether it parses.
 */
export function detectImportFormat(filename: string, buffer: Buffer): ImportFileFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (!isZip) throw new InvalidImportFileError("File does not look like a valid .xlsx workbook.");
    return "xlsx";
  }
  if (lower.endsWith(".csv")) return "csv";
  throw new InvalidImportFileError("Only .csv and .xlsx files are accepted.");
}

/** Parses either format into an array of header→string-value row objects. Throws InvalidImportFileError if unparseable. */
export function parseCatalogFile(buffer: Buffer, filename: string): { rows: RawImportRow[]; format: ImportFileFormat } {
  const format = detectImportFormat(filename, buffer);
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new InvalidImportFileError("Could not parse file. Confirm it is a valid CSV or XLSX export.");
  }
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) return { rows: [], format };
  const rows = XLSX.utils.sheet_to_json<RawImportRow>(sheet, { defval: "", raw: false });
  return { rows, format };
}
