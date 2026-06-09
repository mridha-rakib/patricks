import React, { useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { Heart, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { toast } from 'sonner';
import { getProductImageUrl } from '@/lib/productImages.js';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useFavorites } from '@/contexts/FavoritesContext.jsx';
import { useShopVisibility } from '@/contexts/ShopVisibilityContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';

const FavoritesPage = () => {
  const { isAuthenticated } = useAuth();
  const { favorites, loading, loadFavorites, removeFromFavorites } = useFavorites();
  const { shopEnabled } = useShopVisibility();
  const { t } = useTranslation();
  const visibleFavorites = shopEnabled
    ? favorites
    : favorites.filter((fav) => {
        const product = fav.product;
        return product?.source !== 'shop' && product?.collectionName !== 'shop_products';
      });

  useEffect(() => {
    if (isAuthenticated) {
      loadFavorites();
    }
  }, [isAuthenticated, loadFavorites]);

  const handleRemoveFavorite = async (productId) => {
    try {
      await removeFromFavorites(productId);
      toast.success(t('common.remove_favorite'));
    } catch (error) {
      console.error('Error removing favorite:', error);
      toast.error(t('favorites.remove_error'));
    }
  };

  if (!isAuthenticated) {
    return (
      <>
        <Helmet>
          <title>{t('favorites.my_title')} - Zahnibörse</title>
        </Helmet>
        <main className="flex-1 bg-[hsl(var(--muted-bg))] py-12 min-h-[80vh] flex items-center justify-center">
          <div className="max-w-md mx-auto px-4 text-center bg-white p-8 rounded-[var(--radius-lg)] border border-[hsl(var(--border))] shadow-sm">
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Heart className="text-[#0000FF]" size={32} />
            </div>
            <h2 className="text-2xl font-bold mb-3 font-['Playfair_Display']">{t('seller.login_prompt_title')}</h2>
            <p className="text-[hsl(var(--secondary-text))] mb-8">
              {t('favorites.login_body')}
            </p>
            <Link to="/auth">
              <Button className="bg-[#0000FF] hover:bg-[#0000CC] text-white w-full min-h-[44px]">
                {t('favorites.login')}
              </Button>
            </Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>{t('favorites.my_title')} - Zahnibörse</title>
      </Helmet>

      <main className="flex-1 bg-[hsl(var(--muted-bg))] py-8 md:py-12 min-h-[80vh]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3 mb-6 md:mb-8">
            <Heart className="text-[#0000FF] fill-[#0000FF]" size={28} />
            <h1 className="text-2xl md:text-3xl font-bold font-['Playfair_Display']">{t('favorites.my_title')}</h1>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="overflow-hidden border-none shadow-sm animate-pulse">
                  <div className="aspect-square bg-gray-200"></div>
                  <CardContent className="p-4 space-y-3">
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-6 bg-gray-200 rounded w-1/2"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : visibleFavorites.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
              {visibleFavorites.map((fav) => {
                const product = fav.product;
                if (!product) return null;
                const isShopProduct = product.source === 'shop' || product.collectionName === 'shop_products';
                const productLink = `/product/${product.id}${isShopProduct ? '?type=shop' : ''}`;
                const productImageUrl = getProductImageUrl(product);

                return (
                  <Card key={fav.id} className="overflow-hidden hover:shadow-hover transition-all duration-300 border border-[hsl(var(--border))] flex flex-col">
                    <div className="aspect-square bg-[hsl(var(--muted-bg))] relative overflow-hidden group">
                      {productImageUrl ? (
                        <img
                          src={productImageUrl}
                          alt={product.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">{t('product.no_image')}</div>
                      )}
                      <button 
                        onClick={(e) => {
                          e.preventDefault();
                          handleRemoveFavorite(product.id);
                        }}
                        className="absolute top-3 right-3 bg-white/90 p-2 rounded-full text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors shadow-sm"
                        aria-label={t('common.remove_favorite')}
                      >
                        <Trash2 size={18} />
                      </button>
                      {product.condition && (
                        <Badge className="absolute top-3 left-3 bg-white/90 text-black hover:bg-white shadow-sm">
                          {product.condition}
                        </Badge>
                      )}
                    </div>
                    <CardContent className="p-4 flex flex-col flex-1">
                      <h3 className="font-['Playfair_Display'] font-semibold text-base md:text-lg mb-2 line-clamp-2">{product.name}</h3>
                      <div className="mt-auto pt-4 flex items-center justify-between">
                        <p className="text-lg md:text-xl font-bold text-[#0000FF]">€{Number(product.price || 0).toFixed(2)}</p>
                        <Link to={productLink}>
                          <Button size="sm" className="bg-[#0000FF] hover:bg-[#0000CC] text-white min-h-[36px] md:min-h-[40px]">
                            {t('shop.details')}
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 md:py-24 bg-white rounded-[var(--radius-lg)] border border-[hsl(var(--border))] shadow-sm">
              <div className="max-w-md mx-auto flex flex-col items-center px-4">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-6">
                  <Heart className="text-[#0000FF]" size={32} />
                </div>
                <h3 className="text-xl md:text-2xl font-semibold mb-3 font-['Playfair_Display']">{t('favorites.empty_title')}</h3>
                <p className="text-[hsl(var(--secondary-text))] mb-8 text-sm md:text-base">
                  {t('favorites.empty_body')}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                  {shopEnabled && (
                    <Link to="/shop" className="w-full sm:w-auto">
                      <Button className="bg-[#0000FF] hover:bg-[#0000CC] text-white w-full min-h-[44px]">{t('popular.go_shop')}</Button>
                    </Link>
                  )}
                  <Link to="/marketplace" className="w-full sm:w-auto">
                    <Button variant="outline" className="w-full min-h-[44px]">{t('cart.go_marketplace')}</Button>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
};

export default FavoritesPage;
