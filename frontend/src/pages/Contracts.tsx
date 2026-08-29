import React, { useEffect, useState, useMemo } from 'react';
import { db } from '../services/dataStore';
import type { Contract } from '../services/dataStore';
import { isQaComplete } from '../services/businessRules';
import { addDaysToLocalDate, formatLocalDate } from '../services/dateUtils';
import { isShipmentFullyInvoiced } from '../services/financialRules';
import { getNewContractDefaults } from '../services/customerDefaults';
import { getBusinessStatusTone } from '../services/statusPresentation';
import { sortContactSheetsByNumber } from '../services/contactSheetNavigation';
import { Dialog } from '../components/Dialog';
import { PageHeader } from '../components/PageHeader';
import { useFeedback } from '../components/FeedbackProvider';
import { FormField } from '../components/FormField';
import { CustomerSelect } from '../components/CustomerSelect';
import { IconButton } from '../components/IconButton';
import { StatusBadge } from '../components/StatusBadge';
import { Button } from '../components/Button';
import { SearchToolbar } from '../components/SearchToolbar';
import { PaginationControls } from '../components/PaginationControls';
import { usePagedRows } from '../hooks/usePagedRows';
import { getFiscalYearRange } from '../services/fiscalYear';
import {
  copiedContractNotes,
  currencyForExportType,
  exportTypeForCustomerCurrency,
  hasDuplicateContractNumber,
} from '../services/contractFormRules';
import { sortCustomersForDisplay } from '../services/customerOrdering';
import { resolveBoxArtworkReminder } from '../services/boxArtworkReminder';
import { Plus, Edit2, Trash2, FileText, X, Copy, RefreshCw, Truck, CreditCard, Users, FileDown } from 'lucide-react';

interface ContractsProps {
  onRefreshData: () => void;
  onRefreshTrigger: number;
  onNavigate?: (tab: string) => void;
}

