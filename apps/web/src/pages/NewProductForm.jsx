import React, { useState } from 'react';
import { Helmet } from 'react-helmet';
import { useNavigate } from 'react-router-dom';
import { Package, Layers, Droplet, ArrowRight, ArrowLeft, Plus, Trash2, ShieldCheck, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Checkbox } from '@/components/ui/checkbox.jsx';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import pb from '@/lib/pocketbaseClient.js';
import ImageUploadField from '@/components/ImageUploadField.jsx';

const FACHBEREICHE = [
  { id: 'Paro', label: 'Parodontologie' },
  { id: 'Kons', label: 'Konservierende ZHK' },
  { id: 'Pro', label: 'Prothetik' },
  { id: 'KFO', label: 'Kieferorthopädie' }
];

const SHIPPING_TYPES = [
  { value: 'dhl_parcel', key: 'product.shipping_dhl_parcel' },
  { value: 'letter_mail', key: 'product.shipping_letter_mail' },
  { value: 'pickup', key: 'product.shipping_pickup' },
];

const QUALITY_VERIFICATION_CONDITIONS = new Set(['Neu', 'Wie neu']);

const getProductVerificationKind = (productType) => (
  productType === 'Consumable' ? 'consumable' : 'item'
);

const createEmptyFormData = (productType = 'Article') => ({
  product_type: productType,
  name: '',
  description: '',
  price: '',
  condition: '',
  weight_g: '',
  brand: '',
  location: '',
  shipping_type: 'dhl_parcel',
  fachbereich: [],
  image: null,
  images: [],
  set_items: [{ name: '', quantity: 1 }]
});

