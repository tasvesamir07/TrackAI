import { useState, useEffect, useRef, useCallback } from 'react';

interface VirtualListProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  itemHeight?: number;
  containerHeight?: number;
  overscan?: number;
  className?: string;
  emptyMessage?: string;
}

export function VirtualList<T>({
  items,
  renderItem,
  itemHeight = 60,
  containerHeight = 400,
  overscan = 3,
  className = '',
  emptyMessage = 'No items',
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalHeight = items.length * itemHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const visibleItems = items.slice(startIndex, endIndex + 1);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  if (items.length === 0) {
    return (
      <div className={`flex items-center justify-center text-muted-foreground ${className}`} style={{ height: containerHeight }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`overflow-auto ${className}`}
      style={{ height: containerHeight }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${startIndex * itemHeight}px)` }}>
          {visibleItems.map((item, index) => (
            <div key={startIndex + index} style={{ height: itemHeight }}>
              {renderItem(item, startIndex + index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface InfiniteScrollProps<T> {
  fetchNextPage: () => void;
  hasMore: boolean;
  isLoading: boolean;
  children: (items: T[]) => React.ReactNode;
  items: T[];
  threshold?: number;
}

export function InfiniteScroll<T>({
  fetchNextPage,
  hasMore,
  isLoading,
  children,
  items,
  threshold = 200,
}: InfiniteScrollProps<T>) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading) {
          fetchNextPage();
        }
      },
      { rootMargin: `${threshold}px` }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, isLoading, fetchNextPage, threshold]);

  return (
    <>
      {children(items)}
      <div ref={loadMoreRef} className="h-4" />
      {isLoading && <div className="text-center py-2 text-muted-foreground">Loading more...</div>}
    </>
  );
}