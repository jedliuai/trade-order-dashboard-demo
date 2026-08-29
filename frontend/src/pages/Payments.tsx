import React, { useState, useMemo } from 'react';
import { db } from '../services/dataStore';
import { useEffect } from 'react';
import { Plus, Search, Edit2, Trash2, X, FileSpreadsheet, Layers, Building, Calendar, DollarSign, ListFilter, Copy } from 'lucide-react';
import type { Payment, PaymentReceipt, ShipmentItem } from '../services/dataStore';
import { formatLocalDate } from '../services/dateUtils';
import { balanceLastPaymentAllocation, createCustomerDepositLedgerRow, getContractOutstandingAmount, getReceivableContracts, normalizeMoneyAmount, sortPaymentLedger, summarizePaymentAllocations, updatePaymentAllocationWithAutoRemainder } from '../services/financialRules';
import { Dialog } from '../components/Dialog';
import { FilterPanel, PageHeader } from '../components/PageHeader';
import { useFeedback } from '../components/FeedbackProvider';
import { FormField } from '../components/FormField';
import { SearchableCombobox } from '../components/SearchableCombobox';
import { CustomerSelect } from '../components/CustomerSelect';
import { IconButton } from '../components/IconButton';
import { Button } from '../components/Button';
import { DataTable } from '../components/DataTable';
import { PaginationControls } from '../components/PaginationControls';
import { usePagedRows } from '../hooks/usePagedRows';
import { getFiscalYearRange, isDateInRange } from '../services/fiscalYear';
import {
  calculateCurrentReceivables,
  filterCurrentReceivableFacts,
  groupPaymentsByCustomer,
  summarizeCurrentReceivableRmb,
  summarizeOutstandingContractsRmb
} from '../services/receivablesWorkspace';
import { CustomerBalancePanel } from './CustomerBalancePanel';
import { buildPaymentAccountingMessage } from '../services/paymentAccountingMessage';
import { deriveReceiptPaymentType, PAYMENT_TYPE_OPTIONS, type PaymentType } from '../services/paymentAllocationTypes';

type PaymentAmountLike = { amount: number; amount_rmb?: number; currency: 'USD' | 'RMB' };
type CustomerDepositReceipt = PaymentReceipt & {
  customer_name: string;
  allocated_amount: number;
  deposit_amount: number;
};
type CustomerLedgerRow = Omit<Payment, 'payment_type' | 'export_type'> & {
  payment_type: Payment['payment_type'] | '客户预存款';
  export_type: Payment['export_type'] | '';
  is_customer_deposit?: boolean;
  deposit_receipt?: CustomerDepositReceipt;
};

function amountRmbOrZero(payment: PaymentAmountLike) {
  if (payment.amount_rmb !== undefined && payment.amount_rmb !== null) return payment.amount_rmb;
  return payment.currency === 'RMB' ? payment.amount : 0;
}

function formatPaymentRmb(payment: PaymentAmountLike) {
  if (payment.amount_rmb !== undefined && payment.amount_rmb !== null) {
    return `￥${payment.amount_rmb.toLocaleString()}`;
  }
  return payment.currency === 'RMB' ? `￥${payment.amount.toLocaleString()}` : '缺汇率';
}

interface PaymentsProps {
  onNavigate?: (tab: string) => void;
  onRefreshData: () => void;
  onRefreshTrigger: number;
  initialView?: 'all' | 'customer' | 'balance';
}

