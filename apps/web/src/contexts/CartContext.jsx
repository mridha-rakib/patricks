import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import pb from '@/lib/pocketbaseClient.js';
import apiServerClient from '@/lib/apiServerClient.js';
import { useAuth } from './AuthContext.jsx';

const CartContext = createContext();

const getShopStockLimit = (product) => {
  const rawStock = Number(product?.stock_quantity ?? product?.stockQuantity ?? product?.stock ?? 1);
  return Math.max(1, Number.isFinite(rawStock) ? Math.floor(rawStock) : 1);
};

const normalizeCartQuantity = (item) => {
  if (item?.product_type !== 'shop') {
    return { ...item, quantity: 1 };
  }

  const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));
  return {
    ...item,
    quantity: Math.min(quantity, getShopStockLimit(item.product)),
  };
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within CartProvider');
  }
  return context;
};

export const CartProvider = ({ children }) => {
  const { currentUser } = useAuth();
  const [cartItems, setCartItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({ shipping_fee: 4.99, service_fee: 1.99 });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await apiServerClient.fetch('/settings/fees');
        if (!response.ok) throw new Error('Failed to fetch fees');

        const data = await response.json();
        setSettings(prev => {
          const next = {
            shipping_fee: data.shipping_fee ?? 4.99,
            service_fee: data.service_fee ?? 1.99,
          };

          if (prev.shipping_fee === next.shipping_fee && prev.service_fee === next.service_fee) {
            return prev;
          }

          return next;
        });
      } catch (error) {
        console.error('Failed to fetch platform fees:', error);
      }
    };

    fetchSettings();
    const interval = setInterval(fetchSettings, 30000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    console.log('🔄 useEffect triggered in CartContext (Load LocalStorage)');
    const savedCart = localStorage.getItem('shopping_cart');
    if (savedCart) {
      try {
        const parsedCart = JSON.parse(savedCart);
        setCartItems(Array.isArray(parsedCart)
          ? parsedCart.map(normalizeCartQuantity)
          : []);
      } catch (e) {
        console.error('Failed to parse cart from localStorage', e);
      }
    }
  }, []);

  const loadCart = useCallback(async () => {
    if (!currentUser) return;

    setLoading(true);
    try {
      const items = await pb.collection('cart_items').getFullList({
        filter: `user_id = "${currentUser.id}"`,
        $autoCancel: false
      });

      const itemsWithProducts = await Promise.all(
        items.map(async (item) => {
          try {
            let product;
            if (item.product_type === 'shop') {
              product = await pb.collection('shop_products').getOne(item.product_id, { $autoCancel: false });
            } else {
              product = await pb.collection('products').getOne(item.product_id, { $autoCancel: false });
            }
            return { ...item, product };
          } catch (err) {
            return null;
          }
        })
      );

      const validItems = itemsWithProducts
        .filter(item => item !== null)
        .map(normalizeCartQuantity);
      setCartItems(validItems);
    } catch (error) {
      console.error('Failed to load cart from DB:', error);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    console.log('🔄 useEffect triggered in CartContext (Sync DB on User Change)', { userId: currentUser?.id });
    if (currentUser) {
      loadCart();
    }
  }, [currentUser, loadCart]);

  useEffect(() => {
    console.log('🔄 useEffect triggered in CartContext (Save LocalStorage)', { itemsCount: cartItems.length });
    localStorage.setItem('shopping_cart', JSON.stringify(cartItems));
  }, [cartItems]);

  const addToCart = async (product, quantity = 1, productType = 'marketplace') => {
    const normalizedProductType = productType === 'shop' ? 'shop' : 'marketplace';
    const stockLimit = normalizedProductType === 'shop' ? getShopStockLimit(product) : 1;
    const requestedQuantity = Math.max(1, Math.floor(Number(quantity || 1)));
    const normalizedQuantity = normalizedProductType === 'shop'
      ? Math.min(requestedQuantity, stockLimit)
      : 1;
    const existingIndex = cartItems.findIndex(
      item => item.product_id === product.id && item.product_type === normalizedProductType
    );

    let newCart = [...cartItems];
    if (existingIndex >= 0) {
      newCart[existingIndex].quantity = normalizedProductType === 'shop'
        ? Math.min(Number(newCart[existingIndex].quantity || 1) + normalizedQuantity, stockLimit)
        : 1;
    } else {
      newCart.push({
        id: `local_${Date.now()}`,
        product_id: product.id,
        product_type: normalizedProductType,
        quantity: normalizedQuantity,
        product
      });
    }
    setCartItems(newCart);

    if (currentUser) {
      try {
        const existingDbItem = await pb.collection('cart_items').getFirstListItem(
          `user_id="${currentUser.id}" && product_id="${product.id}" && product_type="${normalizedProductType}"`,
          { $autoCancel: false }
        ).catch(() => null);

        if (existingDbItem) {
          await pb.collection('cart_items').update(existingDbItem.id, {
            quantity: normalizedProductType === 'shop'
              ? Math.min(Number(existingDbItem.quantity || 1) + normalizedQuantity, stockLimit)
              : 1
          }, { $autoCancel: false });
        } else {
          await pb.collection('cart_items').create({
            user_id: currentUser.id,
            product_id: product.id,
            product_type: normalizedProductType,
            quantity: normalizedQuantity
          }, { $autoCancel: false });
        }
        await loadCart();
      } catch (error) {
        console.error('Failed to sync cart add to DB:', error);
      }
    }
  };

  const removeFromCart = async (cartItemId, productId) => {
    setCartItems(prev => prev.filter(item => item.id !== cartItemId && item.product_id !== productId));

    if (currentUser && !cartItemId.toString().startsWith('local_')) {
      try {
        await pb.collection('cart_items').delete(cartItemId, { $autoCancel: false });
      } catch (error) {
        console.error('Failed to remove from DB cart:', error);
      }
    }
  };

  const updateQuantity = async (cartItemId, productId, quantity) => {
    const currentItem = cartItems.find(item => item.id === cartItemId || item.product_id === productId);
    const stockLimit = currentItem?.product_type === 'shop' ? getShopStockLimit(currentItem.product) : 1;
    const nextQuantity = currentItem?.product_type === 'shop'
      ? Math.min(Math.max(1, Math.floor(Number(quantity || 1))), stockLimit)
      : 1;

    if (quantity < 1) {
      await removeFromCart(cartItemId, productId);
      return;
    }

    setCartItems(prev => prev.map(item =>
      (item.id === cartItemId || item.product_id === productId)
        ? { ...item, quantity: item.product_type === 'shop' ? nextQuantity : 1 }
        : item
    ));

    if (currentUser && !cartItemId.toString().startsWith('local_')) {
      try {
        await pb.collection('cart_items').update(cartItemId, { quantity: nextQuantity }, { $autoCancel: false });
      } catch (error) {
        console.error('Failed to update quantity in DB:', error);
      }
    }
  };

  const clearCart = async () => {
    setCartItems([]);
    if (currentUser) {
      try {
        const items = await pb.collection('cart_items').getFullList({
          filter: `user_id = "${currentUser.id}"`,
          $autoCancel: false
        });
        const deletePromises = items.map(item =>
          pb.collection('cart_items').delete(item.id, { $autoCancel: false })
        );
        await Promise.all(deletePromises);
      } catch (error) {
        console.error('Failed to clear DB cart:', error);
      }
    }
  };

  const getSubtotal = () => {
    return cartItems.reduce((sum, item) => {
      return sum + (item.product?.price || 0) * (item.quantity || 1);
    }, 0);
  };

  const getTotal = () => {
    const subtotal = getSubtotal();
    return subtotal > 0 ? subtotal + settings.shipping_fee + settings.service_fee : 0;
  };

  const value = {
    cartItems,
    loading,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    loadCart,
    getSubtotal,
    getTotal,
    SHIPPING_FEE: settings.shipping_fee,
    SERVICE_FEE: settings.service_fee,
    itemCount: cartItems.reduce((sum, item) => sum + (item.quantity || 1), 0)
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};
