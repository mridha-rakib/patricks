import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpenText, CheckCircle2, ClipboardList, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { listLearningPackages } from '@/lib/learningApi.js';
import { localizeLearningPackageList } from '@/lib/learningContentLocalization.js';
import { getPriceIntervalLabel } from '@/lib/learningPresentation.js';
import { useTranslation } from '@/contexts/TranslationContext.jsx';

const getCurrentUrl = () => (typeof window !== 'undefined' ? window.location.href : '');

const LearningLandingPage = () => {
  const { t, language } = useTranslation();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadPackages = async () => {
      try {
        const data = await listLearningPackages();
        if (active) {
          setPackages(localizeLearningPackageList(Array.isArray(data.items) ? data.items : [], language));
        }
      } catch (error) {
        console.error('Failed to load learning packages:', error);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadPackages();

    return () => {
      active = false;
    };
  }, [language]);

  const locale = language === 'DE' ? 'de-DE' : 'en-US';
  const featuredPackage = packages[0] || null;
  const pageTitle = featuredPackage?.seoTitle || featuredPackage?.title || t('learning.meta_title');
  const pageDescription = featuredPackage?.seoDescription || featuredPackage?.heroCopy || t('learning.meta_description');
  const ogTitle = featuredPackage?.ogTitle || pageTitle;
  const ogDescription = featuredPackage?.ogDescription || pageDescription;
  const ogImage = featuredPackage?.ogImageUrl || featuredPackage?.heroImageUrl || featuredPackage?.thumbnailUrl || '';
  const canonicalUrl = getCurrentUrl();

  const totals = useMemo(() => packages.reduce((summary, item) => ({
    modules: summary.modules + Number(item.moduleCount || 0),
    lessons: summary.lessons + Number(item.lessonCount || 0),
  }), { modules: 0, lessons: 0 }), [packages]);

  const overviewItems = [
    {
      icon: BookOpenText,
      title: t('learning.modules_count'),
      body: `${totals.modules || featuredPackage?.moduleCount || 0} ${t('learning.modules_count')}`,
    },
    {
      icon: PlayCircle,
      title: t('learning.lessons_count'),
      body: `${totals.lessons || featuredPackage?.lessonCount || 0} ${t('learning.lessons_count')}`,
    },
    {
      icon: ClipboardList,
      title: t('learning.progress'),
      body: t('learning.landing_progress_body'),
    },
  ];

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
        <section className="border-b border-black/5 bg-white">
          <div className="container mx-auto grid gap-8 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center lg:px-8">
            <div>
              <Badge className="rounded-[8px] bg-[#0000FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0000FF] shadow-none">
                {t('learning.hero_eyebrow')}
              </Badge>
              <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-tight text-slate-950 md:text-5xl">
                {t('learning.hero_title')}
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600 md:text-lg md:leading-8">
                {t('learning.hero_body')}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-11 rounded-[8px] bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC]">
                  <Link to="/learning/packages">
                    {t('learning.subscribe')}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 rounded-[8px] border-black/10 bg-white px-6 text-slate-700 shadow-none hover:bg-slate-50">
                  <Link to="/learning/dashboard">{t('learning.open_dashboard')}</Link>
                </Button>
              </div>
            </div>

            <aside className="learning-card overflow-hidden">
              <div className="aspect-[4/3] bg-[#f3f3f3]">
                {featuredPackage?.heroImageUrl || featuredPackage?.thumbnailUrl ? (
                  <img
                    src={featuredPackage.heroImageUrl || featuredPackage.thumbnailUrl}
                    alt={featuredPackage.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-8 text-center text-sm font-semibold text-slate-400">
                    {t('learning.meta_title')}
                  </div>
                )}
              </div>
              <div className="p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.overview')}</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">{featuredPackage?.title || t('learning.z3_selector_title')}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {featuredPackage?.subtitle || t('learning.z3_selector_subtitle')}
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section className="py-12 md:py-14">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/70">{t('learning.overview')}</p>
              <h2 className="mt-3 text-3xl font-bold text-slate-900 md:text-4xl">{t('learning.landing_overview_title')}</h2>
              <p className="mt-3 text-base leading-7 text-slate-600">{t('learning.landing_overview_body')}</p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {overviewItems.map((item) => {
                const Icon = item.icon;
                return (
                  <article key={item.title} className="learning-card p-5">
                    <Icon className="size-5 text-[#0000FF]" />
                    <h3 className="mt-4 text-xl font-semibold text-slate-900">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
                  </article>
                );
              })}
            </div>

            {featuredPackage && (
              <div className="mt-8">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/70">{t('learning.what_included')}</p>
                  <h3 className="mt-3 text-2xl font-bold text-slate-900">{t('learning.landing_benefits_title')}</h3>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  {(featuredPackage.includedContent || []).map((item) => (
                    <div key={item} className="learning-subtle-card flex gap-3 p-5">
                      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-[#0000FF]" />
                      <p className="text-sm leading-6 text-slate-600">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {featuredPackage && (
          <section className="border-y border-black/5 bg-white py-12 md:py-14">
            <div className="container mx-auto grid gap-8 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/70">{t('learning.target_audience')}</p>
                <h2 className="mt-3 text-3xl font-bold text-slate-900 md:text-4xl">{t('learning.target_audience')}</h2>
                <p className="mt-4 text-base leading-7 text-slate-600">{featuredPackage.targetAudience}</p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/70">{t('learning.faq')}</p>
                <h2 className="mt-3 text-3xl font-bold text-slate-900 md:text-4xl">{t('learning.faq')}</h2>
                <div className="mt-6 space-y-3">
                  {(featuredPackage.faq || []).map((item) => (
                    <div key={item.question} className="learning-inline-card p-4">
                      <h3 className="text-lg font-semibold text-slate-900">{item.question}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="border-y border-black/5 bg-white py-12 md:py-14">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/70">{t('learning.choose_package')}</p>
                <h2 className="mt-3 text-3xl font-bold text-slate-900 md:text-4xl">{t('learning.z3_selector_title')}</h2>
                <p className="mt-3 text-base leading-7 text-slate-600">{t('learning.z3_selector_subtitle')}</p>
              </div>
              <Button asChild className="h-11 rounded-[8px] bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC] md:mb-1">
                <Link to="/learning/packages">
                  {t('learning.subscribe')}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>

            {loading ? (
              <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="overflow-hidden rounded-[8px] border border-black/6 bg-white">
                    <div className="aspect-[4/3] animate-pulse bg-slate-200" />
                    <div className="space-y-3 p-6">
                      <div className="h-5 w-2/3 animate-pulse rounded-[8px] bg-slate-200" />
                      <div className="h-4 w-full animate-pulse rounded-[8px] bg-slate-200" />
                      <div className="h-4 w-4/5 animate-pulse rounded-[8px] bg-slate-200" />
                    </div>
                  </div>
                ))}
              </div>
            ) : packages.length > 0 ? (
              <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {packages.map((item) => (
                  <article key={item.id} className="learning-card flex flex-col overflow-hidden">
                    <div className="aspect-[4/3] overflow-hidden bg-[#f3f3f3]">
                      {item.thumbnailUrl ? (
                        <img src={item.thumbnailUrl} alt={item.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center p-6 text-center text-slate-400">{item.title}</div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h3 className="text-2xl font-semibold text-slate-900">{item.title}</h3>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{item.subtitle}</p>
                        </div>
                        <Badge className="w-fit rounded-[8px] bg-[#0000FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0000FF] shadow-none">
                          {getPriceIntervalLabel(t, item.priceAmount, item.currency, item.billingInterval, locale)}
                        </Badge>
                      </div>

                      <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium text-slate-500">
                        <span className="rounded-[8px] bg-slate-100 px-3 py-1">{item.moduleCount} {t('learning.modules_count')}</span>
                        <span className="rounded-[8px] bg-slate-100 px-3 py-1">{item.lessonCount} {t('learning.lessons_count')}</span>
                      </div>

                      <Button asChild className="mt-auto h-11 w-full rounded-[8px] bg-[#0000FF] text-white shadow-none hover:bg-[#0000CC]">
                        <Link to={`/learning/packages/${item.slug}`}>{t('learning.explore')}</Link>
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-8 rounded-[8px] border border-dashed border-black/12 bg-white p-10 text-center text-slate-600">
                {t('learning.no_packages')}
              </div>
            )}
          </div>
        </section>

      </main>
    </>
  );
};

export default LearningLandingPage;
