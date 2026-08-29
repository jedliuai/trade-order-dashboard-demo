export interface AnalysisTemplateFilters {
  start?: string;
  end?: string;
  customer?: string;
  country?: string;
  product?: string;
  exportType?: string;
  status?: string;
  materialNo?: string;
  contractNo?: string;
  sheetNo?: string;
  timePerspective?: 'event' | 'contract';
}

export interface AnalysisTemplateConfig {
  name: string;
  filters: AnalysisTemplateFilters;
  metrics: string[];
  dimension: string;
  chartType: string;
  currencyMode: 'RMB' | 'original';
  entryTitle?: string;
  description?: string;
}

const emptyFilters = {
  start: '',
  end: '',
  customer: 'all',
  country: 'all',
  product: 'all',
  exportType: 'all',
  timePerspective: 'event' as const
};

export const BUILT_IN_ANALYSIS_PRESETS: AnalysisTemplateConfig[] = [
  {
    name: '月度收款与利润趋势',
    entryTitle: '回款与应收',
    description: '查看每月实际回款和已发货未收款余额。',
    filters: { ...emptyFilters },
    metrics: ['payment_amount', 'unpaid_amount'],
    dimension: 'month',
    chartType: 'composed',
    currencyMode: 'RMB'
  },
  {
    name: '客户回款与应收排行',
    entryTitle: '客户与市场',
    description: '比较客户的签约、回款和已确认利润贡献。',
    filters: { ...emptyFilters },
    metrics: ['contract_amount', 'payment_amount', 'profit'],
    dimension: 'customer',
    chartType: 'stacked',
    currencyMode: 'RMB'
  },
  {
    name: '产品销售与利润占比',
    entryTitle: '利润与产品',
    description: '比较不同产品的销售规模、已确认利润和毛利率。',
    filters: { ...emptyFilters },
    metrics: ['shipment_amount', 'profit', 'gross_margin'],
    dimension: 'product',
    chartType: 'composed',
    currencyMode: 'RMB'
  },
  {
    name: '交付与风险状态分布',
    entryTitle: '交付与风险',
    description: '按订单阶段查看发货进度和未处理风险。',
    filters: { ...emptyFilters },
    metrics: ['sheet_count', 'shipment_count', 'alert_count'],
    dimension: 'status',
    chartType: 'bar',
    currencyMode: 'RMB'
  }
];

export function mergeAnalysisTemplates(saved: AnalysisTemplateConfig[]) {
  const merged = new Map<string, AnalysisTemplateConfig>();
  BUILT_IN_ANALYSIS_PRESETS.forEach((template) => merged.set(template.name, template));
  saved.forEach((template) => {
    const builtIn = merged.get(template.name);
    merged.set(template.name, builtIn ? { ...builtIn, ...template, entryTitle: builtIn.entryTitle, description: builtIn.description } : template);
  });
  return Array.from(merged.values());
}
