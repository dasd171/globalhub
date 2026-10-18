/**
 * Create (or promote) the first platform administrator.
 *   pnpm admin:create --email admin@example.com --name "Admin"
 * The password is read from ADMIN_PASSWORD or prompted on stdin; it is never logged.
 */
import { createInterface } from 'node:readline/promises';
import { loadConfig, createCore, auth, audit } from '@globalhub/core';

function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; }

async function main() {
  const email = arg('email')?.toLowerCase();
  const name = arg('name') ?? 'Platform Admin';
  if (!email) throw new Error('Usage: pnpm admin:create --email you@example.com [--name "Admin"]');
  const core = createCore(loadConfig());
  await auth.ensureRoles(core);
  let password = process.env.ADMIN_PASSWORD;
  const existing = await core.prisma.user.findUnique({ where: { email } });
  if (!existing && !password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('Admin password (min 12 chars): ');
    rl.close();
  }
  if (!existing && (!password || password.length < 12)) throw new Error('Password must be at least 12 characters');
  const user = existing ?? await core.prisma.user.create({ data: { email, displayName: name, passwordHash: await auth.hashPassword(password!), emailVerifiedAt: new Date() } });
  for (const key of ['PLATFORM_ADMIN', 'BUYER'] as const) {
    const role = await core.prisma.role.findUniqueOrThrow({ where: { key } });
    await core.prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
  }
  await core.prisma.buyerProfile.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
  await audit(core, { actorId: null, action: 'admin.created_via_cli', targetType: 'User', targetId: user.id, metadata: { email } });
  console.log(`✔ ${email} is a PLATFORM_ADMIN${existing ? ' (existing account promoted)' : ''}`);
  await core.prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
