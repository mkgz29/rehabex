import { useEffect, useState } from 'react';

import { defaultLandingContent, defaultProducts } from '../lib/defaultContent';
import { getLandingContent, getProducts } from '../services/cms';
import type { LandingContent, Product } from '../types/cms';

type LandingDataState = {
  content: LandingContent;
  products: Product[];
};

export function useLandingData() {
  const [state, setState] = useState<LandingDataState>({
    content: defaultLandingContent,
    products: defaultProducts,
  });

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
      });
    }

    load();

    return () => {
      ignore = true;
    };
  }, []);

  return state;
}
