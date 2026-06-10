import 'dotenv/config';
import express from 'express';
import Stripe from 'stripe';
import logger from '../utils/logger.js';
import { getPlatformSettings } from '../utils/platformSettings.js';
import { normalizeCountryCode } from '../utils/countryCodes.js';
import pb from '../utils/pocketbaseClient.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ============================================================================
// CONFIGURABLE FEES AND URLS FROM ENVIRONMENT VARIABLES
// ============================================================================

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://zahniboerse.com';
logger.info('[CHECKOUT] Configuration loaded from environment variables');
logger.info(`[CHECKOUT] Frontend URL: ${FRONTEND_URL}`);
// ============================================================================
// CART ITEM NORMALIZATION
// ============================================================================

/**
 * Normalize a single cart item to standardized format
 * Handles both nested (item.product.id) and flat (item.product_id) formats
 * Extracts: id, product_id, product_name, product_price, seller_id, quantity
 * @param {Object} item - Cart item in any format
 * @param {number} index - Item index for error reporting
 * @returns {Object} Normalized item with all required fields
 * @throws {Error} If any required field is missing
 */
const normalizeCartItem = (item, index) => {
  const itemIndex = index + 1;

  logger.info(`[CHECKOUT] Normalizing cart item ${itemIndex} - Keys: ${Object.keys(item || {}).join(', ')}`);

  if (!item || typeof item !== 'object') {
    logger.error(`[CHECKOUT] Invalid cart item at index ${itemIndex} - Not an object`);
    throw new Error(`Cart item ${itemIndex}: must be an object`);
  }

  // Extract item ID
  const itemId = item.id || item.cart_item_id;
  if (!itemId) {
    logger.error(`[CHECKOUT] Missing item ID at index ${itemIndex}`);
    throw new Error(`Cart item ${itemIndex}: missing 'id' field`);
  }

  // Extract quantity
  const quantity = item.quantity || 1;
  if (!quantity || quantity < 1) {
    logger.error(`[CHECKOUT] Invalid quantity at index ${itemIndex} - Quantity: ${quantity}`);
    throw new Error(`Cart item ${itemIndex}: quantity must be >= 1`);
  }

  // Extract product info from nested structure (item.product) or flat structure
  let productId = null;
  let productName = null;
  let productPrice = null;
  let sellerId = null;
  const productType = item.product_type === 'shop' ? 'shop' : 'marketplace';

  if (item.product && typeof item.product === 'object') {
    // Nested structure: item.product.id, item.product.name, etc.
    logger.info(`[CHECKOUT] Extracting from nested product object at index ${itemIndex}`);
    productId = item.product.id;
    productName = item.product.name;
    productPrice = item.product.price;
    sellerId = item.product.seller_id;
  }

  // Fallback to flat structure if nested not found
  if (!productId) {
    logger.info(`[CHECKOUT] Nested product not found, trying flat structure at index ${itemIndex}`);
    productId = item.product_id;
    productName = item.product_name;
    productPrice = item.product_price;
    sellerId = item.seller_id;
  }

  // Validate all required fields
  const missingFields = [];

  if (!productId) {
    missingFields.push('product_id (from item.product.id or item.product_id)');
  }
  if (!productName) {
    missingFields.push('product_name (from item.product.name or item.product_name)');
  }
  if (productPrice === undefined || productPrice === null) {
    missingFields.push('product_price (from item.product.price or item.product_price)');
  }
  if (!sellerId && productType !== 'shop') {
    missingFields.push('seller_id (from item.product.seller_id or item.seller_id)');
  }

  if (missingFields.length > 0) {
    logger.error(`[CHECKOUT] Missing required fields in cart item ${itemIndex} - Fields: ${missingFields.join(', ')}`);
    throw new Error(`Cart item ${itemIndex}: missing required fields - ${missingFields.join(', ')}`);
  }

  // Normalize to standardized format
  const normalizedItem = {
    id: String(itemId).trim(),
    product_id: String(productId).trim(),
    product_name: String(productName).trim(),
    product_price: parseFloat(productPrice),
    seller_id: sellerId ? String(sellerId).trim() : '',
    product_type: productType,
    quantity: productType === 'shop' ? parseInt(quantity, 10) : 1,
  };

  logger.info(`[CHECKOUT] Cart item normalized successfully at index ${itemIndex} - Product: ${normalizedItem.product_id}, Price: €${normalizedItem.product_price}, Quantity: ${normalizedItem.quantity}`);

  return normalizedItem;
};

