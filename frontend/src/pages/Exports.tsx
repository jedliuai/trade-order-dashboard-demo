import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../services/dataStore';
import { IS_PUBLIC_DEMO } from '../services/localClient';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, FolderDown, RefreshCw } from 'lucide-react';
import { formatLocalDate } from '../services/dateUtils';
import { PageHeader } from '../components/PageHeader';
import { useFeedback } from '../components/FeedbackProvider';
import { StatusBadge } from '../components/StatusBadge';
import { findMissingMaterialNumberSheets, summarizeMissingMaterialNumbers } from '../services/materialNumberRules';

interface ExportsProps {
  onRefreshTrigger: number;
}

interface ExportFeedback {
  type: string;
  status: 'working' | 'success' | 'error';
  title: string;
  detail: string;
  fileName?: string;
}

const exportNames: Record<string, string> = {
  coordination: '生产协调表',
  releaseApplication: '出口产品放行申请信息统计表',
  monthly: '订单月度汇总表',
  originalContracts: '正本合同统计表',
  customerMonthlySales: '客户实际销售、回款及应收汇总',
  invoices: '人民币开票申请表',
  usdActualInvoice: '美金实际开票',
  expectedInvoice: '预计开票',
  shipmentDetails: '全部发货明细'
};

function currentMonthRange() {
  const now = new Date();
  return {
    dateFrom: formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    dateTo: formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  };
}

