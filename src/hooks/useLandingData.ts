import { useEffect, useState } from 'react';

import { defaultLandingContent, defaultProducts } from '../lib/defaultContent';
import { getLandingContent, getProducts } from '../services/cms';
import type { LandingContent, Product } from '../types/cms';

type LandingDataState = {
  content: LandingContent;
  products: Product[];
  isLoading: boolean;
  productsError: string | null;
};

export function useLandingData() {
  const [state, setState] = useState<LandingDataState>({
    content: defaultLandingContent,
    products: [],
    isLoading: true,
    productsError: null,
  });
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let ignore = false;

    async function load() {
      const [contentResult, productsResult] = await Promise.allSettled([getLandingContent(), getProducts()]);

      if (ignore) {
        return;
      }

      setState({
        content: contentResult.status === 'fulfilled' ? contentResult.value : defaultLandingContent,
        products: productsResult.status === 'fulfilled' ? productsResult.value : defaultProducts,
        isLoading: false,
        productsError:
          productsResult.status === 'rejected'
            ? productsResult.reason instanceof Error
              ? productsResult.reason.message
              : 'No pudimos cargar los productos destacados.'
            : null,
      });
    }

    load();

    return () => {
      ignore = true;
    };
  }, [requestVersion]);

  return {
    ...state,
    reloadProducts: () => {
      setState((current) => ({ ...current, isLoading: true, productsError: null }));
      setRequestVersion((current) => current + 1);
    },
  };
}
