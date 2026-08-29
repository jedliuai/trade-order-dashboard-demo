import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ComposedChart
} from 'recharts';
import { getLocalSession } from '../services/localClient';
import { Dialog } from '../components/Dialog';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { SearchableCombobox } from '../components/SearchableCombobox';
import { CustomerSelect } from '../components/CustomerSelect';
import { useFeedback } from '../components/FeedbackProvider';
import { BUILT_IN_ANALYSIS_PRESETS, mergeAnalysisTemplates, type AnalysisTemplateConfig } from '../services/analyticsPresets';
import {
  formatAnalyticsAxisValue,
  formatAnalyticsTooltipValue,
  formatAnalyticsValue,
  getAnalyticsDimensionKey,
  getAnalyticsMetricLabel,
  getAnalyticsMetricUnit,
  getAnalyticsMetricUnits,
  isAnalyticsEventInRange,
  limitAnalyticsMetricsToTwoUnits,
  normalizeAnalyticsChartRows
} from '../services/analyticsWorkspace';
import { buildAnalyticsDrillRows } from '../services/analyticsDrilldown';
import { calculateCurrentReceivables } from '../services/receivablesWorkspace';
import { summarizeAnalyticsBusiness } from '../services/analyticsSummary';
import {
  calculateConcentration,
  collapseTopGroupsWithOther
} from '../services/analyticsInsights';
import {
  getAnalyticsShipmentItems,
  loadAnalyticsDataSnapshot,
  loadAnalyticsTemplates,
  saveAnalyticsTemplates
} from '../services/analyticsDataService';
import { PaginationControls } from '../components/PaginationControls';
import { ColorIconBadge, type ColorIconTone } from '../components/ColorIconBadge';
import { usePagedRows } from '../hooks/usePagedRows';
import { getFiscalYearRange } from '../services/fiscalYear';
import {
  Search,
  FileSpreadsheet,
  Download,
  Save,
  RotateCcw,
  Layers,
  CheckCircle,
  ArrowRight,
  BarChart3,
  Coins,
  PackageCheck,
  MousePointerClick,
  AlertTriangle,
  TrendingUp,
  UsersRound,
  PackageSearch
} from 'lucide-react';

const COLORS = ['#b08956', '#8c7255', '#5c8567', '#aa5d44', '#c49942', '#ab4c4c', '#536872', '#708090', '#4f7942', '#800020'];

interface AnalyticsProps {
  onNavigate: (tab: string) => void;
  onRefreshTrigger: number;
}