const NewProductForm = () => {
  const { currentUser, isAdmin } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [selectedListingKind, setSelectedListingKind] = useState('');
  const [verificationKind, setVerificationKind] = useState('');
  const [verificationQueue, setVerificationQueue] = useState([]);
  const [formData, setFormData] = useState(createEmptyFormData('Article'));

  const isRepeatedVerificationFlow = verificationQueue.length > 0;

  const handleTypeSelect = (kind) => {
    const queuedKind = verificationKind || getProductVerificationKind(verificationQueue[0]?.productType);
    if (verificationQueue.length > 0 && queuedKind && kind !== queuedKind) {
      toast.error(t('new_product.verification_kind_locked'));
      return;
    }

    const productType = kind === 'consumable' ? 'Consumable' : kind === 'set' ? 'Set' : 'Article';
    setSelectedListingKind(kind);
    setFormData(createEmptyFormData(productType));
    setStep(2);
  };

  const handleVerifyMore = () => {
    const kind = verificationKind || getProductVerificationKind(verificationQueue[0]?.productType);
    handleTypeSelect(kind === 'consumable' ? 'consumable' : 'item');
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFachbereichToggle = (id) => {
    setFormData(prev => {
      const current = prev.fachbereich;
      if (current.includes(id)) {
        return { ...prev, fachbereich: current.filter(item => item !== id) };
      } else {
        return { ...prev, fachbereich: [...current, id] };
      }
    });
  };

  const handleSetItemChange = (index, field, value) => {
    const newItems = [...formData.set_items];
    newItems[index][field] = value;
    setFormData(prev => ({ ...prev, set_items: newItems }));
  };

  const addSetItem = () => {
    setFormData(prev => ({
      ...prev,
      set_items: [...prev.set_items, { name: '', quantity: 1 }]
    }));
  };

  const removeSetItem = (index) => {
    if (formData.set_items.length <= 1) return;
    const newItems = formData.set_items.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, set_items: newItems }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const parcelWeight = Number(formData.weight_g);

    if (!formData.name || !formData.price || !formData.condition || formData.images.length === 0) {
      toast.error(t('new_product.required_image_error'));
      return;
    }

    if (!Number.isFinite(parcelWeight) || parcelWeight <= 0) {
      toast.error(t('product.weight_invalid'));
      return;
    }

    if (formData.product_type === 'Set') {
      const invalidItems = formData.set_items.some(item => !item.name.trim() || item.quantity < 1);
      if (invalidItems) {
        toast.error(t('new_product.set_items_error'));
        return;
      }
    }

    const needsVerification = !isAdmin && QUALITY_VERIFICATION_CONDITIONS.has(formData.condition);
    if (!isAdmin && verificationQueue.length > 0 && !needsVerification) {
      toast.error(t('new_product.verification_condition_required'));
      return;
    }

    setLoading(true);
    try {
      const data = new FormData();
      data.append('product_type', formData.product_type);
      data.append('name', formData.name);
      data.append('description', formData.description);
      data.append('price', formData.price);
      data.append('condition', formData.condition);
      data.append('weight_g', String(Math.round(parcelWeight)));
      data.append('brand', formData.brand.trim());
      data.append('location', formData.location.trim());
      data.append('shipping_type', formData.shipping_type || 'dhl_parcel');
      data.append('filter_values', JSON.stringify({
        brand: formData.brand.trim(),
        location: formData.location.trim(),
        shipping_type: formData.shipping_type || 'dhl_parcel',
      }));

      if (!isAdmin) {
        data.append('seller_id', currentUser.id);
        data.append('seller_username', currentUser.seller_username || currentUser.name);
      }
      
      formData.fachbereich.forEach(fb => {
        data.append('fachbereich', fb);
      });

      if (formData.product_type === 'Set') {
        data.append('set_items', JSON.stringify(formData.set_items));
      }

      if (!isAdmin) {
        const status = needsVerification ? 'draft' : 'active';
        data.append('status', status);
        data.append('verification_status', needsVerification ? 'pending_payment' : 'not_required');
      }

      if (formData.images.length > 0) {
        formData.images.forEach((file) => data.append('images', file));
        data.append('image', formData.images[0]);
      }

      const collectionName = isAdmin ? 'shop_products' : 'products';
      const record = await pb.collection(collectionName).create(data, { $autoCancel: false });
      
      if (needsVerification) {
        const nextKind = getProductVerificationKind(formData.product_type);
        setVerificationKind(nextKind);
        setVerificationQueue((currentQueue) => [
          ...currentQueue,
          {
            id: record.id,
            name: record.name || formData.name,
            productType: record.product_type || formData.product_type,
            condition: record.condition || formData.condition,
            price: Number(record.price ?? formData.price) || 0,
          },
        ]);
        toast.success(t('new_product.verification_added_success'));
        setStep(3);
      } else {
        toast.success(isAdmin || !needsVerification ? t('new_product.publish_success') : t('new_product.validation_pending_success'));
        navigate(isAdmin ? '/shop' : '/seller-dashboard');
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(t('new_product.create_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerificationPayment = async () => {
    if (verificationQueue.length === 0) {
      toast.error(t('new_product.verification_empty_error'));
      return;
    }

    setPaymentProcessing(true);
    try {
      const authToken = pb.authStore.token;
      
      if (!authToken) {
        toast.error(t('auth.session_expired'));
        navigate('/auth');
        return;
      }

      const response = await fetch(`${window.location.origin}/hcgi/api/verification/pay-fee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          productIds: verificationQueue.map((product) => product.id),
          productName: verificationQueue.length === 1 ? verificationQueue[0].name : '',
          sellerId: currentUser.id,
          userEmail: currentUser.email
        })
      });

      if (response.status === 401) {
        toast.error(t('auth.session_expired'));
        navigate('/auth');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || t('new_product.payment_error'));
      }

      const data = await response.json();
      
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error(t('checkout.no_url'));
      }
    } catch (error) {
      console.error('Payment error:', error);
      toast.error(error.message || t('new_product.network_error'));
    } finally {
      setPaymentProcessing(false);
    }
  };

  const renderDescriptionPlaceholder = () => {
    if (formData.product_type === 'Consumable') {
      return t('new_product.description_placeholder_consumable');
    }
    if (formData.product_type === 'Set') {
      return t('new_product.description_placeholder_set');
    }
    return t('new_product.description_placeholder_article');
  };

  const qualityVerificationSelected = QUALITY_VERIFICATION_CONDITIONS.has(formData.condition);
  const verificationQueueKind = verificationKind || getProductVerificationKind(verificationQueue[0]?.productType);
  const verifyMoreLabel = verificationQueueKind === 'consumable'
    ? t('new_product.verify_more_consumables')
    : t('new_product.verify_more_items');
  const totalSteps = step === 3 || verificationQueue.length > 0 ? 3 : 2;

  return (
    <>
      <Helmet>
        <title>{t('new_product.meta_title')} - Zahnibörse</title>
      </Helmet>

      <main className="flex-1 bg-[hsl(var(--muted-bg))] py-10 md:py-14">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          
          <div className="mb-8 rounded-[8px] border border-[hsl(var(--border))] bg-white p-6 md:p-8 shadow-card">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]">{t('new_product.sell_eyebrow')}</p>
            <h1 className="text-3xl font-bold tracking-tight">{t('new_product.title')}</h1>
            <p className="text-sm font-medium text-green-700 mt-2">{t('new_product.free_listing')}</p>
            <p className="text-muted-foreground mt-3">
              {t('new_product.step_status', {
                step,
                total: totalSteps,
                label: step === 1 ? t('new_product.step_category') : step === 2 ? t('new_product.step_details') : t('new_product.step_verification')
              })}
            </p>
          </div>

          {step === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              <button
                onClick={() => handleTypeSelect('item')}
                className="flex flex-col items-center text-center p-6 md:p-8 bg-white border border-[hsl(var(--border))] rounded-[8px] hover:border-[#0000FF] hover:shadow-hover transition-all group"
              >
                <div className="w-14 h-14 bg-blue-50 rounded-[8px] flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                  <Package className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{t('new_product.type_item_title')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('new_product.type_item_body')}
                </p>
              </button>

              {!isRepeatedVerificationFlow && (
                <button
                  onClick={() => handleTypeSelect('set')}
                  className="flex flex-col items-center text-center p-6 md:p-8 bg-white border border-[hsl(var(--border))] rounded-[8px] hover:border-[#0000FF] hover:shadow-hover transition-all group"
                >
                  <div className="w-14 h-14 bg-blue-50 rounded-[8px] flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <Layers className="w-8 h-8 text-indigo-600" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{t('new_product.type_set_title')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('new_product.type_set_body')}
                  </p>
                </button>
              )}

              <button
                onClick={() => handleTypeSelect('consumable')}
                className="flex flex-col items-center text-center p-6 md:p-8 bg-white border border-[hsl(var(--border))] rounded-[8px] hover:border-[#0000FF] hover:shadow-hover transition-all group"
              >
                <div className="w-14 h-14 bg-blue-50 rounded-[8px] flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                  <Droplet className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{t('new_product.type_consumable_title')}</h3>
                <p className="text-sm text-muted-foreground">
                  {t('new_product.type_consumable_body')}
                </p>
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="bg-white border border-[hsl(var(--border))] rounded-[8px] p-6 md:p-8 shadow-card">
              <button 
                onClick={() => setStep(1)}
                className="flex items-center text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 mr-1" /> {t('new_product.back_category')}
              </button>

              <form onSubmit={handleSubmit} className="space-y-8">
                {selectedListingKind === 'item' && !isRepeatedVerificationFlow && (
                  <div className="space-y-3 rounded-[8px] border border-[hsl(var(--border))] bg-[hsl(var(--muted-bg))] p-5">
                    <Label className="text-base">{t('new_product.item_format')}</Label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setFormData((current) => ({ ...current, product_type: 'Article', set_items: [{ name: '', quantity: 1 }] }))}
                        className={`flex items-center gap-3 rounded-[8px] border bg-white p-4 text-left transition-colors ${
                          formData.product_type === 'Article'
                            ? 'border-[#0000FF] text-[#0000FF]'
                            : 'border-[hsl(var(--border))] text-slate-700 hover:border-[#0000FF]/40'
                        }`}
                      >
                        <Package className="h-5 w-5 shrink-0" />
                        <span>
                          <span className="block font-semibold">{t('new_product.type_article_title')}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{t('new_product.type_article_body')}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData((current) => ({ ...current, product_type: 'Set' }))}
                        className={`flex items-center gap-3 rounded-[8px] border bg-white p-4 text-left transition-colors ${
                          formData.product_type === 'Set'
                            ? 'border-[#0000FF] text-[#0000FF]'
                            : 'border-[hsl(var(--border))] text-slate-700 hover:border-[#0000FF]/40'
                        }`}
                      >
                        <Layers className="h-5 w-5 shrink-0" />
                        <span>
                          <span className="block font-semibold">{t('new_product.type_set_title')}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">{t('new_product.type_set_body')}</span>
                        </span>
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="space-y-3">
                  <Label className="text-base">
                    {formData.product_type === 'Set' ? t('new_product.product_images_required') : t('new_product.product_image_required')}
                  </Label>
                  <ImageUploadField 
                    maxFiles={6}
                    onFilesSelected={(files) => setFormData(prev => ({
                      ...prev,
                      image: Array.isArray(files) ? files[0] || null : files,
                      images: Array.isArray(files) ? files : files ? [files] : [],
                    }))}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3 md:col-span-2">
                    <Label htmlFor="name" className="text-base">
                      {formData.product_type === 'Set' ? t('new_product.set_name_required') : t('new_product.product_title_required')}
                    </Label>
                    <Input 
                      id="name" 
                      name="name" 
                      value={formData.name} 
                      onChange={handleChange} 
                      placeholder={formData.product_type === 'Set' ? t('new_product.set_name_placeholder') : t('new_product.title_placeholder')} 
                      className="h-12"
                      required 
                    />
                  </div>

                  {formData.product_type === 'Set' && (
                    <div className="space-y-4 md:col-span-2 bg-[hsl(var(--muted-bg))] p-5 rounded-[8px] border border-[hsl(var(--border))]">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-base">{t('new_product.included_items')} *</Label>
                      </div>
                      
                      <div className="space-y-3">
                        {formData.set_items.map((item, index) => (
                          <div key={index} className="flex items-start gap-3">
                            <div className="flex-1">
                              <Input 
                                placeholder={t('new_product.item_name_placeholder')} 
                                value={item.name}
                                onChange={(e) => handleSetItemChange(index, 'name', e.target.value)}
                                required
                              />
                            </div>
                            <div className="w-24">
                              <Input 
                                type="number" 
                                min="1" 
                                placeholder={t('new_product.quantity_placeholder')} 
                                value={item.quantity}
                                onChange={(e) => handleSetItemChange(index, 'quantity', parseInt(e.target.value) || 1)}
                                required
                              />
                            </div>
                            <Button 
                              type="button" 
                              variant="outline" 
                              size="icon"
                              className="shrink-0 text-destructive hover:bg-destructive/10"
                              onClick={() => removeSetItem(index)}
                              disabled={formData.set_items.length <= 1}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      
                      <Button 
                        type="button" 
                        variant="secondary" 
                        size="sm" 
                        onClick={addSetItem}
                        className="mt-2 gap-1"
                      >
                        <Plus className="w-4 h-4" /> {t('new_product.add_item')}
                      </Button>
                    </div>
                  )}

                  <div className="space-y-3">
                    <Label htmlFor="price" className="text-base">
                      {formData.product_type === 'Set' ? t('new_product.total_price_required') : t('new_product.price_required')}
                    </Label>
                    <Input 
                      id="price" 
                      name="price" 
                      type="number" 
                      step="0.01" 
                      min="0" 
                      value={formData.price} 
                      onChange={handleChange} 
                      className="h-12"
                      required 
                    />
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="condition" className="text-base">{t('marketplace.condition')} *</Label>
                    <Select 
                      onValueChange={(val) => setFormData({...formData, condition: val})} 
                      required
                    >
                      <SelectTrigger className="h-12 bg-white">
                        <SelectValue placeholder={t('common.select')} />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-border shadow-md">
                        <SelectItem value="Neu">{t('marketplace.condition_new')}</SelectItem>
                        <SelectItem value="Wie neu">{t('marketplace.condition_like_new')}</SelectItem>
                        <SelectItem value="Gut">{t('marketplace.condition_good')}</SelectItem>
                        <SelectItem value="Befriedigend">{t('marketplace.condition_satisfactory')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="weight_g" className="text-base">{t('product.weight_g')} *</Label>
                    <Input
                      id="weight_g"
                      name="weight_g"
                      type="number"
                      min="1"
                      step="1"
                      value={formData.weight_g}
                      onChange={handleChange}
                      className="h-12"
                      required
                    />
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="brand" className="text-base">{t('product.brand')}</Label>
                    <Input
                      id="brand"
                      name="brand"
                      value={formData.brand}
                      onChange={handleChange}
                      placeholder={t('product.brand_placeholder')}
                      className="h-12"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="location" className="text-base">{t('product.location')}</Label>
                    <Input
                      id="location"
                      name="location"
                      value={formData.location}
                      onChange={handleChange}
                      placeholder={t('product.location_placeholder')}
                      className="h-12"
                    />
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="shipping_type" className="text-base">{t('product.shipping_type')}</Label>
                    <Select
                      value={formData.shipping_type}
                      onValueChange={(val) => setFormData({ ...formData, shipping_type: val })}
                    >
                      <SelectTrigger className="h-12 bg-white">
                        <SelectValue placeholder={t('common.select')} />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-border shadow-md">
                        {SHIPPING_TYPES.map((type) => (
                          <SelectItem key={type.value} value={type.value}>{t(type.key)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-base">{t('new_product.subject_optional')}</Label>
                  <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-4 gap-4">
                    {FACHBEREICHE.map((fb) => (
                      <div key={fb.id} className="flex items-center space-x-2">
                        <Checkbox 
                          id={`fb-${fb.id}`} 
                          checked={formData.fachbereich.includes(fb.id)}
                          onCheckedChange={() => handleFachbereichToggle(fb.id)}
                        />
                        <Label htmlFor={`fb-${fb.id}`} className="font-normal cursor-pointer">
                          {t(`marketplace.subject_${fb.id.toLowerCase()}`)}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label htmlFor="description" className="text-base">{t('new_product.description')} *</Label>
                  <Textarea 
                    id="description" 
                    name="description" 
                    value={formData.description} 
                    onChange={handleChange} 
                    rows={5} 
                    placeholder={renderDescriptionPlaceholder()} 
                    className="resize-none"
                    required
                  />
                </div>

                <div className="pt-6 border-t flex flex-col sm:flex-row items-center justify-between gap-4">
                  <p className="text-sm text-muted-foreground">
                    {qualityVerificationSelected
                      ? t('new_product.paid_verification_notice')
                      : t('new_product.instant_publish_notice')}
                  </p>
                  <Button 
                    type="submit" 
                    size="lg" 
                    className="w-full sm:w-auto gap-2 text-white" 
                    disabled={loading}
                  >
                    {loading
                      ? t('new_product.creating')
                      : qualityVerificationSelected && !isAdmin
                        ? t('new_product.add_to_paid_verification')
                        : t('new_product.create_listing')}
                    {!loading && <ArrowRight className="w-4 h-4" />}
                  </Button>
                </div>

              </form>
            </div>
          )}

          {step === 3 && verificationQueue.length > 0 && (
            <div className="bg-white border border-[hsl(var(--border))] rounded-[8px] p-8 shadow-card text-center max-w-2xl mx-auto">
              <div className="w-16 h-16 bg-blue-50 rounded-[8px] flex items-center justify-center mx-auto mb-6">
                <ShieldCheck className="w-10 h-10 text-blue-600" />
              </div>
              
              <h2 className="text-2xl font-bold mb-4">{t('new_product.verification_title')}</h2>
              
              <p className="text-muted-foreground mb-8">
                {verificationQueueKind === 'consumable'
                  ? t('new_product.verification_body_consumables')
                  : t('new_product.verification_body')}
              </p>

              <div className="bg-[hsl(var(--muted-bg))] rounded-[8px] border border-[hsl(var(--border))] p-6 mb-6 text-left">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] pb-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {t('new_product.verification_queue_title', { count: verificationQueue.length })}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('new_product.verification_queue_body')}
                    </p>
                  </div>
                  <p className="rounded-[8px] bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                    {verificationQueue.length}
                  </p>
                </div>
                <div className="mb-6 space-y-2">
                  {verificationQueue.map((product, index) => (
                    <div key={product.id} className="flex items-center justify-between gap-3 rounded-[8px] bg-white p-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{index + 1}. {product.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{product.productType === 'Consumable' ? t('new_product.type_consumable_title') : t('new_product.type_item_title')} / {product.condition}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="font-medium mb-4">{t('new_product.verification_list_title')}</p>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Package className="mt-0.5 h-4 w-4 shrink-0 text-[#0000FF]" /> {t('new_product.verification_label')}
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#0000FF]" /> {t('new_product.verification_check')}
                  </li>
                  <li className="flex items-start gap-2">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[#0000FF]" /> {t('new_product.verification_ship')}
                  </li>
                </ul>
                <p className="text-sm text-muted-foreground mt-4 italic">
                  {t('new_product.verification_footer')}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="h-14 gap-2"
                  onClick={handleVerifyMore}
                  disabled={paymentProcessing}
                >
                  <Plus className="w-5 h-5" />
                  {verifyMoreLabel}
                </Button>
                <Button
                  size="lg"
                  className="h-14 gap-2 bg-[#0000FF] text-white hover:bg-[#0000CC]"
                  onClick={handleVerificationPayment}
                  disabled={paymentProcessing}
                >
                  {paymentProcessing ? t('new_product.payment_processing') : t('new_product.submit_paid_verification')}
                  {!paymentProcessing && <CreditCard className="w-5 h-5" />}
                </Button>
              </div>
            </div>
          )}

        </div>
      </main>
    </>
  );
};

export default NewProductForm;
