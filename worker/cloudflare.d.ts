// The two Cloudflare runtime modules the Worker entry imports, typed minimally so the rest of the
// project can keep the DOM types (Cloudflare's full types clash with them).
declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): ExportedHandler;
}
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
interface ExportedHandler {
  fetch?(request: Request, env: unknown, ctx: unknown): Response | Promise<Response>;
}
