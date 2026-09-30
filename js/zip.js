/* Minimal ZIP reader (stored and deflated entries), enough for a Letterboxd export. Inflating uses
   the browser's own DecompressionStream, so there's no library to ship. */
(function () {
  const SIG_EOCD = 0x06054b50;
  const SIG_CENTRAL = 0x02014b50;

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error("This browser can't open ZIP files. Unzip the export and drop the CSV files instead.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** ArrayBuffer -> [{ name, text }] for entries accepted by want(name). */
  async function readText(buffer, want = () => true) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    // The end-of-central-directory record sits in the last 22 bytes plus an optional comment.
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("That file isn't a ZIP archive.");

    const utf8 = new TextDecoder();
    const entries = [];
    let p = dv.getUint32(eocd + 16, true);
    for (let n = dv.getUint16(eocd + 10, true); n > 0 && dv.getUint32(p, true) === SIG_CENTRAL; n--) {
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const skip = nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + skip;
      if (name.endsWith('/') || !want(name)) continue;
      // The local header repeats the name and may carry a different extra field.
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      entries.push({ name, method, data: u8.subarray(start, start + size) });
    }

    return Promise.all(
      entries.map(async (e) => {
        if (e.method !== 0 && e.method !== 8) throw new Error(`Unsupported compression in ${e.name}.`);
        const bytes = e.method === 8 ? await inflate(e.data) : e.data;
        return { name: e.name, text: utf8.decode(bytes) };
      })
    );
  }

  DQ.zip = { readText };
})();
