import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { API_A, API_B, api, apiUser, supplierProduct, loginUI, grantRole, dbA, PASSWORD } from './helpers';

test.describe.configure({ mode: 'serial' });

test('scenario 1: register → search → product detail → request a quote (UI)', async ({ page }) => {
  await supplierProduct(API_A, { title: 'E2E Alpine Tent', stock: 50 });
  const email = `ui-buyer-${randomUUID().slice(0, 6)}@e2e.example`;
  await page.goto('/register');
  await page.getByLabel(/Display name/).fill('UI Buyer');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByTestId('dev-verify-link').click();
  await page.getByRole('button', { name: 'Verify email' }).click();
  await page.waitForURL('**/login');
  await loginUI(page, email);
  await expect(page.getByTestId('demo-banner')).toContainText('DEMO PAYMENT');

  await page.goto('/');
  await page.getByRole('searchbox').or(page.locator('#q')).first().fill('alpine tent');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByTestId('result-count')).toContainText('1 results');
  await page.getByRole('link', { name: /E2E Alpine Tent/ }).first().click();
  await expect(page.getByTestId('product-title')).toHaveText('E2E Alpine Tent');
  await expect(page.getByText('In stock').first()).toBeVisible();
  await page.getByLabel('Request a quote').fill('Please quote 20 units with shipping to Japan');
  await page.getByTestId('request-quote').click();
  await page.waitForURL('**/buyer/requests/**');
  await expect(page.getByRole('heading', { name: /Quote request: E2E Alpine Tent/ })).toBeVisible();
});

test('scenario 2: post buying request → supplier quotes → buyer compares and accepts (UI)', async ({ page }) => {
  const buyer = await apiUser(API_A, 'BUYER');
  await api(API_A, 'POST', '/users/me/addresses', { fullName: 'Taro', line1: '1-1 Chiyoda', city: 'Tokyo', country: 'JP', isDefault: true }, buyer.token);
  await loginUI(page, buyer.email);
  await page.goto('/requests/new');
  await page.locator('#free').fill('I need 100 waterproof camping tents, preferably from a factory. Please quote the best available price and shipping to Japan.');
  await page.getByRole('button', { name: 'Analyze' }).click();
  await expect(page.getByTestId('parsed')).toContainText('Quantity: 100');
  await expect(page.getByTestId('parsed')).toContainText('Destination: JP');
  await page.getByTestId('publish-request').click();
  await page.waitForURL('**/buyer/requests/**');
  const requestId = page.url().split('/').pop()!;

  const s1 = await apiUser(API_A, 'SUPPLIER'); const s2 = await apiUser(API_A, 'SUPPLIER');
  const hall = await api(API_A, 'GET', '/buying-requests/open', undefined, s1.token);
  expect(hall.body.items.some((r: any) => r.id === requestId)).toBe(true);
  for (const [s, price] of [[s1, 1890], [s2, 1720]] as const) {
    const q = await api(API_A, 'POST', '/quotes', { buyingRequestId: requestId, productName: '4P tent', availableQty: 300, currency: 'USD', unitPriceMinor: price, moq: 50, productionDays: 12, validDays: 10, internationalShippingMinor: null, internationalShippingSource: 'NOT_CONFIRMED' }, s.token);
    expect(q.status).toBe(201);
  }
  await page.reload();
  const table = page.getByTestId('quotes-table');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table).toContainText('$17.20');
  await expect(table).toContainText('Not yet confirmed');
  await expect(page.getByTestId('quote-summary')).toContainText('lowest unit price');
  page.once('dialog', (d) => d.accept());
  await table.locator('tbody tr').first().getByTestId('accept-quote').click();
  await page.waitForURL('**/buyer/orders/**');
  await expect(page.getByTestId('order-status')).toHaveText('PENDING_SUPPLIER_CONFIRMATION');
  await expect(page.getByTestId('fees')).toContainText('Not yet confirmed');
});

