import Link from 'next/link';
import { t } from '@globalhub/i18n';
import { getLocale, load, getMe } from '@/lib/server';
import { ProductCard, Empty } from '@/components/ui';
import { countryName } from '@/lib/format';

export default async function Home() {
  const locale = await getLocale();
  const me = await getMe();
  const [cats, recent, nodes] = await Promise.all([load<any[]>('/categories'), load<any>('/products?sort=newest&pageSize=8'), load<any>('/nodes')]);
  const canSeeHall = !!me && (me.roles.includes('SUPPLIER') || me.roles.includes('AGENT'));
  const hall = canSeeHall ? await load<any>('/buying-requests/open?pageSize=5') : null;
  const tiles = [
    { href: '/products', k: 'home.cta.browse' as const, icon: '🔎' },
    { href: '/suppliers', k: 'home.cta.suppliers' as const, icon: '🏭' },
    { href: '/requests/new', k: 'home.cta.post' as const, icon: '📝' },
    { href: '/requests/new', k: 'home.cta.quotes' as const, icon: '💬' },
    { href: '/agents', k: 'home.cta.agents' as const, icon: '🧭' },
    { href: '/suppliers?verifiedOnly=true', k: 'home.cta.verified' as const, icon: '✅' },
  ];
  return (
    <div className="space-y-14">
      <section className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 px-6 py-12 text-white sm:px-12">
        <h1 className="max-w-3xl text-3xl font-bold sm:text-4xl">{t(locale, 'home.hero.title')}</h1>
        <p className="mt-3 max-w-2xl text-white/90">{t(locale, 'home.hero.subtitle')}</p>
        <form action="/products" className="mt-6 flex max-w-3xl flex-col gap-2 sm:flex-row" role="search">
          <label htmlFor="q" className="sr-only">{t(locale, 'common.search')}</label>
          <input id="q" name="q" className="input flex-1 py-3 text-base" placeholder={t(locale, 'home.search.placeholder')} />
          <input type="hidden" name="includeRemote" value="true" />
          <button className="btn bg-gray-900 px-6 py-3 text-white hover:bg-black">{t(locale, 'home.search.button')}</button>
        </form>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((x) => <Link key={x.k} href={x.href} className="card flex flex-col items-center gap-2 p-4 text-center text-sm font-medium hover:shadow-md"><span className="text-2xl" aria-hidden>{x.icon}</span>{t(locale, x.k)}</Link>)}
      </section>

      <section>
        <h2 className="h2 mb-4">{t(locale, 'home.categories')}</h2>
        <div className="flex flex-wrap gap-2">
          {(cats.data ?? []).filter((c) => !c.parentId).map((c) => <Link key={c.id} href={`/products?category=${c.slug}`} className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm hover:border-brand-500">{c.nameEn} <span className="muted">({c._count.products})</span></Link>)}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between"><h2 className="h2">{t(locale, 'home.recent')}</h2><Link href="/products" className="text-sm text-brand-600 hover:underline">{t(locale, 'nav.products')} →</Link></div>
        {recent.data?.items?.length ? <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{recent.data.items.map((p: any) => <ProductCard key={p.id} p={p} locale={locale} />)}</div> : <Empty>{t(locale, 'home.empty')}</Empty>}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="h2">{t(locale, 'home.wholesale')}</h2>
          <p className="muted mt-1">{t(locale, 'home.wholesale.desc')}</p>
          {hall?.data?.items?.length ? (
            <ul className="mt-4 divide-y">{hall.data.items.map((r: any) => <li key={r.id} className="py-2 text-sm"><Link className="hover:underline" href={`/seller/requests/${r.id}`}>{r.title}</Link> <span className="muted">· {r.quantity} {r.unit} → {countryName(r.destinationCountry, locale)}</span></li>)}</ul>
          ) : <div className="mt-4 flex gap-2"><Link href="/requests/new" className="btn-primary">{t(locale, 'home.cta.post')}</Link>{!me && <Link href="/register" className="btn-secondary">{t(locale, 'nav.register')}</Link>}</div>}
        </div>
        <div className="card">
          <h2 className="h2">{t(locale, 'home.how')}</h2>
          <ol className="mt-3 space-y-2 text-sm">{(['home.how.1', 'home.how.2', 'home.how.3', 'home.how.4'] as const).map((k, i) => <li key={k} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>{t(locale, k)}</li>)}</ol>
        </div>
      </section>

      <section className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="h2">{t(locale, 'home.network')}</h2><p className="muted mt-1 max-w-3xl">{t(locale, 'home.network.desc')}</p></div>
        <Link href="/network" className="btn-secondary shrink-0">{t(locale, 'home.network.link')} ({nodes.data?.nodes?.length ?? 0})</Link>
      </section>
    </div>
  );
}
