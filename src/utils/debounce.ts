export interface DebouncedFn<TArgs extends unknown[]> {
  (...args: TArgs): void;
  cancel(): void;
}

export function debounce<TArgs extends unknown[]>(
  func: (...args: TArgs) => void,
  wait: number,
): DebouncedFn<TArgs> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const debounced = function executedFunction(...args: TArgs) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      func(...args);
    }, wait);
  } as DebouncedFn<TArgs>;

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
}
