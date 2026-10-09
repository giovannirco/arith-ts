// The real process: node src/main.ts over a socket. It serves, it stops on
// SIGTERM within the grace period, and it refuses bad settings.

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, connect, type AddressInfo } from "node:net";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAIN = "src/main.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  server.close();
  return port;
}

async function start(env: Record<string, string> = {}): Promise<{ child: ChildProcess; port: number; output: () => string }> {
  const port = await freePort();
  let output = "";
  const child = spawn(process.execPath, [MAIN], {
    cwd: ROOT,
    env: { ...process.env, ARITH_ADDR: `127.0.0.1:${port}`, ...env },
  });
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return { child, port, output: () => output };
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGKILL");
  throw new Error(`did not start:\n${output}`);
}

// Seconds from SIGTERM to exit, and the exit code.
async function stop(child: ChildProcess): Promise<[number, number | null]> {
  const started = performance.now();
  child.kill("SIGTERM");
  const [code] = (await once(child, "exit")) as [number | null];
  return [(performance.now() - started) / 1000, code];
}

test("serves, then stops when asked", async () => {
  const { child, port, output } = await start();
  const response = await fetch(`http://127.0.0.1:${port}/api/sum?term_one=4&term_two=1`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"result":5}');

  const [seconds, code] = await stop(child);
  assert.equal(code, 0, output());
  assert.ok(seconds < 5, `${seconds}s`);
  assert.match(output(), /"message":"stopped"/);
});

test("gives up on a connection that never finishes", async () => {
  const { child, port, output } = await start({ ARITH_SHUTDOWN_TIMEOUT: "1" });
  // Half a request keeps a connection open; close() alone would wait on it.
  const stuck = connect(port, "127.0.0.1");
  await once(stuck, "connect");
  stuck.write("GET /healthz HTTP/1.1\r\nHost: x");
  await new Promise((resolve) => setTimeout(resolve, 200));

  const [seconds, code] = await stop(child);
  stuck.destroy();
  assert.equal(code, 0);
  assert.ok(seconds < 5, `${seconds}s`);
  assert.match(output(), /grace period over/);
});

test("a bad setting stops it before it listens", () => {
  const result = spawnSync(process.execPath, [MAIN], {
    cwd: ROOT,
    env: { ...process.env, ARITH_LOG_FORMAT: "yaml" },
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /arith: ARITH_LOG_FORMAT="yaml" is not valid: expected json or text/);
});
