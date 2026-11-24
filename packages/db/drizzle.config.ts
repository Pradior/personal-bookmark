import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  // generate 不需要连接；migrate 走我们自己的 src/migrate.ts
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://bookmark:bookmark@localhost:5432/bookmark',
  },
  verbose: true,
  strict: false,
});