export const Payments: React.FC<PaymentsProps> = ({ onNavigate, onRefreshData, onRefreshTrigger, initialView = 'customer' }) => {
  const { confirm, notify } = useFeedback();
  const fiscalRange = useMemo(() => getFiscalYearRange(), []);
  const [viewMode, setViewMode] = useState<'all' | 'customer' | 'balance'>(initialView);
  const [ledgerPeriod, setLedgerPeriod] = useState<'fiscal' | 'history'>('fiscal');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [editingContractIds, setEditingContractIds] = useState<string[]>([]);

  // Form State
  const [formCustomerId, setFormCustomerId] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [receiptTotalAmount, setReceiptTotalAmount] = useState(0);
  const [paymentAllocations, setPaymentAllocations] = useState<{ id?: string; contract_id: string; shipment_id: string; amount: number; payment_type: PaymentType }[]>([]);
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
  const [filterPaymentType, setFilterPaymentType] = useState<string>('all');
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

  // Original view payment filtering
  const filteredPayments = useMemo(() => {
    return sortPaymentLedger(payments.filter(p => {
      const inFiscalYear = isDateInRange(p.payment_date, fiscalRange.startDate, fiscalRange.endDate);
      if (ledgerPeriod === 'fiscal' ? !inFiscalYear : inFiscalYear) return false;
      return p.contract_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.payment_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        Boolean(p.notes && p.notes.toLowerCase().includes(searchQuery.toLowerCase()));
    }));
  }, [payments, searchQuery, ledgerPeriod, fiscalRange]);

  const paymentPeriodCounts = useMemo(() => payments.reduce((counts, payment) => {
    if (isDateInRange(payment.payment_date, fiscalRange.startDate, fiscalRange.endDate)) counts.fiscal += 1;
    else counts.history += 1;
    return counts;
  }, { fiscal: 0, history: 0 }), [payments, fiscalRange]);

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
      { contract_id: '', shipment_id: '', amount: 0, payment_type: '预付款' as PaymentType }
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

  const customerDepositReceipts = useMemo<CustomerDepositReceipt[]>(() => {
    const allocatedByReceipt = payments.reduce((map, payment) => {
      if (payment.receipt_id) map.set(payment.receipt_id, (map.get(payment.receipt_id) || 0) + payment.amount);
      return map;
    }, new Map<string, number>());
    return paymentReceipts
      .map((receipt) => ({
        ...receipt,
        customer_name: customers.find((customer) => customer.id === receipt.customer_id)?.name || '未知客户',
        allocated_amount: allocatedByReceipt.get(receipt.id) || 0,
        deposit_amount: normalizeMoneyAmount(receipt.total_amount - (allocatedByReceipt.get(receipt.id) || 0))
      }))
      .filter((receipt) => receipt.deposit_amount > 0.005)
      .filter((receipt) => selectedCustomerId === 'all' || receipt.customer_id === selectedCustomerId)
      .filter((receipt) => !dateFrom || receipt.payment_date >= dateFrom)
      .filter((receipt) => !dateTo || receipt.payment_date <= dateTo)
      .filter(() => filterContractId === 'all' && filterExportType === 'all')
      .filter(() => filterPaymentType === 'all' || filterPaymentType === '客户预存款')
      .filter((receipt) => filterCurrency === 'all' || receipt.currency === filterCurrency)
      .filter((receipt) => {
        if (!customerSearchQuery) return true;
        const query = customerSearchQuery.toLocaleLowerCase();
        return `${receipt.customer_name} ${receipt.receipt_no || ''} ${receipt.notes || ''}`.toLocaleLowerCase().includes(query);
      })
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.created_at.localeCompare(a.created_at));
  }, [paymentReceipts, payments, customers, selectedCustomerId, dateFrom, dateTo, filterContractId, filterPaymentType, filterExportType, filterCurrency, customerSearchQuery]);

  // Dropdown list of contracts filtered by selected customer
  const filteredContractsDropdown = useMemo(() => {
    if (selectedCustomerId === 'all') return contracts;
    return contracts.filter(c => c.customer_id === selectedCustomerId);
  }, [selectedCustomerId, contracts]);

  // Customer View filter logic
  const customerFilteredPayments = useMemo(() => {
    return sortPaymentLedger(payments.filter(p => {
      // 1. Customer filter
      if (selectedCustomerId !== 'all' && p.customer_id !== selectedCustomerId) {
        return false;
      }
      // 2. Date range filter
      if (dateFrom && p.payment_date < dateFrom) return false;
      if (dateTo && p.payment_date > dateTo) return false;
      // 3. Contract filter
      if (filterContractId !== 'all' && p.contract_id !== filterContractId) {
        return false;
      }
      // 4. Payment type filter
      if (filterPaymentType !== 'all' && p.payment_type !== filterPaymentType) {
        return false;
      }
      // 5. Export type filter
      if (filterExportType !== 'all' && p.export_type !== filterExportType) {
        return false;
      }
      // 6. Currency filter
      if (filterCurrency !== 'all' && p.currency !== filterCurrency) {
        return false;
      }
      // 7. Search query filter
      if (customerSearchQuery) {
        const query = customerSearchQuery.toLowerCase();
        const matchesContract = p.contract_no && p.contract_no.toLowerCase().includes(query);
        const matchesCustomer = p.customer_name && p.customer_name.toLowerCase().includes(query);
        const matchesReceipt = p.receipt_no && p.receipt_no.toLowerCase().includes(query);
        const matchesNotes = p.notes && p.notes.toLowerCase().includes(query);
        const contract = contracts.find(c => c.id === p.contract_id);
        const matchesPO = contract && (
          (contract.notes && contract.notes.toLowerCase().includes(query)) ||
          (contract.internal_contract_seq && contract.internal_contract_seq.toLowerCase().includes(query))
        );
        if (!matchesContract && !matchesCustomer && !matchesReceipt && !matchesNotes && !matchesPO) {
          return false;
        }
      }
      return true;
    }));
  }, [payments, selectedCustomerId, dateFrom, dateTo, filterContractId, filterPaymentType, filterExportType, filterCurrency, customerSearchQuery, contracts]);

  const customerLedgerRows = useMemo<CustomerLedgerRow[]>(() => {
    const depositRows: CustomerLedgerRow[] = customerDepositReceipts.map((receipt) => ({
      ...createCustomerDepositLedgerRow(receipt),
      deposit_receipt: receipt
    }));
    return sortPaymentLedger([
      ...customerFilteredPayments.map((payment) => ({ ...payment, is_customer_deposit: false })),
      ...depositRows
    ]);
  }, [customerDepositReceipts, customerFilteredPayments]);

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
    const totalRmb = customerLedgerRows.reduce((sum, p) => sum + amountRmbOrZero(p), 0);
    return {
      totalRmb,
      currentReceivableRmb: receivableSnapshot.currentReceivables.totalRmb,
      currentReceivableMissingRateCount: receivableSnapshot.currentReceivables.missingRateCount,
      outstandingContractRmb: receivableSnapshot.outstandingContracts.totalOutstandingRmb,
      outstandingContractMissingRateCount: receivableSnapshot.outstandingContracts.missingRateContractNos.length
    };
  }, [customerLedgerRows, receivableSnapshot]);

  // Customer Grouping View logic
  const groupedPayments = useMemo(() => {
    if (!groupByCustomer) return [];
    return groupPaymentsByCustomer(customerLedgerRows);
  }, [customerLedgerRows, groupByCustomer]);
  const ledgerPage = usePagedRows(filteredPayments, `${ledgerPeriod}|${searchQuery}`);
  const customerPaymentPage = usePagedRows(
    customerLedgerRows,
    `${selectedCustomerId}|${dateFrom}|${dateTo}|${filterContractId}|${filterPaymentType}|${filterExportType}|${filterCurrency}|${customerSearchQuery}`
  );
  const customerGroupPage = usePagedRows(
    groupedPayments,
    `group|${selectedCustomerId}|${dateFrom}|${dateTo}|${filterContractId}|${filterPaymentType}|${filterExportType}|${filterCurrency}|${customerSearchQuery}`
  );
  const exportablePaymentRowCount = customerLedgerRows.length;

  const handleCopyAccountingMessage = async (row: CustomerLedgerRow) => {
    const linkedReceipt = row.receipt_id
      ? paymentReceipts.find((receipt) => receipt.id === row.receipt_id)
      : row.deposit_receipt || null;
    const receiptAllocations = linkedReceipt
      ? payments.filter((payment) => payment.receipt_id === linkedReceipt.id)
      : row.is_customer_deposit ? [] : [row as Payment];
    const customerName = row.customer_name
      || customers.find((customer) => customer.id === linkedReceipt?.customer_id)?.name
      || '未知客户';
    const message = buildPaymentAccountingMessage({
      receipt: linkedReceipt ? {
        id: linkedReceipt.id,
        customer_name: customerName,
        payment_date: linkedReceipt.payment_date,
        total_amount: linkedReceipt.total_amount,
        currency: linkedReceipt.currency,
        payment_type: linkedReceipt.payment_type,
      } : {
        id: row.id,
        customer_name: customerName,
        payment_date: row.payment_date,
        total_amount: row.amount,
        currency: row.currency,
        payment_type: row.payment_type,
      },
      allocations: receiptAllocations,
      allPayments: payments,
      contractTotals: contracts.map((contract) => ({
        contract_id: contract.id,
        total_amount: contactSheets
          .filter((sheet) => sheet.contract_id === contract.id)
          .reduce((sum, sheet) => sum + sheet.quantity * sheet.unit_price, 0),
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
      await db.runLocalExport('export-payments', {
        customer_id: selectedCustomerId === 'all' ? '' : selectedCustomerId,
        date_from: dateFrom,
        date_to: dateTo,
        contract_id: filterContractId === 'all' ? '' : filterContractId,
        payment_type: filterPaymentType === 'all' ? '' : filterPaymentType,
        export_type: filterExportType === 'all' ? '' : filterExportType,
        currency: filterCurrency === 'all' ? '' : filterCurrency,
        keyword: customerSearchQuery
      });
      notify({
        title: 'Excel 已导出',
        message: `已按当前筛选导出 ${customerFilteredPayments.length} 条合同分摊和 ${customerDepositReceipts.length} 条客户预存款明细。`,
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
    setPaymentAllocations([{ contract_id: targetContract.id, shipment_id: '', amount: 0, payment_type: '预付款' }]);
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
    setPaymentAllocations(receiptPayments.map((row) => ({ id: row.id, contract_id: row.contract_id, shipment_id: row.shipment_id || '', amount: row.amount, payment_type: row.payment_type })));
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
    setPaymentAllocations(receiptPayments.map((row) => ({ id: row.id, contract_id: row.contract_id, shipment_id: row.shipment_id || '', amount: row.amount, payment_type: row.payment_type })));
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
        payment_type: deriveReceiptPaymentType(paymentAllocations),
        exchange_rate: rateVal,
        notes
      };
      const allocations = paymentAllocations.map(({ contract_id, shipment_id, amount, payment_type }) => ({
        contract_id,
        shipment_id: shipment_id || null,
        amount: normalizeMoneyAmount(amount),
        payment_type
      }));
      if (editingReceiptId) {
        await db.updatePaymentReceipt(editingReceiptId, receiptPayload, allocations);
      } else if (editingId && allocations.length === 1) {
        const row = allocations[0];
        await db.updatePayment(editingId, {
          contract_id: row.contract_id,
          shipment_id: row.shipment_id || null,
          payment_date: paymentDate,
          amount: row.amount,
          currency: curr,
          payment_type: row.payment_type,
          exchange_rate: rateVal,
          amount_rmb: amtRmb,
          notes
        });
      } else {
        await db.addPaymentReceipt(receiptPayload, allocations);
      }
      setShowAddModal(false);
      onRefreshData();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const payment = payments.find((row) => row.id === id);
    const receiptId = payment?.receipt_id;
    const confirmed = await confirm({
      title: receiptId ? '删除整笔组合收款？' : '删除这笔收款？',
      message: receiptId
        ? '这笔收款分摊到了多个合同。删除后，整笔收款及全部合同分摊都会移除，相关合同的回款进度将重新计算。'
        : '删除后，该合同的回款进度和完成状态将重新计算。',
      confirmLabel: receiptId ? '删除整笔收款' : '删除收款',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      if (receiptId) await db.deletePaymentReceipt(receiptId);
      else await db.deletePayment(id);
      onRefreshData();
      notify({ title: '收款已删除', message: '相关合同的回款进度已重新计算。', tone: 'success' });
    } catch (error) {
      notify({ title: '收款删除失败', message: error instanceof Error ? error.message : String(error), tone: 'error' });
    }
  };

  const handleDeleteDepositReceipt = async (receipt: CustomerDepositReceipt) => {
    const confirmed = await confirm({
      title: '删除这笔客户预存款？',
      message: `客户：${receipt.customer_name}\n未分摊金额：${receipt.currency === 'USD' ? '$' : '￥'}${receipt.deposit_amount.toLocaleString()}\n删除后会移除整笔银行到账记录；如该收款还分摊到了合同，对应合同回款也会一起移除。`,
      confirmLabel: '删除整笔收款',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      await db.deletePaymentReceipt(receipt.id);
      onRefreshData();
      notify({ title: '客户预存款已删除', message: '整笔到账及其合同分摊已重新计算。', tone: 'success' });
    } catch (error) {
      notify({ title: '客户预存款删除失败', message: error instanceof Error ? error.message : String(error), tone: 'error' });
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title={viewMode === 'balance' ? '客户货款平衡中心' : '回款明细台账'}
        description={viewMode === 'balance'
          ? '按客户汇总累计收款与累计发货，快速判断是我方待交货，还是客户待付款'
          : `登记汇款和信用证资金流水；默认显示本财年（${fiscalRange.label}），历史收款可在历史财年中查看`}
        actions={viewMode === 'balance' ? undefined : (
          <Button
            onClick={handleOpenAdd}
            icon={<Plus className="h-4 w-4" />}
          >
            登记录入收款
          </Button>
        )}
      />

      {/* Tabs Switcher */}
      <div className="flex border-b border-white/[0.06] text-xs font-semibold">
        <button
          onClick={() => setViewMode('all')}
          className={`px-6 py-3 border-b-2 transition-all ${
            viewMode === 'all'
              ? 'border-brand-cyan text-brand-cyan bg-white/[0.01]'
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/[0.005]'
          }`}
        >
          全部流水视图
        </button>
        <button
          onClick={() => setViewMode('customer')}
          className={`px-6 py-3 border-b-2 transition-all ${
            viewMode === 'customer'
              ? 'border-brand-cyan text-brand-cyan bg-white/[0.01]'
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/[0.005]'
          }`}
        >
          客户回款明细视图
        </button>
        <button
          onClick={() => setViewMode('balance')}
          className={`px-6 py-3 border-b-2 transition-all ${
            viewMode === 'balance'
              ? 'border-brand-cyan text-brand-cyan bg-white/[0.01]'
              : 'border-transparent text-slate-400 hover:text-white hover:bg-white/[0.005]'
          }`}
        >
          客户货款平衡
        </button>
      </div>

      {viewMode === 'all' ? (
        <>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-muted/45 p-1.5 text-xs font-semibold">
            <button type="button" onClick={() => setLedgerPeriod('fiscal')} className={`rounded-lg px-4 py-2 transition-colors ${ledgerPeriod === 'fiscal' ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted hover:text-body'}`}>
              本财年流水（{paymentPeriodCounts.fiscal}）
            </button>
            <button type="button" onClick={() => setLedgerPeriod('history')} className={`rounded-lg px-4 py-2 transition-colors ${ledgerPeriod === 'history' ? 'bg-surface text-brand-cyan shadow-sm' : 'text-muted hover:text-body'}`}>
              历史财年（{paymentPeriodCounts.history}）
            </button>
          </div>
          {/* Original View Filters */}
          <FilterPanel className="flex flex-col items-stretch justify-between gap-4 text-xs md:flex-row md:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 w-4 h-4 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="搜索客户、合同号、收款类型、备注描述..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-900/60 border border-white/[0.06] rounded-lg text-slate-200 focus:border-brand-cyan/50"
              />
            </div>
          </FilterPanel>
          <div className="text-[11px] text-muted">显示 {filteredPayments.length} / {ledgerPeriod === 'fiscal' ? paymentPeriodCounts.fiscal : paymentPeriodCounts.history} 条{ledgerPeriod === 'fiscal' ? '本财年' : '历史'}流水</div>

          {/* Original View Grid List */}
          <DataTable ariaLabel="全部收款流水" className="glass-panel text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.02] text-slate-400 font-semibold select-none">
                    <th className="p-4">客户</th>
                    <th className="p-4">关联合同</th>
                    <th className="p-4">收款日期</th>
                    <th className="p-4">收款类型</th>
                    <th className="p-4">收款外币额</th>
                    <th className="p-4">入账汇率</th>
                    <th className="p-4">折算人民币</th>
                    <th className="p-4">备注描述</th>
                    <th className="p-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredPayments.length > 0 ? (
                    ledgerPage.rows.map(p => (
                      <tr key={p.id} className="hover:bg-white/[0.01] transition-colors">
                        <td className="p-4 font-semibold text-slate-200">{p.customer_name || '未知客户'}</td>
                        <td className="p-4 font-heading font-semibold text-slate-200">{p.contract_no}</td>
                        <td className="p-4 text-slate-400">{p.payment_date}</td>
                        <td className="p-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.payment_type === '预付款'
                              ? 'bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/20'
                              : 'bg-brand-emerald/15 text-brand-emerald border border-brand-emerald/20'
                          }`}>
                            {p.payment_type}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-white">
                          {p.currency === 'USD' ? '$' : '￥'}{p.amount.toLocaleString()}
                        </td>
                        <td className="p-4 text-slate-400">
                          {p.exchange_rate ? p.exchange_rate.toFixed(4) : '-'}
                        </td>
                        <td className="p-4 font-bold text-slate-300">
                          {p.amount_rmb !== undefined && p.amount_rmb !== null
                            ? `￥${p.amount_rmb.toLocaleString()}`
                            : p.currency === 'RMB'
                              ? `￥${p.amount.toLocaleString()}`
                              : <span className="text-brand-amber">缺汇率</span>}
                        </td>
                        <td className="p-4 text-slate-400 max-w-[200px] truncate" title={p.notes}>
                          {p.notes || '-'}
                        </td>
                        <td className="p-4 text-right">
                          <IconButton
                            onClick={() => void handleCopyAccountingMessage(p)}
                            label="复制会计入账文字"
                            tone="primary"
                            className="mr-2"
                            icon={<Copy className="w-3.5 h-3.5" />}
                          />
                          <IconButton
                            onClick={() => handleOpenEdit(p)}
                            label="编辑收款记录"
                            tone="primary"
                            className="mr-2"
                            icon={<Edit2 className="w-3.5 h-3.5" />}
                          />
                          <IconButton
                            onClick={() => handleDelete(p.id)}
                            label="删除收款记录"
                            tone="danger"
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                          />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="p-10 text-center text-slate-500 italic bg-transparent">暂无收款记录，可点击上方按钮录入</td>
                    </tr>
                  )}
                </tbody>
          </DataTable>
          <PaginationControls {...ledgerPage} onPageChange={ledgerPage.setPage} itemLabel="条收款流水" />
        </>
      ) : viewMode === 'customer' ? (
        <>
          <div className="rounded-xl border border-brand-cyan/20 bg-brand-cyan/[0.06] px-4 py-3 text-xs text-body">
            当前回款考核周期：<span className="font-semibold text-brand-cyan">{dateFrom || '不限'} 至 {dateTo || '不限'}</span>；默认按本财年收款日期汇总，可在下方调整。
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3.5 p-4 rounded-xl glass-panel text-xs items-end border border-white/[0.04] bg-white/[0.01]">
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
                <DollarSign className="w-3.5 h-3.5 text-slate-500" /> 收款类型
              </label>
              <select
                value={filterPaymentType}
                onChange={(e) => setFilterPaymentType(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-200"
              >
                <option value="all">全部类型</option>
                <option value="预付款">预付款</option>
                <option value="尾款">尾款</option>
                <option value="分批付款">分批付款</option>
                <option value="提单后付款">提单后付款</option>
                <option value="信用证">信用证</option>
                <option value="其他">其他</option>
                <option value="客户预存款">客户预存款</option>
              </select>
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
                    <th className="p-4">收款金额</th>
                    <th className="p-4">合同总金额</th>
                    <th className="p-4">合同号 / PI号</th>
                    <th className="p-4">收款类型</th>
                    <th className="p-4">出口类型</th>
                    <th className="p-4">备注</th>
                    <th className="p-4 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {groupByCustomer ? (
                    groupedPayments.length > 0 ? (
                      customerGroupPage.rows.map(({ customerName, paymentsList, totalAmountRmb, totalAmountUsd, hasUsdPayments }) => (
                        <React.Fragment key={customerName}>
                          <tr className="bg-white/[0.02] border-t border-b border-white/[0.04]">
                            <td colSpan={selectedCustomerId === 'all' && !groupByCustomer ? 9 : 8} className="p-3 pl-4">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-bold text-brand-cyan flex items-center gap-1.5">
                                  🏢 客户: {customerName} <span className="text-[10px] text-slate-500 font-normal">({paymentsList.length} 笔款项)</span>
                                </span>
                                <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 font-bold text-slate-400">
                                  {hasUsdPayments && (
                                    <span>
                                      回款小计 (USD): <span className="text-brand-cyan font-mono">${totalAmountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </span>
                                  )}
                                  <span>
                                    回款小计 (RMB折合): <span className="text-white font-mono">￥{totalAmountRmb.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                  </span>
                                </div>
                              </div>
                            </td>
                          </tr>
                          {paymentsList.map(p => {
                            const sheets = contactSheets.filter(s => s.contract_id === p.contract_id);
                            const contractAmount = sheets.reduce((sum, s) => sum + (s.quantity * s.unit_price), 0);
                            const contract = contracts.find(c => c.id === p.contract_id);
                            const contractAmtStr = contract ? (contract.currency === 'USD' ? '$' : '￥') + contractAmount.toLocaleString() : '-';

                            return (
                              <tr key={p.id} className={`transition-colors border-b border-white/[0.02] ${p.is_customer_deposit ? 'bg-brand-amber/[0.04] hover:bg-brand-amber/[0.07]' : 'hover:bg-white/[0.01]'}`}>
                                <td className="p-4 text-slate-400 font-mono font-semibold">{p.payment_date}</td>
                                <td className="p-4 font-mono font-bold text-white">
                                  <div>{p.currency === 'USD' ? '$' : '￥'}{p.amount.toLocaleString()}</div>
                                  {p.currency === 'USD' && (
                                    <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                                      折合: {formatPaymentRmb(p)}
                                    </div>
                                  )}
                                </td>
                                <td className="p-4 text-slate-400 font-semibold">{contractAmtStr}</td>
                                <td className="p-4">
                                  {p.is_customer_deposit ? (
                                    <span className="font-semibold text-muted">—</span>
                                  ) : onNavigate ? (
                                    <button
                                      onClick={() => {
                                        sessionStorage.setItem('highlight_contract_no', p.contract_no);
                                        onNavigate('contracts');
                                      }}
                                      className="text-brand-cyan hover:underline font-bold text-left"
                                      title="点击前往合同管理"
                                    >
                                      {p.contract_no}
                                    </button>
                                  ) : (
                                    <span className="font-bold text-slate-300">{p.contract_no}</span>
                                  )}
                                </td>
                                <td className="p-4">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    p.payment_type === '客户预存款'
                                      ? 'bg-brand-amber/15 text-brand-amber border border-brand-amber/25'
                                      : p.payment_type === '预付款'
                                      ? 'bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/20'
                                      : 'bg-brand-emerald/15 text-brand-emerald border border-brand-emerald/20'
                                  }`}>
                                    {p.payment_type}
                                  </span>
                                </td>
                                <td className="p-4">
                                  {p.is_customer_deposit ? (
                                    <span className="text-muted">—</span>
                                  ) : (
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                      p.export_type === '自营'
                                        ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                        : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                    }`}>
                                      {p.export_type}
                                    </span>
                                  )}
                                </td>
                                <td className="p-4 text-slate-400 truncate max-w-[200px]" title={p.notes}>
                                  {p.notes || '-'}
                                </td>
                                <td className="p-4 text-right">
                                  {p.is_customer_deposit && p.deposit_receipt ? (
                                    <div className="flex justify-end gap-1">
                                      <IconButton
                                        onClick={() => void handleCopyAccountingMessage(p)}
                                        label="复制会计入账文字"
                                        tone="primary"
                                        icon={<Copy className="w-3.5 h-3.5" />}
                                      />
                                      <IconButton
                                        onClick={() => handleOpenEditReceipt(p.deposit_receipt!)}
                                        label="编辑或分摊客户预存款"
                                        icon={<Edit2 className="w-3.5 h-3.5" />}
                                      />
                                      <IconButton
                                        onClick={() => void handleDeleteDepositReceipt(p.deposit_receipt!)}
                                        label="删除客户预存款"
                                        tone="danger"
                                        icon={<Trash2 className="w-3.5 h-3.5" />}
                                      />
                                    </div>
                                  ) : (
                                    <div className="flex justify-end gap-1">
                                      <IconButton
                                        onClick={() => void handleCopyAccountingMessage(p)}
                                        label="复制会计入账文字"
                                        tone="primary"
                                        icon={<Copy className="w-3.5 h-3.5" />}
                                      />
                                      <IconButton
                                        onClick={() => handleDelete(p.id)}
                                        label="删除收款记录"
                                        tone="danger"
                                        icon={<Trash2 className="w-3.5 h-3.5" />}
                                      />
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={8} className="p-10 text-center text-slate-500 italic bg-transparent">
                          暂无符合过滤条件的收款流水数据
                        </td>
                      </tr>
                    )
                  ) : (
                    customerLedgerRows.length > 0 ? (
                      customerPaymentPage.rows.map(p => {
                        const sheets = contactSheets.filter(s => s.contract_id === p.contract_id);
                        const contractAmount = sheets.reduce((sum, s) => sum + (s.quantity * s.unit_price), 0);
                        const contract = contracts.find(c => c.id === p.contract_id);
                        const contractAmtStr = contract ? (contract.currency === 'USD' ? '$' : '￥') + contractAmount.toLocaleString() : '-';

                        return (
                          <tr key={p.id} className={`transition-colors ${p.is_customer_deposit ? 'bg-brand-amber/[0.04] hover:bg-brand-amber/[0.07]' : 'hover:bg-white/[0.01]'}`}>
                            <td className="p-4 text-slate-400 font-mono font-semibold">{p.payment_date}</td>
                            {selectedCustomerId === 'all' && (
                              <td className="p-4 font-bold text-slate-200">{p.customer_name}</td>
                            )}
                            <td className="p-4 font-mono font-bold text-white">
                              <div>{p.currency === 'USD' ? '$' : '￥'}{p.amount.toLocaleString()}</div>
                              {p.currency === 'USD' && (
                                <div className="text-[10px] text-slate-500 font-normal mt-0.5">
                                  折合: {formatPaymentRmb(p)}
                                </div>
                              )}
                            </td>
                            <td className="p-4 text-slate-400 font-semibold">{contractAmtStr}</td>
                            <td className="p-4">
                              {p.is_customer_deposit ? (
                                <span className="font-semibold text-muted">—</span>
                              ) : onNavigate ? (
                                <button
                                  onClick={() => {
                                    sessionStorage.setItem('highlight_contract_no', p.contract_no);
                                    onNavigate('contracts');
                                  }}
                                  className="text-brand-cyan hover:underline font-bold text-left"
                                  title="点击前往合同管理"
                                >
                                  {p.contract_no}
                                </button>
                              ) : (
                                <span className="font-bold text-slate-300">{p.contract_no}</span>
                              )}
                            </td>
                            <td className="p-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                p.payment_type === '客户预存款'
                                  ? 'bg-brand-amber/15 text-brand-amber border border-brand-amber/25'
                                  : p.payment_type === '预付款'
                                  ? 'bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/20'
                                  : 'bg-brand-emerald/15 text-brand-emerald border border-brand-emerald/20'
                              }`}>
                                {p.payment_type}
                              </span>
                            </td>
                            <td className="p-4">
                              {p.is_customer_deposit ? (
                                <span className="text-muted">—</span>
                              ) : (
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  p.export_type === '自营'
                                    ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                    : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                                }`}>
                                  {p.export_type}
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-slate-400 truncate max-w-[200px]" title={p.notes}>
                              {p.notes || '-'}
                            </td>
                            <td className="p-4 text-right">
                              {p.is_customer_deposit && p.deposit_receipt ? (
                                <div className="flex justify-end gap-1">
                                  <IconButton
                                    onClick={() => void handleCopyAccountingMessage(p)}
                                    label="复制会计入账文字"
                                    tone="primary"
                                    icon={<Copy className="w-3.5 h-3.5" />}
                                  />
                                  <IconButton
                                    onClick={() => handleOpenEditReceipt(p.deposit_receipt!)}
                                    label="编辑或分摊客户预存款"
                                    icon={<Edit2 className="w-3.5 h-3.5" />}
                                  />
                                  <IconButton
                                    onClick={() => void handleDeleteDepositReceipt(p.deposit_receipt!)}
                                    label="删除客户预存款"
                                    tone="danger"
                                    icon={<Trash2 className="w-3.5 h-3.5" />}
                                  />
                                </div>
                              ) : (
                                <div className="flex justify-end gap-1">
                                  <IconButton
                                    onClick={() => void handleCopyAccountingMessage(p)}
                                    label="复制会计入账文字"
                                    tone="primary"
                                    icon={<Copy className="w-3.5 h-3.5" />}
                                  />
                                  <IconButton
                                    onClick={() => handleDelete(p.id)}
                                    label="删除收款记录"
                                    tone="danger"
                                    icon={<Trash2 className="w-3.5 h-3.5" />}
                                  />
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={selectedCustomerId === 'all' ? 9 : 8} className="p-10 text-center text-slate-500 italic bg-transparent">
                          暂无符合过滤条件的收款流水数据
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
          </DataTable>
          {groupByCustomer ? (
            <PaginationControls {...customerGroupPage} onPageChange={customerGroupPage.setPage} itemLabel="组客户" />
          ) : (
            <PaginationControls {...customerPaymentPage} onPageChange={customerPaymentPage.setPage} itemLabel="条回款明细" />
          )}
        </>
      ) : (
        <CustomerBalancePanel onRefreshTrigger={onRefreshTrigger} />
      )}

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

              {formCustomerId && <div className="space-y-3"><div className="flex items-center justify-between gap-3"><div><label className="font-semibold text-slate-200">合同分摊（可选）</label><p className="mt-1 text-[10px] text-muted">每条合同分别选择收款类型；新增时最后一条会自动补齐剩余到账金额。</p></div><Button type="button" tone="warning" size="sm" disabled={!formContracts.length} icon={<Plus className="h-4 w-4" />} onClick={addPaymentAllocation} className="shadow-lg shadow-brand-amber/15">添加合同</Button></div>
                <div className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-surface-muted/45 p-3">
                  <div><div className="text-[10px] text-muted">实际到账</div><div className="mt-1 font-bold text-ink">{formCurrencySymbol}{receiptTotalAmount.toLocaleString()}</div></div>
                  <div><div className="text-[10px] text-muted">已分摊合同</div><div className="mt-1 font-bold text-brand-cyan">{formCurrencySymbol}{allocatedAmount.toLocaleString()}</div></div>
                  <div><div className="text-[10px] text-muted">客户预存款</div><div className={`mt-1 font-bold ${unallocatedAmount < -0.005 ? 'text-brand-rose' : unallocatedAmount <= 0.005 ? 'text-brand-emerald' : 'text-brand-amber'}`}>{formCurrencySymbol}{Math.max(0, unallocatedAmount).toLocaleString()}</div></div>
                </div>
                <p className="text-[11px] leading-5 text-muted">发货记录为高级可选项：通常保持“不指定发货记录”，系统会在合同内按发货日期先发先抵；只有明确要抵扣某一笔发货时才需要指定。</p>
                <div className="space-y-2">{paymentAllocations.map((allocation, index) => {
                  const selectedIds = new Set(paymentAllocations.filter((_, rowIndex) => rowIndex !== index).map((row) => row.contract_id));
                  const availableContracts = formContracts.filter((contract) => !selectedIds.has(contract.id) && (!selectedContractInfo || contract.currency === selectedContractInfo.currency || allocation.contract_id === contract.id));
                  const availableShipments = shipments.filter((shipment) => shipment.contract_id === allocation.contract_id);
                  const contractOutstanding = allocation.contract_id
                    ? getContractOutstandingAmount(
                        allocation.contract_id,
                        contactSheets,
                        payments.filter((payment) => editingReceiptId ? payment.receipt_id !== editingReceiptId : payment.id !== editingId)
                      )
                    : 0;
                  return <div key={`${index}-${allocation.contract_id}`} className="space-y-2 rounded-xl border border-border bg-surface-muted/35 p-3">
                    <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_minmax(170px,1fr)_140px_150px_auto] md:items-center">
                    <SearchableCombobox
                      value={allocation.contract_id}
                      onChange={(nextContractId) => setPaymentAllocations((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, contract_id: nextContractId, shipment_id: '' } : row))}
                      options={availableContracts.map(contract => ({
                        value: contract.id,
                        label: `${contract.contract_no} · ${contract.currency}`,
                        description: `剩余应收 ${contract.currency === 'USD' ? '$' : '￥'}${getContractOutstandingAmount(contract.id, contactSheets, payments.filter((payment) => editingReceiptId ? payment.receipt_id !== editingReceiptId : payment.id !== editingId)).toLocaleString()}`,
                        searchText: contract.contract_no
                      }))}
                      ariaLabel={`第 ${index + 1} 条分摊合同`}
                      placeholder="选择合同"
                      searchPlaceholder="输入合同号搜索"
                      emptyMessage="没有可分摊的匹配合同"
                    />
                    <SearchableCombobox
                      value={allocation.shipment_id}
                      onChange={(nextShipmentId) => setPaymentAllocations((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, shipment_id: nextShipmentId } : row))}
                      options={[
                        { value: '', label: '不指定发货记录' },
                        ...availableShipments.map(shipment => ({
                          value: shipment.id,
                          label: shipment.group_shipment_no || shipment.shipment_no,
                          searchText: shipment.group_shipment_no || shipment.shipment_no
                        }))
                      ]}
                      ariaLabel={`第 ${index + 1} 条分摊发货记录`}
                      placeholder="不指定发货记录"
                      searchPlaceholder="输入发货编号搜索"
                      emptyMessage="没有匹配的发货记录"
                      disabled={!allocation.contract_id}
                    />
                    <select
                      value={allocation.payment_type}
                      onChange={(event) => setPaymentAllocations((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, payment_type: event.target.value as PaymentType } : row))}
                      aria-label={`第 ${index + 1} 条分摊收款类型`}
                      className="rounded-lg border border-brand-amber/25 bg-slate-800 px-3 py-2.5 font-semibold text-slate-100"
                    >
                      {PAYMENT_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <input type="number" min="0.0001" step="0.0001" inputMode="decimal" required value={allocation.amount || ''} onChange={(event) => changePaymentAllocationAmount(index, parseFloat(event.target.value) || 0)} placeholder="分摊金额" className="bg-slate-900/60 border border-white/[0.06] rounded-lg px-3 py-2.5 text-right text-slate-200" />
                    <div className="flex items-center justify-end gap-1">
                      {allocation.id && editingReceiptId && (
                        <Button type="button" size="sm" tone="secondary" onClick={() => void handleReturnAllocationToDeposit(allocation.id!)}>
                          退回预存款
                        </Button>
                      )}
                      <IconButton type="button" onClick={() => removePaymentAllocation(index)} label={`移除第 ${index + 1} 个合同分摊`} tone="danger" size="md" icon={<Trash2 className="w-4 h-4" />} />
                    </div>
                    </div>
                    {allocation.contract_id && <div className="text-[10px] text-muted">该合同本次收款前剩余应收：<span className="font-semibold text-body">{selectedContractInfo?.currency === 'USD' ? '$' : '￥'}{contractOutstanding.toLocaleString()}</span></div>}
                  </div>;
                })}{!paymentAllocations.length && <div className="p-6 text-center text-slate-500 border border-dashed border-white/[0.08] rounded-xl">{formContracts.length ? '当前整笔金额将作为客户预存款；合同确定后可再次编辑并分摊' : '该客户暂无可分摊合同，整笔金额将作为客户预存款保存'}</div>}</div>
              </div>}

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1"><label className="text-slate-400">收款日期</label><input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200" /></div>
                <div className="rounded-lg border border-brand-amber/20 bg-brand-amber/5 px-3.5 py-2.5 text-[11px] leading-5 text-body"><strong className="text-ink">收款类型已移入合同明细。</strong><br />未分摊余额仍自动作为客户预存款。</div>
              </div>

              {/* Automatic FX lookup and compute info */}
              {formCustomerId && formCurrency === 'USD' && (
                <div className="p-3 bg-slate-900/60 border border-white/[0.05] rounded-lg space-y-2 text-[11px] leading-relaxed">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>系统自动查询 {calculatedExchangeRateInfo.month} 汇率:</span>
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
                <Button
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
