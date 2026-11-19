import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
let child;

before(async () => {
  child = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE + "/"); return; } catch { await delay(50); }
  }
  throw new Error("server did not start");
});

after(() => { child?.kill(); });

async function triage(body) {
  const res = await fetch(BASE + "/api/triage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test("успех: обычный текст", async () => {
  const { status, data } = await triage({ text: "Не пришла доставка" });
  assert.equal(status, 200);
  assert.equal(data.status, "ready");
  assert.equal(data.topic, "delivery");
  assert.ok(data.draft.length > 0);
});

test("invalid: пустой ввод → 400", async () => {
  const { status, data } = await triage({ text: "   " });
  assert.equal(status, 400);
  assert.deepEqual(data, { status: "invalid_input" });
});

test("invalid: нестроковый ввод → 400", async () => {
  const { status, data } = await triage({ text: 42 });
  assert.equal(status, 400);
  assert.deepEqual(data, { status: "invalid_input" });
});

test("invalid: битый JSON → 400", async () => {
  const { status, data } = await triage("{ not json");
  assert.equal(status, 400);
  assert.deepEqual(data, { status: "invalid_input" });
});

test("manual_review: таймаут модели (300 мс)", async () => {
  const started = Date.now();
  const { status, data } = await triage({ text: "Заявка [timeout]" });
  const elapsed = Date.now() - started;
  assert.equal(status, 200);
  assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
  assert.ok(elapsed < 1000, `слишком долго: ${elapsed} мс`);
});

test("manual_review: ошибка модели", async () => {
  const { data } = await triage({ text: "[error]" });
  assert.deepEqual(data, { status: "manual_review", topic: null, draft: null });
});

test("manual_review: не-JSON от модели", async () => {
  const { data } = await triage({ text: "[bad-json]" });
  assert.equal(data.status, "manual_review");
});

test("manual_review: недопустимая тема", async () => {
  const { data } = await triage({ text: "[bad-topic]" });
  assert.equal(data.status, "manual_review");
});

test("manual_review: пустой черновик", async () => {
  const { data } = await triage({ text: "[empty-draft]" });
  assert.equal(data.status, "manual_review");
});