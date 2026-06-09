import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Camera,
  CircleUserRound,
  GraduationCap,
  KeyRound,
  Mail,
  MapPin,
  PackageCheck,
  Pencil,
  Phone,
  Plus,
  Save,
  ShieldCheck,
  ShoppingBag,
  Store,
  Trash2,
  Truck,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.jsx';
import ShippingInfoSection from '@/components/ShippingInfoSection.jsx';
import AccountLayout from '@/components/AccountLayout.jsx';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useShopVisibility } from '@/contexts/ShopVisibilityContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import pb from '@/lib/pocketbaseClient.js';

const getInitials = (name = '', email = '') => {
  const source = name || email || '?';
  const parts = source.trim().split(/\s+/).filter(Boolean);

  if (parts.length > 1) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
};

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

const primaryActionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#0000FF] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#0000CC] disabled:pointer-events-none disabled:opacity-60';
const secondaryActionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-black/15 bg-white px-5 py-2.5 text-sm font-semibold text-[#151515] transition-colors hover:border-[#0000FF]/35 hover:bg-[#f3f3ff] disabled:pointer-events-none disabled:opacity-60';
const inverseActionClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-white/30 bg-transparent px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-[#0000FF]';
const heroAvatarFrameClass = 'relative flex h-36 w-36 shrink-0 items-center justify-center rounded-[8px] p-0 shadow-[0_22px_44px_-28px_rgba(15,23,42,0.22)]';
const managerAvatarFrameClass = 'relative flex h-24 w-24 shrink-0 items-center justify-center rounded-[18px] bg-[linear-gradient(180deg,#ffffff_0%,#f6f8fc_100%)] p-1.5 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.32)] ring-1 ring-black/6';
const profileStatToneClasses = [
  'border-blue-100 bg-blue-50/55 text-[#0000FF]',
  'border-emerald-100 bg-emerald-50/60 text-emerald-600',
  'border-violet-100 bg-violet-50/60 text-violet-600'
];

const ProfilePage = () => {
  const { currentUser, isSeller, isAdmin, refreshUser } = useAuth();
  const { shopEnabled } = useShopVisibility();
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [isTogglingSeller, setIsTogglingSeller] = useState(false);
  const [isEditingAccount, setIsEditingAccount] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [isEditingPassword, setIsEditingPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [isAvatarPreviewOpen, setIsAvatarPreviewOpen] = useState(false);
  const avatarInputRef = useRef(null);
  const [accountData, setAccountData] = useState({
    name: currentUser?.name || '',
    email: currentUser?.email || '',
    phone: currentUser?.phone || '',
    university: currentUser?.university || ''
  });
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    password: '',
    passwordConfirm: ''
  });

  const dateLocale = language === 'EN' ? 'en-US' : 'de-DE';
  const avatarUrl = useMemo(() => {
    if (!currentUser?.avatar) {
      return '';
    }

    return pb.files.getUrl(currentUser, currentUser.avatar, {
      thumb: '256x256'
    });
  }, [currentUser]);
  const avatarPreviewUrl = useMemo(() => {
    if (!currentUser?.avatar) {
      return '';
    }

    return pb.files.getUrl(currentUser, currentUser.avatar);
  }, [currentUser]);

  useEffect(() => {
    setAccountData({
      name: currentUser?.name || '',
      email: currentUser?.email || '',
      phone: currentUser?.phone || '',
      university: currentUser?.university || ''
    });
  }, [currentUser]);

  useEffect(() => {
    const loadOrders = async () => {
      if (!currentUser?.id || isAdmin) return;

      setIsLoadingOrders(true);
      try {
        const result = await pb.collection('orders').getFullList({
          filter: `buyer_id = "${currentUser.id}"`,
          sort: '-created',
          $autoCancel: false
        });
        setOrders(result);
      } catch (error) {
        console.error('Failed to load orders:', error);
      } finally {
        setIsLoadingOrders(false);
      }
    };

    loadOrders();
  }, [currentUser?.id, isAdmin]);

  const profileStats = useMemo(() => {
    const activeOrders = orders.filter(order => ORDER_ACTIVE_STATUSES.has(order.status)).length;
    const completedOrders = orders.filter(order => ORDER_COMPLETED_STATUSES.has(order.status)).length;

    return [
      {
        label: t('profile.total_orders'),
        value: orders.length,
        Icon: ShoppingBag
      },
      {
        label: t('profile.active_orders'),
        value: activeOrders,
        Icon: Truck
      },
      {
        label: t('profile.completed_orders'),
        value: completedOrders,
        Icon: PackageCheck
      }
    ];
  }, [orders, t]);

  const accountItems = [
    {
      label: t('shipping.name'),
      value: currentUser?.name || t('profile.not_provided'),
      Icon: CircleUserRound
    },
    {
      label: 'E-Mail',
      value: currentUser?.email || t('profile.not_provided'),
      Icon: Mail
    },
    {
      label: t('shipping.phone'),
      value: currentUser?.phone || t('profile.not_provided'),
      Icon: Phone
    },
    {
      label: t('auth.university'),
      value: currentUser?.university || t('profile.not_provided'),
      Icon: GraduationCap
    }
  ];

  const flowSteps = [
    t('profile.flow_account'),
    t('profile.flow_seller'),
    isAdmin ? t('nav.admin') : t('profile.flow_orders')
  ];

  const formatCurrency = (amount) => {
    const value = Number(amount || 0);
    return new Intl.NumberFormat(dateLocale, {
      style: 'currency',
      currency: 'EUR'
    }).format(value);
  };

  const formatDate = (date) => {
    if (!date) return t('profile.not_provided');

    return new Date(date).toLocaleDateString(dateLocale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  const getOrderStatusLabel = (status) => {
    const key = `orders.status_${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  };

  const handleSellerToggle = async (checked) => {
    if (checked) {
      if (!isSeller) {
        navigate('/seller-info');
      }
      return;
    }

    setIsTogglingSeller(true);
    try {
      await pb.collection('users').update(currentUser.id, {
        is_seller: false,
        seller_username: ''
      }, { $autoCancel: false });

      await refreshUser();
      toast.success(t('profile.seller_disabled'));
    } catch (error) {
      console.error('Toggle error:', error);
      toast.error(t('profile.seller_disable_error'));
    } finally {
      setIsTogglingSeller(false);
    }
  };

  const handleAccountChange = (event) => {
    const { name, value } = event.target;
    setAccountData(prev => ({ ...prev, [name]: value }));
  };

  const resetAvatarInput = () => {
    if (avatarInputRef.current) {
      avatarInputRef.current.value = '';
    }
  };

  const handleAvatarUpload = async (event) => {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile || !currentUser?.id) {
      resetAvatarInput();
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(selectedFile.type)) {
      toast.error(t('upload.invalid_type'));
      resetAvatarInput();
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      toast.error(t('upload.too_large', { file: selectedFile.name }));
      resetAvatarInput();
      return;
    }

    setAvatarLoading(true);
    try {
      const data = new FormData();
      data.append('avatar', selectedFile);

      await pb.collection('users').update(currentUser.id, data, { $autoCancel: false });
      await refreshUser();
      toast.success(t('profile.photo_save_success'));
    } catch (error) {
      console.error('Avatar update error:', error);
      toast.error(t('profile.photo_save_error'));
    } finally {
      setAvatarLoading(false);
      resetAvatarInput();
    }
  };

  const handleRemoveAvatar = async () => {
    if (!currentUser?.id || !currentUser?.avatar) {
      return;
    }

    setAvatarLoading(true);
    try {
      const data = new FormData();
      data.append('avatar-', currentUser.avatar);

      await pb.collection('users').update(currentUser.id, data, { $autoCancel: false });
      await refreshUser();
      toast.success(t('profile.photo_remove_success'));
    } catch (error) {
      console.error('Avatar removal error:', error);
      toast.error(t('profile.photo_remove_error'));
    } finally {
      setAvatarLoading(false);
      resetAvatarInput();
    }
  };

  const renderAvatarManager = () => (
    <div className="mb-6 rounded-[24px] border border-black/8 bg-[linear-gradient(180deg,#ffffff_0%,#f7f7f7_100%)] p-5 shadow-[0_18px_36px_-30px_rgba(15,23,42,0.26)]">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className={managerAvatarFrameClass}>
            <Avatar className="h-full w-full rounded-[14px] border border-white/80 bg-white">
              <AvatarImage src={avatarUrl} alt={currentUser?.name || currentUser?.email || t('profile.title')} />
              <AvatarFallback className="rounded-[14px] bg-[#0000FF] text-xl font-bold text-white">
                {getInitials(currentUser?.name, currentUser?.email)}
              </AvatarFallback>
            </Avatar>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#777777]">
              {t('profile.photo_title')}
            </p>
            <p className="mt-2 max-w-md text-sm leading-6 text-[#666666]">
              {t('profile.photo_body')}
            </p>
          </div>
        </div>

        <input
          ref={avatarInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleAvatarUpload}
        />

        <div className="flex flex-col gap-2 sm:items-end">
          <button
            type="button"
            className={primaryActionClass}
            onClick={() => avatarInputRef.current?.click()}
            disabled={avatarLoading}
          >
            <Camera className="h-4 w-4" />
            {avatarLoading ? t('shipping.saving') : t('profile.photo_upload')}
          </button>

          {currentUser?.avatar && (
            <button
              type="button"
              className={secondaryActionClass}
              onClick={handleRemoveAvatar}
              disabled={avatarLoading}
            >
              <Trash2 className="h-4 w-4" />
              {t('profile.photo_remove')}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const resetAccountForm = () => {
    setIsEditingAccount(false);
    setAccountData({
      name: currentUser?.name || '',
      email: currentUser?.email || '',
      phone: currentUser?.phone || '',
      university: currentUser?.university || ''
    });
  };

  const handleSaveAccount = async (event) => {
    event?.preventDefault();

    if (!accountData.email) {
      toast.error(t('profile.email_required'));
      return;
    }

    setAccountLoading(true);
    try {
      await pb.collection('users').update(currentUser.id, accountData, { $autoCancel: false });
      await refreshUser();
      toast.success(t('profile.account_save_success'));
      setIsEditingAccount(false);
    } catch (error) {
      console.error('Update error:', error);
      toast.error(t('profile.account_save_error'));
    } finally {
      setAccountLoading(false);
    }
  };

  const handlePasswordChange = (event) => {
    const { name, value } = event.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
  };

  const resetPasswordForm = () => {
    setIsEditingPassword(false);
    setPasswordData({
      oldPassword: '',
      password: '',
      passwordConfirm: ''
    });
  };

  const handleSavePassword = async (event) => {
    event.preventDefault();

    if (!passwordData.oldPassword || !passwordData.password || !passwordData.passwordConfirm) {
      toast.error(t('profile.password_required'));
      return;
    }

    if (passwordData.password.length < 8) {
      toast.error(t('profile.password_min'));
      return;
    }

    if (passwordData.password !== passwordData.passwordConfirm) {
      toast.error(t('profile.password_mismatch'));
      return;
    }

    setPasswordLoading(true);
    try {
      await pb.collection('users').update(currentUser.id, {
        oldPassword: passwordData.oldPassword,
        password: passwordData.password,
        passwordConfirm: passwordData.passwordConfirm
      }, { $autoCancel: false });

      toast.success(t('profile.password_save_success'));
      resetPasswordForm();
    } catch (error) {
      console.error('Password update error:', error);
      toast.error(t('profile.password_save_error'));
    } finally {
      setPasswordLoading(false);
    }
  };

  if (isAdmin) {
    return (
      <>
        <Helmet>
          <title>{t('profile.admin_title')} - Zahnibörse</title>
        </Helmet>

        <AccountLayout activeKey="profile">
          <div>
            <section className="overflow-hidden rounded-[32px] border border-black/10 bg-white text-[#151515]">
              <div className="grid gap-8 p-6 md:p-10 lg:grid-cols-[1fr_360px] lg:items-center">
                <div>
                  <p className="mb-4 text-xs font-semibold uppercase tracking-[0.24em] text-[#0000FF]">
                    {t('profile.admin_eyebrow')}
                  </p>
                  <h1 className="text-4xl font-bold leading-tight md:text-5xl">
                    {currentUser?.name || t('profile.admin_title')}
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-6 text-[#4f4f4f] md:text-base">
                    {t('profile.admin_subtitle')}
                  </p>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link to="/admin" className={primaryActionClass}>
                      {t('nav.admin')}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link to="/admin/verifications" className={secondaryActionClass}>
                      {t('profile.admin_verifications')}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>

                <div className="rounded-[28px] border border-black/10 bg-[#f7f7f7] p-5">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-[#0000FF]">
                    <ShieldCheck className="h-8 w-8" />
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#777777]">
                    {t('profile.admin_role')}
                  </p>
                  <p className="mt-2 text-2xl font-semibold">{t('profile.admin_access')}</p>
                  <p className="mt-3 text-sm leading-6 text-[#555555]">
                    {t('profile.admin_access_body')}
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-6 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="overflow-hidden rounded-[28px] border border-black/10 bg-white">
                <header className="flex flex-col gap-4 border-b border-black/10 p-6 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#0000FF]">
                      {t('profile.details_eyebrow')}
                    </p>
                    <h2 className="text-2xl font-semibold">{t('profile.account_info')}</h2>
                  </div>
                  {!isEditingAccount && (
                    <button type="button" className={secondaryActionClass} onClick={() => setIsEditingAccount(true)}>
                      <Pencil className="h-4 w-4" />
                      {t('seller.edit')}
                    </button>
                  )}
                </header>

                <div className="p-6">
                  {renderAvatarManager()}

                  {isEditingAccount ? (
                    <form className="space-y-5" onSubmit={handleSaveAccount}>
                      <div className="space-y-2">
                        <Label htmlFor="admin-name">{t('shipping.name')}</Label>
                        <Input id="admin-name" name="name" value={accountData.name} onChange={handleAccountChange} autoComplete="name" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="admin-email">E-Mail *</Label>
                        <Input id="admin-email" name="email" type="email" value={accountData.email} onChange={handleAccountChange} autoComplete="email" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="admin-phone">{t('shipping.phone')}</Label>
                        <Input id="admin-phone" name="phone" value={accountData.phone} onChange={handleAccountChange} autoComplete="tel" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="admin-university">{t('auth.university')}</Label>
                        <Input id="admin-university" name="university" value={accountData.university} onChange={handleAccountChange} />
                      </div>
                      <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                        <button type="submit" disabled={accountLoading} className={primaryActionClass}>
                          <Save className="h-4 w-4" />
                          {accountLoading ? t('shipping.saving') : t('shipping.save')}
                        </button>
                        <button type="button" onClick={resetAccountForm} disabled={accountLoading} className={secondaryActionClass}>
                          <X className="h-4 w-4" />
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="grid gap-3">
                      {accountItems.map(({ label, value, Icon, mono }) => (
                        <div key={label} className="flex gap-4 rounded-[22px] border border-black/10 bg-[#f7f7f7] p-4">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#0000FF]/15 bg-[#f1f1ff] text-[#0000FF]">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#777777]">{label}</p>
                            <p className={`mt-1 break-words text-sm font-semibold text-[#151515] ${mono ? 'font-mono' : ''}`}>
                              {value}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-5">
                <section className="rounded-[28px] border border-black/10 bg-white p-6">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-[#0000FF]">
                    <Store className="h-6 w-6" />
                  </div>
                  <h2 className="text-2xl font-semibold">{t('profile.admin_workspace_title')}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#666666]">
                    {t('profile.admin_workspace_body')}
                  </p>
                  <div className="mt-6 grid gap-3 sm:grid-cols-3">
                    <Link to="/admin" className={primaryActionClass}>
                      {t('profile.admin_open_dashboard')}
                    </Link>
                    <Link to="/admin/verifications" className={secondaryActionClass}>
                      {t('profile.admin_review_products')}
                    </Link>
                    <Link to="/seller/new-product" className={secondaryActionClass}>
                      {t('marketplace.sell_now')}
                    </Link>
                  </div>
                </section>

                <section className="rounded-[28px] border border-black/10 bg-white p-6">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1f1ff] text-[#0000FF]">
                    <KeyRound className="h-6 w-6" />
                  </div>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#0000FF]">
                        {t('profile.security_eyebrow')}
                      </p>
                      <h2 className="text-2xl font-semibold">{t('profile.password_title')}</h2>
                      <p className="mt-2 text-sm leading-6 text-[#666666]">
                        {t('profile.password_body')}
                      </p>
                    </div>
                    {!isEditingPassword && (
                      <button type="button" className={secondaryActionClass} onClick={() => setIsEditingPassword(true)}>
                        <Pencil className="h-4 w-4" />
                        {t('profile.password_change')}
                      </button>
                    )}
                  </div>

                  {isEditingPassword && (
                    <form className="mt-6 space-y-4" onSubmit={handleSavePassword}>
                      <div className="space-y-2">
                        <Label htmlFor="admin-old-password">{t('profile.current_password')}</Label>
                        <Input id="admin-old-password" name="oldPassword" type="password" value={passwordData.oldPassword} onChange={handlePasswordChange} autoComplete="current-password" />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="admin-new-password">{t('profile.new_password')}</Label>
                          <Input id="admin-new-password" name="password" type="password" value={passwordData.password} onChange={handlePasswordChange} autoComplete="new-password" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="admin-confirm-password">{t('profile.confirm_password')}</Label>
                          <Input id="admin-confirm-password" name="passwordConfirm" type="password" value={passwordData.passwordConfirm} onChange={handlePasswordChange} autoComplete="new-password" />
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                        <button type="submit" disabled={passwordLoading} className={primaryActionClass}>
                          <Save className="h-4 w-4" />
                          {passwordLoading ? t('shipping.saving') : t('profile.password_save')}
                        </button>
                        <button type="button" onClick={resetPasswordForm} disabled={passwordLoading} className={secondaryActionClass}>
                          <X className="h-4 w-4" />
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  )}
                </section>

                <section className="rounded-[28px] border border-black/10 bg-white p-6">
                  <h2 className="text-xl font-semibold">{t('profile.admin_no_orders_title')}</h2>
                  <p className="mt-2 text-sm leading-6 text-[#686868]">
                    {t('profile.admin_no_orders_body')}
                  </p>
                </section>
              </div>
            </section>
          </div>
        </AccountLayout>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>{t('profile.title')} - Zahnibörse</title>
      </Helmet>

      <AccountLayout activeKey="profile" containerClassName="max-w-none xl:px-9 2xl:px-10">
        <div>
          <section className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.9fr)]">
            <div className="overflow-hidden rounded-[8px] border border-black/10 bg-white p-6 shadow-[0_18px_44px_-36px_rgba(15,23,42,0.28)] md:p-8">
              <div className="flex flex-col gap-7 md:flex-row md:items-center">
                <div className="relative w-fit">
                  <button
                    type="button"
                    className={`${heroAvatarFrameClass} ${avatarPreviewUrl ? 'cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-[#0000FF]/20' : 'cursor-default'}`}
                    onClick={() => {
                      if (avatarPreviewUrl) {
                        setIsAvatarPreviewOpen(true);
                      }
                    }}
                    aria-label={avatarPreviewUrl ? t('profile.photo_title') : currentUser?.name || currentUser?.email || t('profile.title')}
                  >
                    <Avatar className="h-full w-full rounded-[8px] bg-white">
                      <AvatarImage src={avatarUrl} alt={currentUser?.name || currentUser?.email || t('profile.title')} />
                      <AvatarFallback className="rounded-[8px] bg-[#0000FF] text-3xl font-bold text-white">
                        {getInitials(currentUser?.name, currentUser?.email)}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                  <span className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-white bg-white text-[#0000FF] shadow-sm">
                    <Camera className="h-4 w-4" />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    {isSeller && (
                      <span className="inline-flex min-h-9 items-center gap-2 rounded-[8px] border border-[#0000FF]/12 bg-[#f1f4ff] px-3.5 py-1.5 text-xs font-semibold text-[#0000FF]">
                        <ShieldCheck className="h-4 w-4" />
                        {t('profile.seller_verified')}
                      </span>
                    )}
                  </div>
                  <h1 className="text-3xl font-bold leading-tight text-[#111111] md:text-4xl">
                    {currentUser?.name || t('profile.title')}
                  </h1>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-[#5f5f5f]">
                    {t('profile.subtitle')}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-x-7 gap-y-3 text-sm text-[#666666]">
                    <span className="inline-flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      {currentUser?.email || t('profile.not_provided')}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {currentUser?.university || t('profile.not_provided')}
                    </span>
                  </div>
                  <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                    <button type="button" className={primaryActionClass} onClick={() => setIsEditingAccount(true)}>
                      <Pencil className="h-4 w-4" />
                      {t('profile.edit_profile')}
                    </button>
                    <Link to={isSeller ? '/seller-products' : '/seller-info'} className={secondaryActionClass}>
                      <Store className="h-4 w-4" />
                      {t('profile.view_public_store')}
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <aside className="rounded-[8px] border border-black/10 bg-white p-6 shadow-[0_18px_44px_-36px_rgba(15,23,42,0.28)] md:p-8">
              <h2 className="text-base font-bold text-[#151515]">
                {t('profile.seller_status')}
              </h2>
              <div className="mt-5 flex items-start justify-between gap-5 rounded-[8px] border border-black/10 bg-white p-4 shadow-sm">
                <div>
                  <Label htmlFor="seller-mode" className="cursor-pointer text-base font-semibold text-[#151515]">
                    {t('profile.seller_mode')}
                  </Label>
                  <p className="mt-2 max-w-[250px] text-sm leading-6 text-[#666666]">
                    {isSeller ? t('profile.seller_active_hint') : t('profile.seller_inactive_hint')}
                  </p>
                </div>
                <Switch
                  id="seller-mode"
                  checked={isSeller}
                  onCheckedChange={handleSellerToggle}
                  disabled={isTogglingSeller}
                  aria-label={t('profile.seller_mode')}
                  className="mt-1 shrink-0"
                />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-3">
                {profileStats.map(({ label, value, Icon }, index) => (
                  <div key={label} className={`rounded-[8px] border p-4 ${profileStatToneClasses[index] || profileStatToneClasses[0]}`}>
                    <div className="mb-6 flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/75">
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="text-2xl font-bold text-[#111111]">{value}</p>
                    <p className="mt-1 text-xs leading-4 text-[#565656]">{label}</p>
                    <Link to={index === 1 ? '/seller-products' : '/my-orders'} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#0000FF]">
                      {index === 1 ? t('profile.manage') : index === 2 ? t('profile.view_reports') : t('profile.view_all')}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            </aside>
          </section>

          <section className="mb-5 rounded-[28px] border border-black/12 bg-white p-4 md:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#777777]">
                {t('profile.flow_title')}
              </p>
              <div className="grid flex-1 gap-2 md:grid-cols-3">
                {flowSteps.map((step, index) => (
                  <div key={step} className="flex items-center gap-3 rounded-full border border-black/10 bg-white px-4 py-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0000FF] text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <span className="text-sm font-semibold text-[#171717]">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="space-y-5">
              <section className="overflow-hidden rounded-[28px] border border-black/12 bg-white">
                <header className="flex flex-col gap-4 border-b border-black/10 p-6 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#0000FF]">
                      {t('profile.details_eyebrow')}
                    </p>
                    <h2 className="text-2xl font-semibold">{t('profile.account_info')}</h2>
                  </div>
                  {!isEditingAccount && (
                    <button type="button" className={secondaryActionClass} onClick={() => setIsEditingAccount(true)}>
                      <Pencil className="h-4 w-4" />
                      {t('seller.edit')}
                    </button>
                  )}
                </header>

                <div className="p-6">
                  {renderAvatarManager()}

                  {isEditingAccount ? (
                    <form className="space-y-5" onSubmit={handleSaveAccount}>
                      <div className="space-y-2">
                        <Label htmlFor="name">{t('shipping.name')}</Label>
                        <Input id="name" name="name" value={accountData.name} onChange={handleAccountChange} autoComplete="name" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">E-Mail *</Label>
                        <Input id="email" name="email" type="email" value={accountData.email} onChange={handleAccountChange} autoComplete="email" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">{t('shipping.phone')}</Label>
                        <Input id="phone" name="phone" value={accountData.phone} onChange={handleAccountChange} autoComplete="tel" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="university">{t('auth.university')}</Label>
                        <Input id="university" name="university" value={accountData.university} onChange={handleAccountChange} />
                      </div>
                      <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                        <button type="submit" disabled={accountLoading} className={primaryActionClass}>
                          <Save className="h-4 w-4" />
                          {accountLoading ? t('shipping.saving') : t('shipping.save')}
                        </button>
                        <button type="button" onClick={resetAccountForm} disabled={accountLoading} className={secondaryActionClass}>
                          <X className="h-4 w-4" />
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="grid gap-3">
                      {accountItems.map(({ label, value, Icon, mono }) => (
                        <div key={label} className="flex gap-4 rounded-[22px] border border-black/10 bg-[#f7f7f7] p-4">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#0000FF]/15 bg-[#f1f1ff] text-[#0000FF]">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#777777]">{label}</p>
                            <p className={`mt-1 break-words text-sm font-semibold text-[#151515] ${mono ? 'font-mono' : ''}`}>
                              {value}
                            </p>
                          </div>
                        </div>
                      ))}

                      {isSeller && (
                        <div className="flex gap-4 rounded-[22px] border border-[#0000FF]/18 bg-[#f4f4ff] p-4">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#0000FF]/15 bg-white text-[#0000FF]">
                            <Store className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#777777]">{t('seller.username')}</p>
                            <p className="mt-1 break-words text-sm font-semibold text-[#0000FF]">
                              {currentUser?.seller_username || t('profile.not_provided')}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="overflow-hidden rounded-[28px] border border-black/12 bg-white">
                <header className="flex flex-col gap-4 border-b border-black/10 p-6 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#0000FF]">
                      {t('profile.security_eyebrow')}
                    </p>
                    <h2 className="text-2xl font-semibold">{t('profile.password_title')}</h2>
                    <p className="mt-2 text-sm leading-6 text-[#666666]">
                      {t('profile.password_body')}
                    </p>
                  </div>
                  {!isEditingPassword && (
                    <button type="button" className={secondaryActionClass} onClick={() => setIsEditingPassword(true)}>
                      <KeyRound className="h-4 w-4" />
                      {t('profile.password_change')}
                    </button>
                  )}
                </header>

                <div className="p-6">
                  {isEditingPassword ? (
                    <form className="space-y-4" onSubmit={handleSavePassword}>
                      <div className="space-y-2">
                        <Label htmlFor="old-password">{t('profile.current_password')}</Label>
                        <Input id="old-password" name="oldPassword" type="password" value={passwordData.oldPassword} onChange={handlePasswordChange} autoComplete="current-password" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-password">{t('profile.new_password')}</Label>
                        <Input id="new-password" name="password" type="password" value={passwordData.password} onChange={handlePasswordChange} autoComplete="new-password" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="confirm-password">{t('profile.confirm_password')}</Label>
                        <Input id="confirm-password" name="passwordConfirm" type="password" value={passwordData.passwordConfirm} onChange={handlePasswordChange} autoComplete="new-password" />
                      </div>
                      <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                        <button type="submit" disabled={passwordLoading} className={primaryActionClass}>
                          <Save className="h-4 w-4" />
                          {passwordLoading ? t('shipping.saving') : t('profile.password_save')}
                        </button>
                        <button type="button" onClick={resetPasswordForm} disabled={passwordLoading} className={secondaryActionClass}>
                          <X className="h-4 w-4" />
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex gap-4 rounded-[22px] border border-black/10 bg-[#f7f7f7] p-4">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#0000FF]/15 bg-[#f1f1ff] text-[#0000FF]">
                        <KeyRound className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#777777]">
                          {t('profile.password_status')}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[#151515]">
                          {t('profile.password_status_body')}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              <div className="[&>section]:overflow-hidden">
                <ShippingInfoSection />
              </div>

              {isSeller && (
                <section className="overflow-hidden rounded-[28px] border border-[#0000FF] bg-[#0000FF] text-white">
                  <div className="p-6">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/40 bg-white text-[#0000FF]">
                      <Store className="h-6 w-6" />
                    </div>
                    <h2 className="text-2xl font-semibold">{t('seller.my_items')}</h2>
                    <p className="mt-2 text-sm leading-6 text-white/78">
                      {t('profile.seller_items_body')}
                    </p>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      <Link to="/seller/new-product" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#0000FF] transition-colors hover:bg-[#ededff]">
                        <Plus className="h-4 w-4" />
                        {t('seller.sell_first')}
                      </Link>
                      <Link to="/seller-products" className={inverseActionClass}>
                        {t('profile.manage_items')}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </section>
              )}
            </div>

            <section className="space-y-5">
              <section className="overflow-hidden rounded-[28px] border border-black/12 bg-white">
                <header className="flex flex-col gap-4 border-b border-black/10 p-6 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#0000FF]">
                      {t('profile.activity_eyebrow')}
                    </p>
                    <h2 className="text-2xl font-semibold">{t('orders.title')}</h2>
                  </div>
                  <Link to="/my-orders" className={secondaryActionClass}>
                    {t('orders.view')}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </header>

                <div className="p-6">
                  {isLoadingOrders ? (
                    <div className="grid gap-3">
                      {[0, 1, 2].map(item => (
                        <div key={item} className="h-24 animate-pulse rounded-[22px] border border-black/8 bg-black/[0.03]" />
                      ))}
                    </div>
                  ) : orders.length > 0 ? (
                    <div className="space-y-3">
                      {orders.slice(0, 4).map(order => (
                        <div key={order.id} className="rounded-[22px] border border-black/10 bg-[#f7f7f7] p-4 transition-colors hover:border-[#0000FF]/35 hover:bg-white">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[#151515]">
                                {t('orders.id')} #{order.order_number || order.id}
                              </p>
                              <p className="mt-1 text-sm text-[#707070]">{formatDate(order.created)}</p>
                            </div>
                            <span className="w-fit rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-semibold text-[#151515]">
                              {getOrderStatusLabel(order.status)}
                            </span>
                          </div>
                          <div className="mt-4 flex flex-col gap-2 border-t border-black/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-lg font-bold text-[#0000FF]">{formatCurrency(order.total_amount)}</p>
                            {order.dhl_tracking_number ? (
                              <p className="text-sm text-[#707070]">
                                {t('orders.tracking_short')}: {order.dhl_tracking_number}
                              </p>
                            ) : (
                              <p className="text-sm text-[#707070]">{t('order_details.tracking_pending')}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[26px] border border-dashed border-black/18 bg-[#f7f7f7] px-6 py-10 text-center">
                      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#0000FF]/15 bg-white text-[#0000FF]">
                        <ShoppingBag className="h-7 w-7" />
                      </div>
                      <h2 className="text-2xl font-semibold text-[#151515]">{t('orders.empty')}</h2>
                      <p className="mt-3 max-w-md text-sm leading-6 text-[#686868]">
                        {t('profile.no_orders_body')}
                      </p>
                      <Link to={shopEnabled ? '/shop' : '/marketplace'} className={`mt-6 ${primaryActionClass}`}>
                        {shopEnabled ? t('orders.shop_now') : t('cart.go_marketplace')}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-[28px] border border-black/12 bg-white text-[#151515]">
                <div className="grid gap-5 p-6 md:grid-cols-[auto_1fr_auto] md:items-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#0000FF]/15 bg-[#f1f1ff] text-[#0000FF]">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="mt-2 text-sm leading-6 text-[#686868]">{t('profile.safe_account_body')}</p>
                  </div>
                  <Link to="/hilfe" className={secondaryActionClass}>{t('profile.get_help')}</Link>
                </div>
              </section>
            </section>
          </div>
        </div>
      </AccountLayout>

      <Dialog open={isAvatarPreviewOpen} onOpenChange={setIsAvatarPreviewOpen}>
        <DialogContent className="w-[92vw] max-w-3xl overflow-hidden border border-black/8 bg-white p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{t('profile.photo_title')}</DialogTitle>
          </DialogHeader>
          <div className="bg-[#f7f7f7] p-3 sm:p-4">
            <div className="overflow-hidden rounded-[8px] bg-white">
              {avatarPreviewUrl ? (
                <img
                  src={avatarPreviewUrl}
                  alt={currentUser?.name || currentUser?.email || t('profile.title')}
                  className="max-h-[80vh] w-full object-contain"
                />
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProfilePage;
