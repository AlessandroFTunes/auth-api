import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

export class Database {
  private static instance: Database | null = null;

  readonly pool: Pool;
  readonly db: NodePgDatabase;

  private constructor(url: string) {
    this.pool = new Pool({ connectionString: url });
    this.db = drizzle({ client: this.pool });
  }

  static getInstance(): Database {
    if (!Database.instance) {
      const url = process.env.DATABASEURL;
      if (!url) throw new Error("DATABASEURL não definida");
      Database.instance = new Database(url);
    }
    return Database.instance;
  }

  async close(): Promise<void> {
    await this.pool.end();
    Database.instance = null;
  }
}

export const getDb = () => Database.getInstance().db;

type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

export const createTransaction = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => {
  return getDb().transaction(fn);
};
