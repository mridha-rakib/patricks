import 'dotenv/config';
import Stripe from 'stripe';
import pb from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { ensureDhlLabelForOrder, orderHandler } from '../utils/orderHandler.js';
import {
  getLearningSubscriptionLookupCandidates,
  hasLearningSubscriptionLookupCandidates,
  normalizeZ3TierSlug,
} from '../utils/learningTierMapping.js';
import { createProductVerificationAudit } from '../utils/productValidation.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUBSCRIPTION_GRACE_DAYS = Math.max(1, Number(process.env.LEARNING_SUBSCRIPTION_GRACE_DAYS || 7));
const ACTIVE_LEARNING_SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled']);
const marketplaceOrderProcessingByPaymentIntent = new Map();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapePbString = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const isTruthyMetadataValue = (value) => ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const toIsoString = (timestampSeconds) => {
  if (!timestampSeconds) return '';
  return new Date(timestampSeconds * 1000).toISOString();
};

const getStripeInvoiceSubscriptionId = (invoice) => {
  const candidates = [
    invoice?.subscription,
    invoice?.parent?.subscription_details?.subscription,
    invoice?.lines?.data?.[0]?.subscription,
  ];

  for (const candidate of candidates) {
    const subscriptionId = typeof candidate === 'string' ? candidate : String(candidate?.id || '').trim();
    if (subscriptionId) {
      return subscriptionId;
    }
  }

  return '';
};

const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig) {
    return res.status(400).json({ error: 'Missing stripe-signature header' });
  }

  if (!webhookSecret) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error(`[WEBHOOK] Signature verification failed: ${err.message}`);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    await handleWebhookEvent(event);
    return res.json({ received: true });
  } catch (error) {
    logger.error(`[WEBHOOK] Async processing failed: ${error.message}`);
    logger.error(error.stack);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};

const parseShippingAddress = (raw) => {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid shipping_address metadata');
  }
};

const parseCartItemIds = (raw) => {
  return String(raw || '')
    .split(',')
    .map((id) => String(id).trim())
    .filter(Boolean);
};

const syncCheckoutNewsletterOptIn = async ({ metadata = {}, paymentIntentId = '', checkoutSessionId = '' }) => {
  if (!isTruthyMetadataValue(metadata.newsletter_opt_in)) {
    return;
  }

  const email = String(metadata.buyer_email || metadata.user_email || '').trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email)) {
    logger.warn(`[WEBHOOK] Newsletter opt-in skipped because checkout email is invalid for PI ${paymentIntentId || 'unknown'}`);
    return;
  }

  try {
    const existing = await pb.collection('newsletter_signups').getList(1, 1, {
      filter: `email="${escapePbString(email)}"`,
      $autoCancel: false,
    });

    if (existing.items?.length > 0) {
      const record = existing.items[0];
      await pb.collection('newsletter_signups').update(record.id, {
        status: 'active',
        source: record.source || 'checkout',
        checkout_session_id: record.checkout_session_id || checkoutSessionId || '',
        payment_intent_id: record.payment_intent_id || paymentIntentId || '',
      }, { $autoCancel: false }).catch(() => null);

      logger.info(`[WEBHOOK] Newsletter opt-in already existed for ${email}`);
      return;
    }

    await pb.collection('newsletter_signups').create({
      email,
      subscribed_at: new Date().toISOString(),
      status: 'active',
      source: 'checkout',
      checkout_session_id: checkoutSessionId || '',
      payment_intent_id: paymentIntentId || '',
    }, { $autoCancel: false });

    logger.info(`[WEBHOOK] Newsletter opt-in persisted for ${email}`);
  } catch (error) {
    logger.warn(`[WEBHOOK] Newsletter opt-in could not be persisted for ${email}: ${error.message}`);
  }
};

const loadCartItems = async (cartItemIds) => {
  const items = [];
  const missingIds = [];

  for (const cartItemId of cartItemIds) {
    const item = await pb.collection('cart_items').getOne(cartItemId).catch((error) => {
      if (error?.status === 404) {
        missingIds.push(cartItemId);
        return null;
      }

      throw error;
    });

    if (item) {
      items.push(item);
    }
  }

  return { items, missingIds };
};

const hasExistingOrdersForPaymentIntent = async (paymentIntentId) => {
  const records = await pb.collection('orders').getList(1, 1, {
    filter: `payment_intent_id="${escapePbString(paymentIntentId)}"`,
    $autoCancel: false,
  }).catch(() => ({ totalItems: 0 }));

  return records.totalItems > 0;
};

const findSessionByPaymentIntent = async (paymentIntentId) => {
  try {
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntentId,
      limit: 1,
    });

    return sessions?.data?.[0] || null;
  } catch (error) {
    logger.warn(`[WEBHOOK] Could not load checkout session for PI ${paymentIntentId}: ${error.message}`);
    return null;
  }
};

