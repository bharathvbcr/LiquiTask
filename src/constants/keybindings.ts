export const DEFAULT_KEYBINDINGS: Record<string, string[]> = {
    'global:command-palette': ['Meta+k', 'Ctrl+k'],
    'global:toggle-sidebar': ['Meta+b', 'Ctrl+b'],
    'global:create-task': ['c'],
    'global:undo': ['Meta+z', 'Ctrl+z'],
    'global:export': ['Meta+e', 'Ctrl+e'],
    'global:search-focus': ['/'],
    'nav:down': ['ArrowDown', 'j'],
    'nav:up': ['ArrowUp', 'k'],
    'nav:left': ['ArrowLeft', 'h'],
    'nav:right': ['ArrowRight', 'l'],
    'nav:select': ['Enter'],
    'nav:back': ['Escape'],
    'nav:column-1': ['1'],
    'nav:column-2': ['2'],
    'nav:column-3': ['3'],
    'nav:column-4': ['4'],
    'nav:column-5': ['5'],
    'nav:column-6': ['6'],
    'nav:column-7': ['7'],
    'nav:column-8': ['8'],
    'nav:column-9': ['9'],
    'task:delete': ['Delete', 'Backspace'], // usually with modifier check in code
    'task:complete': ['x'],
    'task:edit': ['e'],
    'task:move-next': ['Shift+m'],
    'task:move-prev': ['Shift+,'],
};

export interface KeybindingMap {
    [actionId: string]: string[];
}
