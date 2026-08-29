import { addDaysToLocalDate } from './dateUtils.ts';

/**
 * 业务规则核心模块。
 * 这里保持为纯函数，页面和数据层都可以复用。
 */

export function inferUnit(productName: string): string {
  if (!productName) return '盒';
  if (productName.includes('注射')) return '支';
  if (productName.includes('气雾剂') || productName.includes('干混')) return '瓶';
  return '盒';
}

export function calculateExpiryDate(productionDateStr: string, expiryYears: number, isStaggered: boolean): string {
  if (!productionDateStr) return '';

  let month = 0;
  let year = 0;

  if (productionDateStr.includes('/')) {
    const parts = productionDateStr.split('/');
    month = parseInt(parts[0], 10);
    year = parseInt(parts[1], 10);
  } else if (productionDateStr.includes('-')) {
    const parts = productionDateStr.split('-');
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
  } else {
    return '';
  }

  if (
    Number.isNaN(month)
    || Number.isNaN(year)
    || month < 1
    || month > 12
    || year < 1
    || !Number.isInteger(expiryYears)
    || expiryYears < 0
  ) return '';

  let targetYear = year + expiryYears;
  let targetMonth = month;

  if (isStaggered) {
    targetMonth -= 1;
    if (targetMonth === 0) {
      targetMonth = 12;
      targetYear -= 1;
    }
  }

  return `${targetMonth.toString().padStart(2, '0')}/${targetYear}`;
}

export function calculateEstimatedReleaseDate(actualWarehousingDate: string, productName: string): string {
  if (!actualWarehousingDate) return '';
  return addDaysToLocalDate(actualWarehousingDate, productName.includes('注射') ? 17 : 10);
}

export function isQaComplete(sheet: {
  qa_approval_date?: string | null;
  aps_scheduled_date?: string | null;
  actual_warehousing_date?: string | null;
  actual_release_date?: string | null;
}): boolean {
  return Boolean(
    sheet.qa_approval_date
    || sheet.aps_scheduled_date
    || sheet.actual_warehousing_date
    || sheet.actual_release_date
  );
}

export function parseBatchNumbers(batchNoStr: string): string[] {
  if (!batchNoStr) return [];
  const text = String(batchNoStr).trim();

  const rangeMatch = text.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const [, startText, endText] = rangeMatch;
    const start = Number(startText);
    const suffixBase = 10 ** endText.length;
    let end = Number(endText);
    if (endText.length < startText.length && Number.isSafeInteger(suffixBase)) {
      end += Math.floor(start / suffixBase) * suffixBase;
      if (end < start) end += suffixBase;
    }
    if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && end - start < 100) {
      const width = endText.length < startText.length
        ? startText.length
        : Math.max(startText.length, endText.length);
      const list = [];
      for (let i = start; i <= end; i += 1) list.push(String(i).padStart(width, '0'));
      return list;
    }
  }

  if (text.includes('/')) {
    return text.split('/').map((part) => part.trim()).filter(Boolean);
  }

  return [text];
}

export interface ParsedBatchAllocation {
  batch_no: string;
  batch_quantity?: number;
}

export function parseBatchAllocations(input: string): ParsedBatchAllocation[] {
  const text = String(input || '').trim();
  if (!text) return [];

  const quantityPattern = /^(.*?)\s*(?:[:：=×xX*])\s*([\d,，]+(?:\.\d+)?)\s*(?:盒|支|瓶|袋|片|粒|KG|kg|十亿)?\s*$/;
  const quantityGroups = text.split(/[\n;；]+/).map((part) => part.trim()).filter(Boolean);
  const hasQuantityGroups = quantityGroups.some((part) => quantityPattern.test(part));

  if (!hasQuantityGroups) {
    return text
      .split(/[,，]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .flatMap((part) => parseBatchNumbers(part).map((batch_no) => ({ batch_no })));
  }

  return quantityGroups.flatMap((part) => {
    const matched = part.match(quantityPattern);
    if (!matched) {
      return part
        .split(/[,，]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .flatMap((item) => parseBatchNumbers(item).map((batch_no) => ({ batch_no })));
    }

    const quantity = Number(matched[2].replace(/[,，]/g, ''));
    const batchNumbers = matched[1]
      .split(/[,，/]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .flatMap((item) => parseBatchNumbers(item));
    return batchNumbers.map((batch_no) => ({
      batch_no,
      batch_quantity: Number.isFinite(quantity) ? quantity : undefined
    }));
  });
}

export interface PaymentCheckResult {
  status: 'approved' | 'warning' | 'rejected';
  message: string;
}

export function checkPaymentTermsBeforeShipment(
  paymentTerms: string,
  contractAmount: number,
  _prepaymentAmount: number,
  totalPaid: number,
  _shipmentAmount: number
): PaymentCheckResult {
  const terms = (paymentTerms || '').toLowerCase();

  if (!contractAmount) {
    return { status: 'warning', message: '合同金额暂未形成，需人工确认付款条件。' };
  }

  if (terms.includes('30%') && terms.includes('70%') && (terms.includes('发货前') || terms.includes('shipment'))) {
    if (totalPaid >= contractAmount) {
      return { status: 'approved', message: '已全部付清，满足发货条件。' };
    }
    return {
      status: 'rejected',
      message: `不满足发货条件。该条款要求发货前全部付清，目前缺口 ${(contractAmount - totalPaid).toFixed(2)}。`
    };
  }

  if (terms.includes('40%') && terms.includes('60%') && (terms.includes('提单') || terms.includes('bl') || terms.includes('b/l'))) {
    const minPrepayment = contractAmount * 0.4;
    if (totalPaid >= minPrepayment) {
      return {
        status: 'approved',
        message: `已收款 ${totalPaid.toFixed(2)}，达到 40% 预付款要求，可安排发货。`
      };
    }
    return {
      status: 'rejected',
      message: `不满足发货条件。至少需收到 40% 预付款，目前还差 ${(minPrepayment - totalPaid).toFixed(2)}。`
    };
  }

  if (terms.includes('lc') || terms.includes('l/c') || terms.includes('信用证')) {
    return { status: 'warning', message: '信用证付款需人工确认开证、交单和收款状态。' };
  }

  return { status: 'warning', message: `特殊或未识别付款条款“${paymentTerms}”，需人工确认。` };
}
