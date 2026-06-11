import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useSearchParams } from 'react-router-dom';
import { PackageSearch, Settings, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet.jsx';
import MarketplaceProductCard from '@/components/MarketplaceProductCard.jsx';
import FilterSection from '@/components/FilterSection.jsx';
import { toast } from 'sonner';
import apiServerClient from '@/lib/apiServerClient.js';
import { subscribeToNewsletter } from '@/lib/newsletterApi.js';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useShopVisibility } from '@/contexts/ShopVisibilityContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import {
  appendFilterSearchParams,
  DEFAULT_SHOP_FILTER_DEFINITIONS,
  getActiveFilterEntries,
  getEmptyFilterValues,
  getVisibleFilterDefinitions,
} from '@/lib/shopFilterDefinitions.js';

const heroImage =
  'https://horizons-cdn.hostinger.com/ee44c44d-e3d6-46f2-a1fd-aa631a0ae621/c6724b6c2ada2b2a8d9bcef122eb7e06.jpg';

const DEFAULT_FILTERS = getEmptyFilterValues(DEFAULT_SHOP_FILTER_DEFINITIONS);

const ShopPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentUser, isAdmin } = useAuth();
  const { shopEnabled, loading: shopVisibilityLoading } = useShopVisibility();
  const { t, language } = useTranslation();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [filterDefinitions, setFilterDefinitions] = useState(DEFAULT_SHOP_FILTER_DEFINITIONS);
  const [email, setEmail] = useState('');
  const [newsletterLoading, setNewsletterLoading] = useState(false);

  const currentSort = searchParams.get('sort') || '-created';

  const loadProducts = useCallback(async ({ showLoading = false } = {}) => {
    if (!shopEnabled) {
      setProducts([]);
      setLoading(false);
      return;
    }

    if (showLoading) {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams({
        page: '1',
        perPage: '100',
        sort: currentSort,
      });

      appendFilterSearchParams({
        params,
        filters,
        definitions: filterDefinitions,
      });

      const response = await apiServerClient.fetch(`/shop/products?${params.toString()}`);

      if (!response.ok) {
        throw new Error('Failed to fetch official shop products');
      }

      const result = await response.json();
      setProducts(Array.isArray(result.items) ? result.items : []);
      if (Array.isArray(result.filters) && result.filters.length > 0) {
        setFilterDefinitions((current) =>
          JSON.stringify(current) === JSON.stringify(result.filters) ? current : result.filters);
      }
    } catch (error) {
      console.error('Failed to load shop products:', error);
      toast.error(t('shop.load_error'));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [currentSort, filterDefinitions, filters, shopEnabled, t]);

  useEffect(() => {
    if (shopVisibilityLoading) return;
    loadProducts({ showLoading: true });
  }, [loadProducts, shopVisibilityLoading]);

  const handleSortChange = (value) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('sort', value);
    setSearchParams(nextParams);
  };

  const handleNewsletterSignup = async (event) => {
    event.preventDefault();

    const targetEmail = currentUser ? currentUser.email : email;
    if (!targetEmail) return;

    setNewsletterLoading(true);
    try {
      await subscribeToNewsletter({
        email: targetEmail,
        fallbackMessage: t('footer.newsletter_error'),
      });
      toast.success(t('footer.newsletter_success'));
      setEmail('');
    } catch (error) {
      console.error('Newsletter error:', error);
      toast.error(t('footer.newsletter_error'));
    } finally {
      setNewsletterLoading(false);
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

  if (!shopVisibilityLoading && !shopEnabled) {
    return (
      <>
        <Helmet>
          <title>{t('shop.meta_title')}</title>
          <meta name="description" content={t('shop.meta_description')} />
        </Helmet>

        <main className="flex-1 bg-[#f7f7f7] px-4 py-12 sm:px-6 lg:px-8">
          <section className="mx-auto flex min-h-[520px] max-w-3xl flex-col items-center justify-center rounded-[8px] border border-black/10 bg-white px-6 py-14 text-center shadow-sm">
            <div className="flex h-16 w-16 items-center justify-center rounded-[8px] bg-[#f1f1ff] text-[#0000FF]">
              <PackageSearch className="h-8 w-8" />
            </div>
            <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#151515] md:text-4xl">
              {t('shop.unavailable_title')}
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[#666666] md:text-base">
              {t('shop.unavailable_body')}
            </p>
            <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
              <Button asChild className="h-11 rounded-[8px] bg-[#0000FF] px-5 text-white shadow-none hover:bg-[#0000CC]">
                <Link to="/marketplace">{t('shop.go_marketplace')}</Link>
              </Button>
              {isAdmin && (
                <Button asChild variant="outline" className="h-11 rounded-[8px] border-black/10 bg-white px-5 shadow-none hover:bg-[#f3f3ff]">
                  <Link to="/admin">
                    <Settings className="h-4 w-4" />
                    {t('shop.admin_manage')}
                  </Link>
                </Button>
              )}
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>{t('shop.meta_title')}</title>
        <meta name="description" content={t('shop.meta_description')} />
      </Helmet>

      <main className="flex-1 bg-white">
        <section className="relative min-h-[300px] overflow-hidden">
          <img
            src={heroImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-[0.3]"
          />
          <div className="absolute inset-0 bg-white/35" />
          <div className="relative mx-auto flex min-h-[300px] max-w-[920px] flex-col items-center justify-center px-4 py-12 text-center sm:px-6">
            <h1 className="font-serif text-[36px] font-bold leading-tight text-[#101827] md:text-[46px]">
              {t('shop.title')}
            </h1>
            <p className="mt-3 max-w-[560px] text-[15px] font-medium leading-6 text-[#101827] md:text-[17px]">
              {t('shop.subtitle')}
            </p>
          </div>
        </section>

        <section id="shop-catalog" className="bg-[#f7f7f7] py-8 md:py-8">
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
                      <div className="p-7 text-center md:p-10 lg:p-12 lg:text-left">
                        <h3 className="mt-5 max-w-xl text-3xl font-bold text-slate-900 md:text-4xl">
                          {t('shop.coming_soon')}
                        </h3>
                        <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
                          {t('shop.coming_soon_body')}
                        </p>

                        {hasActiveFilters && (
                          <div className="mt-8">
                            <Button
                              type="button"
                              onClick={() => setFilters(getEmptyFilterValues(visibleFilterDefinitions))}
                              className="h-11 rounded-full bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC]"
                            >
                              {t('marketplace.reset_filters')}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="shop-newsletter" className="bg-white py-24 md:py-[100px]">
          <div className="mx-auto max-w-[760px] px-4 text-center sm:px-6">
            <h2 className="font-serif text-[28px] font-bold leading-tight text-[#101827] md:text-[34px]">
              {t('shop.newsletter_title')}
            </h2>
            <p className="mt-5 text-[16px] leading-6 text-[#334155]">
              {t('shop.newsletter_body')}
            </p>

            <form
              onSubmit={handleNewsletterSignup}
              className="mx-auto mt-10 flex w-full max-w-[446px] flex-col gap-3 rounded-[14px] bg-[#eef1f9] p-6 shadow-[0_14px_28px_rgba(15,23,42,0.12)]"
            >
              {!currentUser && (
                <Input
                  type="email"
                  placeholder={t('shop.email_placeholder')}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className="h-10 rounded-[6px] border-[#d5d9e5] bg-white px-3 text-[13px] text-[#101827] shadow-none placeholder:text-[#8a94a6] focus-visible:ring-2 focus-visible:ring-[#0000FF] focus-visible:ring-offset-0"
                />
              )}
              <Button
                type="submit"
                disabled={newsletterLoading}
                className="h-12 w-full rounded-[4px] bg-[#0000FF] px-4 text-[14px] font-bold text-white shadow-none hover:bg-[#0000CC]"
              >
                {newsletterLoading
                  ? t('footer.subscribing')
                  : currentUser
                    ? t('footer.subscribe_current')
                    : t('footer.subscribe')}
              </Button>
            </form>
          </div>
        </section>
      </main>
    </>
  );
};

export default ShopPage;
