import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpenText, CheckCircle2, LockKeyhole, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { getLearningDashboard, getLearningPackage } from '@/lib/learningApi.js';
import { localizeLearningDashboard, localizeLearningPackage } from '@/lib/learningContentLocalization.js';
import {
  formatLearningPrice,
  getBillingIntervalLabel,
  getMinutesLabel,
  getPriceIntervalLabel,
} from '@/lib/learningPresentation.js';
import { getLearningCheckoutPath, getLearningTopicPath } from '@/lib/learningRoutes.js';
import { getSubscriptionStatusHintKey, getSubscriptionStatusLabel, getSubscriptionStatusToneClass } from '@/lib/subscriptionStatus.js';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import pb from '@/lib/pocketbaseClient.js';

const getCurrentUrl = () => (typeof window !== 'undefined' ? window.location.href : '');

const LearningPackagePage = () => {
  const { slug } = useParams();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const { t, language } = useTranslation();
  const [packageData, setPackageData] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState('month');

  useEffect(() => {
    let active = true;

    const loadPackage = async () => {
      try {
        const token = pb.authStore.token;
        const [data, dashboardData] = await Promise.all([
          getLearningPackage(slug),
          token ? getLearningDashboard(token).catch(() => null) : Promise.resolve(null),
        ]);
        if (active) {
          setPackageData(localizeLearningPackage(data, language));
          setDashboard(localizeLearningDashboard(dashboardData, language));
        }
      } catch (error) {
        console.error('Failed to load learning package:', error);
        if (active) {
          setPackageData(null);
          setDashboard(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadPackage();

    return () => {
      active = false;
    };
  }, [isAuthenticated, language, slug]);

  const locale = language === 'DE' ? 'de-DE' : 'en-US';
  const modules = packageData?.modules || [];
  const activeBillingOption = packageData?.billingOptions?.find((item) => item.id === billingCycle) || packageData?.billingOptions?.[0];
  const activePrice = activeBillingOption?.priceAmount || packageData?.priceAmount || 0;
  const activeInterval = activeBillingOption?.interval || billingCycle;
  const checkoutEnabled = packageData?.checkoutEnabled !== false;
  const hasAccessiblePackage = Boolean(
    dashboard?.hasAccess
    && packageData?.id
    && (
      dashboard.subscription?.packageId === packageData.id
      || dashboard.accessiblePackages?.some((item) => item.id === packageData.id)
    ),
  );
  const managedSubscription = dashboard?.subscription && hasAccessiblePackage ? dashboard.subscription : null;
  const hasManagedSubscription = Boolean(managedSubscription);
  const managedSubscriptionStatus = managedSubscription?.status || '';
  const hasManagedAccess = Boolean(managedSubscription?.hasAccess);
  const statusLabel = useMemo(() => getSubscriptionStatusLabel(t, managedSubscriptionStatus), [managedSubscriptionStatus, t]);
  const statusHintKey = getSubscriptionStatusHintKey(managedSubscriptionStatus);
  const canStartCheckout = checkoutEnabled
    && (!hasManagedSubscription || ['expired', 'unpaid', 'paused', 'incomplete', 'incomplete_expired'].includes(managedSubscriptionStatus));
  const primaryCtaLabel = !checkoutEnabled && !hasManagedSubscription
    ? t('learning.checkout_disabled_cta')
    : !isAuthenticated
      ? t('learning.register_to_subscribe')
      : canStartCheckout
        ? (hasManagedSubscription ? t('learning.subscribe_again') : t('learning.subscribe'))
        : hasManagedAccess
          ? t('learning.open_dashboard')
          : t('learning.manage_subscription');
  const primaryCtaTo = !isAuthenticated
    ? '/auth'
    : canStartCheckout
      ? getLearningCheckoutPath(packageData, billingCycle)
      : hasManagedAccess
        ? '/learning/dashboard'
        : '/learning/subscription';

  const lessonTotals = useMemo(() => modules.reduce((sum, moduleRecord) => sum + moduleRecord.lessons.length, 0), [modules]);
  const totalEstimatedMinutes = useMemo(
    () => modules.reduce((sum, moduleRecord) => sum + moduleRecord.lessons.reduce((lessonSum, lesson) => lessonSum + Number(lesson.estimatedMinutes || 0), 0), 0),
    [modules],
  );
  const formatHints = useMemo(() => {
    const labels = new Set();
    modules.forEach((moduleRecord) => {
      moduleRecord.lessons.forEach((lesson) => {
        if (lesson.hasVideo) labels.add(t('learning.format_video'));
        if (lesson.hasText || lesson.contentType === 'text') labels.add(t('learning.format_text'));
        if (lesson.hasPdf) labels.add(t('learning.format_pdf'));
        if (lesson.hasDownload || Number(lesson.attachmentCount || 0) > 0) labels.add(t('learning.format_download'));
      });
    });
    return [...labels];
  }, [modules, t]);
  const pageTitle = packageData?.seoTitle || (packageData ? `${packageData.title} - ${t('learning.meta_title')}` : t('learning.meta_title'));
  const pageDescription = packageData?.seoDescription || packageData?.description || packageData?.subtitle || t('learning.meta_description');
  const ogTitle = packageData?.ogTitle || pageTitle;
  const ogDescription = packageData?.ogDescription || pageDescription;
  const ogImage = packageData?.ogImageUrl || packageData?.heroImageUrl || packageData?.thumbnailUrl || '';
  const canonicalUrl = getCurrentUrl();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f7f7f7] text-slate-500">{t('common.loading')}</div>;
  }

  if (!packageData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f7] px-4 text-center">
        <div className="rounded-[8px] border border-black/8 bg-white p-10">
          <h1 className="text-3xl font-semibold text-slate-900">{t('learning.package_not_found')}</h1>
          <Button asChild className="mt-6 rounded-[8px] bg-[#0000FF] text-white hover:bg-[#0000CC]">
            <Link to="/learning">{t('common.back')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta name="robots" content="index,follow" />
        {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content={ogDescription} />
        {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
        {ogImage && <meta property="og:image" content={ogImage} />}
      </Helmet>

      <main className="learning-shell flex-1">
        <section className="border-b border-black/5">
          <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8 md:py-16">
            <Link to="/learning" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-[#0000FF]">
              <ArrowLeft className="size-4" />
              {t('common.back')}
            </Link>

            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
              <div className="order-1">
                <Badge className="rounded-[8px] bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0000FF] shadow-none">
                  {t('learning.overview')}
                </Badge>
                <h1 className="mt-5 text-4xl font-bold leading-tight text-slate-900 md:text-5xl">
                  {packageData.title}
                </h1>
                <p className="mt-4 text-lg leading-8 text-slate-600">{packageData.subtitle}</p>
                <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600">{packageData.description}</p>

              </div>

              <aside className="learning-card order-2 overflow-hidden lg:sticky lg:top-24 lg:row-span-2 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
                {packageData.heroImageUrl && (
                  <div className="aspect-[4/3] overflow-hidden bg-[#f3f3f3]">
                    <img src={packageData.heroImageUrl} alt={packageData.title} className="h-full w-full object-cover" />
                  </div>
                )}
                <div className="p-6 md:p-7">
                  {(packageData.promoBadge || packageData.promoText) && (
                    <div className="mb-5 rounded-[8px] border border-[#0000FF]/14 bg-[#f6f7ff] p-4">
                      {packageData.promoBadge && (
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0000FF]">{packageData.promoBadge}</p>
                      )}
                      {packageData.promoText && <p className="mt-2 text-sm leading-6 text-slate-600">{packageData.promoText}</p>}
                    </div>
                  )}
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/80">{t('learning.price_label')}</p>
                  <p className="mt-2 text-4xl font-semibold text-slate-900">
                    {formatLearningPrice(activePrice, packageData.currency, locale)}
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    {t('learning.price_interval_label')}: {getPriceIntervalLabel(t, activePrice, packageData.currency, activeInterval, locale)}
                  </p>
                  <p className="mt-4 border-t border-black/6 pt-4 text-sm leading-6 text-slate-600">
                    {t('learning.subscription_clear_terms', {
                      price: formatLearningPrice(activePrice, packageData.currency, locale),
                      interval: getBillingIntervalLabel(t, activeInterval),
                    })}
                  </p>

                  {hasManagedSubscription && (
                    <div className={`mt-4 rounded-[8px] border p-4 text-sm ${getSubscriptionStatusToneClass(managedSubscriptionStatus)}`}>
                      <p className="font-semibold">{t('learning.current_subscription_title')}</p>
                      <p className="mt-1">
                        {hasManagedAccess
                          ? t('learning.current_subscription_active_body')
                          : t('learning.current_subscription_inactive_body', { status: statusLabel })}
                      </p>
                      {statusHintKey && <p className="mt-2">{t(statusHintKey)}</p>}
                    </div>
                  )}

                  {packageData.billingOptions?.length > 1 && (
                    <div className="mt-4 grid grid-cols-1 gap-2 rounded-[8px] border border-black/6 bg-[#f7f7f7] p-2 sm:grid-cols-2">
                      {packageData.billingOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setBillingCycle(option.id)}
                          className={`rounded-[16px] px-3 py-3 text-sm font-semibold transition-colors ${
                            billingCycle === option.id
                              ? 'bg-[#0000FF] text-white'
                              : 'bg-white text-slate-600 hover:text-[#0000FF]'
                          }`}
                        >
                          {option.id === 'year' ? t('learning.yearly') : t('learning.monthly')}
                        </button>
                      ))}
                    </div>
                  )}

                  {checkoutEnabled || hasManagedSubscription ? (
                    <Button asChild className="mt-6 h-11 w-full rounded-[8px] bg-[#0000FF] text-white shadow-none hover:bg-[#0000CC]">
                      <Link to={primaryCtaTo} state={!isAuthenticated ? { from: location } : undefined}>
                        {primaryCtaLabel}
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled
                      className="mt-6 h-11 w-full cursor-not-allowed rounded-[8px] bg-slate-200 text-slate-500 opacity-100 shadow-none hover:bg-slate-200"
                    >
                      {t('learning.checkout_disabled_cta')}
                    </Button>
                  )}
                </div>
              </aside>

              <div className="order-3 lg:col-start-1">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    `${packageData.moduleCount} ${t('learning.modules_count')}`,
                    `${lessonTotals} ${t('learning.lessons_count')}`,
                    getMinutesLabel(t, Math.max(totalEstimatedMinutes, 0)),
                  ].map((item) => (
                    <div key={item} className="learning-inline-card px-5 py-4 text-sm font-semibold text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>

                <div className="learning-card mt-6 p-6 md:p-8">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">{t('learning.curriculum_preview')}</p>
                      <h2 className="mt-3 text-3xl font-semibold text-slate-900">{t('learning.curriculum_preview')}</h2>
                    </div>
                    <Badge className="rounded-[8px] bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
                      {lessonTotals} {t('learning.lessons_count')}
                    </Badge>
                  </div>

                  <div className="mt-6 space-y-4">
                    {modules.map((moduleRecord) => (
                      <section key={moduleRecord.id} className="learning-subtle-card p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-xl font-semibold text-slate-900">{moduleRecord.title}</h3>
                              {moduleRecord.isPreview && (
                                <Badge className="rounded-[8px] bg-[#0000FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0000FF] shadow-none">
                                  {t('learning.preview_label')}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-slate-600">{moduleRecord.description}</p>
                          </div>
                          <div className="rounded-[8px] bg-white p-3 text-[#0000FF]">
                            <BookOpenText className="size-4" />
                          </div>
                        </div>

                        <div className="mt-5 space-y-3">
                          {moduleRecord.lessons.map((lessonRecord) => {
                            const isPreview = moduleRecord.isPreview || lessonRecord.isPreview;
                            return (
                              <div key={lessonRecord.id} className="learning-inline-card flex items-center justify-between gap-3 px-4 py-3">
                                <div className="flex min-w-0 items-center gap-3">
                                  {isPreview ? (
                                    <PlayCircle className="size-4 shrink-0 text-[#0000FF]" />
                                  ) : (
                                    <LockKeyhole className="size-4 shrink-0 text-slate-400" />
                                  )}
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900">{lessonRecord.title}</p>
                                    <p className="text-xs text-slate-500">{getMinutesLabel(t, lessonRecord.estimatedMinutes)}</p>
                                  </div>
                                </div>
                                <Badge className={`rounded-[8px] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-none ${
                                  isPreview ? 'bg-[#0000FF]/10 text-[#0000FF]' : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {isPreview ? t('learning.preview_label') : t('learning.status_locked')}
                                </Badge>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-4">
                          <Button asChild variant="outline" className="h-10 rounded-[8px] border-black/10 bg-white px-5 text-slate-700 shadow-none hover:bg-slate-50">
                            <Link to={getLearningTopicPath(packageData, moduleRecord)}>{t('learning.open_module')}</Link>
                          </Button>
                        </div>
                      </section>
                    ))}
                  </div>

                  <div className="mt-8 rounded-[8px] border border-[#0000FF]/14 bg-[#f6f7ff] p-5">
                    <p className="text-base leading-7 text-slate-600">
                      {t('learning.package_access_terms')} {t('learning.subscription_clear_terms', {
                        price: formatLearningPrice(activePrice, packageData.currency, locale),
                        interval: getBillingIntervalLabel(t, activeInterval),
                      })}
                    </p>
                    {hasManagedSubscription && (
                      <p className="mt-3 text-sm text-slate-600">
                        {hasManagedAccess
                          ? t('learning.current_subscription_active_body')
                          : t('learning.current_subscription_inactive_body', { status: statusLabel })}
                      </p>
                    )}
                    {checkoutEnabled || hasManagedSubscription ? (
                      <Button asChild className="mt-5 h-11 rounded-[8px] bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC]">
                        <Link to={primaryCtaTo} state={!isAuthenticated ? { from: location } : undefined}>
                          {primaryCtaLabel}
                          <ArrowRight className="size-4" />
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        disabled
                        className="mt-5 h-11 cursor-not-allowed rounded-[8px] bg-slate-200 px-6 text-slate-500 opacity-100 shadow-none hover:bg-slate-200"
                      >
                        {t('learning.checkout_disabled_cta')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-14 md:py-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="learning-card p-6 md:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">{t('learning.target_audience')}</p>
              <h2 className="mt-3 text-3xl font-semibold text-slate-900">{t('learning.target_audience')}</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">{packageData.targetAudience}</p>

              <div className="mt-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">{t('learning.what_included')}</p>
                <div className="mt-4 space-y-3">
                  {(packageData.includedContent || []).map((item) => (
                    <div key={item} className="learning-subtle-card flex gap-3 p-4">
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#0000FF]" />
                      <p className="text-sm leading-6 text-slate-600">{item}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">{t('learning.formats_label')}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {formatHints.map((format) => (
                    <span key={format} className="rounded-[8px] bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">
                      {format}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">{t('learning.student_receive')}</p>
                <div className="mt-4 space-y-3">
                  {[
                    `${lessonTotals} ${t('learning.lessons_count')}`,
                    getMinutesLabel(t, totalEstimatedMinutes),
                    ...((packageData.includedContent || []).slice(0, 2)),
                  ].map((item) => (
                    <div key={item} className="learning-subtle-card flex gap-3 p-4">
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#0000FF]" />
                      <p className="text-sm leading-6 text-slate-600">{item}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-8">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">{t('learning.faq')}</p>
                <div className="mt-4 space-y-3">
                  {(packageData.faq || []).map((item) => (
                    <div key={item.question} className="learning-inline-card p-4">
                      <h3 className="text-lg font-semibold text-slate-900">{item.question}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
};

export default LearningPackagePage;
