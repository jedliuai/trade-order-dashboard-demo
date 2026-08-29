import { getLocalSession, localRest } from './localClient';
import { masterSpecificationKey, normalizeMasterSpecification } from './masterSpecification';
import { isAllowedDosageForm, isAllowedPackingMethod, isAllowedPackagingQuantityUnit } from './formOptions';

export type ProductType = '制剂' | '原料药';
export type MasterDataStatus = '启用' | '停用';

type ProductTypeCode = 'finished_product' | 'raw_material';
type MasterDataStatusCode = 'active' | 'inactive';

export interface ProductAlias {
  id: string;
  alias: string;
  alias_kind: string;
  created_at?: string;
}

export interface ProductVariant {
  id: string;
  specification: string;
  dosage_form_override?: string;
  status: MasterDataStatus;
  created_at?: string;
  updated_at?: string;
}

export interface ProductVariantRevisionResult {
  variantId: string;
  preservedHistoricalVariant: boolean;
}

export interface MasterProduct {
  id: string;
  product_code: string;
  product_type: ProductType;
  chinese_name: string;
  english_name: string;
  dosage_form: string;
  status: MasterDataStatus;
  notes: string;
  is_pinned: boolean;
  manual_sort_order: number | null;
  contact_sheet_count: number;
  contact_row_count: number;
  created_at: string;
  updated_at: string;
  aliases: ProductAlias[];
  variants: ProductVariant[];
}

export interface ProductDraft {
  product_type: ProductType;
  chinese_name: string;
  english_name: string;
  dosage_form: string;
  status: MasterDataStatus;
  notes: string;
  aliases: string[];
  specifications: string[];
}

type MasterProductRow = Omit<MasterProduct, 'product_type' | 'status' | 'variants'> & {
  product_type: ProductType | ProductTypeCode;
  status: MasterDataStatus | MasterDataStatusCode;
  variants: Array<Omit<ProductVariant, 'status'> & { status: MasterDataStatus | MasterDataStatusCode }>;
};

export interface PackagingProfileVersion {
  id: string;
  profile_id: string;
  version_no: number;
  is_current: boolean;
  effective_from: string | null;
  effective_to: string | null;
  change_reason: string;
  packaging_description: string;
  quantity_per_carton: number;
  quantity_unit: string;
  units_per_box: number | null;
  derived_base_units_per_carton: number | null;
  boxes_per_carton: number | null;
  carton_outer_length_mm: number | null;
  carton_outer_width_mm: number | null;
  carton_outer_height_mm: number | null;
  carton_gross_weight_kg: number | null;
  carton_volume_m3: number | null;
  review_status: string;
  source_type: string;
  created_at: string;
  created_by: string;
}

export interface PackagingProfile {
  profile_id: string;
  packaging_code: string;
  product_name: string;
  material_no: string;
  specification: string;
  business_type: string;
  workshop: string;
  packing_method: string;
  scope_type: string;
  customer_id: string | null;
  customer_name: string;
  is_active: boolean;
  product_variant_id: string | null;
  updated_at: string;
  version_id: string;
  version_no: number;
  packaging_description: string;
  quantity_per_carton: number;
  quantity_unit: string;
  units_per_box: number | null;
  derived_base_units_per_carton: number | null;
  boxes_per_carton: number | null;
  box_inner_length_mm: number | null;
  box_inner_width_mm: number | null;
  box_inner_height_mm: number | null;
  carton_inner_length_mm: number | null;
  carton_inner_width_mm: number | null;
  carton_inner_height_mm: number | null;
  carton_outer_length_mm: number | null;
  carton_outer_width_mm: number | null;
  carton_outer_height_mm: number | null;
  carton_gross_weight_kg: number | null;
  carton_volume_m3: number | null;
  fill_ratio: number | null;
  fill_ratio_status: string | null;
  fill_ratio_override_reason: string | null;
  review_status: string;
  version_created_at: string;
  version_count: number;
  open_issue_count: number;
  product_search_text?: string;
}

