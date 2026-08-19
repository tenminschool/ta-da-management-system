import { NextResponse } from 'next/server';
import { verifyToken, type Session } from './auth';

/** Thrown to short-circuit a route handler with a specific status + message. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Mirrors the old `requireAuth` Express middleware — throws instead of calling `next()`. */
export function requireSession(request: Request): Session {
  const header = request.headers.get('authorization');
  const session = verifyToken(
    header?.startsWith('Bearer ') ? header.slice(7) : undefined,
  );
  if (!session) throw new HttpError(401, 'Please sign in again.');
  return session;
}

/** Wraps a route handler so a thrown error becomes a JSON error response instead of a 500 HTML page. */
export function withRoute<Args extends unknown[]>(
  fn: (request: Request, ...args: Args) => Promise<Response>,
) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      return await fn(request, ...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status },
        );
      }
      console.error(
        `[${request.method} ${new URL(request.url).pathname}]`,
        err,
      );
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Something went wrong.' },
        { status: 500 },
      );
    }
  };
}

export type RouteParams<Keys extends string> = {
  params: Promise<Record<Keys, string>>;
};
