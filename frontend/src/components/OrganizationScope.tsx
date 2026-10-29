import { useState } from 'react';
import { Eye, Pencil, Users } from 'lucide-react';
import { getAccountPath, getCurrentAccountIdentity, getDemoScope, getLocalSession, getScopeAccounts, setDemoScope } from '../services/localClient';
import { initDataStore } from '../services/dataStore';
import { useFeedback } from './FeedbackProvider';

export function OrganizationScope({ onRefreshData }: { onRefreshData: () => void }) {
  const identity = getCurrentAccountIdentity();
  const actorId = getLocalSession().user.id;
  const scope = getDemoScope();
  const options = getScopeAccounts(actorId);
  const [busy, setBusy] = useState(false);
  const { notify } = useFeedback();
  const changeScope = async (id: string) => {
    const previous = scope.id;
    setBusy(true);
    try {
      setDemoScope(id);
      await initDataStore(true);
      onRefreshData();
    } catch (error) {
      setDemoScope(previous);
      notify({ title: '查看范围切换失败', message: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally { setBusy(false); }
  };
  return <section aria-label="组织层级与查看范围" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink"><Users className="h-4 w-4 text-brand-cyan" />
        {getAccountPath(scope.id).map(account => account.name.replace('（演示）', '')).join(' › ')}
      </div>
      <p className="mt-1.5 text-xs text-muted">{identity.isReadOnly
        ? '上级只读：可逐级查看授权区域和业务员；新增、修改、删除由所属业务员完成。'
        : '我的业务：查看和编辑自己负责的客户、合同、联系单、发货及收款。'}</p>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      {options.length > 1 && <label className="flex items-center gap-2 text-xs text-muted">查看范围
        <select aria-label="查看区域或业务员" value={scope.id} disabled={busy} onChange={event => void changeScope(event.target.value)} className="max-w-64 rounded-lg border border-border bg-surface px-3 py-2 text-body disabled:opacity-50">
          {options.map(account => <option key={account.id} value={account.id}>
            {'　'.repeat(Math.max(0, getAccountPath(account.id).length - getAccountPath(actorId).length))}{account.id === actorId ? (account.level === '老板' ? '全公司汇总' : `${account.region}汇总`) : account.role === 'leader' ? `${account.region}汇总 · ${account.name}` : account.name}
          </option>)}
        </select>
      </label>}
      <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${identity.isReadOnly ? 'bg-brand-cyan/10 text-brand-cyan' : 'bg-brand-emerald/10 text-brand-emerald'}`}>
        {identity.isReadOnly ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}{identity.isReadOnly ? '只读' : '本人业务可编辑'}
      </span>
    </div>
  </section>;
}
