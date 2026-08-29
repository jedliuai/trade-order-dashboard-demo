import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Box, Boxes, CheckCircle2, ClipboardCheck, Copy, Edit2, History, Link2, Plus, Ruler, Search, ShieldAlert } from 'lucide-react';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { FormField } from '../components/FormField';
import { PageHeader } from '../components/PageHeader';
import { SearchableCombobox } from '../components/SearchableCombobox';
import { useFeedback } from '../components/FeedbackProvider';
import {
  createPackagingProfile,
  createPackagingVersion,
  loadPackagingIssues,
  loadPackagingProfiles,
  loadPackagingVersions,
  loadMasterProducts,
  resolvePackagingIssue,
  type MasterProduct,
  type PackagingIssue,
  type PackagingProfile,
  type PackagingProfileDraft,
  type PackagingProfileVersion
} from '../services/masterDataService';
import { PACKAGING_QUANTITY_UNIT_OPTIONS, PACKING_METHOD_OPTIONS } from '../services/formOptions';
import {
  packagingConstraintField,
  validatePackagingOuterDimensions,
  type PackagingDimensionErrors,
  type PackagingOuterDimensionField
} from '../services/packagingValidation';

type Tab = 'profiles' | 'issues' | 'versions';

const inputClass = 'w-full rounded-[10px] border border-border-strong bg-surface px-3 py-2.5 text-sm font-medium text-ink shadow-sm outline-none transition focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const packagingInputClass = (invalid = false) => invalid
  ? `${inputClass} border-brand-rose bg-brand-rose/5 focus:border-brand-rose focus:ring-brand-rose/15`
  : inputClass;
const emptyDraft: PackagingProfileDraft = {
  product_name: '', material_no: '', specification: '', business_type: '制剂', workshop: '', packing_method: '机装', scope_type: 'general', is_active: true,
  change_reason: '首次录入', packaging_description: '', quantity_per_carton: 0, quantity_unit: '支/箱', units_per_box: null, boxes_per_carton: null,
  box_inner_length_mm: null, box_inner_width_mm: null, box_inner_height_mm: null,
  carton_inner_length_mm: null, carton_inner_width_mm: null, carton_inner_height_mm: null,
  carton_outer_length_mm: null, carton_outer_width_mm: null, carton_outer_height_mm: null, carton_gross_weight_kg: null,
  fill_ratio_override_reason: '', review_status: 'verified', review_note: ''
};

function numeric(value: string) { return value === '' ? null : Number(value); }
function numberText(value: number | null | undefined) { return value == null ? '' : String(value); }

function draftFromProfile(profile: PackagingProfile, mode: 'version' | 'copy'): PackagingProfileDraft {
  return {
    product_name: profile.product_name,
    material_no: mode === 'version' ? profile.material_no || '' : '',
    specification: profile.specification || '',
    business_type: profile.business_type || '制剂',
    workshop: profile.workshop || '',
    packing_method: profile.packing_method === '机装' ? '机装' : '非机装',
    scope_type: profile.scope_type || 'general',
    customer_id: profile.customer_id,
    customer_name: profile.customer_name || '',
    product_variant_id: profile.product_variant_id,
    is_active: mode === 'copy' ? true : profile.is_active,
    change_reason: mode === 'copy' ? `复制自 ${profile.packaging_code} V${profile.version_no}` : '',
    packaging_description: profile.packaging_description || '',
    quantity_per_carton: Number(profile.quantity_per_carton || 0),
    quantity_unit: PACKAGING_QUANTITY_UNIT_OPTIONS.some((option) => option.value === profile.quantity_unit) ? profile.quantity_unit : '支/箱',
    units_per_box: profile.units_per_box == null ? null : Number(profile.units_per_box),
    boxes_per_carton: profile.boxes_per_carton == null ? null : Number(profile.boxes_per_carton),
    box_inner_length_mm: profile.box_inner_length_mm == null ? null : Number(profile.box_inner_length_mm),
    box_inner_width_mm: profile.box_inner_width_mm == null ? null : Number(profile.box_inner_width_mm),
    box_inner_height_mm: profile.box_inner_height_mm == null ? null : Number(profile.box_inner_height_mm),
    carton_inner_length_mm: profile.carton_inner_length_mm == null ? null : Number(profile.carton_inner_length_mm),
    carton_inner_width_mm: profile.carton_inner_width_mm == null ? null : Number(profile.carton_inner_width_mm),
    carton_inner_height_mm: profile.carton_inner_height_mm == null ? null : Number(profile.carton_inner_height_mm),
    carton_outer_length_mm: profile.carton_outer_length_mm == null ? null : Number(profile.carton_outer_length_mm),
    carton_outer_width_mm: profile.carton_outer_width_mm == null ? null : Number(profile.carton_outer_width_mm),
    carton_outer_height_mm: profile.carton_outer_height_mm == null ? null : Number(profile.carton_outer_height_mm),
    carton_gross_weight_kg: mode === 'version' && profile.carton_gross_weight_kg != null ? Number(profile.carton_gross_weight_kg) : null,
    fill_ratio_override_reason: profile.fill_ratio_override_reason || '',
    review_status: profile.review_status || 'verified',
    review_note: ''
  };
}

