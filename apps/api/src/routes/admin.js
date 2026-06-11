import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import pb from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { auth, requireAuth, admin } from '../middleware/index.js';
import { DEFAULT_PLATFORM_SETTINGS, normalizePlatformSettings } from '../utils/platformSettings.js';
import { createProductVerificationAudit } from '../utils/productValidation.js';
import {
  canTransitionOrderStatus,
  isOrderStatus,
  ORDER_DELIVERED_STATUSES,
  ORDER_STATUS_VALUES,
  shouldExcludeOrderFromRevenue,
} from '../utils/orderStatus.js';
import {
  releaseEligiblePayouts,
  startPayoutWaitingPeriodForOrder,
} from '../utils/payoutWaitingPeriod.js';
import { buildSellerBalanceFromEarnings, syncSellerBalancesForOrder } from '../utils/sellerBalance.js';
import { PAYOUT_REQUEST_STATUSES, sanitizePayoutRequest } from '../utils/sellerPayoutRequests.js';
import { executeStripeConnectPayoutRequest } from '../utils/stripeConnect.js';
import {
  createPayoutConflict,
  listPayoutConflicts,
  resolvePayoutConflict,
} from '../utils/payoutConflicts.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Apply auth and admin middleware to all routes
router.use(auth);
router.use(requireAuth);
router.use(admin);

// ============================================================================
// PRODUCTS ENDPOINTS
// ============================================================================

/**
 * Build filter string for product queries
 * @param {string} search - Search term (name or ID)
 * @param {string} category - Category/fachbereich filter
 * @param {string} status - Status filter
 * @returns {string} - PocketBase filter string
 */
const buildProductFilter = (search, category, status, type) => {
  const filters = [];

  if (search) {
    const searchStr = String(search).trim();
    filters.push(`(name~"${searchStr}" || id~"${searchStr}")`);
  }

  if (category) {
    const categoryStr = String(category).trim();
    filters.push(`fachbereich="${categoryStr}"`);
  }

  if (status) {
    const statusStr = String(status).trim();
    filters.push(`status="${statusStr}"`);
  }

  if (type) {
    const typeStr = String(type).trim();
    filters.push(`product_type="${typeStr}"`);
  }

  return filters.length > 0 ? filters.join(' && ') : '';
};

const buildShopProductFilter = (search, category) => {
  const filters = [];

  if (search) {
    const searchStr = escapeFilterValue(String(search).trim());
    filters.push(`(name~"${searchStr}" || id~"${searchStr}")`);
  }

  if (category) {
    filters.push(`fachbereich="${escapeFilterValue(String(category).trim())}"`);
  }

  return filters.length > 0 ? filters.join(' && ') : '';
};

const PLATFORM_SELLER = {
  id: 'platform',
  name: 'Zahnibörse',
  email: 'info@zahniboerse.com',
  university: 'Official shop',
  seller_username: 'Zahnibörse',
  is_seller: true,
  is_admin: true,
};

const buildAdminProductSeller = (product, source = 'marketplace', seller = null) => {
  const productDate = product.created || product.created_at || product.updated || '';

  if (source === 'shop') {
    return {
      ...PLATFORM_SELLER,
      created: productDate,
    };
  }

  const resolvedSeller = seller || product.expand?.seller_id || null;

  if (resolvedSeller) {
    return {
      id: resolvedSeller.id || product.seller_id || 'unknown',
      name: resolvedSeller.name || resolvedSeller.seller_username || product.seller_username || 'Unknown seller',
      email: resolvedSeller.email || 'Not available',
      university: resolvedSeller.university || 'Not available',
      seller_username: resolvedSeller.seller_username || product.seller_username || resolvedSeller.name || 'Unknown seller',
      is_seller: resolvedSeller.is_seller === true,
      is_admin: resolvedSeller.is_admin === true,
      created: resolvedSeller.created || productDate,
    };
  }

  return {
    id: product.seller_id || 'unknown',
    name: product.seller_username || 'Unknown seller',
    email: 'Not available',
    university: 'Not available',
    seller_username: product.seller_username || 'Unknown seller',
    is_seller: false,
    is_admin: false,
    created: productDate,
  };
};

const resolveProductVerificationStatus = (product, source) => {
  if (source === 'shop') return 'approved';
  if (product.verification_status) return product.verification_status;
  if (product.status === 'active') return 'approved';
  if (product.status === 'pending_verification') return 'pending';
  return 'not_required';
};

const formatAdminProduct = (product, source = 'marketplace', seller = null) => {
  const normalizedSeller = buildAdminProductSeller(product, source, seller);
  const createdAt = product.created_at || product.created || '';
  const updatedAt = product.updated_at || product.updated || createdAt;
  const images = Array.isArray(product.images)
    ? product.images
    : product.images
      ? [product.images]
      : [];

  return {
    id: product.id,
    collectionId: product.collectionId,
    collectionName: product.collectionName,
    source,
    name: product.name || '',
    description: product.description || '',
    price: product.price || 0,
    product_type: product.product_type || 'Article',
    condition: product.condition || 'Not specified',
    fachbereich: product.fachbereich || [],
    status: source === 'shop' ? 'active' : product.status || 'draft',
    verification_status: resolveProductVerificationStatus(product, source),
    verification_requested_at: product.verification_requested_at || '',
    verification_fee_paid: product.verification_fee_paid === true,
    verification_fee_paid_at: product.verification_fee_paid_at || '',
    verification_payment_intent_id: product.verification_payment_intent_id || '',
    verification_checkout_session_id: product.verification_checkout_session_id || '',
    seller_id: normalizedSeller.id,
    seller_username: normalizedSeller.seller_username,
    seller_email: normalizedSeller.email,
    seller: normalizedSeller,
    stock_quantity: product.stock_quantity || 0,
    weight_g: product.weight_g || 0,
    length_mm: product.length_mm || 0,
    width_mm: product.width_mm || 0,
    height_mm: product.height_mm || 0,
    image: product.image || null,
    images,
    brand: product.brand || '',
    location: product.location || '',
    shipping_type: product.shipping_type || 'dhl_parcel',
    filter_values: safeJsonObject(product.filter_values),
    validation_requested_at: product.validation_requested_at || '',
    validation_reviewed_at: product.validation_reviewed_at || '',
    validation_admin_id: product.validation_admin_id || '',
    validation_notes: product.validation_notes || '',
    shop_product: source === 'shop' ? true : product.shop_product === true,
    created: product.created || createdAt,
    created_at: createdAt,
    updated: product.updated || updatedAt,
    updated_at: updatedAt,
    set_items: product.set_items || [],
  };
};

const resolveAdminProduct = async (id, preferredSource = null) => {
  const collections = preferredSource === 'shop'
    ? ['shop_products', 'products']
    : preferredSource === 'marketplace'
      ? ['products', 'shop_products']
      : ['shop_products', 'products'];

  for (const collectionName of collections) {
    const product = await pb.collection(collectionName).getOne(id, { $autoCancel: false }).catch(() => null);
    if (product) {
      return {
        product,
        collectionName,
        source: collectionName === 'shop_products' ? 'shop' : 'marketplace',
      };
    }
  }

  return null;
};

const queueVerificationEmail = async ({ type, sellerId, productId, productName, sellerEmail, reason = null }) => {
  const sellerIdStr = String(sellerId).trim();
  const productIdStr = String(productId).trim();
  const productNameStr = String(productName).trim();
  const sellerEmailStr = String(sellerEmail).trim();
  const reasonStr = reason ? String(reason).trim() : null;
  const isApproval = type === 'verification_approval';
  const isCorrection = type === 'verification_correction';
  const verificationStatus = isApproval ? 'approved' : isCorrection ? 'needs_correction' : 'rejected';
  const subject = isApproval
    ? `Product Verified - ${productNameStr}`
    : isCorrection
      ? `Correction requested - ${productNameStr}`
      : `Product Verification Rejected - ${productNameStr}`;
  const body = isApproval
    ? `Congratulations! Your product "${productNameStr}" has been verified and is now active on ZahniBoerse. Product ID: ${productIdStr}`
    : isCorrection
      ? `Please update your product "${productNameStr}" before it can be approved. Product ID: ${productIdStr}.${reasonStr ? ` Requested correction: ${reasonStr}` : ''}`
      : `Unfortunately, your product "${productNameStr}" did not pass verification. Product ID: ${productIdStr}.${reasonStr ? ` Reason: ${reasonStr}` : ''}`;

  await pb.collection('emails').create({
    recipient: sellerEmailStr,
    type,
    sender: 'info@zahniboerse.com',
    subject,
    body,
    metadata: {
      seller_id: sellerIdStr,
      product_id: productIdStr,
      product_name: productNameStr,
      verification_status: verificationStatus,
      reason: reasonStr,
    },
    status: 'pending',
  });
};

const OPTIONAL_COLLECTION_MISSING_STATUS = 404;
const PRODUCT_COLLECTION_BY_TYPE = {
  marketplace: 'products',
  shop: 'shop_products',
};

const escapeFilterValue = (value) => String(value ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"');

const SHOP_FILTER_TYPES = new Set(['dropdown', 'checkbox_group', 'price_range']);
const SHOP_FILTER_SCOPES = new Set(['shop', 'marketplace']);
const SHOP_FILTER_OPERATORS = new Set(['equals', 'contains', 'range']);
const SHOP_FILTER_PRODUCT_TYPES = new Set(['Article', 'Set', 'Consumable']);

const safeJsonObject = (value, fallback = {}) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const normalizeString = (value) => String(value ?? '').trim();

const normalizeKey = (value) => normalizeString(value).toLowerCase();

const normalizeStringArray = (value) => {
  if (Array.isArray(value)) return value.map(normalizeString).filter(Boolean);
  const normalized = normalizeString(value);
  return normalized ? [normalized] : [];
};

const parseBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  return Boolean(value);
};

const parseSortOrder = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const serializeAdminShopFilterOption = (record) => ({
  id: record.id,
  filterKey: record.filter_key || '',
  value: record.value || '',
  label: record.label || record.value || '',
  labelDe: record.label_de || record.label || record.value || '',
  labelEn: record.label_en || record.label || record.value || '',
  active: record.active !== false,
  sortOrder: Number(record.sort_order || 0),
  metadata: safeJsonObject(record.metadata),
  created: record.created,
  updated: record.updated,
});

const serializeAdminShopFilter = (record, options = []) => ({
  id: record.id,
  key: record.key || '',
  label: record.label || record.key || '',
  labelDe: record.label_de || record.label || record.key || '',
  labelEn: record.label_en || record.label || record.key || '',
  type: record.type || 'checkbox_group',
  scope: Array.isArray(record.scope) ? record.scope : record.scope ? [record.scope] : [],
  parameterKey: record.parameter_key || record.key || '',
  productField: record.product_field || record.key || '',
  operator: record.operator || 'equals',
  appliesToProductType: Array.isArray(record.applies_to_product_type)
    ? record.applies_to_product_type
    : record.applies_to_product_type
      ? [record.applies_to_product_type]
      : [],
  active: record.active !== false,
  sortOrder: Number(record.sort_order || 0),
  metadata: safeJsonObject(record.metadata),
  options,
  created: record.created,
  updated: record.updated,
});

