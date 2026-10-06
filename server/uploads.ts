/**
 * Where claim documents are stored: the 10 Minute School file service
 * (`s3-manager`), which writes to the public CDN bucket.
 *
 * The browser sends each file straight to that service with the signed-in
 * person's own 10MS access token, so the bytes never pass through this server
 * and a serverless request-size cap does not apply. This server only decides
 * the file's name and key, and enforces the size limit.
 */

export const UPLOAD_ENDPOINT =
  process.env.UPLOAD_ENDPOINT || "https://api.10minuteschool.com/s3-manager/api/v1/files/services/upload";
export const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET || "10mscdn";
export const UPLOAD_ACL = process.env.UPLOAD_ACL || "public-read";

/** Largest single file. */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024;

export class UploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const clean = (v: string) => String(v || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Builds the stored file name: employee id, the person's last name, date — plus
 * an index when one submission carries several files, so they stay
 * distinguishable. "E881", "Md. Mahmud Siddik" → "E881-Siddik-2026-10-06.png".
 */
export function documentFileName(
  employeeId: string,
  employeeName: string,
  originalName: string,
  index = 0,
  when = new Date(),
): string {
  const dot = originalName.lastIndexOf(".");
  const ext = dot > 0 ? originalName.slice(dot).toLowerCase() : "";
  const date = when.toISOString().slice(0, 10);
  const suffix = index > 0 ? `-${index + 1}` : "";
  const lastName = clean(employeeName).split(" ").filter(Boolean).pop() || "";
  return [clean(employeeId), lastName, `${date}${suffix}`].filter(Boolean).join("-") + ext;
}

/** The folder a person's documents go in: hq/<employee id>/ta-da. */
export function uploadKey(employeeId: string): string {
  return `hq/${String(employeeId || "").replace(/[^A-Za-z0-9._-]+/g, "_")}/ta-da`;
}

/** Validates a requested upload and returns what the browser needs to send it. */
export function planUpload(employeeId: string, name: string, sizeBytes: number) {
  if (!sizeBytes) throw new UploadError("The file is empty.", 400);
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `That file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB — the limit is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
      413,
    );
  }
  return {
    endpoint: UPLOAD_ENDPOINT, bucket: UPLOAD_BUCKET, acl: UPLOAD_ACL, key: uploadKey(employeeId),
    name,
  };
}
