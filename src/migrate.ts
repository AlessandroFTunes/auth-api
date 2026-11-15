import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Database, getDb } from "./domain/db/db";

await migrate(getDb(), {
  migrationsFolder: `${import.meta.dir}/domain/db/drizzle`,
});
await Database.getInstance().close();
console.log("migrations aplicadas");
