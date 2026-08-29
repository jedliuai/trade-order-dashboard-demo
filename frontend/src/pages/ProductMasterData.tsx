import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Edit2, PackageSearch, Plus, RotateCcw, Search, XCircle } from 'lucide-react';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { FormField } from '../components/FormField';
import { PageHeader } from '../components/PageHeader';
import { useFeedback } from '../components/FeedbackProvider';
import { ProductOrderManager } from '../components/ProductOrderManager';
import { DOSAGE_FORM_OPTIONS, isAllowedDosageForm } from '../services/formOptions';
import {
  createMasterProduct,
  addMasterProductVariant,
  loadMasterProducts,
  reviseMasterProductVariant,
  setMasterProductVariantStatus,
  updateMasterProduct,
  type MasterProduct,
  type ProductDraft,
  type ProductVariant,
  type ProductType
} from '../services/masterDataService';

const emptyDraft: ProductDraft = {
  product_type: '制剂',
  chinese_name: '',
  english_name: '',
  dosage_form: '',
  status: '启用',
  notes: '',
  aliases: [],
  specifications: []
};

const inputClass = 'w-full rounded-[10px] border border-border bg-surface px-3 py-2.5 text-sm text-ink outline-none transition focus:border-brand-cyan';

export function ProductMasterData() {
  const { notify, confirm } = useFeedback();
  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'全部' | ProductType>('全部');
  const [showForm, setShowForm] = useState(false);
  const [showOrderManager, setShowOrderManager] = useState(false);
  const [editing, setEditing] = useState<MasterProduct | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [aliasesText, setAliasesText] = useState('');
  const [specificationsText, setSpecificationsText] = useState('');
  const [newSpecification, setNewSpecification] = useState('');
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editingSpecification, setEditingSpecification] = useState('');
  const [variantBusy, setVariantBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    setIsLoading(true);
    setError('');
    try {
      const nextProducts = await loadMasterProducts();
      setProducts(nextProducts);
      return nextProducts;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const handleSessionChanged = () => { void refresh(); };
    window.addEventListener('demo-account-changed', handleSessionChanged);
    return () => window.removeEventListener('demo-account-changed', handleSessionChanged);
  }, []);

  const visibleProducts = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return products.filter((product) => {
      if (typeFilter !== '全部' && product.product_type !== typeFilter) return false;
      if (!keyword) return true;
      return [
        product.product_code,
        product.chinese_name,
        product.english_name,
        product.dosage_form,
        ...product.aliases.map((item) => item.alias),
        ...product.variants.map((item) => item.specification)
      ].some((value) => value?.toLowerCase().includes(keyword));
    });
  }, [products, query, typeFilter]);

  const openCreate = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setAliasesText('');
    setSpecificationsText('');
    setNewSpecification('');
    setEditingVariantId(null);
    setError('');
    setShowForm(true);
  };

  const openEdit = (product: MasterProduct) => {
    setEditing(product);
    setDraft({
      product_type: product.product_type,
      chinese_name: product.chinese_name,
      english_name: product.english_name || '',
      dosage_form: isAllowedDosageForm(product.dosage_form || '') ? product.dosage_form : '',
      status: product.status,
      notes: product.notes || '',
      aliases: product.aliases.map((item) => item.alias),
      specifications: product.variants.map((item) => item.specification).filter(Boolean)
    });
    setAliasesText(product.aliases.map((item) => item.alias).join('\n'));
    setSpecificationsText(product.variants.map((item) => item.specification).filter(Boolean).join('\n'));
    setNewSpecification('');
    setEditingVariantId(null);
    setError('');
    setShowForm(true);
  };

  const refreshEditingProduct = async (productId: string) => {
    const nextProducts = await refresh();
    const nextEditing = nextProducts?.find((product) => product.id === productId) || null;
    setEditing(nextEditing);
    return nextEditing;
  };

  const addSpecification = async () => {
    if (!editing || !newSpecification.trim()) return;
    setVariantBusy(true);
    setError('');
    try {
      await addMasterProductVariant(editing, newSpecification);
      setNewSpecification('');
      await refreshEditingProduct(editing.id);
      notify({ title: '规格已新增', message: '已自动清除多余空格并统一英文计量单位格式。', tone: 'success' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVariantBusy(false);
    }
  };

  const reviseSpecification = async (variant: ProductVariant) => {
    if (!editing || !editingSpecification.trim()) return;
    const approved = await confirm({
      title: '确认修正规格',
      message: `将“${variant.specification || '空规格'}”修正为“${editingSpecification.trim()}”。\n如果旧规格已被包装或物料数据引用，系统会保留旧记录、创建新规格并停用旧规格。`,
      confirmLabel: '确认修正',
      tone: 'warning'
    });
    if (!approved) return;
    setVariantBusy(true);
    setError('');
    try {
      const result = await reviseMasterProductVariant(editing, variant, editingSpecification);
      setEditingVariantId(null);
      setEditingSpecification('');
      await refreshEditingProduct(editing.id);
      notify({
        title: '规格已修正',
        message: result.preservedHistoricalVariant
          ? '旧规格已有业务引用，已保留为停用记录；正确规格已作为新记录启用。'
          : '旧规格没有业务引用，已安全原位修正。',
        tone: 'success'
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVariantBusy(false);
    }
  };

  const toggleSpecification = async (variant: ProductVariant) => {
    if (!editing) return;
    const nextStatus = variant.status === '启用' ? '停用' : '启用';
    const approved = await confirm({
      title: `确认${nextStatus}规格`,
      message: nextStatus === '停用'
        ? `停用“${variant.specification || '空规格'}”后，新建包装模板时不再提供该规格；已有历史引用保持不变。`
        : `重新启用“${variant.specification || '空规格'}”。如果已有等价的启用规格，系统会阻止操作。`,
      confirmLabel: `确认${nextStatus}`,
      tone: nextStatus === '停用' ? 'warning' : 'primary'
    });
    if (!approved) return;
    setVariantBusy(true);
    setError('');
    try {
      await setMasterProductVariantStatus(editing, variant, nextStatus);
      await refreshEditingProduct(editing.id);
      notify({ title: `规格已${nextStatus}`, message: '历史联系单和包装版本没有被修改。', tone: 'success' });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setVariantBusy(false);
    }
  };

  const saveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.chinese_name.trim()) {
      setError('产品中文名称不能为空。');
      return;
    }
    if (draft.dosage_form && !isAllowedDosageForm(draft.dosage_form)) {
      setError('剂型只能从下拉列表中的固定选项选择。');
      return;
    }
    const payload: ProductDraft = {
      ...draft,
      aliases: aliasesText.split(/[\n,，]/),
      specifications: editing ? [] : specificationsText.split(/[\n,，]/)
    };
    setIsSaving(true);
    setError('');
    try {
      if (editing) await updateMasterProduct(editing.id, payload, editing);
      else await createMasterProduct(payload);
      setShowForm(false);
      await refresh();
      notify({
        title: editing ? '产品主数据已更新' : '产品主数据已创建',
        message: editing ? '产品基本信息已经更新；规格由独立记录区维护。' : '名称、剂型、别名与规格已经写入共享 SQLite 主数据。',
        tone: 'success'
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="产品主数据"
        description="统一维护中英文正式名、剂型、业务别名与规格；联系单与包装模板共用同一套产品基础资料。"
        actions={<div className="flex gap-2"><Button tone="secondary" icon={<ArrowUpDown className="h-4 w-4" />} onClick={() => setShowOrderManager(true)}>调整展示顺序</Button><Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>新增产品</Button></div>}
      />

      <div className="grid gap-3 rounded-xl border border-brand-emerald/15 bg-brand-emerald/5 p-4 text-xs leading-5 text-muted md:grid-cols-2">
        <div><strong className="text-ink">统一入口：</strong>从现在起由个人订单驾驶舱维护产品主数据，其他系统只读展示。</div>
        <div><strong className="text-ink">产品与规格：</strong>产品是主记录，每个规格是该产品下的独立变体；新增规格不会覆盖旧记录。</div>
      </div>

      <div className="glass-panel flex flex-col gap-3 rounded-xl p-4 md:flex-row">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索产品编号、中英文名、剂型、别名或规格"
            className={`${inputClass} pl-9`}
          />
        </label>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as '全部' | ProductType)} className={`${inputClass} md:w-44`}>
          <option value="全部">全部类型</option>
          <option value="制剂">制剂</option>
          <option value="原料药">原料药</option>
        </select>
        <div className="flex items-center px-2 text-xs text-muted">显示 {visibleProducts.length} / {products.length} 个产品</div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-brand-rose/25 bg-brand-rose/8 px-4 py-3 text-xs text-brand-rose">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="grid grid-cols-[minmax(250px,1.65fr)_100px_120px_minmax(180px,1fr)_100px_60px] gap-4 border-b border-border bg-surface-muted px-5 py-3 text-[11px] font-semibold text-muted">
          <span>编号 / 产品</span><span>类型</span><span>剂型</span><span>规格（独立记录）</span><span>联系单</span><span className="text-right">操作</span>
        </div>
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted">正在读取共享产品主数据…</div>
        ) : visibleProducts.length ? visibleProducts.map((product) => (
          <div key={product.id} className="grid grid-cols-[minmax(250px,1.65fr)_100px_120px_minmax(180px,1fr)_100px_60px] gap-4 border-b border-border/70 px-5 py-4 text-sm last:border-b-0 hover:bg-surface-muted/45">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="rounded bg-brand-emerald/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-emerald">{product.product_code}</span>
                <strong className="truncate text-ink">{product.chinese_name}</strong>
              </div>
              <div className="mt-1 truncate text-[11px] text-muted">{product.english_name || '英文名暂未维护'}</div>
            </div>
            <div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${product.product_type === '制剂' ? 'bg-brand-amber/14 text-brand-amber' : 'bg-brand-blue/12 text-brand-blue'}`}>{product.product_type}</span></div>
            <div className="text-xs text-body">{product.dosage_form || '未填写'}</div>
            <div className="flex flex-wrap content-start gap-1.5">{product.variants.filter((item) => item.specification && item.status === '启用').slice(0, 5).map((item) => <span key={item.id} className="rounded border border-brand-blue/15 bg-brand-blue/5 px-2 py-0.5 text-[10px] text-brand-blue">{item.specification}</span>)}{product.variants.filter((item) => item.specification && item.status === '启用').length > 5 && <span className="text-[10px] text-subtle">+{product.variants.filter((item) => item.specification && item.status === '启用').length - 5}</span>}{!product.variants.some((item) => item.specification && item.status === '启用') && <span className="text-xs text-subtle">尚无启用规格</span>}</div>
            <div><strong className="text-ink">{product.contact_sheet_count}</strong><span className="ml-1 text-xs text-muted">张</span><div className="mt-1 text-[10px] text-subtle">{product.contact_row_count} 条记录</div></div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => openEdit(product)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted transition hover:border-brand-cyan/40 hover:text-brand-cyan" aria-label="编辑产品"><Edit2 className="h-4 w-4" /></button>
            </div>
          </div>
        )) : (
          <div className="flex flex-col items-center py-16 text-center text-sm text-muted"><PackageSearch className="mb-3 h-9 w-9 text-subtle" />没有匹配的产品主数据</div>
        )}
      </div>

      {showForm && (
        <Dialog ariaLabel={editing ? '编辑产品主数据' : '新增产品主数据'} onClose={() => !isSaving && setShowForm(false)}>
          <form onSubmit={saveProduct} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-surface shadow-2xl">
            <div className="border-b border-border px-6 py-5">
              <h3 className="font-heading text-lg font-bold text-ink">{editing ? `编辑产品 ${editing.product_code}` : '新增产品主数据'}</h3>
              <p className="mt-1 text-xs text-muted">产品名称可直接纠正；规格作为独立记录新增、修正或停用，历史引用不会被覆盖。</p>
            </div>
            <div className="space-y-4 p-6">
              <section className="grid gap-4 rounded-xl border border-border bg-surface-muted/30 p-4 md:grid-cols-2">
                <div className="md:col-span-2"><h4 className="text-sm font-bold text-ink">产品基本信息</h4><p className="mt-1 text-[11px] text-muted">名称、剂型和别名属于产品本身。</p></div>
              <FormField label="产品类型" required><select value={draft.product_type} onChange={(event) => setDraft({ ...draft, product_type: event.target.value as ProductType })} className={inputClass}><option value="制剂">制剂</option><option value="原料药">原料药</option></select></FormField>
              <FormField label="状态" required><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as '启用' | '停用' })} className={inputClass}><option value="启用">启用</option><option value="停用">停用</option></select></FormField>
              <FormField label="中文正式名" required><input value={draft.chinese_name} onChange={(event) => setDraft({ ...draft, chinese_name: event.target.value })} className={inputClass} /></FormField>
              <FormField label="英文正式名"><input value={draft.english_name} onChange={(event) => setDraft({ ...draft, english_name: event.target.value })} className={inputClass} /></FormField>
              <FormField label="剂型" hint="只能选择系统维护的标准剂型；不允许自由输入。">
                <select value={draft.dosage_form} onChange={(event) => setDraft({ ...draft, dosage_form: event.target.value })} className={inputClass}>
                  <option value="">请选择剂型</option>
                  {DOSAGE_FORM_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </FormField>
              <FormField label="业务别名" hint="一行一个；历史别名会继续保留"><textarea value={aliasesText} onChange={(event) => setAliasesText(event.target.value)} rows={4} className={inputClass} /></FormField>
              <FormField label="备注" className="md:col-span-2"><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={3} className={inputClass} /></FormField>
              </section>
              <section className="rounded-xl border border-brand-blue/20 bg-brand-blue/5 p-4">
                <h4 className="text-sm font-bold text-ink">所属规格（独立记录）</h4>
                <p className="mt-1 text-[11px] leading-5 text-muted">新增时自动规范格式；修正已被引用的规格时，旧记录会停用但不会删除，历史包装与联系单保持原样。</p>
                {!editing ? (
                  <FormField label="初始规格" hint="一行一个；例如 1g、4.5g、10mg/ml" className="mt-3"><textarea value={specificationsText} onChange={(event) => setSpecificationsText(event.target.value)} rows={5} className={inputClass} /></FormField>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="flex gap-2">
                      <input value={newSpecification} onChange={(event) => setNewSpecification(event.target.value)} placeholder="输入新规格，例如 1g" className={inputClass} disabled={variantBusy} />
                      <Button onClick={() => void addSpecification()} icon={<Plus className="h-4 w-4" />} disabled={variantBusy || !newSpecification.trim()}>新增规格</Button>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-brand-blue/15 bg-surface">
                      {editing.variants.filter((variant) => variant.specification).sort((left, right) => Number(right.status === '启用') - Number(left.status === '启用') || left.specification.localeCompare(right.specification)).map((variant) => (
                        <div key={variant.id} className="flex flex-col gap-2 border-b border-border/70 px-3 py-3 last:border-b-0 sm:flex-row sm:items-center">
                          {editingVariantId === variant.id ? (
                            <input value={editingSpecification} onChange={(event) => setEditingSpecification(event.target.value)} className={`${inputClass} min-w-0 flex-1`} disabled={variantBusy} autoFocus />
                          ) : (
                            <div className="min-w-0 flex-1"><strong className={variant.status === '启用' ? 'text-ink' : 'text-subtle line-through'}>{variant.specification}</strong><span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold ${variant.status === '启用' ? 'bg-brand-emerald/10 text-brand-emerald' : 'bg-surface-muted text-subtle'}`}>{variant.status}</span></div>
                          )}
                          <div className="flex shrink-0 gap-2">
                            {editingVariantId === variant.id ? <><Button size="sm" onClick={() => void reviseSpecification(variant)} disabled={variantBusy || !editingSpecification.trim()}>保存修正</Button><Button size="sm" tone="secondary" onClick={() => { setEditingVariantId(null); setEditingSpecification(''); }} disabled={variantBusy}>取消</Button></> : <><Button size="sm" tone="secondary" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => { setEditingVariantId(variant.id); setEditingSpecification(variant.specification); }}>修正</Button><Button size="sm" tone="secondary" icon={variant.status === '启用' ? <XCircle className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />} onClick={() => void toggleSpecification(variant)}>{variant.status === '启用' ? '停用' : '重新启用'}</Button></>}
                          </div>
                        </div>
                      ))}
                      {!editing.variants.some((variant) => variant.specification) && <div className="px-3 py-6 text-center text-xs text-muted">暂时没有规格，请在上方新增。</div>}
                    </div>
                  </div>
                )}
              </section>
              {error && <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/8 px-3 py-2 text-xs text-brand-rose">{error}</div>}
            </div>
            <div className="flex justify-end gap-3 border-t border-border px-6 py-4"><Button tone="secondary" onClick={() => setShowForm(false)} disabled={isSaving}>取消</Button><Button type="submit" disabled={isSaving}>{isSaving ? '保存中…' : '确认保存'}</Button></div>
          </form>
        </Dialog>
      )}
      {showOrderManager && <Dialog ariaLabel="调整产品展示顺序" onClose={() => setShowOrderManager(false)}><div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-surface shadow-2xl"><ProductOrderManager products={products} onSaved={async () => { await refresh(); }} /><div className="flex justify-end border-t border-border px-6 py-4"><Button onClick={async () => { await refresh(); setShowOrderManager(false); }}>完成</Button></div></div></Dialog>}
    </div>
  );
}