export const Contracts: React.FC<ContractsProps> = ({ onRefreshData, onRefreshTrigger, onNavigate }) => {
  const { confirm, notify } = useFeedback();
  const [activeTab, setActiveTab] = useState<'active' | 'archived'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [groupByCustomer, setGroupByCustomer] = useState(true);
  const [exportingHelperContractId, setExportingHelperContractId] = useState<string | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form states
  const [contractNo, setContractNo] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [contractDate, setContractDate] = useState('');
  const [destinationCountry, setDestinationCountry] = useState('');
  const [exportType, setExportType] = useState<'自营' | '转口'>('自营');
  const [currency, setCurrency] = useState<'USD' | 'RMB'>('USD');
  const [incoterm, setIncoterm] = useState<'FOB' | 'CIF'>('FOB');
  const [deliveryDays, setDeliveryDays] = useState(60);
  const [agreedDeliveryDate, setAgreedDeliveryDate] = useState('');
  const [packagingConfirmedDate, setPackagingConfirmedDate] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('30% 预付 + 70% 发货前付清');
  const [prepaymentRatio, setPrepaymentRatio] = useState(0.3);
  const [internalContractSeq, setInternalContractSeq] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [operationError, setOperationError] = useState('');

  useEffect(() => {
    const highlight = sessionStorage.getItem('highlight_contract_no');
    if (highlight) {
      setSearchQuery(highlight);
      setActiveTab('active');
      sessionStorage.removeItem('highlight_contract_no');
    }
  }, [onRefreshTrigger]);

  // Loaded DB data
  const data = useMemo(() => {
    void onRefreshTrigger;
    const contractsList = db.getContracts();
    const customersList = db.getCustomers();
    const sheetsList = db.getContactSheets();
    const paymentsList = db.getPayments();
    const shipmentsList = db.getShipments();
    const invoicesList = db.getInvoices();
    const shipmentItemsList = db.getTable<any>('trade_shipment_items');
    return { contractsList, customersList, sheetsList, paymentsList, shipmentsList, invoicesList, shipmentItemsList };
  }, [onRefreshTrigger]);

  const { contractsList, customersList, sheetsList, paymentsList, shipmentsList, invoicesList, shipmentItemsList } = data;
  const incotermLocked = Boolean(editingId && shipmentsList.some((shipment) => shipment.contract_id === editingId && shipment.status !== '取消'));

  useEffect(() => {
    const contractId = sessionStorage.getItem('open_contract_detail_id');
    if (!contractId || contractsList.length === 0) return;

    const contract = contractsList.find(item => item.id === contractId);
    if (contract) {
      setActiveTab(contract.archived ? 'archived' : 'active');
      setSearchQuery(contract.contract_no);
      setSelectedContractId(contract.id);
      setShowDetailModal(true);
    }
    sessionStorage.removeItem('open_contract_detail_id');
  }, [contractsList]);

  // Compute contract details for list view (sums of contact sheets, payments, etc.)
  const processedContracts = useMemo(() => {
    return contractsList.map(contract => {
      const sheets = sheetsList.filter(s => s.contract_id === contract.id);
      const totalAmount = sheets.reduce((sum, s) => sum + (s.quantity * s.unit_price), 0);

      const payments = paymentsList.filter(p => p.contract_id === contract.id);
      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      const unpaid = Math.max(0, totalAmount - totalPaid);
      const recoveryRate = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;
      const totalQuantity = sheets.reduce((sum, s) => sum + (s.quantity || 0), 0);
      const shippedQuantity = sheets.reduce((sum, s) => sum + (s.shipped_quantity || 0), 0);
      const shippingRate = totalQuantity > 0 ? Math.min(100, Math.round((shippedQuantity / totalQuantity) * 100)) : 0;

      const prepaymentDate = payments
        .filter(p => p.payment_type === '预付款' && p.payment_date)
        .map(p => p.payment_date)
        .sort()[0] || '';

      // Delivery due date logic: max(prepaymentDate, packagingConfirmedDate) + deliveryDays
      let dueDate = contract.agreed_delivery_date || '';
      if (!dueDate && contract.delivery_days && prepaymentDate && contract.packaging_confirmed_date) {
        const startDate = prepaymentDate > contract.packaging_confirmed_date
          ? prepaymentDate
          : contract.packaging_confirmed_date;
        dueDate = addDaysToLocalDate(startDate, contract.delivery_days);
      }

      const contractShipments = shipmentsList.filter(s => s.contract_id === contract.id && s.status === '已发货');
      const invoiceDoneCount = contractShipments.filter(shipment =>
        isShipmentFullyInvoiced(shipment.id, shipment.amount, invoicesList)
      ).length;
      const missingInvoiceCount = Math.max(0, contractShipments.length - invoiceDoneCount);
      const invoiceCompleted = contractShipments.length > 0 && invoiceDoneCount === contractShipments.length;
      const isDeliveryOverdue = Boolean(dueDate && dueDate < formatLocalDate() && shippedQuantity < totalQuantity);
      const riskLevel = contract.archived ? 'archived' : isDeliveryOverdue ? 'high' : (missingInvoiceCount > 0 || unpaid > 0) ? 'medium' : 'low';
      const riskStatus = contract.archived ? '已归档' : isDeliveryOverdue ? '交货期已逾期' : missingInvoiceCount > 0 ? `待开票 ${missingInvoiceCount} 批` : unpaid > 0 ? '待收款' : '正常';

      return {
        ...contract,
        totalAmount,
        totalPaid,
        unpaid,
        recoveryRate,
        totalQuantity,
        shippedQuantity,
        shippingRate,
        dueDate,
        prepaymentDate,
        sheetsCount: sheets.length,
        missingInvoiceCount,
        invoiceCompleted,
        riskLevel,
        riskStatus
      };
    });
  }, [contractsList, sheetsList, paymentsList, shipmentsList, invoicesList]);

  // Filtered lists
  const filteredContracts = useMemo(() => {
    return processedContracts.filter(c => {
      const tabMatch = activeTab === 'archived' ? c.archived : !c.archived;
      const searchMatch =
        c.contract_no.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.internal_contract_seq && c.internal_contract_seq.toLowerCase().includes(searchQuery.toLowerCase()));
      const dateMatch = (!dateFrom || c.contract_date >= dateFrom) && (!dateTo || c.contract_date <= dateTo);
      return tabMatch && searchMatch && dateMatch;
    }).sort((left, right) => {
      const byCreatedAt = String(right.created_at || '').localeCompare(String(left.created_at || ''));
      if (byCreatedAt !== 0) return byCreatedAt;
      return right.contract_date.localeCompare(left.contract_date);
    });
  }, [processedContracts, activeTab, searchQuery, dateFrom, dateTo]);
  const displayedContracts = useMemo(() => {
    if (!groupByCustomer) return filteredContracts;
    const customerPositions = new Map(sortCustomersForDisplay(customersList).map((customer, index) => [customer.id, index]));
    return [...filteredContracts].sort((left, right) => {
      const customerDiff = (customerPositions.get(left.customer_id) ?? Number.MAX_SAFE_INTEGER)
        - (customerPositions.get(right.customer_id) ?? Number.MAX_SAFE_INTEGER);
      return customerDiff || right.contract_date.localeCompare(left.contract_date);
    });
  }, [customersList, filteredContracts, groupByCustomer]);
  const contractPage = usePagedRows(displayedContracts, `${activeTab}|${searchQuery}|${dateFrom}|${dateTo}|${groupByCustomer}`);

  // Selected contract details for the modal
  const selectedContractDetail = useMemo(() => {
    if (!selectedContractId) return null;
    const contract = processedContracts.find(c => c.id === selectedContractId);
    if (!contract) return null;

    const sheets = sortContactSheetsByNumber(
      sheetsList.filter(s => s.contract_id === selectedContractId)
    );
    const payments = paymentsList.filter(p => p.contract_id === selectedContractId);
    const shipments = shipmentsList.filter(s => s.contract_id === selectedContractId);

    return { contract, sheets, payments, shipments };
  }, [selectedContractId, processedContracts, sheetsList, paymentsList, shipmentsList]);

  const handleOpenAdd = () => {
    const defaultCustomer = customersList[0];
    const defaults = getNewContractDefaults(defaultCustomer);
    setEditingId(null);
    setContractNo('');
    setCustomerId(defaultCustomer?.id || '');
    setContractDate(formatLocalDate());
    setDestinationCountry(defaults.destinationCountry);
    const defaultExportType = exportTypeForCustomerCurrency(defaultCustomer?.default_currency || 'USD');
    setExportType(defaultExportType);
    setCurrency(currencyForExportType(defaultExportType));
    setIncoterm('FOB');
    setDeliveryDays(60);
    setAgreedDeliveryDate('');
    setPackagingConfirmedDate('');
    setPaymentTerms(defaults.paymentTerms);
    setPrepaymentRatio(0.3);
    setInternalContractSeq('');
    setNotes('');
    setShowFormModal(true);
  };

  const handleOpenEdit = (c: Contract, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(c.id);
    setContractNo(c.contract_no);
    setCustomerId(c.customer_id);
    setContractDate(c.contract_date);
    setDestinationCountry(c.destination_country);
    setExportType(c.export_type);
    setCurrency(currencyForExportType(c.export_type));
    setIncoterm(c.incoterm === 'CIF' ? 'CIF' : 'FOB');
    setDeliveryDays(c.delivery_days);
    setAgreedDeliveryDate(c.agreed_delivery_date);
    setPackagingConfirmedDate(c.packaging_confirmed_date);
    setPaymentTerms(c.payment_terms);
    setPrepaymentRatio(c.prepayment_ratio);
    setInternalContractSeq(c.internal_contract_seq);
    setNotes(c.notes);
    setShowFormModal(true);
  };

  const handleOpenCopy = (c: Contract, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
    setContractNo(c.contract_no);
    setCustomerId(c.customer_id);
    setContractDate(formatLocalDate());
    setDestinationCountry(c.destination_country);
    setExportType(c.export_type);
    setCurrency(currencyForExportType(c.export_type));
    setIncoterm(c.incoterm === 'CIF' ? 'CIF' : 'FOB');
    setDeliveryDays(c.delivery_days);
    setAgreedDeliveryDate(c.agreed_delivery_date);
    setPackagingConfirmedDate('');
    setPaymentTerms(c.payment_terms);
    setPrepaymentRatio(c.prepayment_ratio);
    setInternalContractSeq('');
    setNotes(copiedContractNotes());
    setShowFormModal(true);
  };

  const handleSelectCustomer = (custId: string) => {
    setCustomerId(custId);
    const cust = customersList.find(c => c.id === custId);
    if (cust) {
      const defaults = getNewContractDefaults(cust);
      const nextExportType = exportTypeForCustomerCurrency(cust.default_currency);
      setPaymentTerms(defaults.paymentTerms);
      setExportType(nextExportType);
      setCurrency(currencyForExportType(nextExportType));
      if (nextExportType === '转口') setIncoterm('FOB');
      if (!editingId || !destinationCountry.trim()) setDestinationCountry(defaults.destinationCountry);
    }
  };

  const handleSelectExportType = (nextType: '自营' | '转口') => {
    setExportType(nextType);
    setCurrency(currencyForExportType(nextType));
    if (nextType === '转口') setIncoterm('FOB');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contractNo.trim() || !customerId || !destinationCountry.trim()) return;

    if (hasDuplicateContractNumber(contractsList, contractNo, editingId)) {
      const message = `合同号“${contractNo.trim()}”已经存在，无法保存。请检查合同号，或修改复制合同末尾的数字。`;
      setOperationError(message);
      notify({ title: '合同号重复', message, tone: 'warning' });
      return;
    }

    const data = {
      contract_no: contractNo,
      customer_id: customerId,
      contract_date: contractDate,
      destination_country: destinationCountry,
      export_type: exportType,
      currency: currencyForExportType(exportType),
      incoterm: exportType === '自营' ? incoterm : null,
      delivery_days: agreedDeliveryDate ? 0 : deliveryDays,
      agreed_delivery_date: agreedDeliveryDate,
      packaging_confirmed_date: packagingConfirmedDate,
      payment_terms: paymentTerms,
      prepayment_ratio: prepaymentRatio,
      internal_contract_seq: internalContractSeq,
      notes
    };

    setIsSaving(true);
    setOperationError('');
    try {
      const globalConflict = await db.getGlobalContractNumberConflict(contractNo, editingId);
      if (globalConflict) {
        const confirmed = await confirm({
          title: '公司内已有相同合同号',
          message: `合同号“${contractNo.trim()}”也被${globalConflict.owner_display_name}使用。\n\n不同业务账号可以继续保存相同合同号，请先确认不是录入错号。`,
          confirmLabel: '确认继续保存',
          tone: 'warning'
        });
        if (!confirmed) return;
      }
      if (editingId) {
        await db.updateContract(editingId, data);
      } else {
        await db.addContract(data);
      }
      setShowFormModal(false);
      onRefreshData();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const contract = contractsList.find(item => item.id === id);
    const sheetCount = sheetsList.filter(sheet => sheet.contract_id === id).length;
    const confirmed = await confirm({
      title: '删除这个合同？',
      message: `合同：${contract?.contract_no || '未知合同'}\n关联联系单：${sheetCount} 条\n\n删除后，子联系单及后续业务记录需要重新关联。请仅在确认该合同录入错误时继续。`,
      confirmLabel: '删除合同',
      tone: 'danger'
    });
    if (!confirmed) return;
    setOperationError('');
    try {
      await db.deleteContract(id);
      onRefreshData();
      notify({ title: '合同已删除', message: `${contract?.contract_no || '该合同'}已从合同目录移除。`, tone: 'success' });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleViewDetails = (id: string) => {
    setSelectedContractId(id);
    setShowDetailModal(true);
  };

  const handleQuickShipment = (contract: Contract, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!onNavigate) return;
    sessionStorage.setItem('quick_shipment_contract_id', contract.id);
    onNavigate('shipments');
  };

  const handleQuickPayment = (contract: Contract, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!onNavigate) return;
    sessionStorage.setItem('quick_payment_contract_id', contract.id);
    onNavigate('payments');
  };

  const handleExportContactSheetHelper = async (contract: Contract, event: React.MouseEvent) => {
    event.stopPropagation();
    setExportingHelperContractId(contract.id);
    try {
      const result = await db.runLocalExport('export-helper', {
        contract_id: contract.id,
        contract_no: contract.contract_no
      }) as {
        stdout?: string;
      };
      notify({
        title: '下联系单辅助表已导出',
        message: result.stdout || `已导出合同 ${contract.contract_no} 下的全部联系单。`,
        tone: 'success',
        duration: 8000
      });
    } catch (error) {
      notify({
        title: '下联系单辅助表导出失败',
        message: error instanceof Error ? error.message : String(error),
        tone: 'error',
        duration: 9000
      });
    } finally {
      setExportingHelperContractId(null);
    }
  };

  const showCurrentMonth = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const monthEnd = new Date(year, today.getMonth() + 1, 0).getDate();
    setDateFrom(`${year}-${month}-01`);
    setDateTo(`${year}-${month}-${String(monthEnd).padStart(2, '0')}`);
  };

  const showCurrentFiscalYear = () => {
    const range = getFiscalYearRange();
    setDateFrom(range.startDate);
    setDateTo(range.endDate);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="销售合同跟踪"
        description="管理自营与转口合同，聚合分析收款履约及交期进度"
        actions={(
          <Button
            onClick={handleOpenAdd}
            icon={<Plus className="h-4 w-4" />}
          >
            创建销售合同
          </Button>
        )}
      />

      {/* Tabs, Search & Stats */}
      <SearchToolbar
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="搜索合同号、客户名称、内部序号..."
        ariaLabel="搜索和筛选销售合同"
        className="justify-between"
        leading={(
        <div className="flex self-start rounded-lg border border-border bg-surface p-0.5">
          <button
            onClick={() => setActiveTab('active')}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'active'
                ? 'border border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan'
                : 'text-muted hover:text-ink'
            }`}
          >
            执行中合同 ({processedContracts.filter(c => !c.archived).length})
          </button>
          <button
            onClick={() => setActiveTab('archived')}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'archived'
                ? 'border border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan'
                : 'text-muted hover:text-ink'
            }`}
          >
            已归档合同 ({processedContracts.filter(c => c.archived).length})
          </button>
        </div>
        )}
      />
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-wrap items-end gap-2">
          <Button onClick={showCurrentMonth} tone="secondary" size="sm">本月合同</Button>
          <Button onClick={showCurrentFiscalYear} tone="secondary" size="sm">本财年</Button>
          <Button onClick={() => { setDateFrom(''); setDateTo(''); }} tone="secondary" size="sm">全部日期</Button>
          <label className="grid gap-1 text-[10px] font-semibold text-muted">
            签署日期从
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-9 rounded-lg border border-border bg-surface px-3 text-xs text-body" />
          </label>
          <label className="grid gap-1 text-[10px] font-semibold text-muted">
            至
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-9 rounded-lg border border-border bg-surface px-3 text-xs text-body" />
          </label>
          <span className="pb-2 text-[11px] text-muted">当前显示 {filteredContracts.length} 份合同</span>
        </div>
        <Button
          onClick={() => setGroupByCustomer((current) => !current)}
          tone={groupByCustomer ? 'primary' : 'secondary'}
          size="sm"
          icon={<Users className="h-4 w-4" />}
        >
          {groupByCustomer ? '返回日期排序' : '按客户分组查看'}
        </Button>
      </div>
      {operationError && (
        <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">
          {operationError}
        </div>
      )}

      {/* Contracts Grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {filteredContracts.length > 0 ? (
          contractPage.rows.map((c, index) => (
            <React.Fragment key={c.id}>
              {groupByCustomer && (index === 0 || contractPage.rows[index - 1]?.customer_id !== c.customer_id) && (
                <div className="flex items-center justify-between rounded-xl border border-border bg-surface-muted/55 px-4 py-3 md:col-span-2">
                  <div>
                    <h3 className="font-heading text-sm font-bold text-ink">{c.customer_name}</h3>
                    <p className="mt-0.5 text-[10px] text-muted">组内按合同登记日期由新到旧排列。</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2 text-[11px]">
                    <StatusBadge tone="neutral">{displayedContracts.filter((row) => row.customer_id === c.customer_id).length} 份合同</StatusBadge>
                    {displayedContracts.some((row) => row.customer_id === c.customer_id && row.currency === 'USD') && (
                      <span className="font-semibold text-body">美元 ${displayedContracts.filter((row) => row.customer_id === c.customer_id && row.currency === 'USD').reduce((sum, row) => sum + row.totalAmount, 0).toLocaleString()}</span>
                    )}
                    {displayedContracts.some((row) => row.customer_id === c.customer_id && row.currency === 'RMB') && (
                      <span className="font-semibold text-body">人民币 ¥{displayedContracts.filter((row) => row.customer_id === c.customer_id && row.currency === 'RMB').reduce((sum, row) => sum + row.totalAmount, 0).toLocaleString()}</span>
                    )}
                  </div>
                </div>
              )}
            <div
              onClick={() => handleViewDetails(c.id)}
              className="glass-panel glass-panel-hover relative flex cursor-pointer flex-col justify-between gap-4 overflow-hidden p-5"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading text-lg font-bold leading-none text-white">{c.contract_no}</h3>
                      <span className="rounded-md border border-border bg-surface-muted px-2 py-1 text-[10px] font-bold text-body">{c.currency}</span>
                      {c.internal_contract_seq && (
                        <span className="rounded-md border border-border bg-surface-muted px-2 py-1 text-[10px] font-medium text-muted">
                          内部序号 {c.internal_contract_seq}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-sm font-medium text-body">
                      {c.customer_name} · {c.destination_country || '国家待补充'}
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="text-lg font-extrabold leading-none text-white">
                      {c.currency === 'USD' ? '$' : '￥'}{(c.totalAmount || 0).toLocaleString()}
                    </span>
                    <div className="mt-1 text-[10px] text-muted">合同总额</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-muted/70 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[10px] font-medium text-muted">当前关注</span>
                    <StatusBadge tone={getBusinessStatusTone(c.riskStatus, c.riskLevel === 'medium' ? 'warning' : 'neutral')} size="sm" dot>
                      {c.riskStatus}
                    </StatusBadge>
                  </div>
                  <StatusBadge tone={getBusinessStatusTone(c.status)}>
                    {c.status}
                  </StatusBadge>
                  {c.invoiceCompleted && <StatusBadge tone="success" dot>开票完成</StatusBadge>}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs xl:grid-cols-4">
                  <div className="rounded-lg border border-border/80 bg-surface px-3 py-2.5">
                    <div className="text-[10px] text-muted">联系单</div>
                    <div className="mt-0.5 font-semibold text-ink">{c.sheetsCount} 个</div>
                  </div>
                  <div className="rounded-lg border border-border/80 bg-surface px-3 py-2.5">
                    <div className="text-[10px] text-muted">已收款</div>
                    <div className="mt-0.5 font-semibold text-ink">{c.currency === 'USD' ? '$' : '￥'}{c.totalPaid.toLocaleString()} <span className="text-[10px] font-medium text-muted">({c.recoveryRate}%)</span></div>
                  </div>
                  <div className="rounded-lg border border-border/80 bg-surface px-3 py-2.5">
                    <div className="text-[10px] text-muted">已发货</div>
                    <div className="mt-0.5 font-semibold text-ink">{c.shippedQuantity.toLocaleString()} / {c.totalQuantity.toLocaleString()} <span className="text-[10px] font-medium text-muted">({c.shippingRate}%)</span></div>
                  </div>
                  <div className="rounded-lg border border-border/80 bg-surface px-3 py-2.5">
                    <div className="text-[10px] text-muted">合同应交期</div>
                    <div className={`mt-0.5 font-semibold ${c.riskLevel === 'high' ? 'text-brand-rose' : 'text-ink'}`}>{c.dueDate || '待定'}</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
                <div className="grid min-w-0 flex-1 gap-2 text-[10px] text-muted">
                  <div className="flex items-center gap-2">
                    <span className="w-8 shrink-0">回款</span>
                    <div className="h-1.5 max-w-44 flex-1 rounded-full bg-slate-800">
                      <div className="h-1.5 rounded-full bg-brand-emerald" style={{ width: `${c.recoveryRate}%` }} />
                    </div>
                    <span className="w-8 text-right font-semibold text-body">{c.recoveryRate}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-8 shrink-0">发货</span>
                    <div className="h-1.5 max-w-44 flex-1 rounded-full bg-slate-800">
                      <div className="h-1.5 rounded-full bg-brand-cyan" style={{ width: `${c.shippingRate}%` }} />
                    </div>
                    <span className="w-8 text-right font-semibold text-body">{c.shippingRate}%</span>
                  </div>
                </div>

                <div className="flex flex-wrap justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                  {activeTab === 'active' && (
                    <Button
                      onClick={(event) => void handleExportContactSheetHelper(c, event)}
                      tone="subtle"
                      size="sm"
                      disabled={exportingHelperContractId !== null}
                      icon={exportingHelperContractId === c.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <FileDown className="h-3.5 w-3.5" />}
                    >
                      {exportingHelperContractId === c.id ? '导出中' : '联系单辅助表'}
                    </Button>
                  )}
                  <Button
                    onClick={(event) => handleQuickShipment(c, event)}
                    tone="subtle"
                    size="sm"
                    disabled={c.shippedQuantity >= c.totalQuantity - 0.0001}
                    icon={<Truck className="h-3.5 w-3.5" />}
                  >
                    快捷发货
                  </Button>
                  <Button
                    onClick={(event) => handleQuickPayment(c, event)}
                    tone="secondary"
                    size="sm"
                    disabled={c.unpaid <= 0.005}
                    icon={<CreditCard className="h-3.5 w-3.5" />}
                  >
                    登记收款
                  </Button>
                  <IconButton
                    onClick={(e) => handleOpenCopy(c, e)}
                    label="复制合同"
                    tone="primary"
                    icon={<Copy className="w-3.5 h-3.5" />}
                  />
                  <IconButton
                    onClick={(e) => handleOpenEdit(c, e)}
                    label="编辑合同"
                    icon={<Edit2 className="w-3.5 h-3.5" />}
                  />
                  <IconButton
                    onClick={(e) => handleDelete(c.id, e)}
                    label="删除合同"
                    tone="danger"
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                  />
                </div>
              </div>
            </div>
            </React.Fragment>
          ))
        ) : (
          <div className="col-span-full py-16 text-center text-slate-500 text-sm glass-panel rounded-2xl">
            暂无匹配的合同记录
          </div>
        )}
      </div>
      <PaginationControls {...contractPage} onPageChange={contractPage.setPage} itemLabel="份合同" />

      {/* Create/Edit Form Modal */}
      {showFormModal && (
        <Dialog onClose={() => setShowFormModal(false)} ariaLabel={editingId ? '编辑合同参数' : '创建销售合同'}>
          <div className="dialog-panel w-full max-w-lg p-6 space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="font-heading font-bold text-lg text-white">
                {editingId ? '编辑合同参数' : '创建销售合同'}
              </h3>
              <IconButton onClick={() => setShowFormModal(false)} label="关闭合同表单" icon={<X className="w-5 h-5" />} />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-slate-400">合同号 <span className="text-brand-rose">*</span></label>
                  <input
                    type="text"
                    required
                    value={contractNo}
                    onChange={(e) => setContractNo(e.target.value)}
                    placeholder="如 DEMONL04"
                    className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">内部合同序号</label>
                  <input
                    type="text"
                    value={internalContractSeq}
                    onChange={(e) => setInternalContractSeq(e.target.value)}
                    placeholder="如 641#"
                    className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200"
                  />
                </div>
              </div>

              <FormField label="关联客户" required>
                <CustomerSelect
                  value={customerId}
                  onChange={handleSelectCustomer}
                  customers={customersList}
                  ariaLabel="关联客户"
                  placeholder="请选择客户"
                  searchPlaceholder="输入客户名称搜索"
                  emptyMessage="没有匹配的已有客户"
                />
              </FormField>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-slate-400">合同签署日期</label>
                  <input
                    type="date"
                    value={contractDate}
                    onChange={(e) => setContractDate(e.target.value)}
                    className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">目的国 <span className="text-brand-rose">*</span></label>
                  <input
                    type="text"
                    required
                    value={destinationCountry}
                    onChange={(e) => setDestinationCountry(e.target.value)}
                    placeholder="按客户默认目的国带入，可单独修改"
                    className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200"
                  />
                  <p className="text-[10px] leading-relaxed text-slate-500">统计和分析以本合同目的国为准，不影响客户档案默认值。</p>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">出口类型</label>
                  <select
                    value={exportType}
                    onChange={(e) => handleSelectExportType(e.target.value as '自营' | '转口')}
                    disabled={Boolean(customerId)}
                    className="w-full cursor-not-allowed bg-slate-800/70 border border-white/[0.06] rounded-lg px-3 py-2.5 text-slate-400"
                  >
                    <option value="自营">自营</option>
                    <option value="转口">转口</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">结算币种</label>
                  <select
                    value={currency}
                    disabled
                    className="w-full cursor-not-allowed bg-slate-800/70 border border-white/[0.06] rounded-lg px-3 py-2.5 text-slate-400"
                  >
                    <option value="USD">USD 美元</option>
                    <option value="RMB">RMB 人民币</option>
                  </select>
                  <p className="text-[10px] leading-relaxed text-slate-500">由客户固定币种自动确定，避免同一客户混用币种。</p>
                  <p className="text-[10px] leading-relaxed text-slate-500">由出口类型自动确定：自营使用 USD，转口使用 RMB。</p>
                </div>
                {exportType === '自营' && (
                  <div className="space-y-1">
                    <label className="text-slate-400">贸易术语</label>
                    <select
                      value={incoterm}
                      onChange={(event) => setIncoterm(event.target.value as 'FOB' | 'CIF')}
                      disabled={incotermLocked}
                      className="w-full rounded-lg border border-white/[0.06] bg-slate-800 px-3 py-2.5 text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="FOB">FOB</option>
                      <option value="CIF">CIF</option>
                    </select>
                    <p className="text-[10px] leading-relaxed text-slate-500">
                      {incotermLocked ? '合同已进入发货流程，贸易术语已锁定。' : 'CIF 合同将在开票时填写整笔运保费。'}
                    </p>
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1">
                  <label className="text-slate-400">规定交期天数</label>
                  <input
                    type="number"
                    min="0"
                    value={deliveryDays || ''}
                    onChange={(e) => setDeliveryDays(Number(e.target.value) || 0)}
                    disabled={Boolean(agreedDeliveryDate)}
                    placeholder={agreedDeliveryDate ? '已使用指定交货日期' : '输入交货天数'}
                    className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200 disabled:cursor-not-allowed disabled:opacity-45"
                  />
                  <p className="text-[10px] leading-relaxed text-slate-500">没有约定具体日期时，用于自动计算。</p>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">客户指定交货日期</label>
                  <input
                    type="date"
                    value={agreedDeliveryDate}
                    onChange={(e) => setAgreedDeliveryDate(e.target.value)}
                    className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200"
                  />
                  <p className="text-[10px] leading-relaxed text-slate-500">填写后优先采用该日期，不再依赖交货天数。</p>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-400">客户确认包装稿日期</label>
                  <input
                    type="date"
                    value={packagingConfirmedDate}
                    onChange={(e) => setPackagingConfirmedDate(e.target.value)}
                    className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200"
                  />
                  <p className="text-[10px] leading-relaxed text-slate-500">填写后会批量确认现有联系单；逐张填写完成时自动汇总最晚日期，撤销请清空对应联系单日期。</p>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">付款条件说明</label>
                <input
                  type="text"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="如 30% 预付 + 70% 发货前付清"
                  className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">备注</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-slate-900/60 border border-white/[0.06] rounded-lg px-3.5 py-2.5 text-slate-200 resize-none"
                />
              </div>

              <div className="pt-4 flex justify-end gap-3 text-sm">
                <Button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  tone="secondary"
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving}
                >
                  {isSaving ? '保存中...' : '确认保存'}
                </Button>
              </div>
            </form>
          </div>
        </Dialog>
      )}

      {/* Contract Detailed View Modal */}
      {showDetailModal && selectedContractDetail && (
        <Dialog onClose={() => setShowDetailModal(false)} ariaLabel="合同详情">
            <div className="dialog-panel w-full max-w-4xl p-6 max-h-[90vh] overflow-y-auto space-y-6">

            {/* Title Header */}
            <div className="flex justify-between items-start border-b border-white/[0.06] pb-4">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="font-heading font-bold text-xl text-white">
                    合同详情: {selectedContractDetail.contract.contract_no}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded bg-white/[0.04] text-slate-400 border border-white/[0.06]">
                    {selectedContractDetail.contract.export_type} ({selectedContractDetail.contract.currency})
                  </span>
                  {selectedContractDetail.contract.currency === 'USD' && (
                    <span className="rounded bg-white/[0.04] px-2 py-0.5 text-xs text-slate-400 border border-white/[0.06]">
                      {selectedContractDetail.contract.incoterm || 'FOB'}
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-400 mt-1 block">
                  客户: {selectedContractDetail.contract.customer_name} · {selectedContractDetail.contract.destination_country || '国家待补充'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <IconButton
                  onClick={() => setShowDetailModal(false)}
                  label="关闭合同详情"
                  icon={<X className="w-5 h-5" />}
                />
              </div>
            </div>

            {/* Middle Grid info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
              <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.04] space-y-2">
                <span className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider block">资金结算</span>
                <div className="flex justify-between">
                  <span className="text-slate-500">合同总额:</span>
                  <span className="text-white font-bold">
                    {selectedContractDetail.contract.currency === 'USD' ? '$' : '￥'}{selectedContractDetail.contract.totalAmount.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">已收账款:</span>
                  <span className="text-brand-emerald font-bold">
                    {selectedContractDetail.contract.currency === 'USD' ? '$' : '￥'}{selectedContractDetail.contract.totalPaid.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">未结余额:</span>
                  <span className="text-brand-rose">
                    {selectedContractDetail.contract.currency === 'USD' ? '$' : '￥'}{selectedContractDetail.contract.unpaid.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.04] space-y-2 md:border-l-2 md:border-l-brand-cyan/20">
                <span className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider block">交货关键节点</span>
                <div className="flex justify-between">
                  <span className="text-slate-500">合同日期:</span>
                  <span className="text-white">{selectedContractDetail.contract.contract_date || '未填'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">包装确认期:</span>
                  <span className="text-white">{selectedContractDetail.contract.packaging_confirmed_date || '未确认'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">预收款收到期:</span>
                  <span className="text-white">{selectedContractDetail.contract.prepaymentDate || '未收到'}</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.01] border border-white/[0.04] space-y-2 md:border-l-2 md:border-l-brand-cyan/20">
                <span className="text-slate-400 font-semibold text-[10px] uppercase tracking-wider block">履约条款</span>
                <div className="flex justify-between">
                  <span className="text-slate-500">交货约定:</span>
                  <span className="text-white">{selectedContractDetail.contract.agreed_delivery_date ? `指定 ${selectedContractDetail.contract.agreed_delivery_date}` : `${selectedContractDetail.contract.delivery_days} 天`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">付款条款:</span>
                  <span className="text-white text-right max-w-[150px] truncate">{selectedContractDetail.contract.payment_terms}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">预计应交期:</span>
                  <span className="text-brand-cyan font-bold">{selectedContractDetail.contract.dueDate || '待预付或确认包装'}</span>
                </div>
              </div>
            </div>

            {/* Tabs for Lists (Contact Sheets / Payments / Shipments) */}
            <div className="space-y-4">
              <div className="border-b border-white/[0.04]">
                <h4 className="font-heading font-semibold text-sm text-white pb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-brand-cyan" />
                  子联系单进度列表 ({selectedContractDetail.sheets.length})
                </h4>
              </div>

              <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                {selectedContractDetail.sheets.length > 0 ? (
                  selectedContractDetail.sheets.map(sheet => {
                    const isResultFlow = sheet.business_type === '原料药' || sheet.is_historical;
                    const contractPaid = selectedContractDetail.payments.reduce((sum, payment) => sum + payment.amount, 0)
                      >= selectedContractDetail.contract.totalAmount - 0.01;
                    const contractInvoiced = selectedContractDetail.shipments.length > 0
                      && selectedContractDetail.shipments.every((shipment) =>
                        isShipmentFullyInvoiced(shipment.id, shipment.amount, invoicesList)
                      );
                    const shipmentIds = new Set(
                      shipmentItemsList
                        .filter((item: any) => item.contact_sheet_id === sheet.id)
                        .map((item: any) => item.shipment_id)
                    );
                    const latestShipmentDate = selectedContractDetail.shipments
                      .filter((shipment) => shipmentIds.has(shipment.id) && shipment.status === '已发货')
                      .map((shipment) => shipment.shipment_date)
                      .filter(Boolean)
                      .sort()
                      .at(-1) || '';
                    const latestPaymentDate = selectedContractDetail.payments
                      .map((payment) => payment.payment_date)
                      .filter(Boolean)
                      .sort()
                      .at(-1) || '';
                    const latestContractShipmentDate = selectedContractDetail.shipments
                      .filter((shipment) => shipment.status === '已发货')
                      .map((shipment) => shipment.shipment_date)
                      .filter(Boolean)
                      .sort()
                      .at(-1) || '';
                    const contractShipmentIds = new Set(selectedContractDetail.shipments.map((shipment) => shipment.id));
                    const latestInvoiceDate = invoicesList
                      .filter((invoice) => (
                        contractShipmentIds.has(invoice.shipment_id)
                        || invoice.shipment_ids?.some((shipmentId) => contractShipmentIds.has(shipmentId))
                      ))
                      .map((invoice) => invoice.invoice_date)
                      .filter(Boolean)
                      .sort()
                      .at(-1) || '';
                    const completedDate = [latestContractShipmentDate, latestPaymentDate, latestInvoiceDate]
                      .filter(Boolean)
                      .sort()
                      .at(-1) || '';
                    const qaDate = (sheet.qa_approval_date || '').slice(0, 10);
                    const boxArtworkStatus = resolveBoxArtworkReminder(sheet);
                    const steps = isResultFlow
                      ? [
                          { label: '合同', done: true, date: selectedContractDetail.contract.contract_date },
                          { label: '已发货', done: (sheet.shipped_quantity || 0) >= sheet.quantity - 0.0001, date: latestShipmentDate },
                          { label: '已收款', done: contractPaid, date: latestPaymentDate },
                          { label: '已开票', done: contractInvoiced, date: latestInvoiceDate },
                          { label: '已完成', done: selectedContractDetail.contract.archived, date: completedDate }
                        ]
                      : [
                          { label: 'QA审批', done: isQaComplete(sheet), date: qaDate },
                          { label: '排产', done: Boolean(sheet.aps_scheduled_date), date: sheet.aps_scheduled_date },
                          { label: '入库', done: Boolean(sheet.actual_warehousing_date), date: sheet.actual_warehousing_date },
                          { label: '放行', done: Boolean(sheet.actual_release_date), date: sheet.actual_release_date },
                          { label: '已发货', done: (sheet.shipped_quantity || 0) > 0, date: latestShipmentDate }
                        ];
                    const activeStepIdx = steps.reduce((latest, step, index) => step.done ? index : latest, -1);

                    return (
                      <div
                        key={sheet.id}
                        onClick={() => {
                          if (onNavigate) {
                            sessionStorage.setItem('highlight_contact_sheet_id', sheet.id);
                            sessionStorage.removeItem('highlight_contact_sheet');
                            sessionStorage.setItem('return_to_contract_id', selectedContractDetail.contract.id);
                            sessionStorage.setItem('return_to_contract_no', selectedContractDetail.contract.contract_no);
                            onNavigate('contact_sheets');
                            setShowDetailModal(false);
                          }
                        }}
                        className="p-4 rounded-xl border border-slate-700 bg-slate-800/40 hover:bg-slate-800/70 hover:border-brand-cyan/40 shadow-sm flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 text-xs transition-all cursor-pointer group"
                      >
                        {/* Left: Info */}
                        <div className="space-y-1.5 flex-1 min-w-[200px]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white group-hover:text-brand-cyan transition-colors">
                              {sheet.contact_sheet_no || (sheet.business_type === '原料药' ? '原料药·无联系单号' : '暂无单号')}
                            </span>
                            <span className="text-slate-400">|</span>
                            <span className="text-slate-300 font-medium">{sheet.product_name}</span>
                            <span className="text-[10px] text-slate-500 bg-slate-800/50 border border-slate-700 px-1 py-0.2 rounded font-mono">
                              {sheet.material_no}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 leading-relaxed">
                            规格: <span className="text-slate-200 font-semibold">{sheet.specification}</span> <span className="text-slate-600 px-0.5">|</span> 数量: <span className="text-slate-100 font-semibold">{sheet.quantity.toLocaleString()} {sheet.unit}</span> <span className="text-slate-600 px-0.5">|</span> 金额: <span className="text-brand-cyan font-bold">{selectedContractDetail.contract.currency === 'USD' ? '$' : '￥'}{(sheet.quantity * sheet.unit_price).toLocaleString()}</span>
                          </div>
                          {boxArtworkStatus.due && (
                            <div className="mt-2 inline-flex items-center rounded-md border border-brand-rose/30 bg-brand-rose/10 px-2 py-1 text-[10px] font-bold text-brand-rose">
                              请确认盒子版式 · 提醒日 {boxArtworkStatus.reminderDate} · {sheet.aps_scheduled_date}
                            </div>
                          )}
                        </div>

                        {/* Compact progress bar: only the latest completed node shows its date. */}
                        <div className="hidden h-16 max-w-[320px] flex-1 items-center justify-center px-3 md:flex">
                          <div className="relative flex w-full items-center justify-between">
                            <div className="absolute left-1 right-1 top-1/2 z-0 h-0.5 -translate-y-1/2 bg-slate-600/30" />
                            <div
                              className="absolute left-1 top-1/2 z-0 h-0.5 -translate-y-1/2 bg-brand-cyan transition-all duration-300"
                              style={{ width: `${activeStepIdx >= 0 ? (activeStepIdx / (steps.length - 1)) * 100 : 0}%` }}
                            />
                            {steps.map((step, stepIndex) => {
                              const isCurrent = stepIndex === activeStepIdx;
                              return (
                                <div key={step.label} className="relative z-10 flex flex-col items-center">
                                  {isCurrent && step.date && (
                                    <span className="absolute bottom-5 whitespace-nowrap rounded border border-brand-cyan/25 bg-surface px-1.5 py-0.5 text-[9px] font-bold text-brand-cyan shadow-sm">
                                      {step.date}
                                    </span>
                                  )}
                                  <div className={`flex h-4 w-4 items-center justify-center rounded-full border text-[8px] transition-all ${
                                    step.done
                                      ? 'border-brand-cyan bg-brand-cyan text-white shadow shadow-brand-cyan/25'
                                      : 'border-slate-600/70 bg-slate-800 text-slate-500'
                                  } ${isCurrent ? 'ring-4 ring-brand-cyan/15' : ''}`}>
                                    {step.done ? '✓' : ''}
                                  </div>
                                  <span className={`absolute top-5 whitespace-nowrap text-[9px] transition-colors ${
                                    isCurrent
                                      ? 'font-bold text-brand-cyan'
                                      : step.done
                                        ? 'font-semibold text-slate-300'
                                        : 'font-medium text-slate-400'
                                  }`}>
                                    {step.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Original quick status summary. */}
                        <div className="flex items-center justify-between gap-5 pl-2 md:justify-end">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            (isResultFlow ? selectedContractDetail.contract.archived : isQaComplete(sheet))
                              ? 'border-brand-emerald/20 bg-brand-emerald/10 text-brand-emerald'
                              : 'border-brand-rose/20 bg-brand-rose/10 text-brand-rose'
                          }`}>
                            {isResultFlow
                              ? (selectedContractDetail.contract.archived ? '业务已完成' : '结果流程')
                              : (isQaComplete(sheet) ? 'QA已审批' : '待QA审批')}
                          </span>
                          <div className="text-right">
                            <div className="text-[10px] text-slate-500">{isResultFlow ? '业务类型' : '排产日'}</div>
                            <span className="font-semibold text-slate-300">
                              {isResultFlow ? (sheet.is_historical ? '历史数据' : '原料药') : (sheet.aps_scheduled_date || '未排产')}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-6 text-slate-500 text-xs italic">该合同尚未关联任何子联系单，可去“联系单管理”中创建关联。</div>
                )}
              </div>
            </div>

            {/* Bottom Row flow statistics */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/[0.04]">
              {/* Payment Flow */}
              <div className="space-y-3">
                <h5 className="font-heading font-semibold text-xs text-white">收款明细流</h5>
                <div className="space-y-2 max-h-40 overflow-y-auto text-xs pr-2">
                  {selectedContractDetail.payments.length > 0 ? (
                    selectedContractDetail.payments.map(p => (
                      <div key={p.id} className="p-2.5 rounded bg-white/[0.02] border border-white/[0.04] flex justify-between items-center">
                        <div>
                          <span className="font-semibold text-slate-300">{p.payment_type}</span>
                          <div className="text-[9px] text-slate-500">{p.payment_date}</div>
                        </div>
                        <span className="font-bold text-slate-200">
                          {p.currency === 'USD' ? '$' : '￥'}{p.amount.toLocaleString()}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-500 text-[11px] italic">无任何付款收款记录</div>
                  )}
                </div>
              </div>

              {/* Shipment Flow */}
              <div className="space-y-3">
                <h5 className="font-heading font-semibold text-xs text-white">发货流流水</h5>
                <div className="space-y-2 max-h-40 overflow-y-auto text-xs pr-2">
                  {selectedContractDetail.shipments.length > 0 ? (
                    selectedContractDetail.shipments.map(s => (
                      <div key={s.id} className="p-2.5 rounded bg-white/[0.02] border border-white/[0.04] flex justify-between items-center">
                        <div>
                          <span className="font-semibold text-slate-300">{s.shipment_no}</span>
                          <div className="text-[9px] text-slate-500">发货日: {s.shipment_date}</div>
                        </div>
                        <span className="font-semibold text-brand-emerald">{s.status}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-500 text-[11px] italic">无发货记录</div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal foot actions */}
            <div className="pt-4 border-t border-white/[0.06] flex justify-end gap-3">
              <button
                onClick={() => setShowDetailModal(false)}
                className="px-4 py-2 border border-slate-800 hover:bg-slate-800/50 rounded-lg text-slate-400 text-xs font-semibold"
              >
                关闭详情
              </button>
            </div>

          </div>
        </Dialog>
      )}
    </div>
  );
};