const resolveSubscriptionFromPaymentIntent = async (paymentIntentId) => {
  const session = await findSessionByPaymentIntent(paymentIntentId);
  const sessionSubscriptionId = typeof session?.subscription === 'string'
    ? session.subscription
    : String(session?.subscription?.id || '').trim();

  if (sessionSubscriptionId) {
    return {
      subscriptionId: sessionSubscriptionId,
      invoice: null,
      source: 'checkout_session',
    };
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ['invoice'],
  }).catch((error) => {
    logger.warn(`[WEBHOOK] Could not retrieve PI ${paymentIntentId} for subscription lookup: ${error.message}`);
    return null;
  });

  const invoiceCandidate = paymentIntent?.invoice || null;
  const invoice = typeof invoiceCandidate === 'string'
    ? await stripe.invoices.retrieve(invoiceCandidate).catch((error) => {
      logger.warn(`[WEBHOOK] Could not retrieve invoice ${invoiceCandidate} for PI ${paymentIntentId}: ${error.message}`);
      return null;
    })
    : invoiceCandidate;

  return {
    subscriptionId: getStripeInvoiceSubscriptionId(invoice),
    invoice,
    source: invoice ? 'invoice' : '',
  };
};

const getSubscriptionPeriodStart = (subscription) =>
  subscription.current_period_start || subscription.items?.data?.[0]?.current_period_start || null;

const getSubscriptionPeriodEnd = (subscription) =>
  subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end || subscription.ended_at || subscription.cancel_at || null;

const getSubscriptionAccessEndsAt = (subscription) => {
  const candidate = getSubscriptionPeriodEnd(subscription);
  return candidate ? new Date(candidate * 1000).toISOString() : '';
};

const getGraceEndsAt = ({ stripeSubscription, fallbackFromNow = false }) => {
  const periodEndSeconds = stripeSubscription ? getSubscriptionPeriodEnd(stripeSubscription) : null;
  const periodEnd = periodEndSeconds
    ? new Date(periodEndSeconds * 1000)
    : null;
  const graceFromNow = new Date(Date.now() + (SUBSCRIPTION_GRACE_DAYS * 24 * 60 * 60 * 1000));

  if (periodEnd && periodEnd.getTime() > graceFromNow.getTime()) {
    return graceFromNow.toISOString();
  }

  if (periodEnd) {
    return periodEnd.toISOString();
  }

  return fallbackFromNow ? graceFromNow.toISOString() : '';
};

const normalizeLearningStatus = ({
  stripeStatus,
  accessEndsAt,
  graceEndsAt,
  cancelAtPeriodEnd = false,
}) => {
  const normalized = String(stripeStatus || 'incomplete').trim();
  const effectiveEnd = normalized === 'past_due'
    ? graceEndsAt || accessEndsAt || ''
    : accessEndsAt || graceEndsAt || '';

  if (normalized === 'unpaid') {
    return 'unpaid';
  }

  if (normalized === 'paused') {
    return 'paused';
  }

  if (['incomplete', 'incomplete_expired'].includes(normalized)) {
    return normalized;
  }

  if (effectiveEnd && new Date(effectiveEnd).getTime() <= Date.now()) {
    return 'expired';
  }

  if (cancelAtPeriodEnd && ['active', 'trialing'].includes(normalized)) {
    return 'canceled';
  }

  if (normalized === 'canceled' && accessEndsAt && new Date(accessEndsAt).getTime() > Date.now()) {
    return 'canceled';
  }

  if (['trialing', 'active', 'past_due'].includes(normalized)) {
    return normalized;
  }

  return 'expired';
};

const safePayload = (value) => {
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value));
};

const logLearningSubscriptionEvent = async ({
  subscriptionRecord = null,
  eventType,
  source,
  payload = {},
  userId = '',
  packageId = '',
  stripeSubscriptionId = '',
}) => {
  if (!eventType || !source) return;

  await pb.collection('learning_subscription_events').create({
    user_id: userId || subscriptionRecord?.user_id || '',
    package_id: packageId || subscriptionRecord?.package_id || '',
    subscription_id: subscriptionRecord?.id || '',
    stripe_subscription_id: stripeSubscriptionId || subscriptionRecord?.stripe_subscription_id || '',
    event_type: eventType,
    source,
    payload: safePayload(payload),
  }).catch(() => null);
};

const findLearningSubscriptionRecordByStripeId = async (subscriptionId) => {
  const normalizedId = String(subscriptionId || '').trim();
  if (!normalizedId) {
    return null;
  }

  return pb.collection('learning_subscriptions')
    .getFirstListItem(`stripe_subscription_id="${escapePbString(normalizedId)}"`, { $autoCancel: false })
    .catch(() => null);
};

const findLearningPackageByLookupCandidates = async (candidates) => {
  for (const packageId of candidates.packageIds || []) {
    const record = await pb.collection('learning_packages').getOne(packageId, {
      $autoCancel: false,
    }).catch(() => null);

    if (record) {
      return record;
    }
  }

  for (const slug of candidates.slugs || []) {
    const record = await pb.collection('learning_packages')
      .getFirstListItem(`slug="${escapePbString(slug)}"`, { $autoCancel: false })
      .catch(() => null);

    if (record) {
      return record;
    }
  }

  for (const priceId of candidates.stripePriceIds || []) {
    const escapedPriceId = escapePbString(priceId);
    const record = await pb.collection('learning_packages')
      .getFirstListItem(`stripe_price_id="${escapedPriceId}" || yearly_stripe_price_id="${escapedPriceId}"`, { $autoCancel: false })
      .catch(() => null);

    if (record) {
      return record;
    }
  }

  for (const productId of candidates.stripeProductIds || []) {
    const record = await pb.collection('learning_packages')
      .getFirstListItem(`stripe_product_id="${escapePbString(productId)}"`, { $autoCancel: false })
      .catch(() => null);

    if (record) {
      return record;
    }
  }

  return null;
};

