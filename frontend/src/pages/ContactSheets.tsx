import React, { useState, useMemo, useEffect } from 'react';
import { db } from '../services/dataStore';
import type { ContactSheet, ContactSheetChangeHistory } from '../services/dataStore';
import { calculateExpiryDate, isQaComplete, parseBatchAllocations } from '../services/businessRules';
import { resolveContactSheetNavigationTarget } from '../services/contactSheetNavigation';
import { resolveContactSheetStage } from '../services/contactSheetStage';
import { isContactSheetHistory, sortContactSheetsByCreatedAt } from '../services/contactSheetWorkspace';
import {
  normalizeContactSheetSpecification,
  validateContactSheetForm,
  type ContactSheetFormErrors,
  type ContactSheetFormField
} from '../services/contactSheetFormValidation';
import { ProgressBar } from '../components/ProgressBar';
import type { StepNode } from '../components/ProgressBar';
import { Dialog } from '../components/Dialog';
import { FilterPanel, PageHeader } from '../components/PageHeader';
import { useFeedback } from '../components/FeedbackProvider';
import { FormField } from '../components/FormField';
import { SearchableCombobox } from '../components/SearchableCombobox';
import { IconButton } from '../components/IconButton';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { ColorIconBadge, type ColorIconTone } from '../components/ColorIconBadge';
import { PaginationControls } from '../components/PaginationControls';
import { usePagedRows } from '../hooks/usePagedRows';
import { sortCustomersForDisplay } from '../services/customerOrdering';
import { formatLocalDate } from '../services/dateUtils';
import { resolveBoxArtworkReminder } from '../services/boxArtworkReminder';
import { validateBatchQuantityTotal } from '../services/batchTracking';
import {
  loadMasterProducts,
  loadPackagingProfiles,
  type MasterProduct,
  type PackagingProfile
} from '../services/masterDataService';
import { masterSpecificationKey } from '../services/masterSpecification';
import { CONTACT_SHEET_UNIT_OPTIONS, normalizeContactSheetUnit } from '../services/formOptions';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Layers,
  AlertCircle,
  X,
  ArrowUpRight,
  ArrowLeft,
  Copy,
  History,
  RotateCcw,
  ShieldCheck,
  FileText,
  Package,
  Calculator,
  CalendarDays,
  Workflow,
  Lock,
  Users,
  PackageCheck
} from 'lucide-react';

interface ContactSheetsProps {
  onRefreshData: () => void;
  onRefreshTrigger: number;
  onNavigate?: (tab: string) => void;
}

interface ContactSheetFormSectionProps {
  icon: React.ReactNode;
  tone: ColorIconTone;
  title: string;
  description: string;
  children: React.ReactNode;
}

const ContactSheetFormSection: React.FC<ContactSheetFormSectionProps> = ({ icon, tone, title, description, children }) => (
  <section className="rounded-xl border border-border bg-surface-muted/45 p-4 sm:p-5">
    <div className="mb-4 flex items-start gap-3">
      <ColorIconBadge tone={tone} size="sm" shape="circle">
        {icon}
      </ColorIconBadge>
      <div>
        <h4 className="text-sm font-bold text-ink">{title}</h4>
        <p className="mt-0.5 text-[11px] leading-5 text-muted">{description}</p>
      </div>
    </div>
    {children}
  </section>
);

const contactSheetInputClass = (invalid = false) => (
  `w-full rounded-[10px] border bg-surface px-3 py-2.5 text-sm text-ink transition-colors ${invalid ? 'border-brand-rose/50' : 'border-border'}`
);

