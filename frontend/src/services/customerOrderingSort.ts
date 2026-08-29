export function sortCustomersForDisplay<T extends { id: string; name: string }>(
  customers: T[],
  order: string[] = []
): T[] {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...customers].sort((left, right) => {
    const leftPosition = positions.get(left.id);
    const rightPosition = positions.get(right.id);
    if (leftPosition !== undefined || rightPosition !== undefined) {
      if (leftPosition === undefined) return 1;
      if (rightPosition === undefined) return -1;
      if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    }
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}
