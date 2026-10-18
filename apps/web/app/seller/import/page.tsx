import { t } from '@globalhub/i18n';
import { getLocale, load } from '@/lib/server';
import { PageHeader, StatusPill } from '@/components/ui';
import { ActionButton } from '@/components/ActionButton';
import { fmtDate } from '@/lib/format';
import { ImportWizard } from './ImportWizard';
export default async function Import() {
  const locale = await getLocale();
  const [profile, jobs] = await Promise.all([load<any>('/seller/profile'), load<any[]>('/imports')]);
  return (
    <div className="space-y-6"><PageHeader title={t(locale, 'seller.import')} subtitle="CSV (UTF-8). Excel: Save As → CSV UTF-8. Recognised headers include sku, title, price, currency, stock, moq." />
      <ImportWizard stores={(profile.data?.stores ?? []).map((s: any) => ({ id: s.id, name: s.name }))} />
      <div className="card"><h2 className="h2 mb-2">Import history</h2>
        <table className="table"><thead><tr><th>File</th><th>Rows</th><th>Status</th><th>Date</th><th /></tr></thead><tbody>{(jobs.data ?? []).map((j: any) => <tr key={j.id}><td>{j.filename}</td><td>{j.validRows}/{j.totalRows} valid, {j.errorRows} errors</td><td><StatusPill status={j.status} /></td><td className="text-xs">{fmtDate(j.createdAt, locale)}</td><td>{j.status === 'COMMITTED' && <ActionButton action={`/imports/${j.id}/rollback`} label="Roll back" confirm="Delete products created by this import (ordered products are archived instead)?" variant="ghost" />}</td></tr>)}</tbody></table></div>
    </div>
  );
}
