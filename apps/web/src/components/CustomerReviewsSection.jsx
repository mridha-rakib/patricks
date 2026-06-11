import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import { listCustomerReviews } from '@/lib/reviewsApi.js';
import ReviewCard from '@/components/ReviewCard.jsx';

const HOME_REVIEW_LIMIT = 3;

const CustomerReviewsSection = () => {
  const { t } = useTranslation();
  const [apiReviews, setApiReviews] = useState([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(true);

  useEffect(() => {
    let isMounted = true;

    listCustomerReviews({ featured: false, limit: HOME_REVIEW_LIMIT })
      .then((result) => {
        if (isMounted) {
          setApiReviews(result.items);
        }
      })
      .catch(() => {
        if (isMounted) {
          setApiReviews([]);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingReviews(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const reviews = apiReviews.slice(0, HOME_REVIEW_LIMIT);

  if (!isLoadingReviews && reviews.length === 0) {
    return null;
  }

  return (
    <section className="bg-white py-16 md:py-24 px-4 md:px-6 lg:px-8">
      <div className="max-w-[1280px] mx-auto">
        
        {/* Section Header */}
        <div className="text-center max-w-[768px] mx-auto mb-10 md:mb-16">
          <h2 className="font-['Playfair_Display'] font-bold text-[30px] md:text-[36px] lg:text-[48px] text-[hsl(var(--foreground))] mb-4">
            {t('reviews.title')}
          </h2>
          <p className="text-[16px] md:text-[18px] text-[hsl(var(--secondary))]">
            {t('reviews.subtitle')}
          </p>
          <Link
            to="/reviews"
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-md border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted-bg))]"
          >
            {t('reviews.view_all')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {/* Reviews Grid */}
        {isLoadingReviews ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-56 animate-pulse rounded-[8px] border border-black/10 bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
            {reviews.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                verifiedLabel={t('reviews.verified_buyer')}
                customerLabel={t('reviews.customer')}
              />
            ))}
          </div>
        )}

      </div>
    </section>
  );
};

export default CustomerReviewsSection;