export interface PackagingProfileDraft {
  product_name: string;
  material_no: string;
  specification: string;
  business_type: string;
  workshop: string;
  packing_method: string;
  scope_type: string;
  customer_id?: string | null;
  customer_name?: string;
  product_variant_id?: string | null;
  is_active: boolean;
  change_reason: string;
  packaging_description: string;
  quantity_per_carton: number;
  quantity_unit: string;
  units_per_box?: number | null;
  boxes_per_carton?: number | null;
  box_inner_length_mm?: number | null;
  box_inner_width_mm?: number | null;
  box_inner_height_mm?: number | null;
  carton_inner_length_mm?: number | null;
  carton_inner_width_mm?: number | null;
  carton_inner_height_mm?: number | null;
  carton_outer_length_mm?: number | null;
  carton_outer_width_mm?: number | null;
  carton_outer_height_mm?: number | null;
  carton_gross_weight_kg?: number | null;
  fill_ratio_override_reason?: string;
  review_status: string;
  review_note?: string;
}

export interface PackagingIssue {
  id: string;
  version_id: string;
  issue_type: string;
  field_name: string;
  description: string;
  status: string;
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

function currentUserId() {
  const userId = getLocalSession()?.user?.id;
  if (!userId) throw new Error('请先登录后再维护主数据。');
  return userId;
}

function uniqueLines(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueSpecifications(values: string[]) {
  const byKey = new Map<string, string>();
  values.forEach((value) => {
    const normalized = normalizeMasterSpecification(value);
    const key = masterSpecificationKey(normalized);
    if (key && !byKey.has(key)) byKey.set(key, normalized);
  });
  return [...byKey.values()];
}

function productTypeToCode(value: ProductType): ProductTypeCode {
  return value === '原料药' ? 'raw_material' : 'finished_product';
}

function productTypeFromCode(value: ProductType | ProductTypeCode): ProductType {
  return value === 'raw_material' || value === '原料药' ? '原料药' : '制剂';
}

function statusToCode(value: MasterDataStatus): MasterDataStatusCode {
  return value === '停用' ? 'inactive' : 'active';
}

function statusFromCode(value: MasterDataStatus | MasterDataStatusCode): MasterDataStatus {
  return value === 'inactive' || value === '停用' ? '停用' : '启用';
}

function unwrapOne<T>(rows: T[] | T): T {
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function loadMasterProducts(): Promise<MasterProduct[]> {
  const rows = await localRest<MasterProductRow[]>(
    'mdc_products?select=*,aliases:mdc_product_aliases(id,alias,alias_kind,created_at),variants:mdc_product_variants(id,specification,dosage_form_override,status,created_at,updated_at)'
  );
  return rows
    .map((row) => ({
      ...row,
      product_type: productTypeFromCode(row.product_type),
      status: statusFromCode(row.status),
      aliases: row.aliases || [],
      variants: (row.variants || []).map((variant) => ({
        ...variant,
        status: statusFromCode(variant.status as MasterDataStatus | MasterDataStatusCode)
      }))
    }))
    .sort((left, right) => {
      const leftOrder = left.manual_sort_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.manual_sort_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
      if (left.contact_sheet_count !== right.contact_sheet_count) return right.contact_sheet_count - left.contact_sheet_count;
      return left.chinese_name.localeCompare(right.chinese_name, 'zh-CN');
    });
}

export async function createMasterProduct(draft: ProductDraft): Promise<MasterProduct> {
  if (draft.dosage_form && !isAllowedDosageForm(draft.dosage_form)) {
    throw new Error('剂型只能从标准剂型列表中选择。');
  }
  const userId = currentUserId();
  const createdRows = await localRest<MasterProduct[]>('mdc_products', {
    method: 'POST',
    body: JSON.stringify({
      product_type: productTypeToCode(draft.product_type),
      chinese_name: draft.chinese_name.trim(),
      english_name: draft.english_name.trim() || null,
      dosage_form: draft.dosage_form.trim() || null,
      status: statusToCode(draft.status),
      source: 'manual',
      notes: draft.notes.trim(),
      created_by: userId,
      updated_by: userId
    })
  });
  const product = unwrapOne(createdRows);
  try {
    const aliases = uniqueLines(draft.aliases);
    if (aliases.length) {
      await localRest('mdc_product_aliases', {
        method: 'POST',
        body: JSON.stringify(aliases.map((alias_name) => ({
          product_id: product.id,
          alias: alias_name,
          alias_kind: 'trade',
          language: 'zh',
          created_by: userId
        })))
      });
    }
    const specifications = uniqueSpecifications(draft.specifications);
    await localRest('mdc_product_variants', {
      method: 'POST',
      body: JSON.stringify((specifications.length ? specifications : ['']).map((specification) => ({
        product_id: product.id,
        specification,
        dosage_form_override: draft.dosage_form.trim() || null,
        status: 'active',
        created_by: userId,
        updated_by: userId
      })))
    });
  } catch (error) {
    await localRest(`mdc_products?id=eq.${product.id}`, { method: 'DELETE' }).catch(() => undefined);
    throw error;
  }
  return product;
}

export async function updateMasterProduct(id: string, draft: ProductDraft, existing: MasterProduct) {
  if (draft.dosage_form && !isAllowedDosageForm(draft.dosage_form)) {
    throw new Error('剂型只能从标准剂型列表中选择。');
  }
  const userId = currentUserId();
  await localRest(`mdc_products?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      product_type: productTypeToCode(draft.product_type),
      chinese_name: draft.chinese_name.trim(),
      english_name: draft.english_name.trim() || null,
      dosage_form: draft.dosage_form.trim() || null,
      status: statusToCode(draft.status),
      notes: draft.notes.trim(),
      updated_by: userId
    })
  });

  const existingAliases = new Set(existing.aliases.map((item) => item.alias.trim().toLowerCase()));
  const newAliases = uniqueLines(draft.aliases).filter((value) => !existingAliases.has(value.toLowerCase()));
  if (newAliases.length) {
    await localRest('mdc_product_aliases', {
      method: 'POST',
      body: JSON.stringify(newAliases.map((alias_name) => ({
        product_id: id,
        alias: alias_name,
        alias_kind: 'trade',
        language: 'zh',
        created_by: userId
      })))
    });
  }

}

function assertUniqueActiveSpecification(product: MasterProduct, specification: string, excludeVariantId?: string) {
  const key = masterSpecificationKey(specification);
  if (!key) throw new Error('规格不能为空。');
  const duplicate = product.variants.find((variant) => (
    variant.id !== excludeVariantId
    && variant.status === '启用'
    && masterSpecificationKey(variant.specification) === key
  ));
  if (duplicate) throw new Error(`规格“${normalizeMasterSpecification(specification)}”已经存在，无需重复新增。`);
}

export async function addMasterProductVariant(product: MasterProduct, specification: string): Promise<void> {
  const normalized = normalizeMasterSpecification(specification);
  assertUniqueActiveSpecification(product, normalized);
  const userId = currentUserId();
  await localRest('mdc_product_variants', {
    method: 'POST',
    body: JSON.stringify({
      product_id: product.id,
      specification: normalized,
      dosage_form_override: product.dosage_form.trim() || null,
      status: 'active',
      created_by: userId,
      updated_by: userId
    })
  });
}

export async function reviseMasterProductVariant(
  product: MasterProduct,
  variant: ProductVariant,
  specification: string
): Promise<ProductVariantRevisionResult> {
  const normalized = normalizeMasterSpecification(specification);
  assertUniqueActiveSpecification(product, normalized, variant.id);
  const result = await localRest<Array<{ variant_id: string; preserved_historical_variant: boolean }> | { variant_id: string; preserved_historical_variant: boolean }>(
    'rpc/revise_mdc_product_variant',
    {
      method: 'POST',
      body: JSON.stringify({ target_variant_id: variant.id, replacement_specification: normalized })
    }
  );
  const row = unwrapOne(result);
  return { variantId: row.variant_id, preservedHistoricalVariant: row.preserved_historical_variant };
}

export async function setMasterProductVariantStatus(
  product: MasterProduct,
  variant: ProductVariant,
  nextStatus: MasterDataStatus
): Promise<void> {
  if (nextStatus === '启用') assertUniqueActiveSpecification(product, variant.specification, variant.id);
  await localRest('rpc/set_mdc_product_variant_status', {
    method: 'POST',
    body: JSON.stringify({ target_variant_id: variant.id, next_status: statusToCode(nextStatus) })
  });
}

export async function toggleProductPinned(product: MasterProduct) {
  await localRest(`mdc_products?id=eq.${product.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_pinned: !product.is_pinned, updated_by: currentUserId() })
  });
}

export async function saveMasterProductDisplayOrder(productIds: string[]) {
  await localRest('rpc/set_mdc_product_display_order', {
    method: 'POST',
    body: JSON.stringify({ product_ids: productIds })
  });
}

export async function resetMasterProductDisplayOrder() {
  await saveMasterProductDisplayOrder([]);
}

export async function loadPackagingProfiles(prefetchedProducts?: MasterProduct[]): Promise<PackagingProfile[]> {
  const [rows, products] = await Promise.all([
    localRest<PackagingProfile[]>('packaging_current_profiles?select=*'),
    prefetchedProducts ? Promise.resolve(prefetchedProducts) : loadMasterProducts()
  ]);
  const productByVariantId = new Map(products.flatMap((product) => product.variants.map((variant) => [variant.id, product] as const)));
  return rows.map((row) => {
    const product = row.product_variant_id ? productByVariantId.get(row.product_variant_id) : undefined;
    return {
      ...row,
      product_search_text: product
        ? [product.product_code, product.chinese_name, product.english_name, product.dosage_form, ...product.aliases.map((alias) => alias.alias)].join(' ')
        : ''
    };
  }).sort((left, right) => {
    if (left.is_active !== right.is_active) return left.is_active ? -1 : 1;
    return left.packaging_code.localeCompare(right.packaging_code, 'zh-CN');
  });
}

export async function loadPackagingVersions(profileId?: string): Promise<PackagingProfileVersion[]> {
  const filter = profileId ? `&profile_id=eq.${profileId}` : '';
  const rows = await localRest<PackagingProfileVersion[]>(
    `packaging_profile_versions?select=*${filter}&order=created_at.desc,version_no.desc`
  );
  return rows;
}

export async function loadPackagingIssues(): Promise<PackagingIssue[]> {
  return localRest<PackagingIssue[]>('packaging_data_issues?select=*&status=eq.open&order=created_at.desc');
}

function splitPackagingDraft(draft: PackagingProfileDraft) {
  if (!isAllowedPackagingQuantityUnit(draft.quantity_unit)) {
    throw new Error('装箱单位只能选择支、盒或瓶。');
  }
  if (!isAllowedPackingMethod(draft.packing_method)) {
    throw new Error('包装方式只能选择机装或非机装。');
  }
  const userId = currentUserId();
  const derivedBaseUnits = draft.quantity_unit === '盒/箱' && draft.units_per_box
    ? draft.quantity_per_carton * draft.units_per_box
    : null;
  return {
    profile_data: {
      product_name: draft.product_name.trim(),
      material_no: draft.material_no.trim(),
      specification: draft.specification.trim(),
      business_type: draft.business_type,
      workshop: draft.workshop.trim(),
      packing_method: draft.packing_method.trim(),
      scope_type: draft.scope_type,
      customer_id: draft.customer_id || null,
      customer_name: draft.customer_name?.trim() || null,
      product_variant_id: draft.product_variant_id || null,
      is_active: draft.is_active,
      updated_by: userId
    },
    version_data: {
      change_reason: draft.change_reason.trim(),
      packaging_description: draft.packaging_description.trim(),
      quantity_per_carton: draft.quantity_per_carton,
      quantity_unit: draft.quantity_unit,
      units_per_box: draft.units_per_box || null,
      boxes_per_carton: draft.boxes_per_carton || null,
      derived_base_units_per_carton: derivedBaseUnits,
      box_inner_length_mm: draft.box_inner_length_mm || null,
      box_inner_width_mm: draft.box_inner_width_mm || null,
      box_inner_height_mm: draft.box_inner_height_mm || null,
      carton_inner_length_mm: draft.carton_inner_length_mm || null,
      carton_inner_width_mm: draft.carton_inner_width_mm || null,
      carton_inner_height_mm: draft.carton_inner_height_mm || null,
      carton_outer_length_mm: draft.carton_outer_length_mm || null,
      carton_outer_width_mm: draft.carton_outer_width_mm || null,
      carton_outer_height_mm: draft.carton_outer_height_mm || null,
      carton_gross_weight_kg: draft.carton_gross_weight_kg || null,
      fill_ratio_override_reason: draft.fill_ratio_override_reason?.trim() || null,
      review_status: draft.review_status,
      source_type: 'manual',
      created_by: userId
    }
  };
}

export async function createPackagingProfile(draft: PackagingProfileDraft) {
  const payload = splitPackagingDraft(draft);
  return localRest<string>('rpc/create_packaging_profile_with_version', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function createPackagingVersion(profileId: string, draft: PackagingProfileDraft) {
  const payload = splitPackagingDraft(draft);
  return localRest<string>('rpc/create_packaging_version', {
    method: 'POST',
    body: JSON.stringify({ target_profile_id: profileId, ...payload })
  });
}

export async function resolvePackagingIssue(issueId: string, resolutionNote: string) {
  return localRest('rpc/resolve_packaging_issue', {
    method: 'POST',
    body: JSON.stringify({
      target_issue_id: issueId,
      note: resolutionNote.trim()
    })
  });
}
