// wrangler.jsonc bundles *.xlsx files as binary modules.
declare module "*.xlsx" {
  const bytes: ArrayBuffer;
  export default bytes;
}
