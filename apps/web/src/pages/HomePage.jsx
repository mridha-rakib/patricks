import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BookOpenCheck, Layers3 } from 'lucide-react';
import PopularProductsSection from '@/components/PopularProductsSection.jsx';
import CustomerReviewsSection from '@/components/CustomerReviewsSection.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { listLearningPackages } from '@/lib/learningApi.js';
import { localizeLearningPackage } from '@/lib/learningContentLocalization.js';
import { getPriceIntervalLabel } from '@/lib/learningPresentation.js';

const HOME_HERO_BACKGROUND_IMAGE = '/images/home-hero-bg.webp';

const HomePage = () => {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const {
    isAuthenticated,
    isSeller
  } = useAuth();
  const [learningPackage, setLearningPackage] = useState(null);

  useEffect(() => {
    let active = true;

    const loadLearningPackage = async () => {
      try {
        const data = await listLearningPackages();
        if (active) {
          setLearningPackage(localizeLearningPackage(Array.isArray(data.items) ? data.items[0] || null : null, language));
        }
      } catch (error) {
        console.error('Failed to load learning spotlight:', error);
      }
    };

    loadLearningPackage();

    return () => {
      active = false;
    };
  }, [language]);

  const handleSellClick = e => {
    e.preventDefault();
    if (!isAuthenticated || !isSeller) {
      navigate('/seller-info');
    } else {
      navigate('/seller/new-product');
    }
  };

  const locale = language === 'DE' ? 'de-DE' : 'en-US';
  const learningPrice = learningPackage
    ? getPriceIntervalLabel(t, learningPackage.priceAmount, learningPackage.currency, learningPackage.billingInterval, locale)
    : null;

  return <>
      <Helmet>
        <title>{t('home.title')}</title>
        <meta name="description" content={t('home.description')} />
      </Helmet>

      <main className="flex-1">
        {/* HERO SECTION */}
        <section className="relative min-h-[90vh] md:min-h-[100vh] flex items-center justify-center overflow-hidden">
          {/* Background Image & Overlay */}
          <div className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat" style={{
          backgroundImage: `url("${HOME_HERO_BACKGROUND_IMAGE}")`
        }}>
            <div className="absolute inset-0 bg-black opacity-40"></div>
          </div>

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center justify-center w-full max-w-[896px] px-4 text-center mt-[64px] md:mt-[80px]">
            
            <motion.h1 initial={{
            opacity: 0,
            y: 20
          }} animate={{
            opacity: 1,
            y: 0
          }} transition={{
            duration: 0.8,
            ease: "easeOut",
            delay: 0
          }} className="font-['Playfair_Display'] font-bold text-[36px] md:text-[48px] lg:text-[72px] text-white leading-tight mb-4 md:mb-6 drop-shadow-[0_4px_8px_rgba(0,0,0,0.5)]">
              {t('home.hero_title')}
            </motion.h1>

            <motion.p initial={{
            opacity: 0,
            y: 20
          }} animate={{
            opacity: 1,
            y: 0
          }} transition={{
            duration: 0.8,
            ease: "easeOut",
            delay: 0.2
          }} className="font-light text-[18px] md:text-[20px] lg:text-[24px] text-[#f3f4f6] max-w-[672px] mb-8 md:mb-12 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
              {t('home.hero_subtitle')}
            </motion.p>

            <motion.div initial={{
            opacity: 0,
            y: 20
          }} animate={{
            opacity: 1,
            y: 0
          }} transition={{
            duration: 0.8,
            ease: "easeOut",
            delay: 0.4
          }} className="flex flex-col md:flex-row gap-3 md:gap-4 w-full md:w-auto">
              <Link to="/marketplace" className="flex items-center justify-center gap-2 bg-[hsl(var(--primary))] text-white h-[48px] md:h-[56px] px-6 md:px-10 text-[16px] md:text-[18px] font-medium rounded-[8px] shadow-button hover:bg-[rgba(0,0,255,0.9)] hover:-translate-y-[2px] transition-all duration-300">
                {t('home.explore_marketplace')}
                <ArrowRight size={20} />
              </Link>
              
              <button onClick={handleSellClick} className="flex items-center justify-center bg-[rgba(255,255,255,0.1)] text-white border border-[rgba(255,255,255,0.3)] backdrop-blur-[8px] h-[48px] md:h-[56px] px-6 md:px-10 text-[16px] md:text-[18px] font-medium rounded-[8px] hover:bg-[rgba(255,255,255,0.2)] hover:-translate-y-[2px] transition-all duration-300">
                {t('home.sell_now')}
              </button>
            </motion.div>

          </div>
        </section>

        <PopularProductsSection />
        <section className="bg-[linear-gradient(180deg,#f7f7f7_0%,#ffffff_100%)] py-14 md:py-16">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8">
            <div className="overflow-hidden rounded-[32px] border border-black/6 bg-white shadow-[0_22px_72px_-56px_rgba(15,23,42,0.42)]">
              <div className="grid gap-0 lg:grid-cols-[0.98fr_1.02fr]">
                <div className="border-b border-black/6 bg-[linear-gradient(135deg,#f7f7f7_0%,#ffffff_56%,#eef2ff_100%)] p-7 md:p-10 lg:border-b-0 lg:border-r">
                  <Badge className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0000FF] shadow-none">
                    {t('learning.hero_eyebrow')}
                  </Badge>
                  <h2 className="mt-5 text-3xl font-bold text-slate-900 md:text-4xl">{t('learning.hero_title')}</h2>
                  <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">{t('learning.hero_body')}</p>

                  <div className="mt-8 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-black/6 bg-white/88 p-4">
                      <div className="flex items-center gap-2 text-[#0000FF]">
                        <Layers3 className="size-4" />
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('learning.modules_count')}</span>
                      </div>
                      <p className="mt-3 text-2xl font-semibold text-slate-900">{learningPackage?.moduleCount || 0}</p>
                    </div>
                    <div className="rounded-[22px] border border-black/6 bg-white/88 p-4">
                      <div className="flex items-center gap-2 text-[#0000FF]">
                        <BookOpenCheck className="size-4" />
                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t('learning.lessons_count')}</span>
                      </div>
                      <p className="mt-3 text-2xl font-semibold text-slate-900">{learningPackage?.lessonCount || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="p-7 md:p-10">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">
                    {learningPackage?.title || t('nav.learning')}
                  </p>
                  <h3 className="mt-3 text-3xl font-semibold text-slate-900">
                    {learningPackage?.subtitle || t('learning.subscription_note')}
                  </h3>
                  <p className="mt-4 text-base leading-7 text-slate-600">
                    {learningPackage?.description || t('learning.meta_description')}
                  </p>

                  <div className="mt-6 flex flex-wrap gap-2">
                    {(learningPackage?.valuePoints || []).slice(0, 3).map((point) => (
                      <span key={point} className="rounded-full bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600">
                        {point}
                      </span>
                    ))}
                  </div>

                  <div className="mt-8 flex flex-wrap items-center gap-4">
                    <p className="text-3xl font-semibold text-slate-900">
                      {learningPrice || '--'}
                    </p>
                    <Button asChild className="h-11 rounded-full bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC]">
                      <Link to={learningPackage ? `/learning/packages/${learningPackage.slug}` : '/learning'}>
                        {t('learning.explore')}
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <CustomerReviewsSection />
      </main>
    </>;
};
export default HomePage;
