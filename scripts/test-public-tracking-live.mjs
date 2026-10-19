import assert from "node:assert/strict";

const endpoint = "https://lgcvaxjsgymwueacqkec.supabase.co/functions/v1/public-tracking";

const legacy = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: `O${"1".repeat(12)}` }),
});
assert.equal(legacy.status, 400, "Old order-number format must not authorize tracking");

const oversizedBody = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(3000));
    controller.close();
  },
});
const oversized = await fetch(endpoint, {
  method: "POST",
  duplex: "half",
  headers: { "content-type": "application/json" },
  body: oversizedBody,
});
assert.equal(oversized.status, 413, "Body without Content-Length must still be bounded");

console.log("Live tracking checks passed: old codes rejected; oversized streamed body rejected.");
