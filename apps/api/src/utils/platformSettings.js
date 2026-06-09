import pb from './pocketbaseClient.js';
import logger from './logger.js';

export const DEFAULT_PLATFORM_SETTINGS = Object.freeze({
  shipping_fee: 4.99,
  service_fee: 1.99,
  transaction_fee_percentage: 7,
  verification_fee: 15,
  shop_enabled: false,
});

const toFiniteNumber = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

export const normalizePlatformSettings = (settings = {}) => ({
  shipping_fee: toFiniteNumber(settings.shipping_fee, DEFAULT_PLATFORM_SETTINGS.shipping_fee),
  service_fee: toFiniteNumber(settings.service_fee, DEFAULT_PLATFORM_SETTINGS.service_fee),
  transaction_fee_percentage: toFiniteNumber(
    settings.transaction_fee_percentage ?? settings.transaction_fee_percent,
    DEFAULT_PLATFORM_SETTINGS.transaction_fee_percentage,
  ),
  verification_fee: toFiniteNumber(settings.verification_fee, DEFAULT_PLATFORM_SETTINGS.verification_fee),
  shop_enabled: toBoolean(settings.shop_enabled, DEFAULT_PLATFORM_SETTINGS.shop_enabled),
});

export const getPlatformSettings = async () => {
  try {
    const settings = await pb.collection('admin_settings').getFirstListItem('');
    return normalizePlatformSettings(settings);
  } catch (error) {
    logger.warn(`[SETTINGS] Falling back to defaults: ${error.message}`);
    return normalizePlatformSettings();
  }
};

export const getSellerFeeRate = (settings) => {
  const percentage = normalizePlatformSettings(settings).transaction_fee_percentage;
  return percentage > 1 ? percentage / 100 : percentage;
};