const validateShopFilterPayload = (payload, { existingFilter = null } = {}) => {
  const key = existingFilter ? existingFilter.key : normalizeKey(payload.key);
  const label = normalizeString(payload.label || payload.labelEn || payload.labelDe || existingFilter?.label);
  const labelDe = normalizeString(payload.labelDe ?? payload.label_de ?? existingFilter?.label_de ?? label);
  const labelEn = normalizeString(payload.labelEn ?? payload.label_en ?? existingFilter?.label_en ?? label);
  const type = normalizeString(payload.type || existingFilter?.type || 'checkbox_group');
  const scope = normalizeStringArray(payload.scope ?? existingFilter?.scope).filter((item) => SHOP_FILTER_SCOPES.has(item));
  const parameterKey = normalizeString(payload.parameterKey ?? payload.parameter_key ?? existingFilter?.parameter_key ?? key);
  const productField = normalizeString(payload.productField ?? payload.product_field ?? existingFilter?.product_field ?? key);
  const operatorFallback = type === 'price_range' ? 'range' : 'equals';
  const operator = normalizeString(payload.operator || existingFilter?.operator || operatorFallback);
  const appliesToProductType = normalizeStringArray(payload.appliesToProductType ?? payload.applies_to_product_type ?? existingFilter?.applies_to_product_type)
    .filter((item) => SHOP_FILTER_PRODUCT_TYPES.has(item));
  const metadata = safeJsonObject(payload.metadata ?? existingFilter?.metadata);

  if (!existingFilter && !/^[a-z0-9_]{1,80}$/.test(key)) {
    return { error: 'Filter key must use lowercase letters, numbers, and underscores only.' };
  }

  if (!label) {
    return { error: 'Filter label is required.' };
  }

  if (!SHOP_FILTER_TYPES.has(type)) {
    return { error: 'Invalid filter type.' };
  }

  if (scope.length === 0) {
    return { error: 'At least one filter scope is required.' };
  }

  if (!/^[A-Za-z0-9_]{1,80}$/.test(parameterKey)) {
    return { error: 'Parameter key must use letters, numbers, and underscores only.' };
  }

  if (!/^[A-Za-z0-9_]{1,80}$/.test(productField)) {
    return { error: 'Product field must use letters, numbers, and underscores only.' };
  }

  if (!SHOP_FILTER_OPERATORS.has(operator)) {
    return { error: 'Invalid filter operator.' };
  }

  return {
    data: {
      key,
      label,
      label_de: labelDe,
      label_en: labelEn,
      type,
      scope,
      parameter_key: parameterKey,
      product_field: productField,
      operator,
      applies_to_product_type: appliesToProductType,
      active: parseBoolean(payload.active, existingFilter ? existingFilter.active !== false : true),
      sort_order: parseSortOrder(payload.sortOrder ?? payload.sort_order, existingFilter?.sort_order || 0),
      metadata,
    },
  };
};

const validateShopFilterOptionPayload = (payload, { existingOption = null, filterKey = null } = {}) => {
  const resolvedFilterKey = normalizeKey(filterKey || payload.filterKey || payload.filter_key || existingOption?.filter_key);
  const value = normalizeString(payload.value ?? existingOption?.value);
  const label = normalizeString(payload.label || payload.labelEn || payload.labelDe || existingOption?.label || value);
  const labelDe = normalizeString(payload.labelDe ?? payload.label_de ?? label);
  const labelEn = normalizeString(payload.labelEn ?? payload.label_en ?? label);

  if (!/^[a-z0-9_]{1,80}$/.test(resolvedFilterKey)) {
    return { error: 'A valid filter key is required for this option.' };
  }

  if (!value) {
    return { error: 'Option value is required.' };
  }

  if (!label) {
    return { error: 'Option label is required.' };
  }

  return {
    data: {
      filter_key: resolvedFilterKey,
      value,
      label,
      label_de: labelDe,
      label_en: labelEn,
      active: parseBoolean(payload.active, existingOption ? existingOption.active !== false : true),
      sort_order: parseSortOrder(payload.sortOrder ?? payload.sort_order, existingOption?.sort_order || 0),
      metadata: safeJsonObject(payload.metadata),
    },
  };
};

const getAdminShopFilters = async () => {
  const [filterRecords, optionRecords] = await Promise.all([
    pb.collection('shop_filters').getFullList({
      sort: 'sort_order,label',
      $autoCancel: false,
    }),
    pb.collection('shop_filter_options').getFullList({
      sort: 'filter_key,sort_order,label',
      $autoCancel: false,
    }),
  ]);

  const optionsByFilterKey = new Map();

  for (const optionRecord of optionRecords) {
    const option = serializeAdminShopFilterOption(optionRecord);
    const current = optionsByFilterKey.get(option.filterKey) || [];
    current.push(option);
    optionsByFilterKey.set(option.filterKey, current);
  }

  return filterRecords.map((filterRecord) => serializeAdminShopFilter(
    filterRecord,
    optionsByFilterKey.get(filterRecord.key) || [],
  ));
};

const parseParcelNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
};

const parseAddress = (rawAddress) => {
  if (!rawAddress) return {};
  if (typeof rawAddress === 'object') return rawAddress;

  try {
    return JSON.parse(rawAddress);
  } catch {
    return {};
  }
};

const sanitizeUserSummary = (user) => {
  if (!user) return null;

  return {
    id: user.id,
    name: user.name || '',
    email: user.email || '',
    seller_username: user.seller_username || '',
    university: user.university || '',
  };
};

const sanitizeProductSummary = (product) => {
  if (!product) return null;

  return {
    id: product.id,
    collectionId: product.collectionId,
    collectionName: product.collectionName,
    name: product.name || '',
    price: product.price || 0,
    image: product.image || '',
    images: Array.isArray(product.images) ? product.images : product.images ? [product.images] : [],
    condition: product.condition || '',
    product_type: product.product_type || '',
    fachbereich: product.fachbereich || [],
    brand: product.brand || '',
    location: product.location || '',
    shipping_type: product.shipping_type || 'dhl_parcel',
    filter_values: safeJsonObject(product.filter_values),
    validation_requested_at: product.validation_requested_at || '',
    validation_reviewed_at: product.validation_reviewed_at || '',
    validation_admin_id: product.validation_admin_id || '',
    validation_notes: product.validation_notes || '',
    seller_id: product.seller_id || '',
    seller_username: product.seller_username || '',
    weight_g: product.weight_g || 0,
  };
};

const sanitizeAdminOrderRecord = (order) => {
  if (!order) return null;

  const {
    dhl_label_pdf,
    dhl_tracking_raw,
    ...safeOrder
  } = order;

  return safeOrder;
};

const sanitizeReturnRequest = (returnRequest) => {
  if (!returnRequest) return null;

  return {
    id: returnRequest.id,
    order_id: returnRequest.order_id,
    status: returnRequest.status || 'Pending',
    reason: returnRequest.reason || '',
    details: returnRequest.details || '',
    admin_notes: returnRequest.admin_notes || '',
    product_type: returnRequest.product_type || '',
    return_type: returnRequest.return_type || '',
    claim_window_expires_at: returnRequest.claim_window_expires_at || '',
    tracking_number: returnRequest.dhl_tracking_number || '',
    has_label: !!returnRequest.dhl_label_pdf,
    label_generated_at: returnRequest.label_generated_at || '',
    refund_amount: returnRequest.refund_amount || 0,
    stripe_refund_id: returnRequest.stripe_refund_id || '',
    refund_status: returnRequest.refund_status || '',
    refund_processed_at: returnRequest.refund_processed_at || '',
    refund_failure: returnRequest.refund_failure || '',
    created: returnRequest.created,
    updated: returnRequest.updated,
  };
};

const fetchOrderProduct = async (order) => {
  if (!order?.product_id) return null;

  const productId = String(order.product_id);
  const preferredCollection = PRODUCT_COLLECTION_BY_TYPE[order.product_type] || 'products';
  const fallbackCollection = preferredCollection === 'products' ? 'shop_products' : 'products';

  try {
    return await pb.collection(preferredCollection).getOne(productId);
  } catch (preferredError) {
    logger.warn(`[ADMIN] Product lookup failed in ${preferredCollection} - Product: ${productId}, Error: ${preferredError.message}`);
  }

  try {
    return await pb.collection(fallbackCollection).getOne(productId);
  } catch (fallbackError) {
    logger.warn(`[ADMIN] Product lookup failed in ${fallbackCollection} - Product: ${productId}, Error: ${fallbackError.message}`);
    return null;
  }
};

const fetchLatestReturnRequest = async (orderId) => {
  const items = await pb.collection('returns').getFullList({
    filter: `order_id="${escapeFilterValue(orderId)}"`,
    sort: '-created',
  }).catch(() => []);

  return items[0] || null;
};

const fetchOrderStatusEvents = async (orderId) => {
  const items = await pb.collection('order_status_events').getFullList({
    filter: `order_id="${escapeFilterValue(orderId)}"`,
    sort: '-created',
    $autoCancel: false,
  }).catch((error) => {
    if (!isMissingCollectionError(error)) {
      logger.warn(`[ADMIN] Failed to load order status events - Order: ${orderId}, Error: ${error.message}`);
    }
    return [];
  });

  return items;
};

const sanitizeOrderStatusEvent = (event) => ({
  id: event.id,
  order_id: event.order_id || '',
  admin_id: event.admin_id || '',
  event_type: event.event_type || '',
  from_status: event.from_status || '',
  to_status: event.to_status || '',
  note: event.note || '',
  metadata: safeJsonObject(event.metadata),
  created: event.created,
  updated: event.updated,
});

const logOrderStatusEvent = async ({ orderId, adminId, eventType, fromStatus, toStatus, note = '', metadata = {} }) => {
  if (!orderId || !eventType) return null;

  return pb.collection('order_status_events').create({
    order_id: String(orderId),
    admin_id: adminId ? String(adminId) : '',
    event_type: String(eventType),
    from_status: fromStatus ? String(fromStatus) : '',
    to_status: toStatus ? String(toStatus) : '',
    note: note ? String(note) : '',
    metadata: safeJsonObject(metadata),
  }, { $autoCancel: false }).catch((error) => {
    if (!isMissingCollectionError(error)) {
      logger.warn(`[ADMIN] Failed to log order status event - Order: ${orderId}, Event: ${eventType}, Error: ${error.message}`);
    }
    return null;
  });
};

const buildAdminRefundIdempotencyKey = (order, amountCents) => [
  'admin-order-refund',
  order?.id || '',
  order?.payment_intent_id || '',
  amountCents,
].filter((part) => part !== '').join(':');

