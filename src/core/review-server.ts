import { spawn } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { platform } from "node:os";
import serveHandler from "serve-handler";
import { readReviewAsset, reviewUiDir } from "./review-assets";
import { buildReviewModel } from "./review-model";

export interface ReviewServerOptions {
  repo: string;
  port?: number;
  open?: boolean;
}

export interface RunningReviewServer {
  url: string;
  close: () => Promise<void>;
}

export async function startReviewServer(options: ReviewServerOptions): Promise<RunningReviewServer> {
  const port = options.port ?? 8787;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (url.pathname === "/api/model") {
        const model = await buildReviewModel({ repo: options.repo });
        send(response, 200, JSON.stringify(model), "application/json; charset=utf-8");
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        send(response, 200, createReviewHtml(), "text/html; charset=utf-8");
        return;
      }
      await serveHandler(request, response, {
        public: reviewUiDir(),
        cleanUrls: false,
        headers: [
          {
            source: "**/*",
            headers: [{ key: "cache-control", value: "no-store" }],
          },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(response, 500, JSON.stringify({ ok: false, error: message }), "application/json; charset=utf-8");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  if (options.open) openBrowser(url);
  return {
    url,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

export function createReviewHtml(): string {
  return readReviewAsset("index.html");
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

function openBrowser(url: string): void {
  const currentPlatform = platform();
  const command = currentPlatform === "darwin" ? "open" : currentPlatform === "win32" ? "cmd" : "xdg-open";
  const args = currentPlatform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}
