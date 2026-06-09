import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Helmet } from 'react-helmet';
import {
  Users, Package, ShoppingCart, DollarSign, AlertCircle,
  RefreshCw, Search, Filter, MoreVertical, Edit, Trash2, Copy,
  Eye, CheckCircle, XCircle, Download, Store, ArrowUpRight,
  Settings, BarChart3, RotateCcw, ArrowLeft
} from 'lucide-react';
import pb from '@/lib/pocketbaseClient.js';
import apiServerClient from '@/lib/apiServerClient.js';
import {
  buildOrderFromLabelError,
  buildOrderFromLabelResponse,
  canGenerateOrderLabel,
  getOrderLabelIssue,
  getOrderLabelText,
  getOrderTrackingNumber as resolveOrderTrackingNumber,
  hasOrderLabel as resolveHasOrderLabel,
} from '@/lib/dhlLabelUi.js';
import { getProductImageUrl as resolveProductImageUrl } from '@/lib/productImages.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Checkbox } from '@/components/ui/checkbox.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { toast } from 'sonner';
import { useShopVisibility } from '@/contexts/ShopVisibilityContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';

const parseShippingAddress = (rawAddress) => {
  if (!rawAddress) return {};
  if (typeof rawAddress === 'object') return rawAddress;

  try {
    return JSON.parse(rawAddress);
  } catch {
    return {};
  }
};

const getShippingAddressLines = (rawAddress) => {
  const address = parseShippingAddress(rawAddress);

  return [
    address.name || address.fullName || address.name1 || '',
    address.street || address.addressStreet || address.address || '',
    [address.postalCode || address.postal_code || address.zip || '', address.city || ''].filter(Boolean).join(' '),
    address.country || '',
  ].filter(Boolean);
};

