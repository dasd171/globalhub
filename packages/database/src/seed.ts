/**
 * Seed script — idempotent (safe to run repeatedly).
 *  - Always: roles/permissions and the category taxonomy.
 *  - Only with SEED_DEMO=true: clearly-labelled DEMO suppliers, products and buyers.
 *    Demo rows have isDemo=true and "[DEMO]" titles; no reviews, ratings or orders are fabricated.
 */
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaClient, type RoleKey } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES: [string, string, string | null][] = [
  ['outdoor', 'Outdoor & Camping', null],
  ['tents', 'Tents', 'outdoor'],
  ['electronics', 'Consumer Electronics', null],
  ['computer-accessories', 'Computer Accessories', 'electronics'],
  ['home-garden', 'Home & Garden', null],
  ['kitchenware', 'Kitchenware', 'home-garden'],
  ['apparel', 'Apparel & Textiles', null],
  ['packaging', 'Packaging & Printing', null],
  ['industrial', 'Industrial Supplies', null],
  ['beauty', 'Beauty & Personal Care', null],
  ['toys', 'Toys & Hobbies', null],
  ['sports', 'Sports & Fitness', null],
];

const PERMS: Record<RoleKey, string[]> = {
  BUYER: ['catalog:read', 'buying_request:create', 'quote:accept', 'order:create', 'review:create', 'dispute:open', 'message:send'],
  SUPPLIER: ['catalog:read', 'buying_request:read_public', 'quote:submit', 'order:fulfil', 'product:manage_own', 'store:manage_own', 'import:run', 'connector:manage_own', 'dispute:open', 'message:send'],
  AGENT: ['catalog:read', 'buying_request:read_public', 'quote:submit', 'agent:manage_own', 'message:send', 'dispute:open'],
  MODERATOR: ['catalog:read', 'moderation:reports', 'moderation:content', 'dispute:resolve', 'admin:audit'],
  NODE_ADMIN: ['catalog:read', 'node:manage', 'admin:system', 'admin:audit'],
  PLATFORM_ADMIN: [],
};

async function seedRoles() {
  const all = [...new Set(Object.values(PERMS).flat().concat(['admin:users', 'admin:suppliers', 'admin:catalog', 'admin:orders', 'admin:settings']))];
  for (const key of all) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  const perms = await prisma.permission.findMany();
  for (const key of Object.keys(PERMS) as RoleKey[]) {
    const role = await prisma.role.upsert({ where: { key }, update: {}, create: { key, description: key } });
    const list = key === 'PLATFORM_ADMIN' ? perms : perms.filter((p) => PERMS[key].includes(p.key));
    for (const p of list) await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } }, update: {}, create: { roleId: role.id, permissionId: p.id } });
  }
}

async function seedCategories() {
  for (const [i, [slug, en, parent]] of CATEGORIES.entries()) {
    const parentId = parent ? (await prisma.category.findUnique({ where: { slug: parent } }))?.id ?? null : null;
    await prisma.category.upsert({ where: { slug }, update: { nameEn: en, parentId }, create: { slug, nameEn: en, parentId, position: i } });
  }
}

async function demoUser(email: string, displayName: string, roles: RoleKey[], passwordHash: string) {
  const u = await prisma.user.upsert({ where: { email }, update: {}, create: { email, displayName, passwordHash, emailVerifiedAt: new Date() } });
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: u.id, roleId: role.id } }, update: {}, create: { userId: u.id, roleId: role.id } });
  }
  await prisma.buyerProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id } });
  return u;
}

