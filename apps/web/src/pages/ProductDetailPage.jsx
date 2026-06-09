import React, { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Heart, ShieldCheck, ShoppingCart, Star } from 'lucide-react';
import pb from '@/lib/pocketbaseClient.js';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useCart } from '@/contexts/CartContext.jsx';
import { useFavorites } from '@/contexts/FavoritesContext.jsx';
import { useShopVisibility } from '@/contexts/ShopVisibilityContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { getProductImageUrls } from '@/lib/productImages.js';
import { toast } from 'sonner';
import { createCustomerReview, getProductReviewEligibility, listProductReviews } from '@/lib/reviewsApi.js';
import { getAuthToken } from '@/lib/getAuthToken.js';

const subjectKeys = {
  Kons: 'marketplace.subject_kons',
  Pro: 'marketplace.subject_pro',
  KFO: 'marketplace.subject_kfo',
  Paro: 'marketplace.subject_paro',
};

const subjectShortLabels = {
  Kons: 'Kons',
  Pro: 'Pro',
  KFO: 'KFO',
  Paro: 'Paro',
};

const conditionKeys = {
  Neu: 'marketplace.condition_new',
  New: 'marketplace.condition_new',
  'Wie neu': 'marketplace.condition_like_new',
  'Like new': 'marketplace.condition_like_new',
  Gut: 'marketplace.condition_good',
  Good: 'marketplace.condition_good',
  Befriedigend: 'marketplace.condition_satisfactory',
  Satisfactory: 'marketplace.condition_satisfactory',
};

const sellerInitial = (name = '') => name.trim().slice(0, 1).toUpperCase() || '?';
const REVIEW_MIN_LENGTH = 10;
const REVIEW_MAX_LENGTH = 1200;

const ProductDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentUser } = useAuth();
  const { addToCart } = useCart();
  const { addToFavorites, removeFromFavorites, isFavorite } = useFavorites();
  const { shopEnabled, loading: shopVisibilityLoading } = useShopVisibility();
  const { t, language } = useTranslation();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [productReviews, setProductReviews] = useState([]);
  const [reviewSummary, setReviewSummary] = useState({ count: 0, averageRating: 0 });
  const [reviewEligibility, setReviewEligibility] = useState({ canReview: false, orderId: '', review: null });
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const requestedProductSource = searchParams.get('type') === 'shop' ? 'shop' : 'marketplace';
  const [resolvedProductSource, setResolvedProductSource] = useState(requestedProductSource);

  useEffect(() => {
    const fetchProduct = async () => {
      if (requestedProductSource === 'shop' && !shopEnabled) {
        setProduct(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setProduct(null);

      try {
        const preferredCollection = requestedProductSource === 'shop' ? 'shop_products' : 'products';
        const fallbackCollection = requestedProductSource === 'shop' ? 'products' : 'shop_products';
        const fallbackSource = requestedProductSource === 'shop' ? 'marketplace' : 'shop';

        let record = null;
        let source = requestedProductSource;

        try {
          record = await pb.collection(preferredCollection).getOne(id, { $autoCancel: false });
        } catch {
          if (fallbackSource === 'shop' && !shopEnabled) {
            throw new Error('Shop product fallback is disabled while the shop is hidden');
          }

          record = await pb.collection(fallbackCollection).getOne(id, { $autoCancel: false });
          source = fallbackSource;
        }

        setProduct(record);
        setResolvedProductSource(source);
      } catch (error) {
        console.error('Error fetching product:', error);
        toast.error(t('product.load_error'));
      } finally {
        setLoading(false);
      }
    };

    if (!shopVisibilityLoading) {
      fetchProduct();
    }
  }, [id, requestedProductSource, shopEnabled, shopVisibilityLoading, t]);

  useEffect(() => {
    let isMounted = true;
    const productType = resolvedProductSource === 'shop' ? 'shop' : 'marketplace';

    if (!product?.id) return undefined;

    listProductReviews({ productId: product.id, productType, limit: 10 })
      .then((result) => {
        if (!isMounted) return;
        setProductReviews(result.items);
        setReviewSummary(result.summary || { count: 0, averageRating: 0 });
      })
      .catch((error) => {
        console.error('Error fetching product reviews:', error);
        if (!isMounted) return;
        setProductReviews([]);
        setReviewSummary({ count: 0, averageRating: 0 });
      });

    const token = getAuthToken();
    if (token) {
      getProductReviewEligibility({ token, productId: product.id, productType })
        .then((result) => {
          if (isMounted) {
            setReviewEligibility(result);
          }
        })
        .catch(() => {
          if (isMounted) {
            setReviewEligibility({ canReview: false, orderId: '', review: null });
          }
        });
    } else {
      setReviewEligibility({ canReview: false, orderId: '', review: null });
    }

    return () => {
      isMounted = false;
    };
  }, [product?.id, resolvedProductSource, currentUser?.id]);

  const formatPrice = (price) =>
    new Intl.NumberFormat(language === 'DE' ? 'de-DE' : 'en-US', {
      style: 'currency',
      currency: 'EUR',
    }).format(Number(price) || 0);

  if (loading || shopVisibilityLoading) {
    return (
      <main className="flex min-h-[70vh] flex-1 items-center justify-center bg-white">
        <div className="text-sm font-medium text-slate-500">{t('common.loading')}</div>
      </main>
    );
  }

  if (requestedProductSource === 'shop' && !shopEnabled) {
    return (
      <main className="flex min-h-[70vh] flex-1 items-center justify-center bg-[#f7f7f7] px-4 py-12">
        <section className="w-full max-w-2xl rounded-[8px] border border-black/10 bg-white p-8 text-center shadow-sm">
          <AlertCircle className="mx-auto h-10 w-10 text-[#0000FF]" />
          <h1 className="mt-5 text-2xl font-bold text-[#151515]">{t('shop.unavailable_title')}</h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#666666]">{t('shop.unavailable_body')}</p>
          <Button type="button" onClick={() => navigate('/marketplace')} className="mt-7 h-11 rounded-[8px] bg-[#0000FF] px-5 text-white hover:bg-[#0000CC]">
            {t('shop.go_marketplace')}
          </Button>
        </section>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="flex min-h-[70vh] flex-1 items-center justify-center bg-white">
        <div className="text-sm font-medium text-slate-500">{t('product.not_found')}</div>
      </main>
    );
  }

  const isShopProduct = resolvedProductSource === 'shop';
  const isSold = !isShopProduct && product.status === 'sold';
  const isPending = product.status === 'pending_verification';
  const isFav = isFavorite(product.id);
  const subjectAreas = Array.isArray(product.fachbereich)
    ? product.fachbereich.filter(Boolean)
    : product.fachbereich
      ? [product.fachbereich]
      : [];

  const sellerLabel = isShopProduct ? t('product.shop_seller') : (product.seller_username || t('product.anonymous_seller'));
  const conditionLabel = product.condition ? t(conditionKeys[product.condition]) || product.condition : null;
  const productImageUrls = getProductImageUrls(product);
  const productMetaCopy = language === 'EN'
    ? {
      brand: 'Brand',
      location: 'Location',
      shipping: 'Shipping',
      shippingTypes: {
        dhl_parcel: 'DHL parcel',
        letter_mail: 'Letter mail',
        pickup: 'Pickup',
      },
    }
    : {
      brand: 'Marke',
      location: 'Standort',
      shipping: 'Versand',
      shippingTypes: {
        dhl_parcel: 'DHL-Paket',
        letter_mail: 'Briefversand',
        pickup: 'Abholung',
      },
    };

  const handleFavoriteToggle = async () => {
    if (!currentUser) {
      toast.error(t('auth.login_required_favorites'));
      navigate('/auth');
      return;
    }

    try {
      if (isFav) {
        await removeFromFavorites(product.id);
        toast.success(t('common.remove_favorite'));
      } else {
        await addToFavorites({ ...product, source: isShopProduct ? 'shop' : 'marketplace' });
        toast.success(t('product.added_to_favorites'));
      }
    } catch (error) {
      console.error('Favorite toggle error:', error);
      toast.error(t('common.favorites_update_error'));
    }
  };

  const handleAddToCart = () => {
    addToCart(product, 1, isShopProduct ? 'shop' : 'marketplace');
    toast.success(t('product.added_to_cart'));
  };

  const reviewCopy = language === 'EN'
    ? {
      title: 'Product reviews',
      empty: 'No product reviews yet.',
      verified: 'Verified buyer',
      formIntro: 'You bought this product. Share your experience with other users.',
      rating: 'Rating',
      body: 'Review',
      placeholder: 'What should other buyers know about this product?',
      lengthHint: 'Enter at least 10 characters.',
      submit: 'Submit review',
      submitting: 'Submitting...',
      submitted: 'Thanks. Your product review is now published.',
      notEligible: 'Reviews can be submitted after a delivered purchase.',
      yourReview: 'Your review',
    }
    : {
      title: 'Produktbewertungen',
      empty: 'Noch keine Produktbewertungen vorhanden.',
      verified: 'Verifizierter Kaeufer',
      formIntro: 'Du hast dieses Produkt gekauft. Teile deine Erfahrung mit anderen Nutzern.',
      rating: 'Bewertung',
      body: 'Bewertung',
      placeholder: 'Was sollten andere Kaeufer ueber dieses Produkt wissen?',
      lengthHint: 'Bitte gib mindestens 10 Zeichen ein.',
      submit: 'Bewertung senden',
      submitting: 'Wird gesendet...',
      submitted: 'Danke. Deine Produktbewertung ist jetzt veroeffentlicht.',
      notEligible: 'Bewertungen koennen nach einem zugestellten Kauf abgegeben werden.',
      yourReview: 'Deine Bewertung',
    };

  const handleSubmitProductReview = async (event) => {
    event.preventDefault();

    const token = getAuthToken();
    if (!token || !reviewEligibility?.orderId) {
      toast.error(t('auth.session_expired'));
      return;
    }

    setSubmittingReview(true);
    try {
      const result = await createCustomerReview({
        token,
        orderId: reviewEligibility.orderId,
        rating: reviewRating,
        body: reviewBody,
      });

      setReviewEligibility((current) => ({
        ...current,
        canReview: false,
        review: result.review,
      }));
      setProductReviews((current) => [result.review, ...current.filter((review) => review.id !== result.review.id)]);
      setReviewSummary((current) => {
        const nextCount = Number(current.count || 0) + 1;
        const nextAverage = ((Number(current.averageRating || 0) * Number(current.count || 0)) + Number(result.review.rating || 0)) / nextCount;
        return {
          count: nextCount,
          averageRating: Number(nextAverage.toFixed(1)),
        };
      });
      setReviewBody('');
      toast.success(reviewCopy.submitted);
    } catch (error) {
      console.error('Product review submit failed:', error);
      toast.error(error.message || t('checkout.session_error'));
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>{product.name} - Zahniboerse</title>
      </Helmet>

      <main className="flex-1 bg-white py-8 md:py-12">
        <div className="mx-auto max-w-[1210px] px-4 sm:px-6 lg:px-8 xl:px-0">
          <button
            onClick={() => navigate(-1)}
            className="mb-8 inline-flex items-center gap-2 text-base font-medium text-[#666666] transition-colors hover:text-[#0000FF]"
          >
            <ArrowLeft className="h-5 w-5" />
            {t('product.back')}
          </button>

          <div className="grid gap-9 lg:grid-cols-[minmax(0,584px)_minmax(0,584px)] lg:items-start xl:gap-12">
            <section className="overflow-hidden rounded-[12px] border border-[#d8d8d8] bg-white">
              <div className="relative aspect-square overflow-hidden bg-[#f7f7f7]">
                {productImageUrls.length > 0 ? (
                  <img src={productImageUrls[0]} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm font-medium text-slate-400">
                    {t('product.no_image')}
                  </div>
                )}

                {isSold && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/74 backdrop-blur-[2px]">
                    <span className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white">
                      {t('product.sold')}
                    </span>
                  </div>
                )}
              </div>
              {productImageUrls.length > 1 && (
                <div className="grid grid-cols-2 gap-2 border-t border-[#d8d8d8] bg-white p-2 min-[420px]:grid-cols-4">
                  {productImageUrls.slice(0, 4).map((imageUrl, index) => (
                    <div key={imageUrl} className="aspect-square overflow-hidden rounded-[8px] bg-slate-100">
                      <img src={imageUrl} alt={`${product.name} ${index + 1}`} className="h-full w-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flex min-h-full flex-col pb-1 lg:min-h-[584px]">
              <div>
                <div className="flex flex-wrap gap-2">
                  {conditionLabel && (
                    <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-sm font-medium leading-5 text-[#151515]">
                      {conditionLabel}
                    </span>
                  )}
                  {subjectAreas.map((subject) => (
                    <span
                      key={`${product.id}-${subject}`}
                      className="rounded-full bg-[#eef5ff] px-3 py-1 text-sm font-semibold leading-5 text-[#0000FF]"
                    >
                      {subjectShortLabels[subject] || t(subjectKeys[subject] || 'marketplace.subject_paro')}
                    </span>
                  ))}
                </div>

                <h1 className="mt-6 text-4xl font-semibold leading-tight text-[#181818] md:text-[40px]">
                  {product.name}
                </h1>

                <p className="mt-4 text-4xl font-bold leading-none text-[#0000FF]">
                  {formatPrice(product.price)}
                </p>

                <p className="mt-10 text-base leading-7 text-[#555555]">
                  {product.description || t('product.no_description')}
                </p>

                {(product.brand || product.location || product.shipping_type) && (
                  <dl className="mt-8 grid gap-3 rounded-[12px] border border-[#d8d8d8] bg-[#fbfbfb] p-4 text-sm sm:grid-cols-3">
                    {product.brand && (
                      <div>
                        <dt className="font-semibold text-[#666666]">{productMetaCopy.brand}</dt>
                        <dd className="mt-1 font-medium text-[#151515]">{product.brand}</dd>
                      </div>
                    )}
                    {product.location && (
                      <div>
                        <dt className="font-semibold text-[#666666]">{productMetaCopy.location}</dt>
                        <dd className="mt-1 font-medium text-[#151515]">{product.location}</dd>
                      </div>
                    )}
                    {product.shipping_type && (
                      <div>
                        <dt className="font-semibold text-[#666666]">{productMetaCopy.shipping}</dt>
                        <dd className="mt-1 font-medium text-[#151515]">
                          {productMetaCopy.shippingTypes[product.shipping_type] || product.shipping_type}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}

                {isPending && (
                  <div className="mt-8 flex items-start gap-3 rounded-[12px] border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                    <p className="text-sm leading-6">
                      <strong>{t('product.pending_title')}</strong> {t('product.pending_note')}
                    </p>
                  </div>
                )}

                <div className="mt-8 flex items-center gap-4 rounded-[12px] border border-[#d8d8d8] bg-[#fbfbfb] p-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e6f0ff] text-lg font-semibold text-[#0000FF]">
                    {sellerInitial(sellerLabel)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-[#151515]">{sellerLabel}</p>
                    <p className="mt-1 flex items-center gap-1 text-sm text-[#555555]">
                      <Star className="h-4 w-4 fill-[#f5b400] text-[#f5b400]" />
                      {reviewSummary.count > 0
                        ? `${reviewSummary.averageRating} (${reviewSummary.count})`
                        : isShopProduct ? t('popular.verified') : t('product.no_reviews')}
                    </p>
                  </div>
                  <ShieldCheck className="ml-auto h-5 w-5 shrink-0 text-emerald-500" />
                </div>
              </div>

              <div className="mt-8 flex gap-4">
                <Button
                  size="lg"
                  className="h-14 flex-1 rounded-[6px] bg-[#0000FF] text-base font-semibold text-white shadow-none hover:bg-[#0000CC]"
                  disabled={isSold || isPending}
                  onClick={handleAddToCart}
                >
                  <ShoppingCart className="mr-2 h-5 w-5" />
                  {isPending ? t('product.pending') : t('product.add_to_cart')}
                </Button>

                <Button
                  size="lg"
                  variant="outline"
                  className={`h-14 w-14 rounded-[6px] border-[#333333] p-0 shadow-none ${
                    isFav ? 'bg-red-50 text-red-500' : 'bg-white text-[#151515]'
                  }`}
                  onClick={handleFavoriteToggle}
                  aria-label={isFav ? t('common.remove_favorite') : t('common.favorite_added')}
                >
                  <Heart className={isFav ? 'fill-current' : ''} />
                </Button>
              </div>
            </section>
          </div>

          <section className="mt-12 rounded-[12px] border border-[#d8d8d8] bg-white p-6 md:p-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-[#181818]">{reviewCopy.title}</h2>
                <p className="mt-2 flex items-center gap-2 text-sm text-[#555555]">
                  <Star className="h-4 w-4 fill-[#f5b400] text-[#f5b400]" />
                  {reviewSummary.count > 0
                    ? `${reviewSummary.averageRating} / 5 (${reviewSummary.count})`
                    : reviewCopy.empty}
                </p>
              </div>
            </div>

            {reviewEligibility?.review ? (
              <div className="mt-6 rounded-[8px] border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-[#1f3b73]">{reviewCopy.yourReview}</p>
                <div className="mt-3 flex items-center gap-1">
                  {[...Array(5)].map((_, index) => (
                    <Star
                      key={index}
                      className={`h-4 w-4 ${index < Number(reviewEligibility.review.rating || 0) ? 'fill-[#0000FF] text-[#0000FF]' : 'fill-slate-200 text-slate-200'}`}
                    />
                  ))}
                </div>
                <p className="mt-3 text-sm leading-6 text-[#1f3b73]">{reviewEligibility.review.body}</p>
              </div>
            ) : reviewEligibility?.canReview ? (
              <form className="mt-6 rounded-[8px] border border-blue-100 bg-blue-50 p-4" onSubmit={handleSubmitProductReview}>
                <p className="text-sm leading-6 text-[#1f3b73]">{reviewCopy.formIntro}</p>
                <div className="mt-4">
                  <Label className="mb-2 block">{reviewCopy.rating}</Label>
                  <div className="flex items-center gap-1" role="radiogroup" aria-label={reviewCopy.rating}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={reviewRating === value}
                        className="rounded-md p-1 text-[#0000FF] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0000FF]"
                        onClick={() => setReviewRating(value)}
                      >
                        <Star className={`h-6 w-6 ${value <= reviewRating ? 'fill-[#0000FF]' : 'fill-slate-200 text-slate-200'}`} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-4">
                  <Label htmlFor="product-review-body" className="mb-2 block">{reviewCopy.body}</Label>
                  <Textarea
                    id="product-review-body"
                    required
                    minLength={REVIEW_MIN_LENGTH}
                    maxLength={REVIEW_MAX_LENGTH}
                    rows={4}
                    value={reviewBody}
                    onChange={(event) => setReviewBody(event.target.value)}
                    placeholder={reviewCopy.placeholder}
                  />
                  <p className={`mt-2 text-xs ${reviewBody.trim().length > 0 && reviewBody.trim().length < REVIEW_MIN_LENGTH ? 'text-amber-700' : 'text-[#666666]'}`}>
                    {reviewCopy.lengthHint} ({reviewBody.trim().length}/{REVIEW_MIN_LENGTH})
                  </p>
                </div>
                <Button type="submit" disabled={submittingReview || reviewBody.trim().length < REVIEW_MIN_LENGTH} className="mt-4 bg-[#0000FF] hover:bg-[#0000CC] disabled:cursor-not-allowed disabled:opacity-60">
                  {submittingReview ? reviewCopy.submitting : reviewCopy.submit}
                </Button>
              </form>
            ) : currentUser ? (
              <p className="mt-6 rounded-[8px] border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-[#555555]">{reviewCopy.notEligible}</p>
            ) : null}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {productReviews.length > 0 ? productReviews.map((review) => (
                <article key={review.id} className="rounded-[8px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-1">
                    {[...Array(5)].map((_, index) => (
                      <Star
                        key={index}
                        className={`h-4 w-4 ${index < Number(review.rating || 0) ? 'fill-[#0000FF] text-[#0000FF]' : 'fill-slate-200 text-slate-200'}`}
                      />
                    ))}
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[#151515]">"{String(review.body || '').replace(/^"+|"+$/g, '')}"</p>
                  <div className="mt-4 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[rgba(0,0,255,0.1)] text-sm font-bold text-[#0000FF]">
                      {review.initials || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#151515]">{review.displayName}</p>
                      <p className="text-xs text-[#666666]">{reviewCopy.verified}</p>
                    </div>
                  </div>
                </article>
              )) : (
                <p className="text-sm leading-6 text-[#555555]">{reviewCopy.empty}</p>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
};

export default ProductDetailPage;
