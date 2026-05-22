declare module '@tanstack/react-virtual' {
  export interface VirtualItem {
    index: number;
    start: number;
    size: number;
  }
  export interface VirtualizerInstance {
    getTotalSize: () => number;
    getVirtualItems: () => VirtualItem[];
  }
  export function useVirtualizer(options: Record<string, unknown>): VirtualizerInstance;
}
