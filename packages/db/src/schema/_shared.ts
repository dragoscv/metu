/**
 * Common column helpers — id, timestamps, soft-delete.
 */
import { sql } from 'drizzle-orm';
import { text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

/** A textual short id for human-readable URLs (`/p/abcd1234`). */
export const slug = (name = 'slug') => text(name).notNull();