export const ContactSheets: React.FC<ContactSheetsProps> = ({ onRefreshData, onRefreshTrigger, onNavigate }) => {
  const { confirm, notify } = useFeedback();
  const currentProductionMonth = () => {
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [viewScope, setViewScope] = useState<'current' | 'archived'>('current');
  const [groupByCustomer, setGroupByCustomer] = useState(false);
  const [returnContractContext, setReturnContractContext] = useState<{ id: string; no: string } | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<{ contactSheetId: string; contractId: string; contractNo: string } | null>(null);
  const [navigationError, setNavigationError] = useState('');
  const [selectedSheetDetail, setSelectedSheetDetail] = useState<ContactSheet | null>(null);
  const [historySheet, setHistorySheet] = useState<ContactSheet | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ContactSheetChangeHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [restoringHistoryId, setRestoringHistoryId] = useState<string | null>(null);

  // Load the exact sheet and contract identity set by the Contracts page.
  useEffect(() => {
    const contactSheetId = sessionStorage.getItem('highlight_contact_sheet_id');
    const returnContractId = sessionStorage.getItem('return_to_contract_id');
    const returnContractNo = sessionStorage.getItem('return_to_contract_no');
    if (contactSheetId && returnContractId) {
      setNavigationTarget({
        contactSheetId,
        contractId: returnContractId,
        contractNo: returnContractNo || '原合同'
      });
      setSearchQuery('');
      setStatusFilter('all');
      setNavigationError('');
      sessionStorage.removeItem('highlight_contact_sheet_id');
    }
    sessionStorage.removeItem('highlight_contact_sheet');
    setReturnContractContext(returnContractId ? { id: returnContractId, no: returnContractNo || '原合同' } : null);
  }, [onRefreshTrigger]);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Selected sheet for batch editing
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);

  // Form states
  const [businessType, setBusinessType] = useState<'制剂' | '原料药'>('制剂');
  const [contractId, setContractId] = useState('');
  const [formErrors, setFormErrors] = useState<ContactSheetFormErrors>({});
  const contractInputRef = React.useRef<HTMLInputElement>(null);
  const materialNoRef = React.useRef<HTMLInputElement>(null);
  const productNameRef = React.useRef<HTMLInputElement>(null);
  const unitPriceRef = React.useRef<HTMLInputElement>(null);
  const quantityRef = React.useRef<HTMLInputElement>(null);
  const unitInputRef = React.useRef<HTMLSelectElement>(null);
  const unitSelectRef = React.useRef<HTMLSelectElement>(null);
  const packagingTemplateRef = React.useRef<HTMLInputElement>(null);
  const [contactSheetNo, setContactSheetNo] = useState('');
  const [materialNo, setMaterialNo] = useState('');
  const [productVariantId, setProductVariantId] = useState('');
  const [productName, setProductName] = useState('');
  const [specification, setSpecification] = useState('');
  const [packaging, setPackaging] = useState('');
  const [packagingVersionId, setPackagingVersionId] = useState('');
  const [packagingProfiles, setPackagingProfiles] = useState<PackagingProfile[]>([]);
  const [masterProducts, setMasterProducts] = useState<MasterProduct[]>([]);
  const [masterProductsError, setMasterProductsError] = useState('');
  const [packagingProfilesError, setPackagingProfilesError] = useState('');
  const [packagingConfirmedDate, setPackagingConfirmedDate] = useState('');
  const [qualityStandard, setQualityStandard] = useState('USP-NF2025');
  const [unitPrice, setUnitPrice] = useState(0);
  const [quantity, setQuantity] = useState(0);
  const [unit, setUnit] = useState('支');
  const [pcsPerCarton, setPcsPerCarton] = useState<number | ''>('');
  const [grossWeightKg, setGrossWeightKg] = useState<number | ''>('');
  const [productionDate, setProductionDate] = useState('07/2026'); // MM/YYYY
  const [expiryDate, setExpiryDate] = useState('06/2029'); // MM/YYYY
  const [isStaggeredMonth, setIsStaggeredMonth] = useState(false);

  const [qaApprovalDate, setQaApprovalDate] = useState('');
  const [apsScheduledDate, setApsScheduledDate] = useState('');
  const [actualWarehousingDate, setActualWarehousingDate] = useState('');
  const [estimatedReleaseDate, setEstimatedReleaseDate] = useState('');
  const [actualReleaseDate, setActualReleaseDate] = useState('');
  const [referenceContactSheet, setReferenceContactSheet] = useState('');

  // Batch Form State
  const [batchNoStr, setBatchNoStr] = useState('');
  const [batchList, setBatchList] = useState<{ batch_no: string; batch_quantity: number }[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [boxArtworkUpdatingId, setBoxArtworkUpdatingId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState('');
  const formBaselineRef = React.useRef('');
  const formBaselineInitializedRef = React.useRef(false);

  const getContactFormSnapshot = () => JSON.stringify({
    editingId,
    businessType,
    contractId,
    contactSheetNo,
    materialNo,
    productVariantId,
    productName,
    specification,
    packaging,
    packagingVersionId,
    packagingConfirmedDate,
    qualityStandard,
    unitPrice,
    quantity,
    unit,
    pcsPerCarton,
    grossWeightKg,
    productionDate,
    expiryDate,
    isStaggeredMonth,
    qaApprovalDate,
    apsScheduledDate,
    actualWarehousingDate,
    estimatedReleaseDate,
    actualReleaseDate,
    referenceContactSheet
  });

  useEffect(() => {
    if (showFormModal && !formBaselineInitializedRef.current) {
      formBaselineRef.current = getContactFormSnapshot();
      formBaselineInitializedRef.current = true;
    } else if (!showFormModal) {
      formBaselineInitializedRef.current = false;
    }
  });

  // Load database lists
  const data = useMemo(() => {
    void onRefreshTrigger;
    const sheets = db.getContactSheets();
    const contracts = db.getContracts();
    const batches = db.getBatches();
    const customers = db.getCustomers();
    const shipments = db.getShipments();
    const shipmentItems = db.getTable<any>('trade_shipment_items');
    const payments = db.getPayments();
    const invoices = db.getInvoices();
    return { sheets, contracts, batches, customers, shipments, shipmentItems, payments, invoices };
  }, [onRefreshTrigger]);

  const { sheets, contracts, batches, customers, shipments, shipmentItems, payments, invoices } = data;

  useEffect(() => {
    let active = true;
    const refreshMasterData = () => {
      Promise.all([loadPackagingProfiles(), loadMasterProducts()])
        .then(([profileRows, productRows]) => {
          if (!active) return;
          setPackagingProfiles(profileRows.filter((row) => row.is_active && row.review_status === 'verified'));
          setMasterProducts(productRows);
          setPackagingProfilesError('');
          setMasterProductsError('');
        })
        .catch((error) => {
          if (!active) return;
          setPackagingProfiles([]);
          setMasterProducts([]);
          const message = error instanceof Error ? error.message : String(error);
          setPackagingProfilesError(message);
          setMasterProductsError(message);
        });
    };
    refreshMasterData();
    window.addEventListener('demo-account-changed', refreshMasterData);
    return () => {
      active = false;
      window.removeEventListener('demo-account-changed', refreshMasterData);
    };
  }, [onRefreshTrigger]);

  const productVariantRecords = useMemo(() => masterProducts.flatMap((product) => product.variants.map((variant) => ({ product, variant }))), [masterProducts]);
  const productVariantOptions = useMemo(() => productVariantRecords
    .filter(({ product, variant }) => product.status === '启用' && variant.status === '启用' && product.product_type === businessType)
    .map(({ product, variant }) => ({
      value: variant.id,
      label: `${product.product_code}｜${product.chinese_name}｜${variant.specification || '无规格'}`,
      description: [product.dosage_form, product.english_name].filter(Boolean).join('｜') || '产品主数据',
      searchText: [product.product_code, product.chinese_name, product.english_name, product.dosage_form, variant.specification, ...product.aliases.map((alias) => alias.alias)].join(' ')
    })), [businessType, productVariantRecords]);

  const handleProductVariantChange = (variantId: string) => {
    setProductVariantId(variantId);
    const selected = productVariantRecords.find(({ variant }) => variant.id === variantId);
    setProductName(selected?.product.chinese_name || '');
    setSpecification(selected?.variant.specification || '');
    clearFormError('productVariantId');
    clearFormError('productName');
  };

  const packagingProfileOptions = useMemo(() => packagingProfiles
    .slice()
    .sort((left, right) => {
      const leftMatch = Number(left.material_no === materialNo) * 2 + Number(left.product_name === productName);
      const rightMatch = Number(right.material_no === materialNo) * 2 + Number(right.product_name === productName);
      return rightMatch - leftMatch || left.packaging_code.localeCompare(right.packaging_code, 'zh-CN');
    })
    .map((profile) => ({
      value: profile.version_id,
      label: `${profile.packaging_code}｜${profile.product_name}${profile.specification ? `｜${profile.specification}` : ''}`,
      description: `${profile.workshop || '未填车间'}｜外箱外径 ${profile.carton_outer_length_mm && profile.carton_outer_width_mm && profile.carton_outer_height_mm ? `${profile.carton_outer_length_mm}×${profile.carton_outer_width_mm}×${profile.carton_outer_height_mm} mm` : '待维护'}｜${profile.packaging_description}｜${Number(profile.quantity_per_carton).toLocaleString()} ${profile.quantity_unit}`,
      searchText: [profile.packaging_code, profile.product_name, profile.product_search_text, profile.material_no, profile.specification, profile.workshop, profile.packing_method, profile.packaging_description, profile.customer_name, profile.carton_outer_length_mm, profile.carton_outer_width_mm, profile.carton_outer_height_mm].join(' ')
    })), [materialNo, packagingProfiles, productName]);

  const selectedPackagingProfile = useMemo(
    () => packagingProfiles.find((item) => item.version_id === packagingVersionId) || null,
    [packagingProfiles, packagingVersionId]
  );

  const handlePackagingVersionChange = (versionId: string) => {
    setPackagingVersionId(versionId);
    const profile = packagingProfiles.find((item) => item.version_id === versionId);
    if (!profile) {
      setPackaging('');
      setPcsPerCarton('');
      return;
    }
    setPackaging(profile.packaging_description);
    setPcsPerCarton(Number(profile.quantity_per_carton));
    clearFormError('pcsPerCarton');
  };
  const selectableContracts = useMemo(
    () => contracts.filter(contract => !contract.archived && !contract.is_historical),
    [contracts]
  );
  const focusedSheet = useMemo(
    () => resolveContactSheetNavigationTarget(sheets, navigationTarget),
    [sheets, navigationTarget]
  );
  useEffect(() => {
    if (!navigationTarget) return;
    if (focusedSheet) {
      setSelectedSheetDetail(null);
      setNavigationError('');
      const focusedContract = contracts.find(contract => contract.id === focusedSheet.contract_id);
      setViewScope(isContactSheetHistory(focusedSheet, Boolean(focusedContract?.archived)) ? 'archived' : 'current');
      const scrollTimer = window.setTimeout(() => {
        document.getElementById(`contact-sheet-card-${focusedSheet.id}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }, 0);
      return () => window.clearTimeout(scrollTimer);
    }
    if (sheets.length > 0) {
      setSelectedSheetDetail(null);
      setNavigationError(`无法在合同 ${navigationTarget.contractNo} 中找到指定联系单，已阻止打开其他合同的相似产品。`);
    }
  }, [focusedSheet, navigationTarget, sheets.length, contracts]);
  const selectedContract = contracts.find(contract => contract.id === contractId);
  const editingSheet = editingId ? sheets.find(sheet => sheet.id === editingId) : null;
  const editingContract = editingSheet ? contracts.find(contract => contract.id === editingSheet.contract_id) : null;

  // Search & Filter
  const filteredSheets = useMemo(() => {
    const filtered = sheets.filter(s => {
      const sheetContract = contracts.find(contract => contract.id === s.contract_id);
      const isHistory = isContactSheetHistory(s, Boolean(sheetContract?.archived));
      const matchesScope = viewScope === 'archived' ? isHistory : !isHistory;
      const matchesContractContext = !returnContractContext || s.contract_id === returnContractContext.id;
      const matchesExactTarget = !navigationTarget || s.id === navigationTarget.contactSheetId;
      const matchesSearch =
        (s.contact_sheet_no && s.contact_sheet_no.toLowerCase().includes(searchQuery.toLowerCase())) ||
        s.material_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (s.contract_no && s.contract_no.toLowerCase().includes(searchQuery.toLowerCase()));

      let matchesStatus = true;
      if (statusFilter !== 'all') {
        // Compute active status
        let sheetStatus = '待填写联系单号';
        if (s.business_type === '原料药' || s.is_historical) {
          if (s.shipped_quantity === 0) sheetStatus = 'ready';
          else if (s.shipped_quantity < s.quantity) sheetStatus = 'partial';
          else sheetStatus = 'shipped';
        } else if (!s.contact_sheet_no) {
          sheetStatus = 'pending_no';
        } else if (!isQaComplete(s)) {
          sheetStatus = 'pending_qa';
        } else if (!s.aps_scheduled_date) {
          sheetStatus = 'pending_aps';
        } else if (!s.actual_warehousing_date) {
          sheetStatus = 'scheduled';
        } else if (!s.actual_release_date) {
          sheetStatus = 'warehoused';
        } else if (s.shipped_quantity === 0) {
          sheetStatus = 'ready';
        } else if (s.shipped_quantity < s.quantity) {
          sheetStatus = 'partial';
        } else {
          sheetStatus = 'shipped';
        }
        matchesStatus = sheetStatus === statusFilter;
      }

      return matchesScope && matchesContractContext && matchesExactTarget && matchesSearch && matchesStatus;
    });
    const contractDateById = new Map(contracts.map(contract => [contract.id, contract.contract_date]));
    return sortContactSheetsByCreatedAt(
      filtered,
      sheet => contractDateById.get(sheet.contract_id) || ''
    );
  }, [sheets, contracts, viewScope, searchQuery, statusFilter, returnContractContext, navigationTarget]);

  const orderedFilteredSheets = useMemo(() => {
    if (!groupByCustomer) return filteredSheets;
    const customerPositions = new Map(sortCustomersForDisplay(customers).map((customer, index) => [customer.id, index]));
    return [...filteredSheets].sort((left, right) => {
      const leftContract = contracts.find((contract) => contract.id === left.contract_id);
      const rightContract = contracts.find((contract) => contract.id === right.contract_id);
      const customerDiff = (customerPositions.get(leftContract?.customer_id || '') ?? Number.MAX_SAFE_INTEGER)
        - (customerPositions.get(rightContract?.customer_id || '') ?? Number.MAX_SAFE_INTEGER);
      return customerDiff || right.created_at.localeCompare(left.created_at);
    });
  }, [contracts, customers, filteredSheets, groupByCustomer]);
  const contactSheetPage = usePagedRows(
    orderedFilteredSheets,
    `${viewScope}|${searchQuery}|${statusFilter}|${returnContractContext || ''}|${navigationTarget?.contactSheetId || ''}|${groupByCustomer}`
  );
  const displayedSheets = contactSheetPage.rows;

  const handleBusinessTypeChange = (nextType: '制剂' | '原料药') => {
    setBusinessType(nextType);
    if (!editingSheet?.is_historical) {
      setProductVariantId('');
      setProductName('');
      setSpecification('');
    }
    if (nextType === '原料药') {
      setUnit(current => CONTACT_SHEET_UNIT_OPTIONS.includes(normalizeContactSheetUnit(current) as (typeof CONTACT_SHEET_UNIT_OPTIONS)[number]) ? normalizeContactSheetUnit(current) : 'kg');
      if (!editingId) {
        setPackaging('');
        setPackagingVersionId('');
        setPackagingConfirmedDate('');
        setQualityStandard('');
        setPcsPerCarton('');
        setProductionDate('');
        setExpiryDate('');
        setIsStaggeredMonth(false);
      }
    } else {
      setUnit(current => CONTACT_SHEET_UNIT_OPTIONS.includes(normalizeContactSheetUnit(current) as (typeof CONTACT_SHEET_UNIT_OPTIONS)[number]) ? normalizeContactSheetUnit(current) : '支');
    }
    clearFormError('unit');
  };

  const clearFormError = (field: ContactSheetFormField) => {
    setFormErrors(current => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  // Handle stagger month auto-expiry
  const handleProdDateChange = (val: string) => {
    setProductionDate(val);
    if (contractId) {
      const contract = contracts.find(c => c.id === contractId);
      const cust = customers.find(cu => cu.id === contract?.customer_id);
      const exp = calculateExpiryDate(val, cust?.expiry_years ?? 3, isStaggeredMonth);
      setExpiryDate(exp);
    }
  };

  const handleContractChange = (nextContractId: string) => {
    setContractId(nextContractId);
    clearFormError('contractId');
    const contract = contracts.find(c => c.id === nextContractId);
    const customer = customers.find(c => c.id === contract?.customer_id);
    const staggered = customer?.is_staggered_month ?? false;
    setIsStaggeredMonth(staggered);
    setPackagingConfirmedDate('');
    setExpiryDate(calculateExpiryDate(productionDate, customer?.expiry_years ?? 3, staggered));
  };

  const handleStaggeredChange = (staggered: boolean) => {
    setIsStaggeredMonth(staggered);
    const contract = contracts.find(c => c.id === contractId);
    const customer = customers.find(c => c.id === contract?.customer_id);
    setExpiryDate(calculateExpiryDate(productionDate, customer?.expiry_years ?? 3, staggered));
  };

  const requestCloseForm = async () => {
    if (isSaving) return;
    const hasUnsavedChanges = formBaselineInitializedRef.current
      && getContactFormSnapshot() !== formBaselineRef.current;
    if (hasUnsavedChanges) {
      const shouldClose = await confirm({
        title: '放弃尚未保存的修改？',
        message: '关闭后，本次在联系单表单中填写或修改的内容将不会保留。',
        confirmLabel: '放弃修改',
        cancelLabel: '继续编辑',
        tone: 'warning'
      });
      if (!shouldClose) return;
    }
    setShowFormModal(false);
  };

  // Form submit handler
  const handleOpenAdd = () => {
    const defaultContract = selectableContracts[0];
    const defaultCustomer = customers.find(customer => customer.id === defaultContract?.customer_id);
    const defaultProductionDate = currentProductionMonth();
    const defaultStaggered = defaultCustomer?.is_staggered_month ?? false;
    setEditingId(null);
    setBusinessType('制剂');
    setFormErrors({});
    setContractId(defaultContract?.id || '');
    setContactSheetNo('');
    setMaterialNo('');
    setProductVariantId('');
    setProductName('');
    setSpecification('');
    setPackaging('');
    setPackagingVersionId('');
    setPackagingConfirmedDate('');
    setQualityStandard('USP-NF2025');
    setUnitPrice(0);
    setQuantity(0);
    setUnit('支');
    setGrossWeightKg('');
    setProductionDate(defaultProductionDate);
    setExpiryDate(calculateExpiryDate(defaultProductionDate, defaultCustomer?.expiry_years ?? 3, defaultStaggered));
    setIsStaggeredMonth(defaultStaggered);
    setQaApprovalDate('');
    setApsScheduledDate('');
    setActualWarehousingDate('');
    setEstimatedReleaseDate('');
    setActualReleaseDate('');
    setReferenceContactSheet('');
    setPcsPerCarton('');
    setShowFormModal(true);
  };

  const handleOpenEdit = (s: ContactSheet) => {
    setEditingId(s.id);
    setBusinessType(s.business_type);
    setFormErrors({});
    setContractId(s.contract_id);
    setContactSheetNo(s.contact_sheet_no);
    setMaterialNo(s.material_no);
    setProductVariantId(s.product_variant_id || '');
    setProductName(s.product_name);
    setSpecification(s.specification);
    setPackaging(s.packaging);
    setPackagingVersionId(s.packaging_profile_version_id || '');
    setPackagingConfirmedDate(s.packaging_confirmed_date);
    setQualityStandard(s.quality_standard);
    setUnitPrice(s.unit_price);
    setQuantity(s.quantity);
    setUnit(CONTACT_SHEET_UNIT_OPTIONS.includes(normalizeContactSheetUnit(s.unit) as (typeof CONTACT_SHEET_UNIT_OPTIONS)[number]) ? normalizeContactSheetUnit(s.unit) : '支');
    setProductionDate(s.production_date);
    setExpiryDate(s.expiry_date);
    setIsStaggeredMonth(s.is_staggered_month);
    setQaApprovalDate(s.qa_approval_date);
    setApsScheduledDate(s.aps_scheduled_date);
    setActualWarehousingDate(s.actual_warehousing_date);
    setEstimatedReleaseDate(s.estimated_release_date);
    setActualReleaseDate(s.actual_release_date);
    setReferenceContactSheet(s.reference_contact_sheet);
    setPcsPerCarton(s.pcs_per_carton || '');
    setGrossWeightKg(s.gross_weight_kg || '');
    setShowFormModal(true);
  };

  const handleOpenCopy = (s: ContactSheet) => {
    const sourceRecord = productVariantRecords.find(({ variant }) => variant.id === s.product_variant_id);
    const activeSnapshotCandidates = productVariantRecords.filter(({ product, variant }) => (
      product.product_type === s.business_type
      && product.status === '启用'
      && variant.status === '启用'
      && product.chinese_name.trim().toLocaleLowerCase() === s.product_name.trim().toLocaleLowerCase()
    ));
    const exactSnapshotCandidate = activeSnapshotCandidates.find(({ variant }) => (
      masterSpecificationKey(variant.specification) === masterSpecificationKey(s.specification)
    ));
    const copyVariant = sourceRecord?.variant.status === '启用' && sourceRecord.product.status === '启用'
      ? sourceRecord
      : exactSnapshotCandidate
        || (s.business_type === '原料药' && activeSnapshotCandidates.length === 1 ? activeSnapshotCandidates[0] : undefined);
    const targetCustomerId = contracts.find((contract) => contract.id === s.contract_id)?.customer_id;
    const currentPackaging = copyVariant
      ? packagingProfiles
          .filter((profile) => (
            profile.product_variant_id === copyVariant.variant.id
            && (!profile.customer_id || profile.customer_id === targetCustomerId)
          ))
          .sort((left, right) => Number(Boolean(right.customer_id)) - Number(Boolean(left.customer_id)))[0] || null
      : null;
    setEditingId(null);
    setBusinessType(s.business_type);
    setFormErrors({});
    setContractId(s.contract_id);
    setContactSheetNo('');
    setMaterialNo(s.material_no);
    setProductVariantId(copyVariant?.variant.id || '');
    setProductName(copyVariant?.product.chinese_name || '');
    setSpecification(copyVariant?.variant.specification || '');
    setPackaging(currentPackaging?.packaging_description || '');
    setPackagingVersionId(currentPackaging?.version_id || '');
    setPackagingConfirmedDate('');
    setQualityStandard(s.quality_standard);
    setUnitPrice(s.unit_price);
    setQuantity(s.quantity);
    setUnit(CONTACT_SHEET_UNIT_OPTIONS.includes(normalizeContactSheetUnit(s.unit) as (typeof CONTACT_SHEET_UNIT_OPTIONS)[number]) ? normalizeContactSheetUnit(s.unit) : '支');
    setProductionDate(s.production_date);
    setExpiryDate(s.expiry_date);
    setIsStaggeredMonth(s.is_staggered_month);
    setQaApprovalDate('');
    setApsScheduledDate('');
    setActualWarehousingDate('');
    setEstimatedReleaseDate('');
    setActualReleaseDate('');
    setReferenceContactSheet(s.contact_sheet_no || '');
    setPcsPerCarton(currentPackaging?.quantity_per_carton || '');
    setGrossWeightKg('');
    setShowFormModal(true);
  };

  const loadContactSheetHistory = async (sheet: ContactSheet) => {
    setHistorySheet(sheet);
    setHistoryLoading(true);
    setHistoryError('');
    try {
      setHistoryEntries(await db.getContactSheetHistory(sheet.id));
    } catch (error) {
      setHistoryEntries([]);
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleOpenHistory = (sheet: ContactSheet, event?: React.MouseEvent) => {
    event?.stopPropagation();
    void loadContactSheetHistory(sheet);
  };

  const handleRestoreHistory = async (entry: ContactSheetChangeHistory) => {
    if (!historySheet) return;
    const oldContactNo = String(entry.old_data.contact_sheet_no || '未填写');
    const oldMaterialNo = String(entry.old_data.material_no || '未填写');
    const contract = contracts.find(item => item.id === String(entry.old_data.contract_id || ''));
    const confirmed = await confirm({
      title: '回退到这次修改之前？',
      message: `合同：${contract?.contract_no || '未知合同'}\n联系单号：${oldContactNo}\n物料号：${oldMaterialNo}\n\n当前版本会自动保留在历史中，之后仍可再次恢复。`,
      confirmLabel: '确认回退',
      tone: 'warning'
    });
    if (!confirmed) return;
    setRestoringHistoryId(entry.id);
    setHistoryError('');
    try {
      await db.restoreContactSheetHistory(historySheet.id, entry.id);
      const restoredSheet = db.getContactSheets().find(sheet => sheet.id === historySheet.id) || historySheet;
      setSelectedSheetDetail(restoredSheet);
      setHistorySheet(restoredSheet);
      setHistoryEntries(await db.getContactSheetHistory(restoredSheet.id));
      onRefreshData();
      notify({ title: '联系单已回退', message: '当前版本已保留在修改历史中，可在需要时再次恢复。', tone: 'success' });
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRestoringHistoryId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors = validateContactSheetForm({
      businessType,
      contractId,
      materialNo,
      productVariantId,
      productName,
      unitPrice,
      quantity,
      unit,
      pcsPerCarton: pcsPerCarton === '' ? null : Number(pcsPerCarton),
      requiresPcsPerCarton: businessType === '制剂' && Boolean(packagingVersionId) && selectedContract?.currency === 'RMB',
      requiresProductVariant: !editingSheet?.is_historical
    });
    setFormErrors(nextErrors);
    const firstInvalidField = (Object.keys(nextErrors) as ContactSheetFormField[])[0];
    if (firstInvalidField) {
      const fieldRefs: Record<ContactSheetFormField, React.RefObject<HTMLInputElement | HTMLSelectElement | null>> = {
        businessType: contractInputRef,
        contractId: contractInputRef,
        materialNo: materialNoRef,
        productVariantId: productNameRef,
        productName: productNameRef,
        unitPrice: unitPriceRef,
        quantity: quantityRef,
        unit: businessType === '原料药' ? unitSelectRef : unitInputRef,
        pcsPerCarton: packagingTemplateRef
      };
      fieldRefs[firstInvalidField].current?.focus();
      return;
    }

    if (editingId && !editingSheet) {
      setOperationError('当前页面找不到正在编辑的联系单，请关闭窗口并刷新后重试。');
      return;
    }
    if (editingSheet && editingSheet.contact_sheet_no.trim() !== contactSheetNo.trim()) {
      const editingContract = contracts.find(contract => contract.id === editingSheet.contract_id);
      const confirmed = await confirm({
        title: '确认修改联系单号？',
        message: `所属合同：${editingContract?.contract_no || editingSheet.contract_no}\n产品：${editingSheet.product_name}\n物料号：${editingSheet.material_no}\n原联系单号：${editingSheet.contact_sheet_no || '未填写'}\n新联系单号：${contactSheetNo.trim() || '清空'}\n\n联系单号会影响记录识别，请再次核对后继续。`,
        confirmLabel: '确认修改',
        tone: 'warning'
      });
      if (!confirmed) return;
    }

    const payload = {
      contract_id: contractId,
      business_type: businessType,
      contact_sheet_no: contactSheetNo,
      material_no: materialNo,
      product_variant_id: productVariantId || null,
      product_name: productName,
      specification: normalizeContactSheetSpecification(specification),
      packaging: packaging,
      packaging_profile_version_id: packagingVersionId || null,
      packaging_confirmed_date: packagingConfirmedDate,
      quality_standard: qualityStandard,
      unit_price: unitPrice,
      quantity: quantity,
      unit,
      production_date: productionDate,
      expiry_date: expiryDate,
      is_staggered_month: isStaggeredMonth,
      qa_approval_date: qaApprovalDate,
      aps_scheduled_date: apsScheduledDate,
      actual_warehousing_date: actualWarehousingDate,
      estimated_release_date: estimatedReleaseDate,
      actual_release_date: actualReleaseDate,
      aps_auto_query_enabled: false,
      reference_contact_sheet: referenceContactSheet,
      pcs_per_carton: pcsPerCarton === '' ? null : Number(pcsPerCarton),
      gross_weight_kg: grossWeightKg === '' ? null : Number(grossWeightKg),
      notes: editingId ? '手动修改联系单' : '手动录入联系单'
    };

    setIsSaving(true);
    setOperationError('');
    try {
      if (editingId) {
        await db.updateContactSheet(editingId, payload);
      } else {
        await db.addContactSheet(payload);
      }
      setShowFormModal(false);
      onRefreshData();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const sheet = sheets.find(item => item.id === id);
    const contract = contracts.find(item => item.id === sheet?.contract_id);
    const batchCount = batches.filter(batch => batch.contact_sheet_id === id).length;
    const confirmed = await confirm({
      title: '彻底删除这条联系单？',
      message: `合同：${contract?.contract_no || sheet?.contract_no || '未知合同'}\n联系单：${sheet?.contact_sheet_no || '未填写'}\n物料：${sheet?.material_no || '未填写'}\n关联批次：${batchCount} 个\n\n删除后，对应批次也会一并删除。`,
      confirmLabel: '删除联系单',
      tone: 'danger'
    });
    if (!confirmed) return;
    setOperationError('');
    try {
      await db.deleteContactSheet(id);
      onRefreshData();
      notify({ title: '联系单已删除', message: '该联系单及其关联批次已一并移除。', tone: 'success' });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleToggleBoxArtworkConfirmation = async (sheet: ContactSheet) => {
    const status = resolveBoxArtworkReminder(sheet);
    if (!status.applicable || boxArtworkUpdatingId) return;
    const nextConfirmed = !status.confirmed;
    const confirmed = await confirm({
      title: nextConfirmed ? '确认盒子版式已经完成？' : '撤销盒子版式确认？',
      message: nextConfirmed
        ? `联系单：${sheet.contact_sheet_no || '未填写'}\n产品：${sheet.product_name}\n排产日：${sheet.aps_scheduled_date || '未排产'}\n\n确认后将记录今天为盒子制版稿确认日期，并清除对应提醒。`
        : `联系单：${sheet.contact_sheet_no || '未填写'}\n原确认日期：${status.confirmedDate}\n\n撤销后，系统会按当前 排产日重新计算提前 25 天的提醒。`,
      confirmLabel: nextConfirmed ? '确认已完成' : '确认撤销',
      tone: nextConfirmed ? 'warning' : 'danger'
    });
    if (!confirmed) return;

    setBoxArtworkUpdatingId(sheet.id);
    setOperationError('');
    try {
      await db.updateContactSheet(sheet.id, {
        box_artwork_confirmed_date: nextConfirmed ? formatLocalDate() : ''
      });
      onRefreshData();
      notify({
        title: nextConfirmed ? '盒子版式已确认' : '盒子版式确认已撤销',
        message: nextConfirmed
          ? '确认日期已记录，提醒中心及合同缩略卡片中的提醒已经清除。'
          : '系统已按当前 排产日期重新判断是否需要提醒。',
        tone: 'success'
      });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setBoxArtworkUpdatingId(null);
    }
  };

  // Batch Management Modal
  const handleOpenBatchEditor = (sheetId: string) => {
    const targetSheet = sheets.find(sheet => sheet.id === sheetId);
    if (targetSheet?.business_type === '原料药') {
      notify({ title: '原料药无需拆分批次', message: '原料药可以直接按产品明细填写发货数量，批号允许为空。', tone: 'info' });
      return;
    }
    setSelectedSheetId(sheetId);

    // Load current batches
    const currentBatches = batches.filter(b => b.contact_sheet_id === sheetId);
    if (currentBatches.length > 0) {
      setBatchList(currentBatches.map(b => ({
        batch_no: b.batch_no,
        batch_quantity: b.batch_quantity
      })));
      setBatchNoStr(currentBatches.map(b => b.batch_no).join(', '));
    } else {
      setBatchList([]);
      setBatchNoStr('');
    }
    setShowBatchModal(true);
  };

  const handleParseBatchText = () => {
    if (!batchNoStr.trim() || !selectedSheetId) return;
    const targetSheet = sheets.find(s => s.id === selectedSheetId);
    if (!targetSheet) return;

    const parsedBatches = parseBatchAllocations(batchNoStr);
    if (parsedBatches.length === 0) return;

    const totalQty = targetSheet.quantity;
    const specifiedTotal = parsedBatches.reduce((sum, batch) => sum + (batch.batch_quantity ?? 0), 0);
    const unspecifiedCount = parsedBatches.filter((batch) => batch.batch_quantity === undefined).length;
    const remainingQty = Math.max(0, totalQty - specifiedTotal);
    const qPer = unspecifiedCount > 0
      ? Math.floor((remainingQty / unspecifiedCount) * 1000) / 1000
      : 0;
    let assignedUnspecified = 0;
    const list = parsedBatches.map((batch) => {
      if (batch.batch_quantity !== undefined) {
        return { batch_no: batch.batch_no, batch_quantity: batch.batch_quantity };
      }
      assignedUnspecified += 1;
      return {
        batch_no: batch.batch_no,
        batch_quantity: assignedUnspecified === unspecifiedCount
          ? remainingQty - qPer * (unspecifiedCount - 1)
          : qPer
      };
    });

    setBatchList(list);
  };

  const handleSaveBatches = async () => {
    if (!selectedSheetId) return;
    const targetSheet = sheets.find(s => s.id === selectedSheetId);
    if (!targetSheet) return;

    const batchTotalError = validateBatchQuantityTotal(
      batchList.map((batch) => batch.batch_quantity),
      targetSheet.quantity
    );
    if (batchTotalError) {
      setOperationError(batchTotalError);
      return;
    }

    const payload = batchList.map(b => ({
      contact_sheet_id: selectedSheetId,
      batch_no: b.batch_no,
      batch_quantity: b.batch_quantity,
      production_date: targetSheet.production_date,
      expiry_date: targetSheet.expiry_date,
      warehouse_date: targetSheet.actual_warehousing_date,
      release_date: targetSheet.actual_release_date,
      notes: '分拆录入'
    }));

    setIsSaving(true);
    setOperationError('');
    try {
      const conflicts = await db.getGlobalBatchNumberConflicts(
        payload.map((row) => row.batch_no),
        selectedSheetId
      );
      if (conflicts.length > 0) {
        const conflictLines = conflicts.slice(0, 8).map((conflict) => (
          `${conflict.batch_no}：${conflict.owner_display_name}，合同 ${conflict.contract_no}，联系单 ${conflict.contact_sheet_no || '未填写'}`
        ));
        const more = conflicts.length > conflictLines.length ? `\n另有 ${conflicts.length - conflictLines.length} 个重复批号` : '';
        const confirmed = await confirm({
          title: '公司内其他联系单已使用相同批号',
          message: `${conflictLines.join('\n')}${more}\n\n批号跨联系单重复允许保存，请确认不是选错或录错联系单。`,
          confirmLabel: '确认继续保存',
          tone: 'warning'
        });
        if (!confirmed) return;
      }
      await db.saveBatches(selectedSheetId, payload);
      setShowBatchModal(false);
      onRefreshData();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenMaterialsInfo = (materialNo: string) => {
    notify({ title: '本地物料信息', message: `演示物料编号：${materialNo || '未填写'}。产品规格和包装参数可在本地主数据页面查看。`, tone: 'info' });
  };

  const handleReturnToContract = () => {
    if (!returnContractContext || !onNavigate) return;
    sessionStorage.setItem('open_contract_detail_id', returnContractContext.id);
    sessionStorage.removeItem('return_to_contract_id');
    sessionStorage.removeItem('return_to_contract_no');
    onNavigate('contracts');
  };

  const handleLeaveContractContext = () => {
    sessionStorage.removeItem('return_to_contract_id');
    sessionStorage.removeItem('return_to_contract_no');
    sessionStorage.removeItem('highlight_contact_sheet_id');
    setReturnContractContext(null);
    setNavigationTarget(null);
    setNavigationError('');
    setSelectedSheetDetail(null);
    setSearchQuery('');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {operationError && (
        <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">
          {operationError}
        </div>
      )}
      {navigationError && (
        <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">
          {navigationError}
        </div>
      )}
      <PageHeader
        title="销售联系单"
        description="跟踪联系单从提单、QA 审核、排产、放行到发货的精细化生命周期"
        leading={returnContractContext && onNavigate ? (
            <button
              type="button"
              onClick={handleReturnToContract}
              className="mb-3 inline-flex items-center gap-2 rounded-lg border border-brand-cyan/20 bg-brand-cyan/10 px-3 py-2 text-xs font-semibold text-brand-cyan transition-colors hover:bg-brand-cyan/15"
            >
              <ArrowLeft className="h-4 w-4" />
              返回合同详情：{returnContractContext.no}
            </button>
        ) : undefined}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setGroupByCustomer((current) => !current)}
              tone={groupByCustomer ? 'primary' : 'secondary'}
              icon={<Users className="h-4 w-4" />}
            >
              {groupByCustomer ? '返回录入日期排序' : '按客户分组查看'}
            </Button>
            <Button
              onClick={handleOpenAdd}
              icon={<Plus className="h-4 w-4" />}
            >
              录入新联系单
            </Button>
          </div>
        )}
      />

      {returnContractContext && (
        <div className="flex flex-col gap-2 rounded-xl border border-brand-emerald/25 bg-brand-emerald/10 px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-brand-emerald">
            <ShieldCheck className="h-4 w-4" />
            <span className="font-bold">合同范围已锁定：{returnContractContext.no}</span>
            <span className="text-slate-400">只会显示并打开该合同中的联系单。</span>
          </div>
          <button
            type="button"
            onClick={handleLeaveContractContext}
            className="self-start text-[11px] font-semibold text-slate-400 hover:text-white sm:self-auto"
          >
            退出合同范围，查看全部联系单
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2">
        <button
          type="button"
          onClick={() => setViewScope('current')}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${viewScope === 'current' ? 'bg-brand-cyan text-white' : 'text-muted hover:bg-surface-muted hover:text-ink'}`}
        >
          当前跟进（{sheets.filter(sheet => !isContactSheetHistory(sheet, Boolean(contracts.find(contract => contract.id === sheet.contract_id)?.archived))).length}）
        </button>
        <button
          type="button"
          onClick={() => setViewScope('archived')}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${viewScope === 'archived' ? 'bg-brand-cyan text-white' : 'text-muted hover:bg-surface-muted hover:text-ink'}`}
        >
          已发货 / 历史（{sheets.filter(sheet => isContactSheetHistory(sheet, Boolean(contracts.find(contract => contract.id === sheet.contract_id)?.archived))).length}）
        </button>
        <span className="ml-auto px-2 text-[11px] text-muted">列表每页显示 {contactSheetPage.pageSize} 条，避免一次渲染过多卡片。</span>
      </div>

      {/* Filter and search bar */}
      <FilterPanel className="grid grid-cols-1 gap-4 text-sm md:grid-cols-[minmax(0,1fr)_220px]">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            placeholder="搜索联系单号、合同号、物料号、产品名称、客户等..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-4 text-sm text-ink focus:border-brand-cyan/50"
          />
        </div>
        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-body"
        >
          <option value="all">显示全部状态</option>
          <option value="pending_no">待填写联系单号</option>
          <option value="pending_qa">待 QA 审批</option>
          <option value="pending_aps">待排产</option>
          <option value="scheduled">已排产待入库</option>
          <option value="warehoused">已入库待放行</option>
          <option value="ready">生产完成 / 可发货</option>
          <option value="partial">部分发货</option>
          <option value="shipped">已全部发货完成</option>
        </select>
      </FilterPanel>

      {/* Card List of Contact Sheets */}
      <div className="space-y-6">
        {displayedSheets.length > 0 ? (
          displayedSheets.map((s, index) => {
            const contractObj = contracts.find(co => co.id === s.contract_id);
            const contractDateVal = contractObj ? contractObj.contract_date : '';
            const resultFlow = s.business_type === '原料药' || s.is_historical;
            const sheetShipmentIds = new Set(
              shipmentItems
                .filter((item: any) => item.contact_sheet_id === s.id)
                .map((item: any) => item.shipment_id)
                .filter((shipmentId: string) => shipments.some(shipment => shipment.id === shipmentId && shipment.status === '已发货'))
            );
            const sheetShipmentRows = shipments.filter(shipment => sheetShipmentIds.has(shipment.id));
            const latestShipmentDate = sheetShipmentRows.map(shipment => shipment.shipment_date).filter(Boolean).sort().at(-1);
            const contractAmount = sheets
              .filter(sheet => sheet.contract_id === s.contract_id)
              .reduce((sum, sheet) => sum + sheet.quantity * sheet.unit_price, 0);
            const paidAmount = payments
              .filter(payment => payment.contract_id === s.contract_id)
              .reduce((sum, payment) => sum + payment.amount, 0);
            const paymentCompleted = contractAmount > 0 && paidAmount >= contractAmount - 0.005;
            const invoicedShipmentIds = new Set(
              invoices
                .filter(invoice => Boolean(invoice.invoice_date))
                .flatMap(invoice => invoice.shipment_allocations.map(allocation => allocation.shipment_id))
            );
            const invoiceCompleted = sheetShipmentIds.size > 0
              && Array.from(sheetShipmentIds).every(shipmentId => invoicedShipmentIds.has(shipmentId));
            const shipmentCompleted = s.quantity > 0 && s.shipped_quantity >= s.quantity;
            const resultCompleted = shipmentCompleted && paymentCompleted && invoiceCompleted;

            const steps: StepNode[] = resultFlow ? [
              { label: '合同', date: contractDateVal, status: 'completed' },
              {
                label: '发货',
                date: latestShipmentDate || undefined,
                desc: s.shipped_quantity > 0 ? `${s.shipped_quantity}/${s.quantity}` : undefined,
                status: shipmentCompleted ? 'completed' : s.shipped_quantity > 0 ? 'warning' : 'active'
              },
              {
                label: '收款',
                desc: paymentCompleted ? '已收齐' : `已收 ${paidAmount.toLocaleString()}`,
                status: paymentCompleted ? 'completed' : shipmentCompleted ? 'active' : 'pending'
              },
              {
                label: '开票',
                desc: invoiceCompleted ? '已完成' : undefined,
                status: invoiceCompleted ? 'completed' : shipmentCompleted ? 'active' : 'pending'
              },
              { label: '完成', status: resultCompleted ? 'completed' : 'pending' }
            ] : [
              { label: '起草提行', date: contractDateVal, status: 'completed' },
              {
                label: 'QA 审核',
                date: s.qa_approval_date || undefined,
                desc: !s.qa_approval_date && isQaComplete(s) ? '已完成' : undefined,
                status: isQaComplete(s) ? 'completed' : (s.contact_sheet_no ? 'active' : 'pending')
              },
              {
                label: '排产',
                date: s.aps_scheduled_date || undefined,
                status: s.aps_scheduled_date ? 'completed' : (isQaComplete(s) ? 'active' : 'pending'),
                highlight: !s.actual_warehousing_date && !!s.aps_scheduled_date
              },
              {
                label: '生产入库',
                date: s.actual_warehousing_date || undefined,
                status: s.actual_warehousing_date ? 'completed' : (s.aps_scheduled_date ? 'active' : 'pending')
              },
              {
                label: '检验放行',
                date: s.actual_release_date || undefined,
                status: s.actual_release_date ? 'completed' : (s.actual_warehousing_date ? 'active' : 'pending')
              },
              {
                label: '发货出库',
                desc: s.shipped_quantity > 0 ? `${s.shipped_quantity}/${s.quantity}` : undefined,
                status: s.shipped_quantity >= s.quantity
                  ? 'completed'
                  : s.shipped_quantity > 0
                    ? 'warning'
                    : (s.actual_release_date ? 'active' : 'pending')
              }
            ];

            const currentStage = resolveContactSheetStage(s);
            const boxArtworkStatus = resolveBoxArtworkReminder(s);
            const currencySymbol = contractObj?.currency === 'RMB' ? '¥' : '$';
            const orderAmount = s.quantity * s.unit_price;
            const formattedUnitPrice = `${currencySymbol}${s.unit_price.toLocaleString(undefined, { maximumFractionDigits: 3 })}`;
            const formattedOrderAmount = `${currencySymbol}${orderAmount.toLocaleString(undefined, { maximumFractionDigits: 3 })}`;
            const previousContract = index > 0 ? contracts.find(contract => contract.id === displayedSheets[index - 1]?.contract_id) : null;
            const showCustomerHeader = groupByCustomer && (index === 0 || previousContract?.customer_id !== contractObj?.customer_id);
            const customerSheetCount = groupByCustomer
              ? orderedFilteredSheets.filter((sheet) => contracts.find((contract) => contract.id === sheet.contract_id)?.customer_id === contractObj?.customer_id).length
              : 0;

            return (
              <React.Fragment key={s.id}>
                {showCustomerHeader && (
                  <div className="flex items-center justify-between rounded-xl border border-border bg-surface-muted/55 px-4 py-3">
                    <div>
                      <h3 className="font-heading text-sm font-bold text-ink">{contractObj?.customer_name || '未记录客户'}</h3>
                      <p className="mt-0.5 text-[10px] text-muted">组内按联系单录入日期由新到旧排列。</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
                      <StatusBadge tone="neutral">{customerSheetCount} 张联系单</StatusBadge>
                      {orderedFilteredSheets.some((sheet) => {
                        const contract = contracts.find((row) => row.id === sheet.contract_id);
                        return contract?.customer_id === contractObj?.customer_id && contract?.currency === 'USD';
                      }) && (
                        <span className="font-semibold text-body">美元 ${orderedFilteredSheets.filter((sheet) => {
                          const contract = contracts.find((row) => row.id === sheet.contract_id);
                          return contract?.customer_id === contractObj?.customer_id && contract?.currency === 'USD';
                        }).reduce((sum, sheet) => sum + sheet.quantity * sheet.unit_price, 0).toLocaleString()}</span>
                      )}
                      {orderedFilteredSheets.some((sheet) => {
                        const contract = contracts.find((row) => row.id === sheet.contract_id);
                        return contract?.customer_id === contractObj?.customer_id && contract?.currency === 'RMB';
                      }) && (
                        <span className="font-semibold text-body">人民币 ¥{orderedFilteredSheets.filter((sheet) => {
                          const contract = contracts.find((row) => row.id === sheet.contract_id);
                          return contract?.customer_id === contractObj?.customer_id && contract?.currency === 'RMB';
                        }).reduce((sum, sheet) => sum + sheet.quantity * sheet.unit_price, 0).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                )}
                <article
                  id={`contact-sheet-card-${s.id}`}
                  className={`scroll-mt-24 overflow-hidden rounded-2xl border bg-surface shadow-sm transition-shadow ${navigationTarget?.contactSheetId === s.id ? 'border-brand-cyan ring-2 ring-brand-cyan/35' : 'border-border'}`}
                >
                  <div onClick={() => setSelectedSheetDetail(s)} className="cursor-pointer px-4 py-4 transition-colors hover:bg-surface-muted/35 sm:px-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <h3 className="font-heading text-xl font-extrabold leading-none text-ink sm:text-2xl">
                            {s.contact_sheet_no || (s.business_type === '原料药'
                              ? <span className="text-base text-brand-cyan">原料药 · 无联系单号</span>
                              : <span className="text-base italic text-brand-rose">待填写联系单号</span>)}
                          </h3>
                          {s.business_type === '原料药' && <StatusBadge tone="progress">原料药</StatusBadge>}
                          {s.is_historical && <StatusBadge tone="neutral">历史数据</StatusBadge>}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            aria-label={`查询物料 ${s.material_no} 的成本`}
                            onClick={(event) => { event.stopPropagation(); handleOpenMaterialsInfo(s.material_no); }}
                            className="inline-flex items-center gap-1 rounded-md border border-brand-cyan/20 bg-brand-cyan/10 px-2.5 py-1.5 text-sm font-bold text-brand-cyan transition-colors hover:bg-brand-cyan/15"
                          >
                            物料 {s.material_no}
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </button>
                          <span className="rounded-md border border-border bg-surface-muted px-2.5 py-1.5 text-xs font-medium text-muted">合同 {s.contract_no}</span>
                        </div>
                        <div className="mt-3 truncate text-base font-bold text-ink">{s.product_name}</div>
                        <div className="mt-1 text-sm leading-relaxed text-muted">{contractObj?.customer_name || '未记录客户'} · {s.specification || '未填规格'} · {s.packaging || '未填包装'} · 质量标准 {s.quality_standard || '未填'}</div>
                        {!resultFlow && !s.actual_warehousing_date && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {s.aps_scheduled_date ? (() => {
                              const today = new Date();
                              today.setHours(0, 0, 0, 0);
                              const target = new Date(s.aps_scheduled_date);
                              target.setHours(0, 0, 0, 0);
                              const diffDays = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                              return diffDays <= 3 ? (
                                <StatusBadge tone="danger" size="sm" dot className="animate-pulse">
                                  紧急排产：{s.aps_scheduled_date}（{diffDays < 0 ? `已逾期 ${Math.abs(diffDays)} 天` : diffDays === 0 ? '今日排产' : `距今剩 ${diffDays} 天`}）
                                </StatusBadge>
                              ) : (
                                <StatusBadge tone="warning" size="sm" dot>计划排产：{s.aps_scheduled_date}（还有 {diffDays} 天）</StatusBadge>
                              );
                            })() : isQaComplete(s) ? (
                              <StatusBadge tone="neutral" size="sm" dot>待确定 排产日期</StatusBadge>
                            ) : null}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                        <StatusBadge tone={currentStage.tone} dot>{currentStage.label}</StatusBadge>
                        {boxArtworkStatus.applicable && (
                          <Button
                            onClick={() => { void handleToggleBoxArtworkConfirmation(s); }}
                            disabled={boxArtworkUpdatingId !== null}
                            tone={boxArtworkStatus.confirmed ? 'secondary' : boxArtworkStatus.due ? 'danger' : 'warning'}
                            size="sm"
                            icon={<PackageCheck className="h-3.5 w-3.5" />}
                            title={boxArtworkStatus.confirmed
                              ? `已于 ${boxArtworkStatus.confirmedDate} 确认；点击可撤销`
                              : boxArtworkStatus.reminderDate
                                ? `提醒日 ${boxArtworkStatus.reminderDate}；排产日 ${s.aps_scheduled_date}`
                                : '排产日期确定后，将自动计算提前 25 天的提醒日'}
                          >
                            {boxArtworkUpdatingId === s.id
                              ? '处理中'
                              : boxArtworkStatus.confirmed
                                ? `盒子版式已确认 ${boxArtworkStatus.confirmedDate}`
                                : boxArtworkStatus.due
                                  ? '立即确认盒子版式'
                                  : '确认盒子版式'}
                          </Button>
                        )}
                        <Button onClick={(event) => handleOpenHistory(s, event)} tone="warning" size="sm" icon={<History className="h-3.5 w-3.5" />}>历史回退</Button>
                        <IconButton onClick={() => handleOpenEdit(s)} label="编辑联系单" icon={<Edit2 className="h-4 w-4" />} />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
                      <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border bg-surface-muted/55">
                        <div className="min-w-0 px-3 py-2.5">
                          <div className="text-xs text-muted">单价</div>
                          <div className="mt-1 truncate text-sm font-bold text-ink">{formattedUnitPrice}</div>
                        </div>
                        <div className="min-w-0 px-3 py-2.5">
                          <div className="text-xs text-muted">订货数量</div>
                          <div className="mt-1 truncate text-sm font-bold text-ink">{s.quantity.toLocaleString()} <span className="text-xs font-medium text-body">{s.unit}</span></div>
                          <div className="mt-0.5 text-[11px] text-muted">已发 {s.shipped_quantity.toLocaleString()}</div>
                        </div>
                        <div className="min-w-0 px-3 py-2.5">
                          <div className="text-xs text-muted">联系单金额</div>
                          <div className="mt-1 truncate text-lg font-extrabold text-brand-cyan">{formattedOrderAmount}</div>
                        </div>
                      </div>

                      {resultFlow ? (
                        <div className="grid grid-cols-2 divide-x divide-border rounded-xl border border-border bg-surface-muted/55">
                          <div className="min-w-0 px-3 py-2.5">
                            <div className="text-xs text-muted">业务类型</div>
                            <div className="mt-1 text-sm font-bold text-ink">{s.business_type}</div>
                          </div>
                          <div className="min-w-0 px-3 py-2.5">
                            <div className="text-xs text-muted">执行口径</div>
                            <div className="mt-1 text-sm font-bold text-ink">{s.is_historical ? '历史结果归档' : '直接安排发货'}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 divide-x divide-border rounded-xl border border-border bg-surface-muted/55">
                          <div className="min-w-0 px-3 py-2.5">
                            <div className="text-xs text-muted">生产日期</div>
                            <div className="mt-1 text-sm font-bold text-ink">{s.production_date || '未设置'}</div>
                          </div>
                          <div className="min-w-0 px-3 py-2.5">
                            <div className="text-xs text-muted">失效日期</div>
                            <div className="mt-1 text-sm font-bold text-ink">{s.expiry_date || '未设置'}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-3 border-t border-border bg-surface-muted/25 px-4 py-4 sm:px-5">
                    <ProgressBar steps={steps} compact />
                    <div className="flex flex-col gap-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
                      {resultFlow ? (
                        <div className="flex flex-wrap gap-x-5 gap-y-1">
                          <span>发货 <strong className="text-body">{shipmentCompleted ? '已完成' : s.shipped_quantity > 0 ? '部分完成' : '未完成'}</strong></span>
                          <span>收款 <strong className="text-body">{paymentCompleted ? '已收齐' : '未收齐'}</strong></span>
                          <span>开票 <strong className="text-body">{invoiceCompleted ? '已完成' : '未完成'}</strong></span>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-x-5 gap-y-1">
                          <span>入库 <strong className="text-body">{s.actual_warehousing_date || '未完成'}</strong></span>
                          <span>放行 <strong className="text-body">{s.actual_release_date || '未完成'}</strong></span>
                          <span>预计放行 <strong className="text-body">{s.estimated_release_date || '未确认'}</strong></span>
                        </div>
                      )}
                      <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                        {!contractObj?.archived && (
                          <IconButton onClick={(event) => { event.stopPropagation(); handleOpenCopy(s); }} label="复制联系单" tone="primary" icon={<Copy className="h-4 w-4" />} />
                        )}
                        <IconButton onClick={(event) => { event.stopPropagation(); void handleDelete(s.id); }} label="删除联系单" tone="danger" icon={<Trash2 className="h-4 w-4" />} />
                        {s.business_type === '制剂' && (
                          <Button onClick={() => handleOpenBatchEditor(s.id)} tone="secondary" size="sm" icon={<Layers className="h-3.5 w-3.5" />}>
                            管理批次
                          </Button>
                        )}
                        <Button onClick={() => setSelectedSheetDetail(s)} tone="subtle" size="sm">查看完整详情</Button>
                      </div>
                    </div>
                  </div>
                </article>
              </React.Fragment>
            );

          })
        ) : (
          <div className="py-16 text-center text-slate-500 text-sm glass-panel rounded-2xl">
            暂无匹配的联系单记录，请检查筛选或点击上方新建
          </div>
        )}
      </div>

      <PaginationControls {...contactSheetPage} onPageChange={contactSheetPage.setPage} itemLabel="条联系单" />

      {/* Edit/Add Contact Sheet Modal */}
      {showFormModal && (
        <Dialog onClose={() => { void requestCloseForm(); }} ariaLabel={editingId ? '编辑联系单流程' : '录入新联系单'}>
          <div className="dialog-panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <h3 className="font-heading text-lg font-bold text-ink">
                  {editingId ? '编辑联系单流程' : '录入新联系单'}
                </h3>
                <p className="mt-1 text-[11px] text-muted">按业务阶段分区填写，带 <span className="text-brand-rose">*</span> 的字段为必填项。</p>
              </div>
              <IconButton onClick={() => { void requestCloseForm(); }} label="关闭联系单表单" icon={<X className="h-5 w-5" />} />
            </header>

            <form noValidate onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col text-xs">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
                {editingSheet && (
                  <div className="flex items-start gap-3 rounded-xl border border-brand-amber/30 bg-brand-amber/10 px-4 py-3 text-brand-amber">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="space-y-1">
                      <div className="font-bold">正在编辑已有联系单，请先核对业务身份</div>
                      <div className="text-[11px] leading-relaxed text-body">
                        合同 <span className="font-bold text-ink">{editingContract?.contract_no || editingSheet.contract_no}</span>
                        <span className="px-1.5 text-subtle">|</span>
                        联系单 <span className="font-bold text-ink">{editingSheet.contact_sheet_no || '未填写'}</span>
                        <span className="px-1.5 text-subtle">|</span>
                        物料 <span className="font-bold text-ink">{editingSheet.material_no}</span>
                        <span className="px-1.5 text-subtle">|</span>
                        {editingSheet.product_name}
                      </div>
                      <div className="text-[10px] text-muted">所属合同已锁定；修改联系单号时还会再次要求确认。</div>
                    </div>
                  </div>
                )}

                {Object.keys(formErrors).length > 0 && (
                  <div role="alert" className="flex items-center gap-2 rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-3.5 py-2.5 text-[11px] font-medium text-brand-rose">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    请检查下方标红字段，修正后再保存。
                  </div>
                )}

                <ContactSheetFormSection
                  icon={<FileText className="h-4 w-4" />}
                  tone="blue"
                  title="合同与产品"
                  description="先确认来源合同和产品身份，避免相似物料或同名产品串单。"
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <FormField label="业务类型" required hint="原料药不进入 QA、排产、入库和放行流程。" htmlFor="contact-business-type">
                      <select
                        id="contact-business-type"
                        value={businessType}
                        onChange={(event) => handleBusinessTypeChange(event.target.value as '制剂' | '原料药')}
                        className={contactSheetInputClass()}
                      >
                        <option value="制剂">制剂</option>
                        <option value="原料药">原料药</option>
                      </select>
                    </FormField>
                    <FormField
                      label="所属销售合同"
                      required
                      error={formErrors.contractId}
                      hint={editingId ? '普通编辑不能更换所属合同。' : '只能保存下拉列表中已有的合同。'}
                      className="md:col-span-2 xl:col-span-3"
                    >
                      {editingId ? (
                        <div className="flex min-h-10 items-center gap-2.5 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-sm text-body" aria-label="已锁定的所属销售合同">
                          <Lock className="h-4 w-4 shrink-0 text-muted" />
                          <span className="min-w-0 truncate font-semibold text-ink">{selectedContract?.contract_no || editingContract?.contract_no}</span>
                          <span className="min-w-0 truncate text-xs text-muted">{selectedContract?.customer_name || editingContract?.customer_name}</span>
                        </div>
                      ) : (
                        <SearchableCombobox
                          ref={contractInputRef}
                          value={contractId}
                          onChange={handleContractChange}
                          options={selectableContracts.map(contract => ({
                            value: contract.id,
                            label: `${contract.contract_no} (${contract.customer_name})`,
                            searchText: contract.contract_no
                          }))}
                          ariaLabel="所属销售合同"
                          placeholder="请选择已有销售合同"
                          searchPlaceholder="输入合同号搜索"
                          emptyMessage="没有匹配的已有合同"
                          invalid={Boolean(formErrors.contractId)}
                        />
                      )}
                    </FormField>
                    <FormField label="联系单号" hint={businessType === '原料药' ? '原料药允许一直留空。' : '允许暂时留空，后续补录。'} htmlFor="contact-sheet-no">
                      <input
                        id="contact-sheet-no"
                        type="text"
                        value={contactSheetNo}
                        onChange={(e) => setContactSheetNo(e.target.value)}
                        placeholder="如 B260882"
                        className={contactSheetInputClass()}
                      />
                    </FormField>
                    <FormField label="物料号" required error={formErrors.materialNo} htmlFor="contact-material-no">
                      <input
                        ref={materialNoRef}
                        id="contact-material-no"
                        type="text"
                        value={materialNo}
                        onChange={(e) => {
                          setMaterialNo(e.target.value);
                          clearFormError('materialNo');
                        }}
                        placeholder="如 FF11264"
                        aria-invalid={Boolean(formErrors.materialNo) || undefined}
                        className={contactSheetInputClass(Boolean(formErrors.materialNo))}
                      />
                    </FormField>
                    {editingSheet?.is_historical && !productVariantId ? (
                      <>
                        <FormField label="历史产品名称快照" required error={formErrors.productName} className="md:col-span-2" htmlFor="contact-product-name" hint="历史导入记录允许保留原文字；不会反向创建产品主数据。">
                          <input ref={productNameRef} id="contact-product-name" type="text" value={productName} onChange={(event) => setProductName(event.target.value)} aria-invalid={Boolean(formErrors.productName) || undefined} className={contactSheetInputClass(Boolean(formErrors.productName))} />
                        </FormField>
                        <FormField label="历史规格快照" htmlFor="contact-specification"><input id="contact-specification" type="text" value={specification} onChange={(event) => setSpecification(event.target.value)} className={contactSheetInputClass()} /></FormField>
                      </>
                    ) : (
                      <FormField
                        label="标准产品及规格"
                        required
                        error={formErrors.productVariantId}
                        className="md:col-span-3"
                        hint={masterProductsError || '只能选择产品主数据中已有的启用规格；保存时自动移除多余空格并写入产品名称与规格快照。没有所需选项时，请先到产品主数据维护。'}
                      >
                        <SearchableCombobox
                          ref={productNameRef}
                          value={productVariantId}
                          onChange={handleProductVariantChange}
                          options={productVariantOptions}
                          ariaLabel="选择标准产品及规格"
                          placeholder="选择产品主数据中的产品规格"
                          searchPlaceholder="搜索产品编号、中文名、英文名、别名、剂型或规格"
                          emptyMessage="没有匹配的产品规格，请先到产品主数据维护"
                          invalid={Boolean(formErrors.productVariantId)}
                        />
                        {productVariantId && (
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
                            <span className="rounded-md border border-border bg-surface px-2 py-1">产品快照：{productName}</span>
                            <span className="rounded-md border border-border bg-surface px-2 py-1">规格快照：{specification || '无规格'}</span>
                          </div>
                        )}
                      </FormField>
                    )}
                    {businessType === '制剂' && <FormField label="质量标准" htmlFor="contact-quality-standard">
                      <input
                        id="contact-quality-standard"
                        type="text"
                        value={qualityStandard}
                        onChange={(e) => setQualityStandard(e.target.value)}
                        placeholder="如 USP / EP"
                        className={contactSheetInputClass()}
                      />
                    </FormField>}
                  </div>
                </ContactSheetFormSection>

                <ContactSheetFormSection
                  icon={<Package className="h-4 w-4" />}
                  tone="amber"
                  title={businessType === '原料药' ? '原料药计价' : '包装与计价'}
                  description={businessType === '原料药' ? '原料药只需确认单价、数量和限定计量单位；小计自动计算。' : '包装模板可以暂空；资料齐全后再编辑联系单补选，装箱信息只从模板读取。'}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {businessType === '制剂' && <FormField
                      label="包装模板"
                      className="lg:col-span-4"
                      hint={packagingProfilesError || '选填。下拉项会同时显示外箱外径，优先核对尺寸是否与本次发货一致。'}
                    >
                      <SearchableCombobox
                        ref={packagingTemplateRef}
                        value={packagingVersionId}
                        onChange={handlePackagingVersionChange}
                        options={packagingProfileOptions}
                        ariaLabel="选择包装模板"
                        placeholder={packaging || '可暂不选择；后续编辑补充'}
                        searchPlaceholder="搜索包装编号、产品、物料号、规格、车间或外箱尺寸"
                        emptyMessage="没有匹配的已确认包装模板，请先到包装主数据维护"
                        invalid={Boolean(formErrors.pcsPerCarton)}
                      />
                      {selectedPackagingProfile && <div className="mt-3 grid gap-3 rounded-xl border border-brand-emerald/25 bg-brand-emerald/5 p-3 text-[11px] text-muted sm:grid-cols-2 lg:grid-cols-[minmax(0,1.8fr)_minmax(110px,1fr)_minmax(130px,1fr)_minmax(150px,1.2fr)]"><span><span className="block text-[10px] text-subtle">当前包装</span><strong className="mt-0.5 block text-ink">{selectedPackagingProfile.packaging_description}</strong></span><span><span className="block text-[10px] text-subtle">生产车间</span><strong className="mt-0.5 block text-ink">{selectedPackagingProfile.workshop || '未填写'}</strong></span><span><span className="block text-[10px] text-subtle">每箱装量</span><strong className="mt-0.5 block text-ink">{Number(selectedPackagingProfile.quantity_per_carton).toLocaleString()} {selectedPackagingProfile.quantity_unit}</strong></span><span><span className="block text-[10px] text-subtle">外箱外径</span><strong className="mt-0.5 block text-brand-emerald">{selectedPackagingProfile.carton_outer_length_mm && selectedPackagingProfile.carton_outer_width_mm && selectedPackagingProfile.carton_outer_height_mm ? `${selectedPackagingProfile.carton_outer_length_mm}×${selectedPackagingProfile.carton_outer_width_mm}×${selectedPackagingProfile.carton_outer_height_mm} mm` : '待维护'}</strong></span></div>}
                      {formErrors.pcsPerCarton && <p className="mt-1 text-xs text-brand-rose">{formErrors.pcsPerCarton}</p>}
                    </FormField>}
                    <FormField label={`单价（${selectedContract?.currency || 'USD/RMB'}）`} required error={formErrors.unitPrice} htmlFor="contact-unit-price">
                      <input
                        ref={unitPriceRef}
                        id="contact-unit-price"
                        type="number"
                        min="0"
                        step="0.001"
                        value={unitPrice || ''}
                        onChange={(e) => {
                          setUnitPrice(parseFloat(e.target.value) || 0);
                          clearFormError('unitPrice');
                        }}
                        aria-invalid={Boolean(formErrors.unitPrice) || undefined}
                        className={contactSheetInputClass(Boolean(formErrors.unitPrice))}
                      />
                    </FormField>
                    <FormField label="数量" required error={formErrors.quantity} htmlFor="contact-quantity">
                      <input
                        ref={quantityRef}
                        id="contact-quantity"
                        type="number"
                        min="0"
                        step="0.001"
                        value={quantity || ''}
                        onChange={(e) => {
                          setQuantity(parseFloat(e.target.value) || 0);
                          clearFormError('quantity');
                        }}
                        aria-invalid={Boolean(formErrors.quantity) || undefined}
                        className={contactSheetInputClass(Boolean(formErrors.quantity))}
                      />
                    </FormField>
                    <FormField label="计量单位" required error={formErrors.unit} hint="只能选择固定单位，不允许自由输入。" htmlFor="contact-unit">
                      <select
                        ref={businessType === '原料药' ? unitSelectRef : unitInputRef}
                        id="contact-unit"
                        value={unit}
                        onChange={(e) => {
                          setUnit(e.target.value);
                          clearFormError('unit');
                        }}
                        aria-invalid={Boolean(formErrors.unit) || undefined}
                        className={contactSheetInputClass(Boolean(formErrors.unit))}
                      >
                        {CONTACT_SHEET_UNIT_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="毛重（kg）" hint="选填。填写本条联系单对应货物的毛重。" htmlFor="contact-gross-weight">
                      <input
                        id="contact-gross-weight"
                        type="number"
                        min="0"
                        step="0.001"
                        value={grossWeightKg}
                        onChange={(event) => setGrossWeightKg(event.target.value === '' ? '' : Number(event.target.value))}
                        placeholder="可留空"
                        className={contactSheetInputClass()}
                      />
                    </FormField>
                    <FormField label="订单小计" hint="系统根据单价 × 数量自动计算。">
                      <div className="flex min-h-10 items-center gap-2 rounded-[10px] border border-dashed border-border-strong bg-surface px-3 py-2.5" aria-label="自动计算的订单小计">
                        <Calculator className="h-4 w-4 text-brand-cyan" />
                        <span className="text-sm font-bold text-ink">
                          {selectedContract?.currency === 'RMB' ? '¥' : '$'}{(unitPrice * quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                        </span>
                      </div>
                    </FormField>
                  </div>
                </ContactSheetFormSection>

                {businessType === '制剂' && <ContactSheetFormSection
                  icon={<CalendarDays className="h-4 w-4" />}
                  tone="purple"
                  title="包材实际印刷上的效期"
                  description="录入包材实际印刷的生产日期与失效日期；系统会按客户默认有效期计算，结果仍可手动调整。"
                >
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <FormField
                      label="客户确认包装稿日期"
                      hint="只记录当前产品；全部联系单填写后，合同会自动汇总为最晚确认日期。"
                      htmlFor="contact-packaging-confirmed-date"
                    >
                      <input
                        id="contact-packaging-confirmed-date"
                        type="date"
                        value={packagingConfirmedDate}
                        onChange={(e) => setPackagingConfirmedDate(e.target.value)}
                        className={contactSheetInputClass()}
                      />
                    </FormField>
                    <FormField label="生产日期（MM/YYYY）" htmlFor="contact-production-date">
                      <input
                        id="contact-production-date"
                        type="text"
                        value={productionDate}
                        onChange={(e) => handleProdDateChange(e.target.value)}
                        placeholder="如 07/2026"
                        className={contactSheetInputClass()}
                      />
                    </FormField>
                    <FormField label="失效日期（MM/YYYY）" hint="自动计算，可手动调整。" htmlFor="contact-expiry-date">
                      <input
                        id="contact-expiry-date"
                        type="text"
                        value={expiryDate}
                        onChange={(e) => setExpiryDate(e.target.value)}
                        placeholder="如 06/2029"
                        className={contactSheetInputClass()}
                        data-field-state="derived"
                      />
                    </FormField>
                    <label className="flex min-h-[66px] cursor-pointer items-center gap-3 rounded-[10px] border border-border bg-surface px-3.5 py-3 text-sm text-body">
                      <input
                        type="checkbox"
                        checked={isStaggeredMonth}
                        onChange={(e) => handleStaggeredChange(e.target.checked)}
                        className="h-4 w-4 rounded border-border-strong text-brand-cyan focus:ring-brand-cyan"
                      />
                      <span>
                        <span className="block font-semibold text-ink">失效日期错月</span>
                        <span className="mt-0.5 block text-[10px] text-muted">沿用当前客户的有效期计算规则</span>
                      </span>
                    </label>
                  </div>
                </ContactSheetFormSection>}

                {businessType === '制剂' && <ContactSheetFormSection
                  icon={<Workflow className="h-4 w-4" />}
                  tone="green"
                  title="排产与放行"
                  description="按实际掌握的节点补录；空白日期不会阻止保存。"
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <FormField label="QA 审核完成日期" htmlFor="contact-qa-date">
                      <input id="contact-qa-date" type="date" value={qaApprovalDate} onChange={(e) => setQaApprovalDate(e.target.value)} className={contactSheetInputClass()} />
                    </FormField>
                    <FormField label="排产日期" htmlFor="contact-aps-date">
                      <input id="contact-aps-date" type="date" value={apsScheduledDate} onChange={(e) => setApsScheduledDate(e.target.value)} className={contactSheetInputClass()} />
                    </FormField>
                    <FormField label="实际入库日期" htmlFor="contact-warehouse-date">
                      <input id="contact-warehouse-date" type="date" value={actualWarehousingDate} onChange={(e) => setActualWarehousingDate(e.target.value)} className={contactSheetInputClass()} />
                    </FormField>
                    <FormField label="预计放行日期" hint="用于排期提醒，不代表已经放行。" htmlFor="contact-estimated-release-date">
                      <input id="contact-estimated-release-date" type="date" value={estimatedReleaseDate} onChange={(e) => setEstimatedReleaseDate(e.target.value)} className={contactSheetInputClass()} />
                    </FormField>
                    <FormField label="实际放行日期" htmlFor="contact-release-date">
                      <input id="contact-release-date" type="date" value={actualReleaseDate} onChange={(e) => setActualReleaseDate(e.target.value)} className={contactSheetInputClass()} />
                    </FormField>

                  </div>
                </ContactSheetFormSection>}
                {businessType === '原料药' && (
                  <div className="rounded-xl border border-brand-cyan/25 bg-brand-cyan/10 px-4 py-3 text-xs leading-6 text-body">
                    原料药将直接进入“合同 → 发货 → 收款 → 开票 → 完成”流程，不查询 QA 邮箱或排产系统，也不要求先建批次、入库或放行。
                  </div>
                )}
              </div>

              <footer className="flex shrink-0 flex-col gap-3 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="text-[11px] text-muted">保存前会再次检查合同归属和必填字段，避免误改其他联系单。</div>
                <div className="flex justify-end gap-3">
                  <Button type="button" onClick={() => { void requestCloseForm(); }} tone="secondary">
                    取消
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving ? '保存中...' : '确认保存'}
                  </Button>
                </div>
              </footer>
            </form>
          </div>
        </Dialog>
      )}

      {/* Batch Split Modal */}
      {showBatchModal && (
        <Dialog onClose={() => setShowBatchModal(false)} ariaLabel="联系单批次拆分">
          <div className="dialog-panel w-full max-w-lg p-6 space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="font-heading font-bold text-lg text-white">
                联系单批次拆分
              </h3>
              <IconButton onClick={() => setShowBatchModal(false)} label="关闭批次拆分" icon={<X className="w-5 h-5" />} />
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-3 bg-white/[0.01] border border-white/[0.04] rounded-lg space-y-1.5 text-[11px] leading-relaxed text-slate-300">
                <p>支持自动批量解析连号及并列号，例如：</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li><code className="text-[10px] py-0">2601115-2601119</code> 将解析为 5 个连续批号</li>
                  <li><code className="text-[10px] py-0">2601115-19</code> 同样解析为 5 个连续批号</li>
                  <li><code className="text-[10px] py-0">2601115/2601119</code> 将解析为 2 个并列批号</li>
                  <li><code className="text-[10px] py-0">2601115-19：30000；2601120-22：25000</code> 可分组填写每批数量</li>
                </ul>
                <p className="mt-1.5 text-brand-cyan">未填写每批数量时自动平均分摊；多组数量请用分号或换行隔开。</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-400">输入批号文本</label>
                <div className="flex items-stretch gap-2">
                  <textarea
                    rows={2}
                    value={batchNoStr}
                    onChange={(e) => setBatchNoStr(e.target.value)}
                    placeholder="如 2601115-19，或 2601115-19：30000；2601120-22：25000"
                    className="min-h-[58px] flex-1 resize-y bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2 text-slate-200"
                  />
                  <Button
                    onClick={handleParseBatchText}
                    tone="secondary"
                  >
                    开始解析
                  </Button>
                </div>
              </div>

              {/* Batch list rows editor */}
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                <div className="font-semibold text-slate-400 block pb-1 border-b border-white/[0.04]">拆分批次结果 ({batchList.length})</div>
                {batchList.length > 0 ? (
                  batchList.map((b, idx) => (
                    <div key={idx} className="flex items-center gap-3 py-1">
                      <span className="w-6 text-slate-500 font-bold">{idx + 1}</span>
                      <input
                        type="text"
                        value={b.batch_no}
                        onChange={(e) => {
                          const copy = [...batchList];
                          copy[idx].batch_no = e.target.value;
                          setBatchList(copy);
                        }}
                        className="w-1/2 bg-slate-900/60 border border-white/[0.04] rounded px-2.5 py-1 text-slate-200"
                      />
                      <input
                        type="number"
                        value={b.batch_quantity}
                        onChange={(e) => {
                          const copy = [...batchList];
                          copy[idx].batch_quantity = Number(e.target.value) || 0;
                          setBatchList(copy);
                        }}
                        className="w-1/3 bg-slate-900/60 border border-white/[0.04] rounded px-2.5 py-1 text-slate-200"
                      />
                      <button
                        onClick={() => {
                          setBatchList(batchList.filter((_, i) => i !== idx));
                        }}
                        className="text-brand-rose hover:underline"
                      >
                        删除
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="text-slate-500 text-center py-6 italic">暂未解析出拆分批号，请在上方输入开始解析。</div>
                )}
              </div>

              {batchList.length > 0 && (() => {
                const targetQuantity = sheets.find((sheet) => sheet.id === selectedSheetId)?.quantity || 0;
                const parsedQuantity = batchList.reduce((sum, batch) => sum + batch.batch_quantity, 0);
                const difference = parsedQuantity - targetQuantity;
                return (
                  <div className={`rounded-lg border px-3 py-2 text-[11px] ${difference === 0 ? 'border-brand-emerald/20 bg-brand-emerald/10 text-brand-emerald' : 'border-brand-amber/20 bg-brand-amber/10 text-brand-amber'}`}>
                    已分摊 {parsedQuantity.toLocaleString()} / 联系单 {targetQuantity.toLocaleString()}
                    {difference !== 0 && `（差额 ${difference > 0 ? '+' : ''}${difference.toLocaleString()}）`}
                  </div>
                );
              })()}

              <div className="pt-4 border-t border-white/[0.06] flex justify-end gap-3 text-sm">
                <Button
                  onClick={() => setShowBatchModal(false)}
                  tone="secondary"
                >
                  取消
                </Button>
                <Button
                  onClick={handleSaveBatches}
                  disabled={isSaving}
                >
                  {isSaving ? '保存中...' : '保存并同步批次'}
                </Button>
              </div>

            </div>
          </div>
        </Dialog>
      )}
      {/* Contact Sheet Detail View Modal */}
      {selectedSheetDetail && (() => {
        const s = selectedSheetDetail;
        const matchedContract = contracts.find(c => c.id === s.contract_id);
        const sheetBatches = batches.filter(b => b.contact_sheet_id === s.id);
        const totalSplitQty = sheetBatches.reduce((sum, b) => sum + b.batch_quantity, 0);
        const splitPercentage = Math.round((totalSplitQty / s.quantity) * 100);

        return (
          <Dialog onClose={() => setSelectedSheetDetail(null)} ariaLabel="销售联系单业务详情">
            <div className="dialog-panel w-full max-w-4xl p-6 space-y-6 max-h-[95vh] overflow-y-auto">
              {/* Header */}
              <div className="flex justify-between items-start border-b border-white/[0.04] pb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-500 text-xs font-semibold uppercase tracking-wider">销售联系单业务详情</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      s.status === '发货完成' ? 'bg-brand-emerald/10 text-brand-emerald' : 'bg-brand-cyan/10 text-brand-cyan'
                    }`}>
                      {s.status}
                    </span>
                  </div>
                  <h3 className="font-heading font-bold text-xl text-white mt-1">
                    {s.contact_sheet_no || '未命名联系单'}
                  </h3>
                </div>
                <IconButton onClick={() => setSelectedSheetDetail(null)} label="关闭联系单详情" icon={<X className="w-5 h-5" />} />
              </div>

              {/* 2-Column Info Grid */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
                {/* Left Side: Specifications and Basics */}
                <div className="md:col-span-5 space-y-4 bg-white/[0.01] border border-white/[0.03] p-4 rounded-xl text-xs flex flex-col justify-between">
                  <div>
                    <h4 className="font-bold text-slate-300 border-b border-white/[0.04] pb-1.5 mb-2.5">📋 联系单规格档案</h4>
                    <table className="w-full text-left space-y-2 text-slate-400">
                      <tbody>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">产品名称</td>
                          <td className="py-2 text-slate-100 font-bold">{s.product_name}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">物料编号</td>
                          <td className="py-2 text-slate-200 font-semibold font-mono">{s.material_no}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">规格型号</td>
                          <td className="py-2 text-slate-200">{s.specification}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">包装规格</td>
                          <td className="py-2 text-slate-200">{s.packaging}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">每箱装量</td>
                          <td className="py-2 text-slate-200 font-semibold">{s.pcs_per_carton ? `${s.pcs_per_carton.toLocaleString()} ${s.unit}/箱` : '未设置'}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">毛重</td>
                          <td className="py-2 text-slate-200 font-semibold">{s.gross_weight_kg ? `${s.gross_weight_kg.toLocaleString()} kg` : '未填写'}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">质量标准</td>
                          <td className="py-2 text-slate-200">{s.quality_standard}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">所属合同</td>
                          <td className="py-2 text-slate-200 font-semibold">{s.contract_no}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">客户名称</td>
                          <td className="py-2 text-slate-100 font-bold">{matchedContract?.customer_name || '未知客户'}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">出口国家</td>
                          <td className="py-2 text-slate-200">{s.country || '未填写'}</td>
                        </tr>
                        <tr className="border-b border-white/[0.02]">
                          <td className="py-2 font-medium">出口类型</td>
                          <td className="py-2 text-slate-200 font-semibold">{s.export_type || '未选择'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="bg-slate-800/40 p-3 rounded-lg border border-slate-700/50 mt-2 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">订货总量:</span>
                      <span className="font-bold text-white">{s.quantity.toLocaleString()} {s.unit}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">合同原值:</span>
                      <span className="font-bold text-brand-cyan">${(s.quantity * s.unit_price).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Right Side: Detailed Batch List */}
                <div className="md:col-span-7 space-y-4 bg-white/[0.01] border border-white/[0.03] p-4 rounded-xl flex flex-col">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.04] pb-2">
                    <h4 className="font-bold text-slate-300">{s.business_type === '原料药' ? '📦 原料药发货规则' : '📦 批次分摊与追踪看板'}</h4>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                        splitPercentage === 100
                          ? 'bg-brand-emerald/10 text-brand-emerald'
                          : splitPercentage > 100
                            ? 'bg-brand-rose/10 text-brand-rose'
                            : 'bg-brand-amber/10 text-brand-amber'
                      }`}>
                        分摊率: {splitPercentage}% ({totalSplitQty.toLocaleString()} / {s.quantity.toLocaleString()})
                      </span>
                      {s.business_type === '制剂' && <Button
                        onClick={() => {
                          setSelectedSheetDetail(null);
                          handleOpenBatchEditor(s.id);
                        }}
                        tone="secondary"
                        size="sm"
                        icon={<Layers className="h-4 w-4" />}
                      >
                        管理批次
                      </Button>}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto max-h-[300px] text-xs space-y-2">
                    {s.business_type === '原料药' ? (
                      <div className="h-full flex flex-col items-center justify-center py-12 text-slate-500 text-center space-y-2">
                        <Package className="h-7 w-7 text-brand-cyan" />
                        <p className="font-semibold text-body">原料药无需拆分生产批次</p>
                        <p className="text-[10px] text-slate-600 max-w-xs leading-normal">创建发货记录时可直接选择这条原料药明细并填写数量；批号允许为空。</p>
                      </div>
                    ) : sheetBatches.length > 0 ? (
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-white/[0.06] text-slate-500">
                            <th className="py-2 font-semibold">批号</th>
                            <th className="py-2 font-semibold text-right">分摊数量</th>
                            <th className="py-2 font-semibold text-right">折合箱数</th>
                            <th className="py-2 font-semibold text-center">状态阶段</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheetBatches.map((b) => (
                            <tr key={b.id} className="border-b border-white/[0.02] text-slate-300 hover:bg-white/[0.01] transition-colors">
                              <td className="py-2.5 font-bold font-mono text-slate-200">{b.batch_no}</td>
                              <td className="py-2.5 text-right font-semibold text-white">{b.batch_quantity.toLocaleString()} {s.unit}</td>
                              <td className="py-2.5 text-right text-slate-300 font-medium">
                                {s.pcs_per_carton ? `${(b.batch_quantity / s.pcs_per_carton).toFixed(1)} 箱` : '-'}
                              </td>
                              <td className="py-2.5 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  s.actual_release_date
                                    ? 'bg-brand-emerald/10 text-brand-emerald'
                                    : s.actual_warehousing_date
                                      ? 'bg-brand-amber/10 text-brand-amber'
                                      : 'bg-slate-800 text-slate-400'
                                }`}>
                                  {s.actual_release_date ? '已放行' : s.actual_warehousing_date ? '已入库' : '排产生产中'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center py-12 text-slate-500 text-center space-y-2">
                        <span className="text-xl">📦</span>
                        <p className="italic">该联系单尚未分摊具体生产批次</p>
                        <p className="text-[10px] text-slate-600 max-w-xs leading-normal">点击上方「管理批次」，可通过智能批号解析器快速录入并分摊批次数据。</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Close Button */}
              <div className="pt-4 border-t border-white/[0.06] flex items-center justify-between gap-3">
                <button
                  onClick={() => handleOpenHistory(s)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-amber/10 hover:bg-brand-amber/20 text-brand-amber rounded-xl text-xs font-bold transition-colors border border-brand-amber/20"
                >
                  <History className="h-4 w-4" />
                  修改历史与回退
                </button>
                <button
                  onClick={() => setSelectedSheetDetail(null)}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-colors"
                >
                  关闭详情
                </button>
              </div>

            </div>
          </Dialog>
        );
      })()}

      {historySheet && (
        <Dialog onClose={() => setHistorySheet(null)} ariaLabel="联系单修改历史" className="bg-black/70">
          <div className="dialog-panel w-full max-w-3xl space-y-5 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-white/[0.05] pb-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-brand-amber">
                  <History className="h-4 w-4" />
                  <span className="text-xs font-bold">联系单修改历史</span>
                </div>
                <h3 className="text-lg font-bold text-white">
                  {historySheet.contact_sheet_no || '未填写联系单号'} · {historySheet.product_name}
                </h3>
                <p className="text-xs text-slate-400">
                  合同 {historySheet.contract_no} · 物料 {historySheet.material_no} · 每次回退也会自动保留记录
                </p>
              </div>
              <IconButton
                type="button"
                onClick={() => setHistorySheet(null)}
                label="关闭修改历史"
                icon={<X className="h-5 w-5" />}
              />
            </div>

            {historyError && (
              <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">
                {historyError}
              </div>
            )}

            {historyLoading ? (
              <div className="py-12 text-center text-sm text-slate-400">正在读取修改历史…</div>
            ) : historyEntries.length === 0 ? (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-5 py-10 text-center text-sm text-slate-400">
                暂无可回退的修改记录。历史保护从本次修复上线后开始记录。
              </div>
            ) : (
              <div className="space-y-3">
                {historyEntries.map((entry) => {
                  const fieldLabels: Record<string, string> = {
                    contract_id: '所属合同',
                    contact_sheet_no: '联系单号',
                    material_no: '物料号',
                    product_variant_id: '标准产品规格关联',
                    product_name: '产品名称',
                    specification: '规格',
                    packaging: '包装',
                    packaging_confirmed_date: '客户确认包装稿日期',
                    quality_standard: '质量标准',
                    unit_price: '单价',
                    quantity: '数量',
                    unit: '计量单位',
                    pcs_per_carton: '每箱装量',
                    gross_weight_kg: '毛重',
                    production_date: '生产日期',
                    expiry_date: '失效日期',
                    qa_approval_date: 'QA 日期',
                    aps_scheduled_date: '日期',
                    actual_warehousing_date: '入库日期',
                    actual_release_date: '放行日期'
                  };
                  const changedFields = Object.keys(fieldLabels).filter(
                    field => String(entry.old_data[field] ?? '') !== String(entry.new_data[field] ?? '')
                  );
                  const oldContract = contracts.find(contract => contract.id === String(entry.old_data.contract_id || ''));
                  return (
                    <div key={entry.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="font-semibold text-slate-200">
                            {new Date(entry.changed_at).toLocaleString('zh-CN', { hour12: false })}
                          </div>
                          <div className="text-slate-400">
                            修改字段：{changedFields.length > 0 ? changedFields.map(field => fieldLabels[field]).join('、') : '系统字段'}
                          </div>
                          <div className="rounded-lg bg-slate-950/60 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
                            修改前：合同 <span className="font-semibold text-slate-200">{oldContract?.contract_no || '未知'}</span>
                            <span className="px-1.5 text-slate-700">|</span>
                            联系单 <span className="font-semibold text-slate-200">{String(entry.old_data.contact_sheet_no || '未填写')}</span>
                            <span className="px-1.5 text-slate-700">|</span>
                            物料 <span className="font-semibold text-slate-200">{String(entry.old_data.material_no || '未填写')}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={Boolean(restoringHistoryId)}
                          onClick={() => void handleRestoreHistory(entry)}
                          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-brand-amber/25 bg-brand-amber/10 px-3 py-2 font-bold text-brand-amber transition-colors hover:bg-brand-amber/20 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {restoringHistoryId === entry.id ? '回退中…' : '回退到修改前'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Dialog>
      )}

    </div>
  );
};
