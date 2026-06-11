import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import pb from '@/lib/pocketbaseClient.js';
import apiServerClient from '@/lib/apiServerClient.js';
import MarketplaceProductCard from '@/components/MarketplaceProductCard.jsx';
import FilterSection from '@/components/FilterSection.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import {
  appendFilterSearchParams,
  DEFAULT_SHOP_FILTER_DEFINITIONS,
  getActiveFilterEntries,
  getEmptyFilterValues,
  getVisibleFilterDefinitions,
} from '@/lib/shopFilterDefinitions.js';

const heroImage =
  'https://horizons-cdn.hostinger.com/ee44c44d-e3d6-46f2-a1fd-aa631a0ae621/e168444fa4c2e4395f832548af45023f.jpg';

const DEFAULT_FILTERS = getEmptyFilterValues(DEFAULT_SHOP_FILTER_DEFINITIONS);

const MarketplacePage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isSeller } = useAuth();
  const { t, language } = useTranslation();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [filterDefinitions, setFilterDefinitions] = useState(DEFAULT_SHOP_FILTER_DEFINITIONS);

  const currentSort = searchParams.get('sort') || '-created';

  const fetchProducts = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({
        page: '1',
        perPage: '50',
        sort: currentSort,
      });

      appendFilterSearchParams({
        params,
        filters,
        definitions: filterDefinitions,
      });

      const response = await apiServerClient.fetch(`/marketplace/products?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to fetch marketplace products');
      }

      const result = await response.json();
      setProducts(Array.isArray(result.items) ? result.items : []);
      if (Array.isArray(result.filters) && result.filters.length > 0) {
        setFilterDefinitions((current) =>
          JSON.stringify(current) === JSON.stringify(result.filters) ? current : result.filters);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [currentSort, filterDefinitions, filters]);

  useEffect(() => {
    fetchProducts({ showLoading: true });

    const handleFocus = () => fetchProducts();
    window.addEventListener('focus', handleFocus);

    pb.collection('products').subscribe('*', (event) => {
      if (event.action === 'update' && event.record.status === 'sold') {
        setProducts((prev) => prev.filter((product) => product.id !== event.record.id));
      } else if (event.action === 'create' && event.record.status === 'active') {
        fetchProducts();
      } else if (event.action === 'update' && event.record.status === 'active') {
        fetchProducts();
      } else if (event.action === 'delete') {
        setProducts((prev) => prev.filter((product) => product.id !== event.record.id));
      }
    });

    return () => {
      window.removeEventListener('focus', handleFocus);
      pb.collection('products').unsubscribe('*');
    };
  }, [fetchProducts]);

  const handleSortChange = (value) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('sort', value);
    setSearchParams(nextParams);
  };

  const handleSellClick = (e) => {
    e.preventDefault();

    if (!isAuthenticated || !isSeller) {
      navigate('/seller-info');
    } else {
      navigate('/seller/new-product');
    }
  };

  const visibleFilterDefinitions = getVisibleFilterDefinitions(filterDefinitions);
  const activeFilterEntries = getActiveFilterEntries({
    filters,
    definitions: visibleFilterDefinitions,
    language,
  });
  const activeFilterCount = activeFilterEntries.length;
  const hasActiveFilters = activeFilterCount > 0;

  const resultLabel = t('marketplace.product_count', {
    count: products.length,
    label: products.length === 1 ? t('marketplace.product_singular') : t('marketplace.product_plural'),
  });

  return (
    <>
      <Helmet>
        <title>{t('marketplace.title')} - Zahnibörse</title>
      </Helmet>

      <main className="flex-1 bg-[#f7f7f7] pb-16">
        <section className="relative overflow-hidden bg-[#f7f7f7]">
          <div className="absolute inset-x-0 top-0 h-[330px] opacity-[0.08]">
            <img src={heroImage} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="relative mx-auto max-w-[1280px] px-4 pb-16 pt-16 sm:px-6 md:pb-[64px] md:pt-[64px] lg:px-8 xl:px-0">
            <div className="rounded-[20px] bg-white px-6 py-9 shadow-[0_12px_22px_rgba(15,23,42,0.15)] md:px-10 md:py-11">
              <div className="flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 max-w-[760px]">
                  <h1 className="font-serif text-3xl font-bold leading-tight text-[#333] sm:text-[40px] md:text-[52px] lg:whitespace-nowrap">
                    {t('marketplace.title')}
                  </h1>
                  <p className="mt-3 max-w-[560px] text-base leading-7 text-[#666] sm:text-[20px] sm:leading-[1.45]">
                    {t('marketplace.subtitle')}
                  </p>
                </div>

                <Button
                  type="button"
                  onClick={handleSellClick}
                  className="h-[52px] w-full rounded-[8px] bg-[#0000FF] px-7 text-base font-semibold text-white shadow-none hover:bg-[#0000CC] sm:w-auto md:mr-0"
                >
                  {t('marketplace.sell_now')}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section id="marketplace-catalog" className="py-8 md:py-8">
          <div className="mx-auto max-w-[1230px] px-4 sm:px-6 lg:px-8 xl:px-0">
            <div className="grid gap-8 lg:grid-cols-[256px_minmax(0,1fr)]">
              <aside className="hidden lg:block">
                <div className="sticky top-[102px]">
                  <FilterSection filters={filters} filterDefinitions={visibleFilterDefinitions} onFiltersChange={setFilters} />
                </div>
              </aside>

              <div className="min-w-0">
                <div className="rounded-[12px] border border-[#d7d7d7] bg-white px-4 py-4 md:px-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-[#666]">{resultLabel}</p>

                      {hasActiveFilters && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {activeFilterEntries.map((entry) => (
                            <span
                              key={entry.key}
                              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                            >
                              {entry.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <Sheet>
                        <SheetTrigger asChild>
                          <Button
                            variant="outline"
                            className="h-11 rounded-full border-black/10 bg-white px-5 shadow-none hover:bg-slate-50 lg:hidden"
                          >
                            <SlidersHorizontal className="size-4" />
                            {t('marketplace.filter')}
                            {activeFilterCount > 0 && (
                              <span className="rounded-full bg-[#0000FF]/10 px-2 py-0.5 text-xs font-semibold text-[#0000FF]">
                                {activeFilterCount}
                              </span>
                            )}
                          </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-[min(92vw,400px)] border-r border-black/5 p-0">
                          <SheetHeader className="border-b border-black/5 px-6 py-5">
                            <SheetTitle>{t('marketplace.adjust_filters')}</SheetTitle>
                          </SheetHeader>
                          <div className="p-6">
                            <FilterSection filters={filters} filterDefinitions={visibleFilterDefinitions} onFiltersChange={setFilters} className="border-0 shadow-none" />
                          </div>
                        </SheetContent>
                      </Sheet>

                      {hasActiveFilters && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setFilters(getEmptyFilterValues(visibleFilterDefinitions))}
                          className="h-11 rounded-full px-4 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        >
                          {t('marketplace.reset_filters')}
                        </Button>
                      )}

                      <Select value={currentSort} onValueChange={handleSortChange}>
                        <SelectTrigger className="h-9 w-full rounded-[7px] border-[#333] bg-white px-3 text-[15px] shadow-none sm:w-[180px]">
                          <SelectValue placeholder={t('marketplace.sort_placeholder')} />
                        </SelectTrigger>
                        <SelectContent className="border-black/5 bg-white">
                          <SelectItem value="-created">{t('marketplace.sort_newest')}</SelectItem>
                          <SelectItem value="created">{t('marketplace.sort_oldest')}</SelectItem>
                          <SelectItem value="price">{t('marketplace.sort_price_asc')}</SelectItem>
                          <SelectItem value="-price">{t('marketplace.sort_price_desc')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  {loading ? (
                    <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
                      {[...Array(10)].map((_, index) => (
                        <div key={index} className="overflow-hidden rounded-[12px] border border-[#ddd] bg-white">
                          <div className="aspect-[1.32] animate-pulse bg-[linear-gradient(135deg,#f3f4f6,#e5e7eb)]" />
                          <div className="space-y-3 p-3">
                            <div className="h-3 w-20 animate-pulse rounded-full bg-slate-200" />
                            <div className="h-5 w-3/4 animate-pulse rounded-full bg-slate-200" />
                            <div className="h-5 w-1/2 animate-pulse rounded-full bg-slate-200" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : products.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
                      {products.map((product) => (
                        <MarketplaceProductCard key={product.id} product={product} />
                      ))}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-[12px] border border-[#ddd] bg-white">
                      <div className="p-7 md:p-10 lg:p-12">
                        <h3 className="mt-5 max-w-xl text-3xl font-bold text-slate-900 md:text-4xl">
                          {t('marketplace.empty_title')}
                        </h3>
                        <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
                          {t('marketplace.empty_body')}
                        </p>

                        <div className="mt-8 flex flex-wrap gap-3">
                          <Button
                            type="button"
                            onClick={() => setFilters(getEmptyFilterValues(visibleFilterDefinitions))}
                            className="h-11 rounded-full bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC]"
                          >
                            {t('marketplace.reset_filters')}
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleSellClick}
                            className="h-11 rounded-full border-black/10 bg-white px-6 text-slate-700 shadow-none hover:bg-slate-50"
                          >
                            {t('marketplace.sell_now')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
};

export default MarketplacePage;
