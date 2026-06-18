import { expect, test } from "bun:test";
import { startBunServer } from "../runtime/bun-server";

test("bun server serves the router and stops", async () => {
  const router = async (_req: Request) => new Response(JSON.stringify({ status: "ok" }), { headers: { "content-type": "application/json" } });
  const server = startBunServer({ router, port: 0 }); // port 0 = ephemeral
  try {
    const res = await fetch(`http://localhost:${server.port}/healthz`);
    expect((await res.json()).status).toBe("ok");
  } finally {
    server.stop();
  }
});
