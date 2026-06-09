import React from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  BadgeCheck,
  CreditCard,
  Minus,
  PackageCheck,
  Pencil,
  Plus,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { useCart } from '@/contexts/CartContext.jsx';
import { useShopVisibility } from '@/contexts/ShopVisibilityContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import { getProductImageUrl as resolveProductImageUrl } from '@/lib/productImages.js';

const getProductImageUrl = (product) => {
  if (!product) return '';
  return resolveProductImageUrl(product) || '';
};

const getProductTitle = (product, fallback) => product?.name || product?.title || fallback;

const getProductPath = (item) => {
  const typeSuffix = item.product_type === 'shop' ? '?type=shop' : '';
  return `/product/${item.product_id || item.product?.id}${typeSuffix}`;
};

const CartPage = () => {
  const navigate = useNavigate();
  const {
    cartItems,
    removeFromCart,
    updateQuantity,
    getSubtotal,
    getTotal,
    SHIPPING_FEE,
    SERVICE_FEE,
    itemCount,
  } = useCart();
  const { shopEnabled } = useShopVisibility();
  const { t, language } = useTranslation();
  const canSeeShop = shopEnabled;

  const locale = language === 'DE' ? 'de-DE' : 'en-US';
  const formatPrice = (value) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
    }).format(Number(value || 0));

  const cartCountLabel = t('cart.count_label', { count: itemCount });
  const summaryRows = [
    {
      label: t('cart.subtotal'),
      value: formatPrice(getSubtotal()),
    },
    {
      label: t('cart.shipping'),
      value: formatPrice(SHIPPING_FEE),
    },
    {
      label: t('cart.service_fee'),
      value: formatPrice(SERVICE_FEE),
    },
  ];

  const trustItems = [
    {
      Icon: ShieldCheck,
      title: t('info.secure_title'),
      body: t('checkout.stripe_note'),
    },
    {
      Icon: Truck,
      title: t('cart.shipping'),
      body: t('help.shipping_body'),
    },
    {
      Icon: BadgeCheck,
      title: t('popular.verified'),
      body: t('shop.subtitle'),
    },
  ];

  if (cartItems.length === 0) {
    return (
      <>
        <Helmet>
          <title>{`${t('cart.title')} - Zahniboerse`}</title>
        </Helmet>

        <main className="flex-1 bg-[#f6f7f9] px-4 py-10 sm:px-6 md:py-14 lg:px-8">
          <section className="mx-auto flex min-h-[460px] max-w-3xl flex-col items-center justify-center rounded-[8px] border border-dashed border-black/15 bg-white px-6 py-14 text-center shadow-sm">
            <div className="flex h-16 w-16 items-center justify-center rounded-[8px] border border-[#0000FF]/20 bg-[#f1f1ff] text-[#0000FF]">
              <PackageCheck className="h-8 w-8" />
            </div>
            <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#151515] md:text-4xl">
              {t('cart.empty_title')}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#666666] md:text-base">
              {t('cart.empty_desc')}
            </p>
            <div className="mt-8 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
              <Button
                type="button"
                onClick={() => navigate('/marketplace')}
                className="h-11 rounded-[8px] bg-[#0000FF] px-5 text-white shadow-none hover:bg-[#0000CC]"
              >
                <ShoppingBag className="h-4 w-4" />
                {t('cart.go_marketplace')}
              </Button>
              {canSeeShop && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/shop')}
                  className="h-11 rounded-[8px] border-black/10 bg-white px-5 shadow-none hover:bg-[#f3f3ff]"
                >
                  {t('nav.shop')}
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
        <title>{`${t('cart.title')} - Zahniboerse`}</title>
      </Helmet>

      <main className="flex-1 bg-[#f6f7f9] px-4 py-8 sm:px-6 md:py-12 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <header className="mb-6 rounded-[8px] border border-black/10 bg-white p-5 shadow-sm md:p-6">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#666666] transition-colors hover:text-[#0000FF]"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('product.back')}
            </button>

            <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl">
                <Badge className="rounded-[8px] bg-[#f1f1ff] px-3 py-1 text-xs font-semibold text-[#0000FF] shadow-none hover:bg-[#f1f1ff]">
                  {cartCountLabel}
                </Badge>
                <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#151515] md:text-4xl">
                  {t('cart.title')}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#666666] md:text-base">
                  {t('cart.page_subtitle')}
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/marketplace')}
                className="h-11 rounded-[8px] border-black/10 bg-white px-5 shadow-none hover:bg-[#f3f3ff] md:self-end"
              >
                <ShoppingBag className="h-4 w-4" />
                {t('cart.continue')}
              </Button>
            </div>
          </header>

          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-4">
              <div className="rounded-[8px] border border-black/10 bg-white p-4 shadow-sm md:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-[#151515]">{t('cart.items_title')}</h2>
                    <p className="mt-1 text-sm text-[#666666]">{t('cart.items_body')}</p>
                  </div>
                  <p className="text-sm font-semibold text-[#0000FF]">{cartCountLabel}</p>
                </div>
              </div>

              {cartItems.map((item) => {
                const product = item.product || {};
                const productTitle = getProductTitle(product, t('product.untitled'));
                const productImageUrl = getProductImageUrl(product);
                const unitPrice = Number(product.price || 0);
                const quantity = Number(item.quantity || 1);
                const lineTotal = unitPrice * quantity;
                const productPath = getProductPath(item);
                const isMarketplaceItem = item.product_type !== 'shop';

                return (
                  <article
                    key={`${item.id}-${item.product_id}`}
                    className="rounded-[8px] border border-black/10 bg-white p-4 shadow-sm transition-colors hover:border-[#0000FF]/25 md:p-5"
                  >
                    <div className="grid gap-4 lg:grid-cols-[132px_minmax(0,1fr)]">
                      <button
                        type="button"
                        onClick={() => navigate(productPath)}
                        className="h-32 w-full overflow-hidden rounded-[8px] border border-black/10 bg-[#eef0f3] text-[#8a8f98] sm:w-32"
                        aria-label={productTitle}
                      >
                        {productImageUrl ? (
                          <img src={productImageUrl} alt={productTitle} className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.03]" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-sm font-medium">
                            {t('product.no_image')}
                          </span>
                        )}
                      </button>

                      <div className="min-w-0">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                          <div className="min-w-0">
                            <Badge variant="outline" className="rounded-[8px] border-black/10 bg-white px-2.5 py-1 text-xs text-[#666666] shadow-none">
                              {item.product_type === 'shop'
                                ? t('common.shop')
                                : t('cart.by_seller', {
                                    seller: product.seller_username || t('common.seller'),
                                  })}
                            </Badge>
                            <button
                              type="button"
                              onClick={() => navigate(productPath)}
                              className="mt-3 block text-left text-xl font-semibold leading-tight text-[#151515] transition-colors hover:text-[#0000FF]"
                            >
                              {productTitle}
                            </button>
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#666666]">
                              {product.description || t('product.no_description')}
                            </p>
                          </div>

                          <div className="flex shrink-0 gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => navigate(productPath)}
                              className="h-9 rounded-[8px] border-black/10 bg-white px-3 shadow-none hover:bg-[#f3f3ff]"
                            >
                              <Pencil className="h-4 w-4" />
                              {t('seller.edit')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => removeFromCart(item.id, item.product_id)}
                              className="h-9 rounded-[8px] border-red-200 bg-white px-3 text-red-600 shadow-none hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                              {t('seller.delete')}
                            </Button>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-3 border-t border-black/10 pt-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#777777]">{t('cart.unit_price')}</p>
                            <p className="mt-1 text-lg font-bold text-[#151515]">{formatPrice(unitPrice)}</p>
                          </div>

                          {isMarketplaceItem ? (
                            <div className="w-fit rounded-[8px] border border-black/10 bg-[#f7f7f7] px-4 py-3 text-sm font-semibold text-[#666666]">
                              {t('common.quantity')}: 1
                            </div>
                          ) : (
                            <div className="flex w-fit items-center rounded-[8px] border border-black/10 bg-[#f7f7f7] p-1">
                              <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-[6px] text-[#666666] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => updateQuantity(item.id, item.product_id, quantity - 1)}
                                disabled={quantity <= 1}
                                aria-label={t('cart.decrease_quantity')}
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="w-10 text-center text-sm font-bold text-[#151515]" aria-label={t('common.quantity')}>
                                {quantity}
                              </span>
                              <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-[6px] text-[#666666] transition-colors hover:bg-white"
                                onClick={() => updateQuantity(item.id, item.product_id, quantity + 1)}
                                aria-label={t('cart.increase_quantity')}
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          )}

                          <div className="md:text-right">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#777777]">{t('cart.line_total')}</p>
                            <p className="mt-1 text-2xl font-bold text-[#0000FF]">{formatPrice(lineTotal)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#f1f1ff] text-[#0000FF]">
                      <ReceiptText className="h-5 w-5" />
                    </div>
                    <h2 className="text-2xl font-bold text-[#151515]">{t('checkout.order_summary')}</h2>
                    <p className="mt-2 text-sm leading-6 text-[#666666]">{t('cart.order_note')}</p>
                  </div>
                  <Badge className="rounded-[8px] bg-[#f1f1ff] px-3 py-1 text-xs font-semibold text-[#0000FF] shadow-none hover:bg-[#f1f1ff]">
                    {itemCount}
                  </Badge>
                </div>

                <dl className="mt-6 space-y-3">
                  {summaryRows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
                      <dt className="text-[#666666]">{row.label}</dt>
                      <dd className="font-semibold text-[#151515]">{row.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="mt-5 border-t border-black/10 pt-5">
                  <div className="flex items-end justify-between gap-4">
                    <span className="text-sm font-bold text-[#151515]">{t('common.total')}</span>
                    <span className="text-3xl font-bold text-[#0000FF]">{formatPrice(getTotal())}</span>
                  </div>
                </div>

                <div className="mt-6 space-y-3">
                  <Button
                    type="button"
                    size="lg"
                    className="h-12 w-full rounded-[8px] bg-[#0000FF] text-white shadow-none hover:bg-[#0000CC]"
                    onClick={() => navigate('/checkout')}
                  >
                    <CreditCard className="h-4 w-4" />
                    {t('cart.checkout')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full rounded-[8px] border-black/10 bg-white shadow-none hover:bg-[#f3f3ff]"
                    onClick={() => navigate('/marketplace')}
                  >
                    {t('cart.continue')}
                  </Button>
                </div>

                <div className="mt-6 grid gap-3">
                  {trustItems.map(({ Icon, title, body }) => (
                    <div key={title} className="flex gap-3 rounded-[8px] border border-black/10 bg-[#f7f7f7] p-4">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#0000FF]" />
                      <div>
                        <p className="text-sm font-semibold text-[#151515]">{title}</p>
                        <p className="mt-1 text-xs leading-5 text-[#666666]">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </section>
        </div>
      </main>
    </>
  );
};

export default CartPage;
