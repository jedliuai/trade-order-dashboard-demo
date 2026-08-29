import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { filterComboboxOptions } from '../services/comboboxSearch';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  disabled?: boolean;
}

export interface SearchableComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  ariaLabel: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

interface MenuPosition {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

export const SearchableCombobox = forwardRef<HTMLInputElement, SearchableComboboxProps>(({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = '请选择',
  searchPlaceholder = '输入关键词搜索',
  emptyMessage = '没有匹配的已有选项',
  disabled = false,
  invalid = false,
  size = 'md',
  className = ''
}, forwardedRef) => {
  const listboxId = useId();
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const selectedOption = options.find(option => option.value === value);
  const filteredOptions = useMemo(() => filterComboboxOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(filteredOptions.findIndex(option => !option.disabled));
  }, [filteredOptions, open]);

  useEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      const input = localInputRef.current;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      const gap = 4;
      const preferredHeight = 256;
      const minimumUsefulHeight = 120;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const openAbove = spaceBelow < minimumUsefulHeight && spaceAbove > spaceBelow;
      const availableHeight = openAbove ? spaceAbove : spaceBelow;

      setMenuPosition({
        left: rect.left,
        top: openAbove ? undefined : rect.bottom + gap,
        bottom: openAbove ? window.innerHeight - rect.top + gap : undefined,
        width: rect.width,
        maxHeight: Math.max(96, Math.min(preferredHeight, availableHeight))
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const assignInputRef = (node: HTMLInputElement | null) => {
    localInputRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  const closeList = () => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  };

  const openList = () => {
    if (disabled || open) return;
    setOpen(true);
    setQuery('');
  };

  const selectOption = (option: ComboboxOption) => {
    if (option.disabled) return;
    onChange(option.value);
    closeList();
    requestAnimationFrame(() => localInputRef.current?.focus());
  };

  const moveActive = (direction: 1 | -1) => {
    if (!filteredOptions.length) return;
    let next = activeIndex;
    for (let attempts = 0; attempts < filteredOptions.length; attempts += 1) {
      next = (next + direction + filteredOptions.length) % filteredOptions.length;
      if (!filteredOptions[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  };

  return (
    <div
      className={`relative ${className}`}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        closeList();
      }}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <input
          ref={assignInputRef}
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          disabled={disabled}
          data-control-size={size}
          value={open ? query : (selectedOption?.label ?? '')}
          placeholder={open ? searchPlaceholder : placeholder}
          onClick={openList}
          onChange={(event) => {
            if (!open) setOpen(true);
            setQuery(event.target.value);
            if (value) onChange('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (!open) openList();
              else moveActive(1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              if (!open) openList();
              else moveActive(-1);
            } else if (event.key === 'Enter' && open && activeIndex >= 0) {
              event.preventDefault();
              const option = filteredOptions[activeIndex];
              if (option) selectOption(option);
            } else if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              closeList();
            }
          }}
          className={`w-full rounded-[10px] border bg-surface pl-9 pr-10 text-ink transition-colors disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted ${
            size === 'sm' ? 'px-2.5 py-2 text-xs' : 'px-3 py-2.5 text-sm'
          } ${invalid ? 'border-brand-rose/50' : 'border-border'}`}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) closeList();
            else {
              localInputRef.current?.focus();
              openList();
            }
          }}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[10px] text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:text-subtle"
          aria-label={open ? `收起${ariaLabel}` : `展开${ariaLabel}`}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && menuPosition && createPortal(
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel}候选项`}
          className="fixed z-[60] overflow-y-auto rounded-[10px] border border-border bg-surface p-1.5 shadow-[0_16px_40px_rgba(74,66,56,0.18)]"
          style={menuPosition}
        >
          {filteredOptions.length ? filteredOptions.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <button
                key={option.value}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  active ? 'bg-brand-cyan/12 text-ink' : selected ? 'bg-surface-muted text-ink' : 'text-body hover:bg-surface-muted'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{option.label}</span>
                  {option.description && <span className="mt-0.5 block truncate text-[11px] text-muted">{option.description}</span>}
                </span>
                {selected && <Check className="h-4 w-4 shrink-0 text-brand-emerald" />}
              </button>
            );
          }) : (
            <div className="px-3 py-5 text-center text-sm text-muted">{emptyMessage}</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
});

SearchableCombobox.displayName = 'SearchableCombobox';