/**
 * Normalize array of cart items
 * @param {Array} cartItems - Array of cart items in any format
 * @returns {Array} Array of normalized items
 * @throws {Error} If any item is invalid
 */
const normalizeCartItems = (cartItems) => {
  if (!Array.isArray(cartItems)) {
    logger.error('[CHECKOUT] cart_items is not an array');
    throw new Error('cart_items must be an array');
  }

  if (cartItems.length === 0) {
    logger.error('[CHECKOUT] cart_items array is empty');
    throw new Error('cart_items cannot be empty');
  }

  logger.info(`[CHECKOUT] Normalizing ${cartItems.length} cart items`);

  const normalizedItems = cartItems.map((item, index) => normalizeCartItem(item, index));

  logger.info(`[CHECKOUT] All ${normalizedItems.length} cart items normalized successfully`);

  return normalizedItems;
};

const normalizeShippingAddress = (shippingAddress) => {
  if (!shippingAddress || typeof shippingAddress !== 'object') {
    return shippingAddress;
  }

  return {
    ...shippingAddress,
    country: normalizeCountryCode(shippingAddress.country || 'DE'),
  };
};

const parseBooleanInput = (value) => {
  if (value === true) return true;
  if (value === false || value === undefined || value === null) return false;

  const normalized = String(value).trim().toLowerCase();
  return ['true', '1', 'yes', 'on'].includes(normalized);
};

const validateShopCartItemStock = async (items) => {
  for (const item of items) {
    if (item.product_type !== 'shop') {
      continue;
    }

    const product = await pb.collection('shop_products').getOne(item.product_id, { $autoCancel: false }).catch(() => null);

    if (!product) {
      return {
        valid: false,
        code: 'SHOP_PRODUCT_NOT_FOUND',
        error: `Shop product ${item.product_id} is no longer available`,
      };
    }

    const stockQuantity = Math.max(0, Number(product.stock_quantity || 0));
    if (item.quantity > stockQuantity) {
      return {
        valid: false,
        code: 'OUT_OF_STOCK',
        error: `${product.name || item.product_name} has only ${stockQuantity} in stock`,
        productId: item.product_id,
        stockQuantity,
      };
    }

    item.product_name = String(product.name || item.product_name).trim();
    item.product_price = Number(product.price || item.product_price || 0);
  }

  return { valid: true };
};

// ============================================================================
// STRIPE CHECKOUT SESSION CREATION
// ============================================================================

/**
 * POST /checkout/create-session
 * Create Stripe Checkout Session for marketplace order
 *
 * FEATURES:
 * 1. VALIDATION: Check all required fields (buyer_id, buyer_name, buyer_email, shipping_address, cart_items)
 * 2. CART ITEM NORMALIZATION: Handle both nested and flat formats
 * 3. BUILD STRIPE LINE ITEMS: Map normalized items to Stripe format
 * 4. PREPARE METADATA: Create metadata with all required fields
 * 5. VALIDATE METADATA SIZE: Check each field <= 500 characters
 * 6. CREATE STRIPE SESSION: Call stripe.checkout.sessions.create()
 * 7. COMPREHENSIVE LOGGING: Log at every step with context
 * 8. ERROR HANDLING: Throw errors so errorMiddleware catches them
 * 9. RESPONSE: Return 200 JSON with sessionId and url
 *
 * Request body:
 * - buyer_id (required): Buyer user ID
 * - buyer_name (required): Buyer name
 * - buyer_email (required): Buyer email
 * - shipping_address (required): Shipping address object
 *   {name, street, postalCode, city, country}
 * - cart_items (required): Array of cart items
 *   Nested: {id, product: {id, name, price, seller_id}, quantity}
 *   Flat: {id, product_id, product_name, product_price, seller_id, quantity}
 *
 * Response (200):
 * {
 *   success: true,
 *   sessionId: string,
 *   url: string (Stripe checkout URL)
 * }
 *
 * Error responses:
 * - 400: Missing required fields, invalid cart items, metadata too large
 * - 500: Stripe API error
 */
