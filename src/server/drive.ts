/**
 * Uploading claim documents to Google Drive.
 *
 * Files go to a **Shared Drive**, which is what makes this work at all: a
 * service account has no storage quota of its own and cannot own a file, but
 * in a Shared Drive the storage belongs to the organisation. (A folder in a
 * personal My Drive fails with "Service Accounts do not have storage quota"
 * however it is shared.)
 *
 * The browser uploads straight to Google rather than through this server. A
 * serverless request body is capped at a few megabytes, so a 50 MB receipt
 * could never be relayed; instead the server opens a *resumable session* —
 * a one-shot, pre-authorised URL — and the browser PUTs the bytes to that.
 */

import { google } from 'googleapis';

export const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '';

/** Largest single file. The bytes never touch this server, so this is generous. */
export const MAX_UPLOAD_BYTES =
  Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024;

/**
 * Whether each uploaded file is made readable by anyone with the link.
 *
 * Approvers are not members of the Shared Drive, so without this they get
 * "Request access" when they click a document on a claim. Set
 * DRIVE_PUBLIC_FILES=false if the Drive is shared with everyone another way.
 */
const PUBLIC_FILES =
  String(process.env.DRIVE_PUBLIC_FILES || 'true').toLowerCase() !== 'false';

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

let jwt: InstanceType<typeof google.auth.JWT> | null = null;

function auth() {
  if (jwt) return jwt;
  jwt = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive'],
    // Only set when domain-wide delegation is in use; a Shared Drive does not
    // need it.
    subject: process.env.GOOGLE_IMPERSONATE_SUBJECT || undefined,
  });
  return jwt;
}

const drive = () => google.drive({ version: 'v3', auth: auth() });

/**
 * Builds the stored file name: employee id, person, date — plus an index when
 * one submission carries several files, so they stay distinguishable.
 */
export function documentFileName(
  employeeId: string,
  employeeName: string,
  originalName: string,
  index = 0,
  when = new Date(),
): string {
  const clean = (v: string) =>
    String(v || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const dot = originalName.lastIndexOf('.');
  const ext = dot > 0 ? originalName.slice(dot).toLowerCase() : '';
  const date = when.toISOString().slice(0, 10);
  const suffix = index > 0 ? `-${index + 1}` : '';
  return `${clean(employeeId)}-${clean(employeeName)}-${date}${suffix}${ext}`;
}

/**
 * Opens a resumable upload session and returns the URL the browser should PUT
 * the file to. The URL carries its own authorisation and expires, so handing
 * it to the browser exposes nothing about the service account.
 */
export async function createUploadSession(
  name: string,
  mimeType: string,
  sizeBytes: number,
  origin?: string,
): Promise<{ uploadUrl: string; name: string }> {
  if (!DRIVE_FOLDER_ID) {
    throw new DriveError(
      'File uploads are not configured — set DRIVE_FOLDER_ID.',
      503,
    );
  }
  if (!sizeBytes) throw new DriveError('The file is empty.', 400);
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new DriveError(
      `That file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB — the limit is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`,
      413,
    );
  }

  const token = await auth().getAccessToken();
  const accessToken = typeof token === 'string' ? token : token?.token;
  if (!accessToken)
    throw new DriveError('Could not authenticate against Drive.', 502);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files' +
      '?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,size',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType || 'application/octet-stream',
        'X-Upload-Content-Length': String(sizeBytes),
        // Google binds CORS to the origin given when the session is created.
        // Without this the preflight passes but the actual PUT comes back with
        // no Access-Control-Allow-Origin, so the browser blocks it and the
        // upload looks like a dropped connection.
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify({ name, parents: [DRIVE_FOLDER_ID] }),
    },
  );

  const uploadUrl = res.headers.get('location');
  if (!res.ok || !uploadUrl) {
    const detail = await res.text().catch(() => '');
    if (/storage quota/i.test(detail)) {
      throw new DriveError(
        'Drive rejected the upload: the target is not a Shared Drive, and a service account has no storage of its own.',
        503,
      );
    }
    throw new DriveError(
      `Drive would not start the upload (${res.status}). ${detail.slice(0, 200)}`,
      502,
    );
  }
  return { uploadUrl, name };
}

/**
 * Called once the browser has finished putting the bytes. Grants link-readable
 * access so approvers — who are not members of the Shared Drive — can open the
 * document from the claim, and returns the link to store on the request.
 */
export async function finishUpload(
  fileId: string,
): Promise<{ id: string; name: string; link: string; sizeBytes: number }> {
  if (!fileId) throw new DriveError('No file id was supplied.', 400);

  if (PUBLIC_FILES) {
    try {
      await drive().permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
        supportsAllDrives: true,
      });
    } catch (err) {
      // Not fatal: the file is uploaded either way, and the Drive may already
      // be shared with everyone who needs it.
      console.warn(
        `[uploads] could not make ${fileId} link-readable:`,
        (err as Error).message,
      );
    }
  }

  try {
    const res = await drive().files.get({
      fileId,
      fields: 'id,name,webViewLink,size',
      supportsAllDrives: true,
    });
    return {
      id: res.data.id!,
      name: res.data.name || '',
      link:
        res.data.webViewLink ||
        `https://drive.google.com/file/d/${fileId}/view`,
      sizeBytes: Number(res.data.size) || 0,
    };
  } catch (err) {
    throw new DriveError(
      `Uploaded, but Drive would not describe the file: ${(err as Error).message}`,
      502,
    );
  }
}
