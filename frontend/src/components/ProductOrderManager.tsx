import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, RotateCcw, Search } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import {
  resetMasterProductDisplayOrder,
  saveMasterProductDisplayOrder,
  type MasterProduct
} from '../services/masterDataService';

interface ProductOrderManagerProps {
  products: MasterProduct[];
  onSaved: () => Promise<void>;
}

export function ProductOrderManager({ products, onSaved }: ProductOrderManagerProps) {
  const [query, setQuery] = useState('');
  const [orderedProducts, setOrderedProducts] = useState(products);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setOrderedProducts(products), [products]);

  const visibleProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return orderedProducts;
    return orderedProducts.filter((product) => [
      product.product_code,
      product.chinese_name,
      product.english_name,
      product.dosage_form,
      ...product.variants.map((variant) => variant.specification)
    ].join(' ').toLocaleLowerCase().includes(normalized));
  }, [orderedProducts, query]);

  const persistOrder = async (next: MasterProduct[]) => {
    const previous = orderedProducts;
    setOrderedProducts(next);
    setIsSaving(true);
    setError('');
    try {
      await saveMasterProductDisplayOrder(next.map((product) => product.id));
    } catch (caught) {
      setOrderedProducts(previous);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  };

  const moveProduct = (productId: string, direction: -1 | 1) => {
    const current = [...orderedProducts];
    const index = current.findIndex((product) => product.id === productId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return;
    [current[index], current[nextIndex]] = [current[nextIndex], current[index]];
    void persistOrder(current);
  };

  const moveProductToEdge = (productId: string, edge: 'top' | 'bottom') => {
    const product = orderedProducts.find((item) => item.id === productId);
    if (!product) return;
    const current = orderedProducts.filter((item) => item.id !== productId);
    if (edge === 'top') current.unshift(product);
    else current.push(product);
    void persistOrder(current);
  };

  const resetOrder = async () => {
    setIsSaving(true);
    setError('');
    try {
      await resetMasterProductDisplayOrder();
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-bold text-ink">产品展示顺序</h3>
          <p className="mt-1 text-[11px] leading-5 text-muted">顺序保存到共享数据库，供产品选择和包装模板维护统一使用；不会改变产品主键、规格或历史业务关联。</p>
        </div>
        <Button tone="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void resetOrder()} disabled={isSaving}>
          恢复默认顺序
        </Button>
      </div>
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索产品后调整位置" className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-ink" />
      </div>
      {error && <div role="alert" className="mt-3 rounded-lg border border-brand-rose/25 bg-brand-rose/8 px-3 py-2 text-xs text-brand-rose">{error}</div>}
      <div className="mt-3 max-h-[60vh] divide-y divide-border overflow-y-auto rounded-xl border border-border bg-surface">
        {visibleProducts.map((product) => {
          const absoluteIndex = orderedProducts.findIndex((item) => item.id === product.id);
          return (
            <div key={product.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="w-8 shrink-0 text-center text-[11px] font-semibold text-subtle">{absoluteIndex + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{product.chinese_name}</span>
                <span className="block truncate text-[10px] text-muted">{product.product_code} · {product.dosage_form || '未填写剂型'} · {product.variants.length} 个规格</span>
              </span>
              <IconButton label={`直接置顶 ${product.chinese_name}`} icon={<ArrowUpToLine className="h-3.5 w-3.5" />} onClick={() => moveProductToEdge(product.id, 'top')} disabled={isSaving || absoluteIndex <= 0} />
              <IconButton label={`上移 ${product.chinese_name}`} icon={<ArrowUp className="h-3.5 w-3.5" />} onClick={() => moveProduct(product.id, -1)} disabled={isSaving || absoluteIndex <= 0} />
              <IconButton label={`下移 ${product.chinese_name}`} icon={<ArrowDown className="h-3.5 w-3.5" />} onClick={() => moveProduct(product.id, 1)} disabled={isSaving || absoluteIndex >= orderedProducts.length - 1} />
              <IconButton label={`直接移到底部 ${product.chinese_name}`} icon={<ArrowDownToLine className="h-3.5 w-3.5" />} onClick={() => moveProductToEdge(product.id, 'bottom')} disabled={isSaving || absoluteIndex >= orderedProducts.length - 1} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
