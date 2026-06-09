import express from 'express';
import pb from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { buildDynamicProductFilters, getShopFilterDefinitions } from '../utils/shopFilters.js';
import { getPublicPocketBaseFileUrl } from '../utils/fileUrls.js';
import { getPlatformSettings } from '../utils/platformSettings.js';

const router = express.Router();

const SORT_OPTIONS = new Set(['-created', 'created', 'price', '-price']);

const getProductImages = (product) => (
  Array.isArray(product.images) ? product.images : product.images ? [product.images] : []
);

const getProductImageUrl = (product, imageName = '') => {
  const resolvedImage = imageName || getProductImages(product)[0] || product.image || '';
  return getPublicPocketBaseFileUrl(product, resolvedImage);
};

const normalizeShopProduct = (product) => ({
  id: product.id,
  collectionId: product.collectionId,
  collectionName: product.collectionName,
  name: product.name,
  description: product.description || '',
  price: product.price,
  image: product.image || null,
  images: getProductImages(product),
  image_urls: getProductImages(product).map((imageName) => getProductImageUrl(product, imageName)).filter(Boolean),
  image_url: getProductImageUrl(product),
  condition: product.condition || null,
  fachbereich: Array.isArray(product.fachbereich)
    ? product.fachbereich
    : product.fachbereich
      ? [product.fachbereich]
      : [],
  product_type: product.product_type || 'Article',
  brand: product.brand || '',
  location: product.location || '',
  shipping_type: product.shipping_type || 'dhl_parcel',
  filter_values: product.filter_values || {},
  source: 'shop',
  created: product.created,
  updated: product.updated,
});

router.get('/filters', async (_req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    if (!settings.shop_enabled) {
      return res.status(403).json({ error: 'Official shop is currently unavailable.' });
    }

    const filters = await getShopFilterDefinitions('shop');
    res.json({ items: filters });
  } catch (error) {
    logger.error(`[SHOP] Failed to fetch filter definitions: ${error.message}`, { stack: error.stack });
    next(error);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    if (!settings.shop_enabled) {
      return res.status(403).json({ error: 'Official shop is currently unavailable.' });
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const perPage = Math.min(Math.max(parseInt(req.query.perPage, 10) || 50, 1), 100);
    const sort = SORT_OPTIONS.has(req.query.sort) ? req.query.sort : '-created';
    const filterDefinitions = await getShopFilterDefinitions('shop');
    const filters = buildDynamicProductFilters({ query: req.query, definitions: filterDefinitions });

    const result = await pb.collection('shop_products').getList(page, perPage, {
      filter: filters.length > 0 ? filters.join(' && ') : undefined,
      sort,
      $autoCancel: false,
    });

    res.json({
      items: result.items.map(normalizeShopProduct),
      total: result.totalItems,
      page: result.page,
      perPage: result.perPage,
      totalPages: result.totalPages,
      filters: filterDefinitions,
    });
  } catch (error) {
    logger.error(`[SHOP] Failed to fetch official shop products: ${error.message}`, { stack: error.stack });
    next(error);
  }
});

export default router;
