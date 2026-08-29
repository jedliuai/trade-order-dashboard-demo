import React, { useState, useMemo } from 'react';
import { db } from '../services/dataStore';
import { useCallback, useEffect } from 'react';
import { checkPaymentTermsBeforeShipment } from '../services/businessRules';
import { formatLocalDate } from '../services/dateUtils';
import { getRemainingShipmentQuantity, isShipmentBatchWarehoused, normalizeShipmentQuantity } from '../services/shipmentAvailability';
import { canExportReceiptConfirmation, matchesShipmentFilters, sortShipmentWorklist, summarizeShipmentDraft, summarizeShipmentSources } from '../services/shipmentWorkspace';
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
import { calculateCurrentReceivables, summarizeShipmentSettlement } from '../services/receivablesWorkspace';
import { Plus, Search, Eye, Edit2, Trash2, CheckCircle2, AlertCircle, X, FileSpreadsheet, FileText, Layers, RotateCcw, Truck, ReceiptText, PackageCheck, Eraser, Download } from 'lucide-react';

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
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(null);
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
  const [editShipmentNo, setEditShipmentNo] = useState('');
  const [editShipmentDate, setEditShipmentDate] = useState('');
  const [editShipmentStatus, setEditShipmentStatus] = useState<'准备中' | '已发货' | '取消'>('已发货');
  const [editShipmentNotes, setEditShipmentNotes] = useState('');
  const [editShipmentAllocations, setEditShipmentAllocations] = useState<ShipmentAllocation[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [showUnwarehousedSources, setShowUnwarehousedSources] = useState(false);

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
  const reservingShipmentIds = useMemo(
    () => new Set(shipments.filter((shipment) => shipment.status !== '取消').map((shipment) => shipment.id)),
    [shipments]
  );

  const currentReceivableFacts = useMemo(
    () => calculateCurrentReceivables({
      contracts,
      sheets: contactSheets,
      shipments,
      shipmentItems: allShipmentItems,
      payments,
      asOfDate: formatLocalDate(),
      // 发货列表只需要原币余额；这里不进行人民币汇总，因此无需查询汇率。
      rateForDate: () => 1
    }).facts,
    [contracts, contactSheets, shipments, allShipmentItems, payments]
  );

  const physicalShipments = useMemo(() => {
    const groupIds = new Set<string>();
    return shipments.flatMap((shipment) => {
      if (shipment.shipment_group_id && groupIds.has(shipment.shipment_group_id)) return [];
      if (shipment.shipment_group_id) groupIds.add(shipment.shipment_group_id);
      const children = getPhysicalShipmentRows(shipment, shipments);
      const paymentStatuses = children.map((row) => row.payment_check_status);
      const preShipmentStatus = paymentStatuses.includes('不建议发货') ? '不建议发货' : paymentStatuses.includes('需人工确认') ? '需人工确认' : '可发货';
      const paymentCheckReason = Array.from(new Set(children.map((row) => row.contract_id))).map((contractId) => {
        const contract = contracts.find((row) => row.id === contractId);
        if (!contract) return '';
        const contractAmount = contactSheets
          .filter((sheet) => sheet.contract_id === contractId)
          .reduce((sum, sheet) => sum + sheet.quantity * sheet.unit_price, 0);
        const contractPayments = payments.filter((payment) => payment.contract_id === contractId);
        const totalPaid = contractPayments.reduce((sum, payment) => sum + payment.amount, 0);
        const prepaymentAmount = contractPayments
          .filter((payment) => payment.payment_type === '预付款')
          .reduce((sum, payment) => sum + payment.amount, 0);
        const proposedShipmentAmount = children
          .filter((row) => row.contract_id === contractId)
          .reduce((sum, row) => sum + row.amount, 0);
        const check = checkPaymentTermsBeforeShipment(
          contract.payment_terms,
          contractAmount,
          prepaymentAmount,
          totalPaid,
          proposedShipmentAmount
        );
        return `合同 ${contract.contract_no}：${check.message}`;
      }).filter(Boolean).join('\n');
      const amount = children.reduce((sum, row) => sum + row.amount, 0);
      const hasActuallyShipped = children.some((row) => row.status === '已发货');
      const settlement = summarizeShipmentSettlement(
        children.map((row) => row.id),
        amount,
        currentReceivableFacts
      );
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
        payment_check_status: preShipmentStatus,
        payment_check_reason: paymentCheckReason,
        payment_settlement_status: hasActuallyShipped ? settlement.status : preShipmentStatus,
        payment_settlement_reason: hasActuallyShipped
          ? `按合同内发货日期先发先抵：本次发货 ${shipment.currency === 'USD' ? '$' : '￥'}${amount.toLocaleString()}，已抵扣 ${shipment.currency === 'USD' ? '$' : '￥'}${settlement.paidAmount.toLocaleString()}，未收 ${shipment.currency === 'USD' ? '$' : '￥'}${settlement.outstandingAmount.toLocaleString()}。`
          : paymentCheckReason,
        sourceSummary,
        invoice_state: invoiceResolution.state,
        invoice: invoiceResolution.invoice
      }];
    });
  }, [shipments, shipmentGroups, allShipmentItems, customers, invoices, contracts, contactSheets, payments, currentReceivableFacts]);

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
    const items = children.flatMap((row) => db.getShipmentDetails(row.id));
    return {
      shipment: {
        ...shipment,
        shipment_no: shipment.group_shipment_no || shipment.shipment_no,
        contract_no: Array.from(new Set(children.map((row) => row.contract_no))).join('、'),
        amount: children.reduce((sum, row) => sum + row.amount, 0)
      },
      items
    };
  }, [selectedShipmentId, shipments, onRefreshTrigger]);

  const handleOpenAdd = () => {
    const today = formatLocalDate();
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

  const handleSelectCustomer = useCallback((nextCustomerId: string, fullContractId = '') => {
    setCustomerId(nextCustomerId);
    setShowUnwarehousedSources(false);
    const customerContractIds = new Set(contracts.filter((contract) => contract.customer_id === nextCustomerId).map((contract) => contract.id));
    const sheetsList = contactSheets.filter((sheet) => customerContractIds.has(sheet.contract_id));

    // Find batches under these sheets
    const allocationsList: typeof shipmentAllocations = [];

    sheetsList.forEach(sheet => {
      const sheetBatches = batches.filter(b => b.contact_sheet_id === sheet.id);

      if (sheet.business_type === '原料药') {
        const alreadyShipped = allShipmentItems
          .filter((item: any) => item.contact_sheet_id === sheet.id && reservingShipmentIds.has(item.shipment_id))
          .reduce((sum: number, item: any) => sum + item.shipped_quantity, 0);
        const available = normalizeShipmentQuantity(sheet.quantity - alreadyShipped);
        if (available > 0) {
          allocationsList.push({
            contact_sheet_id: sheet.id,
            batch_id: '',
            material_no: sheet.material_no,
            product_name: sheet.product_name,
            batch_no: '原料药无需批号',
            availableQty: available,
            shippedQty: sheet.contract_id === fullContractId ? available : 0,
            unitPrice: sheet.unit_price,
            contact_sheet_no: sheet.contact_sheet_no,
            contract_no: contracts.find((contract) => contract.id === sheet.contract_id)?.contract_no || '',
            contract_id: sheet.contract_id,
            incoterm: contracts.find((contract) => contract.id === sheet.contract_id)?.incoterm || null,
            isWarehoused: true
          });
        }
        return;
      }

      sheetBatches.forEach(batch => {
        // Calculate shipped quantity for this batch in other shipments
        const alreadyShipped = allShipmentItems
          .filter((item: any) => item.batch_id === batch.id && reservingShipmentIds.has(item.shipment_id))
          .reduce((sum: number, item: any) => sum + item.shipped_quantity, 0);

        const availability = {
          ...batch,
          contact_warehouse_date: sheet.actual_warehousing_date
        };
        const isWarehoused = isShipmentBatchWarehoused(availability);
        const available = getRemainingShipmentQuantity(batch.batch_quantity, alreadyShipped);
        if (available <= 0) return;

        allocationsList.push({
          contact_sheet_id: sheet.id,
          batch_id: batch.id,
          material_no: sheet.material_no,
          product_name: sheet.product_name,
          batch_no: batch.batch_no,
          availableQty: available,
          shippedQty: isWarehoused && sheet.contract_id === fullContractId ? available : 0,
          unitPrice: sheet.unit_price,
          contact_sheet_no: sheet.contact_sheet_no,
          contract_no: contracts.find((contract) => contract.id === sheet.contract_id)?.contract_no || '',
          contract_id: sheet.contract_id,
          incoterm: contracts.find((contract) => contract.id === sheet.contract_id)?.incoterm || null,
          isWarehoused
        });
      });
    });

    setShipmentAllocations(allocationsList);
  }, [allShipmentItems, batches, contactSheets, contracts, reservingShipmentIds]);

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

  const paymentCheckResults = useMemo(() => {
    const usedContractIds = new Set(shipmentAllocations.filter((row) => row.shippedQty > 0).map((row) => contactSheets.find((sheet) => sheet.id === row.contact_sheet_id)?.contract_id).filter(Boolean));
    return Array.from(usedContractIds).map((contractId) => {
      const contract = contracts.find((row) => row.id === contractId);
      if (!contract) return null;
      const contractAmount = contactSheets.filter((sheet) => sheet.contract_id === contract.id).reduce((sum, sheet) => sum + sheet.quantity * sheet.unit_price, 0);
      const contractPayments = payments.filter((payment) => payment.contract_id === contract.id);
      const totalPaid = contractPayments.reduce((sum, payment) => sum + payment.amount, 0);
      const prepaymentVal = contractPayments.filter((payment) => payment.payment_type === '预付款').reduce((sum, payment) => sum + payment.amount, 0);
      const proposedShipmentAmt = shipmentAllocations.filter((row) => contactSheets.find((sheet) => sheet.id === row.contact_sheet_id)?.contract_id === contract.id).reduce((sum, row) => sum + row.shippedQty * row.unitPrice, 0);
      return { contract, totalPaid, contractAmount, proposedShipmentAmt, check: checkPaymentTermsBeforeShipment(contract.payment_terms, contractAmount, prepaymentVal, totalPaid, proposedShipmentAmt) };
    }).filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [shipmentAllocations, contracts, contactSheets, payments]);

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

  const handleEditQtyChange = (idx: number, val: number) => {
    const copy = [...editShipmentAllocations];
    copy[idx].shippedQty = normalizeShipmentQuantity(Math.min(copy[idx].availableQty, Math.max(0, val)));
    setEditShipmentAllocations(copy);
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

    setIsSaving(true);
    setOperationError('');
    try {
      const groupId = await db.addShipmentGroup({
        shipment_no: shipmentNo,
        customer_id: customerId,
        shipment_date: shipmentDate,
        status: '准备中',
        notes
      }, itemsToShip);
      setShowAddModal(false);
      onRefreshData();
      try {
        await db.runLocalExport('export-shipment-plan', { shipment_group_id: groupId });
        notify({ title: '发货安排已创建', message: '库存已占用，发货安排 Excel 已自动下载；实际发货后请回来确认真实日期和数量。', tone: 'success' });
      } catch (exportError) {
        notify({
          title: '发货安排已保存，但 Excel 未下载',
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

  const handleExportShipmentPlan = async (id: string) => {
    const shipment = physicalShipments.find((row) => row.id === id);
    if (!shipment?.shipment_group_id) {
      notify({ title: '无法导出安排', message: '这是一条旧版单合同发货记录，没有整笔发货安排编号。', tone: 'warning' });
      return;
    }
    setExportingShipmentId(id);
    try {
      await db.runLocalExport('export-shipment-plan', { shipment_group_id: shipment.shipment_group_id });
      notify({ title: '发货安排已导出', message: `${shipment.shipment_no} 的 Excel 已下载。`, tone: 'success' });
    } catch (error) {
      notify({ title: '发货安排导出失败', message: error instanceof Error ? error.message : String(error), tone: 'error' });
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
    setExportingReceiptConfirmationId(id);
    try {
      await db.runLocalExport('export-receipt-confirmation', { shipment_id: id });
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
    const groupChildIds = new Set(
      shipments.filter((row) => row.shipment_group_id === target.shipment_group_id).map((row) => row.id)
    );
    const currentItems = allShipmentItems.filter((item: any) => groupChildIds.has(item.shipment_id));
    const allocations = currentItems.map((item: any) => {
      const sheet = contactSheets.find((row) => row.id === item.contact_sheet_id);
      const batch = batches.find((row) => row.id === item.batch_id);
      const reservedByOtherForSheet = allShipmentItems
        .filter((row: any) => row.contact_sheet_id === item.contact_sheet_id && !groupChildIds.has(row.shipment_id) && reservingShipmentIds.has(row.shipment_id))
        .reduce((sum: number, row: any) => sum + Number(row.shipped_quantity || 0), 0);
      const sheetAvailable = Math.max(0, Number(sheet?.quantity || 0) - reservedByOtherForSheet);
      const reservedByOtherForBatch = item.batch_id
        ? allShipmentItems
            .filter((row: any) => row.batch_id === item.batch_id && !groupChildIds.has(row.shipment_id) && reservingShipmentIds.has(row.shipment_id))
            .reduce((sum: number, row: any) => sum + Number(row.shipped_quantity || 0), 0)
        : 0;
      const batchAvailable = item.batch_id ? Math.max(0, Number(batch?.batch_quantity || 0) - reservedByOtherForBatch) : sheetAvailable;
      const availableQty = normalizeShipmentQuantity(Math.min(sheetAvailable, batchAvailable));
      return {
        contact_sheet_id: item.contact_sheet_id,
        batch_id: item.batch_id || '',
        material_no: item.material_no || sheet?.material_no || '',
        product_name: sheet?.product_name || item.product_name || '',
        batch_no: batch?.batch_no || (sheet?.business_type === '原料药' ? '原料药无需批号' : '历史数据未记录批次'),
        availableQty,
        shippedQty: normalizeShipmentQuantity(Number(item.shipped_quantity || 0)),
        unitPrice: Number(item.unit_price || sheet?.unit_price || 0),
        contact_sheet_no: sheet?.contact_sheet_no || '',
        contract_no: shipments.find((row) => row.id === item.shipment_id)?.contract_no || ''
      };
    });
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
    const shipment = shipments.find(s => s.id === id);
    if (!shipment) return;
    if (shipment.shipment_group_id) {
      notify({
        title: '合并发货暂不支持直接编辑',
        message: '这笔发货涉及多个合同。为避免只修改部分明细导致账实不符，请删除整笔后重新登记。',
        tone: 'warning',
        duration: 7000
      });
      return;
    }
    setEditingShipmentId(id);
    setEditShipmentNo(shipment.shipment_no);
    setEditShipmentDate(shipment.shipment_date);
    setEditShipmentStatus(shipment.status);
    setEditShipmentNotes(shipment.notes || '');
    const sheetsList = contactSheets.filter(s => s.contract_id === shipment.contract_id);
    const currentItems = allShipmentItems.filter((item: any) => item.shipment_id === id);
    const allocationsList: ShipmentAllocation[] = [];
    sheetsList.forEach(sheet => {
      const sheetBatches = batches.filter(b => b.contact_sheet_id === sheet.id);
      if (sheet.business_type === '原料药' || sheet.is_historical) {
        const current = currentItems.find((item: any) => item.contact_sheet_id === sheet.id && !item.batch_id);
        const shippedByOther = allShipmentItems
          .filter((item: any) => item.contact_sheet_id === sheet.id && item.shipment_id !== id && reservingShipmentIds.has(item.shipment_id))
          .reduce((sum: number, item: any) => sum + item.shipped_quantity, 0);
        const available = normalizeShipmentQuantity(sheet.quantity - shippedByOther);
        if (available > 0 || current) {
          allocationsList.push({
            contact_sheet_id: sheet.id,
            batch_id: '',
            material_no: sheet.material_no,
            product_name: sheet.product_name,
            batch_no: sheet.is_historical ? '历史数据未记录批次' : '原料药无需批号',
            availableQty: available,
            shippedQty: Number(current?.shipped_quantity || 0),
            unitPrice: Number(current?.unit_price || sheet.unit_price),
            contact_sheet_no: sheet.contact_sheet_no,
            contract_no: shipment.contract_no
          });
        }
        return;
      }
      sheetBatches.forEach(batch => {
        const current = currentItems.find((item: any) => item.batch_id === batch.id);
        const shippedByOther = allShipmentItems
          .filter((item: any) => item.batch_id === batch.id && item.shipment_id !== id && reservingShipmentIds.has(item.shipment_id))
          .reduce((sum: number, item: any) => sum + item.shipped_quantity, 0);
        const available = normalizeShipmentQuantity(batch.batch_quantity - shippedByOther);
        allocationsList.push({
          contact_sheet_id: sheet.id,
          batch_id: batch.id,
          material_no: sheet.material_no,
          product_name: sheet.product_name,
          batch_no: batch.batch_no,
          availableQty: available,
          shippedQty: current?.shipped_quantity || 0,
          unitPrice: current?.unit_price || sheet.unit_price,
          contact_sheet_no: sheet.contact_sheet_no,
          contract_no: shipment.contract_no
        });
      });
    });
    setEditShipmentAllocations(allocationsList);
    setOperationError('');
    setShowEditModal(true);
  };

  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingShipmentId || !editShipmentNo.trim()) return;
    const itemsToSave = editShipmentAllocations
      .filter(item => item.shippedQty > 0)
      .map(item => ({
        contact_sheet_id: item.contact_sheet_id,
        batch_id: item.batch_id,
        shipped_quantity: item.shippedQty,
        unit_price: item.unitPrice
      }));
    if (itemsToSave.length === 0) {
      notify({ title: '至少保留一条发货明细', message: '如果要撤销整张发货单，请关闭编辑窗口并使用删除按钮。', tone: 'warning' });
      return;
    }
    setIsSaving(true);
    setOperationError('');
    try {
      await db.updateShipmentWithItems(editingShipmentId, {
        shipment_no: editShipmentNo.trim(),
        shipment_date: editShipmentDate,
        status: editShipmentStatus,
        notes: editShipmentNotes
      }, itemsToSave);
      setShowEditModal(false);
      setEditingShipmentId(null);
      onRefreshData();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDetails = (id: string) => {
    setSelectedShipmentId(id);
    setShowDetailModal(true);
  };

  const handleExportExcel = () => {
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
          batch?.production_date || sheet?.production_date || '',
          batch?.expiry_date || sheet?.expiry_date || '',
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
          <Button
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
            <span className="ml-2 text-brand-gold">待开票优先 · 同状态按发货日期由晚到早</span>
          </span>
          {hasActiveFilters && (
            <Button onClick={clearFilters} tone="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />}>恢复本财年默认范围</Button>
          )}
        </div>
      </FilterPanel>

      {/* Shipment Records table */}
      <DataTable ariaLabel="发货与开票记录" className="glass-panel text-xs">
            <thead>
              <tr className="select-none border-b border-border bg-surface-muted/70 font-semibold text-muted">
                <th className="p-4">发货单</th>
                <th className="p-4">客户</th>
                <th className="p-4">来源范围</th>
                <th className="p-4">状态</th>
                <th className="p-4">开票</th>
                <th className="p-4">发货金额</th>
                <th className="p-4 text-right">操作</th>
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
                      <td className="min-w-[280px] p-4">
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
                      <td className="p-4 font-bold text-ink">
                        {s.currency === 'USD' ? '$' : '￥'}{(s.amount || 0).toLocaleString()}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-2">
                          {s.status === '准备中' && (
                            <>
                              <Button
                                onClick={() => void handleExportShipmentPlan(s.id)}
                                tone="secondary"
                                size="sm"
                                disabled={exportingShipmentId === s.id}
                                icon={<Download className="h-3.5 w-3.5" />}
                              >
                                {exportingShipmentId === s.id ? '导出中…' : '导出安排'}
                              </Button>
                              <Button
                                onClick={() => handleOpenDispatch(s.id)}
                                size="sm"
                                icon={<Truck className="h-3.5 w-3.5" />}
                              >
                                确认实际发货
                              </Button>
                            </>
                          )}
                          {(s.invoice_state === 'pending' || s.invoice_state === 'invoiced') && (
                            <Button
                              onClick={() => handleOpenInvoice(s.id)}
                              tone={s.invoice_state === 'invoiced' ? 'secondary' : 'subtle'}
                              size="sm"
                              icon={<ReceiptText className="h-3.5 w-3.5" />}
                            >
                              {s.invoice_state === 'invoiced' ? '修改开票' : '确认开票'}
                            </Button>
                          )}
                          {canExportReceiptConfirmation(s) && (
                            <Button
                              onClick={() => void handleExportReceiptConfirmation(s.id)}
                              tone="secondary"
                              size="sm"
                              disabled={exportingReceiptConfirmationId === s.id}
                              icon={<FileText className="h-3.5 w-3.5" />}
                            >
                              {exportingReceiptConfirmationId === s.id ? '生成中…' : '收货确认函'}
                            </Button>
                          )}
                          <IconButton
                            onClick={() => handleOpenDetails(s.id)}
                            label="查看发货清单"
                            icon={<Eye className="w-3.5 h-3.5" />}
                          />
                          <IconButton
                            onClick={() => handleOpenEdit(s.id)}
                            label="编辑发货记录"
                            icon={<Edit2 className="w-3.5 h-3.5" />}
                          />
                          <IconButton
                            onClick={() => handleDelete(s.id)}
                            label="撤销发货记录"
                            tone="danger"
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                          />
                        </div>
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
      <PaginationControls {...shipmentPage} onPageChange={shipmentPage.setPage} itemLabel="笔发货记录" />

      {/* Add Shipment Modal */}
      {showAddModal && (
        <Dialog onClose={() => setShowAddModal(false)} ariaLabel="创建发货记录">
          <div className="dialog-panel flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div>
                <h3 className="font-heading text-lg font-bold text-ink">创建发货安排</h3>
                <p className="mt-1 text-[11px] text-muted">先占用库存并导出 Excel；货物真正发出后，再在列表中确认真实发货日期和数量。</p>
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

                {paymentCheckResults.length > 0 && (
                  <div className="space-y-2">
                    <div className="font-bold text-body">各合同发货前收款校验</div>
                    {paymentCheckResults.map(result => (
                      <div key={result.contract.id} className={`flex gap-3 rounded-xl border p-3 ${result.check.status === 'rejected' ? 'border-brand-rose/25 bg-brand-rose/10 text-brand-rose' : result.check.status === 'warning' ? 'border-brand-amber/25 bg-brand-amber/10 text-brand-amber' : 'border-brand-emerald/25 bg-brand-emerald/10 text-brand-emerald'}`}>
                        {result.check.status === 'approved' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                        <div>
                          <div className="font-bold">合同 {result.contract.contract_no}</div>
                          <div className="mt-1 text-[10px] text-body">合同额 {result.contractAmount.toFixed(2)} · 已收 {result.totalPaid.toFixed(2)} · 本次发货 {result.proposedShipmentAmt.toFixed(2)}</div>
                          <div className="mt-1 text-[10px] font-medium">{result.check.message}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

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
                    <Button type="submit" disabled={isSaving || !customerId || shipmentDraftSummary.totalShippedQuantity === 0}>
                      {isSaving ? '保存并生成中...' : '创建安排并导出 Excel'}
                    </Button>
                  </div>
                </div>
              </footer>
            </form>
          </div>
        </Dialog>
      )}

      {/* Edit Shipment Modal */}
      {showEditModal && (
        <Dialog onClose={() => setShowEditModal(false)} ariaLabel="编辑发货记录">
          <div className="dialog-panel w-full max-w-lg p-6 space-y-6">
            <div className="flex justify-between items-center pb-2 border-b border-white/[0.04]">
              <h3 className="font-heading font-bold text-lg text-white">编辑发货记录</h3>
              <IconButton onClick={() => setShowEditModal(false)} label="关闭编辑发货记录" icon={<X className="w-5 h-5" />} />
            </div>

            <form onSubmit={handleSubmitEdit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-slate-400">发货编号 <span className="text-brand-rose">*</span></label>
                  <input
                    type="text"
                    required
                    value={editShipmentNo}
                    onChange={(e) => setEditShipmentNo(e.target.value)}
                    className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200 font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400">发货日期</label>
                  <input
                    type="date"
                    value={editShipmentDate}
                    onChange={(e) => setEditShipmentDate(e.target.value)}
                    className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">发货状态</label>
                <select
                  value={editShipmentStatus}
                  onChange={(e) => setEditShipmentStatus(e.target.value as '准备中' | '已发货' | '取消')}
                  className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-3 py-2.5 text-slate-200"
                >
                  <option value="准备中">准备中</option>
                  <option value="已发货">已发货</option>
                  <option value="取消">取消</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">备注</label>
                <textarea
                  value={editShipmentNotes}
                  onChange={(e) => setEditShipmentNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200 resize-none"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-white/[0.04] pb-1">
                  <span className="font-bold text-slate-300">调整装车明细</span>
                  <span className="text-[10px] text-slate-500">可用量已扣除其他发货记录</span>
                </div>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {editShipmentAllocations.length > 0 ? (
                    editShipmentAllocations.map((item, idx) => (
                      <div key={`${item.batch_id}-${idx}`} className="p-3 bg-white/[0.01] border border-white/[0.04] rounded-lg flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                        <div className="space-y-0.5 flex-1">
                          <div className="font-semibold text-slate-200">
                            联系单 <span className="text-brand-cyan font-bold">{item.contact_sheet_no || '暂无'}</span> <span className="text-slate-600">|</span> 批号: {item.batch_no}
                          </div>
                          <div className="text-[10px] text-slate-500">物料号 {item.material_no} | {item.product_name}</div>
                        </div>
                        <div className="flex items-center gap-4">
                          <button
                            type="button"
                            onClick={() => handleEditQtyChange(idx, item.availableQty)}
                            className="text-[11px] text-brand-cyan hover:underline font-bold"
                            title="填入全部可用量"
                          >
                            可用 {item.availableQty.toLocaleString()}
                          </button>
                          <input
                            type="number"
                            step="0.001"
                            inputMode="decimal"
                            max={item.availableQty}
                            min={0}
                            value={item.shippedQty || ''}
                            onChange={(e) => handleEditQtyChange(idx, parseFloat(e.target.value) || 0)}
                            className="w-20 bg-slate-900/60 border border-white/[0.08] rounded px-2.5 py-1 text-slate-200 text-center font-bold text-brand-cyan"
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-slate-500 italic py-5">该发货记录暂无可调整的批次明细</div>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-white/[0.04] flex justify-end gap-3">
                {operationError && <div className="mr-auto text-xs text-brand-rose">{operationError}</div>}
                <Button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  tone="secondary"
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving ? '保存中...' : '保存修改'}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {showDispatchModal && dispatchTarget && (
        <Dialog onClose={() => !isDispatchSaving && setShowDispatchModal(false)} ariaLabel="确认实际发货">
          <div className="dialog-panel flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                <h3 className="font-heading text-lg font-bold text-ink">确认实际发货</h3>
                <p className="mt-1 text-xs text-muted">可以按真实情况调整数量；上限已包含本安排原先占用的库存，但不会超过联系单或批次总量。</p>
              </div>
              <IconButton onClick={() => setShowDispatchModal(false)} label="关闭确认实际发货窗口" icon={<X className="h-5 w-5" />} disabled={isDispatchSaving} />
            </header>
            <form onSubmit={handleConfirmDispatch} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
                <div className="rounded-xl border border-brand-cyan/20 bg-brand-cyan/5 p-4">
                  <div className="font-heading text-base font-bold text-ink">{dispatchTarget.shipment_no}</div>
                  <div className="mt-1 text-xs text-muted">{dispatchTarget.customer_name} · {dispatchTarget.sourceSummary.contractNos.join('、')}</div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="真实发货日期" required htmlFor="actual-shipment-date">
                    <input id="actual-shipment-date" type="date" required value={dispatchDate} onChange={(event) => setDispatchDate(event.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                  </FormField>
                  <FormField label="实际发货备注" htmlFor="actual-shipment-notes">
                    <input id="actual-shipment-notes" value={dispatchNotes} onChange={(event) => setDispatchNotes(event.target.value)} placeholder="如柜号、船期、航名或提单号" className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-ink" />
                  </FormField>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <span className="text-xs font-bold text-body">核对实际发货数量</span>
                    <span className="text-[10px] text-muted">可填 0 移除某条明细</span>
                  </div>
                  {dispatchAllocations.map((item, index) => (
                    <div key={`${item.contact_sheet_id}-${item.batch_id}-${index}`} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-muted/35 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted">
                          <span>合同 {item.contract_no}</span>
                          <span>联系单 {item.contact_sheet_no || '未填写'}</span>
                          <span>批号 {item.batch_no}</span>
                        </div>
                        <div className="mt-1 truncate text-xs font-semibold text-body">{item.product_name}</div>
                      </div>
                      <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
                        <span>最多 {item.availableQty.toLocaleString()}</span>
                        <input
                          type="number"
                          min={0}
                          max={item.availableQty}
                          step="0.001"
                          inputMode="decimal"
                          value={item.shippedQty || ''}
                          onChange={(event) => setDispatchAllocations((current) => current.map((row, rowIndex) => rowIndex === index ? {
                            ...row,
                            shippedQty: normalizeShipmentQuantity(Math.min(row.availableQty, Math.max(0, parseFloat(event.target.value) || 0)))
                          } : row))}
                          className="w-28 rounded-lg border border-border bg-surface px-2.5 py-2 text-right text-sm font-bold text-brand-cyan"
                        />
                      </label>
                    </div>
                  ))}
                </div>
                {dispatchError && <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">{dispatchError}</div>}
              </div>
              <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-border bg-surface px-6 py-4">
                <Button type="button" tone="secondary" onClick={() => setShowDispatchModal(false)} disabled={isDispatchSaving}>取消</Button>
                <Button type="submit" icon={<Truck className="h-4 w-4" />} disabled={isDispatchSaving || !dispatchDate}>
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
                    <Button type="button" onClick={handleRevokeInvoice} tone="danger" size="sm" disabled={isInvoiceSaving}>
                      撤销开票
                    </Button>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button type="button" onClick={() => setShowInvoiceModal(false)} tone="secondary" disabled={isInvoiceSaving}>取消</Button>
                  <Button type="submit" disabled={isInvoiceSaving || !invoiceDate} icon={<ReceiptText className="h-4 w-4" />}>
                    {isInvoiceSaving ? '处理中…' : editingInvoiceId ? '保存开票信息' : '确认已经开票'}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {/* Shipment Details view Modal */}
      {showDetailModal && selectedShipmentDetails && (
        <Dialog onClose={() => setShowDetailModal(false)} ariaLabel="发货装柜清单">
          <div className="dialog-panel w-full max-w-2xl p-6 space-y-6">
            <div className="flex justify-between items-center border-b border-white/[0.04] pb-3">
              <h3 className="font-heading font-bold text-lg text-white">
                发货装柜清单: {selectedShipmentDetails.shipment.shipment_no}
              </h3>
              <IconButton onClick={() => setShowDetailModal(false)} label="关闭发货装柜清单" icon={<X className="w-5 h-5" />} />
            </div>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-4 text-[11px] text-slate-400">
                <div>关联合同: <span className="text-white font-medium">{selectedShipmentDetails.shipment.contract_no}</span></div>
                <div>客户名称: <span className="text-white font-medium">{selectedShipmentDetails.shipment.customer_name}</span></div>
                <div>发货日期: <span className="text-white font-medium">{selectedShipmentDetails.shipment.shipment_date}</span></div>
              </div>

              <div className="space-y-2 border-t border-white/[0.04] pt-4">
                <div className="font-bold text-slate-300 text-xs block pb-1">装车明细列表</div>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {selectedShipmentDetails.items.map((item) => {
                    const sourceContractNo = shipments.find(row => row.id === item.shipment_id)?.contract_no || '未关联合同';
                    return (
                      <div key={item.id} className="flex items-center justify-between rounded-lg border border-border bg-surface-muted/45 p-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                            <span className="rounded-md border border-border bg-surface px-2 py-1">合同 {sourceContractNo}</span>
                            <span className="rounded-md border border-border bg-surface px-2 py-1">联系单 {item.contact_sheet_no || '未填写'}</span>
                            <span>批号 {item.batch_no}</span>
                          </div>
                          <div className="font-semibold text-body">{item.product_name}</div>
                          <div className="text-[10px] text-muted">规格 {item.specification} · 物料号 {item.material_no}</div>
                        </div>
                        <div className="flex flex-col items-end text-right">
                          <div className="flex items-center gap-1.5 font-bold text-ink">
                            <span>{item.shipped_quantity.toLocaleString()} {item.unit || '支'}</span>
                            {item.pcs_per_carton ? (
                              <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                                {(item.shipped_quantity / item.pcs_per_carton).toFixed(1)} 箱
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[10px] text-brand-cyan">${item.amount.toLocaleString()}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {(() => {
                const totalCartons = selectedShipmentDetails.items.reduce((sum, item) => {
                  if (item.pcs_per_carton) {
                    return sum + (item.shipped_quantity / item.pcs_per_carton);
                  }
                  return sum;
                }, 0);

                return (
                  <div className="border-t border-white/[0.04] pt-4 flex justify-between items-center flex-wrap gap-2">
                    <span className="text-slate-400">备注: {selectedShipmentDetails.shipment.notes || '无'}</span>
                    <div className="flex items-center gap-4">
                      {totalCartons > 0 && (
                        <span className="text-xs bg-brand-cyan/10 border border-brand-cyan/20 px-2 py-0.5 rounded text-brand-cyan font-bold">
                          发货总箱数: {totalCartons.toFixed(1)} 箱
                        </span>
                      )}
                      <span className="font-bold text-base text-white">
                        发货总额: {selectedShipmentDetails.shipment.currency === 'USD' ? '$' : '￥'}{selectedShipmentDetails.shipment.amount.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="pt-4 border-t border-white/[0.06] flex justify-end">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 border border-slate-800 hover:bg-slate-800/50 rounded-lg text-slate-400 text-xs font-semibold"
              >
                关闭
              </button>
            </div>

          </div>
        </Dialog>
      )}
    </div>
  );
};