test('scenario 3: order → supplier confirms (UI) → mock payment (UI) → shipping → completed', async ({ page }) => {
  const { supplier, product } = await supplierProduct(API_A, { title: 'E2E Steel Bottle', stock: 40, price: 500 });
  const buyer = await apiUser(API_A, 'BUYER');
  await api(API_A, 'POST', '/users/me/addresses', { fullName: 'Taro', line1: '1-1', city: 'Osaka', country: 'JP', isDefault: true }, buyer.token);
  await loginUI(page, buyer.email);
  await page.goto(`/products/${product.id}`);
  await page.getByLabel('Quantity').fill('10');
  await page.getByTestId('order-now').click();
  await page.waitForURL('**/buyer/orders/**');
  const orderId = page.url().split('/').pop()!;
  await expect(page.getByTestId('order-status')).toHaveText('PENDING_SUPPLIER_CONFIRMATION');

  // Supplier confirms in the seller center.
  await page.context().clearCookies();
  await loginUI(page, supplier.email, PASSWORD, `/seller/orders/${orderId}`);
  await page.getByLabel('Status').first().selectOption('CONFIRMED');
  await page.getByLabel('Amount USD').first().fill('35.00');
  await page.getByTestId('confirm-order').click();
  await expect(page.getByTestId('order-status')).toHaveText('AWAITING_PAYMENT');

  // Buyer pays with the mock provider (clearly marked demo).
  await page.context().clearCookies();
  await loginUI(page, buyer.email, PASSWORD, `/buyer/orders/${orderId}`);
  await expect(page.getByText('DEMO PAYMENT — NO REAL MONEY MOVED').first()).toBeVisible();
  await page.getByText(/I understand some costs/).click();
  await page.getByTestId('pay').click();
  await expect(page.getByTestId('order-status')).toHaveText('PAID');

  // Supplier fulfils via API; shipment tracked.
  for (const to of ['PROCESSING', 'READY_TO_SHIP']) expect((await api(API_A, 'POST', `/orders/${orderId}/transition`, { to }, supplier.token)).status).toBe(200);
  const sh = await api(API_A, 'POST', `/orders/${orderId}/shipments`, { carrier: 'SF Express', trackingNumber: 'SF123456789CN' }, supplier.token);
  await api(API_A, 'POST', `/shipments/${sh.body.id}/events`, { status: 'IN_TRANSIT', location: 'Rotterdam' }, supplier.token);
  await api(API_A, 'POST', `/shipments/${sh.body.id}/events`, { status: 'DELIVERED', location: 'Osaka' }, supplier.token);
  await page.reload();
  await expect(page.getByTestId('order-status')).toHaveText('DELIVERED');
  await expect(page.getByText('SF123456789CN', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByTestId('order-status')).toHaveText('COMPLETED');
});

test('scenario 4: supplier CSV import → errors → fix → published (UI)', async ({ page }) => {
  const s = await apiUser(API_A, 'SUPPLIER');
  await api(API_A, 'POST', '/stores', { name: 'Import Store', slug: `imp-${randomUUID().slice(0, 8)}` }, s.token);
  await loginUI(page, s.email, PASSWORD, '/seller/import');
  const csvBox = page.getByLabel('CSV content');
  await csvBox.fill('Item Code,Product Name,Unit Price,Currency,Inventory,MOQ\nIMP-1,Importcheck tent,99.00,USD,100,1\nIMP-1,Duplicate SKU row,10,USD,1,1\n,Missing SKU row,10,USD,1,1\n');
  await page.getByTestId('import-preview').click();
  await expect(page.getByTestId('import-summary')).toContainText('1 valid / 3 rows');
  await expect(page.getByTestId('import-errors')).toContainText('Duplicate SKU');
  await csvBox.fill('Item Code,Product Name,Unit Price,Currency,Inventory,MOQ\nIMP-1,Importcheck tent,99.00,USD,100,1\nIMP-2,Importcheck tarp,12.50,USD,,5\n');
  await page.getByTestId('import-preview').click();
  await expect(page.getByTestId('import-summary')).toContainText('2 valid / 2 rows');
  await page.getByTestId('import-commit').click();
  await expect(page.getByTestId('import-done')).toContainText('Imported 2 products');
  await page.goto('/products?q=Importcheck');
  await expect(page.getByTestId('result-count')).toContainText('2 results');
});

test('scenario 5: two nodes exchange catalogs; buyer finds remote product and requests a quote', async ({ page }) => {
  await supplierProduct(API_B, { title: 'E2E Federated Bamboo Board', stock: 500, price: 380 });
  const admin = await apiUser(API_A, 'BUYER');
  const db = dbA(); await grantRole(db, admin.user.id, 'NODE_ADMIN'); await db.$disconnect();
  // Node B must know node A to accept its signed RFQs.
  const bAdmin = await apiUser(API_B, 'BUYER');
  const b = new PrismaClient({ datasources: { db: { url: `${process.env.E2E_PG ?? 'postgresql://postgres@127.0.0.1:5432'}/globalhub_e2e_b` } } });
  await grantRole(b, bAdmin.user.id, 'NODE_ADMIN'); await b.$disconnect();
  expect((await api(API_B, 'POST', '/nodes/discover', { url: 'http://127.0.0.1:4000' }, bAdmin.token)).status).toBe(201);

  await loginUI(page, admin.email, PASSWORD, '/network');
  await page.getByLabel('Node public URL').fill('http://127.0.0.1:4002');
  await page.getByRole('button', { name: 'Discover' }).click();
  await expect(page.getByRole('cell', { name: /E2E Node B/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sync' }).click();
  await expect(page.getByRole('row', { name: /E2E Node B/ }).getByRole('cell').nth(5)).toHaveText('1');

  await page.goto('/products?q=bamboo&includeRemote=true');
  await expect(page.getByTestId('remote-result')).toHaveCount(1);
  await page.getByTestId('remote-result').click();
  await expect(page.getByText('Listed on a remote node').first()).toBeVisible();
  await page.getByLabel('Message').fill('Need 600 bamboo boards with laser engraving');
  await page.getByLabel('Quantity').fill('600');
  await page.getByRole('button', { name: 'Request a quote' }).click();
  await page.waitForURL('**/buyer/requests');
  const b2 = new PrismaClient({ datasources: { db: { url: `${process.env.E2E_PG ?? 'postgresql://postgres@127.0.0.1:5432'}/globalhub_e2e_b` } } });
  const inbound = await b2.buyingRequest.findFirst({ where: { originNodeId: { not: null } } });
  await b2.$disconnect();
  expect(inbound?.quantity).toBe(600);
  expect(inbound?.remoteBuyerLabel).toBe('Buyer via E2E Node A');
  expect(inbound?.buyerId).toBeNull();
});

test('scenario 6: a user cannot open another user’s order', async ({ page }) => {
  const { product } = await supplierProduct(API_A, { title: 'E2E Private Order Item', stock: 5 });
  const a = await apiUser(API_A, 'BUYER'); const b = await apiUser(API_A, 'BUYER');
  const o = await api(API_A, 'POST', '/orders', { idempotencyKey: randomUUID(), items: [{ variantId: product.variants[0].id, quantity: 1 }] }, a.token);
  expect(o.status).toBe(201);
  expect((await api(API_A, 'GET', `/orders/${o.body.id}`, undefined, b.token)).status).toBe(404);
  await loginUI(page, b.email);
  await page.goto(`/buyer/orders/${o.body.id}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Order not found' })).toBeVisible();
  await expect(page.getByTestId('order-status')).toHaveCount(0);
});

test('scenario 7: duplicate payment webhooks do not double-process', async ({ request }) => {
  const { supplier, product } = await supplierProduct(API_A, { title: 'E2E Webhook Item', stock: 10, price: 1000 });
  const buyer = await apiUser(API_A, 'BUYER');
  const o = await api(API_A, 'POST', '/orders', { idempotencyKey: randomUUID(), items: [{ variantId: product.variants[0].id, quantity: 1 }] }, buyer.token);
  await api(API_A, 'POST', `/orders/${o.body.id}/confirm`, { fees: [{ type: 'INTERNATIONAL_SHIPPING', label: 'Ship', amountMinor: 200, status: 'CONFIRMED' }, { type: 'TAX_ESTIMATED', label: 'Tax', amountMinor: 50, status: 'ESTIMATED' }] }, supplier.token);
  const pay = await api(API_A, 'POST', `/orders/${o.body.id}/payments`, {}, buyer.token);
  expect(pay.body.isDemo).toBe(true);
  const { createHmac } = await import('node:crypto');
  const body = JSON.stringify({ id: `evt_e2e_${randomUUID()}`, type: 'payment.succeeded', providerRef: `mock_pi_pay_${o.body.id}`, amountMinor: pay.body.amountMinor, currency: 'USD', orderId: o.body.id });
  const sig = createHmac('sha256', 'dev-mock-webhook-secret').update(body).digest('hex');
  const results = await Promise.all([1, 2, 3].map(() => request.post(`${API_A}/payments/webhooks/mock`, { headers: { 'content-type': 'application/json', 'x-mock-signature': sig }, data: body })));
  const json = await Promise.all(results.map((r) => r.json()));
  expect(json.filter((j) => j.processed).length).toBe(1);
  const order = await api(API_A, 'GET', `/orders/${o.body.id}`, undefined, buyer.token);
  expect(order.body.status).toBe('PAID');
  expect(order.body.events.filter((e: any) => e.toStatus === 'PAID')).toHaveLength(1);
});

test('scenario 8: concurrent buyers cannot oversell limited stock', async () => {
  const { product } = await supplierProduct(API_A, { title: 'E2E Limited Item', stock: 3 });
  const buyers = await Promise.all(Array.from({ length: 8 }, () => apiUser(API_A, 'BUYER')));
  const res = await Promise.all(buyers.map((b) => api(API_A, 'POST', '/orders', { idempotencyKey: randomUUID(), items: [{ variantId: product.variants[0].id, quantity: 1 }] }, b.token)));
  expect(res.filter((r) => r.status === 201)).toHaveLength(3);
  expect(res.filter((r) => r.status === 409 && r.body.error.code === 'INSUFFICIENT_STOCK')).toHaveLength(5);
});
