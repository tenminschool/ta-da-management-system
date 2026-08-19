import { NextResponse } from 'next/server';
import { withRoute, requireSession } from '@/server/http';
import { hasRole } from '@/server/auth';
import { readTab, appendRow } from '@/server/sheets';
import {
  fromInsideCityBlockEntry,
  invalidateInsideCityBlock,
  nowISO,
  toInsideCityBlockEntry,
} from '@/server/store';
import { BLOCK_EMAIL_RE } from '@/server/admin';
import type { InsideCityBlockEntry } from '@/shared/types';

export const GET = withRoute(async (request) => {
  const session = requireSession(request);
  if (!hasRole(session, 'admin', 'hr')) {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403 },
    );
  }
  const rows = (await readTab('InsideCityBlock')).map(toInsideCityBlockEntry);
  const entries = rows
    .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
    .map(({ _row, ...e }) => e);
  return NextResponse.json({ entries });
});

export const POST = withRoute(async (request) => {
  const session = requireSession(request);
  if (!hasRole(session, 'admin', 'hr')) {
    return NextResponse.json(
      { error: 'Admin access required.' },
      { status: 403 },
    );
  }
  const body = await request.json().catch(() => ({}));
  const email = String(body?.email || '')
    .trim()
    .toLowerCase();
  const note = String(body?.note || '').trim();
  if (!BLOCK_EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'Enter a valid email address.' },
      { status: 400 },
    );
  }
  const rows = (await readTab('InsideCityBlock')).map(toInsideCityBlockEntry);
  if (rows.some((r) => r.email.toLowerCase() === email)) {
    return NextResponse.json(
      { error: 'That email is already restricted.' },
      { status: 400 },
    );
  }
  const entry: InsideCityBlockEntry = {
    email,
    note,
    addedBy: `${session.name} <${session.email}>`,
    addedAt: nowISO(),
  };
  await appendRow('InsideCityBlock', fromInsideCityBlockEntry(entry));
  invalidateInsideCityBlock();
  return NextResponse.json({ entry });
});
