import React, { useCallback, useEffect, useState } from 'react';
import { Helmet } from 'react-helmet';
import { AlertCircle, CheckCircle, ExternalLink, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import AccountLayout from '@/components/AccountLayout.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import apiServerClient from '@/lib/apiServerClient.js';
import pb from '@/lib/pocketbaseClient.js';
import { getProductImageUrl } from '@/lib/productImages.js';

const ProductVerificationAdminPage = () => {
  const { t, language } = useTranslation();
  const [pendingProducts, setPendingProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  const formatPrice = (price) =>
    new Intl.NumberFormat(language === 'EN' ? 'en-US' : 'de-DE', {
      style: 'currency',
      currency: 'EUR',
    }).format(Number(price) || 0);

  const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';

    return new Intl.DateTimeFormat(language === 'EN' ? 'en-US' : 'de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };

  const getConditionLabel = (condition) => {
    switch (condition) {
      case 'Neu':
        return t('marketplace.condition_new');
      case 'Wie neu':
        return t('marketplace.condition_like_new');
      case 'Gut':
        return t('marketplace.condition_good');
      case 'Befriedigend':
        return t('marketplace.condition_satisfactory');
      default:
        return condition || '-';
    }
  };

  const getCategoryLabel = (type) => {
    switch (type) {
      case 'Set':
        return t('marketplace.type_set');
      case 'Consumable':
        return t('marketplace.type_consumable');
      case 'Article':
      default:
        return t('marketplace.type_article');
    }
  };

  const getStatusLabel = (product) => {
    if (product.verification_status === 'pending') return t('admin_verifications.status_pending');
    if (product.verification_status === 'pending_payment') return t('admin_verifications.status_pending_payment');
    if (product.verification_status === 'needs_correction') return t('admin_verifications.status_needs_correction');
    if (product.verification_status === 'rejected') return t('admin_verifications.status_rejected');
    if (product.verification_status === 'approved') return t('admin_verifications.status_approved');
    return product.status || product.verification_status || '-';
  };

  const getApiErrorMessage = useCallback(async (response, fallbackKey) => {
    const fallback = t(fallbackKey);
    const data = await response.json().catch(() => null);
    return data?.message || data?.error?.message || data?.error || fallback;
  }, [t]);

  const getAuthHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${pb.authStore.token}`,
  }), []);

  const fetchPendingProducts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiServerClient.fetch('/admin/verifications', {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'admin_verifications.load_error'));
      }

      const result = await response.json();
      setPendingProducts(Array.isArray(result.items) ? result.items : []);
    } catch (error) {
      console.error('Error fetching pending verifications:', error);
      toast.error(error.message || t('admin_verifications.load_error'));
    } finally {
      setLoading(false);
    }
  }, [getApiErrorMessage, getAuthHeaders, t]);

  useEffect(() => {
    fetchPendingProducts();
  }, [fetchPendingProducts]);

  const handleApprove = async (product) => {
    const notes = window.prompt(t('admin_verifications.approve_notes_prompt'), '');
    if (notes === null) return;

    setProcessingId(product.id);
    try {
      const response = await apiServerClient.fetch('/admin/approve-product', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ productId: product.id, notes }),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'admin_verifications.approve_error'));
      }

      toast.success(t('admin_verifications.approve_success'));
      setPendingProducts((currentProducts) => currentProducts.filter((currentProduct) => currentProduct.id !== product.id));
    } catch (error) {
      console.error('Approval error:', error);
      toast.error(error.message || t('admin_verifications.approve_error'));
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (product) => {
    const reason = window.prompt(t('admin_verifications.reject_prompt'));
    if (reason === null) return;

    setProcessingId(product.id);
    try {
      const response = await apiServerClient.fetch('/admin/reject-product', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          productId: product.id,
          reason: reason || t('admin_verifications.default_reject_reason'),
        }),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'admin_verifications.reject_error'));
      }

      toast.success(t('admin_verifications.reject_success'));
      setPendingProducts((currentProducts) => currentProducts.filter((currentProduct) => currentProduct.id !== product.id));
    } catch (error) {
      console.error('Rejection error:', error);
      toast.error(error.message || t('admin_verifications.reject_error'));
    } finally {
      setProcessingId(null);
    }
  };

  const handleRequestCorrection = async (product) => {
    const reason = window.prompt(t('admin_verifications.correction_prompt'));
    if (reason === null) return;

    setProcessingId(product.id);
    try {
      const response = await apiServerClient.fetch('/admin/request-correction-product', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          productId: product.id,
          reason: reason || t('admin_verifications.default_correction_reason'),
        }),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'admin_verifications.correction_error'));
      }

      toast.success(t('admin_verifications.correction_success'));
      setPendingProducts((currentProducts) => currentProducts.filter((currentProduct) => currentProduct.id !== product.id));
    } catch (error) {
      console.error('Correction request error:', error);
      toast.error(error.message || t('admin_verifications.correction_error'));
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <AccountLayout activeKey="admin-verifications">
        <div className="py-12 text-center text-muted-foreground">{t('admin_verifications.loading')}</div>
      </AccountLayout>
    );
  }

  return (
    <>
      <Helmet>
        <title>{t('admin_verifications.title')} - Zahnibörse</title>
      </Helmet>

      <AccountLayout activeKey="admin-verifications" contentClassName="max-w-none">
        <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t('admin_verifications.title')}</h2>
            <p className="text-muted-foreground">
              {t('admin_verifications.subtitle')}
            </p>
          </div>
          <Badge variant="secondary" className="px-4 py-1 text-lg">
            {t('admin_verifications.pending_count', { count: pendingProducts.length })}
          </Badge>
        </div>

        {pendingProducts.length === 0 ? (
          <div className="flex flex-col items-center rounded-[8px] border bg-white p-12 text-center shadow-card">
            <CheckCircle className="mb-4 h-12 w-12 text-green-500" />
            <h3 className="mb-2 text-xl font-medium">{t('admin_verifications.empty_title')}</h3>
            <p className="text-muted-foreground">{t('admin_verifications.empty_body')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[8px] border bg-white shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">{t('admin_verifications.image')}</TableHead>
                  <TableHead>{t('admin_verifications.product')}</TableHead>
                  <TableHead>{t('admin_verifications.seller')}</TableHead>
                  <TableHead>{t('admin_verifications.submitted')}</TableHead>
                  <TableHead>{t('admin_verifications.category')}</TableHead>
                  <TableHead>{t('admin_verifications.condition')}</TableHead>
                  <TableHead>{t('admin_verifications.status')}</TableHead>
                  <TableHead>{t('admin_verifications.price')}</TableHead>
                  <TableHead className="text-right">{t('admin_verifications.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted">
                        {getProductImageUrl(product) ? (
                          <img
                            src={getProductImageUrl(product)}
                            alt={product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                            {t('admin_verifications.image')}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{product.name}</div>
                      <div className="max-w-[240px] truncate text-xs text-muted-foreground">
                        {product.description || t('product.no_description')}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                        {product.brand && <span>{product.brand}</span>}
                        {product.location && <span>{product.location}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{product.seller_username || t('product.anonymous_seller')}</span>
                        {product.seller_email && (
                          <a href={`mailto:${product.seller_email}`} className="text-blue-500 hover:text-blue-700" title={t('contact.write_email')}>
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(product.validation_requested_at || product.verification_requested_at || product.created)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{getCategoryLabel(product.product_type)}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-yellow-200 bg-yellow-50 text-yellow-800">
                        {getConditionLabel(product.condition)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800">
                        {getStatusLabel(product)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {formatPrice(product.price)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-green-200 text-green-600 hover:bg-green-50 hover:text-green-700"
                          onClick={() => handleApprove(product)}
                          disabled={processingId === product.id}
                        >
                          <CheckCircle className="mr-1 h-4 w-4" />
                          {processingId === product.id ? t('admin_verifications.processing') : t('admin_verifications.approve')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                          onClick={() => handleRequestCorrection(product)}
                          disabled={processingId === product.id}
                        >
                          <AlertCircle className="mr-1 h-4 w-4" />
                          {processingId === product.id ? t('admin_verifications.processing') : t('admin_verifications.request_correction')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => handleReject(product)}
                          disabled={processingId === product.id}
                        >
                          <XCircle className="mr-1 h-4 w-4" />
                          {processingId === product.id ? t('admin_verifications.processing') : t('admin_verifications.reject')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        </div>
      </AccountLayout>
    </>
  );
};

export default ProductVerificationAdminPage;