export const Analytics: React.FC<AnalyticsProps> = ({ onNavigate, onRefreshTrigger }) => {
  const { notify } = useFeedback();
  const fiscalRange = useMemo(() => getFiscalYearRange(), []);
  // 1. The page consumes a service snapshot so the data source can later move
  // from the synchronized cache to SQLite aggregation/pagination without a UI rewrite.
  const analyticsData = useMemo(() => {
    void onRefreshTrigger;
    return loadAnalyticsDataSnapshot();
  }, [onRefreshTrigger]);
  const { customers, contracts, sheets, payments, shipments, shipmentItems, invoices, alerts, shipmentProfits, exchangeRates } = analyticsData;

  // 2. Filter States
  const [filterStartDate, setFilterStartDate] = useState(fiscalRange.startDate);
  const [filterEndDate, setFilterEndDate] = useState(fiscalRange.endDate);
  const [filterCustomer, setFilterCustomer] = useState('all');
  const [filterCountry, setFilterCountry] = useState('all');
  const [filterProduct, setFilterProduct] = useState('all');
  const [filterMaterialNo, setFilterMaterialNo] = useState('');
  const [filterContractNo, setFilterContractNo] = useState('');
  const [filterSheetNo, setFilterSheetNo] = useState('');
  const [filterExportType, setFilterExportType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const currencyMode = 'RMB' as const;
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // 3. Chart Configuration States
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['contract_amount', 'payment_amount']);
  const [selectedDimension, setSelectedDimension] = useState<string>('month');
  const [chartType, setChartType] = useState<string>('composed'); // line, bar, pie, stacked, composed
  const [timePerspective, setTimePerspective] = useState<'event' | 'contract'>('event');

  // 4. Drill down details table state
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedDrillMetric, setSelectedDrillMetric] = useState<string | null>(null);

  // 5. Template States
  const [templates, setTemplates] = useState<AnalysisTemplateConfig[]>([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState('');

  // All analysis uses the rate from the business event month. Missing rates are
  // deliberately excluded instead of being silently replaced by the latest rate.
  const rateForDate = React.useCallback((date: string | null | undefined) => {
    if (!date) return null;
    return exchangeRates.find(rate => rate.effective_month === date.substring(0, 7))?.rate ?? null;
  }, [exchangeRates]);

  // Unique options for dropdown menus
  const customerOptions = useMemo(() => Array.from(new Set(contracts.map(c => c.customer_name).filter(Boolean))).sort(), [contracts]);
  const countryOptions = useMemo(() => Array.from(new Set(sheets.map(s => s.country).filter(Boolean))).sort(), [sheets]);
  const productOptions = useMemo(() => Array.from(new Set(sheets.map(s => s.product_name).filter(Boolean))).sort(), [sheets]);
  const availableTemplates = useMemo(() => mergeAnalysisTemplates(templates), [templates]);
  const builtInTemplateNames = useMemo(() => new Set(BUILT_IN_ANALYSIS_PRESETS.map((template) => template.name)), []);
  const customTemplates = useMemo(() => availableTemplates.filter((template) => !builtInTemplateNames.has(template.name)), [availableTemplates, builtInTemplateNames]);

  // Load saved templates from local SQLite-backed cache
  useEffect(() => {
    const saved = loadAnalyticsTemplates();
    if (saved.length) {
      setTemplates(saved);
      return;
    }

    setTemplates(BUILT_IN_ANALYSIS_PRESETS);
    if (!getLocalSession()?.user?.id) return;

    let cancelled = false;
    void saveAnalyticsTemplates(BUILT_IN_ANALYSIS_PRESETS).catch((error) => {
      if (!cancelled) setTemplateError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [onRefreshTrigger]);

  // Save Template
  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) return;
    const template: AnalysisTemplateConfig = {
      name: newTemplateName.trim(),
      filters: {
        start: filterStartDate,
        end: filterEndDate,
        customer: filterCustomer,
        country: filterCountry,
        product: filterProduct,
        exportType: filterExportType,
        status: filterStatus,
        materialNo: filterMaterialNo,
        contractNo: filterContractNo,
        sheetNo: filterSheetNo,
        timePerspective
      },
      metrics: selectedMetrics,
      dimension: selectedDimension,
      chartType,
      currencyMode
    };
    const updated = [...templates.filter((item) => item.name !== template.name), template];
    setIsSavingTemplate(true);
    setTemplateError('');
    try {
      await saveAnalyticsTemplates(updated);
      setTemplates(updated);
      setNewTemplateName('');
      setShowSaveTemplateModal(false);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleApplyTemplate = (tpl: AnalysisTemplateConfig) => {
    if (tpl.filters) {
      setFilterStartDate(tpl.filters.start || fiscalRange.startDate);
      setFilterEndDate(tpl.filters.end || fiscalRange.endDate);
      setFilterCustomer(tpl.filters.customer || 'all');
      setFilterCountry(tpl.filters.country || 'all');
      setFilterProduct(tpl.filters.product || 'all');
      setFilterExportType(tpl.filters.exportType || 'all');
      setFilterStatus(tpl.filters.status || 'all');
      setFilterMaterialNo(tpl.filters.materialNo || '');
      setFilterContractNo(tpl.filters.contractNo || '');
      setFilterSheetNo(tpl.filters.sheetNo || '');
      setTimePerspective(tpl.filters.timePerspective || 'event');
    }
    const safeMetrics = limitAnalyticsMetricsToTwoUnits(tpl.metrics);
    setSelectedMetrics(safeMetrics);
    setSelectedDimension(tpl.dimension);
    setChartType(tpl.chartType === 'stacked' && getAnalyticsMetricUnits(safeMetrics).length > 1 ? 'bar' : tpl.chartType);
    if (safeMetrics.length !== tpl.metrics.length) {
      notify({
        title: '模板指标已自动精简',
        message: '旧模板同时包含三种单位，系统保留前两种单位，避免图表出现三套难以理解的坐标轴。',
        tone: 'warning'
      });
    }
    setSelectedGroup(null);
    setSelectedDrillMetric(null);
  };

  const handleResetFilters = () => {
    setFilterStartDate(fiscalRange.startDate);
    setFilterEndDate(fiscalRange.endDate);
    setFilterCustomer('all');
    setFilterCountry('all');
    setFilterProduct('all');
    setFilterMaterialNo('');
    setFilterContractNo('');
    setFilterSheetNo('');
    setFilterExportType('all');
    setFilterStatus('all');
    setTimePerspective('event');
    setSelectedGroup(null);
    setSelectedDrillMetric(null);
  };

  const toggleMetric = (metric: string) => {
    if (selectedMetrics.includes(metric)) {
      if (selectedMetrics.length > 1) {
        setSelectedMetrics(selectedMetrics.filter(m => m !== metric));
        if (selectedDrillMetric === metric) {
          setSelectedGroup(null);
          setSelectedDrillMetric(null);
        }
      }
    } else {
      const nextMetrics = [...selectedMetrics, metric];
      if (getAnalyticsMetricUnits(nextMetrics).length > 2) {
        notify({
          title: '一次最多比较两种单位',
          message: '金额、百分比和数量同时出现会让坐标轴难以理解，请先取消一种单位的指标。',
          tone: 'warning'
        });
        return;
      }
      if (chartType === 'stacked' && getAnalyticsMetricUnits(nextMetrics).length > 1) {
        setChartType('bar');
        notify({
          title: '已切换为对比柱状图',
          message: '不同单位不能堆叠相加，系统已保留指标并改用双轴对比。',
          tone: 'info'
        });
      }
      setSelectedMetrics(nextMetrics);
    }
  };

  // 6. Filtered core datasets memo
  const filteredData = useMemo(() => {
    // Filter contact sheets
    const matchedSheets = sheets.filter(s => {
      const c = contracts.find(co => co.id === s.contract_id);
      if (!c) return false;

      // Date range (by contract date or production date)
      const dateVal = c.contract_date || '';
      if (filterStartDate && dateVal < filterStartDate) return false;
      if (filterEndDate && dateVal > filterEndDate) return false;

      // Dropdowns
      if (filterCustomer !== 'all' && c.customer_name !== filterCustomer) return false;
      if (filterCountry !== 'all' && s.country !== filterCountry) return false;
      if (filterProduct !== 'all' && s.product_name !== filterProduct) return false;
      if (filterExportType !== 'all' && c.export_type !== filterExportType) return false;
      if (filterStatus !== 'all' && s.status !== filterStatus) return false;

      // Inputs
      if (filterMaterialNo && !s.material_no?.toLowerCase().includes(filterMaterialNo.toLowerCase())) return false;
      if (filterContractNo && !c.contract_no?.toLowerCase().includes(filterContractNo.toLowerCase())) return false;
      if (filterSheetNo && !s.contact_sheet_no?.toLowerCase().includes(filterSheetNo.toLowerCase())) return false;

      return true;
    });

    // Filter contracts matching criteria
    const matchedContracts = contracts.filter(c => {
      const dateVal = c.contract_date || '';
      if (filterStartDate && dateVal < filterStartDate) return false;
      if (filterEndDate && dateVal > filterEndDate) return false;
      if (filterCustomer !== 'all' && c.customer_name !== filterCustomer) return false;
      if (filterExportType !== 'all' && c.export_type !== filterExportType) return false;
      if (filterContractNo && !c.contract_no?.toLowerCase().includes(filterContractNo.toLowerCase())) return false;

      // Check if any child sheet matches country, product, etc.
      const childSheets = sheets.filter(s => s.contract_id === c.id);
      if (filterCountry !== 'all' && !childSheets.some(s => s.country === filterCountry)) return false;
      if (filterProduct !== 'all' && !childSheets.some(s => s.product_name === filterProduct)) return false;
      if (filterStatus !== 'all' && !childSheets.some(s => s.status === filterStatus)) return false;

      return true;
    });

    // Filter payments matching criteria
    const matchedPayments = payments.filter(p => {
      const c = contracts.find(co => co.id === p.contract_id);
      if (!c) return false;

      const dateVal = timePerspective === 'contract' ? c.contract_date : (p.payment_date || '');
      if (filterStartDate && dateVal < filterStartDate) return false;
      if (filterEndDate && dateVal > filterEndDate) return false;
      if (filterCustomer !== 'all' && c.customer_name !== filterCustomer) return false;
      if (filterContractNo && !c.contract_no?.toLowerCase().includes(filterContractNo.toLowerCase())) return false;

      const childSheets = sheets.filter(s => s.contract_id === c.id);
      if (filterCountry !== 'all' && !childSheets.some(s => s.country === filterCountry)) return false;
      if (filterProduct !== 'all' && !childSheets.some(s => s.product_name === filterProduct)) return false;
      if (filterStatus !== 'all' && !childSheets.some(s => s.status === filterStatus)) return false;
      if (filterMaterialNo && !childSheets.some(s => s.material_no?.toLowerCase().includes(filterMaterialNo.toLowerCase()))) return false;
      if (filterSheetNo && !childSheets.some(s => s.contact_sheet_no?.toLowerCase().includes(filterSheetNo.toLowerCase()))) return false;

      return true;
    });

    // Filter shipments matching criteria
    const matchedShipments = shipments.filter(sh => {
      const c = contracts.find(co => co.id === sh.contract_id);
      if (!c) return false;

      const dateVal = timePerspective === 'contract' ? c.contract_date : (sh.shipment_date || '');
      if (filterStartDate && dateVal < filterStartDate) return false;
      if (filterEndDate && dateVal > filterEndDate) return false;
      if (filterCustomer !== 'all' && c.customer_name !== filterCustomer) return false;
      if (filterExportType !== 'all' && c.export_type !== filterExportType) return false;
      if (filterContractNo && !c.contract_no?.toLowerCase().includes(filterContractNo.toLowerCase())) return false;

      const shipmentSheets = getAnalyticsShipmentItems(analyticsData, sh.id)
        .map(item => sheets.find(s => s.id === item.contact_sheet_id))
        .filter(Boolean);
      if (filterCountry !== 'all' && !shipmentSheets.some(s => s?.country === filterCountry)) return false;
      if (filterProduct !== 'all' && !shipmentSheets.some(s => s?.product_name === filterProduct)) return false;
      if (filterStatus !== 'all' && !shipmentSheets.some(s => s?.status === filterStatus)) return false;
      if (filterMaterialNo && !shipmentSheets.some(s => s?.material_no?.toLowerCase().includes(filterMaterialNo.toLowerCase()))) return false;
      if (filterSheetNo && !shipmentSheets.some(s => s?.contact_sheet_no?.toLowerCase().includes(filterSheetNo.toLowerCase()))) return false;

      return true;
    });

    // Filter invoices matching criteria
    const matchedInvoices = invoices.filter(iv => {
      const invoiceShipments = iv.shipment_ids.map(id => shipments.find(s => s.id === id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
      const invoiceContracts = invoiceShipments.map(sh => contracts.find(co => co.id === sh.contract_id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
      if (!invoiceShipments.length || !invoiceContracts.length) return false;

      if (timePerspective === 'event') {
        const dateVal = iv.invoice_date || '';
        if (filterStartDate && dateVal < filterStartDate) return false;
        if (filterEndDate && dateVal > filterEndDate) return false;
      } else if (!invoiceContracts.some((contract) => isAnalyticsEventInRange(contract.contract_date, filterStartDate, filterEndDate))) {
        return false;
      }
      if (filterCustomer !== 'all' && !invoiceContracts.some(c => c.customer_name === filterCustomer)) return false;
      if (filterExportType !== 'all' && !invoiceContracts.some(c => c.export_type === filterExportType)) return false;
      if (filterContractNo && !invoiceContracts.some(c => c.contract_no?.toLowerCase().includes(filterContractNo.toLowerCase()))) return false;

      const invoiceSheets = invoiceShipments.flatMap(sh => getAnalyticsShipmentItems(analyticsData, sh.id))
        .map(item => sheets.find(s => s.id === item.contact_sheet_id))
        .filter(Boolean);
      if (filterCountry !== 'all' && !invoiceSheets.some(s => s?.country === filterCountry)) return false;
      if (filterProduct !== 'all' && !invoiceSheets.some(s => s?.product_name === filterProduct)) return false;
      if (filterStatus !== 'all' && !invoiceSheets.some(s => s?.status === filterStatus)) return false;
      if (filterMaterialNo && !invoiceSheets.some(s => s?.material_no?.toLowerCase().includes(filterMaterialNo.toLowerCase()))) return false;
      if (filterSheetNo && !invoiceSheets.some(s => s?.contact_sheet_no?.toLowerCase().includes(filterSheetNo.toLowerCase()))) return false;

      return true;
    });

    return {
      sheets: matchedSheets,
      contracts: matchedContracts,
      payments: matchedPayments,
      shipments: matchedShipments,
      invoices: matchedInvoices
    };
  }, [sheets, contracts, payments, shipments, invoices, analyticsData, filterStartDate, filterEndDate, filterCustomer, filterCountry, filterProduct, filterExportType, filterStatus, filterMaterialNo, filterContractNo, filterSheetNo, timePerspective]);

  const hasActiveFilters = Boolean(
    filterStartDate !== fiscalRange.startDate || filterEndDate !== fiscalRange.endDate || filterCustomer !== 'all' || filterCountry !== 'all'
    || filterProduct !== 'all' || filterMaterialNo || filterContractNo || filterSheetNo
    || filterExportType !== 'all' || filterStatus !== 'all' || timePerspective !== 'event'
  );

  const filteredProfitRows = useMemo(() => {
    return shipmentProfits.filter((row) => {
      const contract = contracts.find((item) => item.contract_no === row.contract_no);
      if (timePerspective === 'contract') {
        if (!isAnalyticsEventInRange(contract?.contract_date, filterStartDate, filterEndDate)) return false;
      } else {
        if (!row.invoice_month) return false;
        const startMonth = filterStartDate?.substring(0, 7);
        const endMonth = filterEndDate?.substring(0, 7);
        if (startMonth && row.invoice_month < startMonth) return false;
        if (endMonth && row.invoice_month > endMonth) return false;
      }
      if (filterCustomer !== 'all' && row.customer_name !== filterCustomer) return false;
      if (filterProduct !== 'all' && row.product_name !== filterProduct) return false;
      if (filterMaterialNo && !row.material_no?.toLowerCase().includes(filterMaterialNo.toLowerCase())) return false;
      if (filterContractNo && !row.contract_no?.toLowerCase().includes(filterContractNo.toLowerCase())) return false;
      if (filterExportType !== 'all' && row.export_type !== filterExportType) return false;

      const sheet = sheets.find((item) =>
        (!contract || item.contract_id === contract.id)
        && ((row.contact_sheet_no && item.contact_sheet_no === row.contact_sheet_no) || item.material_no === row.material_no)
      );
      if (filterCountry !== 'all' && sheet?.country !== filterCountry) return false;
      if (filterStatus !== 'all' && sheet?.status !== filterStatus) return false;
      if (filterSheetNo && !row.contact_sheet_no?.toLowerCase().includes(filterSheetNo.toLowerCase())) return false;
      return true;
    });
  }, [shipmentProfits, filterStartDate, filterEndDate, filterCustomer, filterCountry, filterProduct, filterMaterialNo, filterContractNo, filterSheetNo, filterExportType, filterStatus, contracts, sheets, timePerspective]);

  const profitQuality = useMemo(() => {
    return filteredProfitRows.reduce((summary, row) => {
      if (row.profit === null || row.is_estimated_profit) summary.pending += 1;
      else summary.confirmed += 1;
      return summary;
    }, { confirmed: 0, pending: 0 });
  }, [filteredProfitRows]);

  const currentReceivableFacts = useMemo(() => {
    const result = calculateCurrentReceivables({
      contracts,
      sheets,
      shipments,
      shipmentItems,
      payments,
      asOfDate: filterEndDate,
      rateForDate
    });
    return result.facts.filter((fact) => {
      const dateVal = timePerspective === 'contract' ? fact.contractDate : fact.shipmentDate;
      if (!isAnalyticsEventInRange(dateVal, filterStartDate, filterEndDate)) return false;
      if (filterCustomer !== 'all' && fact.customerName !== filterCustomer) return false;
      if (filterCountry !== 'all' && fact.country !== filterCountry) return false;
      if (filterProduct !== 'all' && fact.productName !== filterProduct) return false;
      if (filterExportType !== 'all' && fact.exportType !== filterExportType) return false;
      if (filterStatus !== 'all' && fact.status !== filterStatus) return false;
      if (filterMaterialNo && !fact.materialNo.toLowerCase().includes(filterMaterialNo.toLowerCase())) return false;
      if (filterContractNo && !fact.contractNo.toLowerCase().includes(filterContractNo.toLowerCase())) return false;
      if (filterSheetNo && !fact.contactSheetNo.toLowerCase().includes(filterSheetNo.toLowerCase())) return false;
      return true;
    });
  }, [contracts, sheets, shipments, shipmentItems, payments, filterStartDate, filterEndDate, filterCustomer, filterCountry, filterProduct, filterExportType, filterStatus, filterMaterialNo, filterContractNo, filterSheetNo, timePerspective, rateForDate]);

  // 7. Aggregation Engine (Core stats calculator)
  const aggregatedChartData = useMemo(() => {
    const { sheets: fSheets, contracts: fContracts, payments: fPayments, shipments: fShipments, invoices: fInvoices } = filteredData;
    const groups = new Map<string, {
      groupKey: string;
      contract_amount: number;
      shipment_amount: number;
      payment_amount: number;
      unpaid_amount: number;
      invoice_amount: number;
      profit: number;
      contract_count: number;
      sheet_count: number;
      shipment_count: number;
      alert_count: number;
      profit_sales_amount: number;
    }>();

    // Helper function to resolve group key
    const getGroupKey = (s: any, c: any) => {
      if (!c) return '未知';
      return getAnalyticsDimensionKey(selectedDimension, {
        eventDate: c.contract_date,
        customerName: c.customer_name,
        country: s.country || c.country,
        productName: s.product_name,
        materialNo: s.material_no,
        exportType: c.export_type,
        status: s.status || c.status
      });
    };

    const getOrCreateGroup = (key: string) => {
      if (!groups.has(key)) {
        groups.set(key, {
          groupKey: key,
          contract_amount: 0,
          shipment_amount: 0,
          payment_amount: 0,
          unpaid_amount: 0,
          invoice_amount: 0,
          profit: 0,
          contract_count: 0,
          sheet_count: 0,
          shipment_count: 0,
          alert_count: 0,
          profit_sales_amount: 0
        });
      }
      return groups.get(key)!;
    };

    // Aggregate from contact sheets
    fSheets.forEach(s => {
      const c = contracts.find(co => co.id === s.contract_id);
      if (!c) return;
      const key = getGroupKey(s, c);
      const g = getOrCreateGroup(key);

      const amt = s.quantity * s.unit_price;
      const exchangeRate = c.currency === 'USD' ? rateForDate(c.contract_date) : 1;
      if (exchangeRate === null) return;
      const amtRmb = amt * exchangeRate;

      g.contract_amount += amtRmb;
      g.sheet_count += 1;
    });

    // Aggregate from contracts directly
    fContracts.forEach(c => {
      const dummySheet = fSheets.find(s => s.contract_id === c.id) || { country: '未知国家', product_name: '未知产品', material_no: '未知物料', status: c.status };
      const key = getGroupKey(dummySheet, c);
      const g = getOrCreateGroup(key);
      g.contract_count += 1;
    });

    // Aggregate from payments
    fPayments.forEach(p => {
      const c = contracts.find(co => co.id === p.contract_id);
      if (!c) return;
      const amt = p.currency === 'RMB' ? p.amount : p.amount_rmb;
      if (amt === null || amt === undefined) return;
      const paymentContract = timePerspective === 'event' ? { ...c, contract_date: p.payment_date || c.contract_date } : c;
      const contractSheets = sheets.filter(s => s.contract_id === c.id);
      const splitBySheet = ['country', 'product', 'material', 'status'].includes(selectedDimension) && contractSheets.length > 0;
      if (!splitBySheet) {
        const dummySheet = contractSheets[0] || { country: '未知国家', product_name: '未知产品', material_no: '未知物料', status: c.status };
        getOrCreateGroup(getGroupKey(dummySheet, paymentContract)).payment_amount += amt;
        return;
      }
      const totalWeight = contractSheets.reduce((sum, sheet) => sum + sheet.quantity * sheet.unit_price, 0);
      contractSheets.forEach(sheet => {
        const weight = totalWeight > 0 ? sheet.quantity * sheet.unit_price / totalWeight : 1 / contractSheets.length;
        getOrCreateGroup(getGroupKey(sheet, paymentContract)).payment_amount += amt * weight;
      });
    });

    // Aggregate from shipments
    fShipments.forEach(sh => {
      const c = contracts.find(co => co.id === sh.contract_id);
      if (!c) return;
      const items = getAnalyticsShipmentItems(analyticsData, sh.id);
      const dummySheet = fSheets.find(s => s.contract_id === c.id) || { country: '未知国家', product_name: '未知产品', material_no: '未知物料', status: c.status };
      const key = getGroupKey(dummySheet, timePerspective === 'event' ? { ...c, contract_date: sh.shipment_date || c.contract_date } : c);
      const g = getOrCreateGroup(key);

      g.shipment_count += 1;
      items.forEach(it => {
        const exchangeRate = c.currency === 'USD' ? rateForDate(sh.shipment_date) : 1;
        if (exchangeRate === null) return;
        const itemAmt = it.shipped_quantity * it.unit_price * exchangeRate;
        g.shipment_amount += itemAmt;
      });
    });

    // Aggregate from invoices
    fInvoices.forEach(iv => {
      const exchangeRate = iv.currency === 'USD' ? rateForDate(iv.invoice_date) : 1;
      if (exchangeRate === null) return;
      iv.shipment_allocations.forEach(allocation => {
        const sh = shipments.find(s => s.id === allocation.shipment_id);
        const c = sh ? contracts.find(co => co.id === sh.contract_id) : null;
        const dummySheet = c ? (fSheets.find(s => s.contract_id === c.id) || { country: '未知国家', product_name: '未知产品', material_no: '未知物料', status: c.status }) : { country: '未知国家', product_name: '未知产品', material_no: '未知物料', status: '未知状态' };
        const key = getGroupKey(dummySheet, c && timePerspective === 'event' ? { ...c, contract_date: iv.invoice_date || c.contract_date } : c);
        const g = getOrCreateGroup(key);
        g.invoice_amount += allocation.allocated_amount * exchangeRate;
      });
    });

    // Aggregate from alerts
    if (selectedMetrics.includes('alert_count')) alerts.forEach(al => {
      if (al.status !== '未处理') return;
      if (!isAnalyticsEventInRange(al.created_at, filterStartDate, filterEndDate)) return;
      // Map alerts back to group
      let matchedContract = null;
      if (al.related_type === 'contract') {
        matchedContract = contracts.find(co => co.id === al.related_id);
      } else if (al.related_type === 'contact_sheet') {
        const cs = sheets.find(s => s.id === al.related_id);
        matchedContract = cs ? contracts.find(co => co.id === cs.contract_id) : null;
      }
      if (matchedContract && fContracts.some((contract) => contract.id === matchedContract?.id)) {
        const dummySheet = fSheets.find(s => s.contract_id === matchedContract.id) || { country: '未知国家', product_name: '未知产品', material_no: '未知物料', status: matchedContract.status };
        const key = getGroupKey(dummySheet, timePerspective === 'event' ? { ...matchedContract, contract_date: al.created_at.substring(0, 10) } : matchedContract);
        const g = getOrCreateGroup(key);
        g.alert_count += 1;
      }
    });

    // Aggregate actual shipment profits from SQLite calculation view.
    filteredProfitRows.forEach(row => {
      if (row.profit === null || row.is_estimated_profit) return;
      const sh = shipments.find(item => item.id === row.shipment_id);
      const c = sh ? contracts.find(item => item.id === sh.contract_id) : null;
      if (!c) return;
      const matchedSheet = sheets.find(s =>
        s.contract_id === c.id
        && (
          (row.contact_sheet_no && s.contact_sheet_no === row.contact_sheet_no)
          || (row.material_no && s.material_no === row.material_no)
        )
      ) || { country: '未知国家', product_name: row.product_name || '未知产品', material_no: row.material_no || '未知物料', status: c.status };
      const key = getGroupKey(matchedSheet, timePerspective === 'event' ? { ...c, contract_date: row.invoice_month ? `${row.invoice_month}-01` : c.contract_date } : c);
      const g = getOrCreateGroup(key);
      g.profit += row.profit;
      const profitBasisAmount = row.profit_basis_amount_rmb ?? row.sales_amount_rmb;
      if (profitBasisAmount !== null) {
        g.profit_sales_amount += profitBasisAmount;
      }
    });

    // Current receivable is based on shipped-but-unpaid facts, not contract value.
    currentReceivableFacts.forEach((fact) => {
      if (fact.outstandingAmountRmb === null) return;
      const contract = contracts.find((row) => row.id === fact.contractId);
      if (!contract) return;
      const sheet = {
        country: fact.country,
        product_name: fact.productName,
        material_no: fact.materialNo,
        status: fact.status
      };
      const datedContract = timePerspective === 'event' ? { ...contract, contract_date: fact.shipmentDate } : contract;
      getOrCreateGroup(getGroupKey(sheet, datedContract)).unpaid_amount += fact.outstandingAmountRmb;
    });

    // Map raw groups to chart-ready objects
    const chartRows = Array.from(groups.values()).map(g => {
      const gross_margin = g.profit_sales_amount > 0 ? parseFloat(((g.profit / g.profit_sales_amount) * 100).toFixed(1)) : 0;

      return {
        name: g.groupKey,
        contract_amount: g.contract_amount,
        shipment_amount: g.shipment_amount,
        payment_amount: g.payment_amount,
        unpaid_amount: g.unpaid_amount,
        invoice_amount: g.invoice_amount,
        profit: g.profit,
        gross_margin,
        contract_count: g.contract_count,
        sheet_count: g.sheet_count,
        shipment_count: g.shipment_count,
        alert_count: g.alert_count
      };
    });
    return normalizeAnalyticsChartRows(chartRows, {
      dimension: selectedDimension,
      startDate: filterStartDate,
      endDate: filterEndDate,
      selectedMetrics
    });
  }, [filteredData, selectedDimension, selectedMetrics, filterStartDate, filterEndDate, contracts, shipments, alerts, sheets, filteredProfitRows, currentReceivableFacts, rateForDate, timePerspective, analyticsData]);

  // Top 5 filter for Pie Chart
  const pieChartData = useMemo(() => {
    if (chartType !== 'pie' || aggregatedChartData.length === 0) return [];
    const metric = selectedMetrics[0] || 'contract_amount';
    return collapseTopGroupsWithOther(aggregatedChartData, metric, selectedMetrics);
  }, [aggregatedChartData, chartType, selectedMetrics]);

  const contributionInsights = useMemo(() => {
    if (!['customer', 'country', 'product'].includes(selectedDimension)) return null;
    const scaleMetric = selectedMetrics.find((metric) => [
      'contract_amount', 'shipment_amount', 'payment_amount', 'unpaid_amount', 'invoice_amount'
    ].includes(metric)) || 'contract_amount';
    return {
      scale: calculateConcentration(aggregatedChartData, scaleMetric),
      profit: calculateConcentration(aggregatedChartData, 'profit')
    };
  }, [aggregatedChartData, selectedDimension, selectedMetrics]);

  // Detailed rows for drill down selection
  const drillDownDetails = useMemo(() => {
    if (!selectedGroup || !selectedDrillMetric) return [];
    return buildAnalyticsDrillRows({
      metric: selectedDrillMetric,
      group: selectedGroup,
      dimension: selectedDimension,
      startDate: filterStartDate,
      endDate: filterEndDate,
      contracts,
      sheets,
      filteredContracts: filteredData.contracts,
      filteredSheets: filteredData.sheets,
      payments: filteredData.payments,
      shipments,
      filteredShipments: filteredData.shipments,
      shipmentItems,
      invoices: filteredData.invoices,
      profits: filteredProfitRows,
      receivables: currentReceivableFacts,
      alerts,
      rateForDate,
      timePerspective
    });
  }, [selectedGroup, selectedDrillMetric, selectedDimension, filterStartDate, filterEndDate, contracts, sheets, shipments, filteredData, shipmentItems, filteredProfitRows, currentReceivableFacts, alerts, rateForDate, timePerspective]);
  const drillPage = usePagedRows(
    drillDownDetails,
    `${selectedGroup || ''}|${selectedDrillMetric || ''}|${selectedDimension}|${timePerspective}|${filterStartDate}|${filterEndDate}`,
    25
  );

  // Dynamic single-client / single-product analysis detection
  const singleClientAnalysis = useMemo(() => {
    if (filterCustomer !== 'all') {
      const sheetList = filteredData.sheets.filter(s => {
        const c = filteredData.contracts.find(co => co.id === s.contract_id);
        return c?.customer_name === filterCustomer;
      });
      const contractList = filteredData.contracts.filter(c => c.customer_name === filterCustomer);
      const totalContractVal = sheetList.reduce((sum, s) => {
        const contract = filteredData.contracts.find(co => co.id === s.contract_id);
        const rate = contract?.currency === 'USD' ? rateForDate(contract.contract_date) : 1;
        return rate === null ? sum : sum + s.quantity * s.unit_price * rate;
      }, 0);
      const paid = filteredData.payments.filter(p => contracts.find(co => co.id === p.contract_id)?.customer_name === filterCustomer)
                            .reduce((sum, p) => sum + (p.currency === 'RMB' ? p.amount : p.amount_rmb ?? 0), 0);
      const profitVal = filteredProfitRows
        .filter(row => row.customer_name === filterCustomer && row.profit !== null && !row.is_estimated_profit)
        .reduce((sum, row) => sum + (row.profit || 0), 0);

      return {
        active: true,
        name: filterCustomer,
        totalContractAmt: totalContractVal,
        totalPaidAmt: paid,
        totalProfitAmt: profitVal,
        sheetCount: sheetList.length,
        contractCount: contractList.length
      };
    }
    return {
      active: false,
      name: '',
      totalContractAmt: 0,
      totalPaidAmt: 0,
      totalProfitAmt: 0,
      sheetCount: 0,
      contractCount: 0
    };
  }, [filterCustomer, filteredData, contracts, filteredProfitRows, rateForDate]);

  const singleProductAnalysis = useMemo(() => {
    if (filterProduct !== 'all') {
      const productSheets = filteredData.sheets.filter(s => s.product_name === filterProduct);
      const totalAmtVal = productSheets.reduce((sum, s) => {
        const contract = filteredData.contracts.find(co => co.id === s.contract_id);
        const rate = contract?.currency === 'USD' ? rateForDate(contract.contract_date) : 1;
        return rate === null ? sum : sum + s.quantity * s.unit_price * rate;
      }, 0);
      const totalProfitVal = filteredProfitRows
        .filter(row => row.product_name === filterProduct && row.profit !== null && !row.is_estimated_profit)
        .reduce((sum, row) => sum + (row.profit || 0), 0);

      return {
        active: true,
        name: filterProduct,
        totalSalesAmt: totalAmtVal,
        totalProfitAmt: totalProfitVal,
        sheetCount: productSheets.length,
        qtyCount: productSheets.reduce((sum, s) => sum + s.quantity, 0),
        unit: productSheets[0]?.unit || '盒'
      };
    }
    return {
      active: false,
      name: '',
      totalSalesAmt: 0,
      totalProfitAmt: 0,
      sheetCount: 0,
      qtyCount: 0,
      unit: '盒'
    };
  }, [filterProduct, filteredData, filteredProfitRows, rateForDate]);

  const businessSummary = useMemo(() => {
    const summary = summarizeAnalyticsBusiness({
      contractAmountsRmb: filteredData.sheets.map((sheet) => {
        const contract = contracts.find((row) => row.id === sheet.contract_id);
        if (!contract) return null;
        const rate = contract.currency === 'USD' ? rateForDate(contract.contract_date) : 1;
        return rate === null ? null : sheet.quantity * sheet.unit_price * rate;
      }),
      paymentAmountsRmb: filteredData.payments.map((payment) => (
        payment.currency === 'RMB' ? payment.amount : payment.amount_rmb ?? null
      )),
      receivableAmountsRmb: currentReceivableFacts.map((fact) => fact.outstandingAmountRmb),
      profitRows: filteredProfitRows.map((row) => ({
        profit: row.profit,
        salesAmountRmb: row.sales_amount_rmb,
        confirmed: row.profit !== null && !row.is_estimated_profit
      }))
    });
    return {
      ...summary,
      paymentCount: filteredData.payments.length,
      receivableCount: currentReceivableFacts.length,
      contractCount: filteredData.contracts.length
    };
  }, [filteredData, contracts, currentReceivableFacts, filteredProfitRows, rateForDate]);

  // Exports
  const handleExportCSV = () => {
    if (aggregatedChartData.length === 0) return;
    const headers = ['维度名称', ...selectedMetrics.map(m => getAnalyticsMetricLabel(m, true))];
    const rows = aggregatedChartData.map(g => [
      g.name,
      ...selectedMetrics.map(m => g[m as keyof typeof g])
    ]);

    const csvContent = "data:text/csv;charset=utf-8,\ufeff"
      + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `数据统计分析_${selectedDimension}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportSVG = () => {
    const container = document.getElementById("analytics-chart-container");
    const svgEl = container?.querySelector('svg');
    if (!svgEl) return;
    try {
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(svgEl);
      if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
        source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      }
      if (!source.match(/^<svg[^>]+xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/)) {
        source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
      }
      const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      const downloadLink = document.createElement("a");
      downloadLink.href = svgUrl;
      downloadLink.download = `分析图表_${selectedDimension}.svg`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch (e) {
      console.error(e);
      notify({ title: 'SVG 导出失败', message: e instanceof Error ? e.message : '无法生成当前分析图表，请稍后重试。', tone: 'error' });
    }
  };

  const missingRateMonths = useMemo(() => {
    const months = new Set<string>();
    const addMissing = (currency: string, date: string | null | undefined, amountRmb?: number | null) => {
      if (currency !== 'USD' || amountRmb != null || !date) return;
      const month = date.substring(0, 7);
      if (!exchangeRates.some(rate => rate.effective_month === month)) months.add(month);
    };
    filteredData.contracts.forEach(contract => addMissing(contract.currency, contract.contract_date));
    filteredData.shipments.forEach(shipment => {
      const contract = contracts.find(item => item.id === shipment.contract_id);
      if (contract) addMissing(contract.currency, shipment.shipment_date);
    });
    filteredData.payments.forEach(payment => addMissing(payment.currency, payment.payment_date, payment.amount_rmb));
    filteredData.invoices.forEach(invoice => addMissing(invoice.currency, invoice.invoice_date));
    currentReceivableFacts.forEach((fact) => {
      if (fact.missingRate) addMissing(fact.currency, fact.shipmentDate);
    });
    return Array.from(months).sort();
  }, [filteredData, contracts, exchangeRates, currentReceivableFacts]);

  const selectedMetricUnits = getAnalyticsMetricUnits(selectedMetrics);
  const handleChartDrill = (group: string | null | undefined, metric: string) => {
    if (!group) return;
    setSelectedGroup(group);
    setSelectedDrillMetric(metric);
  };

  const tooltipFormatter = (value: any, _name: any, item: any): [string, string] => {
    const metric = String(item?.dataKey || selectedMetrics[0] || 'contract_amount');
    const normalizedValue = Array.isArray(value) ? value[0] : value;
    return [formatAnalyticsTooltipValue(normalizedValue, metric), getAnalyticsMetricLabel(metric)];
  };

  const renderAnalyticsAxes = () => selectedMetricUnits.map((unit, index) => (
    <YAxis
      key={unit}
      yAxisId={unit}
      orientation={index === 0 ? 'left' : 'right'}
      stroke="#64748b"
      width={unit === 'amount' ? 58 : 46}
      tickFormatter={(value) => formatAnalyticsAxisValue(value, unit)}
      label={{
        value: unit === 'amount' ? '万元' : unit === 'rate' ? '%' : '数量',
        angle: index === 0 ? -90 : 90,
        position: index === 0 ? 'insideLeft' : 'insideRight',
        fill: '#8c7f70',
        fontSize: 10
      }}
    />
  ));


  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-8">
      <PageHeader
        title="数据分析中心"
        description={timePerspective === 'event'
          ? `默认统计${fiscalRange.label}；合同、回款和利润分别按签约日、收款日和开票月份归属`
          : `当前按合同签约批次观察；后续发货、回款、开票和利润归回对应合同的签约日期`}
      />
      <div className="rounded-xl border border-brand-cyan/20 bg-brand-cyan/[0.06] px-4 py-3 text-xs text-body">
        当前默认考核周期：<span className="font-semibold text-brand-cyan">{fiscalRange.startDate} 至 {fiscalRange.endDate}</span>。可在多维筛选器中手动调整为其他历史范围。
      </div>
      {missingRateMonths.length > 0 && (
        <div role="alert" className="rounded-lg border border-brand-amber/25 bg-brand-amber/10 px-4 py-3 text-xs text-brand-amber">
          缺少 {missingRateMonths.join('、')} 的 USD/CNY 汇率；相关美元金额暂不计入人民币分析，请先在系统设置中补充。
        </div>
      )}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="当前筛选范围经营摘要">
        <div className="rounded-xl border border-brand-emerald/20 bg-brand-emerald/[0.06] px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted">累计回款</span>
            <Coins className="h-4 w-4 text-brand-emerald" />
          </div>
          <div className="mt-2 text-xl font-extrabold text-brand-emerald">{formatAnalyticsTooltipValue(businessSummary.paymentAmount, 'payment_amount')}</div>
          <p className="mt-1 text-[10px] text-subtle">{businessSummary.paymentCount} 条到账分摊 · 按收款日归属</p>
        </div>
        <div className="rounded-xl border border-brand-amber/20 bg-brand-amber/[0.06] px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted">已确认毛利</span>
            <TrendingUp className="h-4 w-4 text-brand-amber" />
          </div>
          <div className="mt-2 text-xl font-extrabold text-brand-amber">{formatAnalyticsTooltipValue(businessSummary.confirmedProfit, 'profit')}</div>
          <p className="mt-1 text-[10px] text-subtle">{businessSummary.confirmedProfitCount} 条已确认{businessSummary.confirmedGrossMargin === null ? '' : ` · 毛利率 ${businessSummary.confirmedGrossMargin.toFixed(2)}%`}</p>
        </div>
        <div className="rounded-xl border border-brand-rose/20 bg-brand-rose/[0.05] px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted">当前应收</span>
            <PackageCheck className="h-4 w-4 text-brand-rose" />
          </div>
          <div className="mt-2 text-xl font-extrabold text-brand-rose">{formatAnalyticsTooltipValue(businessSummary.currentReceivable, 'unpaid_amount')}</div>
          <p className="mt-1 text-[10px] text-subtle">{businessSummary.receivableCount} 条已发货余额{businessSummary.missingReceivableRateCount > 0 ? ` · ${businessSummary.missingReceivableRateCount} 条缺汇率` : ''}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted">签约金额</span>
            <FileSpreadsheet className="h-4 w-4 text-brand-cyan" />
          </div>
          <div className="mt-2 text-xl font-extrabold text-ink">{formatAnalyticsTooltipValue(businessSummary.contractAmount, 'contract_amount')}</div>
          <p className="mt-1 text-[10px] text-subtle">{businessSummary.contractCount} 份合同{businessSummary.missingContractRateCount > 0 ? ` · ${businessSummary.missingContractRateCount} 条缺汇率` : ''}</p>
        </div>
      </section>
      {/* Common analysis presets */}
      <section className="glass-panel rounded-2xl p-4 space-y-3" aria-labelledby="common-analysis-heading">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 id="common-analysis-heading" className="text-sm font-semibold text-ink">常用分析</h3>
            <p className="mt-0.5 text-[11px] text-muted">从经营问题进入，应用后仍可自由调整。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setShowAdvancedFilters(prev => !prev)}
              tone={showAdvancedFilters ? 'subtle' : 'secondary'}
              size="sm"
              icon={<Search className="h-3.5 w-3.5" />}
            >
              {showAdvancedFilters ? '隐藏多维筛选' : '展开多维筛选'}
            </Button>
            <Button
              onClick={() => {
                setTemplateError('');
                setShowSaveTemplateModal(true);
              }}
              tone="secondary"
              size="sm"
              icon={<Save className="h-3.5 w-3.5" />}
            >
              保存当前配置
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={() => onNavigate('analytics_customer_value')}
            className="group flex items-center gap-3 rounded-xl border border-brand-cyan/25 bg-brand-cyan/[0.06] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-brand-cyan/45 hover:bg-brand-cyan/10"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-cyan/12 text-brand-cyan"><UsersRound className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">客户经营分析</span>
              <span className="mt-0.5 block truncate text-[10px] text-muted">查看客户价值、贡献集中度和实际发货活跃度。</span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-cyan transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('analytics_customer_product')}
            className="group flex items-center gap-3 rounded-xl border border-brand-amber/25 bg-brand-amber/[0.06] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-brand-amber/45 hover:bg-brand-amber/10"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-amber/12 text-brand-amber"><PackageCheck className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">客户产品分析</span>
              <span className="mt-0.5 block truncate text-[10px] text-muted">查看产品结构、贡献占比和三财年趋势。</span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-amber transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('analytics_product_operating')}
            className="group flex items-center gap-3 rounded-xl border border-brand-purple/25 bg-brand-purple/[0.06] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-brand-purple/45 hover:bg-brand-purple/10"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-purple/12 text-brand-purple"><PackageSearch className="h-4 w-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">产品经营分析</span>
              <span className="mt-0.5 block truncate text-[10px] text-muted">查看产品贡献集中度、核心长尾和三财年表现。</span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-purple transition-transform group-hover:translate-x-0.5" />
          </button>
          {availableTemplates.filter((template) => builtInTemplateNames.has(template.name)).map((template) => {
            const TemplateIcon = template.dimension === 'month' ? TrendingUp
              : template.dimension === 'customer' ? Coins
                : template.dimension === 'product' ? PackageCheck
                  : AlertTriangle;
            const templateTone: ColorIconTone = template.dimension === 'month' ? 'blue'
              : template.dimension === 'customer' ? 'green'
                : template.dimension === 'product' ? 'amber'
                  : 'rose';
            return (
              <button
                key={template.name}
                type="button"
                onClick={() => handleApplyTemplate(template)}
                className="group flex items-center gap-3 rounded-xl border border-border bg-surface-muted/45 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-brand-cyan/35 hover:bg-surface"
              >
                <ColorIconBadge tone={templateTone} size="sm" shape="circle"><TemplateIcon className="h-4 w-4" /></ColorIconBadge>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{template.entryTitle || template.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted" title={template.description}>{template.description}</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-brand-cyan transition-transform group-hover:translate-x-0.5" />
              </button>
            );
          })}
        </div>

        {customTemplates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
            <span className="font-semibold text-muted">我的模板</span>
            {customTemplates.map((template) => (
              <button key={template.name} type="button" onClick={() => handleApplyTemplate(template)} className="rounded-lg border border-border bg-surface px-3 py-1.5 font-semibold text-body transition-colors hover:border-brand-cyan/35 hover:text-brand-cyan">
                {template.name}
              </button>
            ))}
          </div>
        )}
      </section>

      {profitQuality.pending > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-brand-amber/20 bg-brand-amber/[0.06] px-4 py-3 text-xs text-body">
          <span className="font-semibold text-brand-amber">利润口径提示</span>
          <span>已确认 {profitQuality.confirmed} 条</span>
          <span>待计算 {profitQuality.pending} 条</span>
          <span className="text-muted">利润只统计已开票且成本、汇率齐全的明细；未满足条件的记录不进入合计。</span>
        </div>
      )}

      {templateError && !showSaveTemplateModal && (
        <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-4 py-3 text-xs text-brand-rose">
          分析模板同步失败：{templateError}
        </div>
      )}

      {/* 1. Filters Panel */}
      {showAdvancedFilters && (
        <div className="p-5 rounded-2xl glass-panel space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
              <Search className="w-4 h-4 text-brand-cyan" />
              数据多维筛选器
            </h3>
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-brand-rose transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              恢复本财年默认范围
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
            <div>
              <label className="text-slate-500 block mb-1 font-medium">开始日期</label>
              <input
                type="date"
                value={filterStartDate}
                onChange={(e) => setFilterStartDate(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="text-slate-500 block mb-1 font-medium">结束日期</label>
              <input
                type="date"
                value={filterEndDate}
                onChange={(e) => setFilterEndDate(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="text-slate-500 block mb-1 font-medium">客户档案</label>
              <CustomerSelect
                value={filterCustomer}
                onChange={setFilterCustomer}
                customers={customers.filter((customer) => customerOptions.includes(customer.name))}
                valueMode="name"
                allOption={{ value: 'all', label: '全部客户' }}
                ariaLabel="筛选客户档案"
                searchPlaceholder="输入客户名称筛选"
                emptyMessage="没有匹配的已有客户"
                size="sm"
              />
            </div>
            <div>
              <label className="text-slate-500 block mb-1 font-medium">出口国家</label>
              <SearchableCombobox
                value={filterCountry}
                onChange={setFilterCountry}
                options={[
                  { value: 'all', label: '全部国家' },
                  ...countryOptions.map(country => ({ value: country, label: country }))
                ]}
                ariaLabel="筛选出口国家"
                searchPlaceholder="输入国家名称筛选"
                emptyMessage="没有匹配的已有国家"
                size="sm"
              />
            </div>
            <div>
              <label className="text-slate-500 block mb-1 font-medium">产品名称</label>
              <SearchableCombobox
                value={filterProduct}
                onChange={setFilterProduct}
                options={[
                  { value: 'all', label: '全部产品' },
                  ...productOptions.map(product => ({ value: product, label: product }))
                ]}
                ariaLabel="筛选产品名称"
                searchPlaceholder="输入产品名称筛选"
                emptyMessage="没有匹配的已有产品"
                size="sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs pt-1">
            <div>
              <label className="text-slate-500 block mb-1 font-medium">物料号</label>
              <input
                type="text"
                placeholder="搜索物料号..."
                value={filterMaterialNo}
                onChange={(e) => setFilterMaterialNo(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="text-slate-500 block mb-1 font-medium">合同编号</label>
              <input
                type="text"
                placeholder="搜索合同号..."
                value={filterContractNo}
                onChange={(e) => setFilterContractNo(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="text-slate-500 block mb-1 font-medium">联系单号</label>
              <input
                type="text"
                placeholder="搜索联系单号..."
                value={filterSheetNo}
                onChange={(e) => setFilterSheetNo(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="text-slate-500 block mb-1 font-medium">出口类型</label>
              <select
                value={filterExportType}
                onChange={(e) => setFilterExportType(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-300 text-sm"
              >
                <option value="all">全部类型</option>
                <option value="自营">自营</option>
                <option value="转口">转口</option>
              </select>
            </div>
            <div>
              <label className="text-slate-500 block mb-1 font-medium">联系单状态</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2 text-slate-300 text-sm"
              >
                <option value="all">全部状态</option>
                <option value="pending_no">待填写联系单号</option>
                <option value="pending_qa">待 QA 审批</option>
                <option value="pending_aps">待排产</option>
                <option value="scheduled">已排产待入库</option>
                <option value="warehoused">已入库待放行</option>
                <option value="ready">可发货</option>
                <option value="partial">部分发货</option>
                <option value="shipped">发货完成</option>
              </select>
            </div>
          </div>
        </div>
      )}
      {/* Single Client / Product Analysis Banner */}
      {singleClientAnalysis.active && (
        <div className="p-5 rounded-2xl bg-brand-cyan/5 border border-brand-cyan/15 flex flex-col md:flex-row justify-between gap-4">
          <div>
            <span className="text-[10px] text-brand-cyan font-bold tracking-wider block uppercase">单客户深度价值洞察</span>
            <h4 className="text-lg font-bold text-white font-heading mt-0.5">{singleClientAnalysis.name}</h4>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-xs text-slate-400">
            <div>
              合同总额: <span className="font-bold text-white text-sm block">{formatAnalyticsValue(singleClientAnalysis.totalContractAmt, 'contract_amount')}</span>
            </div>
            <div>
              已回款项: <span className="font-bold text-brand-emerald text-sm block">{formatAnalyticsValue(singleClientAnalysis.totalPaidAmt, 'payment_amount')}</span>
            </div>
            <div>
              毛利贡献: <span className="font-bold text-brand-amber text-sm block">{formatAnalyticsValue(singleClientAnalysis.totalProfitAmt, 'profit')}</span>
            </div>
            <div>
              合同数 / 联系单: <span className="font-bold text-white text-sm block">{singleClientAnalysis.contractCount} 份 / {singleClientAnalysis.sheetCount} 张</span>
            </div>
          </div>
        </div>
      )}

      {singleProductAnalysis.active && (
        <div className="p-5 rounded-2xl bg-brand-blue/5 border border-brand-blue/15 flex flex-col md:flex-row justify-between gap-4">
          <div>
            <span className="text-[10px] text-brand-blue font-bold tracking-wider block uppercase">单产品利润贡献分析</span>
            <h4 className="text-lg font-bold text-white font-heading mt-0.5">{singleProductAnalysis.name}</h4>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-xs text-slate-400">
            <div>
              筛选范围销售额: <span className="font-bold text-white text-sm block">{formatAnalyticsValue(singleProductAnalysis.totalSalesAmt, 'contract_amount')}</span>
            </div>
            <div>
              已开票毛利: <span className="font-bold text-brand-emerald text-sm block">{formatAnalyticsValue(singleProductAnalysis.totalProfitAmt, 'profit')}</span>
            </div>
            <div>
              总订货量: <span className="font-bold text-white text-sm block">{singleProductAnalysis.qtyCount.toLocaleString()} {singleProductAnalysis.unit}</span>
            </div>
            <div>
              涉及联系单张数: <span className="font-bold text-white text-sm block">{singleProductAnalysis.sheetCount} 张</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. Configuration & Settings Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Metric Selector Box */}
        <div className="rounded-2xl glass-panel space-y-3 p-4">
          <h3 className="text-sm font-semibold text-white">① 选择分析指标 (支持多选)</h3>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {[
              { id: 'contract_amount', label: '合同金额' },
              { id: 'shipment_amount', label: '发货金额' },
              { id: 'payment_amount', label: '回款金额' },
              { id: 'unpaid_amount', label: '当前应收（已发货未收款）' },
              { id: 'invoice_amount', label: '开票金额' },
              { id: 'profit', label: '利润额' },
              { id: 'gross_margin', label: '产品毛利率 (%)' },
              { id: 'contract_count', label: '合同数量 (份)' },
              { id: 'sheet_count', label: '联系单数量 (张)' },
              { id: 'shipment_count', label: '发货批次 (批)' },
              { id: 'alert_count', label: '未处理风险订单数' }
            ].map(m => {
              const active = selectedMetrics.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => toggleMetric(m.id)}
                  className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border p-2 text-left font-medium transition-all ${
                    active
                      ? 'bg-brand-cyan/15 border-brand-cyan/20 text-brand-cyan'
                      : 'bg-slate-800 border-white/[0.04] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span>{m.label}</span>
                  {active && <CheckCircle className="w-3.5 h-3.5 text-brand-cyan" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dimension, Chart Type & Main Chart Display Area */}
        <div className="lg:col-span-2 rounded-2xl glass-panel flex flex-col justify-between gap-3 p-4">
          <div className="flex flex-1 flex-col space-y-3">
            {/* Header controls and actions */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/[0.04] pb-3 gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">② 分析维度、统计口径与主图表</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">即时分析统计数据并导出</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleExportSVG}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold border border-white/[0.04] text-xs transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  导出 SVG
                </button>
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold border border-white/[0.04] text-xs transition-colors"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  导出 CSV
                </button>
              </div>
            </div>

            {/* Inputs: Dimension + Currency Mode */}
            <div className="grid grid-cols-1 gap-3 pt-1 text-xs md:grid-cols-3">
              <div>
                <label className="text-slate-500 block mb-1">统计分组维度</label>
                <select
                  value={selectedDimension}
                  onChange={(e) => {
                    setSelectedDimension(e.target.value);
                    setSelectedGroup(null);
                    setSelectedDrillMetric(null);
                  }}
                  className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2.5 text-slate-300 text-sm font-medium"
                >
                  <option value="month">按月份统计</option>
                  <option value="quarter">按季度统计</option>
                  <option value="year">按年度统计</option>
                  <option value="customer">按客户排名</option>
                  <option value="country">按国家/市场占比</option>
                  <option value="product">按产品销售额排名</option>
                  <option value="material">按物料编号统计</option>
                  <option value="export_type">按出口类型统计 (自营/转口)</option>
                  <option value="status">按订单生命周期状态</option>
                </select>
              </div>

              <div>
                <label className="text-slate-500 block mb-1 font-medium">时间观察视角</label>
                <select
                  value={timePerspective}
                  onChange={(event) => {
                    setTimePerspective(event.target.value as 'event' | 'contract');
                    setSelectedGroup(null);
                    setSelectedDrillMetric(null);
                  }}
                  className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2.5 text-slate-300 text-sm font-medium"
                >
                  <option value="event">按业务发生日（默认）</option>
                  <option value="contract">按合同签约批次</option>
                </select>
              </div>

              <div>
                <label className="text-slate-500 block mb-1 font-medium">金额统计口径</label>
                <div className="bg-slate-800 px-3 py-2.5 border border-white/[0.06] rounded-lg text-brand-cyan font-bold">
                  统一折算人民币；坐标轴与悬浮提示用万元，明细显示整数元
                </div>
              </div>
            </div>

            {/* Chart Type selection */}
            <div>
              <label className="text-slate-500 block mb-2 text-xs font-medium">③ 选择展示图表形态</label>
              <div className="grid grid-cols-5 gap-2 text-xs">
                {[
                  { id: 'composed', label: '多维组合图' },
                  { id: 'line', label: '趋势折线图' },
                  { id: 'bar', label: '对比柱状图' },
                  { id: 'pie', label: '占比饼图' },
                  { id: 'stacked', label: '堆叠柱状图' }
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => {
                      if (t.id === 'stacked' && selectedMetricUnits.length > 1) {
                        notify({
                          title: '不同单位不能使用堆叠图',
                          message: '请只保留同一单位的指标，或继续使用组合图和对比柱状图。',
                          tone: 'warning'
                        });
                        return;
                      }
                      setChartType(t.id);
                    }}
                    className={`rounded-xl border px-1.5 py-2 text-center font-bold transition-all ${
                      chartType === t.id
                        ? 'bg-slate-900 border-brand-cyan text-brand-cyan shadow-lg shadow-brand-cyan/5'
                        : 'bg-slate-800 border-white/[0.04] text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <span className="block text-[11px]">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* The Actual Chart */}
            <div id="analytics-chart-container" className="my-1 h-[300px] w-full rounded-xl border border-white/[0.04] bg-white/[0.01] p-1 text-xs">
              {aggregatedChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'line' ? (
                    <LineChart data={aggregatedChartData} margin={{ top: 15, right: 15, left: -10, bottom: 5 }}>
                      <XAxis dataKey="name" stroke="#64748b" />
                      {renderAnalyticsAxes()}
                      <Tooltip
                        cursor={false}
                        formatter={tooltipFormatter}
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: 'rgba(143,123,102,0.15)', borderRadius: 8 }}
                        labelStyle={{ color: '#2b261f', fontWeight: 'bold' }}
                        itemStyle={{ color: '#2d2922' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: 10 }} />
                      {selectedMetrics.map((m, idx) => (
                        <Line
                          key={m}
                          type="monotone"
                          dataKey={m}
                          name={getAnalyticsMetricLabel(m)}
                          yAxisId={getAnalyticsMetricUnit(m)}
                          stroke={COLORS[idx % COLORS.length]}
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6, onClick: (props: any) => handleChartDrill(props?.payload?.name, m) }}
                        />
                      ))}
                    </LineChart>
                  ) : chartType === 'bar' ? (
                    <BarChart data={aggregatedChartData} margin={{ top: 15, right: 15, left: -10, bottom: 5 }}>
                      <XAxis dataKey="name" stroke="#64748b" />
                      {renderAnalyticsAxes()}
                      <Tooltip
                        cursor={false}
                        formatter={tooltipFormatter}
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: 'rgba(143,123,102,0.15)', borderRadius: 8 }}
                        labelStyle={{ color: '#2b261f', fontWeight: 'bold' }}
                        itemStyle={{ color: '#2d2922' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: 10 }} />
                      {selectedMetrics.map((m, idx) => (
                        <Bar
                          key={m}
                          dataKey={m}
                          name={getAnalyticsMetricLabel(m)}
                          yAxisId={getAnalyticsMetricUnit(m)}
                          fill={COLORS[idx % COLORS.length]}
                          radius={[4, 4, 0, 0]}
                          onClick={(data: any) => handleChartDrill(data.name, m)}
                          className="cursor-pointer"
                        />
                      ))}
                    </BarChart>
                  ) : chartType === 'pie' ? (
                    <PieChart>
                      <Pie
                        data={pieChartData}
                        cx="50%"
                        cy="50%"
                        outerRadius={85}
                        innerRadius={55}
                        paddingAngle={4}
                        dataKey={selectedMetrics[0] || 'contract_amount'}
                        nameKey="name"
                        label={(entry) => `${entry.name}`}
                        onClick={(data: any) => handleChartDrill(data?.name, selectedMetrics[0] || 'contract_amount')}
                      >
                        {pieChartData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} className="cursor-pointer" />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={tooltipFormatter}
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: 'rgba(143,123,102,0.15)', borderRadius: 8 }}
                        itemStyle={{ color: '#2d2922' }}
                      />
                      <Legend layout="horizontal" align="center" verticalAlign="bottom" iconSize={8} iconType="circle" />
                    </PieChart>
                  ) : chartType === 'stacked' ? (
                    <BarChart data={aggregatedChartData} margin={{ top: 15, right: 15, left: -10, bottom: 5 }}>
                      <XAxis dataKey="name" stroke="#64748b" />
                      {renderAnalyticsAxes()}
                      <Tooltip
                        cursor={false}
                        formatter={tooltipFormatter}
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: 'rgba(143,123,102,0.15)', borderRadius: 8 }}
                        labelStyle={{ color: '#2b261f', fontWeight: 'bold' }}
                        itemStyle={{ color: '#2d2922' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: 10 }} />
                      {selectedMetrics.map((m, idx) => (
                        <Bar
                          key={m}
                          dataKey={m}
                          name={getAnalyticsMetricLabel(m)}
                          yAxisId={getAnalyticsMetricUnit(m)}
                          stackId="a"
                          fill={COLORS[idx % COLORS.length]}
                          onClick={(data: any) => handleChartDrill(data.name, m)}
                          className="cursor-pointer"
                        />
                      ))}
                    </BarChart>
                  ) : (
                    // Composed Chart
                    <ComposedChart data={aggregatedChartData} margin={{ top: 15, right: 15, left: -10, bottom: 5 }}>
                      <XAxis dataKey="name" stroke="#64748b" />
                      {renderAnalyticsAxes()}
                      <Tooltip
                        cursor={false}
                        formatter={tooltipFormatter}
                        contentStyle={{ backgroundColor: '#ffffff', borderColor: 'rgba(143,123,102,0.15)', borderRadius: 8 }}
                        labelStyle={{ color: '#2b261f', fontWeight: 'bold' }}
                        itemStyle={{ color: '#2d2922' }}
                      />
                      <Legend iconType="circle" wrapperStyle={{ paddingTop: 10 }} />
                      {selectedMetrics.slice(0, 1).map((m) => (
                        <Bar
                          key={m}
                          dataKey={m}
                          name={getAnalyticsMetricLabel(m)}
                          yAxisId={getAnalyticsMetricUnit(m)}
                          fill="#b08956"
                          radius={[4, 4, 0, 0]}
                          onClick={(data: any) => handleChartDrill(data.name, m)}
                          className="cursor-pointer"
                        />
                      ))}
                      {selectedMetrics.slice(1).map((m, idx) => (
                        <Line
                          key={m}
                          type="monotone"
                          dataKey={m}
                          name={getAnalyticsMetricLabel(m)}
                          yAxisId={getAnalyticsMetricUnit(m)}
                          stroke={COLORS[(idx + 2) % COLORS.length]}
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          activeDot={{ r: 6, onClick: (props: any) => handleChartDrill(props?.payload?.name, m) }}
                        />
                      ))}
                    </ComposedChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <BarChart3 className="h-7 w-7 text-subtle" />
                  <div className="mt-3 text-sm font-semibold text-body">当前条件下没有可绘制的数据</div>
                  <div className="mt-1 max-w-md text-xs leading-6 text-muted">
                    {hasActiveFilters ? '可以恢复本财年默认范围，或改用更宽的日期、客户和产品范围。' : '本财年暂时没有可绘制的数据。'}
                  </div>
                  {hasActiveFilters && <Button onClick={handleResetFilters} tone="secondary" size="sm" className="mt-4" icon={<RotateCcw className="h-3.5 w-3.5" />}>恢复本财年默认范围</Button>}
                </div>
              )}
            </div>
          </div>

          {/* Drill-down Instructions */}
          <div className="p-3.5 rounded-xl bg-white/[0.01] border border-white/[0.04] text-[10px] text-slate-500 leading-normal flex items-start gap-2">
            <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-cyan" />
            <span className="font-semibold text-slate-400 whitespace-nowrap block">下钻说明:</span>
            <span>点击具体指标对应的柱体、折线圆点或饼图扇区，下方会按该指标的真实业务日期展示对应合同、发货、收款、发票、利润或提醒记录。</span>
          </div>
        </div>
      </div>

      {contributionInsights && (
        <section className="rounded-2xl glass-panel p-4" aria-labelledby="concentration-heading">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 id="concentration-heading" className="text-sm font-semibold text-ink">贡献集中度</h3>
              <p className="mt-0.5 text-[11px] text-muted">观察头部客户、市场或产品是否过度集中；占比饼图固定显示 Top 5，其余合并为“其他”。</p>
            </div>
            <span className="text-[10px] text-subtle">毛利集中度仅按正毛利贡献计算，亏损项不用于占比分母</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              { title: `${getAnalyticsMetricLabel(contributionInsights.scale.metric)}集中度`, data: contributionInsights.scale, tone: 'text-brand-cyan' },
              { title: '已确认正毛利集中度', data: contributionInsights.profit, tone: 'text-brand-amber' }
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-border bg-surface-muted/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-body">{item.title}</span>
                  <span className="text-[10px] text-muted">{item.data.positiveGroupCount} 个正向贡献分组</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    ['Top 1', item.data.top1],
                    ['Top 3', item.data.top3],
                    ['Top 5', item.data.top5]
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-lg bg-surface px-2 py-2">
                      <div className="text-[10px] text-muted">{label}</div>
                      <div className={`mt-1 text-sm font-extrabold ${item.tone}`}>{Number(value).toFixed(1)}%</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. Drill Down Table Section */}
      <div className="p-5 rounded-2xl glass-panel space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-brand-cyan" />
            数据明细下钻区
            {selectedGroup && (
              <span className="text-xs bg-brand-cyan/15 text-brand-cyan px-2 py-0.5 rounded font-medium border border-brand-cyan/20">
                {selectedDrillMetric ? getAnalyticsMetricLabel(selectedDrillMetric) : '指标'} · {selectedGroup}
              </span>
            )}
          </h3>
          {selectedGroup && (
            <button
              onClick={() => {
                setSelectedGroup(null);
                setSelectedDrillMetric(null);
              }}
              className="text-[10px] text-brand-rose hover:underline"
            >
              清除下钻条件，显示所有明细
            </button>
          )}
        </div>

        {selectedGroup ? (
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.06] text-slate-500">
                  <th className="py-2.5 font-medium">来源</th>
                  <th className="py-2.5 font-medium">单据号</th>
                  <th className="py-2.5 font-medium">业务日期</th>
                  <th className="py-2.5 font-medium">客户 / 合同</th>
                  <th className="py-2.5 font-medium">产品 / 物料</th>
                  <th className="py-2.5 font-medium">指标值</th>
                  <th className="py-2.5 font-medium">状态</th>
                  <th className="py-2.5 font-medium">说明</th>
                </tr>
              </thead>
              <tbody>
                {drillDownDetails.length > 0 ? (
                  drillPage.rows.map((item) => (
                    <tr key={item.id} className="border-b border-white/[0.04] text-slate-300 hover:bg-white/[0.01] transition-colors">
                      <td className="py-3"><span className="rounded-md border border-border bg-surface-muted px-2 py-1 text-[10px] font-semibold text-body">{item.sourceType}</span></td>
                      <td className="py-3 font-semibold text-white">{item.documentNo}</td>
                      <td className="py-3 text-slate-400">{item.businessDate || '未填写'}</td>
                      <td className="py-3">
                        <span className="block font-medium text-slate-200">{item.customerName}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">{item.contractNo}</span>
                      </td>
                      <td className="py-3">{item.productMaterial}</td>
                      <td className="py-3 font-semibold text-brand-cyan">
                        {item.amountRmb === null || !selectedDrillMetric ? '—' : formatAnalyticsValue(item.amountRmb, selectedDrillMetric)}
                      </td>
                      <td className="py-3"><span className="rounded-md bg-brand-amber/10 px-2 py-1 text-[10px] font-semibold text-brand-amber">{item.status || '—'}</span></td>
                      <td className="max-w-64 py-3 text-[10px] leading-5 text-slate-500">{item.note || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">分类下暂无匹配记录</td>
                  </tr>
                )}
              </tbody>
            </table>
            <PaginationControls
              {...drillPage}
              onPageChange={drillPage.setPage}
              itemLabel="条下钻明细"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-surface-muted/25 px-6 py-12 text-center">
            <MousePointerClick className="h-6 w-6 text-subtle" />
            <div className="mt-3 text-sm font-semibold text-body">点击图表开始下钻</div>
            <div className="mt-1 max-w-lg text-xs leading-6 text-muted">点击具体指标图形后，这里会切换成该指标对应的真实业务明细。</div>
          </div>
        )}
      </div>

      {/* Save Template Modal */}
      {showSaveTemplateModal && (
        <Dialog onClose={() => setShowSaveTemplateModal(false)} ariaLabel="保存当前分析配置为模板">
          <div className="dialog-panel w-full max-w-md p-6 space-y-4">
            <h4 className="text-sm font-bold text-white">保存当前分析配置为模板</h4>
            <div className="space-y-1 text-xs">
              <label className="text-slate-500 font-medium">模板名称</label>
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="例如：南美市场合同回款分析..."
                className="w-full bg-slate-800 border border-white/[0.06] rounded-lg px-2.5 py-2.5 text-slate-300 text-sm font-semibold"
              />
            </div>
            {templateError && (
              <div role="alert" className="rounded-lg border border-brand-rose/25 bg-brand-rose/10 px-3 py-2 text-xs text-brand-rose">
                保存失败：{templateError}
              </div>
            )}
            <div className="flex gap-2 justify-end text-xs pt-2">
              <Button
                onClick={() => setShowSaveTemplateModal(false)}
                disabled={isSavingTemplate}
                tone="secondary"
              >
                取消
              </Button>
              <Button
                onClick={() => void handleSaveTemplate()}
                disabled={isSavingTemplate || !newTemplateName.trim()}
              >
                {isSavingTemplate ? '保存中' : '确认保存'}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
