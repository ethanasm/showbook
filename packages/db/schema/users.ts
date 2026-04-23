import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email'),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
