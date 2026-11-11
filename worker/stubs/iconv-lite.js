// Express pulls in body-parser, which loads iconv-lite, whose stream code does not start on Workers.
// The app reads its own JSON bodies (see server/app.ts), so body-parser is never used and this
// stand-in only has to exist.
const unsupported = () => { throw new Error("iconv-lite is not available on Workers."); };
module.exports = {
  encodingExists: () => false,
  decode: (buf) => (typeof buf === "string" ? buf : Buffer.from(buf).toString("utf8")),
  encode: (str) => Buffer.from(String(str), "utf8"),
  getDecoder: unsupported,
  getEncoder: unsupported,
  decodeStream: unsupported,
  encodeStream: unsupported,
};
