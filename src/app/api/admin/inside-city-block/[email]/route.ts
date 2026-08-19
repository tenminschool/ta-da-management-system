import { NextResponse } from 'next/server';
import { withRoute, requireSession, type RouteParams } from '@/server/http';
import { hasRole } from '@/server/auth';
import { clearRow, readTab, updateRow, type Row } from '@/server/sheets';
import {
  fromInsideCityBlockEntry,
  invalidateInsideCityBlock,
  toInsideCityBlockEntry,
} from '@/server/store';
import { BLOCK_EMAIL_RE } from '@/server/admin';
import type { InsideCityBlockEntry } from '@/shared/types';

/** Corrects an entry's email or note in place — same row, so "added by/at" stays put. */
export const PUT = withRoute(
  async (request: Request, { params }: RouteParams<'email'>) => {
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
    const rows = await readTab('InsideCityBlock');
    const { email: rawTarget } = await params;
    const target = rawTarget.trim().toLowerCase();
    const row = rows.find(
      (r) =>
        String(r.email || '')
          .trim()
          .toLowerCase() === target,
    );
    if (!row) {
      return NextResponse.json(
        { error: 'No such restriction.' },
        { status: 404 },
      );
    }
    const { _row, ...current } = toInsideCityBlockEntry(
      row as Row & { _row: string },
    );
    if (
      email !== target &&
      rows.some(
        (r) =>
          String(r.email || '')
            .trim()
            .toLowerCase() === email,
      )
    ) {
      return NextResponse.json(
        { error: 'That email is already restricted.' },
        { status: 400 },
      );
    }
    const updated: InsideCityBlockEntry = { ...current, email, note };
    await updateRow('InsideCityBlock', _row, fromInsideCityBlockEntry(updated));
    invalidateInsideCityBlock();
    return NextResponse.json({ entry: updated });
  },
);

export const DELETE = withRoute(
  async (request: Request, { params }: RouteParams<'email'>) => {
    const session = requireSession(request);
    if (!hasRole(session, 'admin', 'hr')) {
      return NextResponse.json(
        { error: 'Admin access required.' },
        { status: 403 },
      );
    }
    const { email: rawTarget } = await params;
    const target = rawTarget.trim().toLowerCase();
    const rows = await readTab('InsideCityBlock');
    const row = rows.find(
      (r) =>
        String(r.email || '')
          .trim()
          .toLowerCase() === target,
    );
    if (!row) {
      return NextResponse.json(
        { error: 'No such restriction.' },
        { status: 404 },
      );
    }
    await clearRow('InsideCityBlock', row._row);
    invalidateInsideCityBlock();
    return NextResponse.json({ ok: true });
  },
);
