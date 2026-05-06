/**
 * Local seed for development.
 *   pnpm db:seed
 */
import { getDb } from './client';
import { project, workspace, workspaceMember, user } from './schema';

async function main() {
  const db = getDb();

  // Demo user
  const [u] = await db
    .insert(user)
    .values({
      email: 'demo@metu.ro',
      name: 'Demo User',
    })
    .onConflictDoNothing({ target: user.email })
    .returning();

  if (!u) {
    console.info('Seed already applied — demo user exists.');
    return;
  }

  const [ws] = await db
    .insert(workspace)
    .values({ name: 'Personal', slug: `personal-${Date.now()}` })
    .returning();
  if (!ws) throw new Error('failed to create workspace');

  await db.insert(workspaceMember).values({
    workspaceId: ws.id,
    userId: u.id,
    role: 'owner',
  });

  await db.insert(project).values([
    {
      workspaceId: ws.id,
      name: 'metu',
      slug: 'metu',
      summary: 'Personal AI Operating System',
      momentumScore: 0.95,
      metadata: { stack: ['Next.js', 'Drizzle', 'GCP'], color: '#7c3aed' },
    },
    {
      workspaceId: ws.id,
      name: 'evocrm',
      slug: 'evocrm',
      summary: 'Production CRM',
      momentumScore: 0.6,
      metadata: { stack: ['Next.js', 'Prisma'], color: '#0ea5e9' },
    },
  ]);

  console.info('✅ seed complete');
}

main().catch((err) => {
  console.error('❌ seed failed', err);
  process.exit(1);
});
