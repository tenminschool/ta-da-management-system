import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { DriveError, finishUpload } from '@/server/drive';

/** Step 2: the browser reports the new file id; we share it and return the link. */
export const POST = withRoute(async (request) => {
  requireSession(request);
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json({
      file: await finishUpload(String(body?.fileId || '')),
    });
  } catch (err) {
    const e = err as DriveError;
    return NextResponse.json({ error: e.message }, { status: e.status || 502 });
  }
});
