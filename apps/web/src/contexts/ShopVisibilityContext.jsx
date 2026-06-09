import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import apiServerClient from '@/lib/apiServerClient.js';

const ShopVisibilityContext = createContext(null);

export const useShopVisibility = () => {
  const context = useContext(ShopVisibilityContext);
  if (!context) {
    throw new Error('useShopVisibility must be used within ShopVisibilityProvider');
  }
  return context;
};

export const ShopVisibilityProvider = ({ children }) => {
  const [shopEnabled, setShopEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshShopVisibility = useCallback(async () => {
    try {
      const response = await apiServerClient.fetch('/settings/shop-visibility');
      if (!response.ok) throw new Error('Failed to fetch shop visibility');

      const data = await response.json();
      setShopEnabled(data.shop_enabled === true);
    } catch (error) {
      console.error('Failed to load shop visibility:', error);
      setShopEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshShopVisibility();
    const interval = setInterval(refreshShopVisibility, 30000);

    return () => clearInterval(interval);
  }, [refreshShopVisibility]);

  return (
    <ShopVisibilityContext.Provider value={{ shopEnabled, loading, refreshShopVisibility }}>
      {children}
    </ShopVisibilityContext.Provider>
  );
};
