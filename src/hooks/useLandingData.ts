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
      try {
        const [content, products] = await Promise.all([getLandingContent(), getProducts()]);

        if (!ignore) {
          setState({ content, products });
        }
      } catch {
        if (!ignore) {
          setState({ content: defaultLandingContent, products: defaultProducts });
        }
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, []);

  return state;
}
