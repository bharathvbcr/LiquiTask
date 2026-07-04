export interface DebouncedFn<TArgs extends unknown[]> {
  (...args: TArgs): void;
  cancel(): void;
  flush(): void;
}

export function debounce<TArgs extends unknown[]>(
  func: (...args: TArgs) => void,
  wait: number,
): DebouncedFn<TArgs> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: TArgs | null = null;

  const debounced = function executedFunction(...args: TArgs) {
    lastArgs = args;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      lastArgs = null;
      func(...args);
    }, wait);
  } as DebouncedFn<TArgs>;

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    lastArgs = null;
  };

  debounced.flush = () => {
    if (!timeout || !lastArgs) return;
    clearTimeout(timeout);
    timeout = null;
    const args = lastArgs;
    lastArgs = null;
    func(...args);
  };

  return debounced;
}