const resolveLearningSubscriptionIdentity = async ({
  stripeSubscription,
  checkoutSession = null,
  fallbackMetadata = {},
}) => {
  const metadata = {
    ...(fallbackMetadata || {}),
    ...(checkoutSession?.metadata || {}),
    ...(stripeSubscription?.metadata || {}),
  };
  const stripeSubscriptionId = String(stripeSubscription?.id || checkoutSession?.subscription || fallbackMetadata?.subscription_id || '').trim();
  const existingRecord = await findLearningSubscriptionRecordByStripeId(stripeSubscriptionId);
  const candidates = getLearningSubscriptionLookupCandidates({
    metadata,
    checkoutSession,
    stripeSubscription,
  });

  if (existingRecord?.package_id && !candidates.packageIds.includes(existingRecord.package_id)) {
    candidates.packageIds.push(existingRecord.package_id);
  }

  if (existingRecord?.user_id && !candidates.userIds.includes(existingRecord.user_id)) {
    candidates.userIds.push(existingRecord.user_id);
  }

  const packageRecord = await findLearningPackageByLookupCandidates(candidates);
  const userId = candidates.userIds[0] || '';
  const tierSlug = normalizeZ3TierSlug(packageRecord?.slug || candidates.slugs[0] || '');

  return {
    metadata,
    candidates,
    existingRecord,
    packageRecord,
    userId,
    packageId: packageRecord?.id || existingRecord?.package_id || '',
    packageSlug: packageRecord?.slug || candidates.slugs[0] || '',
    tierSlug,
  };
};

const upsertLearningInvoiceRecord = async ({ invoice, subscriptionRecord = null }) => {
  const invoiceId = String(invoice?.id || '').trim();
  if (!invoiceId) {
    return null;
  }

  const subscriptionId = getStripeInvoiceSubscriptionId(invoice) || String(subscriptionRecord?.stripe_subscription_id || '').trim();
  const existingRecord = await pb.collection('learning_invoices')
    .getFirstListItem(`stripe_invoice_id="${escapePbString(invoiceId)}"`, { $autoCancel: false })
    .catch(() => null);
  const period = invoice.lines?.data?.[0]?.period || {};
  const payload = {
    user_id: subscriptionRecord?.user_id || '',
    package_id: subscriptionRecord?.package_id || '',
    subscription_id: subscriptionRecord?.id || '',
    stripe_subscription_id: subscriptionId,
    stripe_invoice_id: invoiceId,
    invoice_number: invoice.number || '',
    status: String(invoice.status || 'open').trim() || 'open',
    amount_paid: Number(invoice.amount_paid || 0) / 100,
    amount_due: Number(invoice.amount_due || 0) / 100,
    currency: String(invoice.currency || 'eur').toUpperCase(),
    hosted_invoice_url: invoice.hosted_invoice_url || '',
    invoice_pdf: invoice.invoice_pdf || '',
    billing_reason: invoice.billing_reason || '',
    created_at: toIsoString(invoice.created),
    period_start: toIsoString(period.start),
    period_end: toIsoString(period.end),
    payload: safePayload({
      id: invoice.id,
      status: invoice.status || '',
      billing_reason: invoice.billing_reason || '',
      amount_paid: invoice.amount_paid || 0,
      amount_due: invoice.amount_due || 0,
      currency: invoice.currency || '',
      subscription: subscriptionId,
    }),
  };

  return existingRecord
    ? pb.collection('learning_invoices').update(existingRecord.id, payload)
    : pb.collection('learning_invoices').create(payload);
};

