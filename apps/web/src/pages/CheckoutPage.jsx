import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  LockKeyhole,
  Mail,
  MapPin,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  ShoppingBag,
  Truck,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Checkbox } from '@/components/ui/checkbox.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useCart } from '@/contexts/CartContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import apiServerClient from '@/lib/apiServerClient.js';
import pb from '@/lib/pocketbaseClient.js';
import { getProductImageUrl as resolveProductImageUrl } from '@/lib/productImages.js';

const getProductImageUrl = (product) => {
  if (!product) return '';
  return resolveProductImageUrl(product) || '';
};

const CheckoutPage = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { cartItems, getSubtotal, getTotal, SHIPPING_FEE, SERVICE_FEE, itemCount } = useCart();
  const { t, language } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [agbAccepted, setAgbAccepted] = useState(false);
  const [datenschutzAccepted, setDatenschutzAccepted] = useState(false);
  const [newsletterAccepted, setNewsletterAccepted] = useState(false);
  const [shippingAddress, setShippingAddress] = useState({
    name: currentUser?.name || '',
    email: currentUser?.email || '',
    street: '',
    city: '',
    postal_code: '',
    country: 'DE',
  });

  const formatPrice = (value) =>
    new Intl.NumberFormat(language === 'DE' ? 'de-DE' : 'en-US', {
      style: 'currency',
      currency: 'EUR',
    }).format(Number(value || 0));

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

  const checkoutSteps = [
    {
      Icon: MapPin,
      title: t('checkout.shipping_address'),
      body: t('checkout.delivery_body'),
    },
    {
      Icon: ShieldCheck,
      title: t('checkout.legal_confirmations'),
      body: t('checkout.legal_body'),
    },
    {
      Icon: LockKeyhole,
      title: t('checkout.secure_payment_title'),
      body: t('checkout.stripe_note'),
    },
  ];

  const handleInputChange = (event) => {
    setShippingAddress((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

  const getCheckoutErrorMessage = (status, errorData = {}) => {
    const code = String(errorData.code || '').trim();

    if (status === 401) return t('checkout.auth_required');
    if (code === 'LEGAL_ACCEPTANCE_REQUIRED') return t('checkout.accept_toast');
    if (code === 'MISSING_REQUIRED_FIELDS') return t('checkout.required_toast');
    if (code === 'INVALID_CART_ITEMS') return t('checkout.invalid_cart');
    if (code === 'METADATA_TOO_LARGE') return t('checkout.session_error');
    if (code === 'PAYMENT_SESSION_CREATE_FAILED') return t('checkout.session_error');

    return errorData.error || errorData.message || t('checkout.payment_error');
  };

  const handleCheckout = async (event) => {
    event.preventDefault();

    if (cartItems.length === 0) {
      toast.error(t('checkout.empty_toast'));
      return;
    }

    if (!agbAccepted || !datenschutzAccepted) {
      toast.error(t('checkout.accept_toast'));
      return;
    }

    if (!shippingAddress.name || !shippingAddress.street || !shippingAddress.city || !shippingAddress.postal_code) {
      toast.error(t('checkout.required_toast'));
      return;
    }

    setLoading(true);

    try {
      const authToken = pb.authStore.token;

      if (!authToken) {
        setLoading(false);
        toast.error(t('checkout.auth_required'));
        navigate('/auth');
        return;
      }

      const response = await apiServerClient.fetch('/checkout/create-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          buyer_id: currentUser?.id,
          buyer_name: currentUser?.name || shippingAddress.name,
          buyer_email: currentUser?.email || shippingAddress.email,
          shipping_address: {
            ...shippingAddress,
            country: shippingAddress.country?.trim() || 'DE',
          },
          cart_items: cartItems,
          acceptedTerms: agbAccepted,
          acceptedPrivacy: datenschutzAccepted,
          newsletterOptIn: newsletterAccepted,
        }),
      });

      if (response.status === 401) {
        setLoading(false);
        toast.error(t('checkout.auth_required'));
        navigate('/auth');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(getCheckoutErrorMessage(response.status, errorData));
      }

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      throw new Error(t('checkout.no_url'));
    } catch (error) {
      console.error('Checkout error:', error);
      toast.error(error.message || t('checkout.payment_error'));
      setLoading(false);
    }
  };

  if (cartItems.length === 0) {
    return (
      <>
        <Helmet>
          <title>{`${t('checkout.title')} - Zahnibörse`}</title>
        </Helmet>

        <main className="flex-1 bg-[#f6f7f9] px-4 py-10 sm:px-6 md:py-14 lg:px-8">
          <section className="mx-auto flex min-h-[460px] max-w-3xl flex-col items-center justify-center rounded-[8px] border border-dashed border-black/15 bg-white px-6 py-14 text-center shadow-sm">
            <div className="flex h-16 w-16 items-center justify-center rounded-[8px] border border-[#0000FF]/20 bg-[#f1f1ff] text-[#0000FF]">
              <CreditCard className="h-8 w-8" />
            </div>
            <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#151515] md:text-4xl">
              {t('cart.empty_title')}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#666666] md:text-base">
              {t('checkout.empty_toast')}
            </p>
            <Button
              type="button"
              onClick={() => navigate('/marketplace')}
              className="mt-8 h-11 rounded-[8px] bg-[#0000FF] px-5 text-white shadow-none hover:bg-[#0000CC]"
            >
              <ShoppingBag className="h-4 w-4" />
              {t('checkout.back_marketplace')}
            </Button>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>{`${t('checkout.title')} - Zahnibörse`}</title>
      </Helmet>

      <main className="flex-1 bg-[#f6f7f9] px-4 py-8 sm:px-6 md:py-12 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <header className="mb-6 rounded-[8px] border border-black/10 bg-white p-5 shadow-sm md:p-6">
            <button
              type="button"
              onClick={() => navigate('/cart')}
              className="inline-flex items-center gap-2 text-sm font-semibold text-[#666666] transition-colors hover:text-[#0000FF]"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('cart.title')}
            </button>

            <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <Badge className="rounded-[8px] bg-[#f1f1ff] px-3 py-1 text-xs font-semibold text-[#0000FF] shadow-none hover:bg-[#f1f1ff]">
                  {t('checkout.title')}
                </Badge>
                <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#151515] md:text-4xl">
                  {t('checkout.submit')}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[#666666] md:text-base">
                  {t('checkout.page_subtitle')}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:max-w-xl">
                {checkoutSteps.map(({ Icon, title, body }) => (
                  <div key={title} className="rounded-[8px] border border-black/10 bg-[#f7f7f7] p-4">
                    <Icon className="h-5 w-5 text-[#0000FF]" />
                    <p className="mt-3 text-sm font-semibold text-[#151515]">{title}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#666666]">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            <section className="min-w-0">
              <form
                id="checkout-form"
                onSubmit={handleCheckout}
                className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm md:p-6"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#f1f1ff] text-[#0000FF]">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <h2 className="text-2xl font-bold text-[#151515]">{t('checkout.shipping_address')}</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-[#666666]">{t('checkout.delivery_body')}</p>
                  </div>
                  <Badge variant="outline" className="w-fit rounded-[8px] border-black/10 bg-white px-3 py-1 text-xs text-[#666666] shadow-none">
                    {t('checkout.required')}
                  </Badge>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="name">{t('checkout.full_name')} *</Label>
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8a8a]" />
                      <Input
                        id="name"
                        name="name"
                        value={shippingAddress.name}
                        onChange={handleInputChange}
                        required
                        autoComplete="name"
                        className="h-11 rounded-[8px] border-black/10 bg-white pl-10 shadow-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="email">{t('checkout.email')} *</Label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8a8a]" />
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        value={shippingAddress.email}
                        onChange={handleInputChange}
                        required
                        autoComplete="email"
                        className="h-11 rounded-[8px] border-black/10 bg-white pl-10 shadow-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="street">{t('checkout.street')} *</Label>
                    <Input
                      id="street"
                      name="street"
                      value={shippingAddress.street}
                      onChange={handleInputChange}
                      required
                      autoComplete="street-address"
                      className="h-11 rounded-[8px] border-black/10 bg-white shadow-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="postal_code">{t('checkout.postal_code')} *</Label>
                    <Input
                      id="postal_code"
                      name="postal_code"
                      value={shippingAddress.postal_code}
                      onChange={handleInputChange}
                      required
                      autoComplete="postal-code"
                      className="h-11 rounded-[8px] border-black/10 bg-white shadow-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="city">{t('checkout.city')} *</Label>
                    <Input
                      id="city"
                      name="city"
                      value={shippingAddress.city}
                      onChange={handleInputChange}
                      required
                      autoComplete="address-level2"
                      className="h-11 rounded-[8px] border-black/10 bg-white shadow-none"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="country">{t('checkout.country')} *</Label>
                    <Input
                      id="country"
                      name="country"
                      value={shippingAddress.country}
                      onChange={handleInputChange}
                      required
                      autoComplete="country"
                      className="h-11 rounded-[8px] border-black/10 bg-white shadow-none"
                    />
                  </div>
                </div>
              </form>
            </section>

            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-[8px] border border-black/10 bg-white p-5 shadow-sm md:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#f1f1ff] text-[#0000FF]">
                      <ReceiptText className="h-5 w-5" />
                    </div>
                    <h2 className="text-2xl font-bold text-[#151515]">{t('checkout.order_summary')}</h2>
                    <p className="mt-2 text-sm leading-6 text-[#666666]">{t('checkout.summary_note')}</p>
                  </div>
                  <Badge className="rounded-[8px] bg-[#f1f1ff] px-3 py-1 text-xs font-semibold text-[#0000FF] shadow-none hover:bg-[#f1f1ff]">
                    {itemCount}
                  </Badge>
                </div>

                <section className="mt-6" aria-label={t('checkout.order_items')}>
                  <h3 className="text-sm font-bold text-[#151515]">{t('checkout.order_items')}</h3>
                  <div className="mt-3 max-h-[300px] space-y-3 overflow-y-auto pr-1">
                    {cartItems.map((item) => {
                      const product = item.product || {};
                      const productImageUrl = getProductImageUrl(product);
                      const lineTotal = (Number(product.price) || 0) * (Number(item.quantity) || 1);

                      return (
                        <article key={item.id} className="rounded-[8px] border border-black/10 bg-[#f7f7f7] p-3">
                          <div className="flex gap-3">
                            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-[8px] border border-black/10 bg-white text-[#8a8a8a]">
                              {productImageUrl ? (
                                <img src={productImageUrl} alt={product.name || t('product.untitled')} className="h-full w-full object-cover" />
                              ) : (
                                <PackageCheck className="m-5 h-5 w-5" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-sm font-semibold text-[#151515]">{product.name || t('product.untitled')}</p>
                              <p className="mt-1 text-xs text-[#666666]">{t('common.quantity')}: {item.quantity}</p>
                              <p className="mt-2 text-sm font-bold text-[#0000FF]">{formatPrice(lineTotal)}</p>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>

                <dl className="mt-6 space-y-3 border-t border-black/10 pt-5">
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

                <section className="mt-6 rounded-[8px] border border-black/10 bg-white p-4" aria-label={t('checkout.legal_confirmations')}>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#0000FF]" />
                    <div>
                      <h3 className="text-sm font-bold text-[#151515]">{t('checkout.legal_confirmations')}</h3>
                      <p className="mt-1 text-xs leading-5 text-[#666666]">{t('checkout.legal_body')}</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="flex items-start gap-3 rounded-[8px] bg-[#f7f7f7] p-3">
                      <Checkbox
                        id="agb"
                        checked={agbAccepted}
                        onCheckedChange={(checked) => setAgbAccepted(checked === true)}
                        className="mt-1"
                      />
                      <Label htmlFor="agb" className="cursor-pointer text-sm font-normal leading-6 text-[#666666]">
                        {t('checkout.accept_terms')}{' '}
                        <a href="/agb" target="_blank" rel="noreferrer" className="font-semibold text-[#0000FF] hover:underline">
                          {t('checkout.terms')}
                        </a>
                        . <span className="font-semibold text-red-600">*</span>
                      </Label>
                    </div>

                    <div className="flex items-start gap-3 rounded-[8px] bg-[#f7f7f7] p-3">
                      <Checkbox
                        id="datenschutz"
                        checked={datenschutzAccepted}
                        onCheckedChange={(checked) => setDatenschutzAccepted(checked === true)}
                        className="mt-1"
                      />
                      <Label htmlFor="datenschutz" className="cursor-pointer text-sm font-normal leading-6 text-[#666666]">
                        {t('checkout.accept_privacy')}{' '}
                        <a
                          href="/datenschutz"
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-[#0000FF] hover:underline"
                        >
                          {t('checkout.privacy')}
                        </a>
                        . <span className="font-semibold text-red-600">*</span>
                      </Label>
                    </div>

                    <div className="flex items-start gap-3 rounded-[8px] bg-[#f7f7f7] p-3">
                      <Checkbox
                        id="newsletter"
                        checked={newsletterAccepted}
                        onCheckedChange={(checked) => setNewsletterAccepted(checked === true)}
                        className="mt-1"
                      />
                      <Label htmlFor="newsletter" className="cursor-pointer text-sm font-normal leading-6 text-[#666666]">
                        {t('checkout.newsletter')}{' '}
                        <span className="text-xs font-semibold text-[#777777]">({t('checkout.optional')})</span>
                      </Label>
                    </div>
                  </div>
                </section>

                <section className="mt-6 rounded-[8px] border border-[#0000FF]/20 bg-[#f1f1ff] p-4">
                  <div className="flex items-start gap-3">
                    <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-[#0000FF]" />
                    <p className="text-sm leading-6 text-[#30306d]">{t('checkout.final_note')}</p>
                  </div>
                  <Button
                    type="submit"
                    form="checkout-form"
                    className="mt-4 h-12 w-full rounded-[8px] bg-[#0000FF] text-white shadow-none hover:bg-[#0000CC]"
                    disabled={loading || !agbAccepted || !datenschutzAccepted}
                  >
                    <CreditCard className="h-4 w-4" />
                    {loading ? t('checkout.processing') : t('checkout.submit')}
                  </Button>
                </section>

                <div className="mt-4 flex items-start gap-3 rounded-[8px] border border-black/10 bg-[#f7f7f7] p-4">
                  <Truck className="mt-0.5 h-4 w-4 shrink-0 text-[#0000FF]" />
                  <p className="text-xs leading-5 text-[#666666]">{t('help.shipping_body')}</p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
};

export default CheckoutPage;
