import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface SearchResult {
  type: 'employee' | 'project' | 'task' | 'leave';
  id: string;
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  url: string;
}

interface SearchResponse {
  employees: SearchResult[];
  projects: SearchResult[];
  tasks: SearchResult[];
  leaves: SearchResult[];
}

const fetchSearchResults = async (query: string, type: string = 'all'): Promise<SearchResponse> => {
  if (!query || query.length < 2) {
    return { employees: [], projects: [], tasks: [], leaves: [] };
  }
  const response = await api.get('/search', {
    params: { q: query, type }
  });
  return response.data.data || response.data;
};

export function useSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => fetchSearchResults(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30000,
  });

  const allResults: SearchResult[] = [
    ...(data?.employees || []),
    ...(data?.projects || []),
    ...(data?.tasks || []),
    ...(data?.leaves || []),
  ];

  const openSearch = useCallback(() => {
    setIsOpen(true);
    setQuery('');
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const moveSelection = useCallback((direction: 'up' | 'down') => {
    setSelectedIndex(prev => {
      if (direction === 'down') {
        return Math.min(prev + 1, allResults.length - 1);
      } else {
        return Math.max(prev - 1, 0);
      }
    });
  }, [allResults.length]);

  const getSelectedResult = useCallback((): SearchResult | null => {
    if (selectedIndex >= 0 && selectedIndex < allResults.length) {
      return allResults[selectedIndex];
    }
    return null;
  }, [selectedIndex, allResults]);

  return {
    query,
    setQuery,
    results: allResults,
    employees: data?.employees || [],
    projects: data?.projects || [],
    tasks: data?.tasks || [],
    leaves: data?.leaves || [],
    isLoading,
    isError,
    isOpen,
    openSearch,
    closeSearch,
    selectedIndex,
    setSelectedIndex,
    moveSelection,
    getSelectedResult,
    inputRef,
  };
}