export const Exports: React.FC<ExportsProps> = ({ onRefreshTrigger }) => {
  const { notify } = useFeedback();
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<ExportFeedback | null>(null);

  const initialMonthRange = useMemo(() => currentMonthRange(), []);
  const [dateFrom, setDateFrom] = useState(initialMonthRange.dateFrom);
  const [dateTo, setDateTo] = useState(initialMonthRange.dateTo);
  const [invoiceDateFrom, setInvoiceDateFrom] = useState(initialMonthRange.dateFrom);
  const [invoiceDateTo, setInvoiceDateTo] = useState(formatLocalDate());
  const [invoiceRateMonth, setInvoiceRateMonth] = useState(formatLocalDate().slice(0, 7));
  const [selectedCoordinationIds, setSelectedCoordinationIds] = useState<string[]>([]);
  const [selectedReleaseIds, setSelectedReleaseIds] = useState<string[]>([]);

  const coordinationCandidates = useMemo(() => {
    void onRefreshTrigger;
    return db.getContactSheets()
      .filter(sheet => Boolean(sheet.qa_approval_date) && !sheet.actual_warehousing_date)
      .sort((left, right) => {
        const byApproval = String(right.qa_approval_date || '').localeCompare(String(left.qa_approval_date || ''));
        return byApproval || String(left.contact_sheet_no || '').localeCompare(
          String(right.contact_sheet_no || ''),
          'zh-CN',
          { numeric: true }
        );
      });
  }, [onRefreshTrigger]);

  const releaseCandidates = useMemo(() => {
    void onRefreshTrigger;
    return db.getContactSheets()
      .filter(sheet => Boolean(sheet.actual_warehousing_date) && !sheet.actual_release_date)
      .sort((left, right) => {
        const byInbound = String(right.actual_warehousing_date || '').localeCompare(
          String(left.actual_warehousing_date || '')
        );
        return byInbound || String(left.contact_sheet_no || '').localeCompare(
          String(right.contact_sheet_no || ''),
          'zh-CN',
          { numeric: true }
        );
      });
  }, [onRefreshTrigger]);

  useEffect(() => {
    const eligibleIds = new Set(coordinationCandidates.map(sheet => sheet.id));
    setSelectedCoordinationIds(current => current.filter(id => eligibleIds.has(id)));
  }, [coordinationCandidates]);

  useEffect(() => {
    const eligibleIds = new Set(releaseCandidates.map(sheet => sheet.id));
    setSelectedReleaseIds(current => current.filter(id => eligibleIds.has(id)));
  }, [releaseCandidates]);

  const blockExportForMissingMaterials = (contactSheetIds: string[], documentName: string) => {
    const missingSheets = findMissingMaterialNumberSheets(db.getContactSheets(), contactSheetIds);
    if (missingSheets.length === 0) return false;
    notify({
      title: '请先补齐物料号',
      message: `${documentName}属于正式业务文件，以下联系单尚未填写物料号：${summarizeMissingMaterialNumbers(missingSheets)}。`,
      tone: 'warning',
      duration: 8000
    });
    return true;
  };

  const runWorkerExcelExport = async (
    type: string,
    command: 'export-production' | 'export-release-application' | 'export-monthly' | 'export-original-contracts' | 'export-helper' | 'export-customer-monthly-sales' | 'export-rmb-invoice' | 'export-usd-actual-invoice' | 'export-expected-invoice' | 'export-shipment-details',
    filters?: Record<string, string | string[]>
  ) => {
    setExportingType(type);
    const exportName = exportNames[type] || 'Excel 报表';
    setLastExport({ type, status: 'working', title: `${exportName}正在生成`, detail: '正在读取本地 SQLite 数据并生成文件。' });
    try {
      const result = await db.runWorkerExport(command, filters) as { stdout?: string; download_name?: string };
      const detail = result?.stdout || command;
      let logWarning = '';
      try {
        await db.addSyncLog({
          sync_type: 'export',
          status: 'success',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          message: `标准 Excel 导出已生成：${detail}`
        });
      } catch (error) {
        logWarning = `\n但同步日志保存失败：${error instanceof Error ? error.message : String(error)}`;
      }
      notify({
        title: '标准 Excel 已生成',
        message: `文件已开始下载。\n${detail}${logWarning}`,
        tone: logWarning ? 'warning' : 'success',
        duration: 8000
      });
      setLastExport({
        type,
        status: 'success',
        title: `${exportName}已生成并触发下载`,
        detail,
        fileName: result.download_name || `${exportName}.xlsx`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let logWarning = '';
      try {
        await db.addSyncLog({
          sync_type: 'export',
          status: 'failed',
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          message: `标准 Excel 导出失败：${message}`
        });
      } catch (logError) {
        logWarning = `\n失败日志也未能保存：${logError instanceof Error ? logError.message : String(logError)}`;
      }
      notify({ title: '标准 Excel 导出失败', message: `${message}${logWarning}`, tone: 'error', duration: 9000 });
      setLastExport({ type, status: 'error', title: `${exportName}导出失败`, detail: `${message}${logWarning}` });
    } finally {
      setExportingType(null);
    }
  };

  // Export 1: 生产协调导出
  const handleExportCoordination = () => {
    if (!selectedCoordinationIds.length) {
      notify({ title: '尚未选择联系单', message: '请至少勾选一条 QA 已审批且尚未实际入库的联系单。', tone: 'warning' });
      return;
    }
    if (blockExportForMissingMaterials(selectedCoordinationIds, '生产协调表')) return;
    void runWorkerExcelExport('coordination', 'export-production', { contact_sheet_ids: selectedCoordinationIds });
  };

  const handleExportReleaseApplication = () => {
    if (!selectedReleaseIds.length) {
      notify({ title: '尚未选择联系单', message: '请至少勾选一条已经实际生产入库且尚未放行的联系单。', tone: 'warning' });
      return;
    }
    if (blockExportForMissingMaterials(selectedReleaseIds, '出口产品放行申请信息统计表')) return;
    void runWorkerExcelExport(
      'releaseApplication',
      'export-release-application',
      { contact_sheet_ids: selectedReleaseIds }
    );
  };

  const validateContractDateRange = () => {
    if (!dateFrom || !dateTo) {
      notify({ title: '日期范围不完整', message: '请选择合同签署日期的起始日期和截止日期。', tone: 'warning' });
      return false;
    }
    if (dateFrom > dateTo) {
      notify({ title: '日期范围有误', message: '起始日期不能晚于截止日期。', tone: 'warning' });
      return false;
    }
    return true;
  };

  const handleExportMonthly = () => {
    if (!validateContractDateRange()) return;
    void runWorkerExcelExport('monthly', 'export-monthly', { date_from: dateFrom, date_to: dateTo });
  };

  const handleExportOriginalContracts = () => {
    if (!validateContractDateRange()) return;
    void runWorkerExcelExport(
      'originalContracts',
      'export-original-contracts',
      { date_from: dateFrom, date_to: dateTo }
    );
  };

  // Export 5: 人民币开票申请导出
  const handleExportInvoices = () => {
    void runWorkerExcelExport('invoices', 'export-rmb-invoice');
  };

  const handleExportCustomerMonthlySales = () => {
    void runWorkerExcelExport(
      'customerMonthlySales',
      'export-customer-monthly-sales',
      { as_of_date: formatLocalDate() }
    );
  };

  const handleExportShipmentDetails = () => {
    const shippedIds = new Set(db.getShipments().filter(shipment => shipment.status === '已发货').map(shipment => shipment.id));
    const contactSheetIds = db.getTable<any>('trade_shipment_items')
      .filter(item => shippedIds.has(item.shipment_id))
      .map(item => item.contact_sheet_id);
    if (blockExportForMissingMaterials(contactSheetIds, '全部发货明细')) return;
    void runWorkerExcelExport('shipmentDetails', 'export-shipment-details');
  };

  const validateInvoiceExportFilters = () => {
    if (!invoiceDateFrom || !invoiceDateTo || !invoiceRateMonth) {
      notify({ title: '筛选条件不完整', message: '请选择发货记录创建日期和汇率月份。', tone: 'warning' });
      return false;
    }
    if (invoiceDateFrom > invoiceDateTo) {
      notify({ title: '日期范围有误', message: '起始日期不能晚于截止日期。', tone: 'warning' });
      return false;
    }
    return true;
  };

  const handleInvoiceExport = (type: 'usdActualInvoice' | 'expectedInvoice') => {
    if (!validateInvoiceExportFilters()) return;
    void runWorkerExcelExport(
      type,
      type === 'usdActualInvoice' ? 'export-usd-actual-invoice' : 'export-expected-invoice',
      { date_from: invoiceDateFrom, date_to: invoiceDateTo, rate_month: invoiceRateMonth }
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="导出与报表中心"
        description="导出生产协调、订单统计、正本合同、客户销售回款及人民币开票等 Excel 数据表"
      />

      {lastExport && (
        <div
          aria-live="polite"
          className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-start ${
            lastExport.status === 'success'
              ? 'border-brand-emerald/25 bg-brand-emerald/[0.06]'
              : lastExport.status === 'error'
                ? 'border-brand-rose/25 bg-brand-rose/[0.06]'
                : 'border-brand-cyan/25 bg-brand-cyan/[0.06]'
          }`}
        >
          {lastExport.status === 'success' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-emerald" /> : lastExport.status === 'error' ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-brand-rose" /> : <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-brand-cyan" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-ink">{lastExport.title}</span>
              <StatusBadge tone={lastExport.status === 'success' ? 'success' : lastExport.status === 'error' ? 'danger' : 'progress'}>
                {lastExport.status === 'success' ? '已下载' : lastExport.status === 'error' ? '需要处理' : '生成中'}
              </StatusBadge>
            </div>
            {lastExport.fileName && <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-body"><FolderDown className="h-3.5 w-3.5 text-brand-cyan" />浏览器下载文件：{lastExport.fileName}</div>}
            <div className="mt-1 whitespace-pre-wrap break-all text-[11px] leading-5 text-muted">{lastExport.detail}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 text-xs md:grid-cols-2">

        {/* Card 1: 生产协调导出 */}
        <div className="glass-panel flex min-h-52 flex-col justify-between space-y-4 rounded-2xl p-5 md:col-span-2">
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
              <FileSpreadsheet className="w-4 h-4 text-brand-cyan" />
              1. 生产协调与催包材统计导出
            </h3>
            <p className="text-[11px] leading-relaxed text-muted">
              仅列出<strong>QA 已审批但尚未实际生产入库</strong>的联系单。请手动勾选本次需要协调的项目后导出。
            </p>
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                <span className="font-semibold text-body">
                  可选 {coordinationCandidates.length} 条，已选 {selectedCoordinationIds.length} 条
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedCoordinationIds(coordinationCandidates.map(sheet => sheet.id))}
                    disabled={!coordinationCandidates.length}
                    className="rounded-lg border border-border px-2.5 py-1.5 font-semibold text-body hover:bg-surface-muted disabled:opacity-40"
                  >
                    一键全选
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCoordinationIds([])}
                    disabled={!selectedCoordinationIds.length}
                    className="rounded-lg border border-border px-2.5 py-1.5 font-semibold text-muted hover:bg-surface-muted disabled:opacity-40"
                  >
                    取消全选
                  </button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {coordinationCandidates.length ? coordinationCandidates.map(sheet => {
                  const checked = selectedCoordinationIds.includes(sheet.id);
                  return (
                    <label
                      key={sheet.id}
                      className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-border/70 px-3 py-2.5 last:border-b-0 hover:bg-surface-muted/70"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedCoordinationIds(current => (
                          checked ? current.filter(id => id !== sheet.id) : [...current, sheet.id]
                        ))}
                        className="mt-0.5 h-4 w-4 accent-brand-amber"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
                          <span>{sheet.contact_sheet_no || '联系单号未填写'}</span>
                          <span className="font-normal text-muted">合同 {sheet.contract_no}</span>
                          <span className="font-normal text-muted">QA {String(sheet.qa_approval_date).slice(0, 10)}</span>
                          {!String(sheet.material_no || '').trim() && (
                            <span className="rounded bg-brand-amber/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-amber">
                              待补物料号
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {sheet.product_name} · {sheet.specification || '规格未填写'} · {sheet.customer_name}
                        </span>
                      </span>
                    </label>
                  );
                }) : (
                  <div className="px-4 py-8 text-center text-muted">
                    当前没有“QA 已审批且尚未实际入库”的联系单。
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={handleExportCoordination}
            disabled={!!exportingType || !selectedCoordinationIds.length}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 hover:from-cyan-500/20 hover:to-blue-500/20 text-brand-cyan border border-brand-cyan/20 transition-all font-semibold disabled:opacity-40"
          >
            {exportingType === 'coordination' ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>正在生成数据...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>导出生产协调表 (Excel)</span>
              </>
            )}
          </button>
        </div>

        {/* Card 2: 出口产品放行申请 */}
        <div className="glass-panel flex min-h-52 flex-col justify-between space-y-4 rounded-2xl p-5 md:col-span-2">
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
              <FileSpreadsheet className="h-4 w-4 text-brand-amber" />
              2. 出口产品放行申请信息统计导出
            </h3>
            <p className="text-[11px] leading-relaxed text-muted">
              {IS_PUBLIC_DEMO && <span>此新版报表请在本地版生成。 </span>}仅列出<strong>已经实际生产入库但尚未放行</strong>的联系单。未关联包装模板的联系单仍可导出，生产车间留空后可在 Excel 中手填。
            </p>
            <div className="mt-4 overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                <span className="font-semibold text-body">
                  可选 {releaseCandidates.length} 条，已选 {selectedReleaseIds.length} 条
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedReleaseIds(releaseCandidates.map(sheet => sheet.id))}
                    disabled={!releaseCandidates.length}
                    className="rounded-lg border border-border px-2.5 py-1.5 font-semibold text-body hover:bg-surface-muted disabled:opacity-40"
                  >
                    一键全选
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedReleaseIds([])}
                    disabled={!selectedReleaseIds.length}
                    className="rounded-lg border border-border px-2.5 py-1.5 font-semibold text-muted hover:bg-surface-muted disabled:opacity-40"
                  >
                    取消全选
                  </button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {releaseCandidates.length ? releaseCandidates.map(sheet => {
                  const checked = selectedReleaseIds.includes(sheet.id);
                  return (
                    <label
                      key={sheet.id}
                      className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 border-b border-border/70 px-3 py-2.5 last:border-b-0 hover:bg-surface-muted/70"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedReleaseIds(current => (
                          checked ? current.filter(id => id !== sheet.id) : [...current, sheet.id]
                        ))}
                        className="mt-0.5 h-4 w-4 accent-brand-amber"
                      />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-ink">
                          <span>{sheet.contact_sheet_no || '联系单号未填写'}</span>
                          <span className="font-normal text-muted">合同 {sheet.contract_no}</span>
                          <span className="font-normal text-muted">入库 {String(sheet.actual_warehousing_date).slice(0, 10)}</span>
                          {!String(sheet.material_no || '').trim() && (
                            <span className="rounded bg-brand-amber/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-amber">
                              待补物料号
                            </span>
                          )}
                          {!sheet.packaging_profile_version_id && (
                            <span className="rounded bg-brand-amber/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand-amber">
                              车间待手填
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {sheet.product_name} · {sheet.specification || '规格未填写'} · {sheet.customer_name}
                        </span>
                      </span>
                    </label>
                  );
                }) : (
                  <div className="px-4 py-8 text-center text-muted">
                    当前没有“已经实际生产入库且尚未放行”的联系单。
                  </div>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={handleExportReleaseApplication}
            disabled={IS_PUBLIC_DEMO || !!exportingType || !selectedReleaseIds.length}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-amber/25 bg-brand-amber/10 py-2.5 font-semibold text-brand-amber transition hover:bg-brand-amber/15 disabled:opacity-40"
          >
            {exportingType === 'releaseApplication' ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>正在生成数据...</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>导出放行申请统计表 (Excel)</span>
              </>
            )}
          </button>
        </div>

        {/* Card 3: 月度合同联系单导出 */}
        <div className="glass-panel flex min-h-52 flex-col justify-between space-y-4 rounded-2xl p-5">
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
              <FileSpreadsheet className="w-4 h-4 text-brand-cyan" />
              3. 订单月度汇总表导出
            </h3>
            <p className="text-[11px] leading-relaxed text-muted">
              按合同签署日期范围筛选，导出期间内所有自营和转口销售订单数据，方便财务和销售对账。
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <label className="space-y-1">
                <span className="text-subtle">签署日期从</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-2 text-body"
                />
              </label>
              <label className="space-y-1">
                <span className="text-subtle">至</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-2 text-body"
                />
              </label>
            </div>
          </div>
          <button
            onClick={handleExportMonthly}
            disabled={!!exportingType}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 hover:from-cyan-500/20 hover:to-blue-500/20 text-brand-cyan border border-brand-cyan/20 transition-all font-semibold"
          >
            {exportingType === 'monthly' ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>正在提取日期范围...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>导出日期范围汇总 (Excel)</span>
              </>
            )}
          </button>
        </div>

        {/* Card 4: 正本合同统计表导出 */}
        <div className="glass-panel flex min-h-52 flex-col justify-between space-y-4 rounded-2xl p-5">
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
              <FileSpreadsheet className="w-4 h-4 text-brand-amber" />
              4. 正本合同统计表导出
            </h3>
            <p className="text-[11px] leading-relaxed text-muted">
              按合同签署日期范围筛选，每份合同一行，生成正本合同登记统计表。日期范围与订单月度汇总共用，默认本月。
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <label className="space-y-1">
                <span className="text-subtle">签署日期从</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-2 text-body"
                />
              </label>
              <label className="space-y-1">
                <span className="text-subtle">至</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-2 text-body"
                />
              </label>
            </div>
          </div>
          <button
            onClick={handleExportOriginalContracts}
            disabled={!!exportingType}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-gradient-to-r from-amber-500/10 to-orange-500/10 hover:from-amber-500/20 hover:to-orange-500/20 text-brand-amber border border-brand-amber/20 transition-all font-semibold"
          >
            {exportingType === 'originalContracts' ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>正在按合同整理...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>导出正本合同统计表 (Excel)</span>
              </>
            )}
          </button>
        </div>

        {/* Card 5: 客户实际销售、回款及应收汇总 */}
        <div className="glass-panel flex min-h-52 flex-col justify-between space-y-4 rounded-2xl p-5">
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
              <FileSpreadsheet className="w-4 h-4 text-brand-emerald" />
              5. 实际销售、回款及应收汇总
            </h3>
            <p className="text-[11px] leading-relaxed text-muted">
              按客户汇总<strong>本月截至今天</strong>的实际订单、实际回款，以及累计已发货但尚未收回的应收账款。
              美元和人民币均保留原币，本地报表保留原币与人民币换算，并列出汇率状态。
            </p>
          </div>
          <button
            onClick={handleExportCustomerMonthlySales}
            disabled={!!exportingType}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 hover:from-emerald-500/20 hover:to-cyan-500/20 text-brand-emerald border border-brand-emerald/20 transition-all font-semibold"
          >
            {exportingType === 'customerMonthlySales' ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>正在按客户汇总...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>导出客户月度汇总 (Excel)</span>
              </>
            )}
          </button>
        </div>

        {/* Card 6: 人民币开票申请导出 */}
        <div className="glass-panel flex min-h-52 flex-col justify-between space-y-4 rounded-2xl p-5">
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
              <FileSpreadsheet className="w-4 h-4 text-brand-cyan" />
              6. 人民币增值税开票申请单
            </h3>
            <p className="text-[11px] leading-relaxed text-muted">
              导出转口贸易中对应的人民币增值税发票开具申请汇总表，提交财务部门开票及出库单据留存。
            </p>
          </div>
          <button
            onClick={handleExportInvoices}
            disabled={!!exportingType}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 hover:from-cyan-500/20 hover:to-blue-500/20 text-brand-cyan border border-brand-cyan/20 transition-all font-semibold"
          >
            {exportingType === 'invoices' ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>整理发票数据...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>导出人民币开票申请表 (Excel)</span>
              </>
            )}
          </button>
        </div>

        {/* Card 7: 实际与预计开票 */}
        <div className="glass-panel flex min-h-52 flex-col justify-between space-y-4 rounded-2xl p-5 md:col-span-2">
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
              <FileSpreadsheet className="h-4 w-4 text-brand-amber" />
              7. 美金实际开票与预计开票
            </h3>
            <p className="text-[11px] leading-relaxed text-muted">
              按发货记录创建日期筛选；同一联系单分次发货时分别列示。美元数据使用所选月份汇率。
            </p>
            <div className="grid gap-3 pt-2 sm:grid-cols-3">
              <label className="space-y-1">
                <span className="text-subtle">发货记录创建日期从</span>
                <input
                  type="date"
                  value={invoiceDateFrom}
                  onChange={(event) => setInvoiceDateFrom(event.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-2 text-body"
                />
              </label>
              <label className="space-y-1">
                <span className="text-subtle">至</span>
                <input
                  type="date"
                  value={invoiceDateTo}
                  onChange={(event) => setInvoiceDateTo(event.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-2 text-body"
                />
              </label>
              <label className="space-y-1">
                <span className="text-subtle">使用汇率月份</span>
                <input
                  type="month"
                  value={invoiceRateMonth}
                  onChange={(event) => setInvoiceRateMonth(event.target.value)}
                  className="w-full rounded border border-border bg-surface px-2.5 py-2 text-body"
                />
              </label>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleInvoiceExport('usdActualInvoice')}
              disabled={IS_PUBLIC_DEMO || !!exportingType}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-cyan/20 bg-brand-cyan/10 py-2.5 font-semibold text-brand-cyan transition hover:bg-brand-cyan/15 disabled:opacity-40"
            >
              {exportingType === 'usdActualInvoice' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span>{exportingType === 'usdActualInvoice' ? '正在校验并生成...' : '导出美金实际开票'}</span>
            </button>
            <button
              type="button"
              onClick={() => handleInvoiceExport('expectedInvoice')}
              disabled={IS_PUBLIC_DEMO || !!exportingType}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-brand-amber/20 bg-brand-amber/10 py-2.5 font-semibold text-brand-amber transition hover:bg-brand-amber/15 disabled:opacity-40"
            >
              {exportingType === 'expectedInvoice' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span>{exportingType === 'expectedInvoice' ? '正在校验并生成...' : '导出预计开票'}</span>
            </button>
          </div>
        </div>

        {/* Card 8: 全部发货明细 */}
        <div className="glass-panel flex min-h-52 flex-col justify-between space-y-4 rounded-2xl p-5">
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-2 font-heading text-sm font-bold text-ink">
              <FileSpreadsheet className="w-4 h-4 text-brand-emerald" />
              8. 全部发货明细导出
            </h3>
            <p className="text-[11px] leading-relaxed text-muted">
              从 本地数据库 发货利润视图生成完整发货明细，包含客户、合同、联系单、批次、数量、单价和金额，方便离线核对与留档。
            </p>
          </div>
          <button
            onClick={handleExportShipmentDetails}
            disabled={!!exportingType}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 hover:from-emerald-500/20 hover:to-cyan-500/20 text-brand-emerald border border-brand-emerald/20 transition-all font-semibold disabled:opacity-40"
          >
            {exportingType === 'shipmentDetails' ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>正在整理发货明细...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>导出全部发货明细 (Excel)</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
