import React, { useEffect, useMemo, useState } from 'react';
import { Database, Download, RefreshCw, Send, ShieldCheck, ArrowRightLeft, Trash2 } from 'lucide-react';
import { db, initDataStore } from '../services/dataStore';
import { localRequest, downloadLocalFile, getCurrentAccountIdentity, DEMO_ACCOUNTS, getLocalSession, IS_PUBLIC_DEMO, setDemoAccount } from '../services/localClient';
import { formatLocalDate, formatLocalMonth } from '../services/dateUtils';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { useFeedback } from '../components/FeedbackProvider';

interface SettingsProps { onRefreshData: () => void; onRefreshTrigger: number }
type TelegramStatus = { configured: boolean; recipients: {manager: boolean; owner: boolean} };
const inputClass = 'rounded-lg border border-border bg-surface px-3 py-2 text-sm text-body';
const panelClass = 'rounded-2xl border border-border bg-surface p-6 shadow-sm';

export const Settings: React.FC<SettingsProps> = ({ onRefreshData, onRefreshTrigger }) => {
  const { confirm, notify } = useFeedback();
  const [tab, setTab] = useState<'local' | 'telegram' | 'rates'>('local');
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [error, setError] = useState('');
  const [report, setReport] = useState('');
  const [mode, setMode] = useState('current_month');
  const [recipient, setRecipient] = useState<'manager' | 'owner'>(getLocalSession().user.id === 'demo-manager' ? 'owner' : 'manager');
  const [rateMonth, setRateMonth] = useState(formatLocalMonth());
  const [rateValue, setRateValue] = useState('7.2000');
  const identity = getCurrentAccountIdentity();
  const rates = useMemo(() => { void onRefreshTrigger; return [...db.getExchangeRates()].sort((a,b) => b.effective_month.localeCompare(a.effective_month)); }, [onRefreshTrigger]);

  useEffect(() => {
    let active = true;
    Promise.all([
      localRequest<{counts:Record<string,number>}>('health'),
      localRequest<TelegramStatus>('telegram/status'),
    ]).then(([health, status]) => {
      if (active) { setCounts(health.counts); setTelegram(status); }
    }).catch(e => { if (active) setError(String(e.message || e)); });
    return () => { active = false; };
  }, [onRefreshTrigger]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const preview = () => run(async () => {
    const result = await localRequest<{text:string}>('telegram/preview', {method:'POST', body:JSON.stringify({mode, recipient})});
    setReport(result.text);
  });
  const send = async () => {
    const accepted = await confirm({
      title:'发送测试汇报到 Telegram？',
      message:`将把当前身份“${identity.displayName}”的虚构业务汇报发送给本地配置的${recipient === 'manager' ? '经理' : '负责人'}。请确认你已检查预览和接收人配置。`,
      confirmLabel:'确认发送测试汇报',
    });
    if (!accepted) return;
    await run(async () => {
      await localRequest('telegram/send', {method:'POST',body:JSON.stringify({mode,recipient,confirmed:true})});
      notify({title:'汇报已发送',message:'本地服务已收到 Telegram 的发送成功响应。',tone:'success'});
    });
  };
  const reset = async () => {
    const accepted = await confirm({
      title:'重置本地演示数据？',
      message:'当前数据库将先备份到 data/backups/，然后恢复为虚构演示种子。你在演示中新增、修改的数据会从当前工作库移除，可从备份恢复。',
      confirmLabel:'备份并重置',tone:'danger',
    });
    if (!accepted) return;
    await run(async () => {
      await localRequest('reset', {method:'POST',body:JSON.stringify({confirm:'RESET_DEMO'})});
      await initDataStore(true); onRefreshData(); setReport('');
      notify({title:'演示数据已重置',message:'旧数据库备份保留在 data/backups/，不会上传到 GitHub。',tone:'success'});
    });
  };
  const saveRate = async (event:React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      if (!Number.isFinite(Number(rateValue)) || Number(rateValue) <= 0) throw new Error('汇率必须大于 0。');
      await db.saveExchangeRates([{id:crypto.randomUUID(), effective_month:rateMonth, currency_pair:'USD/CNY',rate:Number(rateValue),source_date:formatLocalDate(),source:'Manual',notes:'手工维护的演示汇率',created_at:new Date().toISOString()}]);
      onRefreshData(); notify({title:'演示汇率已保存',message:rateMonth,tone:'success'});
    });
  };
  const deleteRate = async (id:string, month:string) => {
    if (!await confirm({title:'删除演示汇率？',message:`${month} 的相关换算将显示缺少汇率，确认继续？`,tone:'danger'})) return;
    await run(async () => { await db.deleteExchangeRate(id); onRefreshData(); });
  };
  const countLabels:Record<string,string> = {customers:'虚构客户',contracts:'销售合同',contact_sheets:'联系单',batches:'生产批次',shipments:'发货记录',payment_receipts:'收款主单'};

  return <div className="mx-auto max-w-7xl space-y-6">
    <PageHeader
      title={IS_PUBLIC_DEMO ? '公网演示设置与工作汇报' : '本地设置与工作汇报'}
      description={IS_PUBLIC_DEMO
        ? '这是与内网完全隔离的只读快照；所有公司、客户与金额均为虚构。'
        : '演示数据只保存在这台电脑；业务场景完整，所有公司、客户与金额均为虚构。'}
    />
    <div className="flex gap-2 border-b border-border pb-3">
      {[{id:'local',name:'本地数据',icon:Database},{id:'telegram',name:'Telegram 汇报',icon:Send},{id:'rates',name:'演示汇率',icon:ArrowRightLeft}].map(item => {
        const Icon=item.icon;
        return <Button key={item.id} tone={tab===item.id?'primary':'secondary'} onClick={()=>setTab(item.id as typeof tab)} icon={<Icon className="h-4 w-4"/>}>{item.name}</Button>;
      })}
    </div>
    {error && <div role="alert" className="rounded-xl border border-brand-rose/30 bg-brand-rose/10 p-4 text-sm text-brand-rose">{error}</div>}
    {tab==='local' && <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {Object.entries(countLabels).map(([key,label]) => <div key={key} className={panelClass}><div className="text-xs text-muted">{label} · 全库</div><div className="mt-2 text-3xl font-semibold text-ink">{(counts[key] || 0).toLocaleString()}</div></div>)}
      </div>
      <section className={panelClass}>
        <h2 className="flex items-center gap-2 font-semibold text-ink"><ShieldCheck className="h-5 w-5 text-brand-emerald"/>演示身份</h2>
        <p className="mt-3 text-sm leading-6 text-muted">业务员看个人业务，经理和负责人查看汇总。这里只模拟汇报层级，不连接任何真实账号；公网版本中的所有身份均为只读。</p>
        <select aria-label="设置演示身份" className={`mt-4 ${inputClass}`} value={getLocalSession().user.id} onChange={event=>{setDemoAccount(event.target.value);window.location.reload();}}>
          {DEMO_ACCOUNTS.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </section>
      <section className={panelClass}>
        <h2 className="font-semibold text-ink">{IS_PUBLIC_DEMO ? '公网快照与隔离说明' : '持久化、备份与重置'}</h2>
        <p className="mt-3 text-sm leading-7 text-muted">{IS_PUBLIC_DEMO
          ? '公网站点使用随部署生成的虚构数据快照，不连接 NAS、家庭网络或生产系统。访客不能下载全库备份或重置共享数据；业务报表导出仍可在导出中心体验。'
          : <>工作数据库：<code>data/demo.sqlite3</code>；虚构种子：<code>data/demo-seed.json</code>。刷新页面或重启应用不会丢失已保存数据。重置前会自动保存数据库备份；导出的 JSON 包含全库快照，请妥善保管。</>}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {!IS_PUBLIC_DEMO && <Button disabled={busy} tone="secondary" icon={<Download className="h-4 w-4"/>} onClick={()=>void run(async()=>{await downloadLocalFile('backup',{},'演示数据备份.json');})}>下载 JSON 备份</Button>}
          <Button disabled={busy} tone="secondary" icon={<RefreshCw className="h-4 w-4"/>} onClick={()=>void run(async()=>{await initDataStore(true);onRefreshData();})}>{IS_PUBLIC_DEMO ? '重新读取演示快照' : '重新读取数据库'}</Button>
          {!IS_PUBLIC_DEMO && <Button disabled={busy || identity.isReadOnly} tone="danger" onClick={()=>void reset()}>备份并重置演示数据</Button>}
        </div>
      </section>
    </div>}
    {tab==='telegram' && <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
      <section className={panelClass}>
        <h2 className="font-semibold text-ink">业务员 → 经理 → 负责人</h2>
        <p className="mt-3 text-sm leading-7 text-muted">{IS_PUBLIC_DEMO
          ? '公网演示可生成虚构汇报预览，但不会连接 Telegram Bot，也不能向任何真实接收人发送消息。'
          : '先预览汇报，再手动确认发送。汇报与首页使用同一份本地经营数据。电脑关机后不会自动运行，也不会自动发送消息。'}</p>
        <div className="my-5 rounded-xl bg-surface-muted p-4 text-sm">
          <span className={telegram?.configured?'text-brand-emerald':'text-brand-amber'}>{telegram?.configured?'测试 Bot 已配置':'测试 Bot 尚未配置；仍可预览汇报'}</span>
          <p className="mt-2 text-xs leading-6 text-muted">{IS_PUBLIC_DEMO
            ? '实际发送仅保留在本地演示版，并需由项目维护者单独配置测试 Bot。公网共享账号永远不会获得 Bot 密钥或发送权限。'
            : <>在项目根目录的 <code>.env.local</code> 配置 <code>TELEGRAM_BOT_TOKEN</code>、<code>TELEGRAM_MANAGER_CHAT_ID</code> 和 <code>TELEGRAM_OWNER_CHAT_ID</code>，然后重启本地服务。密钥和接收人 ID 不会在页面显示或提交到 Git。</>}
          </p>
        </div>
        <label className="mb-2 block text-xs text-muted" htmlFor="report-period">汇报周期</label>
        <select id="report-period" value={mode} onChange={event=>{setMode(event.target.value);setReport('');}} className={`w-full ${inputClass}`}>
          <option value="current_month">本月截至今日</option><option value="previous_month">上一个完整月</option><option value="fiscal_year">本财年截至今日</option>
        </select>
        <label className="mb-2 mt-4 block text-xs text-muted" htmlFor="report-recipient">汇报对象</label>
        <select id="report-recipient" value={recipient} onChange={event=>{setRecipient(event.target.value as typeof recipient);setReport('');}} className={`w-full ${inputClass}`}>
          <option value="manager">销售经理</option><option value="owner">公司负责人</option>
        </select>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button disabled={busy} tone="secondary" onClick={()=>void preview()}>生成汇报预览</Button>
          <Button disabled={busy || !report || !telegram?.configured || !telegram.recipients?.[recipient]} icon={<Send className="h-4 w-4"/>} onClick={()=>void send()}>确认并发送</Button>
        </div>
      </section>
      <section className={panelClass}><h2 className="font-semibold text-ink">汇报预览</h2><pre className="mt-4 min-h-80 whitespace-pre-wrap break-words text-sm leading-7 text-body">{report || '选择周期和接收人，点击“生成汇报预览”。预览不会发送消息。'}</pre></section>
    </div>}
    {tab==='rates' && <section className={panelClass}>
      <h2 className="font-semibold text-ink">手工维护演示汇率</h2>
      <p className="my-3 text-sm text-muted">这些汇率只服务于演示计算，不是实时市场价格，不会联网自动同步。</p>
      {!identity.isReadOnly && <form onSubmit={event=>void saveRate(event)} className="my-5 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted">生效月份<input aria-label="汇率月份" type="month" required value={rateMonth} onChange={event=>setRateMonth(event.target.value)} className={inputClass}/></label>
        <label className="grid gap-1 text-xs text-muted">USD/CNY<input aria-label="汇率数值" type="number" min="0.0001" step="0.0001" required value={rateValue} onChange={event=>setRateValue(event.target.value)} className={inputClass}/></label>
        <Button type="submit" disabled={busy}>保存月度汇率</Button>
      </form>}
      <div className="max-h-[32rem] overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-surface-muted text-muted"><tr><th className="p-3">月份</th><th className="p-3">货币对</th><th className="p-3">演示汇率</th><th className="p-3">备注</th><th className="p-3">操作</th></tr></thead>
        <tbody>{rates.map(rate=><tr key={rate.id} className="border-b border-border"><td className="p-3">{rate.effective_month}</td><td className="p-3">{rate.currency_pair}</td><td className="p-3 font-semibold">{rate.rate.toFixed(4)}</td><td className="p-3 text-muted">{rate.notes || '虚构演示汇率'}</td><td className="p-3">{!identity.isReadOnly && <button aria-label={`删除 ${rate.effective_month} 汇率`} disabled={busy} onClick={()=>void deleteRate(rate.id,rate.effective_month)} className="text-brand-rose"><Trash2 className="h-4 w-4"/></button>}</td></tr>)}</tbody>
      </table></div>
    </section>}
  </div>;
};
