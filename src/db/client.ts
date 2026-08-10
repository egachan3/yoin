import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Database } from "./schema";

// D1バインディングはCloudflare Workersのリクエストごとのenvからしか取れないため、
// シングルトンにせずリクエスト単位で呼び出す関数として提供する
export function createDb(d1: D1Database): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new D1Dialect({ database: d1 }),
  });
}