const recordLearningCouponRedemption = async ({ subscriptionRecord, checkoutSession = null, stripeSubscription = null }) => {
  const metadata = {
    ...(checkoutSession?.metadata || {}),
    ...(stripeSubscription?.metadata || {}),
  };
  const couponId = String(metadata.learning_coupon_id || metadata.coupon_id || '').trim();
  const checkoutSessionId = String(checkoutSession?.id || subscriptionRecord?.stripe_checkout_session_id || '').trim();

  if (!couponId || !subscriptionRecord) {
    return;
  }

  const couponRecord = await pb.collection('learning_coupons').getOne(couponId, {
    $autoCancel: false,
  }).catch(() => null);

  if (!couponRecord) {
    return;
  }

  if (checkoutSessionId) {
    const existingRedemption = await pb.collection('learning_coupon_redemptions')
      .getFirstListItem(`checkout_session_id="${escapePbString(checkoutSessionId)}"`, { $autoCancel: false })
      .catch(() => null);

    if (existingRedemption) {
      return;
    }
  }

  const redemptionRecord = await pb.collection('learning_coupon_redemptions').create({
    coupon_id: couponRecord.id,
    user_id: subscriptionRecord.user_id || '',
    package_id: subscriptionRecord.package_id || '',
    subscription_id: subscriptionRecord.id,
    checkout_session_id: checkoutSessionId,
    stripe_coupon_id: String(metadata.stripe_coupon_id || couponRecord.stripe_coupon_id || '').trim(),
    stripe_promotion_code_id: String(metadata.stripe_promotion_code_id || couponRecord.stripe_promotion_code_id || '').trim(),
    status: 'applied',
    discount_type: couponRecord.discount_type || '',
    percent_off: Number(couponRecord.percent_off || 0),
    amount_off: Number(couponRecord.amount_off || 0),
    currency: couponRecord.currency || 'EUR',
  }).catch(() => null);

  if (!redemptionRecord) {
    return;
  }

  await pb.collection('learning_coupons').update(couponRecord.id, {
    redemption_count: Number(couponRecord.redemption_count || 0) + 1,
  }).catch(() => null);

  await logLearningSubscriptionEvent({
    subscriptionRecord,
    eventType: 'coupon_redeemed',
    source: 'stripe_webhook',
    payload: {
      couponId: couponRecord.id,
      code: couponRecord.code || '',
      checkoutSessionId,
    },
  });
};

const upsertLearningSubscriptionRecord = async ({
  stripeSubscription,
  checkoutSession = null,
  fallbackMetadata = {},
  resolvedIdentity = null,
}) => {
  const identity = resolvedIdentity || await resolveLearningSubscriptionIdentity({
    stripeSubscription,
    checkoutSession,
    fallbackMetadata,
  });
  const userId = String(identity.userId || '').trim();
  const packageId = String(identity.packageId || '').trim();

  if (!userId || !packageId) {
    throw new Error('Missing user_id or package_id for learning subscription');
  }

  const price = stripeSubscription.items?.data?.[0]?.price || null;
  const billingInterval = price?.recurring?.interval || '';
  const priceAmount = typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : 0;
  const currency = String(price?.currency || 'eur').toUpperCase();
  const accessEndsAt = getSubscriptionAccessEndsAt(stripeSubscription);
  const rawStripeStatus = String(stripeSubscription.status || '').trim();
  const graceEndsAt = rawStripeStatus === 'past_due'
    ? getGraceEndsAt({ stripeSubscription, fallbackFromNow: true })
    : '';
  const normalizedStatus = normalizeLearningStatus({
    stripeStatus: rawStripeStatus,
    accessEndsAt,
    graceEndsAt,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end === true,
  });
  const payload = {
    user_id: userId,
    package_id: packageId,
    stripe_customer_id: String(stripeSubscription.customer || checkoutSession?.customer || '').trim(),
    stripe_subscription_id: String(stripeSubscription.id || '').trim(),
    stripe_checkout_session_id: String(checkoutSession?.id || '').trim(),
    status: normalizedStatus,
    cancel_at_period_end: stripeSubscription.cancel_at_period_end === true,
    current_period_start: getSubscriptionPeriodStart(stripeSubscription) ? new Date(getSubscriptionPeriodStart(stripeSubscription) * 1000).toISOString() : '',
    current_period_end: getSubscriptionPeriodEnd(stripeSubscription) ? new Date(getSubscriptionPeriodEnd(stripeSubscription) * 1000).toISOString() : '',
    canceled_at: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000).toISOString() : '',
    price_amount: priceAmount,
    currency,
    billing_interval: billingInterval,
    access_ends_at: accessEndsAt,
    grace_ends_at: graceEndsAt,
    last_payment_failed_at: ['past_due', 'unpaid'].includes(rawStripeStatus) ? new Date().toISOString() : '',
  };

  let existingRecord = identity.existingRecord
    || await findLearningSubscriptionRecordByStripeId(payload.stripe_subscription_id);

  if (existingRecord) {
    const updatedRecord = await pb.collection('learning_subscriptions').update(existingRecord.id, payload);

    if (existingRecord.cancel_at_period_end !== true && updatedRecord.cancel_at_period_end === true) {
      await logLearningSubscriptionEvent({
        subscriptionRecord: updatedRecord,
        eventType: 'cancellation_scheduled',
        source: 'stripe_webhook',
        payload: {
          currentPeriodEnd: updatedRecord.current_period_end,
          packageSlug: identity.packageSlug,
          tierSlug: identity.tierSlug,
        },
      });
    }

    if (existingRecord.cancel_at_period_end === true && updatedRecord.cancel_at_period_end !== true) {
      await logLearningSubscriptionEvent({
        subscriptionRecord: updatedRecord,
        eventType: 'cancellation_reversed',
        source: 'stripe_webhook',
        payload: {
          currentPeriodEnd: updatedRecord.current_period_end,
          packageSlug: identity.packageSlug,
          tierSlug: identity.tierSlug,
        },
      });
    }

    if (existingRecord.status !== 'expired' && updatedRecord.status === 'expired') {
      await logLearningSubscriptionEvent({
        subscriptionRecord: updatedRecord,
        eventType: 'period_expired',
        source: 'stripe_webhook',
        payload: {
          currentPeriodEnd: updatedRecord.current_period_end,
          packageSlug: identity.packageSlug,
          tierSlug: identity.tierSlug,
        },
      });
    }

    await recordLearningCouponRedemption({
      subscriptionRecord: updatedRecord,
      checkoutSession,
      stripeSubscription,
    });

    return updatedRecord;
  }

  const createdRecord = await pb.collection('learning_subscriptions').create(payload);
  await logLearningSubscriptionEvent({
    subscriptionRecord: createdRecord,
    eventType: 'subscription_created',
    source: 'stripe_webhook',
    payload: {
      status: createdRecord.status,
      billingInterval,
      packageSlug: identity.packageSlug,
      tierSlug: identity.tierSlug,
      stripePriceIds: identity.candidates.stripePriceIds,
      stripeProductIds: identity.candidates.stripeProductIds,
    },
  });
  await recordLearningCouponRedemption({
    subscriptionRecord: createdRecord,
    checkoutSession,
    stripeSubscription,
  });

  return createdRecord;
};

