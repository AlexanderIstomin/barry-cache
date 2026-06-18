export function startBunServer(opts: { router: (req: Request) => Promise<Response>; port: number }): { port: number; stop: () => void } {
  const server = Bun.serve({ port: opts.port, fetch: (req) => opts.router(req) });
  return { port: server.port ?? opts.port, stop: () => server.stop(true) };
}
