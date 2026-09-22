export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export type FileMetadata = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  status: "uploading" | "ready" | "rejected";
  createdAt: string;
};
export type FileUploaded = Pick<FileMetadata, "status" | "sizeBytes" | "sha256"> & {
  fileId: string;
};