const createStripeRefundForOrder = async ({ order, amount, reason, adminId }) => {
  const paymentIntentId = String(order?.payment_intent_id || '').trim();
  if (!paymentIntentId) {
    const error = new Error('Cannot refund an order without a Stripe payment intent');
    error.status = 400;
    throw error;
  }

  const amountCents = Math.round(Number(amount || 0) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    const error = new Error('Refund amount must be greater than zero');
    error.status = 400;
    throw error;
  }

  const existingRefundId = String(order?.stripe_refund_id || '').trim();
  if (existingRefundId) {
    const existingRefund = await stripe.refunds.retrieve(existingRefundId).catch(() => null);
    if (existingRefund && !['failed', 'canceled'].includes(String(existingRefund.status || ''))) {
      return existingRefund;
    }
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const paidAmountCents = Number(paymentIntent.amount_received || paymentIntent.amount || 0);
  const refundList = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
  const alreadyRefundedCents = (refundList.data || [])
    .filter((refund) => !['failed', 'canceled'].includes(String(refund.status || '')))
    .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
  const remainingRefundableCents = Math.max(0, paidAmountCents - alreadyRefundedCents);

  if (amountCents > remainingRefundableCents) {
    const error = new Error(`Refund amount exceeds the remaining refundable payment amount (€${(remainingRefundableCents / 100).toFixed(2)})`);
    error.status = 400;
    throw error;
  }

  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: amountCents,
    reason: 'requested_by_customer',
    metadata: {
      order_id: order.id,
      requested_by_admin: adminId || '',
      reason: reason || '',
      product_type: order.product_type || '',
    },
  }, {
    idempotencyKey: buildAdminRefundIdempotencyKey(order, amountCents),
  });
};

const updateOrderStatusWithAudit = async ({
  existingOrder,
  status,
  adminId,
  eventType = 'status_changed',
  note = '',
  updateData = {},
  metadata = {},
}) => {
  const orderId = String(existingOrder.id).trim();
  const fromStatus = existingOrder.status || 'pending';

  if (!canTransitionOrderStatus(fromStatus, status)) {
    const error = new Error(`Invalid order status transition from ${fromStatus} to ${status}`);
    error.status = 400;
    error.currentStatus = fromStatus;
    error.requestedStatus = status;
    throw error;
  }

  let order = await pb.collection('orders').update(orderId, {
    ...updateData,
    status,
  }, { $autoCancel: false });

  await logOrderStatusEvent({
    orderId,
    adminId,
    eventType,
    fromStatus,
    toStatus: status,
    note,
    metadata,
  });

  if (status === 'paid_out') {
    const earnings = await pb.collection('seller_earnings').getFullList({
      filter: `order_id="${escapeFilterValue(orderId)}"`,
      $autoCancel: false,
    }).catch(() => []);

    await Promise.all(
      earnings
        .filter((earning) => earning.status !== 'paid_out')
        .map((earning) => pb.collection('seller_earnings').update(earning.id, {
          status: 'paid_out',
          released_at: new Date().toISOString(),
          payout_release_blocked_reason: '',
        })),
    );
    await syncSellerBalancesForOrder(orderId);
  }

  if (['cancelled', 'refunded'].includes(status)) {
    const earnings = await pb.collection('seller_earnings').getFullList({
      filter: `order_id="${escapeFilterValue(orderId)}"`,
      $autoCancel: false,
    }).catch(() => []);

    await Promise.all(
      earnings
        .filter((earning) => !['paid_out'].includes(String(earning.status || '').trim()))
        .map((earning) => pb.collection('seller_earnings').update(earning.id, {
          status: 'blocked',
          payout_release_blocked_reason: status,
        }, { $autoCancel: false })),
    );
    await syncSellerBalancesForOrder(orderId);
  }

  if (['dhl_delivered', 'delivered'].includes(status)) {
    order = await startPayoutWaitingPeriodForOrder({
      order,
      deliveredAt: updateData.delivered_at || updateData.dhl_delivered_at || new Date().toISOString(),
      source: status === 'dhl_delivered' ? 'admin_dhl_delivered_status' : 'admin_delivered_status',
      actorId: adminId,
    });
  }

  return order;
};

const toDateKey = (date) => date.toISOString().slice(0, 10);

const buildRecentDateBuckets = (days) => {
  const bucketCount = Math.min(Math.max(Number.parseInt(days, 10) || 7, 1), 31);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return [...Array(bucketCount)].map((_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (bucketCount - 1 - index));
    return {
      date: toDateKey(date),
      orders: 0,
      revenue: 0,
    };
  });
};

const buildAdminAnalyticsResponse = async ({ days = 7 } = {}) => {
  const [
    orders,
    users,
    marketplaceProducts,
    shopProducts,
    sellerEarnings,
  ] = await Promise.all([
    pb.collection('orders').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch(() => []),
    pb.collection('users').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch(() => []),
    pb.collection('products').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch(() => []),
    pb.collection('shop_products').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch((error) => {
      if (isMissingCollectionError(error)) {
        return [];
      }

      throw error;
    }),
    pb.collection('seller_earnings').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch((error) => {
      if (isMissingCollectionError(error)) {
        return [];
      }

      throw error;
    }),
  ]);

  const dateBuckets = buildRecentDateBuckets(days);
  const dateBucketByKey = new Map(dateBuckets.map((bucket) => [bucket.date, bucket]));

  for (const order of orders) {
    const created = order.created || order.created_at;
    if (!created) continue;

    const createdDate = new Date(created);
    if (Number.isNaN(createdDate.getTime())) continue;

    const dateKey = toDateKey(createdDate);
    const bucket = dateBucketByKey.get(dateKey);
    if (!bucket) continue;

    bucket.orders += 1;

    if (!shouldExcludeOrderFromRevenue(order.status)) {
      bucket.revenue += Number(order.total_amount) || 0;
    }
  }

  const usersById = new Map(users.map((user) => [user.id, user]));
  const productsBySeller = new Map();
  const ordersBySeller = new Map();
  const revenueBySeller = new Map();
  const earningsBySeller = new Map();

  for (const product of [...marketplaceProducts, ...shopProducts]) {
    const sellerId = String(product.seller_id || '').trim();
    if (!sellerId) continue;
    productsBySeller.set(sellerId, (productsBySeller.get(sellerId) || 0) + 1);
  }

  for (const order of orders) {
    const sellerId = String(order.seller_id || '').trim();
    if (!sellerId) continue;

    ordersBySeller.set(sellerId, (ordersBySeller.get(sellerId) || 0) + 1);

    if (!shouldExcludeOrderFromRevenue(order.status)) {
      revenueBySeller.set(sellerId, (revenueBySeller.get(sellerId) || 0) + (Number(order.total_amount) || 0));
    }
  }

  for (const earning of sellerEarnings) {
    const sellerId = String(earning.seller_id || '').trim();
    if (!sellerId) continue;
    earningsBySeller.set(sellerId, (earningsBySeller.get(sellerId) || 0) + (Number(earning.net_amount ?? earning.gross_amount) || 0));
  }

  const sellerIds = compactUnique([
    ...users.filter((user) => user.is_seller === true).map((user) => user.id),
    ...productsBySeller.keys(),
    ...ordersBySeller.keys(),
    ...earningsBySeller.keys(),
  ]);

  const topSellers = sellerIds
    .map((sellerId) => {
      const seller = usersById.get(sellerId);

      return {
        id: sellerId,
        name: seller?.name || '',
        email: seller?.email || '',
        seller_username: seller?.seller_username || '',
        product_count: productsBySeller.get(sellerId) || 0,
        order_count: ordersBySeller.get(sellerId) || 0,
        revenue_total: revenueBySeller.get(sellerId) || 0,
        earnings_total: earningsBySeller.get(sellerId) || 0,
      };
    })
    .sort((a, b) => (
      (b.revenue_total - a.revenue_total)
      || (b.order_count - a.order_count)
      || (b.product_count - a.product_count)
      || String(a.seller_username || a.name || a.id).localeCompare(String(b.seller_username || b.name || b.id))
    ))
    .slice(0, 5);

  return {
    orderVolume: dateBuckets,
    topSellers,
    summary: {
      totalOrders: orders.length,
      totalRevenue: orders.reduce((sum, order) => (
        shouldExcludeOrderFromRevenue(order.status) ? sum : sum + (Number(order.total_amount) || 0)
      ), 0),
      totalProducts: marketplaceProducts.length + shopProducts.length,
      totalSellers: sellerIds.length,
    },
    fetchedAt: new Date().toISOString(),
  };
};

const buildAdminOrderResponse = async (order) => {
  const [buyer, seller, product, latestReturnRequest, statusEvents, sellerEarnings] = await Promise.all([
    order.buyer_id ? pb.collection('users').getOne(String(order.buyer_id)).catch(() => null) : Promise.resolve(null),
    order.seller_id ? pb.collection('users').getOne(String(order.seller_id)).catch(() => null) : Promise.resolve(null),
    fetchOrderProduct(order),
    fetchLatestReturnRequest(order.id),
    fetchOrderStatusEvents(order.id),
    pb.collection('seller_earnings').getFullList({
      filter: `order_id="${escapeFilterValue(order.id)}"`,
      sort: '-created',
      $autoCancel: false,
    }).catch(() => []),
  ]);

  return {
    ...sanitizeAdminOrderRecord(order),
    buyer: sanitizeUserSummary(buyer),
    seller: sanitizeUserSummary(seller),
    product: sanitizeProductSummary(product),
    has_label: !!(order.dhl_label_pdf || order.dhl_label_url),
    tracking_number: order.tracking_number || order.dhl_tracking_number || '',
    shipping_address_parsed: parseAddress(order.shipping_address),
    return_request: sanitizeReturnRequest(latestReturnRequest),
    status_events: statusEvents.map(sanitizeOrderStatusEvent),
    seller_earnings: sellerEarnings,
  };
};

const compactUnique = (values) =>
  [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];

const chunkValues = (values, size = 25) => {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
};

const buildAnyEqualsFilter = (fields, values) => {
  const fieldList = Array.isArray(fields) ? fields : [fields];
  const valueList = compactUnique(Array.isArray(values) ? values : [values]);

  if (fieldList.length === 0 || valueList.length === 0) {
    return '';
  }

  return fieldList
    .flatMap((field) => valueList.map((value) => `${field}="${escapeFilterValue(value)}"`))
    .join(' || ');
};

const isMissingCollectionError = (error) =>
  error?.status === OPTIONAL_COLLECTION_MISSING_STATUS
  || error?.response?.code === OPTIONAL_COLLECTION_MISSING_STATUS
  || /collection not found|missing collection|not found/i.test(error?.message || '');

const getRecordsByFields = async (collectionName, fields, values, { optional = false } = {}) => {
  const valueList = compactUnique(Array.isArray(values) ? values : [values]);

  if (valueList.length === 0) {
    return [];
  }

  try {
    const recordGroups = [];

    for (const valueChunk of chunkValues(valueList)) {
      const filter = buildAnyEqualsFilter(fields, valueChunk);
      recordGroups.push(await pb.collection(collectionName).getFullList({
        filter,
        $autoCancel: false,
      }));
    }

    return dedupeRecords(...recordGroups);
  } catch (error) {
    if (optional && isMissingCollectionError(error)) {
      return [];
    }

    throw error;
  }
};

