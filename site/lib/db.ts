import { Pool } from "pg";

let pool: Pool | null = null;
let ready: Promise<void> | null = null;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  }
  return pool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  aaguid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  cred_id TEXT,
  used BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  body_hash TEXT NOT NULL,
  credential_id TEXT NOT NULL REFERENCES credentials(id),
  challenge TEXT NOT NULL,
  signature TEXT NOT NULL,
  authenticator_data TEXT NOT NULL,
  client_data_json TEXT NOT NULL,
  user_verified BOOLEAN NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function db() {
  const p = getPool();
  if (!ready) ready = p.query(SCHEMA).then(() => undefined);
  await ready;
  return p;
}