const syncLearningSubscription = async ({ subscriptionId, checkoutSession = null, fallbackMetadata = {} }) => {
  const id = String(subscriptionId || '').trim();
  if (!id) {
    throw new Error('Missing Stripe subscription id');
  }

  const stripeSubscription = await stripe.subscriptions.retrieve(id);
  const subscriptionRecord = await upsertLearningSubscriptionRecord({
    stripeSubscription,
    checkoutSession,
    fallbackMetadata,
  });

  logger.info(`[WEBHOOK] Learning subscription synchronized - ${id}`);
  return subscriptionRecord;
};

const handleInvoiceStateSynced = async (invoice) => {
  const subscriptionId = getStripeInvoiceSubscriptionId(invoice);
  const subscriptionRecord = await findLearningSubscriptionRecordByStripeId(subscriptionId);
  await upsertLearningInvoiceRecord({ invoice, subscriptionRecord });
};

const ensureMarketplaceMetadata = (metadata) => {
  const { buyer_id, buyer_name, buyer_email, shipping_address, cart_item_ids, type } = metadata || {};

  if (!buyer_id || !buyer_name || !buyer_email || !shipping_address || !cart_item_ids || !type) {
    throw new Error('Missing required metadata fields: buyer_id, buyer_name, buyer_email, shipping_address, cart_item_ids, type');
  }

  if (type !== 'marketplace_order') {
    throw new Error(`Invalid payment type: ${type}`);
  }

  return { buyer_id, buyer_name, buyer_email, shipping_address, cart_item_ids, type };
};

const processMarketplaceOrderUnlocked = async ({ paymentIntentId, session, fallbackMetadata = {} }) => {
  const metadata = session?.metadata || fallbackMetadata || {};
  const { buyer_id, shipping_address, cart_item_ids } = ensureMarketplaceMetadata(metadata);
  const checkoutSessionId = String(session?.id || '').trim();

  const shippingAddress = parseShippingAddress(shipping_address);
  const cartItemIds = parseCartItemIds(cart_item_ids);

  if (cartItemIds.length === 0) {
    throw new Error('No cart items found in metadata');
  }

  const { items: cartItems, missingIds } = await loadCartItems(cartItemIds);

  if (missingIds.length > 0) {
    logger.warn(`[WEBHOOK] Missing cart items while processing PI ${paymentIntentId}: ${missingIds.join(', ')}`);
  }

  if (cartItems.length === 0) {
    if (await hasExistingOrdersForPaymentIntent(paymentIntentId)) {
      logger.info(`[WEBHOOK] Cart items already removed and orders already exist for PI ${paymentIntentId}; treating duplicate event as processed`);
      await syncCheckoutNewsletterOptIn({ metadata, paymentIntentId, checkoutSessionId });
      return;
    }

    throw new Error(`No cart items could be loaded for PI ${paymentIntentId}`);
  }

  for (const cartItem of cartItems) {
    const productId = String(cartItem.product_id).trim();
    const productType = cartItem.product_type === 'shop' ? 'shop' : 'marketplace';
    let sellerId = '';
    let product = null;

    if (productType === 'marketplace') {
      product = await pb.collection('products').getOne(productId);
      sellerId = String(product.seller_id || '').trim();
    } else {
      product = await pb.collection('shop_products').getOne(productId).catch(() => null);
    }

    const existingOrder = await pb.collection('orders')
      .getFirstListItem(`payment_intent_id="${paymentIntentId}" && product_id="${productId}"`)
      .catch(() => null);

    if (existingOrder) {
      logger.info(`[WEBHOOK] Existing order found for PI ${paymentIntentId} and product ${productId}, skipping duplicate create`);
      if (!existingOrder.dhl_tracking_number || !existingOrder.dhl_label_pdf) {
        const buyer = existingOrder.buyer_id
          ? await pb.collection('users').getOne(existingOrder.buyer_id).catch(() => null)
          : null;
        const seller = existingOrder.seller_id
          ? await pb.collection('users').getOne(existingOrder.seller_id).catch(() => null)
          : null;

        await ensureDhlLabelForOrder({
          order: existingOrder,
          product,
          buyer,
          seller,
          productType,
          sellerId,
        });
      }

      await pb.collection('cart_items').delete(cartItem.id).catch(() => { });
      continue;
    }

    await orderHandler({
      buyerId: buyer_id,
      sellerId,
      productId,
      quantity: parseInt(cartItem.quantity, 10) || 1,
      shippingAddress,
      paymentIntentId,
      productType,
      shippingFee: metadata.shipping_fee,
      serviceFee: metadata.service_fee,
      transactionFeePercentage: metadata.transaction_fee_percentage,
    });

    await pb.collection('cart_items').delete(cartItem.id).catch((error) => {
      logger.warn(`[WEBHOOK] Failed to delete cart item ${cartItem.id}: ${error.message}`);
    });
  }

  await syncCheckoutNewsletterOptIn({ metadata, paymentIntentId, checkoutSessionId });
};

