import React, { useState, useMemo } from 'react';
import { db } from '../services/dataStore';
import { useCallback, useEffect } from 'react';
import { formatLocalDate } from '../services/dateUtils';
import { getRemainingShipmentQuantity, isShipmentBatchWarehoused, normalizeShipmentQuantity } from '../services/shipmentAvailability';
import { buildShipmentPlanDisplayRows, calculateShipmentDraftVolumeLines, canExportReceiptConfirmation, matchesShipmentFilters, sortShipmentWorklist, summarizeShipmentDraft, summarizeShipmentDraftVolume, summarizeShipmentSources, type ShipmentPlanDetailMode } from '../services/shipmentWorkspace';
import { getPhysicalShipmentRows, resolvePhysicalShipmentInvoice } from '../services/shipmentInvoicing';
import { getFiscalYearRange, isDateInRange } from '../services/fiscalYear';
import { Dialog } from '../components/Dialog';
import { FilterPanel, PageHeader } from '../components/PageHeader';
import { useFeedback } from '../components/FeedbackProvider';
import { FormField } from '../components/FormField';
import { SearchableCombobox } from '../components/SearchableCombobox';
import { CustomerSelect } from '../components/CustomerSelect';
import { IconButton } from '../components/IconButton';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { DataTable } from '../components/DataTable';
import { PaginationControls } from '../components/PaginationControls';
import { usePagedRows } from '../hooks/usePagedRows';
import { getBusinessStatusTone } from '../services/statusPresentation';
import { calculateShipmentPaymentCoverage, summarizeShipmentPaymentCoverage } from '../services/receivablesWorkspace';
import { loadPackagingVersions, type PackagingProfileVersion } from '../services/masterDataService';
import { findMissingMaterialNumberSheets, summarizeMissingMaterialNumbers } from '../services/materialNumberRules';
import { Plus, Search, Eye, Edit2, Trash2, X, FileSpreadsheet, FileText, Layers, RotateCcw, Truck, ReceiptText, PackageCheck, Eraser, Download, Boxes } from 'lucide-react';

interface ShipmentsProps {
  onRefreshData: () => void;
  onRefreshTrigger: number;
}

type ShipmentAllocation = {
  contact_sheet_id: string;
  batch_id: string;
  material_no: string;
  product_name: string;
  batch_no: string;
  availableQty: number;
  shippedQty: number;
  unitPrice: number;
  contact_sheet_no?: string;
  contract_no?: string;
  contract_id?: string;
  incoterm?: 'FOB' | 'CIF' | null;
  isWarehoused?: boolean;
};

function nextShipmentNumber(existingNumbers: string[], shipmentDate: string) {
  const datePart = shipmentDate.replace(/-/g, '');
  const prefix = `SH-${datePart}-`;
  const highestSequence = existingNumbers.reduce((highest, shipmentNo) => {
    if (!shipmentNo.startsWith(prefix)) return highest;
    const sequence = Number(shipmentNo.slice(prefix.length));
    return Number.isInteger(sequence) && sequence > highest ? sequence : highest;
  }, 0);
  return `${prefix}${String(highestSequence + 1).padStart(3, '0')}`;
}

