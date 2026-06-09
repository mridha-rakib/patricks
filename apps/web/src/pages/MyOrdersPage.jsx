import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  MapPin,
  Package,
  RefreshCw,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';
import AccountLayout from '@/components/AccountLayout.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useShopVisibility } from '@/contexts/ShopVisibilityContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import apiServerClient from '@/lib/apiServerClient.js';
import { getAuthToken } from '@/lib/getAuthToken.js';
import {
  getOrderLabelIssue,
  getOrderLabelText,
  getOrderTrackingNumber,
  hasOrderLabel,
} from '@/lib/dhlLabelUi.js';

const primaryActionClass = 'rounded-[8px] bg-[#0000FF] px-4 font-semibold text-white hover:bg-[#0000CC]';
const secondaryActionClass = 'rounded-[8px] border border-black/15 bg-white px-4 font-semibold text-[#151515] hover:border-[#0000FF]/35 hover:bg-[#f3f3ff]';
const ORDER_ACTIVE_STATUSES = new Set([
  'pending',
  'paid',
  'waiting_admin_validation',
  'validated',
  'processing',
  'shipped',
  'dhl_delivered',
  'delivered',
  'waiting_payout_release',
  'payout_available',
]);
const ORDER_COMPLETED_STATUSES = new Set(['paid_out', 'completed']);

const parseAddress = (addressData) => {
  if (!addressData) return null;
  if (typeof addressData === 'object') return addressData;

  try {
    return JSON.parse(addressData);
  } catch {
    return null;
  }
};

const getImageUrl = (product) => {
  return product?.image_url || '';
};