const processMarketplaceOrder = async ({ paymentIntentId, session, fallbackMetadata = {} }) => {
  const paymentIntentIdStr = String(paymentIntentId || '').trim();

  if (!paymentIntentIdStr) {
    throw new Error('Missing paymentIntentId for marketplace order processing');
  }

  const existingProcessing = marketplaceOrderProcessingByPaymentIntent.get(paymentIntentIdStr);
  if (existingProcessing) {
    logger.info(`[WEBHOOK] Marketplace order processing already in progress for PI ${paymentIntentIdStr}; waiting for existing run`);
    await existingProcessing;
    return;
  }

  const processing = processMarketplaceOrderUnlocked({ paymentIntentId: paymentIntentIdStr, session, fallbackMetadata })
    .finally(() => {
      marketplaceOrderProcessingByPaymentIntent.delete(paymentIntentIdStr);
    });

  marketplaceOrderProcessingByPaymentIntent.set(paymentIntentIdStr, processing);
  await processing;
};

const getVerificationProductIds = (metadata = {}) => {
  const rawProductIds = metadata.productIds || metadata.product_ids || metadata.productId || metadata.product_id || '';
  const values = Array.isArray(rawProductIds)
    ? rawProductIds
    : String(rawProductIds).split(',');

  return [...new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
};

const processVerificationFee = async ({ paymentIntentId, session, fallbackMetadata = {} }) => {
  const metadata = session?.metadata || fallbackMetadata || {};
  const productIds = getVerificationProductIds(metadata);
  const sellerId = String(metadata.sellerId || metadata.seller_id || '').trim();

  if (productIds.length === 0 || !sellerId) {
    throw new Error('Missing required verification metadata: productIds, sellerId');
  }

  let processedCount = 0;
  for (const productId of productIds) {
    const product = await pb.collection('products').getOne(productId);

    if (String(product.seller_id).trim() != sellerId) {
      throw new Error(`Verification seller mismatch for product ${productId}`);
    }

    const alreadyProcessed =
      product.status === 'pending_verification' ||
      product.status === 'verified' ||
      String(product.verification_payment_intent_id || '').trim() === paymentIntentId;

    if (alreadyProcessed) {
      logger.info(`[WEBHOOK] Verification payment already processed for product ${productId}`);
      continue;
    }

    const now = new Date().toISOString();
    const updatedProduct = await pb.collection('products').update(productId, {
      status: 'pending_verification',
      verification_status: 'pending',
      verification_requested_at: now,
      validation_requested_at: now,
      validation_reviewed_at: '',
      validation_admin_id: '',
      validation_notes: '',
      verification_fee_paid: true,
      verification_fee_paid_at: now,
      verification_payment_intent_id: paymentIntentId,
      verification_checkout_session_id: session?.id || null,
    });

    await createProductVerificationAudit({
      product: updatedProduct,
      status: 'pending',
      verificationFee: metadata.verificationFee,
    });

    processedCount += 1;
  }

  logger.info(`[WEBHOOK] Verification payment processed - Products: ${productIds.join(',')}, Seller: ${sellerId}, Updated: ${processedCount}`);
};

const processSessionByType = async ({ paymentIntentId, session, fallbackMetadata = {} }) => {
  const metadata = session?.metadata || fallbackMetadata || {};
  const type = String(metadata.type || '').trim();

  if (type === 'marketplace_order') {
    await processMarketplaceOrder({ paymentIntentId, session, fallbackMetadata });
    return;
  }

  if (type === 'verification_fee') {
    await processVerificationFee({ paymentIntentId, session, fallbackMetadata });
    return;
  }

  if (type === 'learning_subscription') {
    const subscriptionId = typeof session?.subscription === 'string'
      ? session.subscription
      : String(session?.subscription?.id || fallbackMetadata.subscription_id || '').trim();
    await syncLearningSubscription({
      subscriptionId,
      checkoutSession: session,
      fallbackMetadata,
    });
    await syncCheckoutNewsletterOptIn({
      metadata,
      paymentIntentId,
      checkoutSessionId: String(session?.id || '').trim(),
    });
    return;
  }

  logger.info(`[WEBHOOK] Ignoring payment/session with unsupported metadata type: ${type || 'missing'}`);
};

const handlePaymentIntentSucceeded = async (paymentIntent) => {
  const paymentIntentId = String(paymentIntent.id).trim();

  if (paymentIntent.status !== 'succeeded') {
    throw new Error(`Payment intent not succeeded: ${paymentIntent.status}`);
  }

  const session = await findSessionByPaymentIntent(paymentIntentId);

  await processSessionByType({
    paymentIntentId,
    session,
    fallbackMetadata: paymentIntent.metadata || {},
  });
};

const handleCheckoutSessionCompleted = async (session) => {
  const sessionType = String(session.metadata?.type || '').trim();

  if (session.mode === 'subscription' || sessionType === 'learning_subscription') {
    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : String(session.subscription?.id || '').trim();
    if (!subscriptionId) {
      throw new Error('checkout.session.completed for subscription flow without subscription id');
    }

    await syncLearningSubscription({
      subscriptionId,
      checkoutSession: session,
      fallbackMetadata: session.metadata || {},
    });
    return;
  }

  if (session.payment_status !== 'paid') {
    throw new Error(`Checkout session not paid: ${session.payment_status}`);
  }

  const paymentIntentId = String(session.payment_intent || '').trim();
  if (!paymentIntentId) {
    throw new Error('checkout.session.completed without payment_intent');
  }

  await processSessionByType({
    paymentIntentId,
    session,
    fallbackMetadata: session.metadata || {},
  });
};

const handleCustomerSubscriptionUpdated = async (subscription) => {
  const existingRecord = await findLearningSubscriptionRecordByStripeId(subscription.id);
  if (!existingRecord && !hasLearningSubscriptionLookupCandidates({
    metadata: subscription.metadata || {},
    stripeSubscription: subscription,
  })) {
    logger.info(`[WEBHOOK] Ignoring customer.subscription.updated for non-learning subscription ${subscription.id}`);
    return;
  }

  const fullSubscription = await stripe.subscriptions.retrieve(subscription.id);
  const identity = await resolveLearningSubscriptionIdentity({
    stripeSubscription: fullSubscription,
    fallbackMetadata: subscription.metadata || {},
  });
  await upsertLearningSubscriptionRecord({
    stripeSubscription: fullSubscription,
    fallbackMetadata: subscription.metadata || {},
    resolvedIdentity: identity,
  });
};

const handleCustomerSubscriptionDeleted = async (subscription) => {
  const subscriptionId = String(subscription.id || '').trim();
  if (!subscriptionId) {
    return;
  }

  let existingRecord = await findLearningSubscriptionRecordByStripeId(subscriptionId);

  if (!existingRecord) {
    if (!hasLearningSubscriptionLookupCandidates({
      metadata: subscription.metadata || {},
      stripeSubscription: subscription,
    })) {
      return;
    }

    await upsertLearningSubscriptionRecord({
      stripeSubscription: subscription,
      fallbackMetadata: subscription.metadata || {},
    });

    existingRecord = await findLearningSubscriptionRecordByStripeId(subscriptionId);

    if (!existingRecord) {
      return;
    }
  }

  const fullSubscription = await stripe.subscriptions.retrieve(subscriptionId).catch(() => subscription);
  const accessEndsAt = getSubscriptionAccessEndsAt(fullSubscription);
  const hasRemainingPaidAccess = accessEndsAt && new Date(accessEndsAt).getTime() > Date.now();
  const savedRecord = await pb.collection('learning_subscriptions').update(existingRecord.id, {
    status: hasRemainingPaidAccess ? 'canceled' : 'expired',
    cancel_at_period_end: hasRemainingPaidAccess,
    canceled_at: new Date().toISOString(),
    access_ends_at: accessEndsAt || new Date().toISOString(),
    grace_ends_at: '',
  });

  await logLearningSubscriptionEvent({
    subscriptionRecord: savedRecord,
    eventType: savedRecord.status === 'expired' ? 'period_expired' : 'cancellation_scheduled',
    source: 'stripe_webhook',
    payload: {
      currentPeriodEnd: savedRecord.current_period_end,
    },
  });
};

const handleInvoicePaymentFailed = async (invoice) => {
  const subscriptionId = getStripeInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    return;
  }

  let existingRecord = await findLearningSubscriptionRecordByStripeId(subscriptionId);

  if (!existingRecord) {
    await syncLearningSubscription({
      subscriptionId,
      fallbackMetadata: invoice.parent?.subscription_details?.metadata || invoice.lines?.data?.[0]?.metadata || {},
    }).catch((error) => {
      logger.warn(`[WEBHOOK] Could not sync missing learning subscription ${subscriptionId} after failed invoice: ${error.message}`);
    });

    existingRecord = await findLearningSubscriptionRecordByStripeId(subscriptionId);

    if (!existingRecord) {
      return;
    }
  }

  const nextStatus = ACTIVE_LEARNING_SUBSCRIPTION_STATUSES.has(existingRecord.status) ? 'past_due' : 'unpaid';
  const savedRecord = await pb.collection('learning_subscriptions').update(existingRecord.id, {
    status: nextStatus,
    grace_ends_at: getGraceEndsAt({ stripeSubscription: { current_period_end: invoice.lines?.data?.[0]?.period?.end }, fallbackFromNow: true }),
    last_payment_failed_at: new Date().toISOString(),
  });
  await upsertLearningInvoiceRecord({ invoice, subscriptionRecord: savedRecord });

  await logLearningSubscriptionEvent({
    subscriptionRecord: savedRecord,
    eventType: 'payment_failed',
    source: 'stripe_webhook',
    payload: {
      invoiceId: invoice.id,
      amountDue: Number(invoice.amount_due || 0) / 100,
      status: nextStatus,
    },
  });
};

