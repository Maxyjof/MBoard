import http from "node:http";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { SignJWT } from "jose";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as sync from "y-protocols/sync";
import { attachCollabServer } from "../lib/collab/server.mjs";
import { prisma } from "../lib/collab/prisma.mjs";

// 画板协作集成测试：两个认证用户，各自编辑不同元素并验证撤销权限
process.env.AUTH_SECRET = randomUUID();
const server = http.createServer();
attachCollabServer(server);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const canvas = await prisma.canvas.create({ data: { title: "temporary collaboration test" } });
const clients = [];

async function waitFor(predicate, label = "condition") {
  const deadline = Date.now() + 10000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`等待超时: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function connect(actor) {
  const token = await new SignJWT({ name: actor })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(actor)
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/collab?canvasId=${canvas.id}`, {
    headers: { Cookie: `mb_session=${token}` },
  });

  const doc = new Y.Doc();
  const pending = new Map();
  let synced = false;
  const send = (encoder) => ws.send(encoding.toUint8Array(encoder));

  doc.on("update", (update, origin) => {
    if (origin === ws) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    sync.writeUpdate(encoder, update);
    send(encoder);
  });

  ws.on("message", (raw) => {
    const decoder = decoding.createDecoder(new Uint8Array(raw));
    const type = decoding.readVarUint(decoder);
    if (type === 0) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      const kind = sync.readSyncMessage(decoder, encoder, doc, ws);
      if (kind === 1) synced = true;
      if (encoding.length(encoder) > 1) send(encoder);
    } else if (type === 2) {
      const data = JSON.parse(decoding.readVarString(decoder));
      pending.get(data.requestId)?.(data);
      pending.delete(data.requestId);
    }
  });

  await new Promise((resolve) => ws.once("open", resolve));
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  sync.writeSyncStep1(encoder, doc);
  send(encoder);
  await waitFor(() => synced, "sync");

  const client = {
    ws,
    doc,
    command(action) {
      const requestId = randomUUID();
      return new Promise((resolve) => {
        pending.set(requestId, resolve);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 2);
        encoding.writeVarString(encoder, JSON.stringify({ requestId, action }));
        send(encoder);
      });
    },
  };
  clients.push(client);
  return client;
}

// 在客户端文档里写入一个元素，并维护顺序数组
function put(client, id, value) {
  client.doc.transact(() => {
    client.doc.getMap("elements").set(id, JSON.stringify({ id, type: "rectangle", value }));
    if (!client.doc.getArray("order").toArray().includes(id)) {
      client.doc.getArray("order").push([id]);
    }
  });
}

const valueOf = (doc, id) => JSON.parse(doc.getMap("elements").get(id) ?? "null")?.value;

try {
  const a = await connect("test-a");
  const b = await connect("test-b");

  put(a, "one", 1);
  await waitFor(() => b.doc.getMap("elements").has("one"), "A 的元素同步到 B");

  put(b, "two", 2);
  await waitFor(() => a.doc.getMap("elements").has("two"), "B 的元素同步到 A");

  // A 撤销自己的元素，不应影响 B 的元素
  assert.equal((await a.command("undo")).ok, true);
  await waitFor(() => !b.doc.getMap("elements").has("one"), "A 撤销后 B 看不到元素");
  assert.ok(b.doc.getMap("elements").has("two"));

  assert.equal((await a.command("redo")).ok, true);
  await waitFor(() => b.doc.getMap("elements").has("one"), "A 重做后 B 看到元素");

  // B 覆盖 A 的元素后，A 不能再撤销
  put(b, "one", 3);
  await waitFor(() => valueOf(a.doc, "one") === 3, "B 的修改同步到 A");
  assert.match((await a.command("undo")).error, /最新执行者/);

  // B 撤销自己的覆盖，A 仍不能撤销（最新执行者仍是 B）
  assert.equal((await b.command("undo")).ok, true);
  await waitFor(() => valueOf(a.doc, "one") === 1, "B 撤销后恢复原值");
  assert.match((await a.command("undo")).error, /最新执行者/);

  // A 再次修改后可以撤销自己的操作
  put(a, "one", 4);
  await waitFor(() => valueOf(b.doc, "one") === 4, "A 的修改同步到 B");
  assert.equal((await a.command("undo")).ok, true);

  const saved = await prisma.canvas.findUniqueOrThrow({ where: { id: canvas.id } });
  const elements = JSON.parse(saved.sceneJson).elements;
  assert.equal(elements.find((item) => item.id === "one").value, 1);
  assert.ok(elements.some((item) => item.id === "two"));

  console.log(
    "PASS: 两个认证用户、独立元素撤销、重做、最新执行者校验、场景落盘"
  );
} finally {
  for (const client of clients) {
    client.ws.terminate();
    client.doc.destroy();
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  await new Promise((resolve) => server.close(resolve));
  await prisma.canvasOperation.deleteMany({ where: { canvasId: canvas.id } });
  await prisma.workHead.deleteMany({ where: { id: { startsWith: `canvas:${canvas.id}:` } } });
  await prisma.canvas.delete({ where: { id: canvas.id } });
  await prisma.$disconnect();
}
