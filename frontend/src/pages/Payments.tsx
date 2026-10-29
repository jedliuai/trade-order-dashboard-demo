import React, { useState, useMemo } from 'react';
import { db } from '../services/dataStore';
import { useEffect } from 'react';
import { Plus, Search, Edit2, Trash2, X, FileSpreadsheet, Layers, Building, Calendar, DollarSign, ListFilter, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import type { Payment, PaymentReceipt, ShipmentItem } from '../services/dataStore';
import { addDaysToLocalDate, formatLocalDate } from '../services/dateUtils';
import { balanceLastPaymentAllocation, getContractAmount, getContractOutstandingAmount, getReceivableContracts, normalizeMoneyAmount, summarizePaymentAllocations, updatePaymentAllocationWithAutoRemainder } from '../services/financialRules';
import { Dialog } from '../components/Dialog';
import { PageHeader } from '../components/PageHeader';
import { useFeedback } from '../components/FeedbackProvider';
import { FormField } from '../components/FormField';
import { SearchableCombobox } from '../components/SearchableCombobox';
import { CustomerSelect } from '../components/CustomerSelect';
import { IconButton } from '../components/IconButton';
import { Button } from '../components/Button';
import { DataTable } from '../components/DataTable';
import { PaginationControls } from '../components/PaginationControls';
import { handleTabListKeyDown } from '../components/tabKeyboard';
import { usePagedRows } from '../hooks/usePagedRows';
import { getFiscalYearRange } from '../services/fiscalYear';
import {
  calculateCurrentReceivables,
  filterCurrentReceivableFacts,
  summarizeCurrentReceivableRmb,
  summarizeOutstandingContractsRmb
} from '../services/receivablesWorkspace';
import { CustomerBalancePanel } from './CustomerBalancePanel';
import { buildPaymentAccountingMessage } from '../services/paymentAccountingMessage';
import { buildPaymentReceiptLedger, filterPaymentReceiptLedger, type ReceiptLedgerRow } from '../services/paymentReceiptLedger';

type PaymentAmountLike = { amount: number; amount_rmb?: number; currency: 'USD' | 'RMB' };
type CustomerReceiptGroup = {
  customerName: string;
  rows: ReceiptLedgerRow[];
  totalAmountRmb: number;
  totalAmountUsd: number;
  hasUsdPayments: boolean;
};

function formatPaymentRmb(payment: PaymentAmountLike) {
  if (payment.amount_rmb !== undefined && payment.amount_rmb !== null) {
    return `￥${payment.amount_rmb.toLocaleString()}`;
  }
  return payment.currency === 'RMB' ? `￥${payment.amount.toLocaleString()}` : '缺汇率';
}

function formatContractTotal(amount: number, currency: 'USD' | 'RMB') {
  return amount > 0.005 ? `${currency === 'USD' ? '$' : '￥'}${amount.toLocaleString()}` : '待录入';
}

interface PaymentsProps {
  onNavigate?: (tab: string) => void;
  onRefreshData: () => void;
  onRefreshTrigger: number;
  initialView?: 'customer' | 'balance';
}

export const Payments: React.FC<PaymentsProps> = ({ onNavigate, onRefreshData, onRefreshTrigger, initialView = 'customer' }) => {
  const { confirm, notify } = useFeedback();
  const fiscalRange = useMemo(() => getFiscalYearRange(), []);
  const [viewMode, setViewMode] = useState<'customer' | 'balance'>(initialView);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [editingContractIds, setEditingContractIds] = useState<string[]>([]);
  const [expandedReceiptIds, setExpandedReceiptIds] = useState<Set<string>>(() => new Set());

  // Form State
  const [formCustomerId, setFormCustomerId] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [receiptTotalAmount, setReceiptTotalAmount] = useState(0);
  const [paymentAllocations, setPaymentAllocations] = useState<{ id?: string; contract_id: string; amount: number }[]>([]);
  const [paymentDate, setPaymentDate] = useState(formatLocalDate());
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Customer View Filters state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>(fiscalRange.startDate);
  const [dateTo, setDateTo] = useState<string>(fiscalRange.endDate);
  const [filterContractId, setFilterContractId] = useState<string>('all');
  const [filterExportType, setFilterExportType] = useState<string>('all');
  const [filterCurrency, setFilterCurrency] = useState<string>('all');
  const [groupByCustomer, setGroupByCustomer] = useState<boolean>(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');

  useEffect(() => {
    setViewMode(initialView);
  }, [initialView]);

  // Load database lists
  const data = useMemo(() => {
    void onRefreshTrigger;
    const payments = db.getPayments();
    const contracts = db.getContracts();
    const rates = db.getExchangeRates();
    const customers = db.getCustomers();
    const contactSheets = db.getContactSheets();
    const shipments = db.getShipments();
    const shipmentItems = db.getTable<ShipmentItem>('trade_shipment_items');
    const paymentReceipts = db.getPaymentReceipts();
    return { payments, contracts, rates, customers, contactSheets, shipments, shipmentItems, paymentReceipts };
  }, [onRefreshTrigger]);

  const { payments, contracts, rates, customers, contactSheets, shipments, shipmentItems, paymentReceipts } = data;

  const rateForMonth = useMemo(() => (month: string) => {
    return [...rates]
      .filter(rate => rate.effective_month <= month)
      .sort((a, b) => b.effective_month.localeCompare(a.effective_month))[0]?.rate || 0;
  }, [rates]);

  const contractTotals = useMemo(() => {
    const totals = new Map<string, number>();
    contactSheets.forEach((sheet) => {
      totals.set(sheet.contract_id, (totals.get(sheet.contract_id) || 0) + sheet.quantity * sheet.unit_price);
    });
    return totals;
  }, [contactSheets]);

  const receiptLedgerRows = useMemo(() => buildPaymentReceiptLedger({
    payments,
    receipts: paymentReceipts,
    customers,
    contracts,
    contractTotals,
  }), [payments, paymentReceipts, customers, contracts, contractTotals]);

  const historyEndDate = useMemo(() => addDaysToLocalDate(fiscalRange.startDate, -1), [fiscalRange.startDate]);
  const paymentPeriodCounts = useMemo(() => receiptLedgerRows.reduce((counts, row) => {
    if (row.payment_date >= fiscalRange.startDate && row.payment_date <= fiscalRange.endDate) counts.fiscal += 1;
    else if (row.payment_date < fiscalRange.startDate) counts.history += 1;
    return counts;
  }, { fiscal: 0, history: 0 }), [receiptLedgerRows, fiscalRange.startDate, fiscalRange.endDate]);
  const activePeriodPreset = dateFrom === fiscalRange.startDate && dateTo === fiscalRange.endDate
    ? 'fiscal'
    : dateFrom === '' && dateTo === historyEndDate
      ? 'history'
      : 'custom';

  // Selected contract details for automated currency mapping
  const formContracts = useMemo(() => getReceivableContracts(
    formCustomerId,
    contracts,
    contactSheets,
    payments,
    editingContractIds
  ), [contracts, contactSheets, payments, formCustomerId, editingContractIds]);
  const selectedContractInfo = useMemo(() => {
    const firstContractId = paymentAllocations[0]?.contract_id;
    return firstContractId ? contracts.find((contract) => contract.id === firstContractId) || null : null;
  }, [paymentAllocations, contracts]);
  const formCustomer = useMemo(
    () => customers.find((customer) => customer.id === formCustomerId) || null,
    [customers, formCustomerId]
  );
  const editingReceipt = useMemo(
    () => paymentReceipts.find((receipt) => receipt.id === editingReceiptId) || null,
    [editingReceiptId, paymentReceipts]
  );
  const formCurrency = editingReceipt?.currency || selectedContractInfo?.currency || formCustomer?.default_currency || 'USD';
  const formCurrencySymbol = formCurrency === 'USD' ? '$' : '￥';
  const allocationSummary = useMemo(
    () => summarizePaymentAllocations(receiptTotalAmount, paymentAllocations),
    [receiptTotalAmount, paymentAllocations]
  );
  const { allocated: allocatedAmount, unallocated: unallocatedAmount } = allocationSummary;
  const isCreatingReceipt = !editingId && !editingReceiptId;

  const updateReceiptTotalAmount = (amount: number) => {
    const normalizedAmount = normalizeMoneyAmount(amount);
    setReceiptTotalAmount(normalizedAmount);
    if (isCreatingReceipt) {
      setPaymentAllocations((current) => balanceLastPaymentAllocation(normalizedAmount, current));
    }
  };

  const addPaymentAllocation = () => {
    setPaymentAllocations((current) => balanceLastPaymentAllocation(receiptTotalAmount, [
      ...current,
      { contract_id: '', amount: 0 }
    ]));
  };

  const changePaymentAllocationAmount = (index: number, amount: number) => {
    setPaymentAllocations((current) => isCreatingReceipt
      ? updatePaymentAllocationWithAutoRemainder(receiptTotalAmount, current, index, amount)
      : current.map((row, rowIndex) => rowIndex === index ? { ...row, amount: normalizeMoneyAmount(amount) } : row));
  };

  const removePaymentAllocation = (index: number) => {
    setPaymentAllocations((current) => {
      const remaining = current.filter((_, rowIndex) => rowIndex !== index);
      return isCreatingReceipt ? balanceLastPaymentAllocation(receiptTotalAmount, remaining) : remaining;
    });
  };

  // Auto-calculated exchange rate and RMB amount based on input date
  const calculatedExchangeRateInfo = useMemo(() => {
    if (formCurrency !== 'USD' || !paymentDate) {
      return { rate: 1, isUSD: false };
    }
    const yyyymm = paymentDate.substring(0, 7);
    const rateObj = rates.find(r => r.effective_month === yyyymm);
    return {
      rate: rateObj?.rate || 0,
      isUSD: true,
      isMissing: !rateObj,
      month: yyyymm
    };
  }, [formCurrency, paymentDate, rates]);

  // Dropdown list of contracts filtered by selected customer
  const filteredContractsDropdown = useMemo(() => {
    if (selectedCustomerId === 'all') return contracts;
    return contracts.filter(c => c.customer_id === selectedCustomerId);
  }, [selectedCustomerId, contracts]);

  const customerReceiptRows = useMemo(() => filterPaymentReceiptLedger(receiptLedgerRows, {
    customerId: selectedCustomerId,
    dateFrom,
    dateTo,
    contractId: filterContractId,
    exportType: filterExportType,
    currency: filterCurrency,
    keyword: customerSearchQuery,
  }), [receiptLedgerRows, selectedCustomerId, dateFrom, dateTo, filterContractId, filterExportType, filterCurrency, customerSearchQuery]);

  const receivableSnapshot = useMemo(() => {
    const rateForDate = (date: string | null | undefined) => {
      const rate = rateForMonth(String(date || '').slice(0, 7));
      return rate > 0 ? rate : null;
    };
    const filters = {
      customerId: selectedCustomerId,
      contractId: filterContractId,
      exportType: filterExportType,
      currency: filterCurrency,
      keyword: customerSearchQuery,
      asOfDate: dateTo || undefined
    };
    const outstandingContracts = summarizeOutstandingContractsRmb({
      contracts,
      sheets: contactSheets,
      payments,
      filters,
      rateForDate
    });
    const allCurrentReceivables = calculateCurrentReceivables({
      contracts,
      sheets: contactSheets,
      shipments,
      shipmentItems,
      payments,
      asOfDate: dateTo || undefined,
      rateForDate
    });
    const currentReceivableFacts = filterCurrentReceivableFacts(
      allCurrentReceivables.facts,
      outstandingContracts.contracts.map((contract) => contract.id),
      customerSearchQuery
    );
    return {
      currentReceivables: summarizeCurrentReceivableRmb(currentReceivableFacts),
      outstandingContracts
    };
  }, [contracts, contactSheets, payments, shipments, shipmentItems, selectedCustomerId, filterContractId, filterExportType, filterCurrency, dateTo, customerSearchQuery, rateForMonth]);

  // Customer View KPI Card stats. 起止日期仅限定实际到账；两项余额均为截止日快照。
  const customerKPIs = useMemo(() => {
    const totalRmb = customerReceiptRows.reduce((sum, row) => sum + (row.matched_amount_rmb || 0), 0);
    return {
      totalRmb,
      currentReceivableRmb: receivableSnapshot.currentReceivables.totalRmb,
      currentReceivableMissingRateCount: receivableSnapshot.currentReceivables.missingRateCount,
      outstandingContractRmb: receivableSnapshot.outstandingContracts.totalOutstandingRmb,
      outstandingContractMissingRateCount: receivableSnapshot.outstandingContracts.missingRateContractNos.length
    };
  }, [customerReceiptRows, receivableSnapshot]);

  // Customer Grouping View logic
  const groupedReceipts = useMemo<CustomerReceiptGroup[]>(() => {
    if (!groupByCustomer) return [];
    const groups = new Map<string, ReceiptLedgerRow[]>();
    customerReceiptRows.forEach((row) => groups.set(row.customer_name, [...(groups.get(row.customer_name) || []), row]));
    return [...groups.entries()].map(([customerName, rows]) => ({
      customerName,
      rows,
      totalAmountRmb: rows.reduce((sum, row) => sum + (row.matched_amount_rmb || 0), 0),
      totalAmountUsd: rows.filter((row) => row.currency === 'USD').reduce((sum, row) => sum + row.matched_amount, 0),
      hasUsdPayments: rows.some((row) => row.currency === 'USD'),
    }));
  }, [customerReceiptRows, groupByCustomer]);
  const customerPaymentPage = usePagedRows(
    customerReceiptRows,
    `${selectedCustomerId}|${dateFrom}|${dateTo}|${filterContractId}|${filterExportType}|${filterCurrency}|${customerSearchQuery}`
  );
  const customerGroupPage = usePagedRows(
    groupedReceipts,
    `group|${selectedCustomerId}|${dateFrom}|${dateTo}|${filterContractId}|${filterExportType}|${filterCurrency}|${customerSearchQuery}`
  );
  const exportablePaymentRowCount = customerReceiptRows.length;

  const handleCopyAccountingMessage = async (row: ReceiptLedgerRow) => {
    const message = buildPaymentAccountingMessage({
      receipt: {
        id: row.receipt_id || row.id,
        customer_name: row.customer_name,
        payment_date: row.payment_date,
        total_amount: row.total_amount,
        currency: row.currency,
      },
      allocations: row.allocations,
      allPayments: payments,
      contractTotals: contracts.map((contract) => ({
        contract_id: contract.id,
        total_amount: contractTotals.get(contract.id) || 0,
      })),
    });

    try {
      await navigator.clipboard.writeText(message);
      notify({ title: '入账文字已复制', message: '可直接粘贴给会计；同一笔到账的合同分摊已合并生成。', tone: 'success' });
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = message;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      notify({
        title: copied ? '入账文字已复制' : '复制失败',
        message: copied ? '可直接粘贴给会计。' : '浏览器未允许访问剪贴板，请稍后重试。',
        tone: copied ? 'success' : 'warning',
      });
    }
  };

  const handleExportCustomerExcel = async () => {
    if (!exportablePaymentRowCount || isExporting) return;
    setIsExporting(true);
    setOperationError('');
    try {
      await db.runWorkerExport('export-payments', {
        customer_id: selectedCustomerId === 'all' ? '' : selectedCustomerId,
        date_from: dateFrom,
        date_to: dateTo,
        contract_id: filterContractId === 'all' ? '' : filterContractId,
        export_type: filterExportType === 'all' ? '' : filterExportType,
        currency: filterCurrency === 'all' ? '' : filterCurrency,
        keyword: customerSearchQuery
      });
      notify({
        title: 'Excel 已导出',
        message: `已按当前筛选导出 ${customerReceiptRows.length} 笔实际到账及其合同分摊。`,
        tone: 'success'
      });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setEditingReceiptId(null);
    setEditingContractIds([]);
    setFormCustomerId('');
    setReceiptNo('');
    setReceiptTotalAmount(0);
    setPaymentAllocations([]);
    setPaymentDate(formatLocalDate());
    setNotes('');
    setOperationError('');
    setShowAddModal(true);
  };

  useEffect(() => {
    const quickContractId = sessionStorage.getItem('quick_payment_contract_id');
    if (!quickContractId) return;
    const targetContract = contracts.find((contract) => contract.id === quickContractId);
    sessionStorage.removeItem('quick_payment_contract_id');
    if (!targetContract) {
      notify({ title: '无法打开快捷收款', message: '目标合同不存在或数据尚未同步，请刷新后重试。', tone: 'warning' });
      return;
    }
    setEditingId(null);
    setEditingReceiptId(null);
    setEditingContractIds([]);
    setFormCustomerId(targetContract.customer_id);
    setReceiptNo('');
    setReceiptTotalAmount(0);
    setPaymentAllocations([{ contract_id: targetContract.id, amount: 0 }]);
    setPaymentDate(formatLocalDate());
    setNotes('');
    setOperationError('');
    setShowAddModal(true);
  }, [onRefreshTrigger, contracts, notify]);

  const handleOpenEdit = (payment: Payment) => {
    const receipt = payment.receipt_id ? paymentReceipts.find((row) => row.id === payment.receipt_id) : null;
    const receiptPayments = receipt
      ? payments.filter((row) => row.receipt_id === receipt.id)
      : [payment];
    setEditingId(receipt ? null : payment.id);
    setEditingReceiptId(receipt?.id || null);
    setEditingContractIds([...new Set(receiptPayments.map((row) => row.contract_id))]);
    setFormCustomerId(payment.customer_id || '');
    setReceiptNo(receipt?.receipt_no || '');
    setReceiptTotalAmount(receipt?.total_amount || payment.amount);
    setPaymentAllocations(receiptPayments.map((row) => ({ id: row.id, contract_id: row.contract_id, amount: row.amount })));
    setPaymentDate(receipt?.payment_date || payment.payment_date);
    setNotes(receipt?.notes || payment.notes || '');
    setOperationError('');
    setShowAddModal(true);
  };

  const handleOpenEditReceipt = (receipt: PaymentReceipt) => {
    const receiptPayments = payments.filter((row) => row.receipt_id === receipt.id);
    setEditingId(null);
    setEditingReceiptId(receipt.id);
    setEditingContractIds([...new Set(receiptPayments.map((row) => row.contract_id))]);
    setFormCustomerId(receipt.customer_id);
    setReceiptNo(receipt.receipt_no || '');
    setReceiptTotalAmount(receipt.total_amount);
    setPaymentAllocations(receiptPayments.map((row) => ({ id: row.id, contract_id: row.contract_id, amount: row.amount })));
    setPaymentDate(receipt.payment_date);
    setNotes(receipt.notes || '');
    setOperationError('');
    setShowAddModal(true);
  };

  const handleReturnAllocationToDeposit = async (paymentId: string) => {
    const payment = payments.find((row) => row.id === paymentId);
    if (!payment) return;
    const approved = await confirm({
      title: '把这笔合同分摊退回客户预存款？',
      message: `合同：${payment.contract_no}\n金额：${payment.currency === 'USD' ? '$' : '￥'}${payment.amount.toLocaleString()}\n确认后只撤回合同分摊，整笔到账记录和客户余额仍会保留，并写入修改历史。`,
      confirmLabel: '确认退回预存款',
      tone: 'warning'
    });
    if (!approved) return;
    try {
      await db.returnPaymentAllocationToDeposit(paymentId);
      setShowAddModal(false);
      onRefreshData();
      notify({ title: '已退回客户预存款', message: '合同回款已重新计算，整笔到账记录仍完整保留。', tone: 'success' });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCustomerId || receiptTotalAmount <= 0) return;
    if (unallocatedAmount < -0.005) {
      setOperationError(`分摊金额超过实际到账 ${Math.abs(unallocatedAmount).toLocaleString()}，请调整。`);
      return;
    }

    const curr = formCurrency;
    let rateVal: number | undefined;
    const normalizedReceiptTotal = normalizeMoneyAmount(receiptTotalAmount);
    let amtRmb: number | undefined = normalizedReceiptTotal;

    if (curr === 'USD') {
      rateVal = calculatedExchangeRateInfo.rate || undefined;
      amtRmb = rateVal ? normalizeMoneyAmount(normalizedReceiptTotal * rateVal) : undefined;
    }

    setIsSaving(true);
    setOperationError('');
    try {
      const receiptPayload = {
        customer_id: formCustomerId,
        receipt_no: receiptNo,
        payment_date: paymentDate,
        total_amount: normalizedReceiptTotal,
        currency: curr,
        exchange_rate: rateVal,
        notes
      };
      const allocations = paymentAllocations.map(({ contract_id, amount }) => ({
        contract_id,
        amount: normalizeMoneyAmount(amount)
      }));
      if (editingReceiptId) {
        await db.updatePaymentReceipt(editingReceiptId, receiptPayload, allocations);
      } else if (editingId && allocations.length === 1) {
        const row = allocations[0];
        await db.updatePayment(editingId, {
          contract_id: row.contract_id,
          shipment_id: null,
          payment_date: paymentDate,
          amount: row.amount,
          currency: curr,
          exchange_rate: rateVal,
          amount_rmb: amtRmb,
          notes
        });
      } else {
        await db.addPaymentReceipt(receiptPayload, allocations);
      }
      setShowAddModal(false);
      onRefreshData();
      notify({
        title: editingId || editingReceiptId ? '整笔收款已更新' : '整笔收款已登记',
        message: '相关合同回款、预付款达标日和客户余额已重新计算。',
        tone: 'success'
      });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteLedgerRow = async (row: ReceiptLedgerRow) => {
    const allocationCount = row.allocations.length;
    const confirmed = await confirm({
      title: '删除整笔到账？',
      message: `客户：${row.customer_name}\n实际到账：${row.currency === 'USD' ? '$' : '￥'}${row.total_amount.toLocaleString()}\n${allocationCount ? `涉及 ${allocationCount} 个合同分摊` : '当前全部为客户预存款'}${row.deposit_amount > 0.005 ? `，另含预存款 ${row.deposit_amount.toLocaleString()}` : ''}。\n\n删除后整笔到账及其全部分摊都会移除；客户录错时请删除后重新录入。`,
      confirmLabel: '删除整笔到账',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      if (row.receipt_id) await db.deletePaymentReceipt(row.receipt_id);
      else if (row.allocations[0]) await db.deletePayment(row.allocations[0].id);
      onRefreshData();
      notify({ title: '收款已删除', message: '相关合同的回款进度已重新计算。', tone: 'success' });
    } catch (error) {
      notify({ title: '收款删除失败', message: error instanceof Error ? error.message : String(error), tone: 'error' });
    }
  };

  const toggleReceiptExpansion = (rowId: string) => {
    setExpandedReceiptIds((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const handleOpenLedgerEdit = (row: ReceiptLedgerRow) => {
    if (row.receipt) handleOpenEditReceipt(row.receipt);
    else if (!row.receipt_id && row.allocations[0]) handleOpenEdit(row.allocations[0]);
  };

  const navigateToContract = (contractNo: string) => {
    if (!onNavigate) return;
    sessionStorage.setItem('highlight_contract_no', contractNo);
    onNavigate('contracts');
  };

  const receiptStatusLabel = (row: ReceiptLedgerRow) => {
    if (!row.allocations.length) return '客户预存款';
    if (row.allocations.length > 1) return '多合同分摊';
    if (row.deposit_amount > 0.005) return '合同分摊 + 预存款';
    return row.allocations[0].progress_status;
  };

  const renderContractNos = (row: ReceiptLedgerRow) => {
    if (!row.contract_nos.length) return <span className="font-semibold text-brand-amber">客户预存款</span>;
    const renderButton = (contractNo: string) => onNavigate ? (
      <button type="button" key={contractNo} onClick={() => navigateToContract(contractNo)} className="font-bold text-brand-cyan hover:underline">{contractNo}</button>
    ) : <span key={contractNo} className="font-bold text-slate-300">{contractNo}</span>;
    return (
      <>
        <div className="hidden flex-wrap gap-x-2 gap-y-1 xl:flex">{row.contract_nos.map(renderButton)}</div>
        <div className="flex flex-wrap gap-x-2 gap-y-1 xl:hidden">
          {row.contract_nos.slice(0, 2).map(renderButton)}
          {row.contract_nos.length > 2 && <span className="text-muted">其余 {row.contract_nos.length - 2} 个</span>}
        </div>
      </>
    );
  };

  const renderAllocationDetails = (row: ReceiptLedgerRow, colSpan: number) => {
    if (!row.is_expandable || !expandedReceiptIds.has(row.id)) return null;
    return (
      <tr id={`receipt-details-${row.id}`} className="bg-surface-muted/35">
        <td colSpan={colSpan} className="px-4 pb-4 pt-2">
          <div className="overflow-x-auto rounded-xl border border-border bg-surface/80">
            <table className="w-full min-w-[720px] text-left text-[11px]">
              <thead className="border-b border-border bg-surface-muted/60 text-muted">
                <tr><th className="px-3 py-2.5">合同号</th><th className="px-3 py-2.5">本次分摊</th><th className="px-3 py-2.5">合同总额</th><th className="px-3 py-2.5">回款进度</th><th className="px-3 py-2.5">出口类型</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {row.allocations.map((allocation) => (
                  <tr key={allocation.id} className={row.matched_allocation_ids.includes(allocation.id) ? 'bg-brand-cyan/[0.035]' : ''}>
                    <td className="px-3 py-2.5">{onNavigate ? <button type="button" onClick={() => navigateToContract(allocation.contract_no)} className="font-bold text-brand-cyan hover:underline">{allocation.contract_no}</button> : allocation.contract_no}</td>
                    <td className="px-3 py-2.5 font-mono font-bold text-ink">{row.currency === 'USD' ? '$' : '￥'}{allocation.amount.toLocaleString()}</td>
                    <td className={`px-3 py-2.5 font-mono ${allocation.contract_total > 0.005 ? 'text-body' : 'font-semibold text-brand-amber'}`}>{formatContractTotal(allocation.contract_total, row.currency)}</td>
                    <td className="px-3 py-2.5"><span className={`rounded border px-2 py-0.5 font-semibold ${allocation.contract_total > 0.005 ? 'border-brand-emerald/20 bg-brand-emerald/10 text-brand-emerald' : 'border-brand-amber/25 bg-brand-amber/15 text-brand-amber'}`}>{allocation.progress_status}</span></td>
                    <td className="px-3 py-2.5 text-body">{allocation.export_type}</td>
                  </tr>
                ))}
                {row.deposit_amount > 0.005 && (
                  <tr className="bg-brand-amber/[0.04]"><td className="px-3 py-2.5 font-semibold text-brand-amber">客户预存款</td><td className="px-3 py-2.5 font-mono font-bold text-brand-amber">{row.currency === 'USD' ? '$' : '￥'}{row.deposit_amount.toLocaleString()}</td><td colSpan={3} className="px-3 py-2.5 text-muted">暂未分配到合同；以后分配时以实际分配日作为生效日</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    );
  };

  const renderCustomerReceiptRow = (row: ReceiptLedgerRow, showCustomer: boolean) => {
    const colSpan = showCustomer ? 9 : 8;
    const singleAllocation = row.allocations.length === 1 ? row.allocations[0] : null;
    return (
      <React.Fragment key={row.id}>
        <tr className={`transition-colors hover:bg-white/[0.01] ${row.deposit_amount > 0.005 ? 'bg-brand-amber/[0.025]' : ''}`}>
          <td className="p-4 font-mono font-semibold text-slate-400">{row.payment_date}</td>
          {showCustomer && <td className="p-4 font-bold text-slate-200">{row.customer_name}</td>}
          <td className="p-4 font-mono font-bold text-white">
            <div>{row.currency === 'USD' ? '$' : '￥'}{row.total_amount.toLocaleString()}</div>
            {row.currency === 'USD' && <div className="mt-0.5 text-[10px] font-normal text-slate-500">折合: {formatPaymentRmb({ amount: row.total_amount, amount_rmb: row.amount_rmb, currency: row.currency })}{row.exchange_rate ? ` · 汇率 ${row.exchange_rate.toFixed(4)}` : ''}</div>}
            {row.matched_amount !== row.total_amount && <div className="mt-1 text-[10px] font-normal text-brand-cyan">筛选命中 {row.currency === 'USD' ? '$' : '￥'}{row.matched_amount.toLocaleString()}</div>}
          </td>
          <td className="hidden p-4 lg:table-cell">
            {row.is_composite ? (
              <div><span className="font-semibold text-body">{row.allocations.length} 个合同</span>{row.deposit_amount > 0.005 && <div className="mt-1 text-[10px] text-brand-amber">含预存款 {row.deposit_amount.toLocaleString()}</div>}</div>
            ) : singleAllocation ? (
              <span className={`font-semibold ${singleAllocation.contract_total > 0.005 ? 'text-slate-400' : 'text-brand-amber'}`}>{formatContractTotal(singleAllocation.contract_total, row.currency)}</span>
            ) : <span className="font-semibold text-brand-amber">全部预存</span>}
          </td>
          <td className="p-4"><div className="flex items-center gap-2">{row.is_expandable && <IconButton onClick={() => toggleReceiptExpansion(row.id)} label={`${expandedReceiptIds.has(row.id) ? '收起' : '展开'} ${row.allocations.length} 条合同分摊`} aria-expanded={expandedReceiptIds.has(row.id)} aria-controls={`receipt-details-${row.id}`} icon={expandedReceiptIds.has(row.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} />}{renderContractNos(row)}</div></td>
          <td className="hidden p-4 lg:table-cell"><span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${(row.deposit_amount > 0.005 && !row.allocations.length) || (singleAllocation && singleAllocation.contract_total <= 0.005) ? 'border-brand-amber/25 bg-brand-amber/15 text-brand-amber' : 'border-brand-emerald/20 bg-brand-emerald/10 text-brand-emerald'}`}>{receiptStatusLabel(row)}</span></td>
          <td className="hidden p-4 lg:table-cell"><div className="flex flex-wrap gap-1">{row.export_types.length ? row.export_types.map((type) => <span key={type} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${type === '自营' ? 'border-slate-700 bg-slate-800 text-slate-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-500'}`}>{type}</span>) : <span className="text-muted">—</span>}</div></td>
          <td className="hidden max-w-[200px] truncate p-4 text-slate-400 lg:table-cell" title={row.notes}>{row.notes || '-'}</td>
          <td className="sticky right-0 z-10 min-w-[128px] bg-surface p-4 text-right"><div className="flex justify-end gap-1"><IconButton onClick={() => void handleCopyAccountingMessage(row)} label="复制会计入账文字" tone="primary" icon={<Copy className="w-3.5 h-3.5" />} /><IconButton requiresEdit onClick={() => handleOpenLedgerEdit(row)} disabled={Boolean(row.receipt_id && !row.receipt)} label="编辑整笔到账" icon={<Edit2 className="w-3.5 h-3.5" />} /><IconButton requiresEdit onClick={() => void handleDeleteLedgerRow(row)} disabled={Boolean(row.receipt_id && !row.receipt)} label="删除整笔到账" tone="danger" icon={<Trash2 className="w-3.5 h-3.5" />} /></div></td>
        </tr>
        {renderAllocationDetails(row, colSpan)}
      </React.Fragment>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title={viewMode === 'balance' ? '客户货款平衡中心' : '回款明细台账'}
        description={viewMode === 'balance'
          ? '按客户汇总累计收款与累计发货，快速判断是我方待交货，还是客户待付款'
          : `按银行实际到账登记资金流水；默认显示本财年（${fiscalRange.label}），历史收款可在历史财年中查看`}
        actions={viewMode === 'balance' ? undefined : (
          <Button requiresEdit
            onClick={handleOpenAdd}
            icon={<Plus className="h-4 w-4" />}
          >
            登记录入收款
          </Button>
        )}
      />

      {/* Tabs Switcher */}
      <div className="grid grid-cols-2 border-b border-white/[0.06] text-xs font-semibold sm:flex" role="tablist" aria-label="回款视图" onKeyDown={handleTabListKeyDown}>
        <button
          type="button"
          id="payments-tab-customer"
          role="tab"
          aria-selected={viewMode === 'customer'}
          aria-controls="payments-panel-customer"
          aria-label="回款明细"
          tabIndex={viewMode === 'customer' ? 0 : -1}
          onClick={() => setViewMode('customer')}
          className={`min-w-0 border-b-2 px-2 py-3 text-center transition-all sm:px-6 ${
            viewMode === 'customer'
              ? 'border-brand-cyan text-brand-cyan bg-white/[0.01]'
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/[0.005]'
          }`}
        >
          回款明细
        </button>
        <button
          type="button"
          id="payments-tab-balance"
          role="tab"
          aria-selected={viewMode === 'balance'}
          aria-controls="payments-panel-balance"
          aria-label="客户货款平衡"
          tabIndex={viewMode === 'balance' ? 0 : -1}
          onClick={() => setViewMode('balance')}
          className={`min-w-0 border-b-2 px-2 py-3 text-center transition-all sm:px-6 ${
            viewMode === 'balance'
              ? 'border-brand-cyan text-brand-cyan bg-white/[0.01]'
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/[0.005]'
          }`}
        >
          <span className="sm:hidden">货款平衡</span><span className="hidden sm:inline">客户货款平衡</span>
        </button>
      </div>

      <div id={`payments-panel-${viewMode}`} role="tabpanel" aria-labelledby={`payments-tab-${viewMode}`} className="space-y-6">
      {viewMode === 'customer' ? (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-brand-cyan/20 bg-brand-cyan/[0.06] p-2.5 text-xs text-body sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1.5" role="group" aria-label="回款日期快捷范围">
              <button
                type="button"
                onClick={() => { setDateFrom(fiscalRange.startDate); setDateTo(fiscalRange.endDate); }}
                aria-pressed={activePeriodPreset === 'fiscal'}
                className={`rounded-lg px-3 py-2 font-semibold transition-colors ${activePeriodPreset === 'fiscal' ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted hover:bg-surface/70 hover:text-body'}`}
              >
                本财年（{paymentPeriodCounts.fiscal}）
              </button>
              <button
                type="button"
                onClick={() => { setDateFrom(''); setDateTo(historyEndDate); }}
                aria-pressed={activePeriodPreset === 'history'}
                className={`rounded-lg px-3 py-2 font-semibold transition-colors ${activePeriodPreset === 'history' ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted hover:bg-surface/70 hover:text-body'}`}
              >
                历史收款（{paymentPeriodCounts.history}）
              </button>
            </div>
            <div className="px-1 sm:text-right">
              {activePeriodPreset === 'custom' && <span className="mr-2 rounded border border-brand-amber/20 bg-brand-amber/10 px-2 py-0.5 font-semibold text-brand-amber">自定义范围</span>}
              当前回款考核周期：<span className="font-semibold text-brand-cyan">{dateFrom || '不限'} 至 {dateTo || '不限'}</span>
            </div>
          </div>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-white/[0.04] bg-white/[0.01] flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">本期实际回款（人民币）</span>
              <span className="text-base font-bold text-white mt-1.5 font-mono">
                ￥{customerKPIs.totalRmb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-500 mt-1 italic">按 {dateFrom || '不限'} 至 {dateTo || '不限'} 的实际到账汇总</span>
            </div>

            <div className="p-4 rounded-xl border border-white/[0.04] bg-white/[0.01] flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">已发货未收货款</span>
              <span className={`text-base font-bold mt-1.5 font-mono ${customerKPIs.currentReceivableRmb > 0 ? 'text-brand-rose' : 'text-slate-300'}`}>
                ￥{customerKPIs.currentReceivableRmb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-500 mt-1">
                截至 {dateTo || '当前'}；合同内按先发先抵
                {customerKPIs.currentReceivableMissingRateCount > 0 ? `；${customerKPIs.currentReceivableMissingRateCount} 条缺汇率未计入` : ''}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-white/[0.04] bg-white/[0.01] flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">执行中合同未收余额（含未发货）</span>
              <span className={`text-base font-bold mt-1.5 font-mono ${customerKPIs.outstandingContractRmb > 0 ? 'text-brand-cyan' : 'text-slate-300'}`}>
                ￥{customerKPIs.outstandingContractRmb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-500 mt-1">
                截至 {dateTo || '当前'}；合同总额减全部已到账款项
                {customerKPIs.outstandingContractMissingRateCount > 0 ? `；${customerKPIs.outstandingContractMissingRateCount} 个合同缺汇率未计入` : ''}
              </span>
            </div>
          </div>


          {/* Customer View Filters */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 p-4 rounded-xl glass-panel text-xs items-end border border-white/[0.04] bg-white/[0.01]">
            <div className="space-y-1">
              <label className="text-slate-400 font-semibold flex items-center gap-1">
                <Building className="w-3.5 h-3.5 text-brand-cyan" /> 选择客户
              </label>
              <CustomerSelect
                value={selectedCustomerId}
                onChange={(nextCustomerId) => {
                  setSelectedCustomerId(nextCustomerId);
                  setFilterContractId('all');
                }}
                customers={customers}
                allOption={{ value: 'all', label: '全部客户' }}
                ariaLabel="选择客户"
                searchPlaceholder="输入客户名称搜索"
                emptyMessage="没有匹配的已有客户"
                size="sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 font-semibold flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" /> 起始时间
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-slate-200"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 font-semibold flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" /> 截止时间
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-slate-200"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 font-semibold flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-slate-500" /> 关联合同
              </label>
              <SearchableCombobox
                value={filterContractId}
                onChange={setFilterContractId}
                options={[
                  { value: 'all', label: '全部合同' },
                  ...filteredContractsDropdown.map(contract => ({
                    value: contract.id,
                    label: contract.contract_no,
                    searchText: contract.contract_no
                  }))
                ]}
                ariaLabel="关联合同"
                searchPlaceholder="输入合同号搜索"
                emptyMessage="没有匹配的已有合同"
                size="sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 font-semibold flex items-center gap-1">
                <ListFilter className="w-3.5 h-3.5 text-slate-500" /> 出口类型
              </label>
              <select
                value={filterExportType}
                onChange={(e) => setFilterExportType(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-200"
              >
                <option value="all">全部出口</option>
                <option value="自营">自营</option>
                <option value="转口">转口</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-slate-400 font-semibold flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-slate-500" /> 币种
              </label>
              <select
                value={filterCurrency}
                onChange={(e) => setFilterCurrency(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-200"
              >
                <option value="all">全部币种</option>
                <option value="USD">USD ($)</option>
                <option value="RMB">RMB (￥)</option>
              </select>
            </div>
          </div>

          {/* Table Toolbar */}
          <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 text-xs pt-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 w-4 h-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="搜索客户、合同号、流水号、PO号或备注..."
                value={customerSearchQuery}
                onChange={(e) => setCustomerSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-white/[0.06] rounded-lg text-slate-200 focus:border-brand-cyan/50"
              />
            </div>

            <div className="flex items-center gap-4 justify-between sm:justify-end">
              <label className="flex items-center gap-2 text-slate-400 font-medium select-none cursor-pointer">
                <input
                  type="checkbox"
                  checked={groupByCustomer}
                  onChange={(e) => setGroupByCustomer(e.target.checked)}
                  className="rounded bg-slate-950 border-white/[0.08] text-brand-cyan focus:ring-0 focus:ring-offset-0 w-3.5 h-3.5"
                />
                <span>按客户分组查看</span>
              </label>

              <button
                onClick={() => void handleExportCustomerExcel()}
                disabled={!exportablePaymentRowCount || isExporting}
                className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-white/[0.04] transition-all font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {isExporting ? '正在生成 Excel…' : '导出当前明细 (Excel)'}
              </button>
            </div>
          </div>

          {/* Customer View Table */}
          <DataTable ariaLabel="客户回款明细" className="glass-panel text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.02] text-slate-400 font-semibold select-none">
                    <th className="p-4">客户到账时间</th>
                    {selectedCustomerId === 'all' && !groupByCustomer && <th className="p-4">客户名称</th>}
                    <th className="p-4">实际到账</th>
                    <th className="hidden p-4 lg:table-cell">分摊情况</th>
                    <th className="p-4">合同号 / PI号</th>
                    <th className="hidden p-4 lg:table-cell">回款状态</th>
                    <th className="hidden p-4 lg:table-cell">出口类型</th>
                    <th className="hidden p-4 lg:table-cell">备注</th>
                    <th className="sticky right-0 z-10 bg-surface-muted p-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {groupByCustomer ? (
                    groupedReceipts.length > 0 ? (
                      customerGroupPage.rows.map(({ customerName, rows, totalAmountRmb, totalAmountUsd, hasUsdPayments }) => (
                        <React.Fragment key={customerName}>
                          <tr className="border-y border-white/[0.04] bg-white/[0.02]">
                            <td colSpan={8} className="p-3 pl-4">
                              <div className="flex flex-col items-start gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                                <span className="flex items-center gap-1.5 font-bold text-brand-cyan">
                                  <Building className="h-3.5 w-3.5" /> 客户: {customerName} <span className="text-[10px] font-normal text-slate-500">({rows.length} 笔实际到账)</span>
                                </span>
                                <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 font-bold text-slate-400">
                                  {hasUsdPayments && <span>回款小计 (USD): <span className="font-mono text-brand-cyan">${totalAmountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>}
                                  <span>回款小计 (RMB折合): <span className="font-mono text-white">￥{totalAmountRmb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                                </div>
                              </div>
                            </td>
                          </tr>
                          {rows.map((row) => renderCustomerReceiptRow(row, false))}
                        </React.Fragment>
                      ))
                    ) : <tr><td colSpan={8} className="bg-transparent p-10 text-center italic text-slate-500">暂无符合过滤条件的收款流水数据</td></tr>
                  ) : customerReceiptRows.length > 0 ? (
                    customerPaymentPage.rows.map((row) => renderCustomerReceiptRow(row, selectedCustomerId === 'all'))
                  ) : (
                    <tr><td colSpan={selectedCustomerId === 'all' ? 9 : 8} className="bg-transparent p-10 text-center italic text-slate-500">暂无符合过滤条件的收款流水数据</td></tr>
                  )}
                </tbody>
          </DataTable>
          {groupByCustomer ? (
            <PaginationControls {...customerGroupPage} onPageChange={customerGroupPage.setPage} itemLabel="组客户" />
          ) : (
            <PaginationControls {...customerPaymentPage} onPageChange={customerPaymentPage.setPage} itemLabel="笔实际到账" />
          )}
        </>
      ) : (
        <CustomerBalancePanel onRefreshTrigger={onRefreshTrigger} />
      )}
      </div>

      {/* Add Payment Modal */}
      {showAddModal && (
        <Dialog onClose={() => setShowAddModal(false)} ariaLabel={editingId || editingReceiptId ? '编辑整笔客户收款' : '登记一笔客户收款'}>
          <div className="dialog-panel w-full max-w-3xl max-h-[92vh] overflow-y-auto p-6 space-y-6">
            <div className="flex justify-between items-center pb-2 border-b border-white/[0.04]">
              <div><h3 className="font-heading font-bold text-lg text-white">{editingId || editingReceiptId ? '编辑整笔客户收款' : '登记一笔客户收款'}</h3><p className="text-[11px] text-slate-500 mt-1">先登记银行实际到账；合同分摊可为空或只分摊一部分，剩余金额会作为客户预存款保留。</p></div>
              <IconButton onClick={() => setShowAddModal(false)} label="关闭收款表单" icon={<X className="w-5 h-5" />} />
            </div>
            <form onSubmit={handleSubmit} className="space-y-5 text-xs">
              <div className="grid sm:grid-cols-3 gap-4">
                <FormField label="付款客户" required>
                  <CustomerSelect
                    value={formCustomerId}
                    onChange={(nextCustomerId) => { setFormCustomerId(nextCustomerId); setPaymentAllocations([]); setReceiptTotalAmount(0); }}
                    customers={customers}
                    ariaLabel="付款客户"
                    placeholder="请选择客户"
                    searchPlaceholder="输入客户名称搜索"
                    emptyMessage="没有匹配的已有客户"
                    disabled={Boolean(editingId || editingReceiptId)}
                  />
                </FormField>
                <div className="space-y-1">
                  <label className="text-slate-400">银行流水号 / 水单号（可选）</label>
                  <input value={receiptNo} onChange={(event) => setReceiptNo(event.target.value)} placeholder="用于识别整笔实际收款" className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200" />
                </div>
                <FormField label="实际到账总额" htmlFor="receipt-total-amount" required hint={`按客户默认币种登记：${formCurrency}`}>
                  <input id="receipt-total-amount" type="number" min="0.0001" step="0.0001" inputMode="decimal" required value={receiptTotalAmount || ''} onChange={(event) => updateReceiptTotalAmount(parseFloat(event.target.value) || 0)} placeholder="输入水单实际金额" className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-right text-sm font-semibold text-ink" />
                </FormField>
              </div>

              {formCustomerId && <div className="space-y-3"><div className="flex items-center justify-between gap-3"><div><label className="font-semibold text-slate-200">合同分摊（可选）</label><p className="mt-1 text-[10px] text-muted">只登记客观金额；回款阶段与预付款达标日由系统累计计算。新增时最后一条会自动补齐剩余到账金额。</p></div><Button type="button" tone="warning" size="sm" disabled={!formContracts.length} icon={<Plus className="h-4 w-4" />} onClick={addPaymentAllocation} className="shadow-lg shadow-brand-amber/15">添加合同</Button></div>
                <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-surface-muted/45 p-3">
                  <div><div className="text-[10px] text-muted">实际到账</div><div className="mt-1 font-bold text-ink">{formCurrencySymbol}{receiptTotalAmount.toLocaleString()}</div></div>
                  <div><div className="text-[10px] text-muted">已分摊合同</div><div className="mt-1 font-bold text-brand-cyan">{formCurrencySymbol}{allocatedAmount.toLocaleString()}</div></div>
                  <div><div className="text-[10px] text-muted">客户预存款</div><div className={`mt-1 font-bold ${unallocatedAmount < -0.005 ? 'text-brand-rose' : unallocatedAmount <= 0.005 ? 'text-brand-emerald' : 'text-brand-amber'}`}>{formCurrencySymbol}{Math.max(0, unallocatedAmount).toLocaleString()}</div></div>
                </div>
                <div className="space-y-2">{paymentAllocations.map((allocation, index) => {
                  const selectedIds = new Set(paymentAllocations.filter((_, rowIndex) => rowIndex !== index).map((row) => row.contract_id));
                  const availableContracts = formContracts.filter((contract) => !selectedIds.has(contract.id) && (!selectedContractInfo || contract.currency === selectedContractInfo.currency || allocation.contract_id === contract.id));
                  const comparablePayments = payments.filter((payment) => editingReceiptId ? payment.receipt_id !== editingReceiptId : payment.id !== editingId);
                  const contractAmount = allocation.contract_id ? getContractAmount(allocation.contract_id, contactSheets) : 0;
                  const allocationContract = allocation.contract_id ? contracts.find((contract) => contract.id === allocation.contract_id) : null;
                  const contractOutstanding = allocation.contract_id
                    ? getContractOutstandingAmount(
                        allocation.contract_id,
                        contactSheets,
                        comparablePayments
                      )
                    : 0;
                  return <div key={`${index}-${allocation.contract_id}`} className="space-y-2 rounded-xl border border-border bg-surface-muted/35 p-3">
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1.6fr)_minmax(110px,0.8fr)_40px] md:items-center">
                    <SearchableCombobox
                      value={allocation.contract_id}
                      onChange={(nextContractId) => setPaymentAllocations((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, contract_id: nextContractId } : row))}
                      options={availableContracts.map(contract => ({
                        value: contract.id,
                        label: `${contract.contract_no} · ${contract.currency}`,
                        description: getContractAmount(contract.id, contactSheets) > 0.005
                          ? `剩余应收 ${contract.currency === 'USD' ? '$' : '￥'}${getContractOutstandingAmount(contract.id, contactSheets, comparablePayments).toLocaleString()}`
                          : '合同金额待联系单形成，可先登记到账',
                        searchText: contract.contract_no
                      }))}
                      ariaLabel={`第 ${index + 1} 条分摊合同`}
                      placeholder="选择合同"
                      searchPlaceholder="输入合同号搜索"
                      emptyMessage="没有可分摊的匹配合同"
                      className="min-w-0"
                    />
                    <input type="number" min="0.0001" step="0.0001" inputMode="decimal" required value={allocation.amount || ''} onChange={(event) => changePaymentAllocationAmount(index, parseFloat(event.target.value) || 0)} placeholder="分摊金额" className="min-w-0 w-full rounded-lg border border-white/[0.06] bg-slate-900/60 px-3 py-2.5 text-right text-slate-200" />
                    <div className="flex w-10 items-center justify-end gap-1">
                      <IconButton type="button" onClick={() => removePaymentAllocation(index)} label={`移除第 ${index + 1} 个合同分摊`} tone="danger" size="md" icon={<Trash2 className="w-4 h-4" />} />
                    </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {allocation.contract_id && (contractAmount > 0.005
                        ? <div className="text-[10px] text-muted">该合同本次收款前剩余应收：<span className="font-semibold text-body">{allocationContract?.currency === 'USD' ? '$' : '￥'}{contractOutstanding.toLocaleString()}</span></div>
                        : <div className="text-[10px] font-semibold text-brand-amber">合同金额待联系单形成，可先登记到账；回款率将在金额形成后自动计算。</div>)}
                      {allocation.id && editingReceiptId && (
                        <Button requiresEdit type="button" size="sm" tone="secondary" onClick={() => void handleReturnAllocationToDeposit(allocation.id!)}>
                          退回预存款
                        </Button>
                      )}
                    </div>
                  </div>;
                })}{!paymentAllocations.length && <div className="p-6 text-center text-slate-500 border border-dashed border-white/[0.08] rounded-xl">{formContracts.length ? '当前整笔金额将作为客户预存款；合同确定后可再次编辑并分摊' : '该客户暂无可分摊合同，整笔金额将作为客户预存款保存'}</div>}</div>
              </div>}

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1"><label className="text-slate-400">收款日期</label><input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200" /></div>
                <div className="rounded-lg border border-brand-amber/20 bg-brand-amber/5 px-3.5 py-2.5 text-[11px] leading-5 text-body"><strong className="text-ink">无需选择预付款、尾款或全款。</strong><br />系统按合同约定比例与累计回款自动判断；未分摊余额继续作为客户预存款。</div>
              </div>

              {/* Automatic FX lookup and compute info */}
              {formCustomerId && formCurrency === 'USD' && (
                <div className="p-3 bg-slate-900/60 border border-white/[0.05] rounded-lg space-y-2 text-[11px] leading-relaxed">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>使用 {calculatedExchangeRateInfo.month} 手动维护的汇率:</span>
                    <span className="font-bold text-white">{calculatedExchangeRateInfo.rate ? calculatedExchangeRateInfo.rate.toFixed(4) : '未维护'}</span>
                  </div>
                  {calculatedExchangeRateInfo.isMissing && (
                    <div className="text-[10px] text-brand-amber font-medium">
                      * 当月汇率尚未维护，本次仅保存原币金额，不生成虚假的人民币折算金额。
                    </div>
                  )}
                  <div className="flex justify-between items-center text-slate-400 pt-1.5 border-t border-white/[0.04]">
                    <span>折合人民币金额:</span>
                    <span className="font-bold text-brand-emerald text-xs">{calculatedExchangeRateInfo.rate ? `￥${(receiptTotalAmount * calculatedExchangeRateInfo.rate).toLocaleString()}` : '--'}</span>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-slate-400">收款备注说明</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="如 水单号，银行扣费说明等..."
                  className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200"
                />
              </div>

              <div className="pt-4 flex justify-end gap-3 text-sm">
                {operationError && <div className="mr-auto text-xs text-brand-rose">{operationError}</div>}
                <Button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  tone="secondary"
                >
                  取消
                </Button>
                <Button requiresEdit
                  type="submit"
                  disabled={isSaving || !formCustomerId || paymentAllocations.some((row) => !row.contract_id || row.amount <= 0) || receiptTotalAmount <= 0 || unallocatedAmount < -0.005}
                >
                  {isSaving ? '保存中...' : editingId || editingReceiptId ? '保存整笔修改' : '登记整笔收款'}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      )}
    </div>
  );
};