const dedupeRecords = (...recordGroups) => {
  const recordsById = new Map();

  for (const records of recordGroups) {
    for (const record of records || []) {
      if (record?.id) {
        recordsById.set(record.id, record);
      }
    }
  }

  return [...recordsById.values()];
};

const deleteRecords = async (collectionName, records, summary) => {
  for (const record of records) {
    try {
      await pb.collection(collectionName).delete(record.id, { $autoCancel: false });
      summary[collectionName] = (summary[collectionName] || 0) + 1;
    } catch (error) {
      if (!isMissingCollectionError(error)) {
        throw error;
      }
    }
  }
};

const metadataContainsAny = (metadata, values) => {
  const valueSet = new Set(compactUnique(values));

  if (valueSet.size === 0 || !metadata || typeof metadata !== 'object') {
    return false;
  }

  return Object.values(metadata).some((value) => {
    if (Array.isArray(value)) {
      return value.some((item) => valueSet.has(String(item || '').trim()));
    }

    return valueSet.has(String(value || '').trim());
  });
};

const getAssociatedEmails = async ({ user, productIds, orderIds }) => {
  let emailRecords = [];

  try {
    emailRecords = await pb.collection('emails').getFullList({ $autoCancel: false });
  } catch (error) {
    if (isMissingCollectionError(error)) {
      return [];
    }

    throw error;
  }

  const associatedValues = compactUnique([
    user.id,
    user.email,
    ...productIds,
    ...orderIds,
  ]);
  const userEmail = String(user.email || '').trim().toLowerCase();

  return emailRecords.filter((emailRecord) => {
    const recipient = String(emailRecord.recipient || '').trim().toLowerCase();

    return (userEmail && recipient === userEmail)
      || metadataContainsAny(emailRecord.metadata, associatedValues);
  });
};

const hardDeleteUser = async (userId, deletedByAdminId) => {
  const id = String(userId || '').trim();

  if (!id) {
    const error = new Error('User ID is required');
    error.status = 400;
    throw error;
  }

  const user = await pb.collection('users').getOne(id, { $autoCancel: false });
  const products = await getRecordsByFields('products', 'seller_id', id);
  const productIds = products.map((product) => product.id);
  const directOrders = await getRecordsByFields('orders', ['buyer_id', 'seller_id'], id);
  const productOrders = await getRecordsByFields('orders', 'product_id', productIds);
  const orders = dedupeRecords(directOrders, productOrders);
  const orderIds = orders.map((order) => order.id);
  const summary = {};

  const [
    cartItems,
    favorites,
    shippingInfo,
    productVerifications,
    returns,
    sellerEarnings,
    sellerBalances,
    sellerPayoutRequests,
    sellerPayoutConflicts,
    newsletterSignups,
    emails,
  ] = await Promise.all([
    getRecordsByFields('cart_items', ['user_id', 'product_id'], [id, ...productIds]),
    getRecordsByFields('favorites', ['user_id', 'product_id'], [id, ...productIds]),
    getRecordsByFields('shipping_info', 'user_id', id),
    getRecordsByFields('product_verifications', ['seller_id', 'product_id'], [id, ...productIds]),
    getRecordsByFields('returns', ['buyer_id', 'seller_id', 'product_id', 'order_id'], [id, ...productIds, ...orderIds]),
    getRecordsByFields('seller_earnings', ['seller_id', 'order_id'], [id, ...orderIds]),
    getRecordsByFields('seller_balances', 'seller_id', id, { optional: true }),
    getRecordsByFields('seller_payout_requests', 'seller_id', id, { optional: true }),
    getRecordsByFields('seller_payout_conflicts', ['seller_id', 'order_id'], [id, ...orderIds], { optional: true }),
    getRecordsByFields('newsletter_signups', 'email', user.email),
    getAssociatedEmails({ user, productIds, orderIds }),
  ]);

  await deleteRecords('cart_items', cartItems, summary);
  await deleteRecords('favorites', favorites, summary);
  await deleteRecords('shipping_info', shippingInfo, summary);
  await deleteRecords('product_verifications', productVerifications, summary);
  await deleteRecords('returns', returns, summary);
  await deleteRecords('seller_earnings', sellerEarnings, summary);
  await deleteRecords('seller_balances', sellerBalances, summary);
  await deleteRecords('seller_payout_requests', sellerPayoutRequests, summary);
  await deleteRecords('seller_payout_conflicts', sellerPayoutConflicts, summary);
  await deleteRecords('newsletter_signups', newsletterSignups, summary);
  await deleteRecords('emails', emails, summary);
  await deleteRecords('orders', orders, summary);
  await deleteRecords('products', products, summary);
  await pb.collection('users').delete(id, { $autoCancel: false });
  summary.users = (summary.users || 0) + 1;

  logger.info(`[ADMIN] User hard deleted: ${id} by admin ${deletedByAdminId}. Summary: ${JSON.stringify(summary)}`);

  return {
    user,
    summary,
  };
};

// GET /admin/dashboard - Aggregate admin overview data for the dashboard page
router.get('/dashboard', async (req, res) => {
  logger.info(`[ADMIN] Dashboard overview request - Admin: ${req.auth.id}`);

  const [
    orders,
    marketplaceProducts,
    shopProducts,
    users,
    returns,
    sellerEarnings,
    settings,
  ] = await Promise.all([
    pb.collection('orders').getFullList({
      sort: '-created',
      expand: 'buyer_id,seller_id,product_id',
      $autoCancel: false,
    }),
    pb.collection('products').getFullList({
      sort: '-created',
      expand: 'seller_id',
      $autoCancel: false,
    }),
    pb.collection('shop_products').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch((error) => {
      if (isMissingCollectionError(error)) {
        return [];
      }

      throw error;
    }),
    pb.collection('users').getFullList({
      sort: '-created',
      $autoCancel: false,
    }),
    pb.collection('returns').getFullList({
      sort: '-created',
      expand: 'order_id,buyer_id',
      $autoCancel: false,
    }).catch((error) => {
      if (isMissingCollectionError(error)) {
        return [];
      }

      throw error;
    }),
    pb.collection('seller_earnings').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch((error) => {
      if (isMissingCollectionError(error)) {
        return [];
      }

      throw error;
    }),
    pb.collection('admin_settings').getFirstListItem('', {
      $autoCancel: false,
    }).catch((error) => {
      if (isMissingCollectionError(error) || error?.status === 404) {
        return null;
      }

      throw error;
    }),
  ]);

  const enrichedOrders = await Promise.all(orders.map((order) => buildAdminOrderResponse(order)));
  const products = [
    ...marketplaceProducts.map((product) => formatAdminProduct(product, 'marketplace')),
    ...shopProducts.map((product) => formatAdminProduct(product, 'shop')),
  ].sort((a, b) => String(b.created || '').localeCompare(String(a.created || '')));

  res.json({
    orders: enrichedOrders,
    products,
    users,
    returns,
    sellerEarnings,
    settings: {
      ...(settings || {}),
      ...normalizePlatformSettings(settings || {}),
    },
    fetchedAt: new Date().toISOString(),
  });
});

// GET /admin/analytics - Dedicated analytics payload for the admin analytics tab
router.get('/analytics', async (req, res) => {
  const days = req.query.days || 7;

  logger.info(`[ADMIN] Analytics request - Admin: ${req.auth.id}, Days: ${days}`);

  const analytics = await buildAdminAnalyticsResponse({ days });

  res.json(analytics);
});

// GET /admin/products - List all products with filters
router.get('/products', async (req, res) => {
  const { search, category, status, type } = req.query;

  logger.info(`[ADMIN] List products request - Search: ${search}, Category: ${category}, Status: ${status}, Type: ${type}`);

  if (!req.auth || !req.auth.id) {
    const error = new Error('Unauthorized: Authentication required');
    error.status = 401;
    throw error;
  }

  if (!req.auth.is_admin) {
    logger.warn(`[ADMIN] Admin access denied for user: ${req.auth.id}`);
    const error = new Error('Admin access required');
    error.status = 403;
    throw error;
  }

  const marketplaceFilter = buildProductFilter(search, category, status, type);
  const shouldIncludeShopProducts = !type || type === 'shop';
  const shopFilter = shouldIncludeShopProducts ? buildShopProductFilter(search, category) : null;

  const [marketplaceProducts, shopProducts] = await Promise.all([
    pb.collection('products').getFullList({
      filter: marketplaceFilter || undefined,
      sort: '-created',
      expand: 'seller_id',
      $autoCancel: false,
    }),
    shouldIncludeShopProducts
      ? pb.collection('shop_products').getFullList({
          filter: shopFilter || undefined,
          sort: '-created',
          $autoCancel: false,
        }).catch((error) => {
          if (isMissingCollectionError(error)) {
            return [];
          }

          throw error;
        })
      : Promise.resolve([]),
  ]);

  const formattedProducts = [
    ...marketplaceProducts.map((product) => formatAdminProduct(product, 'marketplace')),
    ...shopProducts.map((product) => formatAdminProduct(product, 'shop')),
  ].sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))).slice(0, 500);

  logger.info(`[ADMIN] Fetched ${formattedProducts.length} products`);
  res.json(formattedProducts);
});

// GET /admin/products/:id - Get single product details
router.get('/products/:id', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Product ID is required' });
  }

  logger.info(`[ADMIN] Get product request - ID: ${id}`);

  const resolved = await resolveAdminProduct(id, req.query.source);

  if (!resolved) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const { product, source } = resolved;
  let seller = null;

  if (product.seller_id) {
    seller = await pb.collection('users').getOne(product.seller_id, { $autoCancel: false }).catch(() => null);
  }

  logger.info(`[ADMIN] Product retrieved - ID: ${id}`);
  res.json(formatAdminProduct(product, source, seller));
});

// POST /admin/products - Create new product
router.post('/products', async (req, res) => {
  const {
    name,
    description,
    price,
    image,
    images,
    category,
    condition,
    fachbereich,
    stock_quantity,
    weight_g,
    length_mm,
    width_mm,
    height_mm,
    brand,
    location,
    shipping_type,
    filter_values,
  } = req.body;
  const parcelWeight = parseParcelNumber(weight_g);

  if (!name || price === undefined || !(category || fachbereich) || !condition || !parcelWeight) {
    return res.status(400).json({
      error: 'Missing required fields: name, price, category/fachbereich, condition, weight_g',
    });
  }

  logger.info(`[ADMIN] Create product request - Name: ${name}`);

  const formData = {
    name,
    description: description || '',
    price: parseFloat(price),
    image: image || null,
    images: Array.isArray(images) ? images : images ? [images] : [],
    condition,
    fachbereich: fachbereich || category,
    stock_quantity: parseParcelNumber(stock_quantity) ?? 1,
    weight_g: parcelWeight,
    brand: normalizeString(brand),
    location: normalizeString(location),
    shipping_type: shipping_type || 'dhl_parcel',
    filter_values: safeJsonObject(filter_values),
    created_at: new Date().toISOString(),
  };

  const parcelDimensions = {
    length_mm: parseParcelNumber(length_mm),
    width_mm: parseParcelNumber(width_mm),
    height_mm: parseParcelNumber(height_mm),
  };

  for (const [field, value] of Object.entries(parcelDimensions)) {
    if (value !== undefined) formData[field] = value;
  }

  const product = await pb.collection('shop_products').create(formData);

  logger.info(`[ADMIN] Official shop product created - ID: ${product.id}`);
  res.json(formatAdminProduct(product, 'shop'));
});

