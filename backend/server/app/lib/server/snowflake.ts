// Server-only Snowflake access for the store's API routes (app/api/events, app/api/layout).
// npm install snowflake-sdk   and in next.config.ts:  serverExternalPackages: ["snowflake-sdk"]
//
// Env (.env.local / Vercel; never NEXT_PUBLIC_):
//   SNOWFLAKE_ACCOUNT=orgname-accountname
//   SNOWFLAKE_USER=ATELIER_APP                       (service user from `python -m server app-user`)
//   SNOWFLAKE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"   (\n escapes are fine)
//   SNOWFLAKE_WAREHOUSE=ATELIER_WH  SNOWFLAKE_DATABASE=ATELIER  SNOWFLAKE_SCHEMA=LIVE  SNOWFLAKE_ROLE=ATELIER_APP_ROLE
// Without SNOWFLAKE_ACCOUNT the routes answer with "disabled" and the store keeps working on its defaults.
// Server-only: import this from route handlers, never from client components.

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Conn = any;

let conn: Promise<Conn> | null = null;

export function snowflakeEnabled(): boolean {
  return !!process.env.SNOWFLAKE_ACCOUNT && !!process.env.SNOWFLAKE_USER && !!process.env.SNOWFLAKE_PRIVATE_KEY;
}

async function connect(): Promise<Conn> {
  const snowflake = (await import("snowflake-sdk")).default ?? (await import("snowflake-sdk"));
  snowflake.configure({ logLevel: "WARN" });
  const c = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER!,
    authenticator: "SNOWFLAKE_JWT",
    privateKey: process.env.SNOWFLAKE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    warehouse: process.env.SNOWFLAKE_WAREHOUSE ?? "ATELIER_WH",
    database: process.env.SNOWFLAKE_DATABASE ?? "ATELIER",
    schema: process.env.SNOWFLAKE_SCHEMA ?? "LIVE",
    role: process.env.SNOWFLAKE_ROLE ?? "ATELIER_APP_ROLE",
    application: "atelier-store",
  });
  await new Promise<void>((resolve, reject) => c.connect((err: Error | undefined) => (err ? reject(err) : resolve())));
  return c;
}

/** One SQL statement with ? binds. Reuses one connection per server instance; reconnects after a failure. */
export async function sql<T extends Row = Row>(sqlText: string, binds: unknown[] = []): Promise<T[]> {
  if (!conn) conn = connect().catch((e) => { conn = null; throw e; });
  const c = await conn;
  try {
    return await new Promise<T[]>((resolve, reject) =>
      c.execute({ sqlText, binds, complete: (err: Error | undefined, _s: unknown, rows: T[] | undefined) =>
        (err ? reject(err) : resolve(rows ?? [])) }));
  } catch (e) {
    conn = null; // stale or expired connection: the next call reconnects
    throw e;
  }
}
