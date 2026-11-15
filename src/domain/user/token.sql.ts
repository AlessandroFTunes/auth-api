import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./user.sql";

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  // logout: encerrado pelo usuário; rotated: trocado por um novo no refresh;
  // reuse_detected: encerrado em massa após reuso de token rotacionado.
  revokedReason: text("revoked_reason", {
    enum: ["logout", "rotated", "reuse_detected"],
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