const handleInvoicePaymentSucceeded = async (invoice) => {
  const subscriptionId = getStripeInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    return;
  }

  await syncLearningSubscription({
    subscriptionId,
    fallbackMetadata: invoice.parent?.subscription_details?.metadata || invoice.lines?.data?.[0]?.metadata || {},
  });

  const existingRecord = await findLearningSubscriptionRecordByStripeId(subscriptionId);
  await upsertLearningInvoiceRecord({ invoice, subscriptionRecord: existingRecord });

  await logLearningSubscriptionEvent({
    subscriptionRecord: existingRecord,
    stripeSubscriptionId: subscriptionId,
    eventType: String(invoice.billing_reason || '') === 'subscription_create' ? 'first_payment_succeeded' : 'recurring_charge_succeeded',
    source: 'stripe_webhook',
    payload: {
      invoiceId: invoice.id,
      amountPaid: Number(invoice.amount_paid || 0) / 100,
      billingReason: invoice.billing_reason || '',
    },
  });
};

const handleChargeDisputeCreated = async (dispute) => {
  const paymentIntentId = String(dispute.payment_intent || '').trim();
  if (!paymentIntentId) {
    return;
  }

  const { subscriptionId, invoice, source } = await resolveSubscriptionFromPaymentIntent(paymentIntentId);
  if (!subscriptionId) {
    return;
  }

  const existingRecord = await pb.collection('learning_subscriptions')
    .getFirstListItem(`stripe_subscription_id="${subscriptionId}"`)
    .catch(() => null);

  if (!existingRecord) {
    return;
  }

  if (invoice) {
    await upsertLearningInvoiceRecord({ invoice, subscriptionRecord: existingRecord });
  }

  const savedRecord = await pb.collection('learning_subscriptions').update(existingRecord.id, {
    status: 'unpaid',
    access_ends_at: new Date().toISOString(),
    grace_ends_at: '',
    last_payment_failed_at: new Date().toISOString(),
  });

  await logLearningSubscriptionEvent({
    subscriptionRecord: savedRecord,
    eventType: 'chargeback_manual_block',
    source: 'stripe_webhook',
    payload: {
      disputeId: dispute.id,
      reason: dispute.reason || '',
      amount: Number(dispute.amount || 0) / 100,
      currency: String(dispute.currency || 'eur').toUpperCase(),
      paymentIntentId,
      lookupSource: source,
    },
  });
};

