import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import {
  createUploadSession,
  documentFileName,
  DriveError,
} from '@/server/drive';

/**
 * Step 1 of an upload: open a resumable session and hand the browser a URL to
 * PUT the file to. The bytes go straight from the browser to Google, so a
 * 50 MB file is never limited by this server's request size.
 */
export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  const body = await request.json().catch(() => ({}));
  const original = String(body?.name || 'file');
  const mimeType = String(body?.mimeType || 'application/octet-stream');
  const size = Number(body?.size) || 0;
  const index = Number(body?.index) || 0;

  const name = documentFileName(
    session.employeeId,
    session.name,
    original,
    index,
  );
  try {
    // Pass the caller's origin through so Google allows the browser's PUT.
    return NextResponse.json(
      await createUploadSession(
        name,
        mimeType,
        size,
        request.headers.get('origin') || undefined,
      ),
    );
  } catch (err) {
    const e = err as DriveError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
});
