/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 */
export function debounce<TArgs extends unknown[]>(
  func: (...args: TArgs) => void,
  wait: number,
): (...args: TArgs) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: TArgs) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}