// PUT /admin/products/:id - Update product
router.put('/products/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name,
    description,
    price,
    image,
    images,
    category,
    condition,
    stock_quantity,
    fachbereich,
    status,
    weight_g,
    length_mm,
    width_mm,
    height_mm,
    brand,
    location,
    shipping_type,
    filter_values,
  } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Product ID is required' });
  }

  logger.info(`[ADMIN] Update product request - ID: ${id}`);

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (price !== undefined) updateData.price = parseFloat(price);
  if (image !== undefined) updateData.image = image;
  if (images !== undefined) updateData.images = Array.isArray(images) ? images : images ? [images] : [];
  if (category !== undefined) updateData.category = category;
  if (condition !== undefined) updateData.condition = condition;
  if (brand !== undefined) updateData.brand = normalizeString(brand);
  if (location !== undefined) updateData.location = normalizeString(location);
  if (shipping_type !== undefined) updateData.shipping_type = shipping_type || 'dhl_parcel';
  if (filter_values !== undefined) updateData.filter_values = safeJsonObject(filter_values);
  const stockQuantity = parseParcelNumber(stock_quantity);
  const parcelWeight = parseParcelNumber(weight_g);
  const parcelLength = parseParcelNumber(length_mm);
  const parcelWidth = parseParcelNumber(width_mm);
  const parcelHeight = parseParcelNumber(height_mm);

  if (stock_quantity !== undefined && stockQuantity !== undefined) updateData.stock_quantity = stockQuantity;
  if (weight_g !== undefined && parcelWeight !== undefined) updateData.weight_g = parcelWeight;
  if (length_mm !== undefined && parcelLength !== undefined) updateData.length_mm = parcelLength;
  if (width_mm !== undefined && parcelWidth !== undefined) updateData.width_mm = parcelWidth;
  if (height_mm !== undefined && parcelHeight !== undefined) updateData.height_mm = parcelHeight;
  if (fachbereich !== undefined) updateData.fachbereich = fachbereich;
  if (status !== undefined) updateData.status = status;

  const resolved = await resolveAdminProduct(id, req.query.source || req.body.source);

  if (!resolved) {
    return res.status(404).json({ error: 'Product not found' });
  }

  if (resolved.source === 'shop') {
    delete updateData.category;
    delete updateData.status;
    delete updateData.product_type;
  }

  const product = await pb.collection(resolved.collectionName).update(id, updateData);

  logger.info(`[ADMIN] Product updated - ID: ${id}`);
  res.json(formatAdminProduct(product, resolved.source));
});

// DELETE /admin/products/:id - Delete product
router.delete('/products/:id', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Product ID is required' });
  }

  logger.info(`[ADMIN] Delete product request - ID: ${id}`);

  const resolved = await resolveAdminProduct(id, req.query.source);

  if (!resolved) {
    return res.status(404).json({ error: 'Product not found' });
  }

  await pb.collection(resolved.collectionName).delete(id);

  logger.info(`[ADMIN] Product deleted - ID: ${id}`);
  res.json({ success: true, message: `Product ${id} deleted successfully` });
});

// PUT /admin/products/:id/stock - Update product stock
router.put('/products/:id/stock', async (req, res) => {
  const { id } = req.params;
  const { quantity } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Product ID is required' });
  }

  if (quantity === undefined || quantity === null) {
    return res.status(400).json({ error: 'Quantity is required' });
  }

  logger.info(`[ADMIN] Update stock request - ID: ${id}, Quantity: ${quantity}`);

  const resolved = await resolveAdminProduct(id, req.query.source || req.body.source);

  if (!resolved) {
    return res.status(404).json({ error: 'Product not found' });
  }

  if (resolved.source === 'shop') {
    logger.info(`[ADMIN] Stock update skipped for official shop product without stock field - ID: ${id}`);
    return res.json(formatAdminProduct(resolved.product, resolved.source));
  }

  const product = await pb.collection('products').update(id, { stock_quantity: parseInt(quantity, 10) });

  logger.info(`[ADMIN] Product stock updated - ID: ${id}, Quantity: ${quantity}`);
  res.json(formatAdminProduct(product, resolved.source));
});

// Backward compatible stock update route for older clients.
router.post('/products/:id/stock', async (req, res) => {
  req.method = 'PUT';
  return router.handle(req, res);
});

