import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, CreditCard, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Checkbox } from '@/components/ui/checkbox.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import {
  createLearningBillingPortal,
  createLearningCheckout,
  getLearningDashboard,
  getLearningPackage,
  validateLearningCoupon,
} from '@/lib/learningApi.js';
import { localizeLearningDashboard, localizeLearningPackage } from '@/lib/learningContentLocalization.js';
import {
  formatLearningPrice,
  getBillingIntervalLabel,
  getNextChargeCopy,
  getPriceIntervalLabel,
} from '@/lib/learningPresentation.js';
import {
  getSubscriptionDateLabelKey,
  getSubscriptionDisplayEndDate,
  getSubscriptionStatusHintKey,
  getSubscriptionStatusLabel,
  getSubscriptionStatusToneClass,
} from '@/lib/subscriptionStatus.js';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import pb from '@/lib/pocketbaseClient.js';
import { toast } from 'sonner';

const formatDate = (value, locale) => {
  if (!value) return '--';
  return new Date(value).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const LearningCheckoutPage = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();
  const { t, language } = useTranslation();
  const [packageData, setPackageData] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [billingCycle, setBillingCycle] = useState(searchParams.get('cycle') === 'year' ? 'year' : 'month');
  const [couponCode, setCouponCode] = useState('');
  const [couponApplying, setCouponApplying] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);

  useEffect(() => {
    let active = true;
    const token = pb.authStore.token;

    const load = async () => {
      try {
        const packageResult = await getLearningPackage(slug);
        const dashboardResult = token ? await getLearningDashboard(token) : null;

        if (!active) return;

        setPackageData(localizeLearningPackage(packageResult, language));
        setDashboard(localizeLearningDashboard(dashboardResult, language));

        const supportedBilling = packageResult?.billingOptions?.some((item) => item.id === billingCycle);
        if (!supportedBilling) {
          setBillingCycle(packageResult?.billingOptions?.[0]?.id || 'month');
        }
      } catch (error) {
        console.error('Failed to load learning checkout page:', error);
        if (active) {
          toast.error(error.message || t('learning.load_error'));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [language, navigate, slug, t]);

  useEffect(() => {
    setAppliedCoupon(null);
  }, [billingCycle]);

  const locale = language === 'DE' ? 'de-DE' : 'en-US';
  const paymentState = searchParams.get('payment');
  const activeBillingOption = packageData?.billingOptions?.find((item) => item.id === billingCycle) || packageData?.billingOptions?.[0];
  const activePrice = activeBillingOption?.priceAmount || packageData?.priceAmount || 0;
  const activeInterval = activeBillingOption?.interval || billingCycle;
  const normalizedCouponCode = couponCode.trim().toUpperCase();
  const appliedCouponCode = appliedCoupon?.coupon?.code || '';
  const hasAppliedCoupon = Boolean(appliedCouponCode) && appliedCouponCode === normalizedCouponCode;
  const isFreeCheckout = hasAppliedCoupon && appliedCoupon?.isFree === true;
  const displayPrice = hasAppliedCoupon ? Number(appliedCoupon.finalAmount || 0) : activePrice;
  const displayDiscount = hasAppliedCoupon ? Number(appliedCoupon.discountAmount || 0) : 0;
  const checkoutEnabled = packageData?.checkoutEnabled !== false;
  const hasManagedSubscription = dashboard?.subscription && dashboard.subscription.packageId === packageData?.id;

  const statusLabel = useMemo(() => getSubscriptionStatusLabel(t, dashboard?.subscription?.status), [dashboard?.subscription?.status, t]);
  const subscriptionStatus = dashboard?.subscription?.status || '';
  const statusHintKey = getSubscriptionStatusHintKey(subscriptionStatus);
  const dateLabelKey = getSubscriptionDateLabelKey(dashboard?.subscription);
  const displayEndDate = getSubscriptionDisplayEndDate(dashboard?.subscription);
  const formattedDisplayEndDate = formatDate(displayEndDate, locale);
  const nextChargeCopy = isFreeCheckout && !hasManagedSubscription
    ? t('learning.no_payment_details_required')
    : hasManagedSubscription
    ? getNextChargeCopy(t, dashboard.subscription, formatDate(dashboard.subscription.currentPeriodEnd, locale))
    : t('learning.next_charge_after_checkout');
  const canStartCheckout = checkoutEnabled
    && (!hasManagedSubscription || ['expired', 'unpaid', 'paused', 'incomplete', 'incomplete_expired'].includes(subscriptionStatus));
  const primaryLoading = canStartCheckout ? submitting : portalLoading;
  const primaryActionLabel = !checkoutEnabled
    ? (hasManagedSubscription ? t('learning.manage_subscription') : t('learning.checkout_disabled_cta'))
    : subscriptionStatus === 'expired' || subscriptionStatus === 'unpaid' || subscriptionStatus === 'paused'
      ? t('learning.subscribe_again')
      : isFreeCheckout && canStartCheckout
        ? t('learning.complete_free_subscription')
        : hasManagedSubscription
        ? (subscriptionStatus === 'canceled' ? t('learning.reactivate') : t('learning.manage_subscription'))
        : t('learning.subscribe');

  const handleApplyCoupon = async () => {
    const token = pb.authStore.token;
    if (!token || !packageData) {
      navigate('/auth', { state: { from: location } });
      return;
    }

    const code = couponCode.trim();
    if (!code) return;

    setCouponApplying(true);
    try {
      const result = await validateLearningCoupon({
        token,
        packageSlug: packageData.slug,
        billingCycle,
        couponCode: code,
      });
      setAppliedCoupon(result);
      setCouponCode(result.coupon?.code || code.toUpperCase());
      toast.success(result.isFree ? t('learning.coupon_free_success') : t('learning.coupon_applied'));
    } catch (error) {
      console.error('Failed to apply learning coupon:', error);
      setAppliedCoupon(null);
      toast.error(error.message || t('learning.coupon_invalid'));
    } finally {
      setCouponApplying(false);
    }
  };

  const handleCheckout = async () => {
    const token = pb.authStore.token;
    if (!token || !packageData) {
      navigate('/auth', { state: { from: location } });
      return;
    }

    if (!termsAccepted || !privacyAccepted) {
      toast.error(t('checkout.accept_toast'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await createLearningCheckout({
        token,
        packageSlug: packageData.slug,
        billingCycle,
        couponCode: hasAppliedCoupon ? appliedCouponCode : '',
        acceptedTerms: termsAccepted,
        acceptedPrivacy: privacyAccepted,
        newsletterOptIn,
      });

      if (result.freeSubscription) {
        toast.success(t('learning.free_subscription_success'));
        navigate('/learning/dashboard?payment=free-coupon');
        return;
      }

      if (!result.url) {
        throw new Error(t('learning.checkout_error'));
      }

      window.location.href = result.url;
    } catch (error) {
      console.error('Failed to create learning checkout:', error);
      toast.error(error.message || t('learning.checkout_error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePortal = async () => {
    const token = pb.authStore.token;
    if (!token) {
      navigate('/auth', { state: { from: location } });
      return;
    }

    setPortalLoading(true);
    try {
      const result = await createLearningBillingPortal({ token });
      if (!result.url) {
        throw new Error(t('learning.portal_error'));
      }

      window.location.href = result.url;
    } catch (error) {
      console.error('Failed to open learning billing portal:', error);
      toast.error(error.message || t('learning.portal_error'));
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f7f7f7] text-slate-500">{t('common.loading')}</div>;
  }

  if (!packageData) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f7f7f7] text-slate-500">{t('learning.package_not_found')}</div>;
  }

  return (
    <>
      <Helmet>
        <title>{`${t('learning.checkout_title')} - Zahnibörse`}</title>
        <meta name="robots" content="noindex,nofollow,noarchive" />
      </Helmet>

      <main className="learning-shell flex-1">
        <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8 md:py-16">
          <Link to={`/learning/packages/${packageData.slug}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-[#0000FF]">
            <ArrowLeft className="size-4" />
            {packageData.title}
          </Link>

          <section className="mt-6 grid gap-8 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="learning-card p-6 md:p-8">
              <Badge className="rounded-[8px] bg-[#0000FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0000FF] shadow-none">
                {t('learning.checkout_title')}
              </Badge>
              <h1 className="mt-5 text-4xl font-bold text-slate-900">{packageData.title}</h1>
              <p className="mt-4 text-base leading-7 text-slate-600">{packageData.subtitle}</p>
              {(packageData.promoBadge || packageData.promoText) && (
                <div className="mt-5 rounded-[8px] border border-[#0000FF]/14 bg-[#f6f7ff] p-4">
                  {packageData.promoBadge && (
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0000FF]">{packageData.promoBadge}</p>
                  )}
                  {packageData.promoText && <p className="mt-2 text-sm leading-6 text-slate-600">{packageData.promoText}</p>}
                </div>
              )}

              {paymentState === 'cancelled' && (
                <div className="mt-6 rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  {t('learning.payment_cancelled')}
                </div>
              )}

              {paymentState === 'success' && (
                <div className="mt-6 rounded-[8px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  {t('learning.payment_success')}
                </div>
              )}

              {!checkoutEnabled && !hasManagedSubscription && (
                <div className="mt-6 rounded-[8px] border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  {t('learning.checkout_disabled_body')}
                </div>
              )}

              {statusHintKey && (
                <div className={`mt-6 rounded-[8px] border p-4 text-sm ${getSubscriptionStatusToneClass(subscriptionStatus)}`}>
                  {t(statusHintKey)}
                </div>
              )}

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                <div className="learning-subtle-card p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('learning.payment_status')}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{statusLabel}</p>
                </div>
                <div className="learning-subtle-card p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t(dateLabelKey)}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{formattedDisplayEndDate}</p>
                </div>
              </div>

              <div className="learning-subtle-card mt-8 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('learning.billing_cycle')}</p>
                <div className="mt-4 grid grid-cols-1 gap-2 rounded-[8px] border border-black/6 bg-white p-2 sm:grid-cols-2">
                  {(packageData.billingOptions || []).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setBillingCycle(option.id)}
                      className={`rounded-[14px] px-3 py-3 text-sm font-semibold transition-colors ${
                        billingCycle === option.id ? 'bg-[#0000FF] text-white' : 'text-slate-600 hover:text-[#0000FF]'
                      }`}
                    >
                      {option.id === 'year' ? t('learning.yearly') : t('learning.monthly')}
                    </button>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500">{t('learning.price_label')}</p>
                    <p className="mt-1 text-3xl font-semibold text-slate-900">
                      {formatLearningPrice(displayPrice, packageData.currency, locale)}
                    </p>
                    {hasAppliedCoupon && (
                      <p className="mt-1 text-sm text-slate-500 line-through">
                        {formatLearningPrice(activePrice, packageData.currency, locale)}
                      </p>
                    )}
                  </div>
                  <Badge className="rounded-[8px] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
                    {getBillingIntervalLabel(t, activeInterval)}
                  </Badge>
                </div>
                <div className="mt-5 border-t border-black/6 pt-4 text-sm leading-6 text-slate-600">
                  <p>{t('learning.price_interval_label')}: {getPriceIntervalLabel(t, displayPrice, packageData.currency, activeInterval, locale)}</p>
                  {hasAppliedCoupon && (
                    <p className="mt-1 text-emerald-700">
                      {t('learning.coupon_discount_applied', {
                        code: appliedCouponCode,
                        discount: formatLearningPrice(displayDiscount, packageData.currency, locale),
                      })}
                    </p>
                  )}
                  <p className="mt-1">{nextChargeCopy}</p>
                  <p className="mt-1">
                    {isFreeCheckout
                      ? t('learning.free_subscription_terms')
                      : t('learning.subscription_clear_terms', {
                        price: formatLearningPrice(displayPrice, packageData.currency, locale),
                        interval: getBillingIntervalLabel(t, activeInterval),
                      })}
                  </p>
                </div>
              </div>
            </div>

            <aside className="learning-card p-6 md:p-8">
              <h2 className="text-3xl font-semibold text-slate-900">{t('learning.subscription_summary')}</h2>

              <div className="mt-6 space-y-3">
                <div className="learning-subtle-card flex gap-3 p-4">
                  <CreditCard className="mt-0.5 size-5 shrink-0 text-[#0000FF]" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t('learning.price_interval_label')}</p>
                    <p className="mt-1 text-sm text-slate-600">{getPriceIntervalLabel(t, displayPrice, packageData.currency, activeInterval, locale)}</p>
                  </div>
                </div>
                <div className="learning-subtle-card flex gap-3 p-4">
                  <RefreshCw className="mt-0.5 size-5 shrink-0 text-[#0000FF]" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t('learning.next_billing_date')}</p>
                    <p className="mt-1 text-sm text-slate-600">{nextChargeCopy}</p>
                  </div>
                </div>
                <div className="learning-subtle-card flex gap-3 p-4">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#0000FF]" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t('learning.manage_subscription')}</p>
                    <p className="mt-1 text-sm text-slate-600">{t('learning.checkout_cancellation_hint')}</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                {isAuthenticated && checkoutEnabled && canStartCheckout && (
                  <div className="learning-subtle-card p-4">
                    <p className="text-sm font-semibold text-slate-900">{t('learning.coupon_code')}</p>
                    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Input
                        value={couponCode}
                        onChange={(event) => {
                          setCouponCode(event.target.value);
                          setAppliedCoupon(null);
                        }}
                        placeholder={t('learning.coupon_code_placeholder')}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleApplyCoupon}
                        disabled={!couponCode.trim() || couponApplying || hasAppliedCoupon}
                        className="rounded-[8px] border-black/10 bg-white px-5 text-slate-700 shadow-none hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {couponApplying ? t('common.loading') : 'Apply'}
                      </Button>
                    </div>
                    {hasAppliedCoupon && (
                      <p className="mt-3 text-sm font-medium text-emerald-700">
                        {appliedCoupon.isFree ? t('learning.coupon_free_success') : t('learning.coupon_applied')}
                      </p>
                    )}
                  </div>
                )}

                {isAuthenticated && checkoutEnabled && canStartCheckout && (
                  <section className="learning-subtle-card p-4" aria-label={t('checkout.legal_confirmations')}>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">{t('checkout.legal_confirmations')}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{t('checkout.legal_body')}</p>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="flex items-start gap-3 rounded-[8px] bg-white p-3">
                        <Checkbox
                          id="learning-agb"
                          checked={termsAccepted}
                          onCheckedChange={(checked) => setTermsAccepted(checked === true)}
                          className="mt-1"
                        />
                        <Label htmlFor="learning-agb" className="cursor-pointer text-sm font-normal leading-6 text-slate-600">
                          {t('checkout.accept_terms')}{' '}
                          <a href="/agb" target="_blank" rel="noreferrer" className="font-semibold text-[#0000FF] hover:underline">
                            {t('checkout.terms')}
                          </a>
                          . <span className="font-semibold text-red-600">*</span>
                        </Label>
                      </div>

                      <div className="flex items-start gap-3 rounded-[8px] bg-white p-3">
                        <Checkbox
                          id="learning-datenschutz"
                          checked={privacyAccepted}
                          onCheckedChange={(checked) => setPrivacyAccepted(checked === true)}
                          className="mt-1"
                        />
                        <Label htmlFor="learning-datenschutz" className="cursor-pointer text-sm font-normal leading-6 text-slate-600">
                          {t('checkout.accept_privacy')}{' '}
                          <a href="/datenschutz" target="_blank" rel="noreferrer" className="font-semibold text-[#0000FF] hover:underline">
                            {t('checkout.privacy')}
                          </a>
                          . <span className="font-semibold text-red-600">*</span>
                        </Label>
                      </div>

                      <div className="flex items-start gap-3 rounded-[8px] bg-white p-3">
                        <Checkbox
                          id="learning-newsletter"
                          checked={newsletterOptIn}
                          onCheckedChange={(checked) => setNewsletterOptIn(checked === true)}
                          className="mt-1"
                        />
                        <Label htmlFor="learning-newsletter" className="cursor-pointer text-sm font-normal leading-6 text-slate-600">
                          {t('checkout.newsletter')}{' '}
                          <span className="text-xs font-semibold text-slate-500">({t('checkout.optional')})</span>
                        </Label>
                      </div>
                    </div>
                  </section>
                )}

                {isAuthenticated ? (
                  <Button
                    type="button"
                    onClick={canStartCheckout ? handleCheckout : hasManagedSubscription ? handlePortal : undefined}
                    disabled={primaryLoading || (!checkoutEnabled && !hasManagedSubscription) || (canStartCheckout && (!termsAccepted || !privacyAccepted))}
                    className={`h-11 w-full rounded-[8px] shadow-none ${
                      !checkoutEnabled && !hasManagedSubscription
                        ? 'cursor-not-allowed bg-slate-200 text-slate-500 opacity-100 hover:bg-slate-200'
                        : 'bg-[#0000FF] text-white hover:bg-[#0000CC]'
                    }`}
                  >
                    {primaryLoading ? t('common.loading') : primaryActionLabel}
                    {checkoutEnabled || hasManagedSubscription ? <ArrowRight className="size-4" /> : null}
                  </Button>
                ) : (
                  checkoutEnabled ? (
                    <Button asChild className="h-11 w-full rounded-[8px] bg-[#0000FF] text-white shadow-none hover:bg-[#0000CC]">
                      <Link to="/auth" state={{ from: location }}>
                        {t('learning.register_to_subscribe')}
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled
                      className="h-11 w-full cursor-not-allowed rounded-[8px] bg-slate-200 text-slate-500 opacity-100 shadow-none hover:bg-slate-200"
                    >
                      {t('learning.checkout_disabled_cta')}
                    </Button>
                  )
                )}

                {hasManagedSubscription && (
                  <Button
                    type="button"
                    onClick={handlePortal}
                    disabled={portalLoading}
                    variant="outline"
                    className="h-11 w-full rounded-[8px] border-black/10 bg-white text-slate-700 shadow-none hover:bg-slate-50"
                  >
                    {portalLoading ? t('common.loading') : t('learning.manage_subscription')}
                  </Button>
                )}

                <Button asChild variant="outline" className="h-11 w-full rounded-[8px] border-black/10 bg-white text-slate-700 shadow-none hover:bg-slate-50">
                  <Link to={isAuthenticated ? '/learning/subscription' : '/auth'} state={isAuthenticated ? undefined : { from: location }}>
                    {isAuthenticated ? t('learning.my_subscription') : t('nav.login')}
                  </Link>
                </Button>
              </div>
            </aside>
          </section>
        </div>
      </main>
    </>
  );
};

export default LearningCheckoutPage;
