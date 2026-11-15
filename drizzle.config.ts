import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/domain/**/*.sql.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASEURL!,
  },
});