router.put('/products/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowedStatuses = ['draft', 'active', 'pending_verification', 'rejected', 'sold'];

  if (!id) {
    return res.status(400).json({ error: 'Product ID is required' });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}`,
    });
  }

  const resolved = await resolveAdminProduct(id, req.query.source || req.body.source);

  if (!resolved) {
    return res.status(404).json({ error: 'Product not found' });
  }

  if (resolved.source === 'shop') {
    if (status !== 'active') {
      return res.status(400).json({ error: 'Official shop products do not support marketplace status changes' });
    }

    return res.json(formatAdminProduct(resolved.product, resolved.source));
  }

  const product = await pb.collection('products').update(id, { status });

  logger.info(`[ADMIN] Product status updated - ID: ${id}, Status: ${status}`);
  res.json(formatAdminProduct(product, resolved.source));
});

// Soft Delete Product
router.put('/products/:id/delete', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'Product ID is required' });
  }

  let product;

  try {
    product = await pb.collection('shop_products').update(id, { is_deleted: true });
  } catch (error) {
    product = await pb.collection('products').update(id, { is_deleted: true });
  }

  logger.info(`[ADMIN] Product soft deleted: ${id} by admin ${req.auth.id}`);
  res.json({ success: true, message: `Product ${id} has been deleted` });
});

// ============================================================================
// PRODUCT VERIFICATION ENDPOINTS
// ============================================================================

// GET /admin/verifications - List products awaiting admin verification
router.get('/verifications', async (req, res) => {
  logger.info(`[ADMIN] List pending verifications request - Admin: ${req.auth.id}`);

  const products = await pb.collection('products').getList(1, 100, {
    filter: 'status="pending_verification" || verification_status="pending"',
    sort: '-created',
    expand: 'seller_id',
    $autoCancel: false,
  });

  const sellerIds = [...new Set(products.items.map((product) => product.seller_id).filter(Boolean))];
  const sellersById = {};

  if (sellerIds.length > 0) {
    const sellerFilter = sellerIds.map((sellerId) => `id="${String(sellerId)}"`).join(' || ');
    const sellers = await pb.collection('users').getFullList({
      filter: sellerFilter,
      $autoCancel: false,
    });

    for (const seller of sellers) {
      sellersById[seller.id] = {
        id: seller.id,
        name: seller.name || '',
        email: seller.email || '',
        seller_username: seller.seller_username || '',
      };
    }
  }

  const items = products.items.map((product) => {
    const seller = sellersById[product.seller_id] || {};
    return formatAdminProduct(product, 'marketplace', seller);
  });

  logger.info(`[ADMIN] Fetched ${items.length} products awaiting verification`);
  res.json({
    items,
    total: products.totalItems,
    page: products.page,
    perPage: products.perPage,
    totalPages: products.totalPages,
  });
});

// POST /admin/approve-product
router.post('/approve-product', async (req, res) => {
  const { productId, notes } = req.body;
  const adminId = req.auth.id;

  logger.info(`[ADMIN] Approve product request - Product: ${productId}, Admin: ${adminId}`);

  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  const productIdStr = String(productId);

  const product = await pb.collection('products').getOne(productIdStr);

  if (!product) {
    return res.status(404).json({ error: `Product ${productIdStr} not found` });
  }

  const reviewedAt = new Date().toISOString();
  const updatedProduct = await pb.collection('products').update(productIdStr, {
    status: 'active',
    verification_status: 'approved',
    validation_reviewed_at: reviewedAt,
    validation_admin_id: adminId,
    validation_notes: notes ? String(notes).trim() : '',
  }, { $autoCancel: false });

  await createProductVerificationAudit({
    product: updatedProduct,
    status: 'approved',
    adminId,
    adminNotes: notes ? String(notes).trim() : '',
  });

  logger.info(`[ADMIN] Product approved - Product: ${productIdStr}, Admin: ${adminId}`);

  const seller = await pb.collection('users').getOne(product.seller_id, { $autoCancel: false });

  try {
    await queueVerificationEmail({
      type: 'verification_approval',
      sellerId: product.seller_id,
      productId: productIdStr,
      productName: product.name,
      sellerEmail: seller.email,
    });

    logger.info(`[ADMIN] Approval email queued for seller - Seller: ${product.seller_id}`);
  } catch (emailError) {
    logger.warn(`[ADMIN] Approval email failed - Seller: ${product.seller_id}, Error: ${emailError.message}`);
  }

  res.json({
    success: true,
    productId: productIdStr,
    status: 'active',
    verification_status: 'approved',
    product: formatAdminProduct(updatedProduct, 'marketplace', seller),
    message: `Product ${productIdStr} has been approved`,
  });
});

// POST /admin/reject-product
router.post('/reject-product', async (req, res) => {
  const { productId, reason } = req.body;
  const adminId = req.auth.id;

  logger.info(`[ADMIN] Reject product request - Product: ${productId}, Admin: ${adminId}`);

  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  const productIdStr = String(productId);

  const product = await pb.collection('products').getOne(productIdStr);

  if (!product) {
    return res.status(404).json({ error: `Product ${productIdStr} not found` });
  }

  const seller = await pb.collection('users').getOne(product.seller_id, { $autoCancel: false });
  const rejectionReason = reason || 'Product does not meet verification requirements';
  const reviewedAt = new Date().toISOString();

  const updatedProduct = await pb.collection('products').update(productIdStr, {
    status: 'rejected',
    verification_status: 'rejected',
    validation_reviewed_at: reviewedAt,
    validation_admin_id: adminId,
    validation_notes: rejectionReason,
  }, { $autoCancel: false });

  await createProductVerificationAudit({
    product: updatedProduct,
    status: 'rejected',
    adminId,
    adminNotes: rejectionReason,
  });

  logger.info(`[ADMIN] Product rejected - Product: ${productIdStr}, Admin: ${adminId}`);

  try {
    await queueVerificationEmail({
      type: 'verification_rejection',
      sellerId: product.seller_id,
      productId: productIdStr,
      productName: product.name,
      sellerEmail: seller.email,
      reason: rejectionReason,
    });

    logger.info(`[ADMIN] Rejection email queued for seller - Seller: ${product.seller_id}`);
  } catch (emailError) {
    logger.warn(`[ADMIN] Rejection email failed - Seller: ${product.seller_id}, Error: ${emailError.message}`);
  }

  res.json({
    success: true,
    productId: productIdStr,
    status: 'rejected',
    verification_status: 'rejected',
    product: formatAdminProduct(updatedProduct, 'marketplace', seller),
    message: `Product ${productIdStr} has been rejected`,
  });
});

// POST /admin/request-correction-product
router.post('/request-correction-product', async (req, res) => {
  const { productId, reason } = req.body;
  const adminId = req.auth.id;

  logger.info(`[ADMIN] Request product correction - Product: ${productId}, Admin: ${adminId}`);

  if (!productId) {
    return res.status(400).json({ error: 'productId is required' });
  }

  const productIdStr = String(productId);
  const product = await pb.collection('products').getOne(productIdStr);

  if (!product) {
    return res.status(404).json({ error: `Product ${productIdStr} not found` });
  }

  const seller = await pb.collection('users').getOne(product.seller_id, { $autoCancel: false });
  const correctionReason = reason || 'Please update the listing details before it can be approved';
  const reviewedAt = new Date().toISOString();

  const updatedProduct = await pb.collection('products').update(productIdStr, {
    status: 'draft',
    verification_status: 'needs_correction',
    validation_reviewed_at: reviewedAt,
    validation_admin_id: adminId,
    validation_notes: correctionReason,
  }, { $autoCancel: false });

  await createProductVerificationAudit({
    product: updatedProduct,
    status: 'needs_correction',
    adminId,
    adminNotes: correctionReason,
  });

  logger.info(`[ADMIN] Product correction requested - Product: ${productIdStr}, Admin: ${adminId}`);

  try {
    await queueVerificationEmail({
      type: 'verification_correction',
      sellerId: product.seller_id,
      productId: productIdStr,
      productName: product.name,
      sellerEmail: seller.email,
      reason: correctionReason,
    });

    logger.info(`[ADMIN] Correction email queued for seller - Seller: ${product.seller_id}`);
  } catch (emailError) {
    logger.warn(`[ADMIN] Correction email failed - Seller: ${product.seller_id}, Error: ${emailError.message}`);
  }

  res.json({
    success: true,
    productId: productIdStr,
    status: 'draft',
    verification_status: 'needs_correction',
    product: formatAdminProduct(updatedProduct, 'marketplace', seller),
    message: `Correction requested for product ${productIdStr}`,
  });
});

// ============================================================================
// ORDERS ENDPOINTS
// ============================================================================

// Get Orders with Filters
router.get('/orders', async (req, res) => {
  const { status, startDate, endDate, page = 1, limit = 10 } = req.query;

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;

  let filter = '';

  if (status) {
    const statusStr = String(status).trim();
    filter = `status="${statusStr}"`;
  }

  if (startDate) {
    const startDateStr = String(startDate).trim();
    const dateFilter = `created_at>="${startDateStr}T00:00:00Z"`;
    filter = filter ? `${filter} && ${dateFilter}` : dateFilter;
  }

  if (endDate) {
    const endDateStr = String(endDate).trim();
    const dateFilter = `created_at<="${endDateStr}T23:59:59Z"`;
    filter = filter ? `${filter} && ${dateFilter}` : dateFilter;
  }

  const orders = await pb.collection('orders').getList(pageNum, limitNum, {
    filter: filter || undefined,
    sort: '-created_at',
  });
  const enrichedOrders = await Promise.all(orders.items.map((order) => buildAdminOrderResponse(order)));

  logger.info(`[ADMIN] Fetched ${orders.items.length} orders by admin ${req.auth.id}`);
  res.json({
    items: enrichedOrders,
    total: orders.totalItems,
    page: pageNum,
    limit: limitNum,
  });
});

// Download Order Label PDF
router.get('/orders/:id/label-pdf', async (req, res) => {
  const orderId = String(req.params.id || '').trim();

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const order = await pb.collection('orders').getOne(orderId).catch(() => null);

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  if (order.dhl_label_pdf) {
    const fileName = `DHL_Label_${order.order_number || order.id}.pdf`;
    const pdfBuffer = Buffer.from(String(order.dhl_label_pdf), 'base64');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.send(pdfBuffer);
  }

  if (order.dhl_label_url) {
    return res.json({
      label_url: order.dhl_label_url,
    });
  }

  return res.status(404).json({ error: 'No DHL label available for this order' });
});

// Get Order Details
router.get('/orders/:id', async (req, res) => {
  const orderId = String(req.params.id || '').trim();

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const order = await pb.collection('orders').getOne(orderId).catch(() => null);

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const item = await buildAdminOrderResponse(order);

  logger.info(`[ADMIN] Fetched order ${orderId} details by admin ${req.auth.id}`);
  res.json(item);
});

// Update Order Status
router.put('/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  if (!status || !isOrderStatus(status)) {
    return res.status(400).json({
      error: `Invalid status. Must be one of: ${ORDER_STATUS_VALUES.join(', ')}`,
    });
  }

  if (['waiting_admin_validation', 'validated', 'cancelled', 'refunded'].includes(status)) {
    return res.status(400).json({
      error: `Use the dedicated admin order action endpoint for ${status}`,
      requestedStatus: status,
    });
  }

  const orderId = String(id).trim();
  const existingOrder = await pb.collection('orders').getOne(orderId).catch(() => null);

  if (!existingOrder) {
    return res.status(404).json({ error: 'Order not found' });
  }

  let order;
  try {
    order = await updateOrderStatusWithAudit({
      existingOrder,
      status,
      adminId: req.auth.id,
      eventType: 'status_changed',
      note: req.body.note || '',
      updateData: req.body.note ? { admin_notes: String(req.body.note).trim() } : {},
    });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({
        error: error.message,
        currentStatus: error.currentStatus,
        requestedStatus: error.requestedStatus,
      });
    }

    throw error;
  }

  const enrichedOrder = await buildAdminOrderResponse(order);

  logger.info(`[ADMIN] Order ${orderId} status updated to ${status} by admin ${req.auth.id}`);
  res.json({
    success: true,
    message: `Order ${orderId} status updated to ${status}`,
    order: enrichedOrder,
  });
});

router.post('/orders/:id/validate', async (req, res) => {
  const orderId = String(req.params.id || '').trim();
  const note = String(req.body?.note || '').trim();

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const existingOrder = await pb.collection('orders').getOne(orderId).catch(() => null);

  if (!existingOrder) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const now = new Date().toISOString();
  const order = await updateOrderStatusWithAudit({
    existingOrder,
    status: 'validated',
    adminId: req.auth.id,
    eventType: 'validated',
    note,
    updateData: {
      admin_validated_at: now,
      admin_validated_by: req.auth.id,
      admin_notes: note,
    },
  });

  const enrichedOrder = await buildAdminOrderResponse(order);
  res.json({ success: true, order: enrichedOrder });
});

router.post('/orders/:id/pause', async (req, res) => {
  const orderId = String(req.params.id || '').trim();
  const reason = String(req.body?.reason || req.body?.note || '').trim();

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const existingOrder = await pb.collection('orders').getOne(orderId).catch(() => null);

  if (!existingOrder) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const now = new Date().toISOString();
  const order = await updateOrderStatusWithAudit({
    existingOrder,
    status: 'waiting_admin_validation',
    adminId: req.auth.id,
    eventType: 'paused',
    note: reason,
    updateData: {
      admin_paused_at: now,
      admin_paused_by: req.auth.id,
      admin_pause_reason: reason,
      admin_notes: reason,
    },
  });

  const enrichedOrder = await buildAdminOrderResponse(order);
  res.json({ success: true, order: enrichedOrder });
});

router.post('/orders/:id/cancel', async (req, res) => {
  const orderId = String(req.params.id || '').trim();
  const reason = String(req.body?.reason || req.body?.note || '').trim();

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const existingOrder = await pb.collection('orders').getOne(orderId).catch(() => null);

  if (!existingOrder) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const now = new Date().toISOString();
  const order = await updateOrderStatusWithAudit({
    existingOrder,
    status: 'cancelled',
    adminId: req.auth.id,
    eventType: 'cancelled',
    note: reason,
    updateData: {
      admin_cancelled_at: now,
      admin_cancelled_by: req.auth.id,
      admin_cancel_reason: reason,
      admin_notes: reason,
    },
  });

  const enrichedOrder = await buildAdminOrderResponse(order);
  res.json({ success: true, order: enrichedOrder });
});

router.post('/orders/:id/refund', async (req, res) => {
  const orderId = String(req.params.id || '').trim();
  const reason = String(req.body?.reason || req.body?.note || '').trim();

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  const existingOrder = await pb.collection('orders').getOne(orderId).catch(() => null);

  if (!existingOrder) {
    return res.status(404).json({ error: 'Order not found' });
  }

  if (['paid_out', 'completed'].includes(existingOrder.status)) {
    return res.status(400).json({ error: 'Cannot refund an order after payout completion' });
  }

  const refundAmount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === ''
    ? Number(existingOrder.total_amount || 0)
    : Number(String(req.body.amount).replace(',', '.'));

  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    return res.status(400).json({ error: 'Refund amount must be greater than zero' });
  }

  const refund = await createStripeRefundForOrder({
    order: existingOrder,
    amount: refundAmount,
    reason,
    adminId: req.auth.id,
  });

  const now = refund.created ? new Date(refund.created * 1000).toISOString() : new Date().toISOString();
  const order = await updateOrderStatusWithAudit({
    existingOrder,
    status: 'refunded',
    adminId: req.auth.id,
    eventType: 'refunded',
    note: reason,
    updateData: {
      stripe_refund_id: refund.id || '',
      refund_status: refund.status || 'pending',
      refund_amount: Number(refund.amount || Math.round(refundAmount * 100)) / 100,
      refund_processed_at: now,
      refund_failure: refund.failure_reason || '',
      refunded_by: req.auth.id,
      admin_notes: reason,
    },
    metadata: {
      stripe_refund_id: refund.id || '',
      refund_status: refund.status || '',
      refund_amount: Number(refund.amount || 0) / 100,
    },
  });

  const enrichedOrder = await buildAdminOrderResponse(order);
  res.json({ success: true, order: enrichedOrder, refund });
});

router.post('/payouts/release-eligible', async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.body?.limit, 10) || 100, 1), 500);
  const result = await releaseEligiblePayouts({
    actorId: req.auth.id,
    limit,
  });

  logger.info(`[ADMIN] Released eligible payouts by admin ${req.auth.id}: ${result.released} released, ${result.blocked} blocked`);
  res.json({
    success: true,
    ...result,
  });
});

router.get('/payout-requests', async (req, res) => {
  const status = String(req.query?.status || '').trim();
  const sellerId = String(req.query?.seller_id || '').trim();
  const limit = Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || 100, 1), 200);
  const filters = [];

  if (status && status !== 'all') {
    filters.push(`status="${escapeFilterValue(status)}"`);
  }

  if (sellerId) {
    filters.push(`seller_id="${escapeFilterValue(sellerId)}"`);
  }

  const requests = await pb.collection('seller_payout_requests').getList(1, limit, {
    filter: filters.join(' && ') || undefined,
    sort: '-created',
    $autoCancel: false,
  }).catch(() => ({ items: [], totalItems: 0 }));

  const sellerIds = [...new Set(requests.items.map((item) => String(item.seller_id || '').trim()).filter(Boolean))];
  const sellers = await Promise.all(
    sellerIds.map((id) => pb.collection('users').getOne(id, { $autoCancel: false }).catch(() => null)),
  );
  const sellerById = new Map(sellers.filter(Boolean).map((seller) => [seller.id, sanitizeUserSummary(seller)]));

  res.json({
    items: requests.items.map((request) => ({
      ...sanitizePayoutRequest(request),
      seller: sellerById.get(request.seller_id) || null,
    })),
    total: requests.totalItems || requests.items.length,
  });
});

router.put('/payout-requests/:id', async (req, res) => {
  const requestId = String(req.params.id || '').trim();
  const status = String(req.body?.status || '').trim();
  const adminNotes = String(req.body?.admin_notes || req.body?.notes || '').trim();

  if (!requestId) {
    return res.status(400).json({ error: 'Payout request ID is required' });
  }

  if (!PAYOUT_REQUEST_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid payout request status' });
  }

  if (['processing', 'paid'].includes(status)) {
    return res.status(400).json({
      error: 'Use the dedicated payout payment endpoint for processing or paid payouts',
      requestedStatus: status,
    });
  }

  const updateData = {
    status,
    admin_notes: adminNotes,
  };

  if (['reviewing', 'approved', 'rejected', 'failed'].includes(status)) {
    updateData.reviewed_at = new Date().toISOString();
    updateData.reviewed_by = req.auth.id;
  }

  if (status === 'failed') {
    updateData.failure_reason = adminNotes;
  }

  const request = await pb.collection('seller_payout_requests').update(requestId, updateData, { $autoCancel: false });
  logger.info(`[ADMIN] Payout request ${requestId} updated to ${status} by admin ${req.auth.id}`);

  res.json({
    success: true,
    request: sanitizePayoutRequest(request),
  });
});

router.get('/payout-conflicts', async (req, res) => {
  const status = String(req.query?.status || 'open').trim();
  const sellerId = String(req.query?.seller_id || '').trim();
  const limit = Math.min(Math.max(Number.parseInt(req.query?.limit, 10) || 100, 1), 200);
  const result = await listPayoutConflicts({ status, sellerId, limit });

  res.json(result);
});

router.post('/payout-conflicts', async (req, res) => {
  try {
    const conflict = await createPayoutConflict({
      earningId: req.body?.earning_id,
      orderId: req.body?.order_id,
      payoutRequestId: req.body?.payout_request_id,
      reason: req.body?.reason,
      adminNotes: req.body?.admin_notes,
      adminId: req.auth.id,
    });

    logger.info(`[ADMIN] Payout conflict created - Conflict: ${conflict.id}, Seller: ${conflict.seller_id}, Admin: ${req.auth.id}`);
    res.status(201).json({ success: true, conflict });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/payout-conflicts/:id/resolve', async (req, res) => {
  try {
    const conflict = await resolvePayoutConflict({
      conflictId: req.params.id,
      adminId: req.auth.id,
      adminNotes: req.body?.admin_notes,
      restore: req.body?.restore !== false,
    });

    logger.info(`[ADMIN] Payout conflict ${conflict.id} ${conflict.status} by admin ${req.auth.id}`);
    res.json({ success: true, conflict });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

router.post('/payout-requests/:id/pay', async (req, res) => {
  const requestId = String(req.params.id || '').trim();
  if (!requestId) {
    return res.status(400).json({ error: 'Payout request ID is required' });
  }

  try {
    const result = await executeStripeConnectPayoutRequest({
      requestId,
      adminId: req.auth.id,
    });

    logger.info(`[ADMIN] Stripe Connect payout paid - Request: ${requestId}, Transfer: ${result.transfer.id}, Admin: ${req.auth.id}`);
    res.json({
      success: true,
      request: sanitizePayoutRequest(result.request),
      transfer: {
        id: result.transfer.id,
        amount: result.transfer.amount,
        currency: result.transfer.currency,
        destination: result.transfer.destination,
      },
    });
  } catch (error) {
    if (requestId && error.status !== 409) {
      await pb.collection('seller_payout_requests').update(requestId, {
        status: 'failed',
        failure_reason: error.message || 'Stripe Connect payout failed',
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.auth.id,
      }, { $autoCancel: false }).catch(() => null);
    }

    res.status(error.status || 400).json({
      error: error.message,
      connectStatus: error.connectStatus,
      conflicts: error.conflicts,
    });
  }
});

// ============================================================================
// USERS ENDPOINTS
// ============================================================================

// Get Users with Filters
router.get('/users', async (req, res) => {
  const { search, role, page = 1, limit = 10 } = req.query;

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 10;

  let filter = '';

  if (role) {
    const roleStr = String(role).trim();
    filter = `role="${roleStr}"`;
  }

  if (search) {
    const searchStr = String(search).trim();
    const searchFilter = `(email~"${searchStr}" || name~"${searchStr}")`;
    filter = filter ? `${filter} && ${searchFilter}` : searchFilter;
  }

  const users = await pb.collection('users').getList(pageNum, limitNum, {
    filter: filter || undefined,
    sort: '-created',
  });

  logger.info(`[ADMIN] Fetched ${users.items.length} users by admin ${req.auth.id}`);
  res.json({
    items: users.items,
    total: users.totalItems,
    page: pageNum,
    limit: limitNum,
  });
});

const handleHardDeleteUser = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const { summary } = await hardDeleteUser(id, req.auth.id);

  res.json({
    success: true,
    hardDeleted: true,
    deletedUserId: id,
    deletedRecords: summary,
    message: `User ${id} and associated records have been permanently deleted`,
  });
};

// Hard Delete User
router.delete('/users/:id', handleHardDeleteUser);

// Backward compatible user delete route for older clients.
router.put('/users/:id/delete', handleHardDeleteUser);

// Remove Seller Status from User
router.put('/users/:id/remove-seller', async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  await pb.collection('users').update(id, { is_seller: false });

  logger.info(`[ADMIN] Seller status removed for user: ${id} by admin ${req.auth.id}`);
  res.json({ success: true, message: `Seller status removed for user ${id}` });
});

// Get Sellers with Aggregates
router.get('/sellers', async (req, res) => {
  const { search, page = 1, limit = 100 } = req.query;

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 100;

  const normalizedSearch = String(search || '').trim().toLowerCase();

  const [
    allUsers,
    marketplaceProducts,
    shopProducts,
    allOrders,
    sellerEarnings,
    sellerBalances,
  ] = await Promise.all([
    pb.collection('users').getFullList({
      sort: '-created',
      $autoCancel: false,
    }),
    pb.collection('products').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch(() => []),
    pb.collection('shop_products').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch((error) => {
      if (isMissingCollectionError(error)) {
        return [];
      }

      throw error;
    }),
    pb.collection('orders').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch(() => []),
    pb.collection('seller_earnings').getFullList({
      sort: '-created',
      $autoCancel: false,
    }).catch((error) => {
      if (isMissingCollectionError(error)) {
        return [];
      }

      throw error;
    }),
    pb.collection('seller_balances').getFullList({
      sort: '-updated',
      $autoCancel: false,
    }).catch((error) => {
      if (isMissingCollectionError(error)) {
        return [];
      }

      throw error;
    }),
  ]);

  const filteredSellers = allUsers.filter((user) => {
    if (user.is_seller !== true) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    const haystack = [
      user.email,
      user.name,
      user.seller_username,
    ].map((value) => String(value || '').toLowerCase());

    return haystack.some((value) => value.includes(normalizedSearch));
  });

  const totalItems = filteredSellers.length;
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limitNum);
  const startIndex = Math.max(0, (pageNum - 1) * limitNum);
  const pagedSellers = filteredSellers.slice(startIndex, startIndex + limitNum);
  const sellerIds = filteredSellers.map((seller) => seller.id);
  const sellerIdSet = new Set(sellerIds);

  const productCountBySeller = new Map();
  const activeListingCountBySeller = new Map();
  const orderCountBySeller = new Map();
  const deliveredOrderCountBySeller = new Map();
  const revenueTotalBySeller = new Map();
  const availableBalanceBySeller = new Map();
  const balanceBySeller = new Map(sellerBalances.map((balance) => [String(balance.seller_id || ''), balance]));
  const earningsBySeller = new Map();

  for (const product of [...marketplaceProducts, ...shopProducts]) {
    const sellerId = String(product.seller_id || '').trim();
    if (!sellerId) continue;

    productCountBySeller.set(sellerId, (productCountBySeller.get(sellerId) || 0) + 1);

    if (['active', 'verified'].includes(product.status)) {
      activeListingCountBySeller.set(sellerId, (activeListingCountBySeller.get(sellerId) || 0) + 1);
    }
  }

  for (const order of allOrders) {
    const sellerId = String(order.seller_id || '').trim();
    if (!sellerId || !sellerIdSet.has(sellerId)) continue;

    orderCountBySeller.set(sellerId, (orderCountBySeller.get(sellerId) || 0) + 1);

    if (ORDER_DELIVERED_STATUSES.has(order.status)) {
      deliveredOrderCountBySeller.set(sellerId, (deliveredOrderCountBySeller.get(sellerId) || 0) + 1);
    }
  }

  for (const earning of sellerEarnings) {
    const sellerId = String(earning.seller_id || '').trim();
    if (!sellerId) continue;
    earningsBySeller.set(sellerId, [...(earningsBySeller.get(sellerId) || []), earning]);

    const netAmount = Number(earning.net_amount ?? earning.gross_amount) || 0;
    revenueTotalBySeller.set(sellerId, (revenueTotalBySeller.get(sellerId) || 0) + netAmount);

    if (['available', 'confirmed'].includes(String(earning.status || '').trim())) {
      availableBalanceBySeller.set(sellerId, (availableBalanceBySeller.get(sellerId) || 0) + netAmount);
    }
  }

  const items = pagedSellers.map((seller) => {
    const sellerId = seller.id;
    const balance = balanceBySeller.get(sellerId) || buildSellerBalanceFromEarnings(sellerId, earningsBySeller.get(sellerId) || []);

    return {
      id: sellerId,
      user_id: seller.user_id || '',
      name: seller.name || '',
      email: seller.email || '',
      seller_username: seller.seller_username || '',
      university: seller.university || '',
      created: seller.created,
      is_seller: seller.is_seller === true,
      is_deleted: seller.is_deleted === true,
      is_admin: seller.is_admin === true,
      product_count: productCountBySeller.get(sellerId) || 0,
      active_listings_count: activeListingCountBySeller.get(sellerId) || 0,
      order_count: orderCountBySeller.get(sellerId) || 0,
      delivered_order_count: deliveredOrderCountBySeller.get(sellerId) || 0,
      revenue_total: balance.lifetime_net_amount || revenueTotalBySeller.get(sellerId) || 0,
      pending_balance: balance.pending_amount || 0,
      waiting_balance: balance.waiting_amount || 0,
      available_balance: balance.available_amount ?? availableBalanceBySeller.get(sellerId) ?? 0,
      blocked_balance: balance.blocked_amount || 0,
      paid_out_balance: balance.paid_out_amount || 0,
      status: seller.is_deleted ? 'deleted' : 'active',
    };
  });

  const summary = filteredSellers.reduce((acc, seller) => {
    const sellerId = seller.id;

    acc.totalSellers += 1;
    acc.totalListings += productCountBySeller.get(sellerId) || 0;
    acc.activeListings += activeListingCountBySeller.get(sellerId) || 0;
    acc.totalOrders += orderCountBySeller.get(sellerId) || 0;
    const balance = balanceBySeller.get(sellerId) || buildSellerBalanceFromEarnings(sellerId, earningsBySeller.get(sellerId) || []);
    acc.availableBalance += balance.available_amount ?? availableBalanceBySeller.get(sellerId) ?? 0;
    acc.pendingBalance += balance.pending_amount || 0;
    acc.waitingBalance += balance.waiting_amount || 0;
    acc.blockedBalance += balance.blocked_amount || 0;
    acc.paidOutBalance += balance.paid_out_amount || 0;
    acc.revenueTotal += balance.lifetime_net_amount || revenueTotalBySeller.get(sellerId) || 0;
    return acc;
  }, {
    totalSellers: 0,
    totalListings: 0,
    activeListings: 0,
    totalOrders: 0,
    availableBalance: 0,
    pendingBalance: 0,
    waitingBalance: 0,
    blockedBalance: 0,
    paidOutBalance: 0,
    revenueTotal: 0,
  });

  logger.info(`[ADMIN] Fetched ${items.length} sellers by admin ${req.auth.id}`);
  res.json({
    items,
    summary,
    total: totalItems,
    page: pageNum,
    limit: limitNum,
    totalPages,
  });
});

// ============================================================================
// SHOP FILTER MANAGEMENT ENDPOINTS
// ============================================================================

router.get('/shop-filters', async (req, res) => {
  const filters = await getAdminShopFilters();

  logger.info(`[ADMIN] Fetched ${filters.length} shop filters by admin ${req.auth.id}`);
  res.json({
    items: filters,
    total: filters.length,
  });
});

router.post('/shop-filters', async (req, res) => {
  const validation = validateShopFilterPayload(req.body || {});

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const existingFilter = await pb.collection('shop_filters').getFirstListItem(
    `key="${escapeFilterValue(validation.data.key)}"`,
    { $autoCancel: false },
  ).catch(() => null);

  if (existingFilter) {
    return res.status(409).json({ error: 'A filter with this key already exists.' });
  }

  const filter = await pb.collection('shop_filters').create(validation.data, { $autoCancel: false });

  logger.info(`[ADMIN] Created shop filter ${filter.key} by admin ${req.auth.id}`);
  res.status(201).json({
    success: true,
    item: serializeAdminShopFilter(filter, []),
  });
});

router.put('/shop-filters/:id', async (req, res) => {
  const filterId = normalizeString(req.params.id);

  if (!filterId) {
    return res.status(400).json({ error: 'Filter ID is required.' });
  }

  const existingFilter = await pb.collection('shop_filters').getOne(filterId, { $autoCancel: false }).catch(() => null);

  if (!existingFilter) {
    return res.status(404).json({ error: 'Filter not found.' });
  }

  const validation = validateShopFilterPayload(req.body || {}, { existingFilter });

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const updatedFilter = await pb.collection('shop_filters').update(filterId, validation.data, { $autoCancel: false });
  const optionRecords = await pb.collection('shop_filter_options').getFullList({
    filter: `filter_key="${escapeFilterValue(updatedFilter.key)}"`,
    sort: 'sort_order,label',
    $autoCancel: false,
  }).catch(() => []);

  logger.info(`[ADMIN] Updated shop filter ${updatedFilter.key} by admin ${req.auth.id}`);
  res.json({
    success: true,
    item: serializeAdminShopFilter(updatedFilter, optionRecords.map(serializeAdminShopFilterOption)),
  });
});

router.delete('/shop-filters/:id', async (req, res) => {
  const filterId = normalizeString(req.params.id);

  if (!filterId) {
    return res.status(400).json({ error: 'Filter ID is required.' });
  }

  const existingFilter = await pb.collection('shop_filters').getOne(filterId, { $autoCancel: false }).catch(() => null);

  if (!existingFilter) {
    return res.status(404).json({ error: 'Filter not found.' });
  }

  const optionRecords = await pb.collection('shop_filter_options').getFullList({
    filter: `filter_key="${escapeFilterValue(existingFilter.key)}"`,
    $autoCancel: false,
  }).catch(() => []);

  for (const optionRecord of optionRecords) {
    await pb.collection('shop_filter_options').delete(optionRecord.id, { $autoCancel: false });
  }

  await pb.collection('shop_filters').delete(filterId, { $autoCancel: false });

  logger.info(`[ADMIN] Deleted shop filter ${existingFilter.key} and ${optionRecords.length} options by admin ${req.auth.id}`);
  res.json({
    success: true,
    deletedFilterId: filterId,
    deletedOptions: optionRecords.length,
  });
});

router.post('/shop-filter-options', async (req, res) => {
  const validation = validateShopFilterOptionPayload(req.body || {});

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const parentFilter = await pb.collection('shop_filters').getFirstListItem(
    `key="${escapeFilterValue(validation.data.filter_key)}"`,
    { $autoCancel: false },
  ).catch(() => null);

  if (!parentFilter) {
    return res.status(404).json({ error: 'Parent filter not found.' });
  }

  const existingOption = await pb.collection('shop_filter_options').getFirstListItem(
    `filter_key="${escapeFilterValue(validation.data.filter_key)}" && value="${escapeFilterValue(validation.data.value)}"`,
    { $autoCancel: false },
  ).catch(() => null);

  if (existingOption) {
    return res.status(409).json({ error: 'An option with this value already exists for the filter.' });
  }

  const option = await pb.collection('shop_filter_options').create(validation.data, { $autoCancel: false });

  logger.info(`[ADMIN] Created shop filter option ${option.value} for ${option.filter_key} by admin ${req.auth.id}`);
  res.status(201).json({
    success: true,
    item: serializeAdminShopFilterOption(option),
  });
});

router.put('/shop-filter-options/:id', async (req, res) => {
  const optionId = normalizeString(req.params.id);

  if (!optionId) {
    return res.status(400).json({ error: 'Option ID is required.' });
  }

  const existingOption = await pb.collection('shop_filter_options').getOne(optionId, { $autoCancel: false }).catch(() => null);

  if (!existingOption) {
    return res.status(404).json({ error: 'Option not found.' });
  }

  const validation = validateShopFilterOptionPayload(req.body || {}, {
    existingOption,
    filterKey: existingOption.filter_key,
  });

  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  const duplicateOption = await pb.collection('shop_filter_options').getFirstListItem(
    `filter_key="${escapeFilterValue(validation.data.filter_key)}" && value="${escapeFilterValue(validation.data.value)}"`,
    { $autoCancel: false },
  ).catch(() => null);

  if (duplicateOption && duplicateOption.id !== optionId) {
    return res.status(409).json({ error: 'An option with this value already exists for the filter.' });
  }

  const option = await pb.collection('shop_filter_options').update(optionId, validation.data, { $autoCancel: false });

  logger.info(`[ADMIN] Updated shop filter option ${option.id} by admin ${req.auth.id}`);
  res.json({
    success: true,
    item: serializeAdminShopFilterOption(option),
  });
});

router.delete('/shop-filter-options/:id', async (req, res) => {
  const optionId = normalizeString(req.params.id);

  if (!optionId) {
    return res.status(400).json({ error: 'Option ID is required.' });
  }

  const existingOption = await pb.collection('shop_filter_options').getOne(optionId, { $autoCancel: false }).catch(() => null);

  if (!existingOption) {
    return res.status(404).json({ error: 'Option not found.' });
  }

  await pb.collection('shop_filter_options').delete(optionId, { $autoCancel: false });

  logger.info(`[ADMIN] Deleted shop filter option ${optionId} by admin ${req.auth.id}`);
  res.json({
    success: true,
    deletedOptionId: optionId,
  });
});

// ============================================================================
// SETTINGS ENDPOINTS
// ============================================================================

// Get Admin Settings
router.get('/settings', async (req, res) => {
  const settings = await pb.collection('admin_settings').getFirstListItem('').catch((error) => {
    if (error?.status === 404) {
      return null;
    }

    throw error;
  });

  logger.info(`[ADMIN] Admin settings retrieved by admin ${req.auth.id}`);
  res.json({
    ...(settings || {}),
    ...normalizePlatformSettings(settings || {}),
  });
});

// Update Admin Settings
router.put('/settings', async (req, res) => {
  const {
    shipping_fee,
    service_fee,
    transaction_fee_percentage,
    transaction_fee_percent,
    verification_fee,
    shop_enabled,
    dhl_api_key,
    dhl_api_secret,
    stripe_public_key,
    stripe_secret_key,
  } = req.body;

  const updateData = {};
  if (shipping_fee !== undefined) updateData.shipping_fee = parseFloat(shipping_fee);
  if (service_fee !== undefined) updateData.service_fee = parseFloat(service_fee);
  if (transaction_fee_percentage !== undefined) updateData.transaction_fee_percentage = parseFloat(transaction_fee_percentage);
  if (transaction_fee_percent !== undefined) updateData.transaction_fee_percentage = parseFloat(transaction_fee_percent);
  if (verification_fee !== undefined) updateData.verification_fee = parseFloat(verification_fee);
  if (shop_enabled !== undefined) updateData.shop_enabled = shop_enabled === true || shop_enabled === 'true' || shop_enabled === 1 || shop_enabled === '1';
  if (dhl_api_key !== undefined) updateData.dhl_api_key = dhl_api_key;
  if (dhl_api_secret !== undefined) updateData.dhl_api_secret = dhl_api_secret;
  if (stripe_public_key !== undefined) updateData.stripe_public_key = stripe_public_key;
  if (stripe_secret_key !== undefined) updateData.stripe_secret_key = stripe_secret_key;

  let settings;
  try {
    const existingSettings = await pb.collection('admin_settings').getFirstListItem('');
    settings = await pb.collection('admin_settings').update(existingSettings.id, updateData);
  } catch (error) {
    const defaults = normalizePlatformSettings({
      ...DEFAULT_PLATFORM_SETTINGS,
      ...updateData,
    });

    settings = await pb.collection('admin_settings').create({
      shipping_fee: defaults.shipping_fee,
      service_fee: defaults.service_fee,
      transaction_fee_percentage: defaults.transaction_fee_percentage,
      verification_fee: defaults.verification_fee,
      shop_enabled: defaults.shop_enabled,
      dhl_api_key: updateData.dhl_api_key || '',
      dhl_api_secret: updateData.dhl_api_secret || '',
      stripe_public_key: updateData.stripe_public_key || '',
      stripe_secret_key: updateData.stripe_secret_key || '',
    });
  }

  logger.info(`[ADMIN] Admin settings updated by admin ${req.auth.id}`);
  res.json({
    ...settings,
    ...normalizePlatformSettings(settings),
  });
});

export default router;