const handleRefundSynced = async (refund) => {
  const returnId = String(refund?.metadata?.return_id || '').trim();
  if (!returnId) {
    return;
  }

  await pb.collection('returns').update(returnId, {
    stripe_refund_id: refund.id || '',
    refund_status: refund.status || '',
    refund_amount: Number(refund.amount || 0) / 100,
    refund_processed_at: refund.created ? toIsoString(refund.created) : new Date().toISOString(),
    refund_failure: refund.failure_reason || '',
  }).catch((error) => {
    logger.warn(`[WEBHOOK] Could not sync Stripe refund ${refund?.id || ''} to return ${returnId}: ${error.message}`);
  });
};

const handleChargeRefunded = async (charge) => {
  const refunds = Array.isArray(charge?.refunds?.data) ? charge.refunds.data : [];
  await Promise.all(refunds.map((refund) => handleRefundSynced(refund)));
};

const handleWebhookEvent = async (event) => {
  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(event.data.object);
      break;
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleCustomerSubscriptionUpdated(event.data.object);
      break;
    case 'customer.subscription.deleted':
      await handleCustomerSubscriptionDeleted(event.data.object);
      break;
    case 'invoice.created':
    case 'invoice.finalized':
    case 'invoice.updated':
    case 'invoice.voided':
    case 'invoice.marked_uncollectible':
      await handleInvoiceStateSynced(event.data.object);
      break;
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(event.data.object);
      break;
    case 'refund.created':
    case 'refund.updated':
      await handleRefundSynced(event.data.object);
      break;
    case 'charge.refunded':
      await handleChargeRefunded(event.data.object);
      break;
    case 'charge.dispute.created':
      await handleChargeDisputeCreated(event.data.object);
      break;
    default:
      logger.info(`[WEBHOOK] Ignoring event type: ${event.type}`);
      break;
  }
};

export default stripeWebhookHandler;
