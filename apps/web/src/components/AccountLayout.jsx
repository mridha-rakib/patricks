import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BadgeEuro,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  PackageCheck,
  ReceiptText,
  SlidersHorizontal,
  ShoppingBag,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';

const accountNavBaseClass = 'group inline-flex min-h-11 shrink-0 items-center gap-3 rounded-[8px] px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0000FF]/30 lg:flex lg:w-full';
const accountNavInactiveClass = 'text-[#4f4f4f] hover:bg-[#f3f3ff] hover:text-[#0000FF]';
const accountNavActiveClass = 'bg-[#0000FF] text-white shadow-sm hover:bg-[#0000CC] hover:text-white';

const AccountLayout = ({
  activeKey,
  children,
  className,
  containerClassName,
  contentClassName,
  headerAction,
  title,
  description,
}) => {
  const { currentUser, isAdmin, isSeller } = useAuth();
  const { t, language } = useTranslation();
  const location = useLocation();
  const canUseSellerArea = isSeller || isAdmin;

  const accountNavItems = [
    {
      key: 'profile',
      label: t('account.nav_profile'),
      href: '/profile',
      Icon: UserRound,
    },
    {
      key: 'orders',
      label: t('account.nav_orders'),
      href: '/my-orders',
      Icon: PackageCheck,
      hidden: isAdmin,
    },
    {
      key: 'sales',
      label: t('account.nav_sales'),
      href: '/seller-dashboard?tab=orders&account=sales',
      Icon: ShoppingBag,
      hidden: !canUseSellerArea,
    },
    {
      key: 'revenue',
      label: t('account.nav_revenue'),
      href: '/seller-dashboard?tab=earnings&account=revenue',
      Icon: BadgeEuro,
      hidden: !canUseSellerArea,
    },
    {
      key: 'payouts',
      label: t('account.nav_payouts'),
      href: '/seller-dashboard?tab=earnings&account=payouts',
      Icon: WalletCards,
      hidden: !canUseSellerArea,
    },
    {
      key: 'subscriptions',
      label: t('account.nav_subscriptions'),
      href: '/learning/subscription',
      Icon: CreditCard,
    },
    {
      key: 'elearning',
      label: t('account.nav_elearning'),
      href: '/learning/dashboard',
      Icon: GraduationCap,
    },
    {
      key: 'admin',
      label: t('account.nav_admin'),
      href: '/admin',
      Icon: LayoutDashboard,
      hidden: !isAdmin,
    },
    {
      key: 'admin-verifications',
      label: t('account.nav_admin_verifications'),
      href: '/admin/verifications',
      Icon: ClipboardCheck,
      hidden: !isAdmin,
    },
    {
      key: 'admin-filters',
      label: language === 'EN' ? 'Filters' : 'Filter',
      href: '/admin/filters',
      Icon: SlidersHorizontal,
      hidden: !isAdmin,
    },
  ].filter((item) => !item.hidden);

  const isItemActive = (item) => {
    if (activeKey) return item.key === activeKey;
    if (item.key === 'revenue' || item.key === 'payouts' || item.key === 'sales') {
      return location.pathname === '/seller-dashboard' && location.search.includes(`account=${item.key}`);
    }
    return location.pathname === item.href.split('?')[0];
  };

  return (
    <main className={cn('flex-1 bg-[#f6f7f9] py-6 md:py-10', className)}>
      <div className={cn('mx-auto grid w-full max-w-none gap-5 px-4 sm:px-6 lg:grid-cols-[244px_minmax(0,1fr)] lg:px-8', containerClassName)}>
        <aside className="min-w-0">
          <div className="sticky top-24 rounded-[8px] border border-black/10 bg-white p-3 shadow-sm">
            <div className="mb-3 hidden border-b border-black/10 px-2 pb-3 lg:block">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#f1f1ff] text-[#0000FF]">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#151515]">{t('account.area')}</p>
                  <p className="truncate text-xs text-[#666666]">{currentUser?.name || currentUser?.email}</p>
                </div>
              </div>
            </div>

            <nav aria-label={t('account.area')} className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {accountNavItems.map(({ key, label, href, Icon }) => {
                const active = isItemActive({ key, href });
                return (
                  <NavLink
                    key={key}
                    to={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(accountNavBaseClass, active ? accountNavActiveClass : accountNavInactiveClass)}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="whitespace-nowrap">{label}</span>
                  </NavLink>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className={cn('min-w-0', contentClassName)}>
          {(title || description || headerAction) && (
            <header className="mb-6 flex flex-col gap-4 rounded-[8px] border border-black/10 bg-white p-5 md:flex-row md:items-end md:justify-between">
              <div>
                {title && <h1 className="text-2xl font-bold tracking-tight text-[#151515] md:text-3xl">{title}</h1>}
                {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[#666666]">{description}</p>}
              </div>
              {headerAction}
            </header>
          )}
          {children}
        </div>
      </div>
    </main>
  );
};

export default AccountLayout;
