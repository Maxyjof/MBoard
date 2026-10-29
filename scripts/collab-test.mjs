// Collaboration protocol smoke test: two clients sync through WebSocket + Yjs
// usage: node scripts/collab-test.mjs <canvasId>
import WebSocket from "ws";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const canvasId = process.argv[2];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!canvasId) {
  console.error("missing canvasId");
  process.exit(1);
}

const loginResponse = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "admin", password: "admin123" }),
});
const cookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
if (!cookie) {
  console.error("login failed");
  process.exit(1);
}

function createClient(name) {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const socket = new WebSocket(
    `${base.replace("http", "ws")}/collab?canvasId=${canvasId}`,
    { headers: { Cookie: cookie } }
  );
  let synced = false;

  const send = (payload) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  };

  socket.on("message", (raw) => {
    const decoder = decoding.createDecoder(new Uint8Array(raw));
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);

    if (type === 0) {
      encoding.writeVarUint(encoder, 0);
      const messageType = syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");
      if (messageType === syncProtocol.messageYjsSyncStep2) synced = true;
      if (encoding.length(encoder) > 1) send(encoding.toUint8Array(encoder));
      return;
    }

    if (type === 1) {
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(decoder),
        "remote"
      );
    }
  });

  socket.on("open", () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(encoding.toUint8Array(encoder));

    awareness.setLocalState({ user: { id: name, name, color: "#6353f5" }, pointer: null, button: "up" });
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, 1);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID])
    );
    send(encoding.toUint8Array(awarenessEncoder));
  });

  doc.on("update", (update, origin) => {
    if (origin === "remote") return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    send(encoding.toUint8Array(encoder));
  });

  return {
    doc,
    awareness,
    close: () => socket.close(),
    waitSynced: async () => {
      for (let i = 0; i < 50 && !synced; i += 1) await sleep(100);
      if (!synced) throw new Error(`${name} sync timeout`);
    },
  };
}

const results = [];
const check = (label, passed, detail = "") => {
  results.push({ label, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
};

let a;
let b;
let testId;

try {
  a = createClient("collab-test-A");
  b = createClient("collab-test-B");
  await a.waitSynced();
  await b.waitSynced();
  check("both clients complete initial sync", true);

  const seedCount = a.doc.getMap("elements").size;
  check("server room has seeded elements", seedCount > 0, `elements=${seedCount}`);

  testId = `collab-test-${Date.now()}`;
  const element = {
    id: testId,
    type: "rectangle",
    x: 1234,
    y: 567,
    width: 100,
    height: 60,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "#ffec99",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
  };

  a.doc.transact(() => {
    a.doc.getMap("elements").set(testId, JSON.stringify(element));
    a.doc.getArray("order").push([testId]);
  });

  let received;
  for (let i = 0; i < 30; i += 1) {
    received = b.doc.getMap("elements").get(testId);
    if (received) break;
    await sleep(100);
  }
  check("remote client receives new element", Boolean(received));

  if (received) {
    b.doc.transact(() => {
      const current = JSON.parse(b.doc.getMap("elements").get(testId));
      b.doc.getMap("elements").set(
        testId,
        JSON.stringify({ ...current, x: 4321, version: 2, versionNonce: 2 })
      );
    });

    let updatedX = null;
    for (let i = 0; i < 30; i += 1) {
      const current = a.doc.getMap("elements").get(testId);
      if (current && JSON.parse(current).x === 4321) {
        updatedX = 4321;
        break;
      }
      await sleep(100);
    }
    check("remote modification flows back", updatedX === 4321);
  }

  await sleep(600);
  const remoteStates = [...b.awareness.getStates().values()];
  check(
    "awareness presence is shared",
    remoteStates.some((state) => state?.user?.name === "collab-test-A"),
    `states=${remoteStates.length}`
  );
} catch (error) {
  console.error("test error:", error);
  results.push({ label: "execution", passed: false });
  process.exitCode = 1;
} finally {
  if (a && b && testId) {
    a.doc.transact(() => {
      a.doc.getMap("elements").delete(testId);
      const order = a.doc.getArray("order");
      for (let i = order.length - 1; i >= 0; i -= 1) {
        if (order.get(i) === testId) order.delete(i, 1);
      }
    });
    await sleep(1200);
  }
  a?.close();
  b?.close();
}

const failed = results.filter((item) => !item.passed);
console.log(`\nresult: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
