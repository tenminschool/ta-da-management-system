import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { DRIVE_FOLDER_ID, MAX_UPLOAD_BYTES } from '@/server/drive';

/** Whether this deployment can accept file uploads at all. */
export const GET = withRoute(async (request) => {
  requireSession(request);
  return NextResponse.json({
    enabled: !!DRIVE_FOLDER_ID,
    maxBytes: MAX_UPLOAD_BYTES,
  });
});