const MyOrdersPage = () => {
  const { currentUser } = useAuth();
  const { shopEnabled } = useShopVisibility();
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadingLabelId, setDownloadingLabelId] = useState(null);
  const [error, setError] = useState(null);

  const locale = language === 'EN' ? 'en-US' : 'de-DE';

  const formatCurrency = useCallback((amount) => (
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
    }).format(Number(amount) || 0)
  ), [locale]);

  const formatDate = useCallback((date) => {
    if (!date) return '';

    return new Date(date).toLocaleDateString(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }, [locale]);

  const getOrderStatusLabel = useCallback((status) => {
    const key = `orders.status_${status}`;
    const translated = t(key);
    return translated === key ? (status || t('orders.status_pending')) : translated;
  }, [t]);

  const fetchOrders = useCallback(async ({ silent = false } = {}) => {
    if (!currentUser?.id) {
      setLoading(false);
      return;
    }

    const token = getAuthToken();
    if (!token) {
      toast.error(t('auth.session_expired'));
      navigate('/auth');
      return;
    }

    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await apiServerClient.fetch('/orders?limit=100', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        toast.error(t('auth.session_expired'));
        navigate('/auth');
        return;
      }

      if (!response.ok) {
        throw new Error(`Orders request failed with status ${response.status}`);
      }

      const data = await response.json();
      setOrders(Array.isArray(data.items) ? data.items : []);
      setSummary(data.summary || null);
    } catch (err) {
      console.error('Error fetching orders:', err);
      setError(t('orders.load_error'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentUser?.id, navigate, t]);

  useEffect(() => {
    fetchOrders();

    const onFocus = () => {
      fetchOrders({ silent: true });
    };

    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchOrders]);

  const orderStats = useMemo(() => {
    const fallbackSummary = orders.reduce((acc, order) => {
      acc.total += 1;
      if (ORDER_ACTIVE_STATUSES.has(order.status)) acc.active += 1;
      if (ORDER_COMPLETED_STATUSES.has(order.status)) acc.completed += 1;
      return acc;
    }, {
      total: 0,
      active: 0,
      completed: 0,
    });

    const source = summary || fallbackSummary;

    return [
      {
        label: t('profile.total_orders'),
        value: source.total || 0,
        Icon: ShoppingBag,
      },
      {
        label: t('profile.active_orders'),
        value: source.active || 0,
        Icon: Truck,
      },
      {
        label: t('profile.completed_orders'),
        value: source.completed || 0,
        Icon: CheckCircle2,
      },
    ];
  }, [orders, summary, t]);

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed':
      case 'paid_out':
        return <Badge className="rounded-[8px] border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">{getOrderStatusLabel(status)}</Badge>;
      case 'dhl_delivered':
      case 'delivered':
      case 'waiting_payout_release':
      case 'payout_available':
        return <Badge className="rounded-[8px] border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">{getOrderStatusLabel(status)}</Badge>;
      case 'shipped':
        return <Badge className="rounded-[8px] border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-50">{t('orders.status_shipped')}</Badge>;
      case 'processing':
      case 'paid':
      case 'waiting_admin_validation':
      case 'validated':
        return <Badge className="rounded-[8px] border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">{t('orders.status_processing')}</Badge>;
      default:
        return <Badge variant="outline" className="rounded-[8px] bg-white">{getOrderStatusLabel(status)}</Badge>;
    }
  };

  const formatAddress = (addressData) => {
    const addr = parseAddress(addressData);
    if (!addr) return t('orders.no_address');

    return `${addr.name || addr.fullName || addr.name1 || ''}, ${addr.street || addr.addressStreet || addr.address || ''}, ${addr.postalCode || addr.postal_code || addr.zip || ''} ${addr.city || ''}`
      .replace(/^[,\s]+|[,\s]+$/g, '')
      .replace(/,\s*,/g, ',') || t('orders.no_address');
  };

  const handleDownloadLabel = async (event, order) => {
    event.stopPropagation();

    const token = getAuthToken();
    if (!token) {
      toast.error(t('auth.session_expired'));
      navigate('/auth');
      return;
    }

    if (order.dhl_label_pdf) {
      const link = document.createElement('a');
      link.href = `data:application/pdf;base64,${order.dhl_label_pdf}`;
      link.download = `DHL_Label_${order.order_number || order.id}.pdf`;
      link.click();
      return;
    }

    if (order.dhl_label_url) {
      window.open(order.dhl_label_url, '_blank', 'noopener,noreferrer');
      return;
    }

    setDownloadingLabelId(order.id);
    try {
      const response = await apiServerClient.fetch(`/orders/${order.id}/label-pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Label request failed with status ${response.status}`);
      }

      const contentType = response.headers.get('Content-Type') || '';

      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data.label_url) {
          window.open(data.label_url, '_blank', 'noopener,noreferrer');
          return;
        }
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `DHL_Label_${order.order_number || order.id}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }

      toast.error(t('orders.no_label'));
    } catch (err) {
      console.error('Error downloading order label:', err);
      toast.error(t('orders.no_label'));
    } finally {
      setDownloadingLabelId(null);
    }
  };

  return (
    <>
      <Helmet>
        <title>{t('orders.title')} - Zahnibörse</title>
      </Helmet>

      <AccountLayout activeKey="orders">
        <div className="w-full">
          <header className="mb-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-[8px] border border-[#0000FF]/20 bg-white text-[#0000FF]">
                <Package className="h-6 w-6" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-[#151515] md:text-4xl">{t('orders.title')}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#666666] md:text-base">
                {t('profile.no_orders_body')}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => fetchOrders({ silent: orders.length > 0 })}
                disabled={loading || refreshing}
                className={`${secondaryActionClass} gap-2`}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {t('orders.retry')}
              </Button>
              <Link to="/marketplace" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[8px] bg-[#0000FF] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0000CC]">
                {t('orders.shop_now')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </header>

          <section className="mb-6 grid gap-3 sm:grid-cols-3">
            {orderStats.map(({ label, value, Icon }) => (
              <div key={label} className="rounded-[8px] border border-black/10 bg-white p-5">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#f1f1ff] text-[#0000FF]">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="text-3xl font-bold text-[#151515]">{value}</p>
                <p className="mt-1 text-sm font-medium text-[#666666]">{label}</p>
              </div>
            ))}
          </section>

          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="rounded-[8px] border border-black/10 bg-white p-4">
                  <div className="flex gap-4">
                    <Skeleton className="h-24 w-24 rounded-[8px]" />
                    <div className="flex-1 space-y-3">
                      <Skeleton className="h-5 w-2/5" />
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-4 w-4/5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <section className="flex min-h-[320px] flex-col items-center justify-center rounded-[8px] border border-red-200 bg-white px-6 py-12 text-center">
              <AlertCircle className="mb-4 h-12 w-12 text-red-500" />
              <h2 className="text-2xl font-semibold text-[#151515]">{error}</h2>
              <Button onClick={() => fetchOrders()} variant="outline" className={`mt-6 gap-2 ${secondaryActionClass}`}>
                <RefreshCw className="h-4 w-4" />
                {t('orders.retry')}
              </Button>
            </section>
          ) : orders.length === 0 ? (
            <section className="flex min-h-[360px] flex-col items-center justify-center rounded-[8px] border border-dashed border-black/20 bg-white px-6 py-14 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[8px] border border-[#0000FF]/20 bg-[#f1f1ff] text-[#0000FF]">
                <Package className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-semibold text-[#151515]">{t('orders.empty')}</h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-[#666666]">
                {t('profile.no_orders_body')}
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link to={shopEnabled ? '/shop' : '/marketplace'} className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-[#0000FF] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0000CC]">
                  {shopEnabled ? t('popular.go_shop') : t('cart.go_marketplace')}
                </Link>
                {shopEnabled && (
                  <Link to="/marketplace" className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-black/15 bg-white px-5 text-sm font-semibold text-[#151515] transition-colors hover:border-[#0000FF]/35 hover:bg-[#f3f3ff]">
                    {t('cart.go_marketplace')}
                  </Link>
                )}
              </div>
            </section>
          ) : (
            <section className="space-y-3">
              {orders.map((order) => {
                const product = order.product;
                const productName = product?.name || t('orders.unknown_product');
                const productImageUrl = getImageUrl(product);
                const trackingNumber = getOrderTrackingNumber(order);
                const orderHasLabel = hasOrderLabel(order);

                return (
                  <article
                    key={order.id}
                    role="button"
                    tabIndex={0}
                    className="group rounded-[8px] border border-black/10 bg-white p-4 transition-colors hover:border-[#0000FF]/30 hover:bg-[#fbfbff]"
                    onClick={() => navigate(`/order-details/${order.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/order-details/${order.id}`);
                      }
                    }}
                  >
                    <div className="grid gap-4 lg:grid-cols-[112px_minmax(0,1fr)_220px] lg:items-center">
                      <div className="h-28 w-full overflow-hidden rounded-[8px] border border-black/10 bg-[#eef0f3] sm:w-28">
                        {productImageUrl ? (
                          <img src={productImageUrl} alt={productName} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[#8a8f98]">
                            <Package className="h-8 w-8" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          {getStatusBadge(order.status)}
                          <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-black/10 bg-white px-2.5 py-1 text-xs font-medium text-[#666666]">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {formatDate(order.created)}
                          </span>
                        </div>

                        <h2 className="line-clamp-2 text-xl font-semibold leading-tight text-[#151515] transition-colors group-hover:text-[#0000FF]">
                          {productName}
                        </h2>

                        <div className="mt-3 grid gap-2 text-sm text-[#666666] md:grid-cols-2">
                          <p className="min-w-0">
                            <span className="font-semibold text-[#151515]">{t('orders.id')}:</span>{' '}
                            <span className="font-mono text-xs">{order.order_number || order.id.substring(0, 8)}</span>
                          </p>
                          <p className="min-w-0">
                            <span className="font-semibold text-[#151515]">{t('orders.tracking_short')}:</span>{' '}
                            {trackingNumber ? (
                              <span className="break-all font-mono text-xs">{trackingNumber}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[#777777]">
                                <Clock3 className="h-3.5 w-3.5" />
                                <span title={getOrderLabelIssue(order)}>{getOrderLabelText(order, language)}</span>
                              </span>
                            )}
                          </p>
                        </div>

                        <p className="mt-3 flex gap-2 text-sm leading-5 text-[#666666]">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0000FF]" />
                          <span className="line-clamp-2">{formatAddress(order.shipping_address)}</span>
                        </p>
                      </div>

                      <div className="flex flex-col gap-3 border-t border-black/10 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                        <div>
                          <p className="text-sm font-medium text-[#666666]">{t('orders.total')}</p>
                          <p className="mt-1 text-2xl font-bold text-[#151515]">{formatCurrency(order.total_amount)}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          {orderHasLabel && (
                            <Button
                              type="button"
                              variant="outline"
                              className={`${secondaryActionClass} gap-2`}
                              onClick={(event) => handleDownloadLabel(event, order)}
                              disabled={downloadingLabelId === order.id}
                            >
                              <Download className={`h-4 w-4 ${downloadingLabelId === order.id ? 'animate-pulse' : ''}`} />
                              Label
                            </Button>
                          )}
                          <Button
                            type="button"
                            className={`${primaryActionClass} gap-2`}
                            onClick={(event) => {
                              event.stopPropagation();
                              navigate(`/order-details/${order.id}`);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                            {t('orders.view')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </div>
      </AccountLayout>
    </>
  );
};

export default MyOrdersPage;