export const Shipments: React.FC<ShipmentsProps> = ({ onRefreshData, onRefreshTrigger }) => {
  const { confirm, notify } = useFeedback();
  const fiscalRange = useMemo(() => getFiscalYearRange(), []);
  const [periodView, setPeriodView] = useState<'fiscal' | 'history'>('fiscal');
  const [searchQuery, setSearchQuery] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [contractFilter, setContractFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [invoiceFilter, setInvoiceFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [showShipmentExportModal, setShowShipmentExportModal] = useState(false);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [shipmentExportSelectionId, setShipmentExportSelectionId] = useState<string | null>(null);
  const [shipmentDetailMode, setShipmentDetailMode] = useState<ShipmentPlanDetailMode>('batch');
  const [shipmentExportDetailMode, setShipmentExportDetailMode] = useState<ShipmentPlanDetailMode>('batch');
  const [editingShipmentGroupId, setEditingShipmentGroupId] = useState<string | null>(null);
  const [invoiceShipmentId, setInvoiceShipmentId] = useState<string | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(formatLocalDate());
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [invoiceFreight, setInvoiceFreight] = useState('');
  const [invoiceError, setInvoiceError] = useState('');
  const [isInvoiceSaving, setIsInvoiceSaving] = useState(false);
  const [dispatchShipmentId, setDispatchShipmentId] = useState<string | null>(null);
  const [dispatchDate, setDispatchDate] = useState(formatLocalDate());
  const [dispatchNotes, setDispatchNotes] = useState('');
  const [dispatchAllocations, setDispatchAllocations] = useState<ShipmentAllocation[]>([]);
  const [dispatchError, setDispatchError] = useState('');
  const [isDispatchSaving, setIsDispatchSaving] = useState(false);
  const [exportingShipmentId, setExportingShipmentId] = useState<string | null>(null);
  const [exportingReceiptConfirmationId, setExportingReceiptConfirmationId] = useState<string | null>(null);

  // Add Form state
  const [customerId, setCustomerId] = useState('');
  const [shipmentNo, setShipmentNo] = useState('');
  const [shipmentDate, setShipmentDate] = useState(formatLocalDate());
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [showUnwarehousedSources, setShowUnwarehousedSources] = useState(false);
  const [packagingVersions, setPackagingVersions] = useState<PackagingProfileVersion[]>([]);
  const [packagingVersionsError, setPackagingVersionsError] = useState('');
  const [isPackagingVersionsLoading, setIsPackagingVersionsLoading] = useState(true);

  // Selected contract info for shipment quantities allocation
  const [shipmentAllocations, setShipmentAllocations] = useState<ShipmentAllocation[]>([]);

  // Load database lists
  const data = useMemo(() => {
    void onRefreshTrigger;
    const shipments = db.getShipments();
    const shipmentGroups = db.getShipmentGroups();
    const contracts = db.getContracts();
    const customers = db.getCustomers();
    const contactSheets = db.getContactSheets();
    const payments = db.getPayments();
    const invoices = db.getInvoices();
    const batches = db.getBatches();
    const allShipmentItems = db.getTable<any>('trade_shipment_items');
    return { shipments, shipmentGroups, contracts, customers, contactSheets, payments, invoices, batches, allShipmentItems };
  }, [onRefreshTrigger]);

  const { shipments, shipmentGroups, contracts, customers, contactSheets, payments, invoices, batches, allShipmentItems } = data;

  useEffect(() => {
    let active = true;
    setIsPackagingVersionsLoading(true);
    setPackagingVersionsError('');
    void loadPackagingVersions()
      .then((rows) => {
        if (active) setPackagingVersions(rows);
      })
      .catch((error) => {
        if (!active) return;
        setPackagingVersions([]);
        setPackagingVersionsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setIsPackagingVersionsLoading(false);
      });
    return () => { active = false; };
  }, [onRefreshTrigger]);

  const reservingShipmentIds = useMemo(
    () => new Set(shipments.filter((shipment) => shipment.status !== '取消').map((shipment) => shipment.id)),
    [shipments]
  );

  const shipmentPaymentCoverageFacts = useMemo(
    () => calculateShipmentPaymentCoverage({
      contracts,
      shipments,
      shipmentItems: allShipmentItems,
      payments,
      asOfDate: formatLocalDate()
    }),
    [contracts, shipments, allShipmentItems, payments]
  );

  const physicalShipments = useMemo(() => {
    const groupIds = new Set<string>();
    return shipments.flatMap((shipment) => {
      if (shipment.shipment_group_id && groupIds.has(shipment.shipment_group_id)) return [];
      if (shipment.shipment_group_id) groupIds.add(shipment.shipment_group_id);
      const children = getPhysicalShipmentRows(shipment, shipments);
      const settlement = summarizeShipmentPaymentCoverage(
        children.map((row) => row.id),
        shipmentPaymentCoverageFacts
      );
      const paymentCoverageReason = Array.from(new Set(children.map((row) => row.contract_id))).map((contractId) => {
        const contract = contracts.find((row) => row.id === contractId);
        if (!contract) return '';
        const contractCoverage = summarizeShipmentPaymentCoverage(
          children.filter((row) => row.contract_id === contractId).map((row) => row.id),
          shipmentPaymentCoverageFacts
        );
        const symbol = contract.currency === 'USD' ? '$' : '￥';
        return `合同 ${contract.contract_no}：本次发货 ${symbol}${contractCoverage.shipmentAmount.toLocaleString()}，已收覆盖 ${symbol}${contractCoverage.paidAmount.toLocaleString()}，未收 ${symbol}${contractCoverage.outstandingAmount.toLocaleString()}。`;
      }).filter(Boolean).join('\n');
      const amount = children.reduce((sum, row) => sum + row.amount, 0);
      const group = shipment.shipment_group_id
        ? shipmentGroups.find((row) => row.id === shipment.shipment_group_id)
        : null;
      const contract = contracts.find((row) => row.id === shipment.contract_id);
      const incoterm = shipment.currency === 'USD'
        ? (group?.incoterm || shipment.incoterm_snapshot || contract?.incoterm || 'FOB')
        : null;
      const freightInsuranceAmount = group?.freight_insurance_amount
        ?? (children.reduce((sum, row) => sum + Number(row.freight_insurance_amount || 0), 0) || null);
      const linkedPaidAmount = children.reduce((sum, row) => sum + row.linked_paid_amount, 0);
      const sourceSummary = summarizeShipmentSources(
        children.map(row => row.id),
        children.map(row => row.contract_no),
        allShipmentItems
      );
      const invoiceResolution = resolvePhysicalShipmentInvoice(children, invoices);
      return [{
        ...shipment,
        shipment_no: shipment.group_shipment_no || shipment.shipment_no,
        customer_id: shipment.customer_id || customers.find(customer => customer.name === shipment.customer_name)?.id,
        contract_no: sourceSummary.contractNos.join('、'),
        amount,
        incoterm,
        freight_insurance_amount: freightInsuranceAmount,
        linked_paid_amount: linkedPaidAmount,
        payment_check_status: settlement.status,
        payment_check_reason: paymentCoverageReason,
        payment_settlement_status: settlement.status,
        payment_settlement_reason: `合同级收款按发货日期先后抵扣。\n${paymentCoverageReason}`,
        sourceSummary,
        invoice_state: invoiceResolution.state,
        invoice: invoiceResolution.invoice
      }];
    });
  }, [shipments, shipmentGroups, allShipmentItems, customers, invoices, contracts, shipmentPaymentCoverageFacts]);

  const missingMaterialsForContactSheetIds = useCallback((contactSheetIds: Iterable<string>) => (
    findMissingMaterialNumberSheets(contactSheets, contactSheetIds)
  ), [contactSheets]);

  const missingMaterialsForPhysicalShipment = useCallback((shipmentId: string) => {
    const representative = physicalShipments.find((shipment) => shipment.id === shipmentId);
    if (!representative) return [];
    const childIds = new Set(getPhysicalShipmentRows(representative, shipments).map((shipment) => shipment.id));
    const contactSheetIds = allShipmentItems
      .filter((item: any) => childIds.has(item.shipment_id))
      .map((item: any) => String(item.contact_sheet_id || ''));
    return missingMaterialsForContactSheetIds(contactSheetIds);
  }, [allShipmentItems, missingMaterialsForContactSheetIds, physicalShipments, shipments]);

  // Filter physical shipment documents instead of showing one duplicate row per contract.
  const filteredShipments = useMemo(() => {
    const matched = physicalShipments.filter(shipment => {
      const inFiscalYear = isDateInRange(shipment.shipment_date, fiscalRange.startDate, fiscalRange.endDate);
      if (periodView === 'fiscal' ? !inFiscalYear : inFiscalYear) return false;
      return matchesShipmentFilters({
      shipmentNo: shipment.shipment_no,
      customerId: shipment.customer_id,
      customerName: shipment.customer_name,
      contractNos: shipment.sourceSummary.contractNos,
      contactSheetNos: shipment.sourceSummary.contactSheetNos,
      batchNos: shipment.sourceSummary.batchNos,
      shipmentDate: shipment.shipment_date,
      status: shipment.status
    }, {
      query: searchQuery,
      customerId: customerFilter,
      contractNo: contractFilter,
      dateFrom,
      dateTo,
      status: statusFilter
    }) && (!invoiceFilter || shipment.invoice_state === invoiceFilter);
    });
    return sortShipmentWorklist(matched);
  }, [physicalShipments, searchQuery, customerFilter, contractFilter, dateFrom, dateTo, statusFilter, invoiceFilter, periodView, fiscalRange]);
  const shipmentPage = usePagedRows(
    filteredShipments,
    `${periodView}|${searchQuery}|${customerFilter}|${contractFilter}|${dateFrom}|${dateTo}|${statusFilter}|${invoiceFilter}`
  );

  const shipmentPeriodCounts = useMemo(() => physicalShipments.reduce((counts, shipment) => {
    if (isDateInRange(shipment.shipment_date, fiscalRange.startDate, fiscalRange.endDate)) counts.fiscal += 1;
    else counts.history += 1;
    return counts;
  }, { fiscal: 0, history: 0 }), [physicalShipments, fiscalRange]);

  const contractFilterOptions = useMemo(() => contracts
    .filter(contract => !customerFilter || contract.customer_id === customerFilter)
    .map(contract => ({
      value: contract.contract_no,
      label: contract.contract_no,
      description: contract.customer_name,
      searchText: contract.contract_no
    })), [contracts, customerFilter]);

  const hasActiveFilters = Boolean(periodView !== 'fiscal' || searchQuery || customerFilter || contractFilter || dateFrom || dateTo || statusFilter || invoiceFilter);
  const clearFilters = () => {
    setPeriodView('fiscal');
    setSearchQuery('');
    setCustomerFilter('');
    setContractFilter('');
    setDateFrom('');
    setDateTo('');
    setStatusFilter('');
    setInvoiceFilter('');
  };

  // Selected shipment details modal data
  const selectedShipmentDetails = useMemo(() => {
    void onRefreshTrigger;
    if (!selectedShipmentId) return null;
    const shipment = shipments.find(s => s.id === selectedShipmentId);
    if (!shipment) return null;
    const children = shipment.shipment_group_id
      ? shipments.filter((row) => row.shipment_group_id === shipment.shipment_group_id)
      : [shipment];
    const items = children.flatMap((row) => db.getShipmentDetails(row.id).map((item) => ({
      ...item,
      contract_no: row.contract_no
    })));
    const volumeAllocations = items.map((item) => ({
      contact_sheet_id: item.contact_sheet_id,
      batch_id: item.batch_id || '',
      availableQty: item.shipped_quantity,
      shippedQty: item.shipped_quantity
    }));
    const volumeLines = calculateShipmentDraftVolumeLines(volumeAllocations, contactSheets, packagingVersions);
    return {
      shipment: {
        ...shipment,
        shipment_no: shipment.group_shipment_no || shipment.shipment_no,
        contract_no: Array.from(new Set(children.map((row) => row.contract_no))).join('、'),
        amount: children.reduce((sum, row) => sum + row.amount, 0)
      },
      items: items.map((item, index) => ({ ...item, volume: volumeLines[index] })),
      volumeSummary: summarizeShipmentDraftVolume(volumeAllocations, contactSheets, packagingVersions)
    };
  }, [selectedShipmentId, shipments, onRefreshTrigger, contactSheets, packagingVersions]);

  const selectedShipmentDisplayRows = useMemo(() => selectedShipmentDetails
    ? buildShipmentPlanDisplayRows(selectedShipmentDetails.items, shipmentDetailMode)
    : [], [selectedShipmentDetails, shipmentDetailMode]);

  const shipmentExportSelection = useMemo(
    () => physicalShipments.find((shipment) => shipment.id === shipmentExportSelectionId) || null,
    [physicalShipments, shipmentExportSelectionId]
  );

  const handleOpenAdd = () => {
    const today = formatLocalDate();
    setEditingShipmentGroupId(null);
    setCustomerId('');
    setShipmentNo(nextShipmentNumber([
      ...shipments.map((shipment) => shipment.group_shipment_no || shipment.shipment_no),
      ...shipmentGroups.map((group) => group.shipment_no)
    ], today));
    setShipmentDate(today);
    setNotes('');
    setShipmentAllocations([]);
    setShowUnwarehousedSources(false);
    setOperationError('');
    setShowAddModal(true);
  };

  const buildShipmentAllocations = useCallback((
    nextCustomerId: string,
    options: {
      fullContractId?: string;
      excludedShipmentIds?: Set<string>;
      currentItems?: any[];
      requiredIncoterm?: 'FOB' | 'CIF' | null;
    } = {}
  ) => {
    const excludedShipmentIds = options.excludedShipmentIds || new Set<string>();
    const currentItems = options.currentItems || [];
    const customerContractIds = new Set(contracts.filter((contract) => contract.customer_id === nextCustomerId).map((contract) => contract.id));
    const sheetsList = contactSheets.filter((sheet) => customerContractIds.has(sheet.contract_id));
    const allocationsList: typeof shipmentAllocations = [];

    sheetsList.forEach(sheet => {
      const contract = contracts.find((row) => row.id === sheet.contract_id);
      if (!contract || (options.requiredIncoterm !== undefined && (contract.incoterm || null) !== options.requiredIncoterm)) return;
      const sheetBatches = batches.filter(b => b.contact_sheet_id === sheet.id);

      if (sheet.business_type === '原料药' || sheet.is_historical) {
        const current = currentItems.find((item: any) => item.contact_sheet_id === sheet.id && !item.batch_id);
        const alreadyShipped = allShipmentItems
          .filter((item: any) => item.contact_sheet_id === sheet.id && !excludedShipmentIds.has(item.shipment_id) && reservingShipmentIds.has(item.shipment_id))
          .reduce((sum: number, item: any) => sum + item.shipped_quantity, 0);
        const available = normalizeShipmentQuantity(sheet.quantity - alreadyShipped);
        if (available > 0 || current) {
          allocationsList.push({
            contact_sheet_id: sheet.id,
            batch_id: '',
            material_no: sheet.material_no,
            product_name: sheet.product_name,
            batch_no: sheet.is_historical ? '历史数据未记录批次' : '原料药无需批号',
            availableQty: available,
            shippedQty: current ? Number(current.shipped_quantity || 0) : sheet.contract_id === options.fullContractId ? available : 0,
            unitPrice: Number(current?.unit_price || sheet.unit_price),
            contact_sheet_no: sheet.contact_sheet_no,
            contract_no: contract.contract_no,
            contract_id: sheet.contract_id,
            incoterm: contract.incoterm || null,
            isWarehoused: true
          });
        }
        return;
      }

      sheetBatches.forEach(batch => {
        const current = currentItems.find((item: any) => item.batch_id === batch.id);
        const alreadyShipped = allShipmentItems
          .filter((item: any) => item.batch_id === batch.id && !excludedShipmentIds.has(item.shipment_id) && reservingShipmentIds.has(item.shipment_id))
          .reduce((sum: number, item: any) => sum + item.shipped_quantity, 0);

        const availability = {
          ...batch,
          contact_warehouse_date: sheet.actual_warehousing_date
        };
        const isWarehoused = isShipmentBatchWarehoused(availability);
        const available = getRemainingShipmentQuantity(batch.batch_quantity, alreadyShipped);
        if (available <= 0 && !current) return;

        allocationsList.push({
          contact_sheet_id: sheet.id,
          batch_id: batch.id,
          material_no: sheet.material_no,
          product_name: sheet.product_name,
          batch_no: batch.batch_no,
          availableQty: available,
          shippedQty: current ? Number(current.shipped_quantity || 0) : isWarehoused && sheet.contract_id === options.fullContractId ? available : 0,
          unitPrice: Number(current?.unit_price || sheet.unit_price),
          contact_sheet_no: sheet.contact_sheet_no,
          contract_no: contract.contract_no,
          contract_id: sheet.contract_id,
          incoterm: contract.incoterm || null,
          isWarehoused
        });
      });
    });

    return allocationsList;
  }, [allShipmentItems, batches, contactSheets, contracts, reservingShipmentIds]);

  const handleSelectCustomer = useCallback((nextCustomerId: string, fullContractId = '') => {
    setCustomerId(nextCustomerId);
    setShowUnwarehousedSources(false);
    const allocationsList = buildShipmentAllocations(nextCustomerId, { fullContractId });
    setShipmentAllocations(allocationsList);
  }, [buildShipmentAllocations]);

  useEffect(() => {
    const quickContractId = sessionStorage.getItem('quick_shipment_contract_id');
    if (!quickContractId) return;
    const targetContract = contracts.find((contract) => contract.id === quickContractId);
    sessionStorage.removeItem('quick_shipment_contract_id');
    if (!targetContract) {
      notify({ title: '无法打开快捷发货', message: '目标合同不存在或数据尚未同步，请刷新后重试。', tone: 'warning' });
      return;
    }
    const today = formatLocalDate();
    setEditingShipmentGroupId(null);
    setCustomerId(targetContract.customer_id);
    setShipmentNo(nextShipmentNumber([
      ...shipments.map((shipment) => shipment.group_shipment_no || shipment.shipment_no),
      ...shipmentGroups.map((group) => group.shipment_no)
    ], today));
    setShipmentDate(today);
    setNotes('');
    setOperationError('');
    handleSelectCustomer(targetContract.customer_id, targetContract.id);
    setShowAddModal(true);
  }, [onRefreshTrigger, contracts, notify, shipmentGroups, shipments, handleSelectCustomer]);

  const visibleShipmentAllocations = useMemo(
    () => showUnwarehousedSources
      ? shipmentAllocations
      : shipmentAllocations.filter((row) => row.isWarehoused !== false),
    [shipmentAllocations, showUnwarehousedSources]
  );
  const unwarehousedSourceCount = useMemo(
    () => shipmentAllocations.filter((row) => row.isWarehoused === false).length,
    [shipmentAllocations]
  );
  const shipmentDraftSummary = useMemo(
    () => summarizeShipmentDraft(visibleShipmentAllocations),
    [visibleShipmentAllocations]
  );
  const shipmentDraftVolume = useMemo(
    () => summarizeShipmentDraftVolume(visibleShipmentAllocations, contactSheets, packagingVersions),
    [visibleShipmentAllocations, contactSheets, packagingVersions]
  );
  const selectedShipmentIncoterm = useMemo(
    () => shipmentAllocations.find((row) => row.shippedQty > 0)?.incoterm || null,
    [shipmentAllocations]
  );

  const invoiceTarget = useMemo(
    () => physicalShipments.find((shipment) => shipment.id === invoiceShipmentId) || null,
    [physicalShipments, invoiceShipmentId]
  );
  const dispatchTarget = useMemo(
    () => physicalShipments.find((shipment) => shipment.id === dispatchShipmentId) || null,
    [physicalShipments, dispatchShipmentId]
  );

  const allocationGroups = useMemo(() => {
    const groups = new Map<string, Array<{ item: ShipmentAllocation; index: number }>>();
    shipmentAllocations.forEach((item, index) => {
      if (!showUnwarehousedSources && item.isWarehoused === false) return;
      const key = item.contract_no || '未关联合同';
      const rows = groups.get(key) || [];
      rows.push({ item, index });
      groups.set(key, rows);
    });
    return Array.from(groups.entries()).map(([contractNo, rows]) => ({ contractNo, rows }));
  }, [shipmentAllocations, showUnwarehousedSources]);

  const handleQtyChange = (idx: number, val: number) => {
    const target = shipmentAllocations[idx];
    if (val > 0 && selectedShipmentIncoterm && (target.incoterm || null) !== selectedShipmentIncoterm) {
      notify({
        title: 'FOB 与 CIF 不能混发',
        message: `本次已选择 ${selectedShipmentIncoterm} 合同，不能再加入 ${target.incoterm || '人民币'} 合同。`,
        tone: 'warning'
      });
      return;
    }
    const copy = [...shipmentAllocations];
    copy[idx].shippedQty = normalizeShipmentQuantity(Math.min(copy[idx].availableQty, Math.max(0, val)));
    setShipmentAllocations(copy);
  };

  const handleSetAllShipmentQuantities = (mode: 'full' | 'clear') => {
    setShipmentAllocations(current => {
      const visibleRows = showUnwarehousedSources ? current : current.filter((row) => row.isWarehoused !== false);
      if (mode === 'clear') {
        const visibleKeys = new Set(visibleRows.map((row) => `${row.contact_sheet_id}|${row.batch_id}`));
        return current.map((row) => visibleKeys.has(`${row.contact_sheet_id}|${row.batch_id}`) ? { ...row, shippedQty: 0 } : row);
      }
      const activeIncoterm = visibleRows.find((row) => row.shippedQty > 0)?.incoterm
        ?? visibleRows[0]?.incoterm
        ?? null;
      return current.map((row) => ({
        ...row,
        shippedQty: (!showUnwarehousedSources && row.isWarehoused === false)
          ? row.shippedQty
          : (row.incoterm || null) === (activeIncoterm || null) ? row.availableQty : 0
      }));
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customers.some((customer) => customer.id === customerId) || !shipmentNo.trim()) return;

    // Filter items with shipped quantity > 0
    const itemsToShip = shipmentAllocations
      .filter(item => item.shippedQty > 0)
      .map(item => ({
        contact_sheet_id: item.contact_sheet_id,
        batch_id: item.batch_id,
        shipped_quantity: item.shippedQty,
        unit_price: item.unitPrice
      }));

    if (itemsToShip.length === 0) {
      notify({ title: '没有可保存的发货数量', message: '请在分摊列表中为至少一个批次或原料药明细填写大于 0 的发货数量。', tone: 'warning' });
      return;
    }
    const missingMaterialSheets = missingMaterialsForContactSheetIds(
      itemsToShip.map((item) => item.contact_sheet_id)
    );

    setIsSaving(true);
    setOperationError('');
    try {
      const groupId = editingShipmentGroupId
        ? await db.updatePreparingShipmentGroup(editingShipmentGroupId, {
            shipment_no: shipmentNo,
            shipment_date: shipmentDate,
            notes
          }, itemsToShip)
        : await db.addShipmentGroup({
            shipment_no: shipmentNo,
            customer_id: customerId,
            shipment_date: shipmentDate,
            status: '准备中',
            notes
          }, itemsToShip);
      setShowAddModal(false);
      onRefreshData();
      if (missingMaterialSheets.length > 0) {
        notify({
          title: editingShipmentGroupId ? '安排已更新，物料号待补' : '发货安排已保存，物料号待补',
          message: `${summarizeMissingMaterialNumbers(missingMaterialSheets)} 尚未填写物料号。安排已保留，但正式发货安排文件需要补齐后再导出。`,
          tone: 'warning',
          duration: 9000
        });
        return;
      }
      try {
        await db.runWorkerExport('export-shipment-plan', { shipment_group_id: groupId, detail_mode: 'batch' });
        notify({
          title: editingShipmentGroupId ? '发货安排已更新' : '发货安排已创建',
          message: editingShipmentGroupId
            ? '产品、批次和数量已重新占用，最新版发货安排 Excel 已自动下载。'
            : '库存已占用，发货安排 Excel 已自动下载；实际发货后请回来确认真实日期和数量。',
          tone: 'success'
        });
      } catch (exportError) {
        notify({
          title: editingShipmentGroupId ? '安排已更新，但 Excel 未下载' : '发货安排已保存，但 Excel 未下载',
          message: `${exportError instanceof Error ? exportError.message : String(exportError)} 可在列表中点击“导出安排”重试。`,
          tone: 'warning',
          duration: 8000
        });
      }
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const physicalShipment = physicalShipments.find((row) => row.id === id);
    if (physicalShipment?.invoice_state === 'invoiced' || physicalShipment?.invoice_state === 'inconsistent') {
      notify({
        title: '请先处理开票记录',
        message: physicalShipment.invoice_state === 'invoiced'
          ? '这笔发货已经开票。请先通过“修改开票”撤销开票，再删除发货，避免已确认利润被连带清除。'
          : '这笔发货的开票关联存在异常，为保护历史数据，当前不允许直接删除。',
        tone: 'warning',
        duration: 7000
      });
      return;
    }
    const shipment = shipments.find((row) => row.id === id);
    const isGroup = Boolean(shipment?.shipment_group_id);
    const confirmed = await confirm({
      title: isGroup ? '删除整笔合并发货？' : '撤销这条发货记录？',
      message: isGroup
        ? `发货单：${shipment?.shipment_no || '未知'}\n这笔发货包含多个合同。删除后全部合同明细都会移除，相关批次的可发数量将重新计算。`
        : `发货单：${shipment?.shipment_no || '未知'}\n删除后，相关批次已扣减的发货数量、合同完成状态和开票候选项都会重新计算。`,
      confirmLabel: isGroup ? '删除整笔发货' : '撤销发货',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      if (shipment?.shipment_group_id) await db.deleteShipmentGroup(shipment.shipment_group_id);
      else await db.deleteShipment(id);
      onRefreshData();
      notify({ title: '发货记录已删除', message: '相关批次数量及合同状态已重新计算。', tone: 'success' });
    } catch (error) {
      notify({ title: '发货记录删除失败', message: error instanceof Error ? error.message : String(error), tone: 'error' });
    }
  };

  const handleExportShipmentPlan = async (id: string, detailMode: ShipmentPlanDetailMode) => {
    const shipment = physicalShipments.find((row) => row.id === id);
    if (!shipment?.shipment_group_id) {
      notify({ title: '无法导出安排', message: '这是一条旧版单合同发货记录，没有整笔发货安排编号。', tone: 'warning' });
      return;
    }
    const missingMaterialSheets = missingMaterialsForPhysicalShipment(id);
    if (missingMaterialSheets.length > 0) {
      notify({
        title: '请先补齐物料号',
        message: `以下联系单尚未填写物料号，不能导出正式发货文件：${summarizeMissingMaterialNumbers(missingMaterialSheets)}。`,
        tone: 'warning',
        duration: 8000
      });
      return;
    }
    const exportLabel = shipment.status === '准备中' ? '发货安排' : '实际发货清单';
    setExportingShipmentId(id);
    try {
      await db.runWorkerExport('export-shipment-plan', {
        shipment_group_id: shipment.shipment_group_id,
        detail_mode: detailMode
      });
      setShowShipmentExportModal(false);
      setShipmentExportSelectionId(null);
      notify({ title: `${exportLabel}已导出`, message: `${shipment.shipment_no} 的 Excel 已下载。`, tone: 'success' });
    } catch (error) {
      notify({ title: `${exportLabel}导出失败`, message: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally {
      setExportingShipmentId(null);
    }
  };

  const handleExportReceiptConfirmation = async (id: string) => {
    const shipment = physicalShipments.find((row) => row.id === id);
    if (!shipment || !canExportReceiptConfirmation(shipment)) {
      notify({
        title: '无法导出收货确认函',
        message: '收货确认函只适用于已经实际发货的人民币转口记录。',
        tone: 'warning'
      });
      return;
    }
    const missingMaterialSheets = missingMaterialsForPhysicalShipment(id);
    if (missingMaterialSheets.length > 0) {
      notify({
        title: '请先补齐物料号',
        message: `以下联系单尚未填写物料号，不能生成收货确认函：${summarizeMissingMaterialNumbers(missingMaterialSheets)}。`,
        tone: 'warning',
        duration: 8000
      });
      return;
    }
    setExportingReceiptConfirmationId(id);
    try {
      await db.runWorkerExport('export-receipt-confirmation', { shipment_id: id });
      notify({
        title: '收货确认函已导出',
        message: `${shipment.shipment_no} 对应的 Word 文档已下载。`,
        tone: 'success'
      });
    } catch (error) {
      notify({
        title: '收货确认函导出失败',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
        duration: 9000
      });
    } finally {
      setExportingReceiptConfirmationId(null);
    }
  };

  const handleOpenDispatch = (id: string) => {
    const target = physicalShipments.find((row) => row.id === id);
    if (!target?.shipment_group_id || target.status !== '准备中') return;
    const group = shipmentGroups.find((row) => row.id === target.shipment_group_id);
    if (!group) return;
    const groupChildIds = new Set(
      shipments.filter((row) => row.shipment_group_id === target.shipment_group_id).map((row) => row.id)
    );
    const currentItems = allShipmentItems.filter((item: any) => groupChildIds.has(item.shipment_id));
    const allocations = buildShipmentAllocations(group.customer_id, {
      excludedShipmentIds: groupChildIds,
      currentItems,
      requiredIncoterm: group.incoterm || null
    }).filter((row) => row.shippedQty > 0);
    setDispatchShipmentId(id);
    setDispatchDate(formatLocalDate());
    setDispatchNotes(target.notes || '');
    setDispatchAllocations(allocations);
    setDispatchError('');
    setShowDispatchModal(true);
  };

  const handleConfirmDispatch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dispatchTarget?.shipment_group_id || !dispatchDate) return;
    const items = dispatchAllocations
      .filter((row) => row.shippedQty > 0)
      .map((row) => ({
        contact_sheet_id: row.contact_sheet_id,
        batch_id: row.batch_id,
        shipped_quantity: row.shippedQty,
        unit_price: row.unitPrice
      }));
    if (!items.length) {
      setDispatchError('实际发货至少保留一条数量大于 0 的明细。');
      return;
    }
    const missingMaterialSheets = missingMaterialsForContactSheetIds(items.map((item) => item.contact_sheet_id));
    if (missingMaterialSheets.length > 0) {
      setDispatchError(`以下联系单尚未填写物料号，不能确认实际发货：${summarizeMissingMaterialNumbers(missingMaterialSheets)}。请先返回联系单补录。`);
      return;
    }
    const unwarehousedItems = dispatchAllocations.filter((row) => {
      if (row.shippedQty <= 0) return false;
      const sheet = contactSheets.find((item) => item.id === row.contact_sheet_id);
      if (!sheet || sheet.business_type === '原料药' || sheet.is_historical) return false;
      const batch = batches.find((item) => item.id === row.batch_id);
      return !isShipmentBatchWarehoused({
        batch_quantity: Number(batch?.batch_quantity || 0),
        warehouse_date: batch?.warehouse_date,
        contact_warehouse_date: sheet.actual_warehousing_date
      });
    });
    if (unwarehousedItems.length > 0) {
      const labels = unwarehousedItems.slice(0, 3).map((row) => `${row.contact_sheet_no || '未填写联系单号'} / ${row.batch_no}`).join('、');
      setDispatchError(`以下明细尚未记录实际入库，不能确认实际发货：${labels}${unwarehousedItems.length > 3 ? ` 等 ${unwarehousedItems.length} 条` : ''}。请先补录入库日期。`);
      return;
    }
    const approved = await confirm({
      title: '确认这笔安排已经实际发货？',
      message: `发货单：${dispatchTarget.shipment_no}\n真实发货日期：${dispatchDate}\n确认后将计入客户货款平衡、应收款和待开票提醒。`,
      confirmLabel: '确认实际发货',
      tone: 'warning'
    });
    if (!approved) return;
    setIsDispatchSaving(true);
    setDispatchError('');
    try {
      await db.confirmShipmentGroupDispatched(dispatchTarget.shipment_group_id, dispatchDate, items, dispatchNotes);
      setShowDispatchModal(false);
      onRefreshData();
      notify({ title: '已确认实际发货', message: '真实发货日期和数量已写入，客户余额与待开票状态已更新。', tone: 'success' });
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDispatchSaving(false);
    }
  };

  const handleOpenInvoice = (id: string) => {
    const target = physicalShipments.find((shipment) => shipment.id === id);
    if (!target) return;
    if (target.invoice_state === 'not-shipped') {
      notify({ title: '尚不能开票', message: '只有状态为“已发货”的记录才能确认开票。', tone: 'warning' });
      return;
    }
    if (target.invoice_state === 'inconsistent') {
      notify({
        title: '开票关联需要检查',
        message: '系统检测到这笔发货存在部分、重复或跨发货开票关系。为避免覆盖历史数据，已停止自动处理。',
        tone: 'error',
        duration: 8000
      });
      return;
    }

    setInvoiceShipmentId(target.id);
    setEditingInvoiceId(target.invoice?.id || null);
    setInvoiceDate(target.invoice?.invoice_date || formatLocalDate());
    setInvoiceNo(target.invoice?.invoice_no || '');
    setInvoiceNotes(target.invoice?.notes || '');
    setInvoiceFreight(target.freight_insurance_amount ? String(target.freight_insurance_amount) : '');
    setInvoiceError('');
    setShowInvoiceModal(true);
  };

  const handleSaveInvoice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!invoiceTarget || !invoiceDate) {
      setInvoiceError('请填写实际开完票日期。');
      return;
    }
    const freightAmount = invoiceFreight.trim() ? Number(invoiceFreight) : null;
    if (invoiceTarget.currency === 'USD' && invoiceTarget.incoterm === 'CIF') {
      if (!freightAmount || freightAmount <= 0) {
        setInvoiceError('CIF 发货必须填写大于 0 的整笔运保费。');
        return;
      }
      if (freightAmount >= invoiceTarget.amount) {
        setInvoiceError('整笔运保费必须小于 CIF 发货金额。');
        return;
      }
    }

    const confirmed = await confirm({
      title: editingInvoiceId ? '确认修改开票信息？' : '确认这笔发货已经完整开票？',
      message: editingInvoiceId
        ? `发货单：${invoiceTarget.shipment_no}\n新的实际开完票日期：${invoiceDate}${invoiceTarget.incoterm === 'CIF' ? `\n整笔运保费：$${Number(freightAmount || 0).toLocaleString()}\nFOB 净额：$${(invoiceTarget.amount - Number(freightAmount || 0)).toLocaleString()}` : ''}\n修改后会重新匹配当月汇率和产品成本，并重新计算毛利。`
        : `发货单：${invoiceTarget.shipment_no}\n实际开完票日期：${invoiceDate}\n开票金额：${invoiceTarget.currency === 'USD' ? '$' : '￥'}${invoiceTarget.amount.toLocaleString()}${invoiceTarget.incoterm === 'CIF' ? `\n整笔运保费：$${Number(freightAmount || 0).toLocaleString()}\nFOB 净额：$${(invoiceTarget.amount - Number(freightAmount || 0)).toLocaleString()}` : ''}\n确认后整笔物理发货都视为已经完整开票，并按开票月份固定成本、计算毛利。`,
      confirmLabel: editingInvoiceId ? '确认修改' : '确认已开票',
      tone: 'warning'
    });
    if (!confirmed) return;

    setIsInvoiceSaving(true);
    setInvoiceError('');
    try {
      if (editingInvoiceId) {
        await db.updatePhysicalShipmentInvoice(editingInvoiceId, {
          invoice_no: invoiceNo,
          invoice_date: invoiceDate,
          notes: invoiceNotes,
          freight_insurance_amount: freightAmount
        });
      } else {
        await db.markPhysicalShipmentInvoiced(invoiceTarget.id, {
          invoice_no: invoiceNo,
          invoice_date: invoiceDate,
          notes: invoiceNotes,
          freight_insurance_amount: freightAmount
        });
      }
      setShowInvoiceModal(false);
      onRefreshData();
      notify({
        title: editingInvoiceId ? '开票信息已更新' : '发货已确认开票',
        message: '已按实际开完票日期确认完成，利润与合同状态已重新计算。',
        tone: 'success'
      });
    } catch (error) {
      setInvoiceError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsInvoiceSaving(false);
    }
  };

  const handleRevokeInvoice = async () => {
    if (!editingInvoiceId || !invoiceTarget) return;
    const confirmed = await confirm({
      title: '撤销这笔发货的开票状态？',
      message: `发货单：${invoiceTarget.shipment_no}\n撤销后，对应发票记录会被删除，这笔发货将重新变为“待开票”，已经产生的毛利也会从利润分析中移除。${invoiceTarget.incoterm === 'CIF' ? '\n已录入的整笔运保费会保留，重新开票时自动带出。' : ''}`,
      confirmLabel: '确认撤销开票',
      tone: 'danger'
    });
    if (!confirmed) return;

    setIsInvoiceSaving(true);
    setInvoiceError('');
    try {
      await db.deleteInvoice(editingInvoiceId);
      setShowInvoiceModal(false);
      onRefreshData();
      notify({
        title: '开票状态已撤销',
        message: invoiceTarget.incoterm === 'CIF'
          ? '这笔发货已恢复为待开票，利润数据已重新计算；已录入的运保费仍保留。'
          : '这笔发货已恢复为待开票，利润数据已重新计算。',
        tone: 'success'
      });
    } catch (error) {
      setInvoiceError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsInvoiceSaving(false);
    }
  };

  const handleOpenEdit = (id: string) => {
    const shipment = physicalShipments.find((row) => row.id === id);
    if (!shipment?.shipment_group_id || shipment.status !== '准备中') {
      notify({
        title: '发货事实已经锁定',
        message: shipment?.status === '已发货'
          ? '已确认实际发货后不能再修改产品、批次、数量或日期；如需更正，请使用“作废并复制”。'
          : '旧版记录不支持整组编辑，请先核对记录状态。',
        tone: 'warning',
        duration: 7000
      });
      return;
    }
    const group = shipmentGroups.find((row) => row.id === shipment.shipment_group_id);
    if (!group) return;
    const childIds = new Set(shipments.filter((row) => row.shipment_group_id === group.id).map((row) => row.id));
    const currentItems = allShipmentItems.filter((item: any) => childIds.has(item.shipment_id));
    const allocations = buildShipmentAllocations(group.customer_id, {
      excludedShipmentIds: childIds,
      currentItems,
      requiredIncoterm: group.incoterm || null
    });
    setEditingShipmentGroupId(group.id);
    setCustomerId(group.customer_id);
    setShipmentNo(group.shipment_no);
    setShipmentDate(group.shipment_date);
    setNotes(group.notes || '');
    setShipmentAllocations(allocations);
    setShowUnwarehousedSources(allocations.some((row) => row.isWarehoused === false && row.shippedQty > 0));
    setOperationError('');
    setShowAddModal(true);
  };

  const handleVoidAndCopy = async (id: string) => {
    const shipment = physicalShipments.find((row) => row.id === id);
    if (!shipment?.shipment_group_id || shipment.status !== '已发货') return;
    if (shipment.invoice_state === 'invoiced' || shipment.invoice_state === 'inconsistent') {
      notify({
        title: '请先处理开票记录',
        message: shipment.invoice_state === 'invoiced'
          ? '这笔发货已经开票，请先撤销开票，再作废并复制。'
          : '这笔发货的开票关联存在异常，需要先人工核对。',
        tone: 'warning'
      });
      return;
    }
    const today = formatLocalDate();
    const replacementNo = nextShipmentNumber([
      ...shipments.map((row) => row.group_shipment_no || row.shipment_no),
      ...shipmentGroups.map((group) => group.shipment_no)
    ], today);
    const approved = await confirm({
      title: '作废并复制为新安排？',
      message: `原发货单：${shipment.shipment_no}\n原记录会保留为“取消”，不再占用库存或参与财务统计；系统将复制为新的准备中安排 ${replacementNo}，供你重新调整。`,
      confirmLabel: '作废并复制',
      tone: 'danger'
    });
    if (!approved) return;
    try {
      await db.voidAndCopyShipmentGroup(shipment.shipment_group_id, replacementNo, today);
      onRefreshData();
      notify({ title: '已作废并复制', message: `原发货事实已保留，新安排 ${replacementNo} 已创建并置顶。`, tone: 'success' });
    } catch (error) {
      notify({ title: '作废复制失败', message: error instanceof Error ? error.message : String(error), tone: 'error', duration: 8000 });
    }
  };

  const handleOpenDetails = (id: string) => {
    setSelectedShipmentId(id);
    setShipmentDetailMode('batch');
    setShowDetailModal(true);
  };

  const handleOpenShipmentExport = (id: string) => {
    setShipmentExportSelectionId(id);
    setShipmentExportDetailMode('batch');
    setShowShipmentExportModal(true);
  };

  const handleExportExcel = () => {
    const filteredChildShipmentIds = new Set(
      filteredShipments.flatMap((shipment) => (
        shipment.shipment_group_id
          ? shipments.filter((row) => row.shipment_group_id === shipment.shipment_group_id).map((row) => row.id)
          : [shipment.id]
      ))
    );
    const missingMaterialSheets = missingMaterialsForContactSheetIds(
      allShipmentItems
        .filter((item: any) => filteredChildShipmentIds.has(item.shipment_id))
        .map((item: any) => item.contact_sheet_id)
    );
    if (missingMaterialSheets.length > 0) {
      notify({
        title: '请先补齐物料号',
        message: `当前筛选结果包含尚未填写物料号的联系单，不能导出发货明细：${summarizeMissingMaterialNumbers(missingMaterialSheets)}。`,
        tone: 'warning',
        duration: 8000
      });
      return;
    }
    const headers = [
      '发货编号', '发货日期', '关联合同', '客户名称', '联系单号',
      '产品名称', '物料编号', '生产批号', '发货数量', '单位',
      '生产日期', '失效日期', '包装形式', '每箱装量', '折合箱数',
      '发货金额', '收款 / 发货状态', '备注'
    ];

    const rows: any[] = [];

    filteredShipments.forEach(s => {
      const childShipments = s.shipment_group_id
        ? shipments.filter((row) => row.shipment_group_id === s.shipment_group_id)
        : [s];
      const childIds = new Set(childShipments.map((row) => row.id));
      const items = allShipmentItems.filter((item: any) => childIds.has(item.shipment_id));

      items.forEach((item: any) => {
        const sheet = contactSheets.find(cs => cs.id === item.contact_sheet_id);
        const batch = batches.find(b => b.id === item.batch_id);
        const childShipment = childShipments.find((row) => row.id === item.shipment_id) || s;

        const shippedQty = item.shipped_quantity || 0;
        const pcsPerCarton = sheet?.pcs_per_carton;
        const cartons = pcsPerCarton ? (shippedQty / pcsPerCarton).toFixed(2) : '-';

        rows.push([
          s.shipment_no,
          s.shipment_date,
          childShipment.contract_no,
          s.customer_name,
          sheet?.contact_sheet_no || '暂无',
          sheet?.product_name || '',
          item.material_no || sheet?.material_no || '',
          batch?.batch_no || '',
          shippedQty.toString(),
          sheet?.unit || '支',
          sheet?.production_date || '',
          sheet?.expiry_date || '',
          sheet?.packaging || '',
          pcsPerCarton ? pcsPerCarton.toString() : '-',
          cartons,
          (s.currency === 'USD' ? '$' : '￥') + (item.amount || 0).toLocaleString(),
          s.payment_settlement_status,
          s.notes || ''
        ]);
      });
    });

    const csvContent = "\ufeff" + [headers.join(','), ...rows.map(e => e.map((val: unknown) => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `发货装箱明细台账_${formatLocalDate()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderShipmentActions = (shipment: (typeof shipmentPage.rows)[number], compact = false) => (
    <div className={compact ? 'flex flex-wrap justify-start gap-2' : 'flex min-w-max justify-end gap-1.5 whitespace-nowrap'}>
      {shipment.status === '准备中' && shipment.shipment_group_id && (
        <Button requiresEdit
          onClick={() => handleOpenEdit(shipment.id)}
          tone="secondary"
          size="sm"
          icon={<Edit2 className="h-3.5 w-3.5" />}
        >
          编辑安排
        </Button>
      )}
      {shipment.shipment_group_id && shipment.status !== '取消' && (
        <Button
          onClick={() => handleOpenShipmentExport(shipment.id)}
          tone="secondary"
          size="sm"
          disabled={exportingShipmentId === shipment.id}
          icon={<Download className="h-3.5 w-3.5" />}
        >
          {exportingShipmentId === shipment.id
            ? '导出中…'
            : shipment.status === '准备中' ? '导出安排' : '实际发货清单'}
        </Button>
      )}
      {shipment.status === '准备中' && shipment.shipment_group_id && (
        <Button requiresEdit
          onClick={() => handleOpenDispatch(shipment.id)}
          size="sm"
          icon={<Truck className="h-3.5 w-3.5" />}
        >
          确认实际发货
        </Button>
      )}
      {(shipment.invoice_state === 'pending' || shipment.invoice_state === 'invoiced') && (
        <Button requiresEdit
          onClick={() => handleOpenInvoice(shipment.id)}
          tone={shipment.invoice_state === 'invoiced' ? 'secondary' : 'subtle'}
          size="sm"
          icon={<ReceiptText className="h-3.5 w-3.5" />}
        >
          {shipment.invoice_state === 'invoiced' ? '修改开票' : '确认开票'}
        </Button>
      )}
      {canExportReceiptConfirmation(shipment) && (
        <Button
          onClick={() => void handleExportReceiptConfirmation(shipment.id)}
          tone="secondary"
          size="sm"
          disabled={exportingReceiptConfirmationId === shipment.id}
          icon={<FileText className="h-3.5 w-3.5" />}
        >
          {exportingReceiptConfirmationId === shipment.id ? '生成中…' : '收货确认函'}
        </Button>
      )}
      {shipment.status === '已发货' && (
        <IconButton requiresEdit onClick={() => void handleVoidAndCopy(shipment.id)} label="作废并复制为新安排" tone="danger" icon={<RotateCcw className="h-3.5 w-3.5" />} />
      )}
      <IconButton onClick={() => handleOpenDetails(shipment.id)} label="核对发货明细" icon={<Eye className="h-3.5 w-3.5" />} />
      {shipment.status === '准备中' && shipment.shipment_group_id && (
        <IconButton requiresEdit onClick={() => handleDelete(shipment.id)} label="删除发货安排" tone="danger" icon={<Trash2 className="h-3.5 w-3.5" />} />
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="发货与开票管理"
        description={`按“创建安排—确认实际发货—确认实际开票”推进；默认显示本财年（${fiscalRange.label}），历史记录可在历史财年中查看`}
        actions={(
          <>
          <Button
            onClick={handleExportExcel}
            tone="secondary"
            icon={<FileSpreadsheet className="w-4 h-4" />}
          >
            导出发货明细 (Excel)
          </Button>
          <Button requiresEdit
            onClick={handleOpenAdd}
            icon={<Plus className="w-4 h-4" />}
          >
            创建发货记录
          </Button>
          </>
        )}
      />

      <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-muted/45 p-1.5 text-xs font-semibold">
        <button type="button" onClick={() => setPeriodView('fiscal')} className={`rounded-lg px-4 py-2 transition-colors ${periodView === 'fiscal' ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted hover:text-body'}`}>
          本财年发货与开票（{shipmentPeriodCounts.fiscal}）
        </button>
        <button type="button" onClick={() => setPeriodView('history')} className={`rounded-lg px-4 py-2 transition-colors ${periodView === 'history' ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted hover:text-body'}`}>
          历史财年（{shipmentPeriodCounts.history}）
        </button>
      </div>

      {/* Filters */}
      <FilterPanel className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2 xl:grid-cols-8">
        <FormField label="搜索发货来源" className="xl:col-span-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input
              type="text"
              placeholder="发货号、合同、联系单、批号或客户"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-4 text-sm text-ink"
            />
          </div>
        </FormField>
        <FormField label="客户">
          <CustomerSelect
            value={customerFilter}
            onChange={(value) => {
              setCustomerFilter(value);
              if (contractFilter && !contracts.some(contract => contract.contract_no === contractFilter && (!value || contract.customer_id === value))) {
                setContractFilter('');
              }
            }}
            customers={customers}
            ariaLabel="筛选发货客户"
            placeholder="全部客户"
            searchPlaceholder="输入客户名称搜索"
            emptyMessage="没有匹配客户"
            size="sm"
          />
        </FormField>
        <FormField label="合同">
          <SearchableCombobox
            value={contractFilter}
            onChange={setContractFilter}
            options={contractFilterOptions}
            ariaLabel="筛选关联合同"
            placeholder="全部合同"
            searchPlaceholder="输入合同号搜索"
            emptyMessage="没有匹配合同"
            size="sm"
          />
        </FormField>
        <div className="grid grid-cols-2 gap-2 xl:col-span-2">
          <FormField label="发货日期从" htmlFor="shipment-date-from">
            <input id="shipment-date-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} data-control-size="sm" className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-body" />
          </FormField>
          <FormField label="至" htmlFor="shipment-date-to">
            <input id="shipment-date-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} data-control-size="sm" className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-body" />
          </FormField>
        </div>
        <FormField label="发货状态" htmlFor="shipment-status-filter">
          <select id="shipment-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-body">
            <option value="">全部状态</option>
            <option value="准备中">准备中</option>
            <option value="已发货">已发货</option>
            <option value="取消">已取消</option>
          </select>
        </FormField>
        <FormField label="开票状态" htmlFor="shipment-invoice-filter">
          <select id="shipment-invoice-filter" value={invoiceFilter} onChange={(event) => setInvoiceFilter(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-body">
            <option value="">全部状态</option>
            <option value="pending">待开票</option>
            <option value="invoiced">已开票</option>
            <option value="inconsistent">需要检查</option>
          </select>
        </FormField>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3 md:col-span-2 xl:col-span-8">
          <span className="text-[11px] text-muted">
            显示 {filteredShipments.length} / {periodView === 'fiscal' ? shipmentPeriodCounts.fiscal : shipmentPeriodCounts.history} 笔{periodView === 'fiscal' ? '本财年' : '历史'}发货业务
            <span className="ml-2 text-brand-amber">待开票优先 · 同状态按发货日期由晚到早</span>
          </span>
          {hasActiveFilters && (
            <Button onClick={clearFilters} tone="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />}>恢复本财年默认范围</Button>
          )}
        </div>
      </FilterPanel>

      {/* Shipment Records: narrow-screen summary and unchanged desktop table */}
      <div className="space-y-3 lg:hidden" aria-label="发货与开票记录窄屏摘要">
        {shipmentPage.rows.length > 0 ? shipmentPage.rows.map((shipment) => {
          const invoiceLabel = shipment.invoice_state === 'invoiced'
            ? '已开票'
            : shipment.invoice_state === 'inconsistent'
              ? '需要检查'
              : shipment.invoice_state === 'not-shipped'
                ? '发货后开票'
                : '待开票';

          return (
            <article key={shipment.id} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-heading text-sm font-bold text-ink">{shipment.shipment_no}</h3>
                  <div className="mt-1 text-[11px] text-muted">{shipment.shipment_date} · {shipment.customer_name}</div>
                </div>
                <StatusBadge tone={getBusinessStatusTone(shipment.status)} dot>{shipment.status}</StatusBadge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-surface-muted/45 p-3 text-xs">
                <div>
                  <div className="text-[10px] font-semibold text-subtle">发货金额</div>
                  <div className="mt-1 font-bold text-ink">{shipment.currency === 'USD' ? '$' : '￥'}{(shipment.amount || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold text-subtle">开票 / 回款</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <StatusBadge tone={getBusinessStatusTone(invoiceLabel)}>{invoiceLabel}</StatusBadge>
                    <span
                      className={shipment.payment_settlement_reason ? 'cursor-help' : undefined}
                      title={shipment.payment_settlement_reason || undefined}
                      aria-label={shipment.payment_settlement_reason ? `${shipment.payment_settlement_status}：${shipment.payment_settlement_reason}` : shipment.payment_settlement_status}
                    >
                      <StatusBadge tone={getBusinessStatusTone(shipment.payment_settlement_status)}>{shipment.payment_settlement_status}</StatusBadge>
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {shipment.sourceSummary.contractNos.slice(0, 2).map((contractNo) => (
                  <span key={contractNo} className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-body">{contractNo}</span>
                ))}
                {shipment.sourceSummary.contractNos.length > 2 && <span className="text-[10px] font-semibold text-muted">+{shipment.sourceSummary.contractNos.length - 2} 合同</span>}
                <span className="text-[10px] text-muted">{shipment.sourceSummary.contactSheetNos.length} 个联系单 · {shipment.sourceSummary.batchNos.length} 个批次</span>
              </div>

              <div className="mt-3 border-t border-border pt-3">{renderShipmentActions(shipment, true)}</div>
            </article>
          );
        }) : (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">没有匹配的发货记录，请调整筛选条件。</div>
        )}
      </div>
      <div className="hidden lg:block">
        <DataTable ariaLabel="发货与开票记录" className="glass-panel text-xs" tableClassName="min-w-[1200px]">
            <thead>
              <tr className="select-none border-b border-border bg-surface-muted/70 font-semibold text-muted">
                <th className="min-w-[150px] p-4">发货单</th>
                <th className="min-w-[130px] p-4">客户</th>
                <th className="p-4">来源范围</th>
                <th className="min-w-[110px] p-4">状态</th>
                <th className="min-w-[105px] p-4">开票</th>
                <th className="min-w-[115px] whitespace-nowrap p-4">发货金额</th>
                <th className="min-w-[385px] whitespace-nowrap px-3 py-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredShipments.length > 0 ? (
                 shipmentPage.rows.map(s => {
                  const invoiceLabel = s.invoice_state === 'invoiced'
                    ? '已开票'
                    : s.invoice_state === 'inconsistent'
                      ? '需要检查'
                      : s.invoice_state === 'not-shipped'
                        ? '发货后开票'
                        : '待开票';

                  return (
                    <tr key={s.id} className="transition-colors hover:bg-surface-muted/45">
                      <td className="p-4">
                        <div className="font-heading text-sm font-bold text-ink">{s.shipment_no}</div>
                        <div className="mt-1 text-[10px] text-muted">{s.shipment_date}</div>
                      </td>
                      <td className="p-4 font-medium text-body">{s.customer_name}</td>
                      <td className="min-w-[210px] p-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {s.sourceSummary.contractNos.slice(0, 2).map(contractNo => (
                            <span key={contractNo} className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-body">{contractNo}</span>
                          ))}
                          {s.sourceSummary.contractNos.length > 2 && <span className="text-[10px] font-semibold text-muted">+{s.sourceSummary.contractNos.length - 2} 合同</span>}
                          {s.sourceSummary.contractNos.length > 1 && <StatusBadge tone="accent">多合同发货</StatusBadge>}
                        </div>
                        <div className="mt-1.5 text-[10px] text-muted">
                          {s.sourceSummary.contactSheetNos.length} 个联系单 · {s.sourceSummary.batchNos.length} 个批次 · 数量 {s.sourceSummary.totalQuantity.toLocaleString()}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col items-start gap-1.5">
                          <StatusBadge tone={getBusinessStatusTone(s.status)} dot>{s.status}</StatusBadge>
                          <span
                            className={s.payment_settlement_reason ? 'cursor-help' : undefined}
                            title={s.payment_settlement_reason || undefined}
                            aria-label={s.payment_settlement_reason ? `${s.payment_settlement_status}：${s.payment_settlement_reason}` : s.payment_settlement_status}
                          >
                            <StatusBadge tone={getBusinessStatusTone(s.payment_settlement_status)}>{s.payment_settlement_status}</StatusBadge>
                          </span>
                        </div>
                      </td>
                      <td className="p-4">
                        <StatusBadge tone={getBusinessStatusTone(invoiceLabel)} dot>{invoiceLabel}</StatusBadge>
                        {s.invoice?.invoice_date && (
                          <div className="mt-1 text-[10px] text-muted">
                            {s.invoice.invoice_date}{s.invoice.invoice_no ? ` · ${s.invoice.invoice_no}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-4 font-bold text-ink">
                        {s.currency === 'USD' ? '$' : '￥'}{(s.amount || 0).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-right">
                        {renderShipmentActions(s)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="bg-transparent p-10 text-center text-muted">没有匹配的发货记录，请调整筛选条件。</td>
                </tr>
              )}
            </tbody>
        </DataTable>
      </div>
      <PaginationControls {...shipmentPage} onPageChange={shipmentPage.setPage} itemLabel="笔发货记录" />

      {/* Create / Edit Preparing Shipment Modal */}
      {showAddModal && (
        <Dialog onClose={() => setShowAddModal(false)} ariaLabel={editingShipmentGroupId ? '编辑发货安排' : '创建发货安排'}>
          <div className="dialog-panel flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <h3 className="font-heading text-lg font-bold text-ink">{editingShipmentGroupId ? '编辑发货安排' : '创建发货安排'}</h3>
                <p className="mt-1 text-[11px] text-muted">{editingShipmentGroupId ? '可新增、删减或调整产品与批次数量；保存后会重新占用库存并生成最新版 Excel。' : '先占用库存并导出 Excel；货物真正发出后，再在列表中确认真实发货日期和数量。'}</p>
              </div>
              <IconButton onClick={() => setShowAddModal(false)} label="关闭创建发货记录" icon={<X className="h-5 w-5" />} />
            </header>

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col text-xs">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField label="选择发货客户" required hint="默认只列出已入库且仍有剩余数量的批次；需要提前发明细时，可在下方展开未入库批次。">
                    <CustomerSelect
                      value={customerId}
                      onChange={handleSelectCustomer}
                      customers={customers}
                      ariaLabel="选择发货客户"
                      placeholder="请选择客户"
                      searchPlaceholder="输入客户名称搜索"
                      emptyMessage="没有匹配的已有客户"
                      disabled={Boolean(editingShipmentGroupId)}
                    />
                  </FormField>
                  <FormField label="发货编号" required htmlFor="new-shipment-no">
                    <input id="new-shipment-no" type="text" required value={shipmentNo} onChange={(event) => setShipmentNo(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm font-semibold text-ink" />
                  </FormField>
                  <FormField label="计划发货日期" required htmlFor="new-shipment-date">
                    <input id="new-shipment-date" type="date" required value={shipmentDate} onChange={(event) => setShipmentDate(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-body" />
                  </FormField>
                  <FormField label="发货备注说明" htmlFor="new-shipment-notes">
                    <input id="new-shipment-notes" type="text" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="如柜号、船期、航名或提单号" className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-body" />
                  </FormField>
                </div>

                {customerId && (
                  <div className="space-y-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
                      <div>
                        <span className="font-bold text-body">按合同选择发货来源</span>
                        <span className="ml-2 text-[10px] text-muted">一键操作仅影响当前已显示的明细，保存前仍可逐项调整</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {!showUnwarehousedSources && unwarehousedSourceCount > 0 && (
                          <Button type="button" size="sm" tone="secondary" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setShowUnwarehousedSources(true)}>
                            显示未入库产品（{unwarehousedSourceCount}）
                          </Button>
                        )}
                        {showUnwarehousedSources && unwarehousedSourceCount > 0 && (
                          <span className="rounded-lg border border-brand-amber/25 bg-brand-amber/10 px-2.5 py-1.5 text-[10px] font-semibold text-brand-amber">
                            已显示未入库批次，可提前创建安排
                          </span>
                        )}
                        <Button type="button" size="sm" tone="secondary" icon={<Eraser className="h-3.5 w-3.5" />} onClick={() => handleSetAllShipmentQuantities('clear')}>
                          一键取消满发
                        </Button>
                        <Button type="button" size="sm" icon={<PackageCheck className="h-3.5 w-3.5" />} onClick={() => handleSetAllShipmentQuantities('full')}>
                          一键满发
                        </Button>
                      </div>
                    </div>

                    {allocationGroups.length > 0 ? allocationGroups.map(group => {
                      const contractAvailable = group.rows.reduce((sum, row) => sum + row.item.availableQty, 0);
                      const contractSelected = group.rows.reduce((sum, row) => sum + row.item.shippedQty, 0);
                      const groupIncoterm = group.rows[0]?.item.incoterm || null;
                      const isIncompatible = Boolean(selectedShipmentIncoterm && groupIncoterm !== selectedShipmentIncoterm);
                      return (
                        <section key={group.contractNo} className={`overflow-hidden rounded-xl border bg-surface-muted/45 ${isIncompatible ? 'border-brand-amber/30 opacity-60' : 'border-border'}`}>
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3.5 py-2.5">
                            <div className="flex items-center gap-2">
                              <Layers className="h-4 w-4 text-brand-cyan" />
                              <span className="font-bold text-ink">合同 {group.contractNo}</span>
                              {groupIncoterm && <span className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-[10px] font-bold text-muted">{groupIncoterm}</span>}
                              <span className="text-[10px] text-muted">{group.rows.length} 个发货来源</span>
                            </div>
                            <span className={`text-[10px] ${isIncompatible ? 'font-semibold text-brand-amber' : 'text-muted'}`}>
                              {isIncompatible ? `本次为 ${selectedShipmentIncoterm}，不能混入 ${groupIncoterm}` : `本次 ${contractSelected.toLocaleString()} / 剩余 ${contractAvailable.toLocaleString()}`}
                            </span>
                          </div>
                          <div className="divide-y divide-border">
                            {group.rows.map(({ item, index }) => (
                              <div key={item.batch_id || item.contact_sheet_id} className={`flex flex-col justify-between gap-3 px-3.5 py-3 sm:flex-row sm:items-center ${item.shippedQty > 0 ? 'bg-brand-cyan/5' : ''}`}>
                                <div className="min-w-0 flex-1 space-y-1">
                                   <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted">
                                     <span className="rounded-md border border-border bg-surface px-2 py-1">联系单 {item.contact_sheet_no || '未填写'}</span>
                                     <span className="rounded-md border border-border bg-surface px-2 py-1">批号 {item.batch_no}</span>
                                     <span className={`rounded-md border px-2 py-1 font-semibold ${item.isWarehoused === false ? 'border-brand-amber/25 bg-brand-amber/10 text-brand-amber' : 'border-brand-emerald/25 bg-brand-emerald/10 text-brand-emerald'}`}>
                                       {item.isWarehoused === false ? '未入库 · 仅可提前安排' : '已入库'}
                                     </span>
                                     <span>物料 {item.material_no}</span>
                                  </div>
                                  <div className="truncate text-xs font-semibold text-body">{item.product_name} · 单价 ${item.unitPrice}</div>
                                </div>
                                <div className="flex items-center justify-between gap-4 sm:justify-end">
                                  <button type="button" disabled={isIncompatible} onClick={() => handleQtyChange(index, item.availableQty)} className="text-[11px] font-bold text-brand-cyan hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline" title={isIncompatible ? 'FOB 与 CIF 不能混发' : item.isWarehoused === false ? '将该未入库批次的全部剩余数量加入发货安排' : '填入全部可用数量'}>
                                    {item.isWarehoused === false ? '可安排' : '可发'} {item.availableQty.toLocaleString()} · {item.isWarehoused === false ? '满排' : '满发'}
                                  </button>
                                  <label className="flex items-center gap-2 text-[11px] text-muted">
                                    <span className="whitespace-nowrap">本次发货</span>
                                    <input type="number" step="0.001" inputMode="decimal" max={item.availableQty} min={0} disabled={isIncompatible} value={item.shippedQty || ''} onChange={(event) => handleQtyChange(index, parseFloat(event.target.value) || 0)} className="w-24 rounded-lg border border-border bg-surface px-2.5 py-2 text-center text-sm font-bold text-brand-cyan disabled:cursor-not-allowed disabled:opacity-50" />
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    }) : (
                      <div className="rounded-xl border border-dashed border-border py-8 text-center text-muted">
                        {unwarehousedSourceCount > 0
                          ? '该客户当前没有已入库的可发批次；可点击上方“显示未入库产品”提前创建发货安排。'
                          : '该客户暂无仍有剩余数量且已生成批次的发货来源。'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <footer className="shrink-0 border-t border-border bg-surface px-5 py-4 sm:px-6">
                {shipmentDraftSummary.totalShippedQuantity > 0 && (
                  <div className={`mb-3 flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${shipmentDraftVolume.missingItemCount > 0 || packagingVersionsError ? 'border-brand-amber/30 bg-brand-amber/8' : 'border-brand-emerald/30 bg-brand-emerald/8'}`}>
                    <div className="flex items-start gap-3">
                      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${shipmentDraftVolume.missingItemCount > 0 || packagingVersionsError ? 'bg-brand-amber/15 text-brand-amber' : 'bg-brand-emerald/15 text-brand-emerald'}`}>
                        <Boxes className="h-5 w-5" />
                      </span>
                      <div>
                        <div className="text-xs font-bold text-ink">预计装柜总体积</div>
                        <div className="mt-1 text-[10px] leading-4 text-muted">每个批号的零头箱分别向上取整为整箱，避免低估实际占用空间。</div>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      {isPackagingVersionsLoading ? (
                        <div className="text-sm font-bold text-muted">正在读取包装体积…</div>
                      ) : packagingVersionsError ? (
                        <div className="max-w-md text-xs font-semibold text-brand-amber">包装版本读取失败，暂时无法计算总体积：{packagingVersionsError}</div>
                      ) : shipmentDraftVolume.calculatedItemCount > 0 ? (
                        <>
                          <div className={`font-heading text-xl font-extrabold ${shipmentDraftVolume.missingItemCount > 0 ? 'text-brand-amber' : 'text-brand-emerald'}`}>
                            {shipmentDraftVolume.missingItemCount > 0 ? '至少 ' : ''}{shipmentDraftVolume.totalVolumeM3.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m³
                          </div>
                          <div className="mt-1 text-[10px] font-medium text-muted">已计算 {shipmentDraftVolume.totalCartons.toLocaleString()} 个整箱 · {shipmentDraftVolume.calculatedItemCount} 个批号</div>
                        </>
                      ) : (
                        <div className="text-sm font-bold text-brand-amber">当前所选批号暂时无法计算总体积</div>
                      )}
                      {!isPackagingVersionsLoading && !packagingVersionsError && shipmentDraftVolume.missingItemCount > 0 && (
                        <div className="mt-1 max-w-md text-[10px] font-semibold leading-4 text-brand-amber">
                          另有 {shipmentDraftVolume.missingItemCount} 个批号未计入：联系单 {shipmentDraftVolume.missingContactSheetNos.join('、')}，请补充包装模板及外箱尺寸。
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted">
                    <span className="flex items-center gap-1.5 font-semibold text-ink"><Truck className="h-4 w-4 text-brand-cyan" />本次安排 {shipmentDraftSummary.totalShippedQuantity.toLocaleString()}</span>
                    <span>{shipmentDraftSummary.contractCount} 个合同</span>
                    <span>{shipmentDraftSummary.contactSheetCount} 个联系单</span>
                    <span>{shipmentDraftSummary.batchCount} 个批次</span>
                    <span>发货后剩余可发 <strong className="text-body">{shipmentDraftSummary.remainingAvailableQuantity.toLocaleString()}</strong></span>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    {operationError && <div className="mr-auto text-xs text-brand-rose">{operationError}</div>}
                    <Button type="button" onClick={() => setShowAddModal(false)} tone="secondary">取消</Button>
                    <Button requiresEdit type="submit" disabled={isSaving || !customerId || shipmentDraftSummary.totalShippedQuantity === 0}>
                      {isSaving ? '保存并生成中...' : editingShipmentGroupId ? '保存安排并重新导出 Excel' : '创建安排并导出 Excel'}
                    </Button>
                  </div>
                </div>
              </footer>
            </form>
          </div>
        </Dialog>
      )}

      {showDispatchModal && dispatchTarget && (
        <Dialog onClose={() => !isDispatchSaving && setShowDispatchModal(false)} ariaLabel="确认实际发货">
          <div className="dialog-panel flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <h3 className="font-heading text-lg font-bold text-ink">确认实际发货</h3>
                <p className="mt-1 text-xs text-muted">这里只确认真实发货日期；产品与数量以当前发货安排为准。</p>
              </div>
              <IconButton onClick={() => setShowDispatchModal(false)} label="关闭确认实际发货窗口" icon={<X className="h-5 w-5" />} disabled={isDispatchSaving} />
            </header>
            <form onSubmit={handleConfirmDispatch} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="rounded-xl border border-brand-cyan/20 bg-brand-cyan/5 p-4">
                  <div className="font-heading text-base font-bold text-ink">{dispatchTarget.shipment_no}</div>
                  <div className="mt-1 text-xs text-muted">{dispatchTarget.customer_name} · {dispatchTarget.sourceSummary.contractNos.join('、')}</div>
                  <div className="mt-2 text-[11px] font-semibold text-body">{dispatchAllocations.length} 条发货明细 · 安排数量 {dispatchTarget.sourceSummary.totalQuantity.toLocaleString()}</div>
                </div>
                <div aria-label="发货明细核对提醒" className="flex items-start gap-3 rounded-xl border border-brand-amber/25 bg-brand-amber/10 px-4 py-3 text-xs text-brand-amber">
                  <Eye className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="leading-5">
                    <div className="font-bold">请先通过列表右侧的小眼睛核对发货明细</div>
                    <div className="text-body">如产品、批号或数量有差异，请取消并先使用“编辑安排”；确认后记录将锁定，更正需作废并复制。</div>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="真实发货日期" required htmlFor="actual-shipment-date">
                    <input id="actual-shipment-date" type="date" required value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                  </FormField>
                  <FormField label="实际发货备注" htmlFor="actual-shipment-notes">
                    <input id="actual-shipment-notes" value={dispatchNotes} onChange={(event) => setDispatchNotes(event.target.value)} placeholder="如柜号、船期、航名或提单号" className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                  </FormField>
                </div>
                {dispatchError && <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">{dispatchError}</div>}
              </div>
              <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-surface px-6 py-4">
                <Button type="button" tone="secondary" onClick={() => setShowDispatchModal(false)} disabled={isDispatchSaving}>取消</Button>
                <Button requiresEdit type="submit" icon={<Truck className="h-4 w-4" />} disabled={isDispatchSaving || !dispatchDate}>
                  {isDispatchSaving ? '确认中…' : '确认实际发货'}
                </Button>
              </footer>
            </form>
          </div>
        </Dialog>
      )}

      {showInvoiceModal && invoiceTarget && (
        <Dialog onClose={() => !isInvoiceSaving && setShowInvoiceModal(false)} ariaLabel={editingInvoiceId ? '修改开票信息' : '确认发货已开票'}>
          <div className="dialog-panel w-full max-w-2xl overflow-hidden">
            <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <h3 className="font-heading text-lg font-bold text-ink">{editingInvoiceId ? '修改开票信息' : '确认这笔发货已开票'}</h3>
                <p className="mt-1 text-xs text-muted">填写实际开完票日期后，无论美元或人民币，整笔发货都统一视为已经完整开票。</p>
              </div>
              <IconButton onClick={() => setShowInvoiceModal(false)} label="关闭开票窗口" icon={<X className="h-5 w-5" />} disabled={isInvoiceSaving} />
            </header>

            <form onSubmit={handleSaveInvoice} className="space-y-5 p-6">
              <div className="rounded-xl border border-brand-cyan/20 bg-brand-cyan/8 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-heading text-base font-bold text-ink">{invoiceTarget.shipment_no}</div>
                    <div className="mt-1 text-xs text-muted">{invoiceTarget.customer_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-muted">固定开票总额</div>
                    <div className="text-lg font-bold text-ink">{invoiceTarget.currency === 'USD' ? '$' : '￥'}{invoiceTarget.amount.toLocaleString()}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {invoiceTarget.sourceSummary.contractNos.map((contractNo) => (
                    <span key={contractNo} className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-body">合同 {contractNo}</span>
                  ))}
                  <span className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-body">{invoiceTarget.sourceSummary.contactSheetNos.length} 个联系单</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="实际开完票日期" htmlFor="shipment-invoice-date" required hint="提交后即视为完整开票；利润将按这个月份匹配汇率和产品成本。">
                  <input id="shipment-invoice-date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} required className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                </FormField>
                <FormField label="发票编号" htmlFor="shipment-invoice-no" hint="暂时不知道可以留空，以后再补。">
                  <input id="shipment-invoice-no" value={invoiceNo} onChange={(event) => setInvoiceNo(event.target.value)} placeholder="可选" className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                </FormField>
              </div>

              {invoiceTarget.currency === 'USD' && invoiceTarget.incoterm === 'CIF' && (
                <div className="rounded-xl border border-brand-amber/25 bg-brand-amber/8 p-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div>
                      <div className="text-[11px] text-muted">整笔 CIF 金额</div>
                      <div className="mt-1 text-base font-bold text-ink">${invoiceTarget.amount.toLocaleString()}</div>
                    </div>
                    <FormField label="整笔运保费（USD）" htmlFor="shipment-invoice-freight" required hint="由发货同事提供；系统将按各明细 CIF 金额占比分摊。">
                      <input
                        id="shipment-invoice-freight"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={invoiceFreight}
                        onChange={(event) => setInvoiceFreight(event.target.value)}
                        required
                        className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-semibold text-ink"
                      />
                    </FormField>
                    <div>
                      <div className="text-[11px] text-muted">整笔 FOB 净额</div>
                      <div className="mt-1 text-base font-bold text-brand-emerald">
                        ${Math.max(0, invoiceTarget.amount - Number(invoiceFreight || 0)).toLocaleString()}
                      </div>
                      <div className="mt-1 text-[10px] text-muted">利润与毛利率按此金额计算</div>
                    </div>
                  </div>
                </div>
              )}

              <FormField label="开票备注" htmlFor="shipment-invoice-notes">
                <textarea id="shipment-invoice-notes" value={invoiceNotes} onChange={(event) => setInvoiceNotes(event.target.value)} rows={3} placeholder="如发票抬头、特殊说明等" className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
              </FormField>

              {invoiceError && <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">{invoiceError}</div>}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                <div>
                  {editingInvoiceId && (
                    <Button requiresEdit type="button" onClick={handleRevokeInvoice} tone="danger" size="sm" disabled={isInvoiceSaving}>
                      撤销开票
                    </Button>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button type="button" onClick={() => setShowInvoiceModal(false)} tone="secondary" disabled={isInvoiceSaving}>取消</Button>
                  <Button requiresEdit type="submit" disabled={isInvoiceSaving || !invoiceDate} icon={<ReceiptText className="h-4 w-4" />}>
                    {isInvoiceSaving ? '处理中…' : editingInvoiceId ? '保存开票信息' : '确认已经开票'}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {showShipmentExportModal && shipmentExportSelection && (
        <Dialog onClose={() => setShowShipmentExportModal(false)} ariaLabel="选择发货明细导出格式">
          <div className="dialog-panel w-full max-w-xl overflow-hidden">
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <h3 className="font-heading text-lg font-bold text-ink">
                  导出{shipmentExportSelection.status === '准备中' ? '发货安排' : '实际发货清单'}
                </h3>
                <p className="mt-1 text-xs font-semibold text-brand-cyan">{shipmentExportSelection.shipment_no}</p>
              </div>
              <IconButton onClick={() => setShowShipmentExportModal(false)} label="关闭导出格式选择" icon={<X className="h-5 w-5" />} />
            </header>
            <div className="space-y-3 px-5 py-5 sm:px-6">
              <p className="text-xs leading-5 text-muted">两种格式都会按合同号、联系单号、批号依次从小到大排列，并包含物料号。</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setShipmentExportDetailMode('batch')}
                  className={`rounded-xl border p-4 text-left transition ${shipmentExportDetailMode === 'batch' ? 'border-brand-cyan bg-brand-cyan/6 ring-1 ring-brand-cyan/20' : 'border-border bg-surface hover:border-brand-cyan/40'}`}
                >
                  <div className="text-sm font-bold text-ink">每批1行</div>
                  <div className="mt-1 text-xs leading-5 text-muted">每个实际批号单独一行，适合逐批核货。</div>
                </button>
                <button
                  type="button"
                  onClick={() => setShipmentExportDetailMode('contact-sheet')}
                  className={`rounded-xl border p-4 text-left transition ${shipmentExportDetailMode === 'contact-sheet' ? 'border-brand-cyan bg-brand-cyan/6 ring-1 ring-brand-cyan/20' : 'border-border bg-surface hover:border-brand-cyan/40'}`}
                >
                  <div className="text-sm font-bold text-ink">每联系单1行</div>
                  <div className="mt-1 text-xs leading-5 text-muted">数量按联系单汇总，连续批号显示为 262062031-35。</div>
                </button>
              </div>
            </div>
            <footer className="flex justify-end gap-3 border-t border-border bg-surface-muted/35 px-5 py-4 sm:px-6">
              <Button type="button" tone="secondary" onClick={() => setShowShipmentExportModal(false)} disabled={exportingShipmentId === shipmentExportSelection.id}>取消</Button>
              <Button
                type="button"
                icon={<Download className="h-4 w-4" />}
                disabled={exportingShipmentId === shipmentExportSelection.id}
                onClick={() => void handleExportShipmentPlan(shipmentExportSelection.id, shipmentExportDetailMode)}
              >
                {exportingShipmentId === shipmentExportSelection.id ? '导出中…' : `导出${shipmentExportDetailMode === 'batch' ? '每批' : '每联系单'}明细`}
              </Button>
            </footer>
          </div>
        </Dialog>
      )}

      {/* Shipment Details view Modal */}
      {showDetailModal && selectedShipmentDetails && (
        <Dialog onClose={() => setShowDetailModal(false)} ariaLabel="发货装柜清单">
          <div className="dialog-panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <h3 className="font-heading text-lg font-bold text-ink">发货装柜清单</h3>
                <p className="mt-1 text-xs font-semibold text-brand-cyan">{selectedShipmentDetails.shipment.shipment_no}</p>
              </div>
              <IconButton onClick={() => setShowDetailModal(false)} label="关闭发货装柜清单" icon={<X className="w-5 h-5" />} />
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              <div className="grid gap-2 rounded-xl border border-border bg-surface-muted/45 p-3 text-[11px] sm:grid-cols-3">
                <div><span className="text-muted">关联合同</span><strong className="mt-0.5 block text-body">{selectedShipmentDetails.shipment.contract_no}</strong></div>
                <div><span className="text-muted">客户名称</span><strong className="mt-0.5 block text-body">{selectedShipmentDetails.shipment.customer_name}</strong></div>
                <div><span className="text-muted">发货日期</span><strong className="mt-0.5 block text-body">{selectedShipmentDetails.shipment.shipment_date}</strong></div>
              </div>

              <section className="mt-4">
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-xs font-bold text-ink">装车明细</div>
                    <div className="mt-0.5 text-[10px] text-muted">
                      {shipmentDetailMode === 'batch'
                        ? `共 ${selectedShipmentDetails.items.length} 个批号；每批零头单独向上取整为整箱`
                        : `共 ${selectedShipmentDisplayRows.length} 个联系单；批号已汇总，每批零头仍单独向上取整为整箱`}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-[10px] font-semibold">
                      <button type="button" onClick={() => setShipmentDetailMode('batch')} className={`rounded-md px-2.5 py-1.5 transition ${shipmentDetailMode === 'batch' ? 'bg-brand-cyan text-white shadow-sm' : 'text-muted hover:text-ink'}`}>每批1行</button>
                      <button type="button" onClick={() => setShipmentDetailMode('contact-sheet')} className={`rounded-md px-2.5 py-1.5 transition ${shipmentDetailMode === 'contact-sheet' ? 'bg-brand-cyan text-white shadow-sm' : 'text-muted hover:text-ink'}`}>每联系单1行</button>
                    </div>
                    <span className="shrink-0 rounded-full border border-border bg-surface px-2.5 py-1 text-[10px] font-semibold text-muted">体积为装柜估算</span>
                  </div>
                </div>
                <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                  {selectedShipmentDisplayRows.map((item) => (
                      <div key={item.rowKey} className="grid gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                            <span className="rounded-md border border-border bg-surface px-2 py-1">合同 {item.contract_no || '未关联合同'}</span>
                            <span className="rounded-md border border-border bg-surface px-2 py-1">联系单 {item.contact_sheet_no || '未填写'}</span>
                            <span className="rounded-md bg-brand-purple/8 px-2 py-1 font-semibold text-brand-purple">
                              {shipmentDetailMode === 'batch' ? '批号' : `批号汇总 · ${item.batchCount} 批`} {item.batch_no || '未填写'}
                            </span>
                          </div>
                          <div className="truncate font-semibold text-body">{item.product_name}</div>
                          <div className="text-[10px] text-muted">规格 {item.specification || '未填写'} · 物料号 {item.material_no || '未填写'}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-right sm:grid-cols-4 sm:gap-x-6">
                          <div>
                            <div className="text-[9px] text-muted">发货数量</div>
                            <div className="mt-0.5 whitespace-nowrap text-xs font-bold text-ink">{item.shipped_quantity.toLocaleString()} {item.unit || '支'}</div>
                          </div>
                          <div>
                            <div className="text-[9px] text-muted">预计整箱</div>
                            <div className="mt-0.5 whitespace-nowrap text-xs font-bold text-body">
                              {isPackagingVersionsLoading ? '读取中…' : packagingVersionsError ? '暂不可用' : item.volume.isCalculated ? `${item.volume.cartons.toLocaleString()} 箱` : '未计入'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[9px] text-muted">预计体积</div>
                            <div className={`mt-0.5 whitespace-nowrap text-xs font-bold ${item.volume.isCalculated && !packagingVersionsError ? 'text-brand-emerald' : 'text-brand-amber'}`}>
                              {isPackagingVersionsLoading ? '读取中…' : packagingVersionsError ? '暂不可用' : item.volume.isCalculated ? `${item.volume.volumeM3.toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 4 })} m³` : '资料不完整'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[9px] text-muted">发货金额</div>
                            <div className="mt-0.5 whitespace-nowrap text-xs font-bold text-brand-cyan">{selectedShipmentDetails.shipment.currency === 'USD' ? '$' : '￥'}{item.amount.toLocaleString()}</div>
                          </div>
                        </div>
                      </div>
                  ))}
                </div>
              </section>
            </div>

            <footer className="shrink-0 border-t border-border bg-surface-muted/35 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 text-[10px] leading-4 text-muted">
                  <span className="font-semibold text-body">备注：</span>{selectedShipmentDetails.shipment.notes || '无'}
                  {!isPackagingVersionsLoading && !packagingVersionsError && selectedShipmentDetails.volumeSummary.missingItemCount > 0 && (
                    <div className="mt-1 font-semibold text-brand-amber">
                      {selectedShipmentDetails.volumeSummary.missingItemCount} 个批号未计入总体积：联系单 {selectedShipmentDetails.volumeSummary.missingContactSheetNos.join('、')}。
                    </div>
                  )}
                  {packagingVersionsError && <div className="mt-1 font-semibold text-brand-amber">包装版本读取失败：{packagingVersionsError}</div>}
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-right">
                    <div className="text-[9px] text-muted">{shipmentDetailMode === 'batch' ? '装车批号' : '装车联系单'}</div>
                    <div className="mt-0.5 text-sm font-bold text-ink">{selectedShipmentDisplayRows.length.toLocaleString()} 个</div>
                  </div>
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-right">
                    <div className="text-[9px] text-muted">预计总箱数</div>
                    <div className="mt-0.5 whitespace-nowrap text-sm font-bold text-body">
                      {isPackagingVersionsLoading ? '读取中…' : packagingVersionsError ? '暂不可用' : selectedShipmentDetails.volumeSummary.calculatedItemCount > 0 ? `${selectedShipmentDetails.volumeSummary.missingItemCount > 0 ? '至少 ' : ''}${selectedShipmentDetails.volumeSummary.totalCartons.toLocaleString()} 箱` : '资料不完整'}
                    </div>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 text-right ${selectedShipmentDetails.volumeSummary.missingItemCount > 0 || packagingVersionsError ? 'border-brand-amber/25 bg-brand-amber/8' : 'border-brand-emerald/25 bg-brand-emerald/8'}`}>
                    <div className="text-[9px] text-muted">预计总体积</div>
                    <div className={`mt-0.5 whitespace-nowrap text-sm font-extrabold ${selectedShipmentDetails.volumeSummary.missingItemCount > 0 || packagingVersionsError ? 'text-brand-amber' : 'text-brand-emerald'}`}>
                      {isPackagingVersionsLoading ? '读取中…' : packagingVersionsError ? '暂不可用' : selectedShipmentDetails.volumeSummary.calculatedItemCount > 0 ? `${selectedShipmentDetails.volumeSummary.missingItemCount > 0 ? '至少 ' : ''}${selectedShipmentDetails.volumeSummary.totalVolumeM3.toLocaleString('zh-CN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³` : '资料不完整'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-brand-cyan/20 bg-brand-cyan/5 px-3 py-2 text-right">
                    <div className="text-[9px] text-muted">发货总额</div>
                    <div className="mt-0.5 whitespace-nowrap text-sm font-extrabold text-brand-cyan">{selectedShipmentDetails.shipment.currency === 'USD' ? '$' : '￥'}{selectedShipmentDetails.shipment.amount.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            </footer>
          </div>
        </Dialog>
      )}
    </div>
  );
};
