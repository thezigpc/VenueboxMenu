// SDK 0.10.0: the menu under a path prefix (https://venue/menu/). The proxy strips the
// prefix, so routes stay put; index.html carries it for the client.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp, type TestApp } from "./helpers.js";

function fakeDist(): string {
  const dist = mkdtempSync(path.join(os.tmpdir(), "menu-dist-"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"><script type="module" src="./assets/index-x.js"></script></head><body><div id="root"></div></body></html>');
  writeFileSync(path.join(dist, "assets", "index-x.js"), "console.log(1)");
  return dist;
}

const html = (t: TestApp, p: string) => t.get(p).then(async (r) => ({ status: r.status, type: r.headers.get("content-type") ?? "", body: await r.text() }));

describe("under a path prefix", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp({ clientDist: fakeDist(), basePath: "/menu" });
  });
  after(() => t.stop());

  test("every page gets the prefix injected", async () => {
    for (const p of ["/", "/tv", "/admin", "/tv?preview=1"]) {
      const r = await html(t, p);
      assert.equal(r.status, 200, p);
      assert.match(r.type, /html/);
      assert.match(r.body, /<meta name="bargames-base" content="\/menu"><base href="\/menu\/">/, p);
    }
  });

  test("assets, API and slides keep their unprefixed routes", async () => {
    assert.equal((await t.get("/assets/index-x.js")).status, 200);
    assert.equal((await t.get("/api/playlist")).status, 200);
    assert.equal((await t.get("/api/nope")).status, 404);
    assert.equal((await t.get("/slides/missing.jpg")).status, 404);
    // The playlist hands out root-relative slide paths; the client adds the prefix (bgUrl).
    const pl = (await (await t.get("/api/playlist")).json()) as { slides: unknown[] };
    assert.ok(Array.isArray(pl.slides));
  });
});

describe("at the root (no prefix)", () => {
  let t: TestApp;
  before(async () => {
    t = await startApp({ clientDist: fakeDist(), basePath: "" });
  });
  after(() => t.stop());

  test("index.html gets only <base href=\"/\">, so deep links like /tv/ load their assets", async () => {
    for (const p of ["/", "/tv", "/tv/", "/admin/"]) {
      const r = await html(t, p);
      assert.equal(r.status, 200, p);
      assert.doesNotMatch(r.body, /bargames-base/, p);
      assert.match(r.body, /<base href="\/">/, p);
    }
  });
});