const triggerPdfDownload = (blobOrBase64, filename, mimeType = 'application/pdf') => {
  const link = document.createElement('a');

  if (typeof blobOrBase64 === 'string') {
    link.href = `data:${mimeType};base64,${blobOrBase64}`;
  } else {
    const url = URL.createObjectURL(blobOrBase64);
    link.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  link.download = filename;
  link.click();
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
const ORDER_LABEL_ELIGIBLE_STATUSES = new Set(['paid', 'waiting_admin_validation', 'validated', 'processing']);
const ORDER_SHIPPABLE_STATUSES = new Set(['paid', 'waiting_admin_validation', 'validated', 'processing']);
const ORDER_DHL_DELIVERABLE_STATUSES = new Set(['shipped']);
const ORDER_CANCELLABLE_STATUSES = new Set(['pending', 'paid', 'waiting_admin_validation', 'validated', 'processing', 'shipped']);
const ORDER_DELIVERED_DISPLAY_STATUSES = new Set(['dhl_delivered', 'delivered', 'waiting_payout_release', 'payout_available', 'paid_out', 'completed']);
const ORDER_VALIDATABLE_STATUSES = new Set(['paid', 'waiting_admin_validation']);
const ORDER_PAUSABLE_STATUSES = new Set(['paid', 'validated', 'processing']);
const ORDER_REFUNDABLE_STATUSES = new Set(['paid', 'waiting_admin_validation', 'validated', 'processing', 'shipped', 'dhl_delivered', 'delivered', 'waiting_payout_release', 'payout_available', 'cancelled']);

const AdminDashboardPage = () => {
  const { t, language } = useTranslation();
  const { refreshShopVisibility } = useShopVisibility();
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [tableProducts, setTableProducts] = useState([]);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [tableUsers, setTableUsers] = useState([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [returns, setReturns] = useState([]);
  const [sellerEarnings, setSellerEarnings] = useState([]);
  const [settings, setSettings] = useState(null);
  const [settingsForm, setSettingsForm] = useState({
    shipping_fee: 4.99,
    service_fee: 1.99,
    transaction_fee_percentage: 7,
    verification_fee: 15,
    shop_enabled: false,
  });

  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('all');
  const [productTypeFilter, setProductTypeFilter] = useState('all');
  const [userSearch, setUserSearch] = useState('');
  const [sellerSearch, setSellerSearch] = useState('');
  const [tableSellers, setTableSellers] = useState([]);
  const [isSellersLoading, setIsSellersLoading] = useState(false);
  const [sellerSummary, setSellerSummary] = useState({
    totalSellers: 0,
    totalListings: 0,
    activeListings: 0,
    totalOrders: 0,
    availableBalance: 0,
    revenueTotal: 0,
  });
  const [analyticsData, setAnalyticsData] = useState({
    orderVolume: [],
    topSellers: [],
    summary: null,
  });
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [payoutRequests, setPayoutRequests] = useState([]);
  const [payoutConflicts, setPayoutConflicts] = useState([]);
  const [isPayoutsLoading, setIsPayoutsLoading] = useState(false);
  const [payoutStatusFilter, setPayoutStatusFilter] = useState('requested');
  const [payoutConflictStatusFilter, setPayoutConflictStatusFilter] = useState('open');
  const [payoutActionLoadingId, setPayoutActionLoadingId] = useState('');

  const [selectedProducts, setSelectedProducts] = useState([]);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [currentProduct, setCurrentProduct] = useState(null);
  const [currentUserRecord, setCurrentUserRecord] = useState(null);
  const [orderDetailsModalOpen, setOrderDetailsModalOpen] = useState(false);
  const [currentOrderDetails, setCurrentOrderDetails] = useState(null);
  const [isOrderDetailsLoading, setIsOrderDetailsLoading] = useState(false);
  const [orderActionLoadingId, setOrderActionLoadingId] = useState('');

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setIsRefreshing(true);
    try {
      const token = pb.authStore.token;
      const response = await apiServerClient.fetch('/admin/dashboard', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch dashboard data (${response.status})`);
      }

      const data = await response.json();

      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setProducts(Array.isArray(data.products) ? data.products : []);
      setUsers(Array.isArray(data.users) ? data.users : []);
      setReturns(Array.isArray(data.returns) ? data.returns : []);
      setSellerEarnings(Array.isArray(data.sellerEarnings) ? data.sellerEarnings : []);
      setSettings(data.settings || null);
      setLastRefresh(data.fetchedAt ? new Date(data.fetchedAt) : new Date());
    } catch (error) {
      console.error('Error fetching admin data:', error);
      if (!silent) toast.error(t('admin_dashboard.load_error'));
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    if (!settings) return;

    setSettingsForm({
      shipping_fee: settings.shipping_fee ?? 4.99,
      service_fee: settings.service_fee ?? 1.99,
      transaction_fee_percentage: settings.transaction_fee_percentage ?? settings.transaction_fee_percent ?? 7,
      verification_fee: settings.verification_fee ?? 15,
      shop_enabled: settings.shop_enabled === true,
    });
  }, [settings]);

  const fetchTableProducts = useCallback(async () => {
    setIsProductsLoading(true);
    try {
      const params = new URLSearchParams();
      if (productSearch) params.append('search', productSearch);
      if (productCategoryFilter !== 'all') params.append('category', productCategoryFilter);
      if (productTypeFilter !== 'all') params.append('type', productTypeFilter);
      
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch(`/admin/products?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!res.ok) throw new Error('Failed to fetch products');
      const data = await res.json();
      setTableProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      toast.error(`${t('admin_dashboard.products_load_error')}: ${error.message}`);
    } finally {
      setIsProductsLoading(false);
    }
  }, [productSearch, productCategoryFilter, productTypeFilter, t]);

  const fetchTableUsers = useCallback(async () => {
    setIsUsersLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (userSearch.trim()) params.append('search', userSearch.trim());

      const token = pb.authStore.token;
      const res = await apiServerClient.fetch(`/admin/users?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch users');
      const data = await res.json();
      setTableUsers(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      console.error(error);
      toast.error(`${t('admin_dashboard.users_load_error')}: ${error.message}`);
    } finally {
      setIsUsersLoading(false);
    }
  }, [userSearch, t]);

  const fetchTableSellers = useCallback(async () => {
    setIsSellersLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (sellerSearch.trim()) params.append('search', sellerSearch.trim());

      const token = pb.authStore.token;
      const res = await apiServerClient.fetch(`/admin/sellers?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch sellers');
      const data = await res.json();
      setTableSellers(Array.isArray(data.items) ? data.items : []);
      setSellerSummary(data.summary || {
        totalSellers: 0,
        totalListings: 0,
        activeListings: 0,
        totalOrders: 0,
        availableBalance: 0,
        revenueTotal: 0,
      });
    } catch (error) {
      console.error(error);
      toast.error(t('admin_dashboard.load_error'));
    } finally {
      setIsSellersLoading(false);
    }
  }, [sellerSearch, t]);

  const fetchAnalytics = useCallback(async () => {
    setIsAnalyticsLoading(true);
    try {
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch('/admin/analytics?days=7', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to fetch analytics (${res.status})`);
      }

      setAnalyticsData({
        orderVolume: Array.isArray(data.orderVolume) ? data.orderVolume : [],
        topSellers: Array.isArray(data.topSellers) ? data.topSellers : [],
        summary: data.summary || null,
      });
      setLastRefresh(data.fetchedAt ? new Date(data.fetchedAt) : new Date());
    } catch (error) {
      console.error('Error fetching analytics:', error);
      toast.error(t('admin_dashboard.load_error'));
    } finally {
      setIsAnalyticsLoading(false);
    }
  }, [t]);

  const fetchPayouts = useCallback(async () => {
    setIsPayoutsLoading(true);
    try {
      const token = pb.authStore.token;
      const requestParams = new URLSearchParams({ limit: '100' });
      const conflictParams = new URLSearchParams({ limit: '100' });
      if (payoutStatusFilter !== 'all') requestParams.append('status', payoutStatusFilter);
      if (payoutConflictStatusFilter !== 'all') conflictParams.append('status', payoutConflictStatusFilter);

      const [requestsRes, conflictsRes] = await Promise.all([
        apiServerClient.fetch(`/admin/payout-requests?${requestParams.toString()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        }),
        apiServerClient.fetch(`/admin/payout-conflicts?${conflictParams.toString()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
        }),
      ]);

      const requestsData = await requestsRes.json().catch(() => ({}));
      const conflictsData = await conflictsRes.json().catch(() => ({}));
      if (!requestsRes.ok) throw new Error(requestsData.error || `Failed to fetch payout requests (${requestsRes.status})`);
      if (!conflictsRes.ok) throw new Error(conflictsData.error || `Failed to fetch payout conflicts (${conflictsRes.status})`);

      setPayoutRequests(Array.isArray(requestsData.items) ? requestsData.items : []);
      setPayoutConflicts(Array.isArray(conflictsData.items) ? conflictsData.items : []);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error fetching payouts:', error);
      toast.error(error.message || t('admin_dashboard.payout_load_error'));
    } finally {
      setIsPayoutsLoading(false);
    }
  }, [payoutStatusFilter, payoutConflictStatusFilter, t]);

  useEffect(() => {
    fetchData();

    const subscriptions = [];

    pb.collection('products').subscribe('*', (e) => {
      if (e.action === 'create') {
        setProducts(prev => [e.record, ...prev]);
        setTableProducts(prev => [e.record, ...prev]);
        toast.success(t('admin_dashboard.product_created_toast', { name: e.record.name }));
      } else if (e.action === 'update') {
        setProducts(prev => prev.map(p => p.id === e.record.id ? e.record : p));
        setTableProducts(prev => prev.map(p => p.id === e.record.id ? e.record : p));
      } else if (e.action === 'delete') {
        setProducts(prev => prev.filter(p => p.id !== e.record.id));
        setTableProducts(prev => prev.filter(p => p.id !== e.record.id));
      }
    }).then(unsub => subscriptions.push(unsub)).catch(() => { });

    pb.collection('orders').subscribe('*', (e) => {
      if (e.action === 'create') {
        toast.success(t('admin_dashboard.order_created_toast'));
      }

      fetchData(true);
    }).then(unsub => subscriptions.push(unsub)).catch(() => { });

    pb.collection('users').subscribe('*', (e) => {
      if (e.action === 'create') {
        setUsers(prev => [e.record, ...prev]);
      } else if (e.action === 'update') {
        setUsers(prev => prev.map(u => u.id === e.record.id ? e.record : u));
        setTableUsers(prev => prev.map(u => u.id === e.record.id ? e.record : u));
        setCurrentUserRecord((current) => current?.id === e.record.id ? e.record : current);
      } else if (e.action === 'delete') {
        setUsers(prev => prev.filter(u => u.id !== e.record.id));
        setTableUsers(prev => prev.filter(u => u.id !== e.record.id));
        setCurrentUserRecord((current) => {
          return current?.id === e.record.id ? null : current;
        });
      }
    }).then(unsub => subscriptions.push(unsub)).catch(() => { });

    return () => {
      subscriptions.forEach(unsub => { if (typeof unsub === 'function') unsub(); });
      pb.collection('products').unsubscribe('*').catch(() => { });
      pb.collection('orders').unsubscribe('*').catch(() => { });
      pb.collection('users').unsubscribe('*').catch(() => { });
    };
  }, [fetchData, t]);

  useEffect(() => {
    if (activeTab !== 'products') {
      return undefined;
    }

    const timer = setTimeout(() => {
      fetchTableProducts();
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, fetchTableProducts]);

  useEffect(() => {
    if (activeTab !== 'users') {
      return undefined;
    }

    const timer = setTimeout(() => {
      fetchTableUsers();
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, fetchTableUsers]);

  useEffect(() => {
    if (activeTab !== 'sellers') {
      return undefined;
    }

    const timer = setTimeout(() => {
      fetchTableSellers();
    }, 300);
    return () => clearTimeout(timer);
  }, [activeTab, fetchTableSellers]);

  useEffect(() => {
    if (activeTab !== 'analytics') {
      return undefined;
    }

    fetchAnalytics();
    return undefined;
  }, [activeTab, fetchAnalytics]);

  useEffect(() => {
    if (activeTab !== 'payouts') {
      return undefined;
    }

    fetchPayouts();
    return undefined;
  }, [activeTab, fetchPayouts]);

  const stats = useMemo(() => {
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const sellers = users.filter(u => u.is_seller);
    const activeOrders = orders.filter(o => ORDER_ACTIVE_STATUSES.has(o.status));
    const pendingOrders = orders.filter(o => o.status === 'pending');
    const completedOrders = orders.filter(o => ORDER_COMPLETED_STATUSES.has(o.status));
    return {
      totalOrders: orders.length,
      totalRevenue,
      totalUsers: users.length,
      totalProducts: products.length,
      totalSellers: sellers.length,
      activeOrders: activeOrders.length,
      pendingOrders: pendingOrders.length,
      completedOrders: completedOrders.length
    };
  }, [orders, products, users]);

  const chartData = useMemo(() => {
    const last7Days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().split('T')[0];
    }).reverse();
    return last7Days.map(date => {
      const dayOrders = orders.filter(o => o.created.startsWith(date));
      return {
        name: new Date(date).toLocaleDateString(language === 'EN' ? 'en-US' : 'de-DE', { weekday: 'short' }),
        revenue: dayOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0),
        orders: dayOrders.length
      };
    });
  }, [orders, language]);

  const dateLocale = language === 'EN' ? 'en-US' : 'de-DE';
  const analyticsChartData = useMemo(() => (
    analyticsData.orderVolume.map((item) => ({
      ...item,
      name: item.date
        ? new Date(`${item.date}T00:00:00`).toLocaleDateString(dateLocale, { weekday: 'short' })
        : '-',
      orders: Number(item.orders) || 0,
      revenue: Number(item.revenue) || 0,
    }))
  ), [analyticsData.orderVolume, dateLocale]);
  const analyticsTopSellers = analyticsData.topSellers;

  const formatCurrency = (value) =>
    new Intl.NumberFormat(dateLocale, {
      style: 'currency',
      currency: 'EUR',
    }).format(Number(value) || 0);

  const formatDate = (date) => new Date(date).toLocaleDateString(dateLocale);

  const getProductTypeLabel = (type) => {
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

  const getStatusLabel = (status) => {
    const key = `orders.status_${status}`;
    const translated = t(key);
    if (translated !== key) return translated;

    switch (status) {
      case 'active':
        return t('seller.status_active');
      case 'pending_verification':
        return t('seller.status_pending');
      case 'sold':
        return t('seller.status_sold');
      case 'rejected':
        return t('seller.status_rejected');
      case 'draft':
        return t('admin_dashboard.status_inactive');
      default:
        return status || t('orders.status_pending');
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'active':
      case 'verified':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
      case 'pending_verification':
        return 'border-amber-200 bg-amber-50 text-amber-700';
      case 'rejected':
        return 'border-red-200 bg-red-50 text-red-700';
      case 'draft':
        return 'border-slate-200 bg-slate-100 text-slate-700';
      case 'sold':
        return 'border-blue-200 bg-blue-50 text-blue-700';
      default:
        return 'border-slate-200 bg-slate-50 text-slate-700';
    }
  };

  const getPayoutStatusBadgeClass = (status) => {
    switch (status) {
      case 'approved':
      case 'paid':
      case 'resolved':
        return 'border-emerald-200 bg-emerald-50 text-emerald-700';
      case 'requested':
      case 'reviewing':
      case 'open':
      case 'processing':
        return 'border-amber-200 bg-amber-50 text-amber-700';
      case 'rejected':
      case 'failed':
      case 'cancelled':
      case 'dismissed':
        return 'border-red-200 bg-red-50 text-red-700';
      default:
        return 'border-slate-200 bg-slate-50 text-slate-700';
    }
  };

  const emptyDetailValue = language === 'EN' ? 'Not available' : 'Nicht verfuegbar';

  const formatProductCategories = (fachbereich) => {
    if (Array.isArray(fachbereich)) {
      return fachbereich.filter(Boolean).join(', ') || emptyDetailValue;
    }

    return fachbereich || emptyDetailValue;
  };

  const getProductImageUrl = (product) => {
    return resolveProductImageUrl(product);
  };

  const getProductSellerName = (product) =>
    product?.seller?.seller_username
    || product?.seller?.name
    || product?.seller_username
    || t('product.anonymous_seller');

  const getProductSellerEmail = (product) => product?.seller?.email || product?.seller_email || emptyDetailValue;
  const getProductSellerUniversity = (product) => product?.seller?.university || emptyDetailValue;
  const getProductSellerId = (product) => product?.seller?.id || product?.seller_id || emptyDetailValue;
  const getProductSourceParam = (product) => product?.source || (product?.shop_product ? 'shop' : 'marketplace');

  const formatDetailDate = (date) => (date ? formatDate(date) : emptyDetailValue);
  const formatDateTime = (date) => (date ? new Date(date).toLocaleString(dateLocale) : '-');

  const formatDetailValue = (value) => {
    if (value === undefined || value === null || value === '') return emptyDetailValue;
    if (Array.isArray(value)) return value.filter(Boolean).join(', ') || emptyDetailValue;
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  const getOrderDisplayId = (order) => order?.order_number || order?.id || '-';
  const getOrderTrackingNumber = (order) => resolveOrderTrackingNumber(order);
  const hasOrderLabel = (order) => resolveHasOrderLabel(order);
  const getOrderPartyLabel = (party) => party?.name || party?.seller_username || party?.email || t('admin_dashboard.unknown');
  const getOrderPartyEmail = (party) => party?.email || '-';
  const getOrderBuyer = (order) => order?.buyer || order?.expand?.buyer_id || null;
  const getOrderShippingAddress = (order) => order?.shipping_address_parsed || parseShippingAddress(order?.shipping_address);
  const getOrderCustomerName = (order) => {
    const address = getOrderShippingAddress(order);
    return getOrderPartyLabel(getOrderBuyer(order)) !== t('admin_dashboard.unknown')
      ? getOrderPartyLabel(getOrderBuyer(order))
      : address.name || address.fullName || address.name1 || address.email || t('admin_dashboard.unknown');
  };
  const getOrderCustomerEmail = (order) => {
    const address = getOrderShippingAddress(order);
    return getOrderPartyEmail(getOrderBuyer(order)) !== '-'
      ? getOrderPartyEmail(getOrderBuyer(order))
      : address.email || '-';
  };

  const filteredOrders = orders.filter(o => {
    const searchValue = orderSearch.toLowerCase();
    const customerName = getOrderCustomerName(o).toLowerCase();
    const customerEmail = getOrderCustomerEmail(o).toLowerCase();
    const productName = (o.product?.name || '').toLowerCase();
    const matchesSearch = !searchValue
      || o.id.toLowerCase().includes(searchValue)
      || getOrderDisplayId(o).toLowerCase().includes(searchValue)
      || customerName.includes(searchValue)
      || customerEmail.includes(searchValue)
      || productName.includes(searchValue);
    const matchesStatus = orderStatusFilter === 'all' || o.status === orderStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const getUserRoleLabel = (user) => {
    if (user.is_admin) return 'Admin';
    if (user.is_seller) return t('common.seller');
    return t('admin_dashboard.buyer');
  };

  const getUserRoleBadgeClass = (user) => {
    if (user.is_admin) return 'bg-purple-500 text-white';
    if (user.is_seller) return 'bg-blue-500 text-white';
    return '';
  };

  const getUserStatusLabel = (user) => (user.is_deleted ? t('admin_dashboard.user_status_deleted') : t('seller.status_active'));

  const getUserStatusBadgeClass = (user) =>
    user.is_deleted
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-green-200 bg-green-50 text-green-600';

  const selectedUserRecords = useMemo(() => {
    if (!currentUserRecord?.id) {
      return {
        buyingOrders: [],
        sellingOrders: [],
        listings: [],
        userReturns: [],
        earnings: [],
        purchaseTotal: 0,
        salesTotal: 0,
        earningsTotal: 0,
      };
    }

    const userId = currentUserRecord.id;
    const buyingOrders = orders.filter((order) => order.buyer_id === userId);
    const sellingOrders = orders.filter((order) => order.seller_id === userId);
    const listings = products.filter((product) => product.seller_id === userId);
    const userReturns = returns.filter((ret) => ret.buyer_id === userId || ret.seller_id === userId);
    const sellingOrderIds = new Set(sellingOrders.map((order) => order.id));
    const earnings = sellerEarnings.filter((earning) => (
      earning.seller_id === userId || sellingOrderIds.has(earning.order_id)
    ));

    return {
      buyingOrders,
      sellingOrders,
      listings,
      userReturns,
      earnings,
      purchaseTotal: buyingOrders.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0),
      salesTotal: sellingOrders.reduce((sum, order) => sum + (Number(order.total_amount) || 0), 0),
      earningsTotal: earnings.reduce((sum, earning) => sum + (Number(earning.net_amount ?? earning.gross_amount) || 0), 0),
    };
  }, [currentUserRecord, orders, products, returns, sellerEarnings]);

  const handleOpenOrderDetails = async (orderId) => {
    setOrderDetailsModalOpen(true);
    setIsOrderDetailsLoading(true);
    setCurrentOrderDetails(null);

    try {
      const token = pb.authStore.token;
      const response = await apiServerClient.fetch(`/admin/orders/${orderId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Failed to fetch order details (${response.status})`);
      }

      setCurrentOrderDetails(data);
    } catch (error) {
      console.error('Failed to load order details:', error);
      toast.error(t('admin_dashboard.order_details_error'));
      setOrderDetailsModalOpen(false);
    } finally {
      setIsOrderDetailsLoading(false);
    }
  };

  const handleCopyOrderValue = async (value) => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(String(value));
      toast.success(t('order_details.copied'));
    } catch (error) {
      console.error('Failed to copy value:', error);
      toast.error(language === 'EN' ? 'Copy failed.' : 'Kopieren fehlgeschlagen.');
    }
  };

  const handleDownloadOrderLabel = async (order) => {
    if (!order?.id || !hasOrderLabel(order)) return;

    setOrderActionLoadingId(order.id);

    try {
      const token = pb.authStore.token;
      const response = await apiServerClient.fetch(`/admin/orders/${order.id}/label-pdf`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Download failed (${response.status})`);
      }

      const contentType = response.headers.get('Content-Type') || '';

      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data.label_url) {
          window.open(data.label_url, '_blank', 'noopener,noreferrer');
          return;
        }

        throw new Error(data.error || 'No label URL returned');
      }

      const blob = await response.blob();
      triggerPdfDownload(blob, `DHL_Label_${getOrderDisplayId(order)}.pdf`);
    } catch (error) {
      console.error('Failed to download label:', error);
      toast.error(t('admin_dashboard.order_label_download_error'));
    } finally {
      setOrderActionLoadingId('');
    }
  };

  const handleGenerateOrderLabel = async (order) => {
    if (!order?.id || !canGenerateOrderLabel(order)) return;

    setOrderActionLoadingId(order.id);

    try {
      const response = await apiServerClient.fetch('/dhl-labels/generate-label', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({ order_id: order.id }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failedOrder = buildOrderFromLabelError(order, data, `DHL label generation failed (${response.status})`);
        setOrders((prev) => prev.map((item) => (
          item.id === order.id
            ? { ...item, ...failedOrder, expand: item.expand }
            : item
        )));
        setCurrentOrderDetails((prev) => (prev?.id === order.id ? { ...prev, ...failedOrder } : prev));
        throw new Error(data.details || data.error || `DHL label generation failed (${response.status})`);
      }

      const updatedOrder = buildOrderFromLabelResponse(order, data);

      setOrders((prev) => prev.map((item) => (
        item.id === order.id
          ? { ...item, ...updatedOrder, expand: item.expand }
          : item
      )));
      setCurrentOrderDetails((prev) => (prev?.id === order.id ? { ...prev, ...updatedOrder } : prev));

      toast.success(language === 'EN' ? 'DHL label generated.' : 'DHL-Label wurde erstellt.');
      fetchData(true);
    } catch (error) {
      console.error('Failed to generate DHL label:', error);
      toast.error(error.message || (language === 'EN' ? 'DHL label generation failed.' : 'DHL-Label konnte nicht erstellt werden.'));
      fetchData(true);
    } finally {
      setOrderActionLoadingId('');
    }
  };

  const handleRefreshOrderTracking = async (order) => {
    if (!order?.id || !getOrderTrackingNumber(order)) return;

    setOrderActionLoadingId(order.id);

    try {
      const response = await apiServerClient.fetch(`/dhl-labels/${order.id}/tracking`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pb.authStore.token}`,
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.details || data.error || `DHL tracking refresh failed (${response.status})`);
      }

      const updatedOrder = {
        ...order,
        ...(data.order || {}),
        dhl_tracking_status: data.order?.dhl_tracking_status || data.delivery_confirmation?.status || order.dhl_tracking_status || '',
        dhl_tracking_summary: data.order?.dhl_tracking_summary || data.delivery_confirmation?.summary || order.dhl_tracking_summary || '',
      };

      setOrders((prev) => prev.map((item) => (
        item.id === order.id
          ? { ...item, ...updatedOrder, expand: item.expand }
          : item
      )));
      setCurrentOrderDetails((prev) => (prev?.id === order.id ? { ...prev, ...updatedOrder } : prev));

      toast.success(data.delivery_confirmation?.delivered
        ? t('admin_dashboard.order_tracking_delivered')
        : t('admin_dashboard.order_tracking_refreshed'));
      fetchData(true);
    } catch (error) {
      console.error('Failed to refresh DHL tracking:', error);
      toast.error(error.message || t('admin_dashboard.order_tracking_refresh_error'));
    } finally {
      setOrderActionLoadingId('');
    }
  };

  const handleReleaseEligiblePayouts = async () => {
    setOrderActionLoadingId('release-eligible-payouts');

    try {
      const response = await apiServerClient.fetch('/admin/payouts/release-eligible', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({ limit: 100 }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Payout release failed (${response.status})`);
      }

      toast.success(t('admin_dashboard.payout_release_result', {
        released: data.released || 0,
        blocked: data.blocked || 0,
      }));
      fetchData(true);
    } catch (error) {
      console.error('Failed to release eligible payouts:', error);
      toast.error(error.message || t('admin_dashboard.payout_release_error'));
    } finally {
      setOrderActionLoadingId('');
    }
  };

  const handlePayoutRequestStatus = async (request, status) => {
    if (!request?.id) return;

    const adminNotes = window.prompt(t('admin_dashboard.payout_request_note_prompt'), request.admin_notes || '');
    if (adminNotes === null) return;

    setPayoutActionLoadingId(request.id);
    try {
      const response = await apiServerClient.fetch(`/admin/payout-requests/${request.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({ status, admin_notes: adminNotes }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Payout request update failed (${response.status})`);
      }

      toast.success(t('admin_dashboard.payout_request_updated'));
      fetchPayouts();
      fetchData(true);
    } catch (error) {
      console.error('Failed to update payout request:', error);
      toast.error(error.message || t('admin_dashboard.payout_request_error'));
    } finally {
      setPayoutActionLoadingId('');
    }
  };

  const handlePayPayoutRequest = async (request) => {
    if (!request?.id || !window.confirm(t('admin_dashboard.payout_request_pay_confirm'))) return;

    setPayoutActionLoadingId(request.id);
    try {
      const response = await apiServerClient.fetch(`/admin/payout-requests/${request.id}/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pb.authStore.token}`,
        },
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Payout payment failed (${response.status})`);
      }

      toast.success(t('admin_dashboard.payout_request_paid'));
      fetchPayouts();
      fetchData(true);
    } catch (error) {
      console.error('Failed to pay payout request:', error);
      toast.error(error.message || t('admin_dashboard.payout_request_error'));
      fetchPayouts();
    } finally {
      setPayoutActionLoadingId('');
    }
  };

  const handleCreatePayoutConflict = async () => {
    const orderId = window.prompt(t('admin_dashboard.payout_conflict_order_prompt'));
    if (!orderId) return;

    const reason = window.prompt(t('admin_dashboard.payout_conflict_reason_prompt'));
    if (!reason) return;

    const adminNotes = window.prompt(t('admin_dashboard.payout_conflict_note_prompt'), '') || '';

    setPayoutActionLoadingId('create-conflict');
    try {
      const response = await apiServerClient.fetch('/admin/payout-conflicts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({
          order_id: orderId.trim(),
          reason: reason.trim(),
          admin_notes: adminNotes.trim(),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Payout conflict creation failed (${response.status})`);
      }

      toast.success(t('admin_dashboard.payout_conflict_created'));
      fetchPayouts();
      fetchData(true);
    } catch (error) {
      console.error('Failed to create payout conflict:', error);
      toast.error(error.message || t('admin_dashboard.payout_conflict_error'));
    } finally {
      setPayoutActionLoadingId('');
    }
  };

  const handleResolvePayoutConflict = async (conflict, restore = true) => {
    if (!conflict?.id) return;

    const adminNotes = window.prompt(t('admin_dashboard.payout_conflict_resolve_note_prompt'), conflict.admin_notes || '');
    if (adminNotes === null) return;

    setPayoutActionLoadingId(conflict.id);
    try {
      const response = await apiServerClient.fetch(`/admin/payout-conflicts/${conflict.id}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({ admin_notes: adminNotes, restore }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Payout conflict update failed (${response.status})`);
      }

      toast.success(t('admin_dashboard.payout_conflict_resolved'));
      fetchPayouts();
      fetchData(true);
    } catch (error) {
      console.error('Failed to resolve payout conflict:', error);
      toast.error(error.message || t('admin_dashboard.payout_conflict_error'));
    } finally {
      setPayoutActionLoadingId('');
    }
  };

  const handleAdminOrderStatusUpdate = async (order, newStatus) => {
    if (!order?.id) return;

    setOrderActionLoadingId(order.id);

    try {
      const token = pb.authStore.token;
      const response = await apiServerClient.fetch(`/admin/orders/${order.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Status update failed (${response.status})`);
      }

      const updatedOrder = data.order || { ...order, status: newStatus };

      setOrders((prev) => prev.map((item) => (
        item.id === order.id
          ? { ...item, ...updatedOrder, expand: item.expand }
          : item
      )));
      setCurrentOrderDetails((prev) => (prev?.id === order.id ? updatedOrder : prev));

      toast.success(t('admin_dashboard.order_status_updated', { status: getStatusLabel(newStatus) }));
      fetchData(true);
    } catch (error) {
      console.error('Failed to update order status:', error);
      toast.error(t('admin_dashboard.order_status_update_error'));
    } finally {
      setOrderActionLoadingId('');
    }
  };

  const handleAdminOrderAction = async (order, action) => {
    if (!order?.id) return;

    const payload = {};

    if (action === 'validate') {
      const note = window.prompt(t('admin_dashboard.order_action_note_prompt'), '');
      if (note === null) return;
      payload.note = note;
    }

    if (action === 'pause') {
      const reason = window.prompt(t('admin_dashboard.order_action_pause_prompt'), order.admin_pause_reason || '');
      if (reason === null) return;
      payload.reason = reason;
    }

    if (action === 'cancel') {
      const reason = window.prompt(t('admin_dashboard.order_action_cancel_prompt'), order.admin_cancel_reason || '');
      if (reason === null) return;
      payload.reason = reason;
    }

    if (action === 'refund') {
      const amountInput = window.prompt(t('admin_dashboard.order_action_refund_amount_prompt'), String(Number(order.total_amount || 0).toFixed(2)));
      if (amountInput === null) return;

      const amount = Number(String(amountInput).replace(',', '.'));
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error(t('admin_dashboard.order_action_refund_amount_error'));
        return;
      }

      const reason = window.prompt(t('admin_dashboard.order_action_refund_reason_prompt'), order.admin_notes || '');
      if (reason === null) return;
      payload.amount = amount;
      payload.reason = reason;
    }

    setOrderActionLoadingId(order.id);

    try {
      const token = pb.authStore.token;
      const response = await apiServerClient.fetch(`/admin/orders/${order.id}/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Order action failed (${response.status})`);
      }

      const updatedOrder = data.order || order;
      setOrders((prev) => prev.map((item) => (
        item.id === order.id
          ? { ...item, ...updatedOrder, expand: item.expand }
          : item
      )));
      setCurrentOrderDetails((prev) => (prev?.id === order.id ? updatedOrder : prev));

      toast.success(t(`admin_dashboard.order_action_${action}_success`));
      fetchData(true);
    } catch (error) {
      console.error(`Failed to run order ${action}:`, error);
      toast.error(error.message || t('admin_dashboard.order_action_error'));
    } finally {
      setOrderActionLoadingId('');
    }
  };

  const openUserDetails = (user) => {
    setCurrentUserRecord(user);
    setActiveTab('users');
  };

  const handleApproveReturn = async (returnRecord) => {
    const defaultRefund = Number(returnRecord.refund_amount || returnRecord.expand?.order_id?.total_amount || 0).toFixed(2);
    const notePrompt = language === 'EN'
      ? 'Optional admin note for this approval:'
      : 'Optionaler Admin-Hinweis für diese Freigabe:';
    const refundPrompt = language === 'EN'
      ? 'Refund amount in EUR:'
      : 'Erstattungsbetrag in EUR:';

    const adminNotes = window.prompt(notePrompt, returnRecord.admin_notes || '') ?? '';
    const refundInput = window.prompt(refundPrompt, defaultRefund);
    if (refundInput === null) {
      return;
    }

    const refundAmount = Number(String(refundInput).replace(',', '.'));
    if (!Number.isFinite(refundAmount) || refundAmount < 0) {
      toast.error(language === 'EN' ? 'Please enter a valid refund amount.' : 'Bitte gib einen gültigen Erstattungsbetrag ein.');
      return;
    }

    try {
      const response = await apiServerClient.fetch(`/returns/${returnRecord.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({
          adminNotes,
          refundAmount,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.details || data.error || `Approval failed with status ${response.status}`);
      }

      toast.success(language === 'EN' ? 'Return request approved.' : 'Retourenanfrage freigegeben.');
      fetchData(true);
    } catch (error) {
      console.error('Approve return failed:', error);
      toast.error(error.message || (language === 'EN' ? 'Return approval failed.' : 'Freigabe der Retoure fehlgeschlagen.'));
    }
  };

  const handleRejectReturn = async (returnRecord) => {
    const notePrompt = language === 'EN'
      ? 'Reason for rejection:'
      : 'Begründung für die Ablehnung:';
    const adminNotes = window.prompt(notePrompt, returnRecord.admin_notes || '');

    if (adminNotes === null) {
      return;
    }

    try {
      const response = await apiServerClient.fetch(`/returns/${returnRecord.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({
          adminNotes,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Rejection failed with status ${response.status}`);
      }

      toast.success(language === 'EN' ? 'Return request rejected.' : 'Retourenanfrage abgelehnt.');
      fetchData(true);
    } catch (error) {
      console.error('Reject return failed:', error);
      toast.error(error.message || (language === 'EN' ? 'Return rejection failed.' : 'Ablehnung der Retoure fehlgeschlagen.'));
    }
  };

  const handleDeleteUser = async (user) => {
    const isCurrentUser = user.id === pb.authStore.model?.id;
    const confirmKey = isCurrentUser
      ? 'admin_dashboard.user_delete_self_confirm'
      : user.is_admin
        ? 'admin_dashboard.user_delete_admin_confirm'
        : 'admin_dashboard.user_delete_confirm';

    if (!window.confirm(t(confirmKey, { name: user.name || user.email }))) {
      return;
    }

    try {
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch(`/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Delete failed');

      toast.success(t('admin_dashboard.user_deleted'));
      setTableUsers((current) => current.filter((currentUser) => currentUser.id !== user.id));
      setTableSellers((current) => current.filter((currentSeller) => currentSeller.id !== user.id));
      setUsers((current) => current.filter((currentUser) => currentUser.id !== user.id));
      if (currentUserRecord?.id === user.id) {
        setCurrentUserRecord(null);
      }
      fetchData(true);
      fetchTableSellers();

      if (isCurrentUser) {
        pb.authStore.clear();
        window.location.assign('/auth');
      }
    } catch (error) {
      toast.error(t('admin_dashboard.user_delete_error'));
    }
  };

  const handleRemoveSellerRole = async (user) => {
    try {
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch(`/admin/users/${user.id}/remove-seller`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Remove seller failed');

      toast.success(t('admin_dashboard.user_remove_seller_success'));
      setTableUsers((current) =>
        current.map((currentUser) => (
          currentUser.id === user.id
            ? { ...currentUser, is_seller: false }
            : currentUser
        ))
      );
      setUsers((current) =>
        current.map((currentUser) => (
          currentUser.id === user.id
            ? { ...currentUser, is_seller: false }
            : currentUser
        ))
      );
      setTableSellers((current) => current.filter((currentSeller) => currentSeller.id !== user.id));
      if (currentUserRecord?.id === user.id) {
        setCurrentUserRecord((current) => current ? { ...current, is_seller: false } : current);
      }
      fetchTableSellers();
    } catch (error) {
      toast.error(t('admin_dashboard.user_remove_seller_error'));
    }
  };

  const handleDeleteProduct = async (id) => {
    if (!window.confirm(t('admin_dashboard.delete_confirm'))) return;
    try {
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch(`/admin/products/${id}`, { 
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(t('seller.delete_success'));
      fetchTableProducts();
      fetchData(true);
    } catch (error) {
      toast.error(t('seller.delete_error'));
    }
  };

  const handleEditProduct = async (id) => {
    try {
      const token = pb.authStore.token;
      const existingProduct = tableProducts.find((product) => product.id === id);
      const sourceParam = getProductSourceParam(existingProduct);
      const res = await apiServerClient.fetch(`/admin/products/${id}?source=${encodeURIComponent(sourceParam)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      setCurrentProduct({ ...existingProduct, ...data });
      setEditModalOpen(true);
    } catch (error) {
      toast.error(t('admin_dashboard.product_details_error'));
    }
  };

  const handleViewDetails = async (id) => {
    try {
      const token = pb.authStore.token;
      const existingProduct = tableProducts.find((product) => product.id === id);
      const sourceParam = getProductSourceParam(existingProduct);
      const res = await apiServerClient.fetch(`/admin/products/${id}?source=${encodeURIComponent(sourceParam)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      setCurrentProduct({ ...existingProduct, ...data });
      setViewModalOpen(true);
    } catch (error) {
      toast.error(t('admin_dashboard.product_details_error'));
    }
  };

  const handleUpdateStock = async (id, currentStock) => {
    const qtyStr = window.prompt(t('admin_dashboard.stock_prompt'), currentStock || 0);
    if (qtyStr === null) return;
    const quantity = parseInt(qtyStr, 10);
    if (isNaN(quantity)) { toast.error(t('admin_dashboard.invalid_quantity')); return; }
    try {
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch(`/admin/products/${id}/stock`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ quantity })
      });
      if (!res.ok) throw new Error('Stock update failed');
      toast.success(t('admin_dashboard.stock_updated'));
      fetchTableProducts();
    } catch (error) {
      toast.error(t('admin_dashboard.stock_update_error'));
    }
  };

  const handleToggleStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'draft' : 'active';
    try {
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch(`/admin/products/${id}/status`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error('Status update failed');
      toast.success(t('admin_dashboard.status_changed', { status: getStatusLabel(newStatus) }));
      fetchTableProducts();
    } catch (error) {
      toast.error(t('admin_dashboard.status_update_error'));
    }
  };

  const handleApproveProductValidation = async (product) => {
    const notes = window.prompt(t('admin_verifications.approve_notes_prompt'), '');
    if (notes === null) return;

    try {
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch('/admin/approve-product', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ productId: product.id, notes }),
      });

      if (!res.ok) throw new Error('Approval failed');
      toast.success(t('admin_verifications.approve_success'));
      fetchTableProducts();
      fetchData(true);
    } catch (error) {
      toast.error(t('admin_verifications.approve_error'));
    }
  };

  const handleRejectProductValidation = async (product) => {
    const reason = window.prompt(t('admin_verifications.reject_prompt'));
    if (reason === null) return;

    try {
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch('/admin/reject-product', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          productId: product.id,
          reason: reason || t('admin_verifications.default_reject_reason'),
        }),
      });

      if (!res.ok) throw new Error('Rejection failed');
      toast.success(t('admin_verifications.reject_success'));
      fetchTableProducts();
      fetchData(true);
    } catch (error) {
      toast.error(t('admin_verifications.reject_error'));
    }
  };

  const handleBulkSelect = (id) => {
    setSelectedProducts(prev =>
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const handleSelectAllProducts = () => {
    if (selectedProducts.length === tableProducts.length && tableProducts.length > 0) {
      setSelectedProducts([]);
    } else {
      setSelectedProducts(tableProducts.map(p => p.id));
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(t('admin_dashboard.bulk_delete_confirm', { count: selectedProducts.length }))) return;
    try {
      const token = pb.authStore.token;
      await Promise.all(selectedProducts.map(id =>
        apiServerClient.fetch(`/admin/products/${id}`, { 
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        })
      ));
      toast.success(t('admin_dashboard.bulk_delete_success', { count: selectedProducts.length }));
      setSelectedProducts([]);
      fetchTableProducts();
      fetchData(true);
    } catch (error) {
      toast.error(t('admin_dashboard.bulk_delete_error'));
    }
  };

  const handleSettingsChange = (field, value) => {
    setSettingsForm(prev => ({
      ...prev,
      [field]: typeof value === 'boolean' ? value : value === '' ? '' : Number(value),
    }));
  };

  const handleSaveSettings = async () => {
    try {
      const token = pb.authStore.token;
      const res = await apiServerClient.fetch('/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(settingsForm),
      });

      if (!res.ok) throw new Error('Settings update failed');

      const data = await res.json();
      setSettings(data);
      refreshShopVisibility();
      toast.success(t('admin_dashboard.settings_saved'));
    } catch (error) {
      toast.error(t('admin_dashboard.settings_save_error'));
    }
  };

  const handleRefresh = () => {
    fetchData();

    if (activeTab === 'products') {
      fetchTableProducts();
    }

    if (activeTab === 'users') {
      fetchTableUsers();
    }

    if (activeTab === 'sellers') {
      fetchTableSellers();
    }

    if (activeTab === 'payouts') {
      fetchPayouts();
    }

    if (activeTab === 'analytics') {
      fetchAnalytics();
    }
  };

  const currentOrderTrackingNumber = getOrderTrackingNumber(currentOrderDetails);
  const currentOrderShippingLines = getShippingAddressLines(
    currentOrderDetails?.shipping_address_parsed || currentOrderDetails?.shipping_address,
  );

  if (loading && !orders.length) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[hsl(var(--muted-bg))] min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">{t('admin_dashboard.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{t('admin_dashboard.meta_title')} - Zahnibörse</title>
      </Helmet>

      <main className="flex-1 bg-[hsl(var(--muted-bg))] py-8">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">

          <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('admin_dashboard.title')}</h1>
              <p className="text-muted-foreground mt-1 flex items-center gap-2">
                {t('admin_dashboard.subtitle')}
                <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">
                  <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                  {t('admin_dashboard.live_update', { time: lastRefresh.toLocaleTimeString() })}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                {t('admin_dashboard.refresh')}
              </Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-6">
            <div className="overflow-x-auto pb-2">
              <TabsList className="bg-background border shadow-sm inline-flex w-max min-w-full sm:min-w-0">
                <TabsTrigger value="overview" className="gap-2"><BarChart3 className="w-4 h-4" /> {t('admin_dashboard.overview')}</TabsTrigger>
                <TabsTrigger value="orders" className="gap-2"><ShoppingCart className="w-4 h-4" /> {t('admin_dashboard.orders')}</TabsTrigger>
                <TabsTrigger value="products" className="gap-2"><Package className="w-4 h-4" /> {t('admin_dashboard.products')}</TabsTrigger>
                <TabsTrigger value="users" className="gap-2"><Users className="w-4 h-4" /> {t('admin_dashboard.users')}</TabsTrigger>
                <TabsTrigger value="sellers" className="gap-2"><Store className="w-4 h-4" /> {t('admin_dashboard.sellers')}</TabsTrigger>
                <TabsTrigger value="returns" className="gap-2"><RotateCcw className="w-4 h-4" /> {t('admin_dashboard.returns')}</TabsTrigger>
                <TabsTrigger value="payouts" className="gap-2"><DollarSign className="w-4 h-4" /> {t('admin_dashboard.payouts')}</TabsTrigger>
                <TabsTrigger value="analytics" className="gap-2"><BarChart3 className="w-4 h-4" /> {t('admin_dashboard.analytics')}</TabsTrigger>
                <TabsTrigger value="settings" className="gap-2"><Settings className="w-4 h-4" /> {t('admin_dashboard.settings')}</TabsTrigger>
              </TabsList>
            </div>

            {/* OVERVIEW */}
            <TabsContent value="overview" className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-primary text-primary-foreground border-none shadow-lg">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-primary-foreground/80">{t('admin_dashboard.total_revenue')}</CardTitle>
                    <DollarSign className="w-4 h-4 text-primary-foreground/80" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{formatCurrency(stats.totalRevenue)}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{t('admin_dashboard.orders')}</CardTitle>
                    <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{stats.totalOrders}</div>
                    <div className="flex gap-2 mt-2 text-xs">
                      <span className="text-blue-600">{t('admin_dashboard.active_count', { count: stats.activeOrders })}</span>
                      <span className="text-yellow-600">{t('admin_dashboard.pending_count', { count: stats.pendingOrders })}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{t('admin_dashboard.users')}</CardTitle>
                    <Users className="w-4 h-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{stats.totalUsers}</div>
                    <p className="text-xs text-muted-foreground mt-1">{t('admin_dashboard.sellers_count', { count: stats.totalSellers })}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">{t('admin_dashboard.products')}</CardTitle>
                    <Package className="w-4 h-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{stats.totalProducts}</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader><CardTitle>{t('admin_dashboard.revenue_7_days')}</CardTitle></CardHeader>
                  <CardContent className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} tickFormatter={(val) => formatCurrency(val)} />
                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Line type="monotone" dataKey="revenue" stroke="#0000FF" strokeWidth={3} dot={{ r: 4, fill: '#0000FF' }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>{t('admin_dashboard.latest_orders')}</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {orders.slice(0, 5).map(order => (
                        <div key={order.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                              <ShoppingCart className="w-5 h-5" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{order.order_number || order.id.substring(0, 8)}</p>
                              <p className="text-xs text-muted-foreground">{getOrderCustomerName(order) || t('admin_dashboard.customer')}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-sm">{formatCurrency(order.total_amount)}</p>
                            <Badge variant="outline" className="text-[10px] mt-1">{getStatusLabel(order.status || 'pending')}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ORDERS */}
            <TabsContent value="orders" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <CardTitle>{t('admin_dashboard.order_management')}</CardTitle>
                    <div className="flex items-center gap-2 w-full flex-wrap sm:w-auto">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleReleaseEligiblePayouts}
                        disabled={orderActionLoadingId === 'release-eligible-payouts'}
                      >
                        <DollarSign className="mr-2 h-4 w-4" />
                        {t('admin_dashboard.release_eligible_payouts')}
                      </Button>
                      <div className="relative flex-1 sm:w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder={t('admin_dashboard.search_placeholder')} className="pl-9" value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} />
                      </div>
                      <Select value={orderStatusFilter} onValueChange={setOrderStatusFilter}>
                        <SelectTrigger className="w-[140px]"><SelectValue placeholder={t('seller.status')} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('seller.filter_all')}</SelectItem>
                          <SelectItem value="pending">{t('orders.status_pending')}</SelectItem>
                          <SelectItem value="paid">{t('orders.status_paid')}</SelectItem>
                          <SelectItem value="waiting_admin_validation">{t('orders.status_waiting_admin_validation')}</SelectItem>
                          <SelectItem value="validated">{t('orders.status_validated')}</SelectItem>
                          <SelectItem value="processing">{t('orders.status_processing')}</SelectItem>
                          <SelectItem value="shipped">{t('orders.status_shipped')}</SelectItem>
                          <SelectItem value="dhl_delivered">{t('orders.status_dhl_delivered')}</SelectItem>
                          <SelectItem value="waiting_payout_release">{t('orders.status_waiting_payout_release')}</SelectItem>
                          <SelectItem value="payout_available">{t('orders.status_payout_available')}</SelectItem>
                          <SelectItem value="paid_out">{t('orders.status_paid_out')}</SelectItem>
                          <SelectItem value="cancelled">{t('orders.status_cancelled')}</SelectItem>
                          <SelectItem value="refunded">{t('orders.status_refunded')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"><Checkbox /></TableHead>
                          <TableHead>{t('admin_dashboard.order_id')}</TableHead>
                          <TableHead>{t('admin_dashboard.customer')}</TableHead>
                          <TableHead>{t('orders.date')}</TableHead>
                          <TableHead>{t('seller.status')}</TableHead>
                          <TableHead className="text-right">{t('verification_success.amount')}</TableHead>
                          <TableHead className="w-[100px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredOrders.map(order => (
                          <TableRow key={order.id}>
                            <TableCell><Checkbox /></TableCell>
                            <TableCell className="font-medium">{getOrderDisplayId(order)}</TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span>{getOrderCustomerName(order)}</span>
                                <span className="text-xs text-muted-foreground">{getOrderCustomerEmail(order)}</span>
                              </div>
                            </TableCell>
                            <TableCell>{formatDate(order.created)}</TableCell>
                            <TableCell>
                              <Badge variant={ORDER_DELIVERED_DISPLAY_STATUSES.has(order.status) ? 'default' : 'outline'}>{getStatusLabel(order.status || 'pending')}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(order.total_amount)}</TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-[8px]"
                                    disabled={orderActionLoadingId === order.id}
                                  >
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56 rounded-[8px] border border-[hsl(var(--border))] bg-white p-1">
                                  <DropdownMenuItem onClick={() => handleOpenOrderDetails(order.id)} className="rounded-md">
                                    <Eye className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_view')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleCopyOrderValue(getOrderDisplayId(order))} className="rounded-md">
                                    <Copy className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_copy_id')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleGenerateOrderLabel(order)}
                                    className="rounded-md"
                                    disabled={!ORDER_LABEL_ELIGIBLE_STATUSES.has(order.status) || (getOrderTrackingNumber(order) && hasOrderLabel(order))}
                                  >
                                    <RefreshCw className="w-4 h-4" />
                                    {hasOrderLabel(order) || getOrderTrackingNumber(order)
                                      ? (language === 'EN' ? 'Regenerate DHL label' : 'DHL-Label neu erstellen')
                                      : (language === 'EN' ? 'Generate DHL label' : 'DHL-Label erstellen')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleCopyOrderValue(getOrderTrackingNumber(order))}
                                    className="rounded-md"
                                    disabled={!getOrderTrackingNumber(order)}
                                  >
                                    <Copy className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_copy_tracking')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleRefreshOrderTracking(order)}
                                    className="rounded-md"
                                    disabled={!getOrderTrackingNumber(order)}
                                  >
                                    <RefreshCw className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_refresh_tracking')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleDownloadOrderLabel(order)}
                                    className="rounded-md"
                                    disabled={!hasOrderLabel(order)}
                                  >
                                    <Download className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_download_label')}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator className="bg-slate-100" />
                                  <DropdownMenuItem
                                    onClick={() => handleAdminOrderAction(order, 'validate')}
                                    className="rounded-md"
                                    disabled={!ORDER_VALIDATABLE_STATUSES.has(order.status)}
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_validate')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleAdminOrderAction(order, 'pause')}
                                    className="rounded-md"
                                    disabled={!ORDER_PAUSABLE_STATUSES.has(order.status)}
                                  >
                                    <AlertCircle className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_pause')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleAdminOrderStatusUpdate(order, 'shipped')}
                                    className="rounded-md"
                                    disabled={!ORDER_SHIPPABLE_STATUSES.has(order.status)}
                                  >
                                    <Package className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_mark_shipped')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleAdminOrderStatusUpdate(order, 'dhl_delivered')}
                                    className="rounded-md"
                                    disabled={!ORDER_DHL_DELIVERABLE_STATUSES.has(order.status)}
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_mark_delivered')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleAdminOrderAction(order, 'cancel')}
                                    className="rounded-md text-red-600 focus:bg-red-50 focus:text-red-700"
                                    disabled={!ORDER_CANCELLABLE_STATUSES.has(order.status)}
                                  >
                                    <XCircle className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_cancel')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleAdminOrderAction(order, 'refund')}
                                    className="rounded-md text-red-600 focus:bg-red-50 focus:text-red-700"
                                    disabled={!ORDER_REFUNDABLE_STATUSES.has(order.status)}
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                    {t('admin_dashboard.order_action_refund')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                        {filteredOrders.length === 0 && (
                          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('admin_dashboard.no_orders_found')}</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* PRODUCTS */}
            <TabsContent value="products" className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <CardTitle>{t('admin_dashboard.product_management')}</CardTitle>
                    <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                      {selectedProducts.length > 0 && (
                        <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                          {t('admin_dashboard.delete_selected', { count: selectedProducts.length })}
                        </Button>
                      )}
                      <Select value={productTypeFilter} onValueChange={setProductTypeFilter}>
                        <SelectTrigger className="w-[140px]"><SelectValue placeholder={t('seller.type')} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('admin_dashboard.all_types')}</SelectItem>
                          <SelectItem value="Article">{t('marketplace.type_article')}</SelectItem>
                          <SelectItem value="Set">{t('marketplace.type_set')}</SelectItem>
                          <SelectItem value="Consumable">{t('marketplace.type_consumable')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={productCategoryFilter} onValueChange={setProductCategoryFilter}>
                        <SelectTrigger className="w-[140px]"><SelectValue placeholder={t('seller.category')} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('admin_dashboard.all_categories')}</SelectItem>
                          <SelectItem value="Paro">Paro</SelectItem>
                          <SelectItem value="Kons">Kons</SelectItem>
                          <SelectItem value="Pro">Pro</SelectItem>
                          <SelectItem value="KFO">KFO</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="relative w-full sm:w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder={t('seller.search_placeholder')} className="pl-9" value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">
                            <Checkbox checked={selectedProducts.length === tableProducts.length && tableProducts.length > 0} onCheckedChange={handleSelectAllProducts} />
                          </TableHead>
                          <TableHead>{t('shipping.name')}</TableHead>
                          <TableHead>{t('seller.price')}</TableHead>
                          <TableHead>{t('seller.type')}</TableHead>
                          <TableHead>{t('seller.category')}</TableHead>
                          <TableHead>{t('seller.status')}</TableHead>
                          <TableHead className="w-[180px] text-right">{t('seller.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isProductsLoading ? (
                          Array.from({ length: 5 }).map((_, i) => (
                            <TableRow key={i}>
                              <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                              <TableCell><Skeleton className="h-8 w-[140px] ml-auto" /></TableCell>
                            </TableRow>
                          ))
                        ) : tableProducts.length === 0 ? (
                          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('marketplace.empty_title')}</TableCell></TableRow>
                        ) : (
                          tableProducts.map(product => (
                            <TableRow key={product.id}>
                              <TableCell>
                                <Checkbox checked={selectedProducts.includes(product.id)} onCheckedChange={() => handleBulkSelect(product.id)} />
                              </TableCell>
                              <TableCell className="font-medium max-w-[200px] truncate">{product.name}</TableCell>
                              <TableCell>{formatCurrency(product.price)}</TableCell>
                              <TableCell><Badge variant="secondary">{getProductTypeLabel(product.product_type || 'Article')}</Badge></TableCell>
                              <TableCell>{product.fachbereich || '-'}</TableCell>
                              <TableCell>
                                {product.status === 'pending_verification' || product.verification_status === 'pending' || product.status === 'rejected' ? (
                                  <Badge variant="outline" className={getStatusBadgeClass(product.status)}>
                                    {getStatusLabel(product.status)}
                                  </Badge>
                                ) : (
                                  <div className="flex items-center gap-2">
                                    <Switch checked={product.status === 'active'} onCheckedChange={() => handleToggleStatus(product.id, product.status)} />
                                    <span className="text-xs text-muted-foreground">{product.status === 'active' ? t('seller.status_active') : t('admin_dashboard.status_inactive')}</span>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  {product.source === 'marketplace' && (product.status === 'pending_verification' || product.verification_status === 'pending') && (
                                    <>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" onClick={() => handleApproveProductValidation(product)}><CheckCircle className="w-4 h-4" /></Button>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600" onClick={() => handleRejectProductValidation(product)}><XCircle className="w-4 h-4" /></Button>
                                    </>
                                  )}
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleViewDetails(product.id)}><Eye className="w-4 h-4" /></Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleUpdateStock(product.id, product.stock_quantity)}><Package className="w-4 h-4" /></Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditProduct(product.id)}><Edit className="w-4 h-4" /></Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteProduct(product.id)}><Trash2 className="w-4 h-4" /></Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* USERS */}
            <TabsContent value="users" className="space-y-4">
              {currentUserRecord ? (
                <div className="space-y-5">
                  <div className="flex flex-col gap-4 rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <Button variant="outline" className="mb-4 rounded-[8px]" onClick={() => setCurrentUserRecord(null)}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        {t('admin_dashboard.back_to_users')}
                      </Button>
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-2xl font-semibold leading-tight text-slate-900">
                          {currentUserRecord.name || t('admin_dashboard.no_name')}
                        </h2>
                        <Badge className={getUserRoleBadgeClass(currentUserRecord)} variant={currentUserRecord.is_admin || currentUserRecord.is_seller ? 'default' : 'secondary'}>
                          {getUserRoleLabel(currentUserRecord)}
                        </Badge>
                        <Badge variant="outline" className={getUserStatusBadgeClass(currentUserRecord)}>
                          {getUserStatusLabel(currentUserRecord)}
                        </Badge>
                      </div>
                      <p className="mt-2 break-all text-sm text-slate-600">{currentUserRecord.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {currentUserRecord.is_seller && !currentUserRecord.is_deleted && (
                        <Button variant="outline" className="rounded-[8px]" onClick={() => handleRemoveSellerRole(currentUserRecord)}>
                          <Store className="mr-2 h-4 w-4" />
                          {t('admin_dashboard.user_action_remove_seller')}
                        </Button>
                      )}
                      <Button variant="destructive" className="rounded-[8px]" onClick={() => handleDeleteUser(currentUserRecord)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('admin_dashboard.user_action_delete')}
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                    <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.account_details')}</h3>
                      <div className="mt-5 space-y-4 text-sm">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.account_id')}</p>
                          <p className="mt-1 break-all font-medium text-slate-900">{currentUserRecord.id}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('profile.user_id')}</p>
                          <p className="mt-1 break-all font-medium text-slate-900">{currentUserRecord.user_id || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.registered_at')}</p>
                          <p className="mt-1 font-medium text-slate-900">{formatDate(currentUserRecord.created)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.university')}</p>
                          <p className="mt-1 font-medium text-slate-900">{currentUserRecord.university || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.seller_username')}</p>
                          <p className="mt-1 font-medium text-slate-900">{currentUserRecord.seller_username || '-'}</p>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                      <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.user_activity_summary')}</h3>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.purchase_total')}</p>
                          <p className="mt-2 text-xl font-semibold text-slate-900">{formatCurrency(selectedUserRecords.purchaseTotal)}</p>
                          <p className="mt-1 text-xs text-slate-500">{t('admin_dashboard.orders_count', { count: selectedUserRecords.buyingOrders.length })}</p>
                        </div>
                        <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.sales_total')}</p>
                          <p className="mt-2 text-xl font-semibold text-slate-900">{formatCurrency(selectedUserRecords.salesTotal)}</p>
                          <p className="mt-1 text-xs text-slate-500">{t('admin_dashboard.orders_count', { count: selectedUserRecords.sellingOrders.length })}</p>
                        </div>
                        <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.listings')}</p>
                          <p className="mt-2 text-xl font-semibold text-slate-900">{selectedUserRecords.listings.length}</p>
                          <p className="mt-1 text-xs text-slate-500">{t('admin_dashboard.active_listings_count', { count: selectedUserRecords.listings.filter((product) => product.status === 'active').length })}</p>
                        </div>
                        <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('seller_dashboard.earnings')}</p>
                          <p className="mt-2 text-xl font-semibold text-slate-900">{formatCurrency(selectedUserRecords.earningsTotal)}</p>
                          <p className="mt-1 text-xs text-slate-500">{t('admin_dashboard.records_count', { count: selectedUserRecords.earnings.length })}</p>
                        </div>
                      </div>
                    </section>
                  </div>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.buying_records')}</h3>
                        <p className="text-sm text-slate-500">{t('admin_dashboard.buying_records_description')}</p>
                      </div>
                      <Badge variant="secondary">{selectedUserRecords.buyingOrders.length}</Badge>
                    </div>
                    <div className="overflow-hidden rounded-[8px] border border-slate-200">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('admin_dashboard.order_id')}</TableHead>
                            <TableHead>{t('admin_dashboard.products')}</TableHead>
                            <TableHead>{t('admin_dashboard.registered_at')}</TableHead>
                            <TableHead>{t('seller.status')}</TableHead>
                            <TableHead className="text-right">{t('orders.total')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedUserRecords.buyingOrders.map((order) => (
                            <TableRow key={order.id}>
                              <TableCell className="font-medium">{order.order_number || order.id.substring(0, 8)}</TableCell>
                              <TableCell>{order.expand?.product_id?.name || order.product_id || '-'}</TableCell>
                              <TableCell>{formatDate(order.created)}</TableCell>
                              <TableCell><Badge variant="outline">{getStatusLabel(order.status || 'pending')}</Badge></TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(order.total_amount)}</TableCell>
                            </TableRow>
                          ))}
                          {selectedUserRecords.buyingOrders.length === 0 && (
                            <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">{t('admin_dashboard.no_buying_records')}</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.selling_records')}</h3>
                        <p className="text-sm text-slate-500">{t('admin_dashboard.selling_records_description')}</p>
                      </div>
                      <Badge variant="secondary">{selectedUserRecords.sellingOrders.length}</Badge>
                    </div>
                    <div className="overflow-hidden rounded-[8px] border border-slate-200">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('admin_dashboard.order_id')}</TableHead>
                            <TableHead>{t('admin_dashboard.products')}</TableHead>
                            <TableHead>{t('admin_dashboard.customer')}</TableHead>
                            <TableHead>{t('seller.status')}</TableHead>
                            <TableHead className="text-right">{t('orders.total')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedUserRecords.sellingOrders.map((order) => (
                            <TableRow key={order.id}>
                              <TableCell className="font-medium">{order.order_number || order.id.substring(0, 8)}</TableCell>
                              <TableCell>{order.expand?.product_id?.name || order.product_id || '-'}</TableCell>
                              <TableCell>{order.expand?.buyer_id?.email || order.buyer_id || '-'}</TableCell>
                              <TableCell><Badge variant="outline">{getStatusLabel(order.status || 'pending')}</Badge></TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(order.total_amount)}</TableCell>
                            </TableRow>
                          ))}
                          {selectedUserRecords.sellingOrders.length === 0 && (
                            <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">{t('admin_dashboard.no_selling_records')}</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </section>

                  <div className="grid gap-5 xl:grid-cols-2">
                    <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.listings')}</h3>
                        <Badge variant="secondary">{selectedUserRecords.listings.length}</Badge>
                      </div>
                      <div className="overflow-hidden rounded-[8px] border border-slate-200">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('admin_dashboard.products')}</TableHead>
                              <TableHead>{t('seller.type')}</TableHead>
                              <TableHead>{t('seller.status')}</TableHead>
                              <TableHead className="text-right">{t('seller.price')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedUserRecords.listings.slice(0, 8).map((product) => (
                              <TableRow key={product.id}>
                                <TableCell className="font-medium">{product.name || t('admin_dashboard.unnamed')}</TableCell>
                                <TableCell>{getProductTypeLabel(product.product_type || 'Article')}</TableCell>
                                <TableCell><Badge variant="outline" className={getStatusBadgeClass(product.status)}>{getStatusLabel(product.status)}</Badge></TableCell>
                                <TableCell className="text-right font-medium">{formatCurrency(product.price)}</TableCell>
                              </TableRow>
                            ))}
                            {selectedUserRecords.listings.length === 0 && (
                              <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">{t('admin_dashboard.no_listings')}</TableCell></TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </section>

                    <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.returns')}</h3>
                        <Badge variant="secondary">{selectedUserRecords.userReturns.length}</Badge>
                      </div>
                      <div className="overflow-hidden rounded-[8px] border border-slate-200">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('admin_dashboard.return_id')}</TableHead>
                              <TableHead>{t('admin_dashboard.reason')}</TableHead>
                              <TableHead>{t('seller.status')}</TableHead>
                              <TableHead className="text-right">{t('orders.total')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedUserRecords.userReturns.slice(0, 8).map((ret) => (
                              <TableRow key={ret.id}>
                                <TableCell className="font-medium">{ret.id.substring(0, 8)}</TableCell>
                                <TableCell className="max-w-[220px] truncate">{ret.reason || '-'}</TableCell>
                                <TableCell><Badge variant="outline">{ret.status || '-'}</Badge></TableCell>
                                <TableCell className="text-right font-medium">{formatCurrency(ret.refund_amount)}</TableCell>
                              </TableRow>
                            ))}
                            {selectedUserRecords.userReturns.length === 0 && (
                              <TableRow><TableCell colSpan={4} className="py-10 text-center text-muted-foreground">{t('admin_dashboard.no_user_returns')}</TableCell></TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </section>
                  </div>

                  <section className="rounded-[8px] border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <h3 className="text-base font-semibold text-slate-900">{t('seller_dashboard.earnings_payouts')}</h3>
                      <Badge variant="secondary">{selectedUserRecords.earnings.length}</Badge>
                    </div>
                    <div className="overflow-hidden rounded-[8px] border border-slate-200">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('admin_dashboard.order_id')}</TableHead>
                            <TableHead>{t('admin_dashboard.sales_total')}</TableHead>
                            <TableHead>{t('admin_dashboard.seller_fee')}</TableHead>
                            <TableHead>{t('seller.status')}</TableHead>
                            <TableHead className="text-right">{t('seller_dashboard.available_balance')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedUserRecords.earnings.map((earning) => (
                            <TableRow key={earning.id}>
                              <TableCell className="font-medium">{earning.order_id || '-'}</TableCell>
                              <TableCell>{formatCurrency(earning.gross_amount)}</TableCell>
                              <TableCell>{formatCurrency(earning.transaction_fee)}</TableCell>
                              <TableCell><Badge variant="outline">{earning.status || '-'}</Badge></TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(earning.net_amount)}</TableCell>
                            </TableRow>
                          ))}
                          {selectedUserRecords.earnings.length === 0 && (
                            <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">{t('seller_dashboard.no_transactions')}</TableCell></TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                </div>
              ) : (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <CardTitle>{t('admin_dashboard.user_management')}</CardTitle>
                    <div className="relative w-full sm:w-72">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input placeholder={t('admin_dashboard.user_search_placeholder')} className="pl-9" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"><Checkbox /></TableHead>
                          <TableHead>{t('admin_dashboard.users')}</TableHead>
                          <TableHead>{t('admin_dashboard.role')}</TableHead>
                          <TableHead>{t('admin_dashboard.registered_at')}</TableHead>
                          <TableHead>{t('seller.status')}</TableHead>
                          <TableHead className="w-[72px] text-right">{t('seller.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isUsersLoading ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                              {t('admin_dashboard.loading')}
                            </TableCell>
                          </TableRow>
                        ) : tableUsers.map(user => (
                          <TableRow key={user.id}>
                            <TableCell><Checkbox /></TableCell>
                            <TableCell>
                              <div className="flex flex-col">
                                <span className="font-medium">{user.name || t('admin_dashboard.no_name')}</span>
                                <span className="text-xs text-muted-foreground">{user.email}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Badge className={getUserRoleBadgeClass(user)} variant={user.is_admin || user.is_seller ? 'default' : 'secondary'}>
                                  {getUserRoleLabel(user)}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>{formatDate(user.created)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={getUserStatusBadgeClass(user)}>
                                {getUserStatusLabel(user)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-[8px]">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48 rounded-[8px] border border-[hsl(var(--border))] bg-white p-1">
                                  <DropdownMenuItem onClick={() => openUserDetails(user)} className="rounded-md">
                                    <Eye className="w-4 h-4" />
                                    {t('admin_dashboard.user_action_view')}
                                  </DropdownMenuItem>
                                  {user.is_seller && !user.is_deleted && (
                                    <DropdownMenuItem onClick={() => handleRemoveSellerRole(user)} className="rounded-md">
                                      <Store className="w-4 h-4" />
                                      {t('admin_dashboard.user_action_remove_seller')}
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuSeparator className="bg-slate-100" />
                                  <DropdownMenuItem
                                    onClick={() => handleDeleteUser(user)}
                                    className="rounded-md text-red-600 focus:bg-red-50 focus:text-red-700"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                    {t('admin_dashboard.user_action_delete')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))}
                        {!isUsersLoading && tableUsers.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                              {t('admin_dashboard.no_users_found')}
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
              )}
            </TabsContent>

            {/* SELLERS */}
            <TabsContent value="sellers" className="space-y-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
                  <CardContent className="p-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
                      <Store className="h-3.5 w-3.5" />
                      {t('admin_dashboard.sellers')}
                    </div>
                    <div className="mt-5 space-y-3">
                      <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
                        {t('admin_dashboard.sellers_shops')}
                      </h2>
                      <p className="max-w-2xl text-sm leading-6 text-slate-600">
                        {t('admin_dashboard.sellers_section_body')}
                      </p>
                    </div>
                    <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                        {t('admin_dashboard.sellers_count', { count: sellerSummary.totalSellers })}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                        {t('admin_dashboard.active_listings_count', { count: sellerSummary.activeListings })}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                        {t('admin_dashboard.orders_count', { count: sellerSummary.totalOrders })}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Card className="border-slate-200 bg-white shadow-sm">
                    <CardContent className="p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.sellers')}
                      </p>
                      <p className="mt-3 text-3xl font-semibold text-slate-900">{sellerSummary.totalSellers}</p>
                      <p className="mt-2 text-sm text-slate-500">{t('admin_dashboard.sellers_overview_hint')}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-slate-200 bg-white shadow-sm">
                    <CardContent className="p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.listings')}
                      </p>
                      <p className="mt-3 text-3xl font-semibold text-slate-900">{sellerSummary.totalListings}</p>
                      <p className="mt-2 text-sm text-slate-500">
                        {t('admin_dashboard.active_listings_count', { count: sellerSummary.activeListings })}
                      </p>
                    </CardContent>
                  </Card>
                  <Card className="border-slate-200 bg-white shadow-sm">
                    <CardContent className="p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.orders')}
                      </p>
                      <p className="mt-3 text-3xl font-semibold text-slate-900">{sellerSummary.totalOrders}</p>
                      <p className="mt-2 text-sm text-slate-500">{t('admin_dashboard.total_revenue')}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-slate-200 bg-white shadow-sm">
                    <CardContent className="p-5">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('seller_dashboard.available_balance')}
                      </p>
                      <p className="mt-3 text-3xl font-semibold text-slate-900">{formatCurrency(sellerSummary.availableBalance)}</p>
                      <p className="mt-2 text-sm text-slate-500">
                        {t('seller_dashboard.pending_escrow')}: {formatCurrency((sellerSummary.pendingBalance || 0) + (sellerSummary.waitingBalance || 0))}
                      </p>
                      {sellerSummary.blockedBalance > 0 && (
                        <p className="mt-1 text-sm text-red-600">
                          {t('seller_dashboard.blocked')}: {formatCurrency(sellerSummary.blockedBalance)}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>

              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <CardTitle>{t('admin_dashboard.sellers_shops')}</CardTitle>
                      <CardDescription>{t('admin_dashboard.sellers_table_body')}</CardDescription>
                    </div>
                    <div className="relative w-full lg:w-80">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder={t('admin_dashboard.seller_search_placeholder')}
                        className="pl-9"
                        value={sellerSearch}
                        onChange={(e) => setSellerSearch(e.target.value)}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-[8px] border border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('admin_dashboard.shop_seller')}</TableHead>
                          <TableHead>{t('admin_dashboard.university')}</TableHead>
                          <TableHead>{t('admin_dashboard.listings')}</TableHead>
                          <TableHead>{t('admin_dashboard.orders')}</TableHead>
                          <TableHead>{t('seller_dashboard.available_balance')}</TableHead>
                          <TableHead>{t('seller.status')}</TableHead>
                          <TableHead className="w-[140px] text-right">{t('seller.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isSellersLoading ? (
                          Array.from({ length: 5 }).map((_, index) => (
                            <TableRow key={index}>
                              <TableCell><Skeleton className="h-10 w-[220px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[56px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[56px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[96px]" /></TableCell>
                              <TableCell><Skeleton className="h-8 w-[90px]" /></TableCell>
                              <TableCell><Skeleton className="ml-auto h-9 w-[112px]" /></TableCell>
                            </TableRow>
                          ))
                        ) : tableSellers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                              {t('admin_dashboard.no_sellers_found')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          tableSellers.map((seller) => (
                            <TableRow key={seller.id}>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium text-slate-900">
                                    {seller.seller_username || seller.name || t('admin_dashboard.unnamed')}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {seller.email || t('admin_dashboard.unknown')}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>{seller.university || '-'}</TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium text-slate-900">{seller.product_count}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {t('admin_dashboard.active_listings_count', { count: seller.active_listings_count })}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium text-slate-900">{seller.order_count}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {t('admin_dashboard.delivered_orders_count', { count: seller.delivered_order_count })}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium text-slate-900">{formatCurrency(seller.available_balance)}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {t('seller_dashboard.pending_escrow')}: {formatCurrency((seller.pending_balance || 0) + (seller.waiting_balance || 0))}
                                  </span>
                                  {seller.blocked_balance > 0 && (
                                    <span className="text-xs text-red-600">
                                      {t('seller_dashboard.blocked')}: {formatCurrency(seller.blocked_balance)}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={seller.is_deleted
                                    ? 'border-red-200 bg-red-50 text-red-700'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700'}
                                >
                                  {seller.is_deleted ? t('admin_dashboard.user_status_deleted') : t('popular.verified')}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button variant="outline" size="sm" className="rounded-[8px]" onClick={() => openUserDetails(seller)}>
                                  <Eye className="mr-2 h-4 w-4" />
                                  {t('admin_dashboard.user_action_view')}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* RETURNS */}
            <TabsContent value="returns" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t('admin_dashboard.returns_refunds')}</CardTitle>
                  <CardDescription>{t('admin_dashboard.returns_description')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('admin_dashboard.return_id')}</TableHead>
                          <TableHead>{t('admin_dashboard.orders')}</TableHead>
                          <TableHead>{t('admin_dashboard.customer')}</TableHead>
                          <TableHead>{t('admin_dashboard.reason')}</TableHead>
                          <TableHead>{t('seller.status')}</TableHead>
                          <TableHead className="text-right">{t('seller.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {returns.map(ret => (
                          <TableRow key={ret.id}>
                            <TableCell className="font-medium">{ret.id.substring(0, 8)}</TableCell>
                            <TableCell>{ret.expand?.order_id?.order_number || ret.order_id}</TableCell>
                            <TableCell>{ret.expand?.buyer_id?.name || t('admin_dashboard.customer')}</TableCell>
                            <TableCell className="max-w-[200px] truncate">{ret.reason}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={ret.status === 'Pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : ''}>
                                {ret.status || 'Pending'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-green-600 border-green-200 hover:bg-green-50"
                                  onClick={() => handleApproveReturn(ret)}
                                >
                                  {t('admin_dashboard.accept')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 border-red-200 hover:bg-red-50"
                                  onClick={() => handleRejectReturn(ret)}
                                >
                                  {t('admin_dashboard.reject')}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {returns.length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">{t('admin_dashboard.no_returns')}</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* PAYOUTS */}
            <TabsContent value="payouts" className="space-y-4">
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <CardTitle>{t('admin_dashboard.payout_requests')}</CardTitle>
                      <CardDescription>{t('admin_dashboard.payout_requests_description')}</CardDescription>
                    </div>
                    <Select value={payoutStatusFilter} onValueChange={setPayoutStatusFilter}>
                      <SelectTrigger className="w-full lg:w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('admin_dashboard.payout_status_all')}</SelectItem>
                        <SelectItem value="requested">{t('admin_dashboard.payout_status_requested')}</SelectItem>
                        <SelectItem value="reviewing">{t('admin_dashboard.payout_status_reviewing')}</SelectItem>
                        <SelectItem value="approved">{t('admin_dashboard.payout_status_approved')}</SelectItem>
                        <SelectItem value="paid">{t('admin_dashboard.payout_status_paid')}</SelectItem>
                        <SelectItem value="rejected">{t('admin_dashboard.payout_status_rejected')}</SelectItem>
                        <SelectItem value="failed">{t('admin_dashboard.payout_status_failed')}</SelectItem>
                        <SelectItem value="cancelled">{t('admin_dashboard.payout_status_cancelled')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-[8px] border border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('admin_dashboard.shop_seller')}</TableHead>
                          <TableHead>{t('orders.total')}</TableHead>
                          <TableHead>{t('seller.status')}</TableHead>
                          <TableHead>{t('admin_dashboard.registered_at')}</TableHead>
                          <TableHead>{t('admin_dashboard.stripe_transfer')}</TableHead>
                          <TableHead className="w-[260px] text-right">{t('seller.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isPayoutsLoading ? (
                          Array.from({ length: 4 }).map((_, index) => (
                            <TableRow key={index}>
                              <TableCell><Skeleton className="h-10 w-[220px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[90px]" /></TableCell>
                              <TableCell><Skeleton className="h-8 w-[100px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[140px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                              <TableCell><Skeleton className="ml-auto h-9 w-[240px]" /></TableCell>
                            </TableRow>
                          ))
                        ) : payoutRequests.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                              {t('admin_dashboard.no_payout_requests')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          payoutRequests.map((request) => (
                            <TableRow key={request.id}>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium text-slate-900">
                                    {request.seller?.seller_username || request.seller?.name || request.seller?.email || request.seller_id}
                                  </span>
                                  <span className="text-xs text-muted-foreground break-all">{request.id}</span>
                                </div>
                              </TableCell>
                              <TableCell className="font-medium">{formatCurrency(request.amount)}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={getPayoutStatusBadgeClass(request.status)}>
                                  {t(`admin_dashboard.payout_status_${request.status}`)}
                                </Badge>
                                {request.failure_reason && (
                                  <p className="mt-1 max-w-[220px] truncate text-xs text-red-600">{request.failure_reason}</p>
                                )}
                              </TableCell>
                              <TableCell>{formatDateTime(request.created)}</TableCell>
                              <TableCell className="max-w-[160px] truncate">{request.stripe_transfer_id || '-'}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex flex-wrap justify-end gap-2">
                                  {['requested'].includes(request.status) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={payoutActionLoadingId === request.id}
                                      onClick={() => handlePayoutRequestStatus(request, 'reviewing')}
                                    >
                                      {t('admin_dashboard.payout_request_review')}
                                    </Button>
                                  )}
                                  {['requested', 'reviewing'].includes(request.status) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                      disabled={payoutActionLoadingId === request.id}
                                      onClick={() => handlePayoutRequestStatus(request, 'approved')}
                                    >
                                      {t('admin_dashboard.payout_request_approve')}
                                    </Button>
                                  )}
                                  {['requested', 'reviewing', 'approved'].includes(request.status) && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-red-200 text-red-700 hover:bg-red-50"
                                      disabled={payoutActionLoadingId === request.id}
                                      onClick={() => handlePayoutRequestStatus(request, 'rejected')}
                                    >
                                      {t('admin_dashboard.payout_request_reject')}
                                    </Button>
                                  )}
                                  {request.status === 'approved' && (
                                    <Button
                                      size="sm"
                                      disabled={payoutActionLoadingId === request.id}
                                      onClick={() => handlePayPayoutRequest(request)}
                                    >
                                      {t('admin_dashboard.payout_request_pay')}
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <CardTitle>{t('admin_dashboard.payout_conflicts')}</CardTitle>
                      <CardDescription>{t('admin_dashboard.payout_conflicts_description')}</CardDescription>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Select value={payoutConflictStatusFilter} onValueChange={setPayoutConflictStatusFilter}>
                        <SelectTrigger className="w-full sm:w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t('admin_dashboard.payout_status_all')}</SelectItem>
                          <SelectItem value="open">{t('admin_dashboard.payout_conflict_status_open')}</SelectItem>
                          <SelectItem value="resolved">{t('admin_dashboard.payout_conflict_status_resolved')}</SelectItem>
                          <SelectItem value="dismissed">{t('admin_dashboard.payout_conflict_status_dismissed')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        disabled={payoutActionLoadingId === 'create-conflict'}
                        onClick={handleCreatePayoutConflict}
                      >
                        <AlertCircle className="mr-2 h-4 w-4" />
                        {t('admin_dashboard.payout_conflict_create')}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-[8px] border border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('admin_dashboard.order_id')}</TableHead>
                          <TableHead>{t('admin_dashboard.seller_id')}</TableHead>
                          <TableHead>{t('admin_dashboard.blocked_amount')}</TableHead>
                          <TableHead>{t('admin_dashboard.reason')}</TableHead>
                          <TableHead>{t('seller.status')}</TableHead>
                          <TableHead className="text-right">{t('seller.actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {isPayoutsLoading ? (
                          Array.from({ length: 3 }).map((_, index) => (
                            <TableRow key={index}>
                              <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[80px]" /></TableCell>
                              <TableCell><Skeleton className="h-4 w-[220px]" /></TableCell>
                              <TableCell><Skeleton className="h-8 w-[90px]" /></TableCell>
                              <TableCell><Skeleton className="ml-auto h-9 w-[170px]" /></TableCell>
                            </TableRow>
                          ))
                        ) : payoutConflicts.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                              {t('admin_dashboard.no_payout_conflicts')}
                            </TableCell>
                          </TableRow>
                        ) : (
                          payoutConflicts.map((conflict) => (
                            <TableRow key={conflict.id}>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="font-medium text-slate-900">{conflict.order_id || conflict.earning_id || '-'}</span>
                                  <span className="text-xs text-muted-foreground">{formatDateTime(conflict.created)}</span>
                                </div>
                              </TableCell>
                              <TableCell className="max-w-[150px] truncate">{conflict.seller_id || '-'}</TableCell>
                              <TableCell className="font-medium">{formatCurrency(conflict.blocked_amount)}</TableCell>
                              <TableCell>
                                <div className="max-w-[320px]">
                                  <p className="truncate font-medium text-slate-900">{conflict.reason || '-'}</p>
                                  {conflict.admin_notes && (
                                    <p className="mt-1 truncate text-xs text-muted-foreground">{conflict.admin_notes}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={getPayoutStatusBadgeClass(conflict.status)}>
                                  {t(`admin_dashboard.payout_conflict_status_${conflict.status}`)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {conflict.status === 'open' ? (
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                      disabled={payoutActionLoadingId === conflict.id}
                                      onClick={() => handleResolvePayoutConflict(conflict, true)}
                                    >
                                      {t('admin_dashboard.payout_conflict_resolve')}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={payoutActionLoadingId === conflict.id}
                                      onClick={() => handleResolvePayoutConflict(conflict, false)}
                                    >
                                      {t('admin_dashboard.payout_conflict_dismiss')}
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-sm text-muted-foreground">{formatDateTime(conflict.resolved_at)}</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ANALYTICS */}
            <TabsContent value="analytics" className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader><CardTitle>{t('admin_dashboard.order_volume_7_days')}</CardTitle></CardHeader>
                  <CardContent className="h-[350px]">
                    {isAnalyticsLoading && analyticsChartData.length === 0 ? (
                      <div className="flex h-full flex-col justify-end gap-3">
                        <Skeleton className="h-56 w-full rounded-[8px]" />
                        <Skeleton className="h-5 w-3/4 rounded-[8px]" />
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={analyticsChartData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} />
                          <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                          <Tooltip
                            cursor={{ fill: '#f3f4f6' }}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            formatter={(value, name) => [
                              name === 'revenue' ? formatCurrency(value) : value,
                              name === 'orders' ? t('admin_dashboard.orders') : name,
                            ]}
                          />
                          <Bar dataKey="orders" fill="#0000FF" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle>{t('admin_dashboard.top_sellers')}</CardTitle></CardHeader>
                  <CardContent>
                    {isAnalyticsLoading && analyticsTopSellers.length === 0 ? (
                      <div className="space-y-4">
                        {[0, 1, 2, 3].map((item) => (
                          <div key={item} className="flex items-center justify-between p-3">
                            <div className="flex items-center gap-3">
                              <Skeleton className="h-8 w-8 rounded-full" />
                              <div className="space-y-2">
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="h-3 w-20" />
                              </div>
                            </div>
                            <Skeleton className="h-4 w-20" />
                          </div>
                        ))}
                      </div>
                    ) : analyticsTopSellers.length > 0 ? (
                      <div className="space-y-4">
                        {analyticsTopSellers.map((seller, i) => (
                          <div key={seller.id} className="flex items-center justify-between p-3 border-b last:border-0">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-medium text-xs">{i + 1}</div>
                              <div>
                                <p className="font-medium text-sm">{seller.seller_username || seller.name || seller.email || seller.id}</p>
                                <p className="text-xs text-muted-foreground">{t('admin_dashboard.products_count', { count: seller.product_count || 0 })}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-sm">{formatCurrency(seller.revenue_total)}</div>
                              <div className="text-xs text-muted-foreground">{t('admin_dashboard.orders_count', { count: seller.order_count || 0 })}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        {t('admin_dashboard.no_sellers_found')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* SETTINGS */}
            <TabsContent value="settings" className="space-y-6">
              <Card className="max-w-2xl">
                <CardHeader>
                  <CardTitle>{t('admin_dashboard.platform_settings')}</CardTitle>
                  <CardDescription>{t('admin_dashboard.platform_settings_description')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">{t('admin_dashboard.buyer_service_fee')}</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={settingsForm.service_fee}
                        onChange={(e) => handleSettingsChange('service_fee', e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">{t('admin_dashboard.default_shipping_fee')}</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={settingsForm.shipping_fee}
                        onChange={(e) => handleSettingsChange('shipping_fee', e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">{t('admin_dashboard.seller_fee')}</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={settingsForm.transaction_fee_percentage}
                        onChange={(e) => handleSettingsChange('transaction_fee_percentage', e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium">{t('admin_dashboard.verification_fee')}</label>
                      <Input
                        type="number"
                        step="0.01"
                        value={settingsForm.verification_fee}
                        onChange={(e) => handleSettingsChange('verification_fee', e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-3 rounded-[8px] border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <label className="text-sm font-medium">{t('admin_dashboard.shop_visibility')}</label>
                        <p className="mt-1 text-sm text-muted-foreground">{t('admin_dashboard.shop_visibility_description')}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-slate-700">
                          {settingsForm.shop_enabled ? t('admin_dashboard.shop_enabled') : t('admin_dashboard.shop_disabled')}
                        </span>
                        <Switch
                          checked={settingsForm.shop_enabled}
                          onCheckedChange={(checked) => handleSettingsChange('shop_enabled', checked)}
                          aria-label={t('admin_dashboard.shop_visibility')}
                        />
                      </div>
                    </div>
                  </div>
                  <Button onClick={handleSaveSettings} className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90">
                    {t('admin_dashboard.save_settings')}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>
        </div>
      </main>

      {/* Edit Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-[860px]">
          {currentProduct && (
            <form onSubmit={async (e) => {
              e.preventDefault();
              try {
                const token = pb.authStore.token;
                const res = await apiServerClient.fetch(`/admin/products/${currentProduct.id}`, {
                  method: 'PUT',
                  headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                  },
                  body: JSON.stringify(currentProduct)
                });
                if (!res.ok) throw new Error('Update failed');
                toast.success(t('seller.update_success'));
                setEditModalOpen(false);
                fetchTableProducts();
                fetchData(true);
              } catch (error) {
                toast.error(t('admin_dashboard.save_error'));
              }
            }} className="grid md:grid-cols-[280px_minmax(0,1fr)]">
              <div className="border-b bg-[hsl(var(--muted-bg))] md:border-b-0 md:border-r">
                <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
                  {getProductImageUrl(currentProduct) ? (
                    <img
                      src={getProductImageUrl(currentProduct)}
                      alt={currentProduct.name || t('admin_dashboard.edit_product')}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-6 text-center text-sm font-medium text-muted-foreground">
                      {t('shop.no_image')}
                    </div>
                  )}
                </div>

                <div className="space-y-4 p-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]">
                      {t('admin_dashboard.edit_product')}
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                      {formatCurrency(currentProduct.price)}
                    </h3>
                  </div>

                  <div className="grid gap-3 text-sm">
                    <div className="rounded-[8px] border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('seller.status')}
                      </p>
                      <Badge variant="outline" className={`mt-2 ${getStatusBadgeClass(currentProduct.status)}`}>
                        {getStatusLabel(currentProduct.status)}
                      </Badge>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('seller.category')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {formatProductCategories(currentProduct.fachbereich)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-white px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.shop_seller')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {currentProduct.seller_username || t('product.anonymous_seller')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 md:p-7">
                <DialogHeader className="space-y-3 pb-6 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    {currentProduct.product_type && (
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                        {getProductTypeLabel(currentProduct.product_type)}
                      </Badge>
                    )}
                    <Badge variant="outline" className={getStatusBadgeClass(currentProduct.status)}>
                      {getStatusLabel(currentProduct.status)}
                    </Badge>
                  </div>
                  <DialogTitle className="text-2xl font-semibold leading-tight text-slate-900">
                    {t('admin_dashboard.edit_product')}
                  </DialogTitle>
                  <p className="text-sm leading-6 text-slate-600">
                    {currentProduct.created
                      ? `${t('admin_dashboard.registered_at')}: ${formatDate(currentProduct.created)}`
                      : formatProductCategories(currentProduct.fachbereich)}
                  </p>
                </DialogHeader>

                <div className="space-y-5">
                  <div className="grid gap-2">
                    <Label className="text-sm font-medium text-slate-700">{t('shipping.name')}</Label>
                    <Input
                      className="h-11"
                      value={currentProduct.name || ''}
                      onChange={e => setCurrentProduct({ ...currentProduct, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label className="text-sm font-medium text-slate-700">{t('seller.description')}</Label>
                    <Textarea
                      className="min-h-[120px] resize-none"
                      value={currentProduct.description || ''}
                      onChange={e => setCurrentProduct({ ...currentProduct, description: e.target.value })}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium text-slate-700">{t('seller.price')}</Label>
                      <Input
                        className="h-11"
                        type="number"
                        step="0.01"
                        value={currentProduct.price || 0}
                        onChange={e => setCurrentProduct({ ...currentProduct, price: parseFloat(e.target.value) })}
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium text-slate-700">{t('seller.status')}</Label>
                      <Select value={currentProduct.status || ''} onValueChange={v => setCurrentProduct({ ...currentProduct, status: v })}>
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder={t('seller.status')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">{t('seller.status_active')}</SelectItem>
                          <SelectItem value="pending_verification">{t('seller.status_pending')}</SelectItem>
                          <SelectItem value="sold">{t('seller.status_sold')}</SelectItem>
                          <SelectItem value="rejected">{t('seller.status_rejected')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium text-slate-700">{t('product.brand')}</Label>
                      <Input
                        className="h-11"
                        value={currentProduct.brand || ''}
                        onChange={e => setCurrentProduct({ ...currentProduct, brand: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-sm font-medium text-slate-700">{t('product.location')}</Label>
                      <Input
                        className="h-11"
                        value={currentProduct.location || ''}
                        onChange={e => setCurrentProduct({ ...currentProduct, location: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2 sm:col-span-2">
                      <Label className="text-sm font-medium text-slate-700">{t('product.shipping_type')}</Label>
                      <Select value={currentProduct.shipping_type || 'dhl_parcel'} onValueChange={v => setCurrentProduct({ ...currentProduct, shipping_type: v })}>
                        <SelectTrigger className="h-11">
                          <SelectValue placeholder={t('product.shipping_type')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dhl_parcel">{t('product.shipping_dhl_parcel')}</SelectItem>
                          <SelectItem value="letter_mail">{t('product.shipping_letter_mail')}</SelectItem>
                          <SelectItem value="pickup">{t('product.shipping_pickup')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <DialogFooter className="border-t pt-5">
                    <Button type="button" variant="outline" onClick={() => setEditModalOpen(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button type="submit" className="bg-[#0000FF] text-white hover:bg-[#0000CC]">
                      {t('shipping.save')}
                    </Button>
                  </DialogFooter>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* View Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-[1040px]">
          {currentProduct && (
            <div className="bg-white">
              <div className="grid lg:grid-cols-[360px_minmax(0,1fr)]">
                <div className="border-b bg-slate-50 lg:border-b-0 lg:border-r">
                  <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100">
                    {getProductImageUrl(currentProduct) ? (
                      <img
                        src={getProductImageUrl(currentProduct)}
                        alt={currentProduct.name || t('admin_dashboard.product_details')}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-sm font-medium text-muted-foreground">
                        {t('shop.no_image')}
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 p-5">
                    <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                      <div className="rounded-[8px] border border-slate-200 bg-white px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                          {t('admin_dashboard.listing_price')}
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">
                          {formatCurrency(currentProduct.price)}
                        </p>
                      </div>
                      <div className="rounded-[8px] border border-blue-200 bg-blue-50 px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-blue-700">
                          {t('admin_dashboard.inventory_quantity')}
                        </p>
                        <p className="mt-2 text-2xl font-semibold text-blue-900">
                          {Number(currentProduct.stock_quantity ?? 0)}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-[8px] border border-slate-200 bg-white p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.seller_details')}
                      </p>
                      <div className="mt-3 space-y-2 text-sm">
                        <p className="font-semibold text-slate-900">{getProductSellerName(currentProduct)}</p>
                        <p className="break-all text-slate-600">{getProductSellerEmail(currentProduct)}</p>
                        <p className="text-slate-600">{getProductSellerUniversity(currentProduct)}</p>
                        <p className="break-all text-xs text-slate-500">{getProductSellerId(currentProduct)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 md:p-7">
                  <DialogHeader className="space-y-4 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      {currentProduct.product_type && (
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                          {getProductTypeLabel(currentProduct.product_type)}
                        </Badge>
                      )}
                      <Badge variant="outline" className={getStatusBadgeClass(currentProduct.status)}>
                        {getStatusLabel(currentProduct.status)}
                      </Badge>
                      {currentProduct.verification_status && (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                          {currentProduct.verification_status}
                        </Badge>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]">
                        {t('admin_dashboard.product_overview')}
                      </p>
                      <DialogTitle className="mt-2 text-3xl font-semibold leading-tight text-slate-900">
                        {currentProduct.name || t('admin_dashboard.no_name')}
                      </DialogTitle>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {currentProduct.id}
                      </p>
                    </div>
                  </DialogHeader>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('seller.category')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {formatProductCategories(currentProduct.fachbereich)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('seller.condition')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">{formatDetailValue(currentProduct.condition)}</p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('seller.type')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {getProductTypeLabel(currentProduct.product_type || 'Article')}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('product.brand')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">{formatDetailValue(currentProduct.brand)}</p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('product.location')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">{formatDetailValue(currentProduct.location)}</p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('product.shipping_type')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">{formatDetailValue(currentProduct.shipping_type)}</p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('seller.status')}
                      </p>
                      <Badge variant="outline" className={`mt-2 ${getStatusBadgeClass(currentProduct.status)}`}>
                        {getStatusLabel(currentProduct.status)}
                      </Badge>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.verification_status')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">{formatDetailValue(currentProduct.verification_status)}</p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.shop_product')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">{currentProduct.shop_product ? t('common.yes') : t('common.no')}</p>
                    </div>
                  </div>

                  <div className="mt-6 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                      {t('seller.description')}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {formatDetailValue(currentProduct.description)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 p-6 md:p-7">
                <div className="grid gap-5 xl:grid-cols-3">
                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.seller_details')}</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('shipping.name')}</p>
                        <p className="mt-1 font-medium text-slate-900">{currentProduct.seller?.name || getProductSellerName(currentProduct)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.seller_username')}</p>
                        <p className="mt-1 font-medium text-slate-900">{currentProduct.seller?.seller_username || currentProduct.seller_username || getProductSellerName(currentProduct)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.seller_email')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{getProductSellerEmail(currentProduct)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.seller_id')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{getProductSellerId(currentProduct)}</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.product_dates')}</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.registered_at')}</p>
                        <p className="mt-1 font-medium text-slate-900">{formatDetailDate(currentProduct.created || currentProduct.created_at)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.created_at')}</p>
                        <p className="mt-1 font-medium text-slate-900">{formatDetailDate(currentProduct.created_at || currentProduct.created)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.updated_at')}</p>
                        <p className="mt-1 font-medium text-slate-900">{formatDetailDate(currentProduct.updated || currentProduct.updated_at || currentProduct.created_at || currentProduct.created)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('seller_dashboard.created_at')}</p>
                        <p className="mt-1 font-medium text-slate-900">{formatDetailDate(currentProduct.seller?.created || currentProduct.created_at || currentProduct.created)}</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.product_identifiers')}</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.product_id')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{currentProduct.id}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.collection')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{formatDetailValue(currentProduct.collectionName || currentProduct.collectionId)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.image_file')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{formatDetailValue(currentProduct.image)}</p>
                      </div>
                    </div>
                  </section>
                </div>

                <section className="mt-5 rounded-[8px] border border-slate-200 p-5">
                  <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.all_product_data')}</h3>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {[
                      ['product_type', currentProduct.product_type],
                      ['price', formatCurrency(currentProduct.price)],
                      ['stock_quantity', currentProduct.stock_quantity ?? 0],
                      ['weight_g', currentProduct.weight_g ?? ''],
                      ['brand', currentProduct.brand],
                      ['location', currentProduct.location],
                      ['shipping_type', currentProduct.shipping_type],
                      ['images', currentProduct.images],
                      ['filter_values', currentProduct.filter_values],
                      ['condition', currentProduct.condition],
                      ['fachbereich', currentProduct.fachbereich],
                      ['status', currentProduct.status],
                      ['verification_status', currentProduct.verification_status],
                      ['seller_id', currentProduct.seller_id],
                      ['seller_username', currentProduct.seller_username],
                      ['seller_email', currentProduct.seller_email || currentProduct.seller?.email],
                      ['created_at', currentProduct.created_at || currentProduct.created],
                      ['updated_at', currentProduct.updated_at || currentProduct.updated],
                      ['shop_product', currentProduct.shop_product],
                      ['set_items', currentProduct.set_items],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
                        <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm font-medium text-slate-900">{formatDetailValue(value)}</pre>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={orderDetailsModalOpen}
        onOpenChange={(open) => {
          setOrderDetailsModalOpen(open);
          if (!open) {
            setCurrentOrderDetails(null);
            setIsOrderDetailsLoading(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-[980px]">
          {isOrderDetailsLoading ? (
            <div className="flex min-h-[240px] items-center justify-center p-10 text-muted-foreground">
              {t('admin_dashboard.loading')}
            </div>
          ) : currentOrderDetails ? (
            <div className="bg-white">
              <div className="border-b border-slate-200 p-6 md:p-7">
                <DialogHeader className="space-y-4 text-left">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={ORDER_DELIVERED_DISPLAY_STATUSES.has(currentOrderDetails.status)
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-700'}
                    >
                      {getStatusLabel(currentOrderDetails.status || 'pending')}
                    </Badge>
                    {currentOrderDetails.product_type && (
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                        {formatDetailValue(currentOrderDetails.product_type)}
                      </Badge>
                    )}
                    {(hasOrderLabel(currentOrderDetails) || currentOrderDetails.label_status) && (
                      <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                        {getOrderLabelText(currentOrderDetails, language)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]">
                        {t('admin_dashboard.order_details')}
                      </p>
                      <DialogTitle className="mt-2 text-3xl font-semibold leading-tight text-slate-900">
                        {getOrderDisplayId(currentOrderDetails)}
                      </DialogTitle>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {formatDateTime(currentOrderDetails.created)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleCopyOrderValue(getOrderDisplayId(currentOrderDetails))}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        {t('admin_dashboard.order_action_copy_id')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleGenerateOrderLabel(currentOrderDetails)}
                        disabled={!canGenerateOrderLabel(currentOrderDetails) || orderActionLoadingId === currentOrderDetails.id}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        {hasOrderLabel(currentOrderDetails) || getOrderTrackingNumber(currentOrderDetails)
                          ? (language === 'EN' ? 'Regenerate DHL label' : 'DHL-Label neu erstellen')
                          : (language === 'EN' ? 'Generate DHL label' : 'DHL-Label erstellen')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleDownloadOrderLabel(currentOrderDetails)}
                        disabled={!hasOrderLabel(currentOrderDetails) || orderActionLoadingId === currentOrderDetails.id}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        {t('admin_dashboard.order_action_download_label')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => handleRefreshOrderTracking(currentOrderDetails)}
                        disabled={!currentOrderTrackingNumber || orderActionLoadingId === currentOrderDetails.id}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        {t('admin_dashboard.order_action_refresh_tracking')}
                      </Button>
                    </div>
                  </div>
                </DialogHeader>
              </div>

              <div className="grid gap-5 p-6 md:p-7">
                <section className="rounded-[8px] border border-slate-200 p-5">
                  <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.order_summary')}</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_total')}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        {formatCurrency(currentOrderDetails.total_amount)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_quantity')}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        {formatDetailValue(currentOrderDetails.quantity)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_type')}
                      </p>
                      <p className="mt-2 text-lg font-semibold capitalize text-slate-900">
                        {formatDetailValue(currentOrderDetails.product_type)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('orders.tracking')}
                      </p>
                      <p className="mt-2 break-all font-medium text-slate-900">
                        {formatDetailValue(currentOrderTrackingNumber)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_label_status')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900" title={getOrderLabelIssue(currentOrderDetails)}>
                        {getOrderLabelText(currentOrderDetails, language)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_label_error')}
                      </p>
                      <p className="mt-2 break-words font-medium text-slate-900">
                        {formatDetailValue(getOrderLabelIssue(currentOrderDetails))}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_label_generated_at')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {formatDateTime(currentOrderDetails.label_generated_at)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_dhl_tracking_status')}
                      </p>
                      <p className="mt-2 break-words font-medium text-slate-900">
                        {formatDetailValue(currentOrderDetails.dhl_tracking_status || currentOrderDetails.dhl_tracking_summary)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_tracking_last_checked')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {formatDateTime(currentOrderDetails.dhl_tracking_last_checked_at)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_dhl_delivered_at')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {formatDateTime(currentOrderDetails.dhl_delivered_at)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_dhl_delivery_confirmed_at')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {formatDateTime(currentOrderDetails.dhl_delivery_confirmed_at)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_payout_release_at')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {formatDateTime(currentOrderDetails.payout_release_at)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_payout_released_at')}
                      </p>
                      <p className="mt-2 font-medium text-slate-900">
                        {formatDateTime(currentOrderDetails.payout_released_at)}
                      </p>
                    </div>
                    <div className="rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        {t('admin_dashboard.order_payout_blocked_reason')}
                      </p>
                      <p className="mt-2 break-words font-medium text-slate-900">
                        {formatDetailValue(currentOrderDetails.payout_release_blocked_reason)}
                      </p>
                    </div>
                  </div>
                </section>

                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.order_buyer')}</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('shipping.name')}</p>
                        <p className="mt-1 font-medium text-slate-900">{getOrderPartyLabel(currentOrderDetails.buyer)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Email</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{getOrderPartyEmail(currentOrderDetails.buyer)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.account_id')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{formatDetailValue(currentOrderDetails.buyer?.id)}</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.order_seller')}</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('shipping.name')}</p>
                        <p className="mt-1 font-medium text-slate-900">{getOrderPartyLabel(currentOrderDetails.seller)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Email</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{getOrderPartyEmail(currentOrderDetails.seller)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.account_id')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{formatDetailValue(currentOrderDetails.seller?.id)}</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.order_product')}</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('shipping.name')}</p>
                        <p className="mt-1 font-medium text-slate-900">{formatDetailValue(currentOrderDetails.product?.name)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('seller.price')}</p>
                        <p className="mt-1 font-medium text-slate-900">
                          {currentOrderDetails.product?.price !== undefined
                            ? formatCurrency(currentOrderDetails.product.price)
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.product_id')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{formatDetailValue(currentOrderDetails.product?.id)}</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('order_details.shipping_address')}</h3>
                    <div className="mt-4 space-y-1 text-sm text-slate-700">
                      {currentOrderShippingLines.length > 0 ? currentOrderShippingLines.map((line) => (
                        <p key={line} className="break-words font-medium text-slate-900">{line}</p>
                      )) : (
                        <p className="text-muted-foreground">{t('admin_dashboard.unknown')}</p>
                      )}
                    </div>
                  </section>
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.order_identifiers')}</h3>
                    <div className="mt-4 space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.order_id')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{formatDetailValue(currentOrderDetails.id)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.order_payment_intent')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">{formatDetailValue(currentOrderDetails.payment_intent_id)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.order_refund')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">
                          {currentOrderDetails.stripe_refund_id
                            ? `${formatCurrency(currentOrderDetails.refund_amount)} - ${currentOrderDetails.refund_status || currentOrderDetails.stripe_refund_id}`
                            : formatDetailValue(currentOrderDetails.refund_status)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.order_payout_state')}</p>
                        <p className="mt-1 break-all font-medium text-slate-900">
                          {Array.isArray(currentOrderDetails.seller_earnings) && currentOrderDetails.seller_earnings.length > 0
                            ? currentOrderDetails.seller_earnings.map((earning) => `${formatCurrency(earning.net_amount ?? earning.gross_amount)} - ${earning.status || '-'}`).join(', ')
                            : '-'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.created_at')}</p>
                        <p className="mt-1 font-medium text-slate-900">{formatDateTime(currentOrderDetails.created)}</p>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.order_status_events')}</h3>
                    {Array.isArray(currentOrderDetails.status_events) && currentOrderDetails.status_events.length > 0 ? (
                      <div className="mt-4 space-y-3 text-sm">
                        {currentOrderDetails.status_events.slice(0, 6).map((event) => (
                          <div key={event.id} className="rounded-[8px] bg-slate-50 px-3 py-2">
                            <p className="font-medium text-slate-900">
                              {formatDetailValue(event.event_type)}: {formatDetailValue(event.from_status)} - {formatDetailValue(event.to_status)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">{formatDateTime(event.created)}</p>
                            {event.note && <p className="mt-1 whitespace-pre-wrap text-slate-700">{event.note}</p>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-muted-foreground">-</p>
                    )}
                  </section>

                  <section className="rounded-[8px] border border-slate-200 p-5">
                    <h3 className="text-base font-semibold text-slate-900">{t('admin_dashboard.order_return_request')}</h3>
                    {currentOrderDetails.return_request ? (
                      <div className="mt-4 space-y-3 text-sm">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('seller.status')}</p>
                          <p className="mt-1 font-medium text-slate-900">{formatDetailValue(currentOrderDetails.return_request.status)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('admin_dashboard.reason')}</p>
                          <p className="mt-1 whitespace-pre-wrap font-medium text-slate-900">
                            {formatDetailValue(currentOrderDetails.return_request.reason)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('seller.description')}</p>
                          <p className="mt-1 whitespace-pre-wrap font-medium text-slate-900">
                            {formatDetailValue(currentOrderDetails.return_request.details)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{t('order_details.tracking_title')}</p>
                          <p className="mt-1 break-all font-medium text-slate-900">
                            {formatDetailValue(currentOrderDetails.return_request.tracking_number)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-muted-foreground">
                        {t('admin_dashboard.order_no_return_request')}
                      </p>
                    )}
                  </section>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

    </>
  );
};

export default AdminDashboardPage;
