import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageSearch, ShieldCheck, ShoppingCart } from 'lucide-react';
import MarketplaceProductCard from '@/components/MarketplaceProductCard.jsx';
import apiServerClient from '@/lib/apiServerClient.js';
import { useCart } from '@/contexts/CartContext.jsx';
import { useShopVisibility } from '@/contexts/ShopVisibilityContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import { getProductImageUrl } from '@/lib/productImages.js';
import { toast } from 'sonner';

const PopularProductsSection = () => {
  const [products, setProducts] = useState([]);
  const [productSource, setProductSource] = useState('marketplace');
  const [loading, setLoading] = useState(true);
  const { addToCart } = useCart();
  const { shopEnabled, loading: shopVisibilityLoading } = useShopVisibility();
  const { t } = useTranslation();

  useEffect(() => {
    if (shopVisibilityLoading) return;

    const fetchMarketplaceProducts = async () => {
      const response = await apiServerClient.fetch('/marketplace/products?perPage=4&sort=-created');
      if (!response.ok) throw new Error('Failed to fetch marketplace products');

      const result = await response.json();
      setProducts(Array.isArray(result.items) ? result.items : []);
      setProductSource('marketplace');
    };

    const fetchProducts = async () => {
      setLoading(true);

      try {
        if (!shopEnabled) {
          await fetchMarketplaceProducts();
          return;
        }

        const response = await apiServerClient.fetch('/shop/products?perPage=4&sort=-created');
        if (!response.ok) throw new Error('Failed to fetch official shop products');

        const result = await response.json();
        const shopProducts = Array.isArray(result.items) ? result.items : [];

        if (shopProducts.length > 0) {
          setProducts(shopProducts);
          setProductSource('shop');
          return;
        }

        await fetchMarketplaceProducts();
      } catch (error) {
        console.error('Error fetching popular products:', error);

        try {
          await fetchMarketplaceProducts();
        } catch (fallbackError) {
          console.error('Error fetching marketplace fallback products:', fallbackError);
          setProducts([]);
          setProductSource('marketplace');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [shopEnabled, shopVisibilityLoading]);

  const handleAddToCart = async (event, product) => {
    event.preventDefault();
    event.stopPropagation();
    await addToCart(product, 1, 'shop');
    toast.success(t('product.added_to_cart'));
  };

  const productsLink = productSource === 'shop' ? '/shop' : '/marketplace';
  const productsSubtitle = productSource === 'shop' ? t('popular.subtitle') : t('popular.marketplace_subtitle');

  return (
    <section className="bg-white px-4 py-16 md:px-6 md:py-24 lg:px-8 lg:py-32">
      <div className="mx-auto max-w-[1280px]">
        <div className="mb-8 flex flex-col justify-between md:mb-12 md:flex-row md:items-end">
          <div>
            <h2 className="mb-2 font-['Playfair_Display'] text-[30px] font-bold text-[hsl(var(--foreground))] md:mb-4 md:text-[36px] lg:text-[48px]">
              {t('popular.title')}
            </h2>
            <p className="text-[16px] text-[hsl(var(--secondary))] md:text-[18px]">
              {productsSubtitle}
            </p>
          </div>
          <Link to={productsLink} className="group hidden font-medium text-[hsl(var(--primary))] transition-smooth hover:opacity-80 md:mt-0 md:inline-flex md:items-center">
            {t('popular.view_all')}
            <span className="ml-1 transition-transform group-hover:translate-x-1">-&gt;</span>
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="aspect-[3/4] animate-pulse rounded-[8px] bg-[hsl(var(--muted))]" />
            ))}
          </div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2 md:grid-cols-3 md:gap-6 lg:grid-cols-4">
            {products.map((product) => {
              if (productSource === 'marketplace') {
                return <MarketplaceProductCard key={product.id} product={product} />;
              }

              const productImageUrl = getProductImageUrl(product);

              return (
                <Link
                  to={`/product/${product.id}?type=shop`}
                  key={product.id}
                  className="group relative flex h-full flex-col overflow-hidden rounded-[8px] border border-[rgba(224,224,224,0.5)] bg-white transition-smooth hover:shadow-hover"
                >
                  <div className="relative aspect-square overflow-hidden bg-[rgba(247,247,247,0.2)]">
                    {productImageUrl ? (
                      <img src={productImageUrl} alt={product.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[hsl(var(--secondary))]">
                        {t('product.no_image')}
                      </div>
                    )}

                    <div className="absolute left-2 top-2 z-10 rounded-[6px] bg-[hsl(var(--primary))] px-2 py-1 text-[10px] font-medium text-white shadow-sm md:text-[12px]">
                      {t('popular.official')}
                    </div>

                    {product.condition === 'Neu' || product.condition === 'Wie neu' ? (
                      <div className="absolute bottom-2 right-2 z-10 rounded-full bg-[hsl(var(--accent))] p-1.5 text-white shadow-sm" title={t('popular.verified')}>
                        <ShieldCheck size={12} />
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-grow flex-col gap-2 p-4">
                    {product.fachbereich && product.fachbereich.length > 0 && (
                      <div className="self-start rounded-full border border-[hsl(var(--border))] bg-white px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--secondary))]">
                        {product.fachbereich[0]}
                      </div>
                    )}
                    <h3 className="line-clamp-2 text-[14px] font-medium text-[hsl(var(--foreground))] transition-fast group-hover:text-[hsl(var(--primary))] md:text-[16px]">
                      {product.name}
                    </h3>
                    <div className="mt-auto pt-2">
                      <span className="text-[16px] font-bold text-[hsl(var(--foreground))] md:text-[18px]">
                        EUR {Number(product.price || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 pt-0">
                    <button onClick={(event) => handleAddToCart(event, product)} className="flex w-full items-center justify-center gap-2 rounded-[8px] bg-[hsl(var(--primary))] py-2.5 text-[14px] font-medium text-white shadow-button transition-smooth hover:bg-[#0000CC] active:scale-[0.98]">
                      <ShoppingCart size={16} />
                      <span className="hidden sm:inline">{t('product.add_to_cart')}</span>
                      <span className="sm:hidden">{t('popular.buy')}</span>
                    </button>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[hsl(var(--border))] bg-[rgba(247,247,247,0.3)] px-4 py-16 text-center">
            <div className="mb-6 flex h-[64px] w-[64px] items-center justify-center rounded-full bg-white shadow-sm md:h-[80px] md:w-[80px]">
              <PackageSearch className="h-[32px] w-[32px] text-[hsl(var(--secondary))] md:h-[40px] md:w-[40px]" />
            </div>
            <h3 className="mb-2 font-['Playfair_Display'] text-[20px] font-semibold text-[hsl(var(--foreground))] md:text-[24px]">
              {t('popular.empty_title')}
            </h3>
            <p className="mb-6 max-w-[448px] text-[hsl(var(--secondary))]">
              {t('popular.empty_body')}
            </p>
            <Link to="/marketplace" className="inline-flex items-center justify-center rounded-[8px] border border-[hsl(var(--border))] bg-white px-6 py-2.5 font-medium text-[hsl(var(--foreground))] transition-smooth hover:bg-[hsl(var(--muted))]">
              {t('popular.go_marketplace')}
            </Link>
          </div>
        )}

        <div className="mt-8 text-center md:hidden">
          <Link to={productsLink} className="inline-flex font-medium text-[hsl(var(--primary))] transition-smooth hover:opacity-80">
            {t('popular.view_all')} -&gt;
          </Link>
        </div>
      </div>
    </section>
  );
};

export default PopularProductsSection;