async function seedDemo() {
  const password = process.env.SEED_DEMO_PASSWORD ?? randomBytes(9).toString('base64url');
  const passwordHash = await hash(password);
  const cat = async (slug: string) => (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;

  const s1u = await demoUser('demo-supplier-electronics@example.com', 'Demo Example Electronics', ['SUPPLIER', 'BUYER'], passwordHash);
  const s1 = await prisma.supplierProfile.upsert({ where: { userId: s1u.id }, update: {}, create: { userId: s1u.id, companyName: '[DEMO] Example Electronics Co.', supplierType: 'MANUFACTURER', province: 'Penang', city: 'George Town', description: 'Demo supplier for local testing. Not a real company.', verificationStatus: 'EMAIL_VERIFIED', isDemo: true } });
  const st1 = await prisma.store.upsert({ where: { slug: 'demo-example-electronics' }, update: {}, create: { supplierId: s1.id, name: '[DEMO] Example Electronics Store', slug: 'demo-example-electronics', shipsFrom: 'George Town, MY' } });

  const s2u = await demoUser('demo-supplier-outdoor@example.com', 'Demo Example Outdoor', ['SUPPLIER', 'BUYER'], passwordHash);
  const s2 = await prisma.supplierProfile.upsert({ where: { userId: s2u.id }, update: {}, create: { userId: s2u.id, companyName: '[DEMO] Example Outdoor Gear Ltd.', supplierType: 'MANUFACTURER', province: 'Porto District', city: 'Porto', description: 'Demo supplier for local testing. Not a real company.', verificationStatus: 'EMAIL_VERIFIED', isDemo: true } });
  const st2 = await prisma.store.upsert({ where: { slug: 'demo-example-outdoor' }, update: {}, create: { supplierId: s2.id, name: '[DEMO] Example Outdoor Store', slug: 'demo-example-outdoor', shipsFrom: 'Porto, PT' } });

  await demoUser('demo-buyer@example.com', 'Demo Buyer (Tokyo)', ['BUYER'], passwordHash);
  const au = await demoUser('demo-agent@example.com', 'Demo Sourcing Agent', ['AGENT', 'BUYER'], passwordHash);
  await prisma.agentProfile.upsert({ where: { userId: au.id }, update: {}, create: { userId: au.id, displayName: '[DEMO] Example Sourcing Agent', serviceRegions: ['Southeast Asia', 'Europe'], languages: ['en'], services: ['LOCAL_SOURCING', 'SUPPLIER_CONTACT', 'INSPECTION', 'CONSOLIDATION'], feeStructure: 'DEMO: 5% of goods value, min USD 50 per order (illustrative only)', isDemo: true } });

  const products = [
    { store: st2.id, slug: 'tents', sku: 'DEMO-TENT-4P', titleEn: '[DEMO] Waterproof 4-person camping tent', descEn: 'Demo listing. 3000mm waterproof polyester fly, fiberglass poles.', material: 'Polyester 190T', moq: 1, currency: 'EUR', tiers: [[1, 9, 12000], [10, 49, 10500], [50, 99, 9200], [100, null, null]] as [number, number | null, number | null][], stock: 300, weight: 3200, ships: ['JP', 'US', 'DE', 'GB', 'AU'], oem: true },
    { store: st1.id, slug: 'computer-accessories', sku: 'DEMO-HUB-7IN1', titleEn: '[DEMO] USB-C hub 7-in-1 with HDMI and Ethernet', descEn: 'Demo listing. USB-C hub with HDMI 4K, gigabit Ethernet, 3x USB-A, SD/TF, 100W PD. Suitable for laptops.', material: 'Aluminium alloy', moq: 10, currency: 'USD', tiers: [[10, 99, 1450], [100, 499, 1290], [500, null, 1150]] as [number, number | null, number | null][], stock: 1200, weight: 120, ships: [], oem: true },
    { store: st1.id, slug: 'electronics', sku: 'DEMO-PB-10K', titleEn: '[DEMO] 10000mAh power bank', descEn: 'Demo listing. Contains lithium battery — air shipping restrictions apply.', material: 'ABS', moq: 50, currency: 'USD', tiers: [[50, 499, 690], [500, null, 590]] as [number, number | null, number | null][], stock: 0, weight: 210, ships: ['JP', 'US'], battery: true },
    { store: st2.id, slug: 'kitchenware', sku: 'DEMO-BOTTLE-500', titleEn: '[DEMO] Stainless steel insulated bottle 500ml', descEn: 'Demo listing. Custom logo available (made to order).', material: '304 stainless steel', moq: 200, currency: 'EUR', tiers: [[200, 999, 1850], [1000, null, 1600]] as [number, number | null, number | null][], stock: null, weight: 350, ships: [], oem: true, madeToOrder: true },
  ];
  for (const p of products) {
    const existing = await prisma.productVariant.findFirst({ where: { sku: p.sku, product: { storeId: p.store } } });
    if (existing) continue;
    await prisma.product.create({
      data: {
        storeId: p.store, categoryId: await cat(p.slug), titleEn: p.titleEn, descriptionEn: p.descEn, originalLanguage: 'en', translationStatus: 'USER_CONFIRMED', status: 'ACTIVE',
        stockStatus: p.madeToOrder ? 'MADE_TO_ORDER' : p.stock == null ? 'UNVERIFIED' : p.stock === 0 ? 'OUT_OF_STOCK' : 'IN_STOCK', customizable: !!p.oem, oemOdm: !!p.oem, moq: p.moq, currency: p.currency,
        basePriceMinor: p.tiers[0][2], leadTimeDays: p.madeToOrder ? 20 : 3, shipsFrom: p.store === st1.id ? 'George Town, MY' : 'Porto, PT', shipsTo: p.ships, shippingMethods: ['AIR_EXPRESS', 'SEA_LCL'],
        material: p.material, containsBattery: !!p.battery, hsCode: p.battery ? '850760' : undefined, requiredDocuments: p.battery ? ['MSDS', 'UN38.3'] : [], isDemo: true, isPublic: true,
        complianceNotes: p.battery ? 'Lithium batteries: check carrier and destination rules before shipping.' : undefined,
        priceTiers: { create: p.tiers.map(([minQty, maxQty, unit]) => ({ minQty, maxQty, unitPriceMinor: unit })) },
        variants: { create: { sku: p.sku, name: 'Standard', weightGrams: p.weight, inventory: { create: { onHand: p.stock ?? 0, source: 'NATIVE', verifiedAt: p.stock == null ? null : new Date() } } } },
      },
    });
  }
  console.log('Demo data ready. Demo accounts (password printed once):');
  console.log('  demo-buyer@example.com, demo-supplier-electronics@example.com, demo-supplier-outdoor@example.com, demo-agent@example.com');
  console.log(`  password: ${process.env.SEED_DEMO_PASSWORD ? '(from SEED_DEMO_PASSWORD)' : password}`);
}

async function main() {
  await seedRoles();
  await seedCategories();
  if (process.env.SEED_DEMO === 'true') {
    if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') throw new Error('Refusing to seed demo data in production without DEMO_MODE=true');
    await seedDemo();
  }
  console.log('Seed complete.');
}
main().finally(() => prisma.$disconnect());
