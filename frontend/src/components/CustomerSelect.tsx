import { forwardRef, useEffect, useMemo, useState } from 'react';
import type { Customer } from '../services/dataStore';
import {
  CUSTOMER_ORDER_CHANGED_EVENT,
  loadCustomerDisplayOrder,
  readCustomerDisplayOrder,
  sortCustomersForDisplay
} from '../services/customerOrdering';
import {
  SearchableCombobox,
  type ComboboxOption,
  type SearchableComboboxProps
} from './SearchableCombobox';

interface CustomerSelectProps extends Omit<SearchableComboboxProps, 'options'> {
  customers: Customer[];
  valueMode?: 'id' | 'name';
  allOption?: ComboboxOption;
  describeCustomer?: (customer: Customer) => string | undefined;
}

export const CustomerSelect = forwardRef<HTMLInputElement, CustomerSelectProps>(({
  customers,
  valueMode = 'id',
  allOption,
  describeCustomer,
  ...props
}, ref) => {
  const [order, setOrder] = useState(() => readCustomerDisplayOrder());

  useEffect(() => {
    const handleOrderChange = () => setOrder(readCustomerDisplayOrder());
    window.addEventListener(CUSTOMER_ORDER_CHANGED_EVENT, handleOrderChange);
    window.addEventListener('storage', handleOrderChange);
    void loadCustomerDisplayOrder().catch(() => undefined);
    return () => {
      window.removeEventListener(CUSTOMER_ORDER_CHANGED_EVENT, handleOrderChange);
      window.removeEventListener('storage', handleOrderChange);
    };
  }, []);

  const options = useMemo(() => {
    const customerOptions = sortCustomersForDisplay(customers, order).map((customer) => ({
      value: valueMode === 'name' ? customer.name : customer.id,
      label: customer.name,
      description: describeCustomer?.(customer),
      searchText: `${customer.name} ${customer.country || ''}`
    }));
    return allOption ? [allOption, ...customerOptions] : customerOptions;
  }, [allOption, customers, describeCustomer, order, valueMode]);

  return <SearchableCombobox ref={ref} {...props} options={options} />;
});

CustomerSelect.displayName = 'CustomerSelect';
