import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { listLearningPackages } from '@/lib/learningApi.js';
import { localizeLearningPackageList } from '@/lib/learningContentLocalization.js';
import { useTranslation } from '@/contexts/TranslationContext.jsx';

const Z3_PACKAGES = [
  {
    slug: 'z3-start',
    titleKey: 'learning.z3_start_title',
    subtitleKey: 'learning.z3_start_subtitle',
    price: 19,
    compareKey: 'learning.z3_start_compare_price',
    ctaKey: 'learning.z3_start_cta',
    features: [
      'learning.z3_start_feature_1',
      'learning.z3_start_feature_2',
      'learning.z3_start_feature_3',
      'learning.z3_start_feature_4',
    ],
    buttonClassName: 'border-[#005DFF] bg-white text-[#005DFF] hover:bg-[#eef4ff]',
    iconClassName: 'text-[#005DFF]',
  },
  {
    slug: 'z3-struktur',
    titleKey: 'learning.z3_struktur_title',
    subtitleKey: 'learning.z3_struktur_subtitle',
    price: 39,
    compareKey: 'learning.z3_struktur_compare_price',
    ctaKey: 'learning.z3_struktur_cta',
    popular: true,
    features: [
      'learning.z3_struktur_feature_1',
      'learning.z3_struktur_feature_2',
      'learning.z3_struktur_feature_3',
      'learning.z3_struktur_feature_4',
      'learning.z3_struktur_feature_5',
    ],
    buttonClassName: 'bg-[#00A99D] text-white hover:bg-[#008f86]',
    iconClassName: 'text-[#00A99D]',
  },
  {
    slug: 'z3-pruefungstrainer',
    titleKey: 'learning.z3_pruefung_title',
    subtitleKey: 'learning.z3_pruefung_subtitle',
    price: 59,
    compareKey: 'learning.z3_pruefung_compare_price',
    ctaKey: 'learning.z3_pruefung_cta',
    features: [
      'learning.z3_pruefung_feature_1',
      'learning.z3_pruefung_feature_2',
      'learning.z3_pruefung_feature_3',
      'learning.z3_pruefung_feature_4',
      'learning.z3_pruefung_feature_5',
    ],
    buttonClassName: 'bg-[#005DFF] text-white hover:bg-[#0047c7]',
    iconClassName: 'text-[#005DFF]',
  },
];

const LearningPackageSelectorPage = () => {
  const { t, language } = useTranslation();
  const [packages, setPackages] = useState([]);

  useEffect(() => {
    let active = true;

    const loadPackages = async () => {
      try {
        const data = await listLearningPackages();
        if (active) {
          setPackages(localizeLearningPackageList(Array.isArray(data.items) ? data.items : [], language));
        }
      } catch (error) {
        console.error('Failed to load Z3 learning packages:', error);
        if (active) {
          setPackages([]);
        }
      }
    };

    loadPackages();

    return () => {
      active = false;
    };
  }, [language]);

  const packageBySlug = useMemo(() => {
    const map = new Map();
    packages.forEach((item) => {
      if (item?.slug) {
        map.set(item.slug, item);
      }
    });
    return map;
  }, [packages]);

  return (
    <>
      <Helmet>
        <title>{t('learning.z3_selector_meta_title')}</title>
        <meta name="description" content={t('learning.z3_selector_meta_description')} />
        <meta name="robots" content="index,follow" />
      </Helmet>

      <main className="flex-1 bg-[#fbfbfb]">
        <section className="mx-auto flex min-h-[calc(100vh-80px)] max-w-6xl flex-col justify-center px-4 py-12 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-3xl font-bold tracking-normal text-slate-950 md:text-4xl">
              {t('learning.z3_selector_title')}
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              {t('learning.z3_selector_subtitle')}
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {Z3_PACKAGES.map((item) => {
              const packageRecord = packageBySlug.get(item.slug);
              const checkoutSlug = packageRecord?.slug || item.slug;
              const isCheckoutUnavailable = packageRecord?.checkoutEnabled === false;

              return (
                <article
                  key={item.slug}
                  className={`relative flex min-h-[450px] flex-col rounded-[8px] border bg-white p-6 shadow-card ${
                    item.popular
                      ? 'border-[#00A99D]/70 shadow-[0_12px_32px_rgba(0,169,157,0.16)]'
                      : 'border-black/8'
                  }`}
                >
                  {item.popular && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#00A99D] px-4 py-1 text-[11px] font-semibold text-white shadow-none hover:bg-[#00A99D]">
                      {t('learning.z3_popular')}
                    </Badge>
                  )}

                  <div className="text-center">
                    <h2 className="text-lg font-bold text-slate-950">{t(item.titleKey)}</h2>
                    <p className="mt-2 min-h-[40px] text-xs leading-5 text-slate-500">{t(item.subtitleKey)}</p>
                  </div>

                  <div className="mt-7 text-center">
                    <div className="flex items-end justify-center gap-2">
                      <span className="text-4xl font-bold leading-none text-[#005DFF]">{item.price} EUR</span>
                      <span className="pb-1 text-xs font-medium text-slate-500">{t('learning.z3_per_month')}</span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-slate-500">{t(item.compareKey)}</p>
                  </div>

                  <div className="my-6 h-px bg-slate-100" />

                  <ul className="space-y-3">
                    {item.features.map((featureKey) => (
                      <li key={featureKey} className="flex items-start gap-2 text-xs font-medium leading-5 text-slate-700">
                        <CheckCircle2 className={`mt-0.5 size-3.5 shrink-0 ${item.iconClassName}`} />
                        <span>{t(featureKey)}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto pt-8">
                    {isCheckoutUnavailable ? (
                      <Button
                        type="button"
                        disabled
                        className="h-10 w-full cursor-not-allowed rounded-[8px] bg-slate-200 text-xs font-semibold text-slate-500 opacity-100 shadow-none hover:bg-slate-200"
                      >
                        {t('learning.checkout_disabled_cta')}
                      </Button>
                    ) : (
                      <Button asChild className={`h-10 w-full rounded-[8px] text-xs font-semibold shadow-none ${item.buttonClassName}`}>
                        <Link to={`/learning/subscribe/${checkoutSlug}?cycle=month`}>
                          {t(item.ctaKey)}
                        </Link>
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </>
  );
};

export default LearningPackageSelectorPage;
