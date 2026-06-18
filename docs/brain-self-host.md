# Self-Hosting a Barry Brain

The **Brain** is the server side of the distributed shared KB. Anyone — an individual or a
company — can run one and point their Barry instances at it. v1 ships a single-container,
SQLite-backed deployment with zero external services.

The Brain is built on a portable core (a Web Fetch API handler plus a `BrainStore` storage
interface), so the same code can later run on other runtimes/backends. v1 ships the Bun +
SQLite path.

## Run it (Docker)

```bash
# Build the image from the repo root.
docker build -t barry-brain -f brain/Dockerfile .

# Run it. /data holds the SQLite DB, config, and signing identity (persist it!).
docker run -d --name barry-brain -p 8787:8787 -v "$PWD/brain-data:/data" barry-brain

# Verify it is up.
curl -s localhost:8787/healthz
# {"status":"ok","intake_disabled":false,"fingerprint":"sha256:..."}
```

On first boot the container auto-creates `brain.json` (config), `identity.json` (the brain's
Ed25519 signing keypair), and `brain.sqlite`, then migrates and serves.

### Get the pin fingerprint

Clients verify snapshot signatures against the brain's public key. Print its fingerprint:

```bash
docker run --rm -v "$PWD/brain-data:/data" barry-brain init --dir /data
# Pin this fingerprint in clients: sha256:...
```

(`init` is idempotent — it reuses an existing config and identity.)

## Run it without Docker

```bash
bun run brain/cli.ts init --dir ./brain-data --trust-policy company
bun run brain/cli.ts serve --dir ./brain-data --port 8787
```

## Point a Barry client at it

In the consuming repo's `.barry-cache/config.json`, set the brain descriptor and pin the
fingerprint printed by `init`:

```jsonc
{
  "shared_kb": {
    "contribution": "share_enabled",
    "brain": {
      "url": "http://your-host:8787",
      "scope": "private",
      "trust_policy": "company"
    }
  }
}
```

`scope: "private"` means this repo uses only your brain and never contacts the public global
brain.

## Trust policy

- `company` (default): submitted lessons become usable (`trusted`) immediately — appropriate
  for an internal team where validators are known.
- `global`: stricter — submitted lessons land as `reviewed` and stay out of default search.
  The strict staged-maturation + reputation engine that promotes `reviewed → trusted`
  automatically is a separate, later component; until then, `global` is conservative by design.

## HTTP contract

| Method + path | Purpose |
|---|---|
| `GET /healthz` | liveness, kill-switch state, fingerprint |
| `POST /v1/intake` | submit a signed batch of lessons + attestations |
| `GET /v1/search?q=...&tier=trusted\|reviewed&limit=N` | ranked lessons |
| `GET /v1/snapshot` | signed static snapshot (manifest + signature + lessons + index) |
| `POST /v1/attest` | submit an outcome attestation for a lesson |
| `GET /v1/lesson/:id` | a lesson plus its attestation count |

## Operations

- **Kill-switch:** set `INTAKE_DISABLED=true` to make `/v1/intake` return `503` while reads
  keep working: `docker run -e INTAKE_DISABLED=true ...`.
- **Backups:** copy `brain-data/brain.sqlite` (and keep `identity.json` safe — losing it means
  clients must re-pin a new fingerprint).
- **Conformance:** prove any deployment satisfies the contract:

  ```bash
  bun run brain/cli.ts conformance --url http://localhost:8787
  ```
