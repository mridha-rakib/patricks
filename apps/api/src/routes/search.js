import express from 'express';
import pb from '../utils/pocketbaseClient.js';
import { getPublicPocketBaseFileUrl } from '../utils/fileUrls.js';
import logger from '../utils/logger.js';
import { getPlatformSettings } from '../utils/platformSettings.js';

const router = express.Router();

const escapeFilterValue = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const getProductImages = (record) => (
  Array.isArray(record.images) ? record.images : record.images ? [record.images] : []
);

const getProductImageUrl = (record) => {
  const image = getProductImages(record)[0] || record.image || '';
  return getPublicPocketBaseFileUrl(record, image);
};

const formatProduct = (record, source) => ({
  id: record.id,
  collectionId: record.collectionId,
  collectionName: record.collectionName,
  name: record.name,
  description: record.description || '',
  price: record.price,
  image: record.image || null,
  images: getProductImages(record),
  image_url: getProductImageUrl(record),
  condition: record.condition || null,
  brand: record.brand || '',
  location: record.location || '',
  shipping_type: record.shipping_type || 'dhl_parcel',
  fachbereich: record.fachbereich || [],
  product_type: record.product_type || (source === 'shop' ? 'shop' : 'Article'),
  source,
});

const getMarketplaceSearchFilter = async (search) => {
  const filters = [
    `(name~"${search}" || description~"${search}" || seller_username~"${search}")`,
    'status="active"',
    'seller_id != ""',
    'shop_product != true',
  ];

  const adminUsers = await pb.collection('users').getFullList({
    filter: 'is_admin=true',
    fields: 'id',
    $autoCancel: false,
  }).catch((error) => {
    logger.warn(`[SEARCH] Failed to load admin users for marketplace filter: ${error.message}`);
    return [];
  });

  adminUsers.forEach((user) => {
    filters.push(`seller_id != "${escapeFilterValue(user.id)}"`);
  });

  return filters.join(' && ');
};

router.get('/', async (req, res) => {
  const query = String(req.query.query || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 8, 20);

  if (query.length < 2) {
    return res.json({ items: [] });
  }

  const search = escapeFilterValue(query);
  const settings = await getPlatformSettings();
  const marketplaceFilter = await getMarketplaceSearchFilter(search);
  const shopFilter = `(name~"${search}" || description~"${search}")`;

  const [marketplaceProducts, shopProducts] = await Promise.all([
    pb.collection('products').getList(1, limit, {
      filter: marketplaceFilter,
      sort: '-created',
    }).catch((error) => {
      logger.warn(`[SEARCH] Marketplace search failed: ${error.message}`);
      return { items: [] };
    }),
    settings.shop_enabled
      ? pb.collection('shop_products').getList(1, limit, {
          filter: shopFilter,
          sort: '-created',
        }).catch((error) => {
          logger.warn(`[SEARCH] Shop search failed: ${error.message}`);
          return { items: [] };
        })
      : Promise.resolve({ items: [] }),
  ]);

  const items = [
    ...marketplaceProducts.items.map((record) => formatProduct(record, 'marketplace')),
    ...shopProducts.items.map((record) => formatProduct(record, 'shop')),
  ].slice(0, limit);

  res.json({ items });
});

export default router;