function fillRatioOf(draft: PackagingProfileDraft) {
  const values = [
    draft.box_inner_length_mm, draft.box_inner_width_mm, draft.box_inner_height_mm,
    draft.carton_inner_length_mm, draft.carton_inner_width_mm, draft.carton_inner_height_mm,
    draft.boxes_per_carton
  ].map(Number);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const [boxL, boxW, boxH, cartonL, cartonW, cartonH, boxes] = values;
  return (cartonL * cartonW * cartonH) / (boxL * boxW * boxH * boxes);
}

export function PackagingMasterData() {
  const { confirm, notify } = useFeedback();
  const [profiles, setProfiles] = useState<PackagingProfile[]>([]);
  const [products, setProducts] = useState<MasterProduct[]>([]);
  const [issues, setIssues] = useState<PackagingIssue[]>([]);
  const [versions, setVersions] = useState<PackagingProfileVersion[]>([]);
  const [tab, setTab] = useState<Tab>('profiles');
  const [query, setQuery] = useState('');
  const [workshop, setWorkshop] = useState('全部');
  const [method, setMethod] = useState('全部');
  const [review, setReview] = useState('全部');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PackagingProfile | null>(null);
  const [copyingFrom, setCopyingFrom] = useState<PackagingProfile | null>(null);
  const [draft, setDraft] = useState<PackagingProfileDraft>(emptyDraft);
  const [selectedProfile, setSelectedProfile] = useState<PackagingProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [dimensionErrors, setDimensionErrors] = useState<PackagingDimensionErrors>({});
  const outerLengthRef = useRef<HTMLInputElement>(null);
  const outerWidthRef = useRef<HTMLInputElement>(null);
  const outerHeightRef = useRef<HTMLInputElement>(null);

  const dimensionRefs: Record<PackagingOuterDimensionField, RefObject<HTMLInputElement | null>> = {
    carton_outer_length_mm: outerLengthRef,
    carton_outer_width_mm: outerWidthRef,
    carton_outer_height_mm: outerHeightRef
  };

  const focusDimensionField = (field: PackagingOuterDimensionField) => {
    window.requestAnimationFrame(() => {
      const input = dimensionRefs[field].current;
      input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      input?.focus({ preventScroll: true });
    });
  };

  const updateOuterDimension = (field: PackagingOuterDimensionField, value: number | null) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setDimensionErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const clearDimensionError = (field: PackagingOuterDimensionField) => {
    setDimensionErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const refresh = async () => {
    setIsLoading(true); setError('');
    try {
      const [nextProducts, nextIssues] = await Promise.all([loadMasterProducts(), loadPackagingIssues()]);
      const nextProfiles = await loadPackagingProfiles(nextProducts);
      setProfiles(nextProfiles); setIssues(nextIssues); setProducts(nextProducts);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setIsLoading(false); }
  };
  useEffect(() => {
    void refresh();
    const handleSessionChanged = () => { void refresh(); };
    window.addEventListener('demo-account-changed', handleSessionChanged);
    return () => window.removeEventListener('demo-account-changed', handleSessionChanged);
  }, []);

  const workshops = useMemo(() => ['全部', ...new Set(profiles.map((item) => item.workshop).filter(Boolean))], [profiles]);
  const methods = useMemo(() => ['全部', ...new Set(profiles.map((item) => item.packing_method).filter(Boolean))], [profiles]);
  const visibleProfiles = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return profiles.filter((profile) => {
      if (workshop !== '全部' && profile.workshop !== workshop) return false;
      if (method !== '全部' && profile.packing_method !== method) return false;
      if (review !== '全部' && profile.review_status !== review) return false;
      if (!keyword) return true;
      return [profile.packaging_code, profile.product_name, profile.material_no, profile.specification, profile.packaging_description, profile.customer_name]
        .some((value) => value?.toLowerCase().includes(keyword));
    });
  }, [profiles, query, workshop, method, review]);

  const productVariantOptions = useMemo(() => products.filter((product) => product.status === '启用').flatMap((product) => product.variants.filter((variant) => variant.status === '启用').map((variant) => ({
    value: variant.id,
    label: `${product.product_code}｜${product.chinese_name}${variant.specification ? `｜${variant.specification}` : ''}`,
    description: `${product.product_type}｜${product.dosage_form || '未填剂型'}${product.english_name ? `｜${product.english_name}` : ''}`,
    searchText: [product.product_code, product.chinese_name, product.english_name, product.dosage_form, variant.specification, ...product.aliases.map((alias) => alias.alias)].join(' ')
  }))), [products]);

  const selectProductVariant = (variantId: string) => {
    const product = products.find((item) => item.variants.some((variant) => variant.id === variantId));
    const variant = product?.variants.find((item) => item.id === variantId);
    setDraft((current) => ({
      ...current,
      product_variant_id: variantId || null,
      product_name: product?.chinese_name || '',
      specification: variant?.specification || '',
      business_type: product?.product_type || '制剂'
    }));
  };

  const openCreate = () => { setEditing(null); setCopyingFrom(null); setDraft({ ...emptyDraft }); setDimensionErrors({}); setError(''); setShowForm(true); };
  const openVersion = (profile: PackagingProfile) => {
    setEditing(profile);
    setCopyingFrom(null);
    setDraft(draftFromProfile(profile, 'version'));
    setDimensionErrors({}); setError(''); setShowForm(true);
  };

  const openCopy = (profile: PackagingProfile) => {
    setEditing(null);
    setCopyingFrom(profile);
    setDraft(draftFromProfile(profile, 'copy'));
    setDimensionErrors({}); setError(''); setShowForm(true);
  };

  const showVersions = async (profile: PackagingProfile) => {
    setSelectedProfile(profile); setTab('versions'); setIsLoading(true); setError('');
    try { setVersions(await loadPackagingVersions(profile.profile_id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setIsLoading(false); }
  };

  const openVersionsTab = async () => {
    setSelectedProfile(null); setTab('versions'); setIsLoading(true); setError('');
    try { setVersions(await loadPackagingVersions()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setIsLoading(false); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.product_name.trim() || !draft.packaging_description.trim() || !(draft.quantity_per_carton > 0)) { setError('产品名称、包装描述和装箱量为必填项。'); return; }
    if (!PACKAGING_QUANTITY_UNIT_OPTIONS.some((option) => option.value === draft.quantity_unit)) { setError('装箱单位只能选择支、盒或瓶。'); return; }
    if (!PACKING_METHOD_OPTIONS.includes(draft.packing_method as (typeof PACKING_METHOD_OPTIONS)[number])) { setError('包装方式只能选择机装或非机装。'); return; }
    if (editing && !draft.change_reason.trim()) { setError('创建新版本时必须填写变更原因。'); return; }
    const nextDimensionErrors = validatePackagingOuterDimensions(draft);
    const firstInvalidDimension = Object.keys(nextDimensionErrors)[0] as PackagingOuterDimensionField | undefined;
    if (firstInvalidDimension) {
      setDimensionErrors(nextDimensionErrors);
      setError('请检查外箱尺寸：外箱外径不能小于对应的外箱内径。其他已填内容已经保留。');
      focusDimensionField(firstInvalidDimension);
      return;
    }
    setDimensionErrors({});
    const fillRatio = fillRatioOf(draft);
    if (fillRatio !== null && (fillRatio < 1.08 || fillRatio > 1.2) && !draft.fill_ratio_override_reason?.trim()) { setError('装箱填充比超出 1.08–1.20，请填写放行原因。'); return; }
    setIsSaving(true); setError('');
    try {
      if (editing) await createPackagingVersion(editing.profile_id, draft);
      else await createPackagingProfile(draft);
      setShowForm(false); await refresh();
      notify({
        title: editing ? '包装新版本已创建' : copyingFrom ? '包装副本已创建' : '包装模板已创建',
        message: editing
          ? `原 V${editing.version_no} 已保留，新版本成为当前版本。`
          : copyingFrom
            ? `已基于 ${copyingFrom.packaging_code} 创建独立模板 V1，系统已自动分配新的包装编号。`
            : '模板 V1 已写入共享包装主数据。',
        tone: 'success'
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      const constraintField = packagingConstraintField(message);
      if (constraintField) {
        const fallbackErrors = validatePackagingOuterDimensions(draft);
        setDimensionErrors({
          ...fallbackErrors,
          [constraintField]: fallbackErrors[constraintField] || '外箱外径不能小于对应的外箱内径，请核对这两个数值。'
        });
        setError('请检查外箱尺寸：外箱外径不能小于对应的外箱内径。其他已填内容已经保留。');
        focusDimensionField(constraintField);
      } else {
        setError(message);
      }
    }
    finally { setIsSaving(false); }
  };

  const resolveIssue = async (issue: PackagingIssue) => {
    const approved = await confirm({ title: '将这条数据问题标记为已处理？', message: issue.description, confirmLabel: '确认已处理' });
    if (!approved) return;
    try { await resolvePackagingIssue(issue.id, '已在个人订单驾驶舱核对处理'); await refresh(); notify({ title: '问题已处理', message: '待核对列表已经更新。', tone: 'success' }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  return <div className="space-y-5">
    <PageHeader title="包装主数据" description="维护共享包装参数、不可变版本轨迹与外箱尺寸；联系单选择后固定引用具体版本。" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={openCreate}>新增包装参数</Button>} />
    <div className="flex flex-wrap gap-2 border-b border-border">
      {([['profiles', '参数库'], ['issues', `待核对 (${issues.length})`], ['versions', '版本管理']] as [Tab, string][]).map(([value, label]) => <button key={value} type="button" onClick={() => value === 'versions' ? void openVersionsTab() : setTab(value)} className={`border-b-2 px-4 py-3 text-xs font-semibold transition ${tab === value ? 'border-brand-emerald text-brand-emerald' : 'border-transparent text-muted hover:text-ink'}`}>{label}</button>)}
    </div>
    {error && <div role="alert" className="rounded-xl border border-brand-rose/25 bg-brand-rose/8 px-4 py-3 text-xs text-brand-rose">{error}</div>}

    {tab === 'profiles' && <>
      <div className="glass-panel grid gap-3 rounded-xl p-4 md:grid-cols-[2fr_repeat(3,minmax(140px,1fr))]">
        <label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="包装编号、产品、物料号、规格或描述" className={`${inputClass} pl-9`} /></label>
        <select value={workshop} onChange={(event) => setWorkshop(event.target.value)} className={inputClass}>{workshops.map((value) => <option key={value}>{value === '全部' ? '全部车间' : value}</option>)}</select>
        <select value={method} onChange={(event) => setMethod(event.target.value)} className={inputClass}>{methods.map((value) => <option key={value}>{value === '全部' ? '全部包装方式' : value}</option>)}</select>
        <select value={review} onChange={(event) => setReview(event.target.value)} className={inputClass}><option value="全部">全部状态</option><option value="verified">已确认</option><option value="pending">待核对</option></select>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="grid grid-cols-[minmax(220px,1.45fr)_minmax(220px,1.6fr)_120px_180px_85px_210px] gap-4 border-b border-border bg-surface-muted px-5 py-3 text-[11px] font-semibold text-muted"><span>产品信息</span><span>包装描述</span><span>装箱量</span><span>外箱外径 (MM)</span><span>版本</span><span className="text-right">操作</span></div>
        {isLoading ? <div className="py-16 text-center text-sm text-muted">正在读取共享包装主数据…</div> : visibleProfiles.map((profile) => <div key={profile.profile_id} className="grid grid-cols-[minmax(220px,1.45fr)_minmax(220px,1.6fr)_120px_180px_85px_210px] gap-4 border-b border-border/70 px-5 py-4 text-sm last:border-0 hover:bg-surface-muted/45">
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded bg-brand-amber/12 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-amber">{profile.packaging_code}</span><strong className="truncate text-ink">{profile.product_name}</strong></div><div className="mt-1 text-[11px] text-muted">{profile.material_no || '无物料号'} · {profile.specification || '无规格'} · {profile.workshop || '未填车间'}</div></div>
          <div><div className="font-medium text-body">{profile.packaging_description || '未填写'}</div><div className="mt-1 text-[10px] text-subtle">{profile.packing_method || '未分类'} · {profile.scope_type === 'customer' ? `客户专用：${profile.customer_name}` : '通用'}</div></div>
          <div><strong className="text-ink">{Number(profile.quantity_per_carton).toLocaleString()}</strong><div className="text-[10px] text-muted">{profile.quantity_unit}</div></div>
          <div><strong className="text-ink">{profile.carton_outer_length_mm && profile.carton_outer_width_mm && profile.carton_outer_height_mm ? `${profile.carton_outer_length_mm} × ${profile.carton_outer_width_mm} × ${profile.carton_outer_height_mm}` : '待维护'}</strong><div className="mt-1 text-[10px] text-muted">{profile.carton_volume_m3 ? `${Number(profile.carton_volume_m3).toFixed(4)} m³` : ''}</div></div>
          <div><span className="rounded-full bg-brand-emerald/10 px-2 py-1 text-[10px] font-semibold text-brand-emerald">V{profile.version_no}</span><div className="mt-2 text-[10px] text-subtle">{profile.version_count} 个版本</div></div>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => void showVersions(profile)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted hover:text-brand-blue" aria-label="查看版本"><History className="h-4 w-4" /></button><Button tone="subtle" size="sm" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => openCopy(profile)}>复制</Button><Button tone="secondary" size="sm" icon={<Edit2 className="h-3.5 w-3.5" />} onClick={() => openVersion(profile)}>新版本</Button></div>
        </div>)}
      </div>
    </>}

    {tab === 'issues' && <div className="rounded-xl border border-border bg-surface p-5 shadow-sm"><div className="mb-4 flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-brand-amber" /><h3 className="font-heading font-bold text-ink">待核对数据</h3></div>{issues.length ? <div className="space-y-2">{issues.map((issue) => <div key={issue.id} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-muted/45 px-4 py-3"><div><div className="text-xs font-semibold text-ink">{issue.issue_type} · {issue.field_name}</div><div className="mt-1 text-xs text-muted">{issue.description}</div></div><Button size="sm" tone="subtle" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => void resolveIssue(issue)}>标记已处理</Button></div>)}</div> : <div className="py-12 text-center text-sm text-muted">没有待核对的包装数据。</div>}</div>}

    {tab === 'versions' && <div className="rounded-xl border border-border bg-surface p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-heading font-bold text-ink">{selectedProfile ? `${selectedProfile.packaging_code} 版本轨迹` : `全部版本记录（${versions.length}）`}</h3><p className="mt-1 text-xs text-muted">{selectedProfile ? '显示这套模板的完整不可变历史。' : '默认展示所有包装模板的版本；也可从参数库点击时钟，只查看单套模板。'}</p></div>{selectedProfile && <Button tone="secondary" size="sm" onClick={() => openVersion(selectedProfile)}>基于当前版创建新版本</Button>}</div>{isLoading ? <div className="py-12 text-center text-sm text-muted">正在读取版本记录…</div> : versions.length ? <div className="space-y-3">{versions.map((version) => { const profile = profiles.find((item) => item.profile_id === version.profile_id); return <div key={version.id} className={`rounded-xl border p-4 ${version.is_current ? 'border-brand-emerald/30 bg-brand-emerald/5' : 'border-border bg-surface-muted/35'}`}><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><strong className="text-ink">{profile?.packaging_code || '未知模板'} · V{version.version_no}</strong>{version.is_current && <span className="rounded-full bg-brand-emerald/12 px-2 py-0.5 text-[10px] font-semibold text-brand-emerald">当前版本</span>}</div><span className="text-[11px] text-muted">{new Date(version.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span></div><div className="mt-1 text-xs text-muted">{profile?.product_name || '未匹配产品'} · {profile?.specification || '无规格'} · {profile?.workshop || '未填车间'}</div><div className="mt-2 text-sm text-body">{version.packaging_description}</div><div className="mt-2 grid gap-2 text-xs text-muted md:grid-cols-3"><span>装箱量：{version.quantity_per_carton} {version.quantity_unit}</span><span>外箱：{version.carton_outer_length_mm || '-'} × {version.carton_outer_width_mm || '-'} × {version.carton_outer_height_mm || '-'} mm</span><span>变更原因：{version.change_reason || '未填写'}</span></div></div>; })}</div> : <div className="py-12 text-center text-sm text-muted">当前没有包装版本记录。</div>}</div>}

    {showForm && <Dialog ariaLabel={editing ? '创建包装新版本' : copyingFrom ? '复制包装参数' : '新增包装参数'} onClose={() => !isSaving && setShowForm(false)}>
      <form onSubmit={save} className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-surface shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-border bg-surface/95 px-6 py-5 backdrop-blur">
          <h3 className="font-heading text-xl font-bold text-ink">{editing ? `基于 ${editing.packaging_code} V${editing.version_no} 创建新版本` : copyingFrom ? `复制 ${copyingFrom.packaging_code} 为新包装参数` : '新增包装参数'}</h3>
          <p className="mt-1 text-sm font-medium text-body">按“关联对象 → 装箱参数 → 尺寸 → 核对”分区填写；已保存版本永不覆盖。</p>
        </div>
        <div className="space-y-5 bg-surface-muted/20 p-5 sm:p-6 [&_label]:font-semibold [&_label]:text-body">
          {error && <div role="alert" className="rounded-xl border border-brand-rose/30 bg-brand-rose/8 px-4 py-3 text-sm font-semibold text-brand-rose">{error}</div>}
          {copyingFrom && <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan/8 px-4 py-3 text-sm font-medium text-body"><strong className="text-brand-cyan">正在创建独立副本：</strong>保存后由数据库自动分配新的包装编号，并从 V1 开始；原编号 {copyingFrom.packaging_code} 及其版本记录不会改变。</div>}
          <section className="rounded-2xl border border-brand-blue/25 bg-brand-blue/5 p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3"><div className="rounded-xl bg-brand-blue/12 p-2 text-brand-blue"><Link2 className="h-5 w-5" /></div><div><h4 className="text-base font-bold text-ink">1. 关联产品与包装方式</h4><p className="mt-1 text-xs font-medium leading-5 text-body">物料号已从维护入口移除；关联产品后自动带入名称和规格。</p></div></div>
            <div className="grid gap-4 md:grid-cols-3">
              <FormField label="关联参考产品及规格（可选）" className="md:col-span-3" hint="通用包装允许不绑定具体产品"><SearchableCombobox value={draft.product_variant_id || ''} onChange={selectProductVariant} options={productVariantOptions} ariaLabel="选择关联参考产品及规格" placeholder="可选择产品，也可填写通用方案名称" searchPlaceholder="搜索产品、别名、剂型或规格" emptyMessage="没有匹配产品，请先到产品主数据新增" /></FormField>
              <FormField label="产品或方案名称" required className="md:col-span-2"><input value={draft.product_name} onChange={(event) => setDraft({ ...draft, product_name: event.target.value })} className={inputClass} /></FormField>
              <FormField label="规格"><input value={draft.specification} onChange={(event) => setDraft({ ...draft, specification: event.target.value })} className={inputClass} /></FormField>
              <FormField label="车间"><input value={draft.workshop} onChange={(event) => setDraft({ ...draft, workshop: event.target.value })} className={inputClass} /></FormField>
              <FormField label="包装方式" required><select value={draft.packing_method} onChange={(event) => setDraft({ ...draft, packing_method: event.target.value })} className={inputClass}>{PACKING_METHOD_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></FormField>
            </div>
          </section>

          <section className="rounded-2xl border border-brand-amber/30 bg-brand-amber/5 p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3"><div className="rounded-xl bg-brand-amber/14 p-2 text-brand-amber"><Boxes className="h-5 w-5" /></div><div><h4 className="text-base font-bold text-ink">2. 包装描述与装箱参数</h4><p className="mt-1 text-xs font-medium leading-5 text-body">先确认包装描述，再填写每箱装量；装箱单位只提供支、盒、瓶。</p></div></div>
            <div className="grid gap-4 md:grid-cols-4">
              <FormField label="包装描述" required className="md:col-span-4"><textarea value={draft.packaging_description} onChange={(event) => setDraft({ ...draft, packaging_description: event.target.value })} rows={3} className={inputClass} /></FormField>
              <FormField label="装箱量" required><input type="number" min="0" step="any" value={draft.quantity_per_carton || ''} onChange={(event) => setDraft({ ...draft, quantity_per_carton: Number(event.target.value) })} className={inputClass} /></FormField>
              <FormField label="装箱单位" required><select value={draft.quantity_unit} onChange={(event) => setDraft({ ...draft, quantity_unit: event.target.value })} className={inputClass}>{PACKAGING_QUANTITY_UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FormField>
              <FormField label="每盒最小单位数"><input type="number" min="0" step="any" value={numberText(draft.units_per_box)} onChange={(event) => setDraft({ ...draft, units_per_box: numeric(event.target.value) })} className={inputClass} /></FormField>
              <FormField label="盒数 / 箱"><input type="number" min="0" step="any" value={numberText(draft.boxes_per_carton)} onChange={(event) => setDraft({ ...draft, boxes_per_carton: numeric(event.target.value) })} className={inputClass} /></FormField>
              <div className="md:col-span-4 rounded-xl border border-brand-amber/25 bg-surface px-4 py-3 text-sm font-medium text-body"><strong className="text-ink">装箱填充比：</strong>{fillRatioOf(draft)?.toFixed(4) || '尺寸或盒/箱尚未完整'}<span className="ml-2 text-xs text-muted">正常范围 1.08–1.20，超出范围需填写放行原因。</span></div>
            </div>
          </section>

          <section className="rounded-2xl border border-brand-emerald/25 bg-brand-emerald/5 p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3"><div className="rounded-xl bg-brand-emerald/12 p-2 text-brand-emerald"><Ruler className="h-5 w-5" /></div><div><h4 className="text-base font-bold text-ink">3. 尺寸参数（mm）</h4><p className="mt-1 text-xs font-medium leading-5 text-body">外箱外径直接影响总体积，已单独强化展示，请优先核对。</p></div></div>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-xl border border-border-strong bg-surface p-4"><h5 className="mb-3 text-sm font-bold text-ink">小盒内径</h5><div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1"><FormField label="长"><input type="number" min="0" step="any" value={numberText(draft.box_inner_length_mm)} onChange={(event) => setDraft({ ...draft, box_inner_length_mm: numeric(event.target.value) })} className={inputClass} /></FormField><FormField label="宽"><input type="number" min="0" step="any" value={numberText(draft.box_inner_width_mm)} onChange={(event) => setDraft({ ...draft, box_inner_width_mm: numeric(event.target.value) })} className={inputClass} /></FormField><FormField label="高"><input type="number" min="0" step="any" value={numberText(draft.box_inner_height_mm)} onChange={(event) => setDraft({ ...draft, box_inner_height_mm: numeric(event.target.value) })} className={inputClass} /></FormField></div></div>
              <div className="rounded-xl border border-border-strong bg-surface p-4">
                <h5 className="mb-3 text-sm font-bold text-ink">外箱内径</h5>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <FormField label="长"><input type="number" min="0" step="any" value={numberText(draft.carton_inner_length_mm)} onChange={(event) => { setDraft({ ...draft, carton_inner_length_mm: numeric(event.target.value) }); clearDimensionError('carton_outer_length_mm'); }} className={inputClass} /></FormField>
                  <FormField label="宽"><input type="number" min="0" step="any" value={numberText(draft.carton_inner_width_mm)} onChange={(event) => { setDraft({ ...draft, carton_inner_width_mm: numeric(event.target.value) }); clearDimensionError('carton_outer_width_mm'); }} className={inputClass} /></FormField>
                  <FormField label="高"><input type="number" min="0" step="any" value={numberText(draft.carton_inner_height_mm)} onChange={(event) => { setDraft({ ...draft, carton_inner_height_mm: numeric(event.target.value) }); clearDimensionError('carton_outer_height_mm'); }} className={inputClass} /></FormField>
                </div>
              </div>
              <div className="rounded-xl border-2 border-brand-emerald/45 bg-brand-emerald/8 p-4 shadow-sm">
                <h5 className="mb-1 text-sm font-bold text-brand-emerald">外箱外径（重点）</h5>
                <p className="mb-3 text-[11px] font-medium text-body">用于计算货物总体积</p>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <FormField label="长" htmlFor="packaging-carton-outer-length" error={dimensionErrors.carton_outer_length_mm}>
                    <input ref={outerLengthRef} id="packaging-carton-outer-length" type="number" min="0" step="any" value={numberText(draft.carton_outer_length_mm)} onChange={(event) => updateOuterDimension('carton_outer_length_mm', numeric(event.target.value))} aria-invalid={Boolean(dimensionErrors.carton_outer_length_mm) || undefined} className={packagingInputClass(Boolean(dimensionErrors.carton_outer_length_mm))} />
                  </FormField>
                  <FormField label="宽" htmlFor="packaging-carton-outer-width" error={dimensionErrors.carton_outer_width_mm}>
                    <input ref={outerWidthRef} id="packaging-carton-outer-width" type="number" min="0" step="any" value={numberText(draft.carton_outer_width_mm)} onChange={(event) => updateOuterDimension('carton_outer_width_mm', numeric(event.target.value))} aria-invalid={Boolean(dimensionErrors.carton_outer_width_mm) || undefined} className={packagingInputClass(Boolean(dimensionErrors.carton_outer_width_mm))} />
                  </FormField>
                  <FormField label="高" htmlFor="packaging-carton-outer-height" error={dimensionErrors.carton_outer_height_mm}>
                    <input ref={outerHeightRef} id="packaging-carton-outer-height" type="number" min="0" step="any" value={numberText(draft.carton_outer_height_mm)} onChange={(event) => updateOuterDimension('carton_outer_height_mm', numeric(event.target.value))} aria-invalid={Boolean(dimensionErrors.carton_outer_height_mm) || undefined} className={packagingInputClass(Boolean(dimensionErrors.carton_outer_height_mm))} />
                  </FormField>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-brand-purple/25 bg-brand-purple/5 p-4 sm:p-5">
            <div className="mb-4 flex items-start gap-3"><div className="rounded-xl bg-brand-purple/12 p-2 text-brand-purple"><ClipboardCheck className="h-5 w-5" /></div><div><h4 className="text-base font-bold text-ink">4. 核对与版本说明</h4><p className="mt-1 text-xs font-medium leading-5 text-body">毛重不再在包装模板维护；如有毛重，请在新增联系单时填写。</p></div></div>
            <div className="grid gap-4 md:grid-cols-3">
              <FormField label="核对状态"><select value={draft.review_status} onChange={(event) => setDraft({ ...draft, review_status: event.target.value })} className={inputClass}><option value="verified">已确认</option><option value="pending">待核对</option><option value="conflict">有冲突</option><option value="incomplete">不完整</option></select></FormField>
              <FormField label="变更原因" required={Boolean(editing)} className="md:col-span-2"><input value={draft.change_reason} onChange={(event) => setDraft({ ...draft, change_reason: event.target.value })} className={inputClass} /></FormField>
              <FormField label="填充比超范围放行原因" className="md:col-span-3"><textarea value={draft.fill_ratio_override_reason || ''} onChange={(event) => setDraft({ ...draft, fill_ratio_override_reason: event.target.value })} rows={2} className={inputClass} /></FormField>
            </div>
          </section>
        </div>
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-border bg-surface/95 px-6 py-4 backdrop-blur"><Button tone="secondary" onClick={() => setShowForm(false)} disabled={isSaving}>取消</Button><Button type="submit" icon={<Box className="h-4 w-4" />} disabled={isSaving}>{isSaving ? '保存中…' : editing ? '创建新版本' : copyingFrom ? '创建新编号' : '创建 V1'}</Button></div>
      </form>
    </Dialog>}
  </div>;
}
