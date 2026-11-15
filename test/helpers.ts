import { env } from "cloudflare:workers";
import schemaSql from "../schema.sql?raw";

export async function applySchema(): Promise<void> {
  const oneLine = schemaSql.replace(/\r?\n/g, " ");
  await env.DB.exec(oneLine);
}

export async function clearKv(prefixes: string[]): Promise<void> {
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      const listed = await env.KV.list({ prefix, cursor });
      if (listed.keys.length) {
        await Promise.all(listed.keys.map((key) => env.KV.delete(key.name)));
      }
      cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor);
  }
}