router.post('/create-session', async (req, res) => {
  const { buyer_id, buyer_name, buyer_email, shipping_address, cart_items } = req.body;
  const acceptedTerms = parseBooleanInput(req.body?.acceptedTerms ?? req.body?.accepted_terms);
  const acceptedPrivacy = parseBooleanInput(req.body?.acceptedPrivacy ?? req.body?.accepted_privacy);
  const newsletterOptIn = parseBooleanInput(req.body?.newsletterOptIn ?? req.body?.newsletter_opt_in);
  const timestamp = new Date().toISOString();

  logger.info(`[CHECKOUT] Create session request received - Timestamp: ${timestamp}`);
  logger.info(`[CHECKOUT] Request body keys: ${Object.keys(req.body).join(', ')}`);

  // ========================================================================
  // STEP 1: VALIDATION - Check all required fields
  // ========================================================================
  logger.info('[CHECKOUT] STEP 1: Validating required fields...');

  const missingFields = [];

  if (!buyer_id) {
    missingFields.push('buyer_id');
  }
  if (!buyer_name) {
    missingFields.push('buyer_name');
  }
  if (!buyer_email) {
    missingFields.push('buyer_email');
  }
  if (!shipping_address) {
    missingFields.push('shipping_address');
  }
  if (!cart_items) {
    missingFields.push('cart_items');
  }

  if (missingFields.length > 0) {
    logger.warn(`[CHECKOUT] Missing required fields: ${missingFields.join(', ')}`);
    return res.status(400).json({
      code: 'MISSING_REQUIRED_FIELDS',
      error: 'Missing required fields',
      missingFields: missingFields,
    });
  }

  if (!acceptedTerms || !acceptedPrivacy) {
    logger.warn(`[CHECKOUT] Legal acceptance missing - Terms: ${acceptedTerms}, Privacy: ${acceptedPrivacy}, Buyer: ${buyer_id || 'unknown'}`);
    return res.status(400).json({
      code: 'LEGAL_ACCEPTANCE_REQUIRED',
      error: 'Terms and privacy acceptance are required before checkout',
      required: {
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
    });
  }

  logger.info('[CHECKOUT] All required fields present');

  const normalizedShippingAddress = normalizeShippingAddress(shipping_address);

  // Ensure all values are strings
  const buyerIdStr = String(buyer_id).trim();
  const buyerNameStr = String(buyer_name).trim();
  const buyerEmailStr = String(buyer_email).trim();

  logger.info(`[CHECKOUT] Buyer details - ID: ${buyerIdStr}, Name: ${buyerNameStr}, Email: ${buyerEmailStr}`);

  // ========================================================================
  // STEP 2: CART ITEM NORMALIZATION
  // ========================================================================
  logger.info('[CHECKOUT] STEP 2: Normalizing cart items...');

  let normalizedItems;
  try {
    normalizedItems = normalizeCartItems(cart_items);
  } catch (normalizationError) {
    logger.error(`[CHECKOUT] Cart item normalization failed - Error: ${normalizationError.message}`);
    return res.status(400).json({
      code: 'INVALID_CART_ITEMS',
      error: 'Invalid cart items',
      details: normalizationError.message,
    });
  }

  logger.info(`[CHECKOUT] Cart items normalized successfully - Count: ${normalizedItems.length}`);

  // ========================================================================
  // STEP 3: BUILD STRIPE LINE ITEMS
  // ========================================================================
  logger.info('[CHECKOUT] STEP 3: Building Stripe line items...');

  const fees = await getPlatformSettings();
  const shippingFee = fees.shipping_fee;
  const serviceFee = fees.service_fee;

  if (!fees.shop_enabled && normalizedItems.some((item) => item.product_type === 'shop')) {
    logger.warn(`[CHECKOUT] Shop checkout blocked while shop is disabled - Buyer: ${buyerIdStr}`);
    return res.status(403).json({
      code: 'SHOP_DISABLED',
      error: 'The official shop is currently unavailable',
    });
  }

  const shopStockValidation = await validateShopCartItemStock(normalizedItems);
  if (!shopStockValidation.valid) {
    logger.warn(`[CHECKOUT] Shop stock validation failed - Code: ${shopStockValidation.code}, Buyer: ${buyerIdStr}`);
    return res.status(400).json(shopStockValidation);
  }

  let subtotal = 0;
  const lineItems = [];

  for (let i = 0; i < normalizedItems.length; i++) {
    const item = normalizedItems[i];
    const itemIndex = i + 1;

    const itemPrice = item.product_price || 0;
    const itemQuantity = item.quantity || 1;
    const itemTotal = itemPrice * itemQuantity;
    subtotal += itemTotal;

    logger.info(`[CHECKOUT] Processing line item ${itemIndex}/${normalizedItems.length} - Product: ${item.product_id}, Name: ${item.product_name}, Price: €${itemPrice.toFixed(2)}, Quantity: ${itemQuantity}, Total: €${itemTotal.toFixed(2)}`);

    // Add to Stripe line items with metadata
    lineItems.push({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.product_name,
          metadata: {
            product_id: item.product_id,
            seller_id: item.seller_id || '',
            product_type: item.product_type,
          },
        },
        unit_amount: Math.round(itemPrice * 100), // Convert to cents
      },
      quantity: itemQuantity,
    });
  }

  const totalAmount = subtotal + shippingFee + serviceFee;

  logger.info(`[CHECKOUT] Calculating totals - Subtotal: EUR ${subtotal.toFixed(2)}, Shipping: EUR ${shippingFee.toFixed(2)}, Service: EUR ${serviceFee.toFixed(2)}, Total: EUR ${totalAmount.toFixed(2)}`);

  // Add shipping fee as line item
  lineItems.push({
    price_data: {
      currency: 'eur',
      product_data: {
        name: 'Shipping Fee',
      },
      unit_amount: Math.round(shippingFee * 100),
    },
    quantity: 1,
  });

  // Add service fee as line item
  lineItems.push({
    price_data: {
      currency: 'eur',
      product_data: {
        name: 'Service Fee',
      },
      unit_amount: Math.round(serviceFee * 100),
    },
    quantity: 1,
  });

  logger.info(`[CHECKOUT] Stripe line items built - Count: ${lineItems.length}`);

  // ========================================================================
  // STEP 4: PREPARE METADATA
  // ========================================================================
  logger.info('[CHECKOUT] STEP 4: Preparing metadata...');

  // Store only cart_item IDs as comma-separated string
  const cartItemIds = normalizedItems.map(item => item.id).join(',');

  const metadata = {
    buyer_id: buyerIdStr,
    buyer_name: buyerNameStr,
    buyer_email: buyerEmailStr,
    shipping_address: JSON.stringify(normalizedShippingAddress),
    cart_item_ids: cartItemIds,
    type: 'marketplace_order',
    shipping_fee: String(shippingFee),
    service_fee: String(serviceFee),
    transaction_fee_percentage: String(fees.transaction_fee_percentage),
    accepted_terms: 'true',
    accepted_privacy: 'true',
    legal_accepted_at: timestamp,
    newsletter_opt_in: newsletterOptIn ? 'true' : 'false',
  };

  logger.info(`[CHECKOUT] Metadata prepared - Keys: ${Object.keys(metadata).join(', ')}`);
  logger.info(`[CHECKOUT] Metadata object: ${JSON.stringify(metadata, null, 2)}`);

  // ========================================================================
  // STEP 5: VALIDATE METADATA SIZE
  // ========================================================================
  logger.info('[CHECKOUT] STEP 5: Validating metadata field sizes...');

  const metadataErrors = [];

  Object.entries(metadata).forEach(([key, value]) => {
    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
    const valueLength = valueStr.length;

    logger.info(`[CHECKOUT] Metadata field '${key}' - Length: ${valueLength} characters`);

    if (valueLength > 500) {
      logger.error(`[CHECKOUT] Metadata field '${key}' exceeds 500 character limit - Length: ${valueLength}`);
      metadataErrors.push(`Field '${key}': ${valueLength} characters (max 500)`);
    }
  });

  if (metadataErrors.length > 0) {
    logger.error(`[CHECKOUT] Metadata validation failed - Errors: ${metadataErrors.join(', ')}`);
    return res.status(400).json({
      code: 'METADATA_TOO_LARGE',
      error: 'Metadata fields exceed size limit',
      details: metadataErrors,
    });
  }

  logger.info('[CHECKOUT] All metadata fields validated - All under 500 characters');

  // ========================================================================
  // STEP 6: CREATE STRIPE SESSION
  // ========================================================================
  logger.info('[CHECKOUT] STEP 6: Creating Stripe checkout session...');
  logger.info(`[CHECKOUT] Stripe session parameters - Items: ${lineItems.length}, Total: €${totalAmount.toFixed(2)}, Customer Email: ${buyerEmailStr}`);

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      line_items: lineItems,
      mode: 'payment',
      customer_email: buyerEmailStr,
      metadata: metadata,
      success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/checkout-cancel`,
    });

    logger.info(`[CHECKOUT] Stripe checkout session created successfully`);
    logger.info(`[CHECKOUT] Session ID: ${session.id}`);
    logger.info(`[CHECKOUT] Session URL: ${session.url}`);
    logger.info(`[CHECKOUT] Payment Status: ${session.payment_status}`);
    logger.info(`[CHECKOUT] Amount Total: ${session.amount_total / 100} EUR`);
  } catch (stripeError) {
    logger.error(`[CHECKOUT] Stripe session creation failed`);
    logger.error(`[CHECKOUT] Error: ${stripeError.message}`);
    logger.error(`[CHECKOUT] Stack trace: ${stripeError.stack}`);
    return res.status(502).json({
      code: 'PAYMENT_SESSION_CREATE_FAILED',
      error: 'Unable to create payment session. Please try again.',
    });
  }

  // ========================================================================
  // STEP 7: RETURN SUCCESS RESPONSE
  // ========================================================================
  logger.info(`[CHECKOUT] Checkout session creation completed successfully`);
  logger.info(`[CHECKOUT] Session: ${session.id}`);
  logger.info(`[CHECKOUT] Buyer: ${buyerIdStr}`);
  logger.info(`[CHECKOUT] Items: ${normalizedItems.length}`);
  logger.info(`[CHECKOUT] Total: €${totalAmount.toFixed(2)}`);

  res.status(200).json({
    success: true,
    sessionId: session.id,
    url: session.url,
  });
});

/**
 * GET /checkout/session/:sessionId
 * Retrieve Stripe checkout session details
 *
 * Path parameters:
 * - sessionId (required): Stripe session ID
 *
 * Response (200):
 * {
 *   id: string,
 *   status: string (paid, unpaid, no_payment_required),
 *   amountTotal: number (in cents),
 *   customerEmail: string,
 *   metadata: object,
 *   paymentIntentId: string
 * }
 */
router.get('/session/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const sessionIdStr = String(sessionId).trim();
  const timestamp = new Date().toISOString();

  logger.info(`[CHECKOUT] Retrieve session request - Timestamp: ${timestamp}`);
  logger.info(`[CHECKOUT] Session ID: ${sessionIdStr}`);

  if (!sessionIdStr) {
    logger.warn('[CHECKOUT] Missing sessionId in path');
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    logger.info(`[CHECKOUT] Fetching session from Stripe - ID: ${sessionIdStr}`);
    const session = await stripe.checkout.sessions.retrieve(sessionIdStr);

    logger.info(`[CHECKOUT] Session retrieved successfully`);
    logger.info(`[CHECKOUT] Session ID: ${session.id}`);
    logger.info(`[CHECKOUT] Payment Status: ${session.payment_status}`);
    logger.info(`[CHECKOUT] Amount Total: ${session.amount_total / 100} EUR`);
    logger.info(`[CHECKOUT] Customer Email: ${session.customer_details?.email || 'N/A'}`);
    logger.info(`[CHECKOUT] Payment Intent: ${session.payment_intent || 'N/A'}`);

    res.status(200).json({
      id: session.id,
      status: session.payment_status,
      amountTotal: session.amount_total,
      customerEmail: session.customer_details?.email,
      metadata: session.metadata,
      paymentIntentId: session.payment_intent,
    });
  } catch (stripeError) {
    logger.error(`[CHECKOUT] Failed to retrieve session`);
    logger.error(`[CHECKOUT] Session ID: ${sessionIdStr}`);
    logger.error(`[CHECKOUT] Error: ${stripeError.message}`);
    throw stripeError;
  }
});

export default router;
