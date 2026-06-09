import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import { Readable } from 'stream';
import Stripe from 'stripe';
import pb from '../utils/pocketbaseClient.js';
import { POCKETBASE_HOST } from '../utils/pocketbaseClient.js';
import logger from '../utils/logger.js';
import { requireAuth, admin } from '../middleware/index.js';
import {
  canAccessZ3Tier,
  getZ3TierRank,
  isLearningTierCheckoutEnabled,
  normalizeZ3TierSlug,
  Z3_LEARNING_TIERS,
} from '../utils/learningTierMapping.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const SUBSCRIPTION_GRACE_DAYS = Math.max(1, Number(process.env.LEARNING_SUBSCRIPTION_GRACE_DAYS || 7));
const LEARNING_PORTAL_CONFIGURATION_CACHE_TTL_MS = Math.max(
  60000,
  Number(process.env.LEARNING_PORTAL_CONFIGURATION_CACHE_TTL_MS || 5 * 60 * 1000),
);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled']);
const EXPIRING_SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled']);
const ADMIN_SUBSCRIPTION_STATUSES = new Set(['active', 'past_due', 'canceled', 'expired', 'unpaid', 'paused']);
const ADMIN_COUPON_STATUSES = new Set(['draft', 'active', 'archived']);
const COUPON_DISCOUNT_TYPES = new Set(['percent', 'fixed_amount']);
const COUPON_DURATIONS = new Set(['once', 'repeating', 'forever']);
const LEARNING_PROGRESS_STATUSES = ['not_started', 'in_progress', 'completed', 'to_repeat', 'overdue'];
const LEARNING_MEDIA_TYPES = new Set(['video', 'pdf', 'download', 'image', 'other']);
const LEARNING_MEDIA_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'application/pdf',
  'application/zip',
  'application/octet-stream',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const LEARNING_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const LEARNING_ASSET_TOKEN_TTL_SECONDS = Math.max(60, Number(process.env.LEARNING_ASSET_TOKEN_TTL_SECONDS || 900));
const LEARNING_ASSET_TOKEN_SECRET = String(
  process.env.LEARNING_ASSET_TOKEN_SECRET
  || process.env.JWT_SECRET
  || process.env.STRIPE_WEBHOOK_SECRET
  || 'learning-asset-secret',
);

const safeJson = (value, fallback = []) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  if (Array.isArray(value) || typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const LEARNING_RICH_TEXT_SIZES = new Set(['small', 'normal', 'large', 'heading']);
const LEARNING_RICH_BLOCK_TYPES = new Set(['paragraph', 'image', 'table', 'list']);

const sanitizeText = (value, maxLength = 12000) =>
  String(value || '').split(String.fromCharCode(0)).join('').slice(0, maxLength);

const sanitizeLearningRichUrl = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  try {
    const url = new URL(normalized, FRONTEND_URL);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }
    return normalized;
  } catch {
    return '';
  }
};

const textContentToRichBlocks = (value) =>
  String(value || '')
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .slice(0, 80)
    .map((text, index) => ({
      id: `legacy_text_${index}`,
      type: 'paragraph',
      text: sanitizeText(text),
      spans: [{
        text: sanitizeText(text),
        size: index === 0 ? 'large' : 'normal',
        bold: false,
      }],
      size: index === 0 ? 'large' : 'normal',
      bold: false,
    }));

const sanitizeInlineSpans = (spans, fallbackText = '', fallback = {}) => {
  const source = Array.isArray(spans) && spans.length > 0
    ? spans
    : [{
      text: fallbackText,
      bold: fallback.bold === true,
      size: fallback.size || 'normal',
    }];

  const merged = [];
  source
    .slice(0, 300)
    .map((span) => ({
      text: sanitizeText(span?.text),
      bold: span?.bold === true,
      size: LEARNING_RICH_TEXT_SIZES.has(span?.size) ? span.size : 'normal',
    }))
    .filter((span) => span.text.length > 0)
    .forEach((span) => {
      const previous = merged.at(-1);
      if (previous && previous.bold === span.bold && previous.size === span.size) {
        previous.text += span.text;
      } else {
        merged.push({ ...span });
      }
    });

  return merged;
};

const sanitizeLearningRichContent = (value, fallbackText = '') => {
  const rawBlocks = Array.isArray(value) && value.length > 0
    ? value
    : textContentToRichBlocks(fallbackText);

  return rawBlocks
    .slice(0, 120)
    .map((block, index) => {
      const type = LEARNING_RICH_BLOCK_TYPES.has(block?.type) ? block.type : 'paragraph';
      const id = sanitizeText(block?.id || `learning_block_${index}`, 80);

      if (type === 'image') {
        const url = sanitizeLearningRichUrl(block?.url);
        if (!url) return null;
        return {
          id,
          type: 'image',
          url,
          alt: sanitizeText(block?.alt, 300),
          caption: sanitizeText(block?.caption, 500),
        };
      }

      if (type === 'table') {
        const header = (Array.isArray(block?.header) ? block.header : [])
          .slice(0, 12)
          .map((cell) => sanitizeText(cell, 1000));
        const rows = (Array.isArray(block?.rows) ? block.rows : [])
          .slice(0, 50)
          .map((row) => (Array.isArray(row) ? row : [])
            .slice(0, 12)
            .map((cell) => sanitizeText(cell, 1000)))
          .filter((row) => row.length > 0);

        if (header.length === 0 && rows.length === 0) return null;
        return {
          id,
          type: 'table',
          header,
          rows,
        };
      }

      if (type === 'list') {
        const items = (Array.isArray(block?.items) ? block.items : [])
          .slice(0, 50)
          .map((item) => sanitizeText(item, 1000))
          .filter((item) => item.trim());
        if (items.length === 0) return null;
        return {
          id,
          type: 'list',
          items,
        };
      }

      const size = LEARNING_RICH_TEXT_SIZES.has(block?.size) ? block.size : 'normal';
      const spans = sanitizeInlineSpans(block?.spans, block?.text, {
        bold: block?.bold === true,
        size,
      });
      const text = spans.map((span) => span.text).join('') || sanitizeText(block?.text);
      if (!text.trim()) return null;
      return {
        id,
        type: 'paragraph',
        text,
        spans,
        size,
        bold: block?.bold === true,
      };
    })
    .filter(Boolean);
};

const getLearningRichPlainText = (blocks, fallbackText = '') => {
  const sanitizedBlocks = sanitizeLearningRichContent(blocks, fallbackText);
  const text = sanitizedBlocks
    .map((block) => {
      if (block.type === 'image') {
        return [block.alt, block.caption].filter(Boolean).join(' ');
      }
      if (block.type === 'table') {
        return [
          ...(block.header || []),
          ...(block.rows || []).flat(),
        ].join(' ');
      }
      if (block.type === 'list') {
        return (block.items || []).join(' ');
      }
      return Array.isArray(block.spans) && block.spans.length > 0
        ? block.spans.map((span) => span.text).join('')
        : block.text;
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return text || String(fallbackText || '').trim();
};

const getAdminLessonDraftPayload = ({ requestBody, richContent, textContent }) => ({
  draft_title: requestBody?.title,
  draft_description: requestBody?.description,
  draft_content_type: requestBody?.contentType,
  draft_video_url: requestBody?.videoUrl,
  draft_text_content: textContent,
  draft_rich_content: richContent,
  draft_material_url: requestBody?.materialUrl,
  draft_pdf_url: requestBody?.pdfUrl,
  draft_download_url: requestBody?.downloadUrl,
  draft_attachments: requestBody?.attachments,
  has_unpublished_changes: true,
});

const clearAdminLessonDraftPayload = {
  has_unpublished_changes: false,
  draft_title: '',
  draft_description: '',
  draft_content_type: '',
  draft_video_url: '',
  draft_text_content: '',
  draft_rich_content: [],
  draft_material_url: '',
  draft_pdf_url: '',
  draft_download_url: '',
  draft_attachments: [],
};

const escapePbString = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const toBase64Url = (value) => Buffer.from(value).toString('base64url');
const fromBase64Url = (value) => Buffer.from(value, 'base64url').toString('utf8');

const toIsoString = (timestampSeconds) => {
  if (!timestampSeconds) return '';
  return new Date(timestampSeconds * 1000).toISOString();
};

const addDaysToIso = (value, days) => {
  const base = value ? new Date(value) : new Date();
  return new Date(base.getTime() + (days * 24 * 60 * 60 * 1000)).toISOString();
};

const addMonthsToIso = (value, months) => {
  const base = value ? new Date(value) : new Date();
  const result = new Date(base);
  result.setMonth(result.getMonth() + Math.max(1, Number(months || 1)));
  return result.toISOString();
};

const getEffectiveAccessEndsAt = (subscription) => {
  if (!subscription) return '';

  const status = String(subscription.status || '').trim();
  if (status === 'past_due') {
    return subscription.grace_ends_at || subscription.access_ends_at || subscription.current_period_end || '';
  }

  if (status === 'canceled') {
    return subscription.access_ends_at || subscription.current_period_end || '';
  }

  return subscription.access_ends_at || subscription.current_period_end || subscription.grace_ends_at || '';
};

const isExpiredSubscriptionRecord = (subscription) => {
  if (!subscription) return false;

  const status = String(subscription.status || '').trim();
  if (!EXPIRING_SUBSCRIPTION_STATUSES.has(status)) {
    return false;
  }

  const effectiveEnd = getEffectiveAccessEndsAt(subscription);
  if (!effectiveEnd) return false;

  return new Date(effectiveEnd).getTime() <= Date.now();
};

const expireSubscriptionIfNeeded = async (record) => {
  if (!record || String(record.status || '') === 'expired') {
    return record;
  }

  if (!isExpiredSubscriptionRecord(record)) {
    return record;
  }

  const effectiveEnd = getEffectiveAccessEndsAt(record);

  const savedRecord = await pb.collection('learning_subscriptions').update(record.id, {
    status: 'expired',
    access_ends_at: effectiveEnd || new Date().toISOString(),
    grace_ends_at: '',
  });

  await logLearningSubscriptionEvent({
    subscriptionRecord: savedRecord,
    eventType: 'period_expired',
    source: 'system',
    payload: {
      previousStatus: record.status || '',
      effectiveAccessEndsAt: effectiveEnd || '',
    },
  });

  return savedRecord;
};

const hasLearningAccess = (subscription) => {
  if (!subscription) return false;

  const status = String(subscription.status || '').trim();
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(status)) {
    return false;
  }

  const accessEndsAt = getEffectiveAccessEndsAt(subscription);
  if (!accessEndsAt) {
    return status === 'active' || status === 'trialing';
  }

  return new Date(accessEndsAt).getTime() > Date.now();
};

const getSubscriptionAccessState = (subscription) => {
  if (!subscription) return 'none';

  const status = String(subscription.status || '').trim();
  if (!hasLearningAccess(subscription)) {
    return 'blocked';
  }

  if (status === 'past_due') {
    return 'grace';
  }

  if (status === 'canceled') {
    return 'cancellation_scheduled';
  }

  return 'full';
};

const isStreamableVideoUrl = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes('youtube.com') || normalized.includes('youtu.be') || normalized.includes('vimeo.com')) {
    return false;
  }

  return true;
};

const toEmbedVideoUrl = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  try {
    const url = new URL(normalized);

    if (url.hostname.includes('youtu.be')) {
      const videoId = url.pathname.replace(/^\/+/, '').trim();
      return videoId ? `https://www.youtube.com/embed/${videoId}` : normalized;
    }

    if (url.hostname.includes('youtube.com')) {
      const videoId = url.searchParams.get('v') || '';
      return videoId ? `https://www.youtube.com/embed/${videoId}` : normalized;
    }

    if (url.hostname.includes('vimeo.com')) {
      const match = url.pathname.match(/\/(\d+)/);
      return match?.[1] ? `https://player.vimeo.com/video/${match[1]}` : normalized;
    }

    return normalized;
  } catch {
    return normalized;
  }
};

const resolveMediaUrl = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  try {
    const resolved = new URL(normalized, FRONTEND_URL);
    if (!['http:', 'https:'].includes(resolved.protocol)) {
      return '';
    }
    return resolved.toString();
  } catch {
    return '';
  }
};

const isSeedPlaceholderAssetUrl = (value) => {
  try {
    const url = new URL(value);
    return url.hostname === 'example.com' && url.pathname.startsWith('/materials/');
  } catch {
    return false;
  }
};

const escapePdfText = (value) => String(value || '')
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)')
  .replace(/[\r\n]+/g, ' ');

const buildSimplePdfBuffer = ({ title, lines }) => {
  const safeTitle = escapePdfText(title || 'Learning material');
  const safeLines = (Array.isArray(lines) ? lines : [])
    .map((line) => escapePdfText(line))
    .filter(Boolean)
    .slice(0, 10);

  const contentLines = [
    'BT',
    '/F1 22 Tf',
    '72 760 Td',
    `(${safeTitle}) Tj`,
    '/F1 12 Tf',
    '0 -36 Td',
    ...safeLines.flatMap((line) => [`(${line}) Tj`, '0 -20 Td']),
    'ET',
  ];
  const stream = contentLines.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
};

const getGeneratedSeedAsset = (lessonRecord, asset) => {
  if (!isSeedPlaceholderAssetUrl(asset?.url)) {
    return null;
  }

  return buildSimplePdfBuffer({
    title: asset.label || lessonRecord.title || 'Learning material',
    lines: [
      lessonRecord.title || 'Learning lesson',
      lessonRecord.description || '',
      lessonRecord.text_content || '',
      'This PDF is generated by Zahniboerse for the seeded lesson material.',
    ],
  });
};

const isPocketBaseFileUrl = (value) => {
  try {
    const url = new URL(value);
    const pocketBaseUrl = new URL(POCKETBASE_HOST);
    return url.origin === pocketBaseUrl.origin && url.pathname.includes('/api/files/');
  } catch {
    return false;
  }
};

const getProtectedAssetFetchHeaders = (assetUrl) => {
  const headers = {
    'User-Agent': 'Zahniboerse-Learning-Asset-Proxy/1.0',
  };

  if (isPocketBaseFileUrl(assetUrl) && pb.authStore?.token) {
    headers.Authorization = pb.authStore.token;
  }

  return headers;
};

const signLearningAssetToken = (payload) => {
  const serializedPayload = toBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', LEARNING_ASSET_TOKEN_SECRET)
    .update(serializedPayload)
    .digest('base64url');

  return `${serializedPayload}.${signature}`;
};

const verifyLearningAssetToken = (token) => {
  const normalized = String(token || '').trim();
  if (!normalized.includes('.')) {
    return null;
  }

  const [serializedPayload, providedSignature] = normalized.split('.', 2);
  const expectedSignature = crypto
    .createHmac('sha256', LEARNING_ASSET_TOKEN_SECRET)
    .update(serializedPayload)
    .digest('base64url');

  if (providedSignature.length !== expectedSignature.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(serializedPayload));
    if (!payload?.expiresAt || Number(payload.expiresAt) <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

const buildProtectedAssetToken = ({
  lessonId,
  assetType,
  attachmentIndex = null,
  accessLevel = 'full',
  packageId = '',
  userId = '',
  accessRole = '',
}) =>
  signLearningAssetToken({
    lessonId: String(lessonId || ''),
    assetType: String(assetType || ''),
    attachmentIndex: attachmentIndex === null ? null : Number(attachmentIndex),
    accessLevel,
    packageId: String(packageId || ''),
    userId: String(userId || ''),
    accessRole: String(accessRole || ''),
    expiresAt: Date.now() + (LEARNING_ASSET_TOKEN_TTL_SECONDS * 1000),
  });

const serializeAttachmentItem = (item) => {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    label: String(item.label || item.name || 'Attachment').trim() || 'Attachment',
    url: String(item.url || item.href || '').trim(),
  };
};

const getAttachmentByIndex = (record, attachmentIndex) => {
  const attachments = safeJson(record.attachments)
    .map((item) => serializeAttachmentItem(item))
    .filter(Boolean);

  if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0 || attachmentIndex >= attachments.length) {
    return null;
  }

  return attachments[attachmentIndex];
};

const resolveLessonAsset = (record, assetType, attachmentIndex = null) => {
  if (!record) return null;

  if (assetType === 'video') {
    const resolvedUrl = resolveMediaUrl(record.video_url);
    if (!resolvedUrl) return null;
    return {
      url: resolvedUrl,
      label: record.title || 'Video',
      presentation: isStreamableVideoUrl(resolvedUrl) ? 'stream' : 'embed',
    };
  }

  if (assetType === 'pdf') {
    const resolvedUrl = resolveMediaUrl(record.pdf_url || record.material_url);
    if (!resolvedUrl) return null;
    return {
      url: resolvedUrl,
      label: 'PDF',
      disposition: 'inline',
    };
  }

  if (assetType === 'download') {
    const resolvedUrl = resolveMediaUrl(record.download_url);
    if (!resolvedUrl) return null;
    return {
      url: resolvedUrl,
      label: 'Download',
      disposition: 'attachment',
    };
  }

  if (assetType === 'attachment') {
    const attachment = getAttachmentByIndex(record, attachmentIndex);
    const resolvedUrl = resolveMediaUrl(attachment?.url);
    if (!resolvedUrl) return null;
    return {
      url: resolvedUrl,
      label: attachment?.label || 'Attachment',
      disposition: 'attachment',
    };
  }

  return null;
};

const buildProtectedLessonAssets = ({
  record,
  hasEntitledAccess,
  accessUserId = '',
  accessRole = '',
}) => {
  const accessLevel = hasEntitledAccess ? 'full' : 'preview';
  const video = resolveLessonAsset(record, 'video');
  const pdf = resolveLessonAsset(record, 'pdf');
  const download = resolveLessonAsset(record, 'download');
  const attachmentItems = safeJson(record.attachments)
    .map((item) => serializeAttachmentItem(item))
    .filter(Boolean);

  const buildUrl = (assetType, attachmentIndex = null) => {
    const token = buildProtectedAssetToken({
      lessonId: record.id,
      assetType,
      attachmentIndex,
      accessLevel,
      packageId: record.package_id,
      userId: hasEntitledAccess ? accessUserId : '',
      accessRole: hasEntitledAccess ? accessRole : 'preview',
    });

    const path = assetType === 'attachment'
      ? `/learning/lessons/${encodeURIComponent(record.id)}/assets/attachment/${attachmentIndex}?token=${encodeURIComponent(token)}`
      : `/learning/lessons/${encodeURIComponent(record.id)}/assets/${assetType}?token=${encodeURIComponent(token)}`;

    return path;
  };

  return {
    videoAssetUrl: video ? buildUrl('video') : '',
    videoPresentation: video?.presentation || '',
    pdfAssetUrl: pdf ? buildUrl('pdf') : '',
    downloadAssetUrl: download ? buildUrl('download') : '',
    attachments: attachmentItems.map((item, index) => ({
      label: item.label,
      url: buildUrl('attachment', index),
    })),
  };
};

const isAdminAuth = (auth) => auth?.is_admin === true;

const hasPreviewAccessToLesson = ({ lessonRecord, moduleRecord }) =>
  lessonRecord?.is_preview === true
  || lessonRecord?.isPreview === true
  || moduleRecord?.is_preview === true
  || moduleRecord?.isPreview === true;

const serializePackage = (record, counts = {}) => {
  const tierSlug = normalizeZ3TierSlug(record.slug);

  return {
    id: record.id,
    slug: record.slug,
    tierSlug,
    checkoutEnabled: isLearningTierCheckoutEnabled(tierSlug || record.slug),
    title: record.title,
    subtitle: record.subtitle || '',
    shortDescription: record.subtitle || '',
    description: record.description || '',
    longDescription: record.description || '',
    heroCopy: record.hero_copy || '',
    targetAudience: record.target_audience || '',
    heroImageUrl: record.hero_image_url || '',
    coverImageUrl: record.hero_image_url || record.thumbnail_url || '',
    thumbnailUrl: record.thumbnail_url || record.hero_image_url || '',
    bundleKey: record.bundle_key || '',
    promoBadge: record.promo_badge || '',
    promoText: record.promo_text || '',
    couponsEnabled: record.coupons_enabled === true,
    pricingCopy: record.pricing_copy || '',
    ctaText: record.cta_text || '',
    seoTitle: record.seo_title || '',
    seoDescription: record.seo_description || '',
    ogTitle: record.og_title || '',
    ogDescription: record.og_description || '',
    ogImageUrl: record.og_image_url || record.hero_image_url || record.thumbnail_url || '',
    priceAmount: Number(record.price_amount || 0),
    yearlyPriceAmount: Number(record.yearly_price_amount || 0),
    currency: record.currency || 'EUR',
    billingInterval: record.billing_interval || 'month',
    interval: record.billing_interval || 'month',
    billingIntervalCount: Number(record.billing_interval_count || 1),
    stripeProductId: record.stripe_product_id || '',
    stripePriceId: record.stripe_price_id || '',
    yearlyStripePriceId: record.yearly_stripe_price_id || '',
    billingOptions: [
      {
        id: 'month',
        interval: 'month',
        priceAmount: Number(record.price_amount || 0),
        label: 'Monthly',
      },
      ...(Number(record.yearly_price_amount || 0) > 0 ? [{
        id: 'year',
        interval: 'year',
        priceAmount: Number(record.yearly_price_amount || 0),
        label: 'Yearly',
      }] : []),
    ],
    status: record.status || 'draft',
    sortOrder: Number(record.sort_order || 0),
    order: Number(record.sort_order || 0),
    valuePoints: safeJson(record.value_points),
    includedContent: safeJson(record.included_content),
    faq: safeJson(record.faq),
    moduleCount: Number(counts.moduleCount || 0),
    lessonCount: Number(counts.lessonCount || 0),
  };
};

const serializeModule = (record, lessons = []) => ({
  id: record.id,
  packageId: record.package_id,
  slug: record.slug,
  title: record.title,
  description: record.description || '',
  shortText: record.description || '',
  status: record.status || 'draft',
  publishState: record.status || 'draft',
  isPreview: record.is_preview === true,
  position: Number(record.position || 0),
  order: Number(record.position || 0),
  estimatedDurationMinutes: Number(record.estimated_duration_minutes || 0),
  lessons,
});

const serializeLesson = (record, { includeAssetSources = false } = {}) => ({
  id: record.id,
  packageId: record.package_id,
  moduleId: record.module_id,
  slug: record.slug,
  title: record.title,
  description: record.description || '',
  status: record.status || 'draft',
  releaseState: record.status || 'draft',
  contentType: record.content_type || 'video',
  hasUnpublishedChanges: record.has_unpublished_changes === true,
  ...(includeAssetSources ? { videoUrl: record.video_url || '' } : {}),
  ...(includeAssetSources ? { textContent: record.text_content || '' } : {}),
  ...(includeAssetSources ? { richContent: sanitizeLearningRichContent(safeJson(record.rich_content), record.text_content || '') } : {}),
  ...(includeAssetSources ? { pdfUrl: record.pdf_url || record.material_url || '' } : {}),
  ...(includeAssetSources ? { downloadUrl: record.download_url || '' } : {}),
  ...(includeAssetSources ? { materialUrl: record.material_url || '' } : {}),
  ...(includeAssetSources ? { attachments: safeJson(record.attachments) } : { attachments: [] }),
  ...(includeAssetSources ? {
    draft: record.has_unpublished_changes === true ? {
      title: record.draft_title || record.title || '',
      description: record.draft_description || record.description || '',
      contentType: record.draft_content_type || record.content_type || 'mixed',
      videoUrl: record.draft_video_url || '',
      textContent: record.draft_text_content || '',
      richContent: sanitizeLearningRichContent(safeJson(record.draft_rich_content), record.draft_text_content || ''),
      pdfUrl: record.draft_pdf_url || record.draft_material_url || '',
      downloadUrl: record.draft_download_url || '',
      materialUrl: record.draft_material_url || '',
      attachments: safeJson(record.draft_attachments),
    } : null,
  } : {}),
  hasText: Boolean(getLearningRichPlainText(safeJson(record.rich_content), record.text_content || '').trim()),
  hasVideo: Boolean(resolveMediaUrl(record.video_url)),
  hasPdf: Boolean(resolveMediaUrl(record.pdf_url || record.material_url)),
  hasDownload: Boolean(resolveMediaUrl(record.download_url)),
  attachmentCount: safeJson(record.attachments).length,
  isPreview: record.is_preview === true,
  position: Number(record.position || 0),
  order: Number(record.position || 0),
  estimatedMinutes: Number(record.estimated_minutes || 0),
});

const serializeSubscription = (record) => ({
  id: record.id,
  userId: record.user_id,
  packageId: record.package_id,
  stripeCustomerId: record.stripe_customer_id || '',
  stripeSubscriptionId: record.stripe_subscription_id || '',
  stripeCheckoutSessionId: record.stripe_checkout_session_id || '',
  status: record.status || 'incomplete',
  cancelAtPeriodEnd: record.cancel_at_period_end === true,
  currentPeriodStart: record.current_period_start || '',
  currentPeriodEnd: record.current_period_end || '',
  canceledAt: record.canceled_at || '',
  priceAmount: Number(record.price_amount || 0),
  currency: record.currency || 'EUR',
  billingInterval: record.billing_interval || '',
  accessEndsAt: record.access_ends_at || '',
  effectiveAccessEndsAt: getEffectiveAccessEndsAt(record),
  graceEndsAt: record.grace_ends_at || '',
  lastPaymentFailedAt: record.last_payment_failed_at || '',
  hasAccess: hasLearningAccess(record),
  accessState: getSubscriptionAccessState(record),
});

const serializeLearningInvoice = (record) => ({
  id: record.id,
  userId: record.user_id || '',
  packageId: record.package_id || '',
  subscriptionId: record.subscription_id || '',
  stripeSubscriptionId: record.stripe_subscription_id || '',
  stripeInvoiceId: record.stripe_invoice_id || '',
  number: record.invoice_number || '',
  status: record.status || '',
  amountPaid: Number(record.amount_paid || 0),
  amountDue: Number(record.amount_due || 0),
  currency: record.currency || 'EUR',
  hostedInvoiceUrl: record.hosted_invoice_url || '',
  invoicePdf: record.invoice_pdf || '',
  billingReason: record.billing_reason || '',
  createdAt: record.created_at || record.created || '',
  periodStart: record.period_start || '',
  periodEnd: record.period_end || '',
});

const serializeLearningCoupon = (record) => ({
  id: record.id,
  code: record.code || '',
  title: record.title || '',
  description: record.description || '',
  packageId: record.package_id || '',
  bundleKey: record.bundle_key || '',
  status: record.status || 'draft',
  discountType: record.discount_type || 'percent',
  percentOff: Number(record.percent_off || 0),
  amountOff: Number(record.amount_off || 0),
  currency: record.currency || 'EUR',
  duration: record.duration || 'once',
  durationInMonths: Number(record.duration_in_months || 0),
  startsAt: record.starts_at || '',
  expiresAt: record.expires_at || '',
  maxRedemptions: Number(record.max_redemptions || 0),
  redemptionCount: Number(record.redemption_count || 0),
  stripeCouponId: record.stripe_coupon_id || '',
  stripePromotionCodeId: record.stripe_promotion_code_id || '',
  promotionText: record.promotion_text || '',
  created: record.created || '',
  updated: record.updated || '',
});

const serializeLearningMedia = (record) => ({
  id: record.id,
  label: record.label || '',
  mediaType: record.media_type || '',
  file: record.file || '',
  url: record.file ? pb.files.getURL(record, record.file) : '',
  created: record.created || '',
  updated: record.updated || '',
});

const serializeLearningPlan = (record) => record ? ({
  id: record.id,
  userId: record.user_id || '',
  packageId: record.package_id || '',
  subscriptionId: record.subscription_id || '',
  tierSlug: record.tier_slug || '',
  status: record.status || 'draft',
  startDate: record.start_date || '',
  examDate: record.exam_date || '',
  timezone: record.timezone || '',
  availableWeekdays: safeJson(record.available_weekdays, []),
  dailyGoalMinutes: Number(record.daily_goal_minutes || 0),
  weeklyGoalTopics: Number(record.weekly_goal_topics || 0),
  currentDayIndex: Number(record.current_day_index || 0),
  lastGeneratedAt: record.last_generated_at || '',
  recalculationState: record.recalculation_state || 'none',
  recalculationOfferedAt: record.recalculation_offered_at || '',
  recalculatedAt: record.recalculated_at || '',
  metadata: safeJson(record.metadata, {}),
  created: record.created || '',
  updated: record.updated || '',
}) : null;

const serializeLearningPlanDay = (record) => ({
  id: record.id,
  userId: record.user_id || '',
  planId: record.plan_id || '',
  packageId: record.package_id || '',
  dayDate: record.day_date || '',
  dayIndex: Number(record.day_index || 0),
  status: record.status || 'planned',
  dayType: record.day_type || 'study',
  targetMinutes: Number(record.target_minutes || 0),
  completedMinutes: Number(record.completed_minutes || 0),
  assignmentCount: Number(record.assignment_count || 0),
  completedAssignmentCount: Number(record.completed_assignment_count || 0),
  feedbackCode: record.feedback_code || '',
  metadata: safeJson(record.metadata, {}),
  created: record.created || '',
  updated: record.updated || '',
});

const serializeLearningPlanAssignment = (record) => ({
  id: record.id,
  userId: record.user_id || '',
  planId: record.plan_id || '',
  planDayId: record.plan_day_id || '',
  packageId: record.package_id || '',
  moduleId: record.module_id || '',
  lessonId: record.lesson_id || '',
  assignmentType: record.assignment_type || 'lesson',
  status: record.status || 'open',
  priority: record.priority || 'normal',
  assignedDate: record.assigned_date || '',
  dueDate: record.due_date || '',
  completedAt: record.completed_at || '',
  estimatedMinutes: Number(record.estimated_minutes || 0),
  position: Number(record.position || 0),
  source: record.source || '',
  metadata: safeJson(record.metadata, {}),
  created: record.created || '',
  updated: record.updated || '',
});

const serializeLearningPlanSnapshot = (record) => ({
  id: record.id,
  userId: record.user_id || '',
  planId: record.plan_id || '',
  packageId: record.package_id || '',
  snapshotDate: record.snapshot_date || '',
  scope: record.scope || 'daily',
  completedAssignments: Number(record.completed_assignments || 0),
  totalAssignments: Number(record.total_assignments || 0),
  completedMinutes: Number(record.completed_minutes || 0),
  targetMinutes: Number(record.target_minutes || 0),
  completedTopics: Number(record.completed_topics || 0),
  totalTopics: Number(record.total_topics || 0),
  behindDays: Number(record.behind_days || 0),
  feedbackCode: record.feedback_code || '',
  payload: safeJson(record.payload, {}),
  created: record.created || '',
  updated: record.updated || '',
});

const safePayload = (value) => {
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value));
};

const buildDuplicateSlug = async (baseSlug) => {
  const normalizedBase = String(baseSlug || 'lesson').trim() || 'lesson';
  for (let attempt = 1; attempt <= 25; attempt += 1) {
    const candidate = attempt === 1 ? `${normalizedBase}-copy` : `${normalizedBase}-copy-${attempt}`;
    const existing = await pb.collection('learning_lessons').getFirstListItem(`slug="${candidate}"`, {
      $autoCancel: false,
    }).catch(() => null);

    if (!existing) {
      return candidate;
    }
  }

  return `${normalizedBase}-copy-${Date.now()}`;
};

const serializeAdminSubscriber = ({ subscriptionRecord, userRecord, packageRecord, invoiceSummary = null }) => ({
  id: subscriptionRecord.id,
  userId: subscriptionRecord.user_id,
  userEmail: userRecord?.email || '',
  userName: userRecord?.name || userRecord?.email || '',
  packageId: subscriptionRecord.package_id,
  packageTitle: packageRecord?.title || '',
  packageSlug: packageRecord?.slug || '',
  subscription: serializeSubscription(subscriptionRecord),
  invoiceSummary,
});

const serializeSubscriptionEvent = (record, { userRecord = null, packageRecord = null } = {}) => ({
  id: record.id,
  userId: record.user_id || '',
  userEmail: userRecord?.email || '',
  userName: userRecord?.name || userRecord?.email || '',
  packageId: record.package_id || '',
  packageTitle: packageRecord?.title || '',
  packageSlug: packageRecord?.slug || '',
  subscriptionId: record.subscription_id || '',
  stripeSubscriptionId: record.stripe_subscription_id || '',
  eventType: record.event_type || '',
  source: record.source || '',
  payload: safeJson(record.payload, {}),
  created: record.created || '',
});

const logLearningSubscriptionEvent = async ({
  subscriptionRecord = null,
  eventType,
  source,
  payload = {},
  userId = '',
  packageId = '',
  stripeSubscriptionId = '',
  required = false,
}) => {
  if (!eventType || !source) return;

  try {
    await pb.collection('learning_subscription_events').create({
      user_id: userId || subscriptionRecord?.user_id || '',
      package_id: packageId || subscriptionRecord?.package_id || '',
      subscription_id: subscriptionRecord?.id || '',
      stripe_subscription_id: stripeSubscriptionId || subscriptionRecord?.stripe_subscription_id || '',
      event_type: eventType,
      source,
      payload: safePayload(payload),
    });
  } catch (error) {
    logger.error(`[LEARNING] Failed to write subscription/admin event ${eventType}: ${error.message}`);
    if (required) {
      throw error;
    }
  }
};

const logLearningAdminAction = async ({
  actorUserId,
  eventType,
  targetType,
  targetId,
  packageId = '',
  payload = {},
}) => {
  if (!actorUserId || !eventType || !targetType || !targetId) {
    return;
  }

  await logLearningSubscriptionEvent({
    eventType,
    source: 'admin_action',
    userId: actorUserId,
    packageId,
    required: true,
    payload: {
      actorUserId,
      targetType,
      targetId,
      ...payload,
    },
  });
};

const getExistingFutureAccessEnd = (subscriptionRecord, fallbackDays = 30) => {
  const candidates = [
    subscriptionRecord?.access_ends_at,
    subscriptionRecord?.current_period_end,
    subscriptionRecord?.grace_ends_at,
  ];

  const futureCandidate = candidates.find((value) => value && new Date(value).getTime() > Date.now());
  return futureCandidate || addDaysToIso(new Date().toISOString(), fallbackDays);
};

const buildManualSubscriptionStatusPayload = ({ subscriptionRecord, status, durationDays }) => {
  const normalizedStatus = String(status || '').trim();
  const now = new Date().toISOString();
  const safeDurationDays = Math.max(1, Number(durationDays || 30));
  const futureAccessEnd = getExistingFutureAccessEnd(subscriptionRecord, safeDurationDays);
  const graceEndsAt = addDaysToIso(now, Math.max(1, Number(durationDays || SUBSCRIPTION_GRACE_DAYS)));

  switch (normalizedStatus) {
    case 'active':
      return {
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: subscriptionRecord.current_period_start || now,
        current_period_end: futureAccessEnd,
        access_ends_at: futureAccessEnd,
        grace_ends_at: '',
        canceled_at: '',
        last_payment_failed_at: '',
      };
    case 'past_due':
      return {
        status: 'past_due',
        cancel_at_period_end: false,
        access_ends_at: futureAccessEnd,
        grace_ends_at: graceEndsAt,
        last_payment_failed_at: now,
      };
    case 'canceled':
      return {
        status: 'canceled',
        cancel_at_period_end: true,
        current_period_end: futureAccessEnd,
        access_ends_at: futureAccessEnd,
        grace_ends_at: '',
        canceled_at: subscriptionRecord.canceled_at || now,
      };
    case 'expired':
      return {
        status: 'expired',
        cancel_at_period_end: false,
        current_period_end: now,
        access_ends_at: now,
        grace_ends_at: '',
        canceled_at: subscriptionRecord.canceled_at || now,
      };
    case 'unpaid':
      return {
        status: 'unpaid',
        cancel_at_period_end: false,
        access_ends_at: now,
        grace_ends_at: '',
        last_payment_failed_at: now,
      };
    case 'paused':
      return {
        status: 'paused',
        cancel_at_period_end: false,
        access_ends_at: now,
        grace_ends_at: '',
      };
    default:
      return null;
  }
};

const getManualSubscriptionStatusEventType = ({ subscriptionRecord, status }) => {
  const normalizedStatus = String(status || '').trim();

  if (normalizedStatus === 'active') {
    return subscriptionRecord?.cancel_at_period_end === true
      ? 'cancellation_reversed'
      : 'subscription_manually_extended';
  }

  if (normalizedStatus === 'canceled') {
    return 'cancellation_scheduled';
  }

  if (normalizedStatus === 'expired') {
    return 'subscription_manually_revoked';
  }

  if (['unpaid', 'paused'].includes(normalizedStatus)) {
    return 'chargeback_manual_block';
  }

  return 'subscription_admin_status_changed';
};

const getStoredInvoicesForSubscription = async (subscriptionRecord, limit = 6) => {
  if (!subscriptionRecord) {
    return [];
  }

  const filters = [];
  if (subscriptionRecord.id) {
    filters.push(`subscription_id="${escapePbString(subscriptionRecord.id)}"`);
  }
  if (subscriptionRecord.stripe_subscription_id) {
    filters.push(`stripe_subscription_id="${escapePbString(subscriptionRecord.stripe_subscription_id)}"`);
  }

  if (filters.length === 0) {
    return [];
  }

  return pb.collection('learning_invoices').getFullList({
    filter: filters.length > 1 ? `(${filters.join(' || ')})` : filters[0],
    sort: '-created_at,-created',
    $autoCancel: false,
  }).then((records) => records.slice(0, limit)).catch(() => []);
};

const getStripeInvoicesForSubscription = async (stripeSubscriptionId, limit = 6) => {
  const normalizedId = String(stripeSubscriptionId || '').trim();
  if (!normalizedId) {
    return [];
  }

  const invoiceList = await stripe.invoices.list({
    subscription: normalizedId,
    limit,
  }).catch((error) => {
    logger.warn(`[LEARNING] Could not refresh Stripe invoices for ${normalizedId}: ${error.message}`);
    return { data: [] };
  });

  return Array.isArray(invoiceList?.data) ? invoiceList.data : [];
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

const upsertLearningInvoiceRecordFromStripe = async ({ invoice, subscriptionRecord = null }) => {
  const invoiceId = String(invoice?.id || '').trim();
  if (!invoiceId) {
    return null;
  }

  const existingRecord = await pb.collection('learning_invoices')
    .getFirstListItem(`stripe_invoice_id="${escapePbString(invoiceId)}"`, { $autoCancel: false })
    .catch(() => null);
  const stripeSubscriptionId = getStripeInvoiceSubscriptionId(invoice)
    || String(subscriptionRecord?.stripe_subscription_id || existingRecord?.stripe_subscription_id || '').trim();
  const period = invoice.lines?.data?.[0]?.period || {};
  const payload = {
    user_id: subscriptionRecord?.user_id || existingRecord?.user_id || '',
    package_id: subscriptionRecord?.package_id || existingRecord?.package_id || '',
    subscription_id: subscriptionRecord?.id || existingRecord?.subscription_id || '',
    stripe_subscription_id: stripeSubscriptionId,
    stripe_invoice_id: invoiceId,
    invoice_number: invoice.number || existingRecord?.invoice_number || '',
    status: String(invoice.status || existingRecord?.status || 'open').trim() || 'open',
    amount_paid: Number(invoice.amount_paid || 0) / 100,
    amount_due: Number(invoice.amount_due || 0) / 100,
    currency: String(invoice.currency || existingRecord?.currency || 'eur').toUpperCase(),
    hosted_invoice_url: invoice.hosted_invoice_url || existingRecord?.hosted_invoice_url || '',
    invoice_pdf: invoice.invoice_pdf || existingRecord?.invoice_pdf || '',
    billing_reason: invoice.billing_reason || existingRecord?.billing_reason || '',
    created_at: toIsoString(invoice.created) || existingRecord?.created_at || '',
    period_start: toIsoString(period.start) || existingRecord?.period_start || '',
    period_end: toIsoString(period.end) || existingRecord?.period_end || '',
    payload: safePayload({
      id: invoice.id,
      status: invoice.status || '',
      billing_reason: invoice.billing_reason || '',
      amount_paid: invoice.amount_paid || 0,
      amount_due: invoice.amount_due || 0,
      currency: invoice.currency || '',
      subscription: stripeSubscriptionId,
    }),
  };

  return existingRecord
    ? pb.collection('learning_invoices').update(existingRecord.id, payload)
    : pb.collection('learning_invoices').create(payload);
};

const syncStoredInvoicesForSubscription = async (subscriptionRecord, limit = 6) => {
  const stripeSubscriptionId = String(subscriptionRecord?.stripe_subscription_id || '').trim();
  if (stripeSubscriptionId) {
    const stripeInvoices = await getStripeInvoicesForSubscription(stripeSubscriptionId, limit);
    await Promise.all(stripeInvoices.map((invoice) =>
      upsertLearningInvoiceRecordFromStripe({ invoice, subscriptionRecord }).catch((error) => {
        logger.warn(`[LEARNING] Could not store Stripe invoice ${invoice?.id || ''}: ${error.message}`);
        return null;
      })));
  }

  return getStoredInvoicesForSubscription(subscriptionRecord, limit);
};

const serializeStripeInvoice = (invoice) => ({
  id: invoice.id,
  number: invoice.number || '',
  status: invoice.status || '',
  amountPaid: Number(invoice.amount_paid || 0) / 100,
  amountDue: Number(invoice.amount_due || 0) / 100,
  currency: String(invoice.currency || 'eur').toUpperCase(),
  invoicePdf: invoice.invoice_pdf || '',
  hostedInvoiceUrl: invoice.hosted_invoice_url || '',
  createdAt: toIsoString(invoice.created),
  billingReason: invoice.billing_reason || '',
});

const getStripeSubscriptionPeriodStart = (subscription) =>
  subscription?.current_period_start || subscription?.items?.data?.[0]?.current_period_start || null;

const getStripeSubscriptionPeriodEnd = (subscription) =>
  subscription?.current_period_end || subscription?.items?.data?.[0]?.current_period_end || subscription?.ended_at || subscription?.cancel_at || null;

const getLearningStatusFromStripeSubscription = ({ stripeSubscription, accessEndsAt = '', graceEndsAt = '' }) => {
  const stripeStatus = String(stripeSubscription?.status || '').trim();
  const effectiveEnd = stripeStatus === 'past_due'
    ? graceEndsAt || accessEndsAt || ''
    : accessEndsAt || graceEndsAt || '';

  if (['unpaid', 'paused', 'incomplete', 'incomplete_expired'].includes(stripeStatus)) {
    return stripeStatus;
  }

  if (effectiveEnd && new Date(effectiveEnd).getTime() <= Date.now()) {
    return 'expired';
  }

  if (stripeSubscription?.cancel_at_period_end === true && ['active', 'trialing'].includes(stripeStatus)) {
    return 'canceled';
  }

  if (['active', 'trialing', 'past_due'].includes(stripeStatus)) {
    return stripeStatus;
  }

  return stripeStatus || 'expired';
};

const syncLearningSubscriptionRecordFromStripe = async (subscriptionRecord) => {
  const stripeSubscriptionId = String(subscriptionRecord?.stripe_subscription_id || '').trim();
  if (!stripeSubscriptionId) {
    return {
      subscriptionRecord,
      stripeSubscription: null,
    };
  }

  const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ['default_payment_method', 'items.data.price'],
  }).catch((error) => {
    logger.warn(`[LEARNING] Could not refresh Stripe subscription ${stripeSubscriptionId}: ${error.message}`);
    return null;
  });

  if (!stripeSubscription) {
    return {
      subscriptionRecord,
      stripeSubscription: null,
    };
  }

  const periodStart = getStripeSubscriptionPeriodStart(stripeSubscription);
  const periodEnd = getStripeSubscriptionPeriodEnd(stripeSubscription);
  const price = stripeSubscription.items?.data?.[0]?.price || null;
  const rawStripeStatus = String(stripeSubscription.status || '').trim();
  const accessEndsAt = periodEnd ? toIsoString(periodEnd) : subscriptionRecord.access_ends_at || '';
  const graceEndsAt = rawStripeStatus === 'past_due'
    ? subscriptionRecord.grace_ends_at || addDaysToIso(new Date().toISOString(), SUBSCRIPTION_GRACE_DAYS)
    : '';
  const status = getLearningStatusFromStripeSubscription({
    stripeSubscription,
    accessEndsAt,
    graceEndsAt,
  });

  const payload = {
    status,
    cancel_at_period_end: stripeSubscription.cancel_at_period_end === true,
    current_period_start: periodStart ? toIsoString(periodStart) : subscriptionRecord.current_period_start || '',
    current_period_end: periodEnd ? toIsoString(periodEnd) : subscriptionRecord.current_period_end || '',
    canceled_at: stripeSubscription.canceled_at ? toIsoString(stripeSubscription.canceled_at) : '',
    price_amount: typeof price?.unit_amount === 'number' ? price.unit_amount / 100 : Number(subscriptionRecord.price_amount || 0),
    currency: String(price?.currency || subscriptionRecord.currency || 'eur').toUpperCase(),
    billing_interval: price?.recurring?.interval || subscriptionRecord.billing_interval || '',
    access_ends_at: accessEndsAt,
    grace_ends_at: graceEndsAt,
    last_payment_failed_at: ['past_due', 'unpaid'].includes(rawStripeStatus)
      ? subscriptionRecord.last_payment_failed_at || new Date().toISOString()
      : '',
  };

  const hasChanges = Object.entries(payload).some(([key, value]) => subscriptionRecord[key] !== value);
  const savedRecord = hasChanges
    ? await pb.collection('learning_subscriptions').update(subscriptionRecord.id, payload)
    : subscriptionRecord;

  return {
    subscriptionRecord: savedRecord,
    stripeSubscription,
  };
};

const getAdminInvoiceSummary = async (subscriptionRecord) => {
  const storedInvoices = await syncStoredInvoicesForSubscription(subscriptionRecord, 6);
  const invoices = storedInvoices.map((record) => ({
    status: record.status || '',
    createdAt: record.created_at || record.created || '',
    amountPaid: Number(record.amount_paid || 0),
    currency: record.currency || 'EUR',
  }));

  const latestInvoice = invoices[0] || null;

  return {
    count: invoices.length,
    latestStatus: latestInvoice?.status || '',
    latestCreatedAt: latestInvoice?.createdAt || '',
    latestAmountPaid: latestInvoice ? Number(latestInvoice.amountPaid || 0) : 0,
    latestCurrency: latestInvoice?.currency || 'EUR',
    openCount: invoices.filter((invoice) => ['open', 'draft', 'uncollectible'].includes(String(invoice.status || ''))).length,
    source: 'local',
  };
};

const formatPaymentMethodLabel = (paymentMethod) => {
  if (!paymentMethod) return '';
  if (paymentMethod.type === 'card' && paymentMethod.card) {
    return `${String(paymentMethod.card.brand || 'card').toUpperCase()} •••• ${paymentMethod.card.last4 || ''}`.trim();
  }

  return paymentMethod.type || '';
};

const getPublishedPackageRecords = async () =>
  pb.collection('learning_packages').getFullList({
    filter: 'status="published"',
    sort: 'sort_order,title',
    $autoCancel: false,
  });

const getPublishedPackages = async () => {
  const packages = await getPublishedPackageRecords();

  const modules = await pb.collection('learning_modules').getFullList({
    filter: 'status="published"',
    sort: 'position,title',
    $autoCancel: false,
  }).catch(() => []);

  const lessons = await pb.collection('learning_lessons').getFullList({
    filter: 'status="published"',
    sort: 'position,title',
    $autoCancel: false,
  }).catch(() => []);

  const moduleCountByPackage = new Map();
  const lessonCountByPackage = new Map();

  for (const moduleRecord of modules) {
    const packageId = String(moduleRecord.package_id || '');
    moduleCountByPackage.set(packageId, (moduleCountByPackage.get(packageId) || 0) + 1);
  }

  for (const lessonRecord of lessons) {
    const packageId = String(lessonRecord.package_id || '');
    lessonCountByPackage.set(packageId, (lessonCountByPackage.get(packageId) || 0) + 1);
  }

  return packages.map((record) => serializePackage(record, {
    moduleCount: moduleCountByPackage.get(record.id) || 0,
    lessonCount: lessonCountByPackage.get(record.id) || 0,
  }));
};

const getActiveLearningPackageRecord = async () =>
  pb.collection('learning_packages').getFirstListItem('status="published"', {
    sort: 'sort_order,title',
    $autoCancel: false,
  });

const isActiveLearningPackageRecord = async (packageRecord) => {
  if (!packageRecord?.id || packageRecord.status !== 'published') {
    return false;
  }

  return true;
};

const getPackageRecordBySlug = async (slug) => {
  const escapedSlug = String(slug || '').replace(/"/g, '\\"');
  return pb.collection('learning_packages').getFirstListItem(`slug="${escapedSlug}"`, {
    $autoCancel: false,
  });
};

const getPackageDetail = async (packageRecord) => {
  const modules = await pb.collection('learning_modules').getFullList({
    filter: `package_id="${packageRecord.id}" && status="published"`,
    sort: 'position,title',
    $autoCancel: false,
  });

  const lessons = await pb.collection('learning_lessons').getFullList({
    filter: `package_id="${packageRecord.id}" && status="published"`,
    sort: 'position,title',
    $autoCancel: false,
  });

  const lessonsByModule = new Map();
  for (const lessonRecord of lessons) {
    const moduleId = String(lessonRecord.module_id || '');
    const current = lessonsByModule.get(moduleId) || [];
    current.push(serializeLesson(lessonRecord));
    lessonsByModule.set(moduleId, current);
  }

  return {
    ...serializePackage(packageRecord, {
      moduleCount: modules.length,
      lessonCount: lessons.length,
    }),
    modules: modules.map((moduleRecord) => serializeModule(
      moduleRecord,
      (lessonsByModule.get(moduleRecord.id) || []).map((lesson) => ({
        ...lesson,
        moduleSlug: moduleRecord.slug,
      })),
    )),
  };
};

const getModuleTreeForPackage = async (packageId, { includeDrafts = false } = {}) => {
  const moduleFilter = includeDrafts
    ? `package_id="${packageId}"`
    : `package_id="${packageId}" && status="published"`;
  const lessonFilter = includeDrafts
    ? `package_id="${packageId}"`
    : `package_id="${packageId}" && status="published"`;

  const modules = await pb.collection('learning_modules').getFullList({
    filter: moduleFilter,
    sort: 'position,title',
    $autoCancel: false,
  }).catch(() => []);

  const lessons = await pb.collection('learning_lessons').getFullList({
    filter: lessonFilter,
    sort: 'position,title',
    $autoCancel: false,
  }).catch(() => []);

  const lessonsByModule = new Map();
  for (const lessonRecord of lessons) {
    const moduleId = String(lessonRecord.module_id || '');
    const current = lessonsByModule.get(moduleId) || [];
    current.push(serializeLesson(lessonRecord));
    lessonsByModule.set(moduleId, current);
  }

  return modules.map((moduleRecord) => serializeModule(
    moduleRecord,
    (lessonsByModule.get(moduleRecord.id) || []).map((lesson) => ({
      ...lesson,
      moduleSlug: moduleRecord.slug,
    })),
  ));
};

const getModuleRecord = async (moduleId) =>
  pb.collection('learning_modules').getOne(moduleId, { $autoCancel: false });

const getLessonRecord = async (lessonId) =>
  pb.collection('learning_lessons').getOne(lessonId, { $autoCancel: false });

const getModuleRecordBySlug = async ({ packageSlug, moduleSlug }) => {
  const packageRecord = await getPackageRecordBySlug(packageSlug).catch(() => null);
  if (!packageRecord) return null;

  return pb.collection('learning_modules').getFirstListItem(
    `package_id="${escapePbString(packageRecord.id)}" && slug="${escapePbString(moduleSlug)}"`,
    { $autoCancel: false },
  ).catch(() => null);
};

const getLessonRecordBySlug = async ({ packageSlug, moduleSlug, lessonSlug }) => {
  const moduleRecord = await getModuleRecordBySlug({ packageSlug, moduleSlug });
  if (!moduleRecord) return null;

  return pb.collection('learning_lessons').getFirstListItem(
    `package_id="${escapePbString(moduleRecord.package_id)}" && module_id="${escapePbString(moduleRecord.id)}" && slug="${escapePbString(lessonSlug)}"`,
    { $autoCancel: false },
  ).catch(() => null);
};

const normalizeLearningSearchText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '')
  .toLowerCase();

const buildLearningSearchExcerpt = ({ fields, query }) => {
  const normalizedQuery = normalizeLearningSearchText(query);
  const source = fields.find((field) => normalizeLearningSearchText(field).includes(normalizedQuery))
    || fields.find((field) => String(field || '').trim())
    || '';
  const text = String(source || '').replace(/\s+/g, ' ').trim();

  if (!text) return '';

  const normalizedText = normalizeLearningSearchText(text);
  const matchIndex = normalizedText.indexOf(normalizedQuery);
  const start = matchIndex > 48 ? matchIndex - 48 : 0;
  const snippet = text.slice(start, start + 180).trim();
  return `${start > 0 ? '...' : ''}${snippet}${text.length > start + snippet.length ? '...' : ''}`;
};

const getLearningSearchScore = ({ query, title, description, body, slug }) => {
  const normalizedQuery = normalizeLearningSearchText(query);
  const fields = [
    { value: title, exact: 120, starts: 90, includes: 70 },
    { value: slug, exact: 80, starts: 60, includes: 45 },
    { value: description, exact: 60, starts: 45, includes: 35 },
    { value: body, exact: 45, starts: 32, includes: 22 },
  ];

  let score = 0;
  for (const field of fields) {
    const normalizedValue = normalizeLearningSearchText(field.value);
    if (!normalizedValue) continue;
    if (normalizedValue === normalizedQuery) score = Math.max(score, field.exact);
    else if (normalizedValue.startsWith(normalizedQuery)) score = Math.max(score, field.starts);
    else if (normalizedValue.includes(normalizedQuery)) score = Math.max(score, field.includes);
  }

  return score;
};

const getPackageRecordById = async (packageId) =>
  pb.collection('learning_packages').getOne(packageId, { $autoCancel: false }).catch(() => null);

const getSubscriptionTierContext = async (subscriptionRecord) => {
  if (!subscriptionRecord) {
    return null;
  }

  const packageRecord = await getPackageRecordById(subscriptionRecord.package_id);
  const tierSlug = normalizeZ3TierSlug(packageRecord?.slug || '');

  return {
    subscriptionRecord,
    packageRecord,
    tierSlug,
    tierRank: getZ3TierRank(tierSlug),
    hasAccess: hasLearningAccess(subscriptionRecord),
  };
};

const getLearningSubscriptionContextsForUser = async (userId) => {
  if (!userId) {
    return [];
  }

  const subscriptions = await pb.collection('learning_subscriptions').getFullList({
    filter: `user_id="${escapePbString(userId)}"`,
    sort: '-updated',
    $autoCancel: false,
  }).catch(() => []);

  const contexts = [];
  for (const subscription of subscriptions) {
    const normalizedSubscription = await expireSubscriptionIfNeeded(subscription);
    const context = await getSubscriptionTierContext(normalizedSubscription);
    if (context) {
      contexts.push(context);
    }
  }

  return contexts;
};

const selectBestLearningSubscriptionContext = (contexts = []) => {
  const activeContexts = contexts.filter((context) => context.hasAccess);
  const bestZ3Context = activeContexts
    .filter((context) => context.tierRank > 0)
    .sort((a, b) => b.tierRank - a.tierRank)[0];

  return bestZ3Context || activeContexts[0] || contexts[0] || null;
};

const getCurrentLearningSubscription = async (userId) => {
  const context = selectBestLearningSubscriptionContext(await getLearningSubscriptionContextsForUser(userId));
  return context?.subscriptionRecord || null;
};

const getAccessibleLearningPackageRecordsForAuth = async (auth) => {
  const packageRecords = await getPublishedPackageRecords().catch(() => []);

  if (isAdminAuth(auth)) {
    return packageRecords;
  }

  if (!auth?.id) {
    return [];
  }

  const accessiblePackageRecords = [];
  for (const packageRecord of packageRecords) {
    const subscriptionRecord = await getLearningSubscriptionForPackage({
      userId: auth.id,
      packageId: packageRecord.id,
    });

    if (hasLearningAccess(subscriptionRecord)) {
      accessiblePackageRecords.push(packageRecord);
    }
  }

  return accessiblePackageRecords;
};

const buildLearningFeatureAccess = async ({ auth, subscriptionRecord }) => {
  if (isAdminAuth(auth)) {
    return {
      content: true,
      learningPlan: true,
      examTrainer: true,
      userTierSlug: 'admin',
      userTierRank: Number.POSITIVE_INFINITY,
    };
  }

  const context = await getSubscriptionTierContext(subscriptionRecord);
  const hasAccess = Boolean(context?.hasAccess);
  const userTierSlug = context?.tierSlug || '';

  return {
    content: hasAccess,
    learningPlan: hasAccess && canAccessZ3Tier({
      userTierSlug,
      requiredTierSlug: Z3_LEARNING_TIERS.STRUKTUR,
    }),
    examTrainer: hasAccess && canAccessZ3Tier({
      userTierSlug,
      requiredTierSlug: Z3_LEARNING_TIERS.PRUEFUNGSTRAINER,
    }),
    userTierSlug,
    userTierRank: context?.tierRank || 0,
  };
};

const buildAdminPreviewSubscription = (packageRecord) => ({
  id: 'admin-preview',
  userId: '',
  packageId: packageRecord?.id || '',
  stripeCustomerId: '',
  stripeSubscriptionId: '',
  stripeCheckoutSessionId: '',
  status: 'active',
  cancelAtPeriodEnd: false,
  currentPeriodStart: '',
  currentPeriodEnd: '',
  canceledAt: '',
  priceAmount: 0,
  currency: 'EUR',
  billingInterval: 'manual',
  accessEndsAt: '',
  effectiveAccessEndsAt: '',
  graceEndsAt: '',
  lastPaymentFailedAt: '',
  hasAccess: true,
  accessState: 'full',
  isAdminPreview: true,
});

const getPackageEntitlementIds = async (packageId) => {
  const normalizedPackageId = String(packageId || '').trim();
  if (!normalizedPackageId) {
    return [];
  }

  const packageRecord = await pb.collection('learning_packages').getOne(normalizedPackageId, {
    $autoCancel: false,
  }).catch(() => null);

  if (!packageRecord) {
    return [normalizedPackageId];
  }

  const bundleKey = String(packageRecord.bundle_key || '').trim();
  if (!bundleKey) {
    return [normalizedPackageId];
  }

  const bundledPackages = await pb.collection('learning_packages').getFullList({
    filter: `bundle_key="${escapePbString(bundleKey)}" && status!="archived"`,
    sort: 'sort_order,title',
    $autoCancel: false,
  }).catch(() => []);

  return [...new Set([normalizedPackageId, ...bundledPackages.map((record) => record.id)])];
};

const getLearningSubscriptionForPackage = async ({ userId, packageId }) => {
  if (!userId || !packageId) {
    return null;
  }

  const packageRecord = await getPackageRecordById(packageId);
  const requiredTierSlug = normalizeZ3TierSlug(packageRecord?.slug || '');
  const entitlementIds = new Set(await getPackageEntitlementIds(packageId));
  const matchingContexts = [];
  const contexts = await getLearningSubscriptionContextsForUser(userId);

  for (const context of contexts) {
    if (entitlementIds.has(context.subscriptionRecord.package_id)) {
      matchingContexts.push(context);
      continue;
    }

    if (
      requiredTierSlug
      && context.tierSlug
      && canAccessZ3Tier({ userTierSlug: context.tierSlug, requiredTierSlug })
    ) {
      matchingContexts.push(context);
    }
  }

  const exactActive = matchingContexts.find((context) =>
    String(context.subscriptionRecord.package_id || '') === String(packageId || '') && context.hasAccess);
  const bestActive = exactActive || selectBestLearningSubscriptionContext(matchingContexts);
  return bestActive?.subscriptionRecord || null;
};

const getLearningAccessContext = async ({ auth, packageId, requiredTierSlug = '' }) => {
  if (isAdminAuth(auth)) {
    return {
      hasAccess: true,
      subscriptionRecord: null,
      packageRecord: null,
      requiredTierSlug: normalizeZ3TierSlug(requiredTierSlug),
      userTierSlug: 'admin',
    };
  }

  const userId = auth?.id;
  if (!userId) {
    return {
      hasAccess: false,
      subscriptionRecord: null,
      packageRecord: null,
      requiredTierSlug: normalizeZ3TierSlug(requiredTierSlug),
      userTierSlug: '',
    };
  }

  const packageRecord = packageId ? await getPackageRecordById(packageId) : null;
  const normalizedRequiredTierSlug = normalizeZ3TierSlug(requiredTierSlug || packageRecord?.slug || '');

  if (normalizedRequiredTierSlug) {
    const userContext = selectBestLearningSubscriptionContext(await getLearningSubscriptionContextsForUser(userId));
    const hasAccess = Boolean(
      userContext?.hasAccess
      && canAccessZ3Tier({
        userTierSlug: userContext.tierSlug,
        requiredTierSlug: normalizedRequiredTierSlug,
      }),
    );

    return {
      hasAccess,
      subscriptionRecord: userContext?.subscriptionRecord || null,
      packageRecord,
      requiredTierSlug: normalizedRequiredTierSlug,
      userTierSlug: userContext?.tierSlug || '',
    };
  }

  const subscriptionRecord = await getLearningSubscriptionForPackage({ userId, packageId });
  return {
    hasAccess: hasLearningAccess(subscriptionRecord),
    subscriptionRecord,
    packageRecord,
    requiredTierSlug: '',
    userTierSlug: '',
  };
};

const requireLearningTier = async (auth, requiredTierSlug = Z3_LEARNING_TIERS.START) => {
  const accessContext = await getLearningAccessContext({ auth, requiredTierSlug });

  if (!accessContext.hasAccess) {
    const error = new Error('Required learning tier not available');
    error.status = 403;
    error.requiredTierSlug = accessContext.requiredTierSlug;
    error.userTierSlug = accessContext.userTierSlug;
    throw error;
  }

  return accessContext.subscriptionRecord;
};

const getProgressMap = async ({ userId, packageId }) => {
  if (!userId || !packageId) {
    return new Map();
  }

  const progressRecords = await pb.collection('learning_progress').getFullList({
    filter: `user_id="${String(userId).replace(/"/g, '\\"')}" && package_id="${String(packageId).replace(/"/g, '\\"')}"`,
    sort: '-updated',
    $autoCancel: false,
  }).catch(() => []);

  return new Map(
    progressRecords.map((record) => [record.lesson_id, {
      id: record.id,
      status: record.status || 'not_started',
      progressPercentage: Number(record.progress_percentage || 0),
      lastOpenedAt: record.last_opened_at || '',
      completedAt: record.completed_at || '',
    }]),
  );
};

const buildDefaultLessonProgress = () => ({
  status: 'not_started',
  progressPercentage: 0,
  lastOpenedAt: '',
  completedAt: '',
});

const buildModuleProgress = (lessons = []) => {
  const totalLessons = lessons.length;
  const completedLessons = lessons.filter((lesson) => lesson.progress?.status === 'completed').length;
  const startedLessons = lessons.filter((lesson) => ['in_progress', 'completed', 'to_repeat', 'overdue'].includes(lesson.progress?.status)).length;
  const repeatLessons = lessons.filter((lesson) => lesson.progress?.status === 'to_repeat').length;
  const overdueLessons = lessons.filter((lesson) => lesson.progress?.status === 'overdue').length;
  const percent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
  const status = overdueLessons > 0
    ? 'overdue'
    : repeatLessons > 0
      ? 'to_repeat'
      : totalLessons > 0 && completedLessons === totalLessons
        ? 'completed'
        : startedLessons > 0
          ? 'in_progress'
          : 'not_started';

  return {
    completedLessons,
    startedLessons,
    repeatLessons,
    overdueLessons,
    totalLessons,
    percent,
    status,
    topicStatus: status,
  };
};

const requireSubscriptionAccess = async (auth, packageId) => {
  if (isAdminAuth(auth)) {
    return null;
  }

  const accessContext = await getLearningAccessContext({ auth, packageId });
  if (!accessContext.hasAccess) {
    const error = new Error('Active subscription required');
    error.status = 403;
    error.requiredTierSlug = accessContext.requiredTierSlug;
    error.userTierSlug = accessContext.userTierSlug;
    throw error;
  }

  return accessContext.subscriptionRecord;
};

const canUseLearningPlan = async ({ auth, subscriptionRecord }) => {
  if (isAdminAuth(auth)) {
    return true;
  }

  const context = await getSubscriptionTierContext(subscriptionRecord);
  return Boolean(
    context?.hasAccess
    && canAccessZ3Tier({
      userTierSlug: context.tierSlug,
      requiredTierSlug: Z3_LEARNING_TIERS.STRUKTUR,
    }),
  );
};

const PLAN_CLOSED_ASSIGNMENT_STATUSES = new Set(['completed', 'skipped']);

const getDateKey = (value = new Date()) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().slice(0, 10);
};

const addDaysToDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey || getDateKey()}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  date.setUTCDate(date.getUTCDate() + days);
  return getDateKey(date);
};

const isOpenPlanAssignment = (assignment) =>
  !PLAN_CLOSED_ASSIGNMENT_STATUSES.has(String(assignment?.status || '').trim());

const sortPlanAssignments = (assignments = []) => [...assignments].sort((a, b) =>
  String(a.assignedDate || a.dueDate || '').localeCompare(String(b.assignedDate || b.dueDate || ''))
  || Number(a.position || 0) - Number(b.position || 0)
  || String(a.title || '').localeCompare(String(b.title || '')));

const getDateDiffDays = (fromDateKey, toDateKey) => {
  const fromDate = new Date(`${fromDateKey}T00:00:00.000Z`);
  const toDate = new Date(`${toDateKey}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return 0;
  }

  return Math.max(0, Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)));
};

const buildPlanSnapshotProgress = (snapshot, fallback = {}) => {
  if (!snapshot) {
    return {
      scope: fallback.scope || '',
      completedAssignments: Number(fallback.completedAssignments || 0),
      totalAssignments: Number(fallback.totalAssignments || 0),
      completedMinutes: Number(fallback.completedMinutes || 0),
      targetMinutes: Number(fallback.targetMinutes || fallback.totalTargetMinutes || 0),
      completedTopics: Number(fallback.completedTopics || 0),
      totalTopics: Number(fallback.totalTopics || 0),
      behindDays: Number(fallback.behindDays || 0),
      feedbackCode: fallback.feedbackCode || '',
      percent: Number(fallback.percent || 0),
    };
  }

  const assignmentPercent = snapshot.totalAssignments > 0
    ? Math.round((snapshot.completedAssignments / snapshot.totalAssignments) * 100)
    : 0;
  const minutePercent = snapshot.targetMinutes > 0
    ? Math.round((snapshot.completedMinutes / snapshot.targetMinutes) * 100)
    : 0;

  return {
    ...snapshot,
    percent: assignmentPercent || minutePercent,
  };
};

const buildLearningPlanFeedback = ({
  recalculationState,
  behindDays = 0,
  openAssignments = 0,
  weeklyProgress = null,
}) => {
  if (recalculationState === 'long_pause') {
    return {
      code: 'long_pause',
      messageKey: 'learning.plan_feedback_long_pause',
      params: { days: behindDays },
      tone: 'warning',
    };
  }

  if (behindDays > 0) {
    return {
      code: behindDays === 1 ? 'one_day_behind' : 'days_behind',
      messageKey: behindDays === 1 ? 'learning.plan_feedback_one_day_behind' : 'learning.plan_feedback_days_behind',
      params: { days: behindDays },
      tone: 'warning',
    };
  }

  if (Number(weeklyProgress?.percent || 0) >= 100) {
    return {
      code: 'weekly_goal_reached',
      messageKey: 'learning.plan_feedback_weekly_goal_reached',
      params: {},
      tone: 'success',
    };
  }

  if (openAssignments > 0) {
    return {
      code: 'topics_still_open',
      messageKey: 'learning.plan_feedback_topics_still_open',
      params: { count: openAssignments },
      tone: 'neutral',
    };
  }

  return {
    code: 'on_track',
    messageKey: 'learning.plan_feedback_on_track',
    params: {},
    tone: 'success',
  };
};

const syncLearningPlanBehindState = async ({ planRecord, assignments }) => {
  const todayKey = getDateKey();
  const overdueAssignments = assignments.filter((assignment) =>
    isOpenPlanAssignment(assignment)
    && getDateKey(assignment.dueDate)
    && getDateKey(assignment.dueDate) < todayKey);
  const behindDays = overdueAssignments.reduce(
    (maxDays, assignment) => Math.max(maxDays, getDateDiffDays(getDateKey(assignment.dueDate), todayKey)),
    0,
  );
  const recalculationState = overdueAssignments.length === 0
    ? 'none'
    : behindDays >= 7
      ? 'long_pause'
      : 'minor_delay';
  const now = new Date().toISOString();
  const recalculationOfferedAt = recalculationState === 'long_pause'
    ? planRecord.recalculation_offered_at || now
    : '';

  const assignmentUpdates = overdueAssignments
    .filter((assignment) =>
      assignment.status !== 'overdue'
      || assignment.assignmentType !== 'catch_up'
      || assignment.priority !== 'urgent')
    .map((assignment) => pb.collection('learning_plan_assignments').update(assignment.id, {
      status: 'overdue',
      assignment_type: 'catch_up',
      priority: 'urgent',
    }).catch((error) => {
      logger.warn(`[LEARNING] Could not mark plan assignment ${assignment.id} as overdue: ${error.message}`);
      return null;
    }));

  await Promise.all(assignmentUpdates);

  if (
    planRecord.recalculation_state !== recalculationState
    || String(planRecord.recalculation_offered_at || '') !== recalculationOfferedAt
  ) {
    await pb.collection('learning_plans').update(planRecord.id, {
      recalculation_state: recalculationState,
      recalculation_offered_at: recalculationOfferedAt,
    }).then((updatedRecord) => {
      planRecord.recalculation_state = updatedRecord.recalculation_state;
      planRecord.recalculation_offered_at = updatedRecord.recalculation_offered_at;
    }).catch((error) => {
      logger.warn(`[LEARNING] Could not update recalculation state for plan ${planRecord.id}: ${error.message}`);
    });
  }

  const updatedAssignmentIds = new Set(overdueAssignments.map((assignment) => assignment.id));

  return {
    status: recalculationState,
    behindDays,
    overdueAssignments: overdueAssignments.length,
    canRecalculate: recalculationState === 'long_pause',
    offeredAt: recalculationOfferedAt,
    recalculatedAt: planRecord.recalculated_at || '',
    updatedAssignmentIds,
  };
};

const ensureLearningPlanDay = async ({ planRecord, dayDate, dayIndex, dayType = 'study', targetMinutes = 0 }) => {
  const existingRecord = await pb.collection('learning_plan_days')
    .getFirstListItem(`plan_id="${escapePbString(planRecord.id)}" && day_date="${escapePbString(dayDate)}"`, {
      $autoCancel: false,
    })
    .catch(() => null);

  if (existingRecord) {
    return existingRecord;
  }

  return pb.collection('learning_plan_days').create({
    user_id: planRecord.user_id,
    plan_id: planRecord.id,
    package_id: planRecord.package_id,
    day_date: dayDate,
    day_index: dayIndex,
    status: dayDate === getDateKey() ? 'in_progress' : 'planned',
    day_type: dayType,
    target_minutes: targetMinutes,
    completed_minutes: 0,
    assignment_count: 0,
    completed_assignment_count: 0,
    feedback_code: '',
    metadata: {},
  });
};

const recalculateLearningPlanAssignments = async ({ planRecord, assignments }) => {
  const todayKey = getDateKey();
  const dailyGoalMinutes = Math.max(15, Number(planRecord.daily_goal_minutes || 45));
  const openAssignments = sortPlanAssignments(assignments.filter(isOpenPlanAssignment));
  const now = new Date().toISOString();

  if (openAssignments.length === 0) {
    await pb.collection('learning_plans').update(planRecord.id, {
      recalculation_state: 'none',
      recalculation_offered_at: '',
      recalculated_at: now,
    });
    return { rescheduledAssignments: 0 };
  }

  const dayStats = new Map();
  let dayOffset = 0;
  let minutesForCurrentDay = 0;
  let positionForCurrentDay = 0;

  for (const assignment of openAssignments) {
    const estimatedMinutes = Math.max(5, Number(assignment.estimatedMinutes || 0));
    if (minutesForCurrentDay > 0 && minutesForCurrentDay + estimatedMinutes > dailyGoalMinutes) {
      dayOffset += 1;
      minutesForCurrentDay = 0;
      positionForCurrentDay = 0;
    }

    const targetDate = addDaysToDateKey(todayKey, dayOffset);
    const isCatchUp = assignment.status === 'overdue'
      || assignment.assignmentType === 'catch_up'
      || (getDateKey(assignment.dueDate) && getDateKey(assignment.dueDate) < todayKey);
    const assignmentType = isCatchUp ? 'catch_up' : assignment.assignmentType;
    const dayRecord = await ensureLearningPlanDay({
      planRecord,
      dayDate: targetDate,
      dayIndex: dayOffset,
      dayType: assignmentType === 'preparation' ? 'preparation' : assignmentType === 'catch_up' ? 'catch_up' : 'study',
      targetMinutes: dailyGoalMinutes,
    });

    positionForCurrentDay += 1;
    minutesForCurrentDay += estimatedMinutes;
    const currentStats = dayStats.get(dayRecord.id) || {
      record: dayRecord,
      assignmentCount: 0,
      targetMinutes: 0,
    };
    currentStats.assignmentCount += 1;
    currentStats.targetMinutes += estimatedMinutes;
    dayStats.set(dayRecord.id, currentStats);

    await pb.collection('learning_plan_assignments').update(assignment.id, {
      plan_day_id: dayRecord.id,
      assignment_type: assignmentType,
      status: assignment.status === 'started' ? 'started' : 'open',
      priority: isCatchUp ? 'high' : assignment.priority || 'normal',
      assigned_date: targetDate,
      due_date: targetDate,
      position: positionForCurrentDay,
      source: 'recalculation',
    });
  }

  await Promise.all([...dayStats.values()].map(({ record, assignmentCount, targetMinutes }) =>
    pb.collection('learning_plan_days').update(record.id, {
      status: record.day_date === todayKey ? 'in_progress' : 'planned',
      target_minutes: Math.max(targetMinutes, Number(record.target_minutes || 0)),
      assignment_count: assignmentCount,
      feedback_code: assignmentCount > 0 ? 'plan_recalculated' : record.feedback_code || '',
    }).catch((error) => {
      logger.warn(`[LEARNING] Could not update recalculated plan day ${record.id}: ${error.message}`);
      return null;
    })));

  await pb.collection('learning_plans').update(planRecord.id, {
    recalculation_state: 'none',
    recalculation_offered_at: '',
    recalculated_at: now,
    current_day_index: 0,
  });

  await pb.collection('learning_plan_snapshots').create({
    user_id: planRecord.user_id,
    plan_id: planRecord.id,
    package_id: planRecord.package_id,
    snapshot_date: todayKey,
    scope: 'recalculation',
    completed_assignments: assignments.filter((assignment) => assignment.status === 'completed').length,
    total_assignments: assignments.length,
    completed_minutes: assignments
      .filter((assignment) => assignment.status === 'completed')
      .reduce((sum, assignment) => sum + Number(assignment.estimatedMinutes || 0), 0),
    target_minutes: assignments.reduce((sum, assignment) => sum + Number(assignment.estimatedMinutes || 0), 0),
    completed_topics: 0,
    total_topics: 0,
    behind_days: 0,
    feedback_code: 'plan_recalculated',
    payload: {
      rescheduledAssignments: openAssignments.length,
      recalculatedAt: now,
    },
  }).catch((error) => {
    logger.warn(`[LEARNING] Could not write recalculation snapshot for plan ${planRecord.id}: ${error.message}`);
    return null;
  });

  return { rescheduledAssignments: openAssignments.length };
};

const getLearningPlanOverview = async ({ userId, packageRecord, subscriptionRecord, enabled }) => {
  const base = {
    enabled: enabled === true,
    requiredTierSlug: Z3_LEARNING_TIERS.STRUKTUR,
    hasPlan: false,
    plan: null,
    days: [],
    assignments: [],
    snapshots: [],
    sections: {
      today: [],
      catchUp: [],
      preparation: [],
    },
    continueAssignment: null,
    behindState: {
      status: 'none',
      behindDays: 0,
      overdueAssignments: 0,
    },
    recalculation: {
      state: 'none',
      canRecalculate: false,
      offeredAt: '',
      recalculatedAt: '',
    },
    feedback: buildLearningPlanFeedback({
      recalculationState: 'none',
      behindDays: 0,
      openAssignments: 0,
    }),
    weeklyProgress: buildPlanSnapshotProgress(null, { scope: 'weekly' }),
    overallProgress: buildPlanSnapshotProgress(null, { scope: 'overall' }),
    summary: {
      totalAssignments: 0,
      completedAssignments: 0,
      openAssignments: 0,
      overdueAssignments: 0,
      repeatAssignments: 0,
      totalTargetMinutes: 0,
      completedMinutes: 0,
      percent: 0,
    },
  };

  if (!enabled || !userId || !packageRecord?.id) {
    return base;
  }

  const planRecord = await pb.collection('learning_plans')
    .getFirstListItem(
      `user_id="${escapePbString(userId)}" && package_id="${escapePbString(packageRecord.id)}" && status!="archived"`,
      { sort: '-updated', $autoCancel: false },
    )
    .catch(() => null);

  if (!planRecord) {
    return base;
  }

  const [dayRecords, assignmentRecords, snapshotRecords, moduleRecords, lessonRecords] = await Promise.all([
    pb.collection('learning_plan_days').getFullList({
      filter: `plan_id="${escapePbString(planRecord.id)}"`,
      sort: 'day_date,day_index',
      $autoCancel: false,
    }).catch(() => []),
    pb.collection('learning_plan_assignments').getFullList({
      filter: `plan_id="${escapePbString(planRecord.id)}"`,
      sort: 'assigned_date,position',
      $autoCancel: false,
    }).catch(() => []),
    pb.collection('learning_plan_snapshots').getFullList({
      filter: `plan_id="${escapePbString(planRecord.id)}"`,
      sort: '-snapshot_date,scope',
      $autoCancel: false,
    }).catch(() => []),
    pb.collection('learning_modules').getFullList({
      filter: `package_id="${escapePbString(packageRecord.id)}" && status="published"`,
      sort: 'position,title',
      $autoCancel: false,
    }).catch(() => []),
    pb.collection('learning_lessons').getFullList({
      filter: `package_id="${escapePbString(packageRecord.id)}" && status="published"`,
      sort: 'position,title',
      $autoCancel: false,
    }).catch(() => []),
  ]);

  const moduleById = new Map(moduleRecords.map((moduleRecord) => [moduleRecord.id, moduleRecord]));
  const lessonById = new Map(lessonRecords.map((lessonRecord) => [lessonRecord.id, lessonRecord]));
  const serializedSnapshots = snapshotRecords.map(serializeLearningPlanSnapshot);
  const enrichAssignment = (record) => {
    const assignment = serializeLearningPlanAssignment(record);
    const lessonRecord = assignment.lessonId ? lessonById.get(assignment.lessonId) : null;
    const moduleRecord = moduleById.get(assignment.moduleId || lessonRecord?.module_id || '');
    const metadata = assignment.metadata && typeof assignment.metadata === 'object' ? assignment.metadata : {};
    const title = lessonRecord?.title || moduleRecord?.title || metadata.title || 'Learning assignment';
    const description = lessonRecord?.description || moduleRecord?.description || metadata.description || '';
    const topic = moduleRecord ? {
      id: moduleRecord.id,
      slug: moduleRecord.slug,
      title: moduleRecord.title,
    } : null;
    const subtopic = lessonRecord ? {
      id: lessonRecord.id,
      slug: lessonRecord.slug,
      title: lessonRecord.title,
    } : null;
    const path = lessonRecord && moduleRecord
      ? `/learning/topics/${encodeURIComponent(packageRecord.slug)}/${encodeURIComponent(moduleRecord.slug)}/subtopics/${encodeURIComponent(lessonRecord.slug)}`
      : moduleRecord
        ? `/learning/topics/${encodeURIComponent(packageRecord.slug)}/${encodeURIComponent(moduleRecord.slug)}`
        : '';

    return {
      ...assignment,
      moduleId: moduleRecord?.id || assignment.moduleId,
      lessonId: lessonRecord?.id || assignment.lessonId,
      title,
      description,
      topic,
      subtopic,
      path,
      estimatedMinutes: Number(assignment.estimatedMinutes || lessonRecord?.estimated_minutes || moduleRecord?.estimated_duration_minutes || 0),
    };
  };

  let assignments = sortPlanAssignments(assignmentRecords.map(enrichAssignment));
  const behindState = await syncLearningPlanBehindState({ planRecord, assignments });
  assignments = sortPlanAssignments(assignments.map((assignment) =>
    behindState.updatedAssignmentIds.has(assignment.id)
      ? {
        ...assignment,
        status: 'overdue',
        assignmentType: 'catch_up',
        priority: 'urgent',
      }
      : assignment));
  const completedAssignments = assignments.filter((assignment) => assignment.status === 'completed').length;
  const totalAssignments = assignments.length;
  const completedMinutes = assignments
    .filter((assignment) => assignment.status === 'completed')
    .reduce((sum, assignment) => sum + Number(assignment.estimatedMinutes || 0), 0);
  const totalTargetMinutes = assignments.reduce((sum, assignment) => sum + Number(assignment.estimatedMinutes || 0), 0);
  const todayKey = getDateKey();
  const tomorrowKey = addDaysToDateKey(todayKey, 1);
  const openAssignments = assignments.filter(isOpenPlanAssignment);
  const sections = {
    today: openAssignments.filter((assignment) =>
      getDateKey(assignment.assignedDate) === todayKey || getDateKey(assignment.dueDate) === todayKey),
    catchUp: openAssignments.filter((assignment) =>
      assignment.status === 'overdue'
      || (getDateKey(assignment.dueDate) && getDateKey(assignment.dueDate) < todayKey)),
    preparation: openAssignments.filter((assignment) =>
      assignment.assignmentType === 'preparation'
      || getDateKey(assignment.assignedDate) === tomorrowKey
      || getDateKey(assignment.dueDate) === tomorrowKey),
  };
  const summary = {
    totalAssignments,
    completedAssignments,
    openAssignments: assignments.filter((assignment) => ['open', 'started'].includes(assignment.status)).length,
    overdueAssignments: assignments.filter((assignment) => assignment.status === 'overdue').length,
    repeatAssignments: assignments.filter((assignment) => assignment.status === 'to_repeat').length,
    totalTargetMinutes,
    completedMinutes,
    percent: totalAssignments > 0 ? Math.round((completedAssignments / totalAssignments) * 100) : 0,
  };
  const weeklySnapshot = serializedSnapshots.find((snapshot) => snapshot.scope === 'weekly');
  const overallSnapshot = serializedSnapshots.find((snapshot) => snapshot.scope === 'overall');
  const weeklyProgress = buildPlanSnapshotProgress(weeklySnapshot, {
    scope: 'weekly',
    completedAssignments,
    totalAssignments,
    completedMinutes,
    targetMinutes: totalTargetMinutes,
    percent: summary.percent,
    behindDays: behindState.behindDays,
  });
  const overallProgress = buildPlanSnapshotProgress(overallSnapshot, {
    scope: 'overall',
    completedAssignments,
    totalAssignments,
    completedMinutes,
    targetMinutes: totalTargetMinutes,
    percent: summary.percent,
    behindDays: behindState.behindDays,
  });
  const feedback = buildLearningPlanFeedback({
    recalculationState: behindState.status,
    behindDays: behindState.behindDays,
    openAssignments: summary.openAssignments,
    weeklyProgress,
  });

  return {
    ...base,
    hasPlan: true,
    plan: serializeLearningPlan(planRecord),
    days: dayRecords.map(serializeLearningPlanDay),
    assignments,
    snapshots: serializedSnapshots,
    sections,
    continueAssignment: sections.catchUp[0] || sections.today[0] || sections.preparation[0] || openAssignments[0] || null,
    behindState: {
      status: behindState.status,
      behindDays: behindState.behindDays,
      overdueAssignments: behindState.overdueAssignments,
    },
    recalculation: {
      state: behindState.status,
      canRecalculate: behindState.canRecalculate,
      offeredAt: behindState.offeredAt,
      recalculatedAt: behindState.recalculatedAt,
    },
    feedback,
    weeklyProgress,
    overallProgress,
    summary,
    subscriptionId: subscriptionRecord?.id || '',
  };
};

const hasFullAssetAccessFromToken = async ({ tokenPayload, lessonRecord }) => {
  if (!tokenPayload || tokenPayload.accessLevel !== 'full') {
    return false;
  }

  if (tokenPayload.lessonId !== lessonRecord.id || tokenPayload.packageId !== lessonRecord.package_id) {
    return false;
  }

  if (tokenPayload.accessRole === 'admin') {
    return true;
  }

  if (tokenPayload.accessRole !== 'subscription' || !tokenPayload.userId) {
    return false;
  }

  const accessContext = await getLearningAccessContext({
    auth: { id: tokenPayload.userId },
    packageId: lessonRecord.package_id,
  });

  return accessContext.hasAccess;
};

const findStripeCustomerIdForUser = async (userId) => {
  const subscriptions = await pb.collection('learning_subscriptions').getFullList({
    filter: `user_id="${String(userId).replace(/"/g, '\\"')}" && stripe_customer_id!=""`,
    sort: '-updated',
    $autoCancel: false,
  }).catch(() => []);

  return String(subscriptions[0]?.stripe_customer_id || '').trim();
};

const ensureStripeCustomer = async ({ user, existingCustomerId }) => {
  if (existingCustomerId) {
    return existingCustomerId;
  }

  const customers = await stripe.customers.list({
    email: user.email,
    limit: 1,
  });

  if (customers.data[0]?.id) {
    return customers.data[0].id;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || user.email,
    metadata: {
      user_id: user.id,
      type: 'learning_student',
    },
  });

  return customer.id;
};

const isMissingStripeResourceError = (error) =>
  error?.type === 'StripeInvalidRequestError'
  && /No such (price|product)/i.test(String(error.message || ''));

const getValidStripeProductId = async (packageRecord) => {
  const existingProductId = String(packageRecord.stripe_product_id || '').trim();

  if (existingProductId) {
    try {
      const product = await stripe.products.retrieve(existingProductId);
      if (!product?.deleted) {
        return existingProductId;
      }
    } catch (error) {
      if (!isMissingStripeResourceError(error)) {
        throw error;
      }

      logger.warn(`[LEARNING] Stored Stripe product ${existingProductId} for package ${packageRecord.slug} was not found. Creating a replacement.`);
    }
  }

  const product = await stripe.products.create({
    name: packageRecord.title,
    description: packageRecord.subtitle || packageRecord.description || '',
    metadata: {
      package_id: packageRecord.id,
      package_slug: packageRecord.slug,
      ...(normalizeZ3TierSlug(packageRecord.slug) ? { z3_tier: normalizeZ3TierSlug(packageRecord.slug) } : {}),
      type: 'learning_package',
    },
  });

  return product.id;
};

const ensureStripePriceForPackage = async (packageRecord, billingCycle = 'month') => {
  const normalizedBillingCycle = billingCycle === 'year' ? 'year' : 'month';
  const existingPriceId = normalizedBillingCycle === 'year'
    ? String(packageRecord.yearly_stripe_price_id || '').trim()
    : String(packageRecord.stripe_price_id || '').trim();
  if (existingPriceId) {
    try {
      const price = await stripe.prices.retrieve(existingPriceId);
      if (!price?.deleted && price?.active !== false) {
        return existingPriceId;
      }
    } catch (error) {
      if (!isMissingStripeResourceError(error)) {
        throw error;
      }

      logger.warn(`[LEARNING] Stored Stripe price ${existingPriceId} for package ${packageRecord.slug} (${normalizedBillingCycle}) was not found. Creating a replacement.`);
    }
  }

  const productId = await getValidStripeProductId(packageRecord);
  const amount = normalizedBillingCycle === 'year'
    ? Number(packageRecord.yearly_price_amount || 0)
    : Number(packageRecord.price_amount || 0);

  if (amount <= 0) {
    throw new Error(`Missing ${normalizedBillingCycle}ly price amount for learning package`);
  }

  const price = await stripe.prices.create({
    currency: String(packageRecord.currency || 'EUR').toLowerCase(),
    unit_amount: Math.round(amount * 100),
    recurring: {
      interval: normalizedBillingCycle,
      interval_count: 1,
    },
    product: productId,
    metadata: {
      package_id: packageRecord.id,
      package_slug: packageRecord.slug,
      ...(normalizeZ3TierSlug(packageRecord.slug) ? { z3_tier: normalizeZ3TierSlug(packageRecord.slug) } : {}),
      type: 'learning_package_price',
      billing_cycle: normalizedBillingCycle,
    },
  });

  await pb.collection('learning_packages').update(packageRecord.id, {
    stripe_product_id: productId,
    ...(normalizedBillingCycle === 'year'
      ? { yearly_stripe_price_id: price.id }
      : { stripe_price_id: price.id }),
  });
  packageRecord.stripe_product_id = productId;
  if (normalizedBillingCycle === 'year') {
    packageRecord.yearly_stripe_price_id = price.id;
  } else {
    packageRecord.stripe_price_id = price.id;
  }

  return price.id;
};

let learningPortalConfigurationCache = {
  id: '',
  expiresAt: 0,
};

const buildLearningPortalProducts = async () => {
  const packages = await pb.collection('learning_packages').getFullList({
    filter: 'status="published"',
    sort: 'sort_order,title',
    $autoCancel: false,
  }).catch(() => []);

  const portalProducts = [];

  for (const packageRecord of packages) {
    const monthlyPriceId = await ensureStripePriceForPackage(packageRecord, 'month');
    const priceIds = [monthlyPriceId];

    if (Number(packageRecord.yearly_price_amount || 0) > 0) {
      priceIds.push(await ensureStripePriceForPackage(packageRecord, 'year'));
    }

    const productId = String(packageRecord.stripe_product_id || '').trim();
    if (productId && priceIds.length > 0) {
      portalProducts.push({
        product: productId,
        prices: [...new Set(priceIds.filter(Boolean))],
      });
    }
  }

  return portalProducts;
};

const ensureLearningBillingPortalConfiguration = async () => {
  const now = Date.now();
  if (learningPortalConfigurationCache.id && learningPortalConfigurationCache.expiresAt > now) {
    return learningPortalConfigurationCache.id;
  }

  const products = await buildLearningPortalProducts();
  const subscriptionUpdateEnabled = products.some((item) => item.prices.length > 1);
  const configPayload = {
    business_profile: {
      headline: 'Zahniboerse Learning subscription management',
    },
    default_return_url: `${FRONTEND_URL}/learning/subscription`,
    features: {
      customer_update: {
        enabled: true,
        allowed_updates: ['email', 'name', 'address', 'phone'],
      },
      invoice_history: {
        enabled: true,
      },
      payment_method_update: {
        enabled: true,
      },
      subscription_cancel: {
        enabled: true,
        mode: 'at_period_end',
        cancellation_reason: {
          enabled: true,
          options: ['too_expensive', 'switched_service', 'unused', 'other'],
        },
      },
      subscription_update: {
        enabled: subscriptionUpdateEnabled,
        default_allowed_updates: ['price'],
        proration_behavior: 'create_prorations',
        products: subscriptionUpdateEnabled ? products : [],
      },
    },
    metadata: {
      type: 'learning_portal',
    },
  };

  const configurations = await stripe.billingPortal.configurations.list({ limit: 10 });
  const existingConfiguration = configurations.data.find((configuration) =>
    configuration.active === true && configuration.metadata?.type === 'learning_portal'
  );
  const configuration = existingConfiguration
    ? await stripe.billingPortal.configurations.update(existingConfiguration.id, configPayload)
    : await stripe.billingPortal.configurations.create(configPayload);

  learningPortalConfigurationCache = {
    id: configuration.id,
    expiresAt: now + LEARNING_PORTAL_CONFIGURATION_CACHE_TTL_MS,
  };

  return configuration.id;
};

const getLearningCouponByCode = async (code) => {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  return pb.collection('learning_coupons').getFirstListItem(`code="${escapePbString(normalizedCode)}"`, {
    $autoCancel: false,
  }).catch(() => null);
};

const getCouponCalendarBoundaryTime = (value, boundary = 'start') => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return null;

  const dateMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    const boundaryDate = new Date(Number(year), Number(month) - 1, Number(day));
    if (boundary === 'end') {
      boundaryDate.setDate(boundaryDate.getDate() + 1);
    }
    return boundaryDate.getTime();
  }

  const parsedTime = new Date(rawValue).getTime();
  return Number.isNaN(parsedTime) ? null : parsedTime;
};

const assertLearningCouponUsable = ({ couponRecord, packageRecord }) => {
  if (!couponRecord) {
    const error = new Error('Coupon not found');
    error.status = 404;
    throw error;
  }

  if (couponRecord.status !== 'active') {
    const error = new Error('Coupon is not active');
    error.status = 400;
    throw error;
  }

  const now = Date.now();
  const startsAtTime = getCouponCalendarBoundaryTime(couponRecord.starts_at, 'start');
  if (startsAtTime && startsAtTime > now) {
    const error = new Error('Coupon is not active yet');
    error.status = 400;
    throw error;
  }

  const expiresAtTime = getCouponCalendarBoundaryTime(couponRecord.expires_at, 'end');
  if (expiresAtTime && expiresAtTime <= now) {
    const error = new Error('Coupon has expired');
    error.status = 400;
    throw error;
  }

  const couponPackageId = String(couponRecord.package_id || '').trim();
  if (couponPackageId && couponPackageId !== packageRecord.id) {
    const error = new Error('Coupon does not apply to this package');
    error.status = 400;
    throw error;
  }

  const couponBundleKey = String(couponRecord.bundle_key || '').trim();
  if (couponBundleKey && couponBundleKey !== String(packageRecord.bundle_key || '').trim()) {
    const error = new Error('Coupon does not apply to this bundle');
    error.status = 400;
    throw error;
  }

  const maxRedemptions = Number(couponRecord.max_redemptions || 0);
  const redemptionCount = Number(couponRecord.redemption_count || 0);
  if (maxRedemptions > 0 && redemptionCount >= maxRedemptions) {
    const error = new Error('Coupon redemption limit has been reached');
    error.status = 400;
    throw error;
  }
};

const validateLearningCouponForCheckout = async ({ code, packageRecord }) => {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  const couponRecord = await getLearningCouponByCode(normalizedCode);
  assertLearningCouponUsable({ couponRecord, packageRecord });
  return couponRecord;
};

const getLearningPackagePriceAmount = (packageRecord, billingCycle = 'month') => {
  const normalizedBillingCycle = billingCycle === 'year' ? 'year' : 'month';
  return normalizedBillingCycle === 'year'
    ? Number(packageRecord.yearly_price_amount || 0)
    : Number(packageRecord.price_amount || 0);
};

const roundCurrencyAmount = (amount) => Math.max(0, Math.round(Number(amount || 0) * 100) / 100);

const calculateLearningCouponCheckoutPreview = ({ couponRecord, packageRecord, billingCycle = 'month' }) => {
  const originalAmount = roundCurrencyAmount(getLearningPackagePriceAmount(packageRecord, billingCycle));
  const discountType = COUPON_DISCOUNT_TYPES.has(couponRecord?.discount_type)
    ? couponRecord.discount_type
    : 'percent';
  let discountAmount = 0;

  if (discountType === 'fixed_amount') {
    const couponCurrency = String(couponRecord.currency || 'EUR').trim().toUpperCase();
    const packageCurrency = String(packageRecord.currency || 'EUR').trim().toUpperCase();
    if (couponCurrency !== packageCurrency) {
      const error = new Error('Coupon currency does not match this package');
      error.status = 400;
      throw error;
    }

    discountAmount = Number(couponRecord.amount_off || 0);
  } else {
    const percentOff = Number(couponRecord.percent_off || 0);
    discountAmount = originalAmount * (percentOff / 100);
  }

  const normalizedDiscount = roundCurrencyAmount(Math.min(originalAmount, discountAmount));
  const finalAmount = roundCurrencyAmount(originalAmount - normalizedDiscount);

  return {
    coupon: serializeLearningCoupon(couponRecord),
    billingCycle: billingCycle === 'year' ? 'year' : 'month',
    currency: packageRecord.currency || 'EUR',
    originalAmount,
    discountAmount: normalizedDiscount,
    finalAmount,
    isFree: finalAmount <= 0,
  };
};

const getFreeCouponAccessEnd = ({ couponRecord, billingCycle = 'month', startIso }) => {
  const duration = COUPON_DURATIONS.has(couponRecord?.duration) ? couponRecord.duration : 'once';

  if (duration === 'forever') {
    return '';
  }

  if (duration === 'repeating') {
    return addMonthsToIso(startIso, Math.max(1, Number(couponRecord.duration_in_months || 1)));
  }

  return addMonthsToIso(startIso, billingCycle === 'year' ? 12 : 1);
};

const createFreeLearningSubscriptionFromCoupon = async ({
  auth,
  packageRecord,
  couponRecord,
  couponPreview,
  billingCycle,
  existingPackageSubscription = null,
}) => {
  const now = new Date().toISOString();
  const accessEndsAt = getFreeCouponAccessEnd({ couponRecord, billingCycle, startIso: now });
  const subscriptionPayload = {
    user_id: auth.id,
    package_id: packageRecord.id,
    stripe_subscription_id: '',
    stripe_checkout_session_id: '',
    status: 'active',
    cancel_at_period_end: false,
    current_period_start: now,
    current_period_end: accessEndsAt,
    canceled_at: '',
    price_amount: 0,
    currency: packageRecord.currency || 'EUR',
    billing_interval: billingCycle,
    access_ends_at: accessEndsAt,
    grace_ends_at: '',
    last_payment_failed_at: '',
  };

  if (existingPackageSubscription?.stripe_customer_id) {
    subscriptionPayload.stripe_customer_id = existingPackageSubscription.stripe_customer_id;
  }

  const subscriptionRecord = existingPackageSubscription
    ? await pb.collection('learning_subscriptions').update(existingPackageSubscription.id, subscriptionPayload, { $autoCancel: false })
    : await pb.collection('learning_subscriptions').create(subscriptionPayload, { $autoCancel: false });

  const redemptionRecord = await pb.collection('learning_coupon_redemptions').create({
    coupon_id: couponRecord.id,
    user_id: auth.id,
    package_id: packageRecord.id,
    subscription_id: subscriptionRecord.id,
    checkout_session_id: '',
    stripe_coupon_id: String(couponRecord.stripe_coupon_id || '').trim(),
    stripe_promotion_code_id: String(couponRecord.stripe_promotion_code_id || '').trim(),
    status: 'applied',
    discount_type: couponRecord.discount_type || '',
    percent_off: Number(couponRecord.percent_off || 0),
    amount_off: Number(couponRecord.amount_off || 0),
    currency: couponRecord.currency || packageRecord.currency || 'EUR',
  }, { $autoCancel: false });

  await pb.collection('learning_coupons').update(couponRecord.id, {
    redemption_count: Number(couponRecord.redemption_count || 0) + 1,
  }, { $autoCancel: false });

  await logLearningSubscriptionEvent({
    subscriptionRecord,
    eventType: existingPackageSubscription ? 'free_coupon_subscription_reactivated' : 'free_coupon_subscription_created',
    source: 'coupon_checkout',
    payload: {
      couponId: couponRecord.id,
      code: couponRecord.code || '',
      redemptionId: redemptionRecord.id,
      billingCycle,
      originalAmount: couponPreview.originalAmount,
      discountAmount: couponPreview.discountAmount,
      finalAmount: couponPreview.finalAmount,
      accessEndsAt,
    },
  });

  await logLearningSubscriptionEvent({
    subscriptionRecord,
    eventType: 'coupon_redeemed',
    source: 'coupon_checkout',
    payload: {
      couponId: couponRecord.id,
      code: couponRecord.code || '',
      redemptionId: redemptionRecord.id,
      finalAmount: couponPreview.finalAmount,
    },
  });

  return subscriptionRecord;
};

const ensureStripeCouponForLearningCoupon = async (couponRecord) => {
  const existingStripeCouponId = String(couponRecord.stripe_coupon_id || '').trim();
  if (existingStripeCouponId) {
    return existingStripeCouponId;
  }

  const discountType = COUPON_DISCOUNT_TYPES.has(couponRecord.discount_type)
    ? couponRecord.discount_type
    : 'percent';
  const duration = COUPON_DURATIONS.has(couponRecord.duration) ? couponRecord.duration : 'once';
  const couponPayload = {
    name: couponRecord.title || couponRecord.code,
    duration,
    metadata: {
      type: 'learning_coupon',
      learning_coupon_id: couponRecord.id,
      code: couponRecord.code,
      package_id: couponRecord.package_id || '',
      bundle_key: couponRecord.bundle_key || '',
    },
  };

  if (duration === 'repeating') {
    couponPayload.duration_in_months = Math.max(1, Number(couponRecord.duration_in_months || 1));
  }

  if (discountType === 'fixed_amount') {
    const amountOff = Number(couponRecord.amount_off || 0);
    if (amountOff <= 0) {
      const error = new Error('Fixed amount coupon requires an amount');
      error.status = 400;
      throw error;
    }

    couponPayload.amount_off = Math.round(amountOff * 100);
    couponPayload.currency = String(couponRecord.currency || 'EUR').toLowerCase();
  } else {
    const percentOff = Number(couponRecord.percent_off || 0);
    if (percentOff <= 0 || percentOff > 100) {
      const error = new Error('Percent coupon requires a value between 1 and 100');
      error.status = 400;
      throw error;
    }

    couponPayload.percent_off = percentOff;
  }

  const stripeCoupon = await stripe.coupons.create(couponPayload);
  await pb.collection('learning_coupons').update(couponRecord.id, {
    stripe_coupon_id: stripeCoupon.id,
  });

  return stripeCoupon.id;
};

const buildLearningCouponPayload = (body, { partial = false } = {}) => {
  const payload = {
    code: body?.code === undefined ? undefined : String(body.code || '').trim().toUpperCase(),
    title: body?.title === undefined ? undefined : String(body.title || '').trim(),
    description: body?.description === undefined ? undefined : String(body.description || '').trim(),
    package_id: body?.packageId === undefined ? undefined : String(body.packageId || '').trim(),
    bundle_key: body?.bundleKey === undefined ? undefined : String(body.bundleKey || '').trim(),
    status: body?.status === undefined ? undefined : (ADMIN_COUPON_STATUSES.has(body.status) ? body.status : 'draft'),
    discount_type: body?.discountType === undefined ? undefined : (COUPON_DISCOUNT_TYPES.has(body.discountType) ? body.discountType : 'percent'),
    percent_off: body?.percentOff === undefined ? undefined : Number(body.percentOff || 0),
    amount_off: body?.amountOff === undefined ? undefined : Number(body.amountOff || 0),
    currency: body?.currency === undefined ? undefined : (String(body.currency || 'EUR').trim() || 'EUR'),
    duration: body?.duration === undefined ? undefined : (COUPON_DURATIONS.has(body.duration) ? body.duration : 'once'),
    duration_in_months: body?.durationInMonths === undefined ? undefined : Number(body.durationInMonths || 0),
    starts_at: body?.startsAt === undefined ? undefined : String(body.startsAt || '').trim(),
    expires_at: body?.expiresAt === undefined ? undefined : String(body.expiresAt || '').trim(),
    max_redemptions: body?.maxRedemptions === undefined ? undefined : Number(body.maxRedemptions || 0),
    stripe_coupon_id: body?.stripeCouponId === undefined ? undefined : String(body.stripeCouponId || '').trim(),
    stripe_promotion_code_id: body?.stripePromotionCodeId === undefined ? undefined : String(body.stripePromotionCodeId || '').trim(),
    promotion_text: body?.promotionText === undefined ? undefined : String(body.promotionText || '').trim(),
  };

  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  if (!partial) {
    payload.status = payload.status || 'draft';
    payload.discount_type = payload.discount_type || 'percent';
    payload.currency = payload.currency || 'EUR';
    payload.duration = payload.duration || 'once';
    payload.redemption_count = 0;
  }

  return payload;
};

const hasText = (value) => String(value || '').trim().length > 0;
const hasPositiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const hasOrderNumber = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;
const hasListItems = (value) => Array.isArray(value) && value.some((item) => hasText(item));
const hasFaqItems = (value) =>
  Array.isArray(value)
  && value.some((item) => hasText(item?.question) && hasText(item?.answer));

const getMissingAdminPackageFields = (payload) => {
  const missing = [];

  if (!hasText(payload.title)) missing.push('title');
  if (!hasText(payload.slug)) missing.push('slug');
  if (!hasText(payload.subtitle)) missing.push('shortDescription');
  if (!hasPositiveNumber(payload.price_amount)) missing.push('price');
  if (!['month', 'year'].includes(String(payload.billing_interval || ''))) missing.push('interval');
  if (!['draft', 'published', 'archived'].includes(String(payload.status || ''))) missing.push('status');
  if (!hasText(payload.hero_copy)) missing.push('heroCopy');
  if (!hasListItems(payload.value_points)) missing.push('usp');
  if (!hasText(payload.pricing_copy)) missing.push('pricingCopy');
  if (!hasFaqItems(payload.faq)) missing.push('faq');
  if (!hasText(payload.cta_text)) missing.push('cta');

  return missing;
};

const getMissingAdminModuleFields = (payload) => {
  const missing = [];

  if (!hasText(payload.title)) missing.push('title');
  if (!hasText(payload.package_id)) missing.push('packageRelation');
  if (!hasOrderNumber(payload.position)) missing.push('order');
  if (!['draft', 'published'].includes(String(payload.status || ''))) missing.push('status');

  return missing;
};

const getMissingAdminLessonFields = (payload) => {
  const missing = [];

  if (!hasText(payload.title)) missing.push('title');
  if (!hasText(payload.module_id)) missing.push('moduleRelation');
  if (!['video', 'text', 'pdf', 'download', 'mixed'].includes(String(payload.content_type || ''))) missing.push('type');
  if (!hasOrderNumber(payload.position)) missing.push('order');
  if (!['draft', 'published'].includes(String(payload.status || ''))) missing.push('status');

  return missing;
};

const sendMissingAdminFields = (res, fields) =>
  res.status(400).json({
    error: 'Mandatory admin fields are missing',
    fields,
  });

const mergeRecordPayload = (record, payload) => ({
  ...record,
  ...payload,
});

const getLearningRecordsByFilter = async (collectionName, filter, sort = 'created') =>
  pb.collection(collectionName).getFullList({
    filter,
    sort,
    $autoCancel: false,
  }).catch(() => []);

const deleteLearningRecords = async (collectionName, records) => {
  for (const record of records) {
    await pb.collection(collectionName).delete(record.id, { $autoCancel: false });
  }
};

const deleteLearningProgressByFilter = async (filter) => {
  const progressRecords = await getLearningRecordsByFilter('learning_progress', filter);
  await deleteLearningRecords('learning_progress', progressRecords);
  return progressRecords.length;
};

const emptyLearningPlanDeleteSummary = () => ({
  deletedPlanAssignments: 0,
  deletedPlanDays: 0,
  deletedPlanSnapshots: 0,
  deletedPlans: 0,
});

const deleteLearningPlanAssignmentsByFilter = async (filter) => {
  const assignmentRecords = await getLearningRecordsByFilter('learning_plan_assignments', filter);
  await deleteLearningRecords('learning_plan_assignments', assignmentRecords);

  return {
    ...emptyLearningPlanDeleteSummary(),
    deletedPlanAssignments: assignmentRecords.length,
  };
};

const deleteLearningPackagePlanRecords = async (packageId) => {
  const packageFilter = `package_id="${escapePbString(packageId)}"`;
  const [assignmentRecords, dayRecords, snapshotRecords, planRecords] = await Promise.all([
    getLearningRecordsByFilter('learning_plan_assignments', packageFilter),
    getLearningRecordsByFilter('learning_plan_days', packageFilter),
    getLearningRecordsByFilter('learning_plan_snapshots', packageFilter),
    getLearningRecordsByFilter('learning_plans', packageFilter),
  ]);

  await deleteLearningRecords('learning_plan_assignments', assignmentRecords);
  await deleteLearningRecords('learning_plan_days', dayRecords);
  await deleteLearningRecords('learning_plan_snapshots', snapshotRecords);
  await deleteLearningRecords('learning_plans', planRecords);

  return {
    deletedPlanAssignments: assignmentRecords.length,
    deletedPlanDays: dayRecords.length,
    deletedPlanSnapshots: snapshotRecords.length,
    deletedPlans: planRecords.length,
  };
};

const deleteLearningLessonRecord = async (lessonRecord) => {
  const deletedProgress = await deleteLearningProgressByFilter(`lesson_id="${escapePbString(lessonRecord.id)}"`);
  const planRecords = await deleteLearningPlanAssignmentsByFilter(`lesson_id="${escapePbString(lessonRecord.id)}"`);
  await pb.collection('learning_lessons').delete(lessonRecord.id, { $autoCancel: false });
  return {
    deletedLessons: 1,
    deletedProgress,
    ...planRecords,
  };
};

const deleteLearningModuleRecord = async (moduleRecord) => {
  const lessonRecords = await getLearningRecordsByFilter(
    'learning_lessons',
    `module_id="${escapePbString(moduleRecord.id)}"`,
    'position,title',
  );
  let deletedLessons = 0;
  let deletedProgress = 0;
  let deletedPlanAssignments = 0;
  let deletedPlanDays = 0;
  let deletedPlanSnapshots = 0;
  let deletedPlans = 0;

  for (const lessonRecord of lessonRecords) {
    const result = await deleteLearningLessonRecord(lessonRecord);
    deletedLessons += result.deletedLessons;
    deletedProgress += result.deletedProgress;
    deletedPlanAssignments += result.deletedPlanAssignments;
    deletedPlanDays += result.deletedPlanDays;
    deletedPlanSnapshots += result.deletedPlanSnapshots;
    deletedPlans += result.deletedPlans;
  }

  const modulePlanRecords = await deleteLearningPlanAssignmentsByFilter(`module_id="${escapePbString(moduleRecord.id)}"`);
  deletedPlanAssignments += modulePlanRecords.deletedPlanAssignments;
  deletedPlanDays += modulePlanRecords.deletedPlanDays;
  deletedPlanSnapshots += modulePlanRecords.deletedPlanSnapshots;
  deletedPlans += modulePlanRecords.deletedPlans;

  await pb.collection('learning_modules').delete(moduleRecord.id, { $autoCancel: false });

  return {
    deletedModules: 1,
    deletedLessons,
    deletedProgress,
    deletedPlanAssignments,
    deletedPlanDays,
    deletedPlanSnapshots,
    deletedPlans,
  };
};

router.get('/packages', async (_req, res) => {
  const packages = await getPublishedPackages();
  res.json({ items: packages });
});

router.get('/packages/:slug', async (req, res) => {
  const packageRecord = await getPackageRecordBySlug(req.params.slug).catch(() => null);

  if (!packageRecord || !(await isActiveLearningPackageRecord(packageRecord))) {
    return res.status(404).json({ error: 'Learning package not found' });
  }

  const packageDetail = await getPackageDetail(packageRecord);
  res.json(packageDetail);
});

router.get('/search', requireAuth, async (req, res) => {
  const query = String(req.query.query || req.query.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 12), 1), 30);

  if (query.length < 2) {
    return res.json({
      query,
      items: [],
      count: 0,
    });
  }

  const packageRecords = await getAccessibleLearningPackageRecordsForAuth(req.auth);

  if (packageRecords.length === 0) {
    return res.status(403).json({ error: 'Active subscription required' });
  }

  const items = [];
  for (const packageRecord of packageRecords) {
    const modules = await pb.collection('learning_modules').getFullList({
      filter: `package_id="${escapePbString(packageRecord.id)}" && status="published"`,
      sort: 'position,title',
      $autoCancel: false,
    }).catch(() => []);

    const lessons = await pb.collection('learning_lessons').getFullList({
      filter: `package_id="${escapePbString(packageRecord.id)}" && status="published"`,
      sort: 'position,title',
      $autoCancel: false,
    }).catch(() => []);

    const moduleById = new Map(modules.map((moduleRecord) => [moduleRecord.id, moduleRecord]));

    for (const moduleRecord of modules) {
      const score = getLearningSearchScore({
        query,
        title: moduleRecord.title,
        description: moduleRecord.description,
        slug: moduleRecord.slug,
      });

      if (score <= 0) continue;

      items.push({
        id: moduleRecord.id,
        type: 'topic',
        score,
        title: moduleRecord.title,
        description: moduleRecord.description || '',
        excerpt: buildLearningSearchExcerpt({
          query,
          fields: [moduleRecord.title, moduleRecord.description, moduleRecord.slug],
        }),
        package: {
          id: packageRecord.id,
          slug: packageRecord.slug,
          title: packageRecord.title,
        },
        topic: {
          id: moduleRecord.id,
          slug: moduleRecord.slug,
          title: moduleRecord.title,
        },
        path: `/learning/topics/${encodeURIComponent(packageRecord.slug)}/${encodeURIComponent(moduleRecord.slug)}`,
        position: Number(moduleRecord.position || 0),
      });
    }

    for (const lessonRecord of lessons) {
      const moduleRecord = moduleById.get(String(lessonRecord.module_id || ''));
      if (!moduleRecord) continue;
      const lessonSearchText = getLearningRichPlainText(safeJson(lessonRecord.rich_content), lessonRecord.text_content);

      const score = getLearningSearchScore({
        query,
        title: lessonRecord.title,
        description: lessonRecord.description,
        body: lessonSearchText,
        slug: lessonRecord.slug,
      });

      if (score <= 0) continue;

      items.push({
        id: lessonRecord.id,
        type: 'subtopic',
        score,
        title: lessonRecord.title,
        description: lessonRecord.description || '',
        excerpt: buildLearningSearchExcerpt({
          query,
          fields: [lessonRecord.title, lessonRecord.description, lessonSearchText, lessonRecord.slug],
        }),
        package: {
          id: packageRecord.id,
          slug: packageRecord.slug,
          title: packageRecord.title,
        },
        topic: {
          id: moduleRecord.id,
          slug: moduleRecord.slug,
          title: moduleRecord.title,
        },
        subtopic: {
          id: lessonRecord.id,
          slug: lessonRecord.slug,
          title: lessonRecord.title,
        },
        path: `/learning/topics/${encodeURIComponent(packageRecord.slug)}/${encodeURIComponent(moduleRecord.slug)}/subtopics/${encodeURIComponent(lessonRecord.slug)}`,
        position: Number(lessonRecord.position || 0),
        estimatedMinutes: Number(lessonRecord.estimated_minutes || 0),
      });
    }
  }

  const sortedItems = items
    .sort((a, b) =>
      b.score - a.score
      || String(a.package?.title || '').localeCompare(String(b.package?.title || ''))
      || String(a.topic?.title || '').localeCompare(String(b.topic?.title || ''))
      || Number(a.position || 0) - Number(b.position || 0))
    .slice(0, limit);

  return res.json({
    query,
    items: sortedItems,
    count: sortedItems.length,
  });
});

router.get('/plan', requireAuth, async (req, res) => {
  const subscriptionRecord = await getCurrentLearningSubscription(req.auth.id);
  const packageRecord = subscriptionRecord?.package_id
    ? await getPackageRecordById(subscriptionRecord.package_id)
    : null;
  const enabled = await canUseLearningPlan({ auth: req.auth, subscriptionRecord });

  if (!enabled) {
    return res.status(403).json({
      error: 'Required learning tier not available',
      requiredTierSlug: Z3_LEARNING_TIERS.STRUKTUR,
    });
  }

  const learningPlan = await getLearningPlanOverview({
    userId: req.auth.id,
    packageRecord,
    subscriptionRecord,
    enabled,
  });

  return res.json(learningPlan);
});

router.post('/plan/recalculate', requireAuth, async (req, res) => {
  const subscriptionRecord = await getCurrentLearningSubscription(req.auth.id);
  const packageRecord = subscriptionRecord?.package_id
    ? await getPackageRecordById(subscriptionRecord.package_id)
    : null;
  const enabled = await canUseLearningPlan({ auth: req.auth, subscriptionRecord });

  if (!enabled) {
    return res.status(403).json({
      error: 'Required learning tier not available',
      requiredTierSlug: Z3_LEARNING_TIERS.STRUKTUR,
    });
  }

  if (!packageRecord?.id) {
    return res.status(404).json({ error: 'Learning package not found' });
  }

  const currentPlan = await getLearningPlanOverview({
    userId: req.auth.id,
    packageRecord,
    subscriptionRecord,
    enabled,
  });

  if (!currentPlan.hasPlan || !currentPlan.plan?.id) {
    return res.status(404).json({ error: 'Learning plan not found' });
  }

  const planRecord = await pb.collection('learning_plans').getOne(currentPlan.plan.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!planRecord) {
    return res.status(404).json({ error: 'Learning plan not found' });
  }

  const result = await recalculateLearningPlanAssignments({
    planRecord,
    assignments: currentPlan.assignments,
  });
  const learningPlan = await getLearningPlanOverview({
    userId: req.auth.id,
    packageRecord,
    subscriptionRecord,
    enabled,
  });

  return res.json({
    success: true,
    ...result,
    learningPlan,
  });
});

router.get('/dashboard', requireAuth, async (req, res) => {
  const isAdminViewer = isAdminAuth(req.auth);
  const subscriptionRecord = isAdminViewer ? null : await getCurrentLearningSubscription(req.auth.id);
  const packages = await getPublishedPackages();
  const accessiblePackageRecords = await getAccessibleLearningPackageRecordsForAuth(req.auth);
  const adminPreviewPackageRecord = isAdminViewer ? accessiblePackageRecords[0] || null : null;
  const subscription = isAdminViewer
    ? buildAdminPreviewSubscription(adminPreviewPackageRecord)
    : subscriptionRecord
      ? serializeSubscription(subscriptionRecord)
      : null;
  const featureAccess = await buildLearningFeatureAccess({ auth: req.auth, subscriptionRecord });

  if (!isAdminViewer && (!subscriptionRecord || !subscription?.packageId)) {
    return res.json({
      viewer: {
        isAdmin: false,
      },
      subscription,
      hasAccess: false,
      featureAccess,
      package: null,
      accessiblePackages: [],
      modules: [],
      recentlyOpened: [],
      progress: {
        completedLessons: 0,
        totalLessons: 0,
        percent: 0,
      },
      learningPlan: await getLearningPlanOverview({
        userId: req.auth.id,
        packageRecord: null,
        subscriptionRecord,
        enabled: false,
      }),
      availablePackages: packages,
    });
  }

  const packageRecord = isAdminViewer
    ? adminPreviewPackageRecord
    : await pb.collection('learning_packages').getOne(subscription.packageId, {
      $autoCancel: false,
    }).catch(() => null);

  if (!packageRecord) {
    return res.json({
      viewer: {
        isAdmin: isAdminViewer,
      },
      subscription,
      hasAccess: subscription.hasAccess,
      featureAccess,
      package: null,
      accessiblePackages: accessiblePackageRecords.map((record) => serializePackage(record)),
      modules: [],
      recentlyOpened: [],
      progress: {
        completedLessons: 0,
        totalLessons: 0,
        percent: 0,
      },
      learningPlan: await getLearningPlanOverview({
        userId: req.auth.id,
        packageRecord: null,
        subscriptionRecord,
        enabled: false,
      }),
      availablePackages: packages,
    });
  }

  const accessiblePackageDetails = await Promise.all(
    (subscription?.hasAccess || isAdminViewer ? accessiblePackageRecords : [packageRecord])
      .filter((record) => record?.id)
      .map((record) => getPackageDetail(record)),
  );
  const packageDetail = accessiblePackageDetails.find((detail) => detail.id === packageRecord.id)
    || await getPackageDetail(packageRecord);
  const accessiblePackageIds = accessiblePackageDetails.map((detail) => detail.id).filter(Boolean);
  const progressPackageFilter = accessiblePackageIds.length > 0
    ? ` && (${accessiblePackageIds.map((packageId) => `package_id="${escapePbString(packageId)}"`).join(' || ')})`
    : ` && package_id="${escapePbString(packageRecord.id)}"`;
  const progressRecords = await pb.collection('learning_progress').getFullList({
    filter: `user_id="${escapePbString(req.auth.id)}"${progressPackageFilter}`,
    sort: '-last_opened_at,-updated',
    $autoCancel: false,
  }).catch(() => []);

  const progressByLessonId = new Map(
    progressRecords.map((record) => [record.lesson_id, {
      status: record.status || 'not_started',
      progressPercentage: Number(record.progress_percentage || 0),
      lastOpenedAt: record.last_opened_at || '',
      completedAt: record.completed_at || '',
    }]),
  );

  const modules = accessiblePackageDetails
    .flatMap((detail) => detail.modules.map((moduleRecord) => {
      const modulePackage = {
        id: detail.id,
        slug: detail.slug,
        title: detail.title,
      };

      return {
        ...moduleRecord,
        package: modulePackage,
        packageId: detail.id,
        lessons: moduleRecord.lessons.map((lessonRecord) => ({
          ...lessonRecord,
          package: modulePackage,
          packageId: detail.id,
          progress: progressByLessonId.get(lessonRecord.id) || buildDefaultLessonProgress(),
        })),
      };
    }))
    .map((moduleRecord) => ({
      ...moduleRecord,
      progress: buildModuleProgress(moduleRecord.lessons),
    }));

  const allLessons = modules.flatMap((moduleRecord) => moduleRecord.lessons);
  const completedLessons = allLessons.filter((lessonRecord) => lessonRecord.progress.status === 'completed').length;
  const recentlyOpened = [...allLessons]
    .filter((lessonRecord) => lessonRecord.progress.lastOpenedAt)
    .sort((a, b) => new Date(b.progress.lastOpenedAt).getTime() - new Date(a.progress.lastOpenedAt).getTime())
    .slice(0, 3);
  const learningPlanEnabled = await canUseLearningPlan({ auth: req.auth, subscriptionRecord });
  const learningPlan = await getLearningPlanOverview({
    userId: req.auth.id,
    packageRecord,
    subscriptionRecord,
    enabled: learningPlanEnabled,
  });

  res.json({
    viewer: {
      isAdmin: isAdminViewer,
    },
    subscription,
    hasAccess: subscription.hasAccess,
    featureAccess,
    package: {
      ...packageDetail,
      modules: undefined,
    },
    accessiblePackages: accessiblePackageDetails.map((detail) => ({
      ...detail,
      modules: undefined,
    })),
    modules,
    recentlyOpened,
    progress: {
      completedLessons,
      totalLessons: allLessons.length,
      percent: allLessons.length > 0 ? Math.round((completedLessons / allLessons.length) * 100) : 0,
    },
    learningPlan,
    availablePackages: packages,
  });
});

router.post('/coupons/validate', requireAuth, async (req, res) => {
  const slug = String(req.body?.packageSlug || '').trim();
  const billingCycle = String(req.body?.billingCycle || 'month').trim().toLowerCase() === 'year' ? 'year' : 'month';
  const couponCode = String(req.body?.couponCode || '').trim().toUpperCase();
  const packageRecord = slug
    ? await getPackageRecordBySlug(slug).catch(() => null)
    : await getActiveLearningPackageRecord().catch(() => null);

  if (!couponCode) {
    return res.status(400).json({ error: 'Coupon code is required' });
  }

  if (!packageRecord || !(await isActiveLearningPackageRecord(packageRecord))) {
    return res.status(404).json({ error: 'Learning package not found' });
  }

  try {
    const couponRecord = await validateLearningCouponForCheckout({ code: couponCode, packageRecord });
    const preview = calculateLearningCouponCheckoutPreview({ couponRecord, packageRecord, billingCycle });
    return res.json({
      success: true,
      ...preview,
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Coupon could not be applied' });
  }
});

router.post('/checkout', requireAuth, async (req, res) => {
  const slug = String(req.body?.packageSlug || '').trim();
  const billingCycle = String(req.body?.billingCycle || 'month').trim().toLowerCase() === 'year' ? 'year' : 'month';
  const couponCode = String(req.body?.couponCode || '').trim().toUpperCase();
  const packageRecord = slug
    ? await getPackageRecordBySlug(slug).catch(() => null)
    : await getActiveLearningPackageRecord().catch(() => null);

  if (!packageRecord || !(await isActiveLearningPackageRecord(packageRecord))) {
    return res.status(404).json({ error: 'Learning package not found' });
  }

  if (!isLearningTierCheckoutEnabled(packageRecord.slug)) {
    return res.status(403).json({
      error: 'Learning package checkout is disabled',
      packageSlug: packageRecord.slug,
      tierSlug: normalizeZ3TierSlug(packageRecord.slug),
    });
  }

  const user = await pb.collection('users').getOne(req.auth.id, { $autoCancel: false });
  const existingPackageSubscription = await getLearningSubscriptionForPackage({
    userId: req.auth.id,
    packageId: packageRecord.id,
  });

  if (existingPackageSubscription && hasLearningAccess(existingPackageSubscription)) {
    return res.status(409).json({
      error: 'Active subscription already exists for this package',
      subscription: serializeSubscription(existingPackageSubscription),
      package: serializePackage(packageRecord),
    });
  }

  const existingCustomerId = String(existingPackageSubscription?.stripe_customer_id || '').trim()
    || await findStripeCustomerIdForUser(req.auth.id);
  const stripeCustomerId = await ensureStripeCustomer({
    user,
    existingCustomerId,
  });
  const stripePriceId = await ensureStripePriceForPackage(packageRecord, billingCycle);
  const couponRecord = await validateLearningCouponForCheckout({ code: couponCode, packageRecord });
  const couponPreview = couponRecord
    ? calculateLearningCouponCheckoutPreview({ couponRecord, packageRecord, billingCycle })
    : null;

  if (couponRecord && couponPreview?.isFree) {
    const subscriptionRecord = await createFreeLearningSubscriptionFromCoupon({
      auth: req.auth,
      packageRecord,
      couponRecord,
      couponPreview,
      billingCycle,
      existingPackageSubscription,
    });

    logger.info(`[LEARNING] Activated free coupon subscription for user ${req.auth.id}, package ${packageRecord.slug}, coupon ${couponRecord.code}`);

    return res.status(existingPackageSubscription ? 200 : 201).json({
      success: true,
      freeSubscription: true,
      coupon: serializeLearningCoupon(couponRecord),
      subscription: serializeSubscription(subscriptionRecord),
      package: serializePackage(packageRecord),
      originalAmount: couponPreview.originalAmount,
      discountAmount: couponPreview.discountAmount,
      finalAmount: couponPreview.finalAmount,
    });
  }

  const stripeCouponId = couponRecord ? await ensureStripeCouponForLearningCoupon(couponRecord) : '';
  const z3Tier = normalizeZ3TierSlug(packageRecord.slug);
  const checkoutMetadata = {
    type: 'learning_subscription',
    package_id: packageRecord.id,
    package_slug: packageRecord.slug,
    ...(z3Tier ? { z3_tier: z3Tier } : {}),
    user_id: req.auth.id,
    user_email: user.email,
    billing_cycle: billingCycle,
    learning_coupon_id: couponRecord?.id || '',
    coupon_code: couponRecord?.code || '',
    stripe_coupon_id: stripeCouponId,
  };

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    client_reference_id: req.auth.id,
    line_items: [
      { price: stripePriceId, quantity: 1 },
    ],
    ...(stripeCouponId ? { discounts: [{ coupon: stripeCouponId }] } : {}),
    ...(couponPreview?.isFree ? { payment_method_collection: 'if_required' } : {}),
    success_url: `${FRONTEND_URL}/learning/dashboard?payment=success`,
    cancel_url: `${FRONTEND_URL}/learning/subscribe/${packageRecord.slug}?payment=cancelled&cycle=${billingCycle}`,
    metadata: checkoutMetadata,
    subscription_data: {
      metadata: checkoutMetadata,
    },
  });

  logger.info(`[LEARNING] Created subscription checkout session ${session.id} for user ${req.auth.id} and package ${packageRecord.slug}`);

  res.json({
    success: true,
    sessionId: session.id,
    url: session.url,
  });
});

const sendLearningModuleResponse = async (req, res, moduleRecord) => {
  if (!moduleRecord || moduleRecord.status !== 'published') {
    return res.status(404).json({ error: 'Learning module not found' });
  }

  const packageRecord = await pb.collection('learning_packages').getOne(moduleRecord.package_id, { $autoCancel: false }).catch(() => null);
  const modules = await getModuleTreeForPackage(moduleRecord.package_id);
  const progressMap = await getProgressMap({ userId: req.auth?.id, packageId: moduleRecord.package_id });
  const currentModule = modules.find((item) => item.id === moduleRecord.id) || null;

  if (!currentModule) {
    return res.status(404).json({ error: 'Learning module not found' });
  }

  const fullAccess = isAdminAuth(req.auth)
    ? true
    : await requireSubscriptionAccess(req.auth, moduleRecord.package_id).then(() => true).catch(() => false);
  const hasPreviewAccess = currentModule.isPreview || currentModule.lessons.some((lesson) => lesson.isPreview);
  const previewOnly = !fullAccess && !isAdminAuth(req.auth) && hasPreviewAccess;

  if (!fullAccess && !isAdminAuth(req.auth) && !hasPreviewAccess) {
    const subscriptionRecord = req.auth?.id
      ? await getLearningSubscriptionForPackage({ userId: req.auth.id, packageId: moduleRecord.package_id })
      : null;

    return res.status(403).json({
      error: 'Active subscription required',
      packageSlug: packageRecord?.slug || '',
      subscription: subscriptionRecord ? serializeSubscription(subscriptionRecord) : null,
    });
  }

  const visibleLessons = currentModule.lessons;

  const decoratedLessons = visibleLessons.map((lesson, index) => {
    const progress = progressMap.get(lesson.id) || buildDefaultLessonProgress();
    const previousProgress = visibleLessons[index - 1]
      ? progressMap.get(visibleLessons[index - 1].id)
      : null;
    const lessonPreviewAccess = currentModule.isPreview || lesson.isPreview;
    const unlocked = fullAccess
      || isAdminAuth(req.auth)
      || lessonPreviewAccess
      || index === 0
      || progress.status === 'completed'
      || previousProgress?.status === 'completed';

    return {
      ...lesson,
      progress,
      unlocked: previewOnly ? lessonPreviewAccess : unlocked,
      isPreviewAccessible: lessonPreviewAccess,
    };
  });

  res.json({
    viewer: {
      isAuthenticated: Boolean(req.auth?.id),
      isAdmin: isAdminAuth(req.auth),
      hasFullAccess: fullAccess || isAdminAuth(req.auth),
      canSaveProgress: Boolean(req.auth?.id) && (fullAccess || isAdminAuth(req.auth)),
      isPreviewOnly: previewOnly,
    },
    package: packageRecord ? serializePackage(packageRecord, {
      moduleCount: modules.length,
      lessonCount: modules.flatMap((item) => item.lessons).length,
    }) : null,
    module: {
      ...currentModule,
      lessons: decoratedLessons,
      progress: buildModuleProgress(decoratedLessons),
    },
    modules: modules.map((item) => ({
      id: item.id,
      title: item.title,
      slug: item.slug,
      position: item.position,
    })),
  });
};

router.get('/modules/:moduleId', async (req, res) => {
  const moduleRecord = await getModuleRecord(req.params.moduleId).catch(() => null);
  return sendLearningModuleResponse(req, res, moduleRecord);
});

router.get('/topics/:packageSlug/:topicSlug', async (req, res) => {
  const moduleRecord = await getModuleRecordBySlug({
    packageSlug: req.params.packageSlug,
    moduleSlug: req.params.topicSlug,
  });

  return sendLearningModuleResponse(req, res, moduleRecord);
});

const sendLearningLessonResponse = async (req, res, lessonRecord) => {
  if (!lessonRecord || lessonRecord.status !== 'published') {
    return res.status(404).json({ error: 'Learning lesson not found' });
  }

  const packageRecord = await pb.collection('learning_packages').getOne(lessonRecord.package_id, { $autoCancel: false }).catch(() => null);
  const modules = await getModuleTreeForPackage(lessonRecord.package_id);
  const progressMap = await getProgressMap({ userId: req.auth?.id, packageId: lessonRecord.package_id });
  const currentModule = modules.find((item) => item.id === lessonRecord.module_id) || null;
  const fullAccess = isAdminAuth(req.auth)
    ? true
    : await requireSubscriptionAccess(req.auth, lessonRecord.package_id).then(() => true).catch(() => false);
  const previewAccess = hasPreviewAccessToLesson({ lessonRecord, moduleRecord: currentModule });
  const previewOnly = !fullAccess && !isAdminAuth(req.auth) && previewAccess;

  if (!fullAccess && !isAdminAuth(req.auth) && !previewAccess) {
    const subscriptionRecord = req.auth?.id
      ? await getLearningSubscriptionForPackage({ userId: req.auth.id, packageId: lessonRecord.package_id })
      : null;

    return res.status(403).json({
      error: 'Active subscription required',
      packageSlug: packageRecord?.slug || '',
      subscription: subscriptionRecord ? serializeSubscription(subscriptionRecord) : null,
    });
  }

  const flatLessons = modules.flatMap((item) => item.lessons.map((lesson) => ({
    ...lesson,
    moduleTitle: item.title,
    moduleSlug: item.slug,
  })));
  const lessonIndex = flatLessons.findIndex((item) => item.id === lessonRecord.id);

  if (lessonIndex === -1) {
    return res.status(404).json({ error: 'Learning lesson not found' });
  }

  const currentLesson = flatLessons[lessonIndex];
  const progress = progressMap.get(currentLesson.id) || buildDefaultLessonProgress();
  const isAdminViewer = isAdminAuth(req.auth);
  const protectedAssets = buildProtectedLessonAssets({
    record: lessonRecord,
    hasEntitledAccess: fullAccess || isAdminViewer,
    accessUserId: req.auth?.id || '',
    accessRole: isAdminViewer ? 'admin' : fullAccess ? 'subscription' : 'preview',
  });

  res.json({
    viewer: {
      isAuthenticated: Boolean(req.auth?.id),
      isAdmin: isAdminAuth(req.auth),
      hasFullAccess: fullAccess || isAdminAuth(req.auth),
      canSaveProgress: Boolean(req.auth?.id) && (fullAccess || isAdminAuth(req.auth)),
      isPreviewOnly: previewOnly,
    },
    package: packageRecord ? serializePackage(packageRecord, {
      moduleCount: modules.length,
      lessonCount: flatLessons.length,
    }) : null,
    module: currentModule ? {
      id: currentModule.id,
      title: currentModule.title,
      slug: currentModule.slug,
      position: currentModule.position,
    } : null,
    lesson: {
      ...currentLesson,
      textContent: lessonRecord.text_content || '',
      richContent: sanitizeLearningRichContent(safeJson(lessonRecord.rich_content), lessonRecord.text_content || ''),
      progress,
      ...protectedAssets,
    },
    previousLesson: lessonIndex > 0 ? flatLessons[lessonIndex - 1] : null,
    nextLesson: lessonIndex < flatLessons.length - 1 ? flatLessons[lessonIndex + 1] : null,
  });
};

router.get('/lessons/:lessonId', async (req, res) => {
  const lessonRecord = await getLessonRecord(req.params.lessonId).catch(() => null);
  return sendLearningLessonResponse(req, res, lessonRecord);
});

router.get('/topics/:packageSlug/:topicSlug/subtopics/:subtopicSlug', async (req, res) => {
  const lessonRecord = await getLessonRecordBySlug({
    packageSlug: req.params.packageSlug,
    moduleSlug: req.params.topicSlug,
    lessonSlug: req.params.subtopicSlug,
  });

  return sendLearningLessonResponse(req, res, lessonRecord);
});

const handleProtectedLessonAsset = async (req, res, attachmentIndex = null) => {
  const lessonRecord = await getLessonRecord(req.params.lessonId).catch(() => null);
  if (!lessonRecord || lessonRecord.status !== 'published') {
    return res.status(404).json({ error: 'Learning lesson asset not found' });
  }

  const assetType = attachmentIndex === null ? req.params.assetType : 'attachment';
  const tokenPayload = verifyLearningAssetToken(req.query?.token);

  if (
    !tokenPayload
    || tokenPayload.lessonId !== lessonRecord.id
    || tokenPayload.assetType !== assetType
    || (assetType === 'attachment' && Number(tokenPayload.attachmentIndex) !== attachmentIndex)
  ) {
    return res.status(403).json({ error: 'Invalid asset token' });
  }

  const moduleRecord = await getModuleRecord(lessonRecord.module_id).catch(() => null);
  const previewAccess = hasPreviewAccessToLesson({ lessonRecord, moduleRecord });
  const fullAccess = req.auth?.id
    ? await requireSubscriptionAccess(req.auth, lessonRecord.package_id).then(() => true).catch(() => false)
    : false;
  const fullTokenAccess = await hasFullAssetAccessFromToken({ tokenPayload, lessonRecord });
  const hasAssetAccess = isAdminAuth(req.auth)
    || fullAccess
    || fullTokenAccess
    || (tokenPayload.accessLevel === 'preview' && previewAccess);

  if (!hasAssetAccess) {
    return res.status(403).json({ error: 'Protected asset access denied' });
  }

  const asset = resolveLessonAsset(lessonRecord, assetType, attachmentIndex);
  if (!asset?.url) {
    return res.status(404).json({ error: 'Learning lesson asset not found' });
  }

  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');

  const generatedSeedAsset = getGeneratedSeedAsset(lessonRecord, asset);
  if (generatedSeedAsset) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', generatedSeedAsset.length);
    const filename = encodeURIComponent(`${String(asset.label || lessonRecord.slug || assetType).replace(/\.pdf$/i, '')}.pdf`);
    res.setHeader('Content-Disposition', `${asset.disposition || 'attachment'}; filename*=UTF-8''${filename}`);
    return res.send(generatedSeedAsset);
  }

  if (assetType === 'video' && asset.presentation === 'embed') {
    const embedUrl = toEmbedVideoUrl(asset.url);
    const escapedTitle = String(asset.label || 'Video')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapedTitle}</title><style>html,body{margin:0;height:100%;background:#eef2ff}iframe{border:0;width:100%;height:100%}</style></head><body><iframe src="${embedUrl}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe></body></html>`);
  }

  const upstreamResponse = await fetch(asset.url, {
    method: 'GET',
    redirect: 'follow',
    headers: getProtectedAssetFetchHeaders(asset.url),
  }).catch(() => null);

  if (!upstreamResponse?.ok || !upstreamResponse.body) {
    return res.status(502).json({ error: 'Failed to load protected asset' });
  }

  const contentType = upstreamResponse.headers.get('content-type') || (
    assetType === 'pdf' ? 'application/pdf' : 'application/octet-stream'
  );
  res.setHeader('Content-Type', contentType);

  const upstreamLength = upstreamResponse.headers.get('content-length');
  if (upstreamLength) {
    res.setHeader('Content-Length', upstreamLength);
  }

  if (asset.disposition) {
    const filename = encodeURIComponent(String(asset.label || `${assetType}`));
    res.setHeader('Content-Disposition', `${asset.disposition}; filename*=UTF-8''${filename}`);
  }

  Readable.fromWeb(upstreamResponse.body).pipe(res);
};

router.get('/lessons/:lessonId/assets/:assetType', async (req, res) =>
  handleProtectedLessonAsset(req, res, null));

router.get('/lessons/:lessonId/assets/attachment/:attachmentIndex', async (req, res) =>
  handleProtectedLessonAsset(req, res, Number(req.params.attachmentIndex)));

router.post('/lessons/:lessonId/progress', requireAuth, async (req, res) => {
  const lessonRecord = await getLessonRecord(req.params.lessonId).catch(() => null);
  if (!lessonRecord || lessonRecord.status !== 'published') {
    return res.status(404).json({ error: 'Learning lesson not found' });
  }

  await requireSubscriptionAccess(req.auth, lessonRecord.package_id);

  const normalizedStatus = LEARNING_PROGRESS_STATUSES.includes(req.body?.status)
    ? req.body.status
    : 'in_progress';
  const progressPercentage = Math.max(0, Math.min(100, Number(req.body?.progressPercentage ?? (normalizedStatus === 'completed' ? 100 : 0)) || 0));
  const now = new Date().toISOString();

  const existingRecord = await pb.collection('learning_progress')
    .getFirstListItem(`user_id="${req.auth.id}" && lesson_id="${lessonRecord.id}"`, {
      $autoCancel: false,
    })
    .catch(() => null);

  const payload = {
    user_id: req.auth.id,
    package_id: lessonRecord.package_id,
    module_id: lessonRecord.module_id,
    lesson_id: lessonRecord.id,
    status: normalizedStatus,
    progress_percentage: progressPercentage,
    last_opened_at: now,
    completed_at: normalizedStatus === 'completed' ? now : '',
  };

  const savedRecord = existingRecord
    ? await pb.collection('learning_progress').update(existingRecord.id, payload)
    : await pb.collection('learning_progress').create(payload);

  res.json({
    success: true,
    progress: {
      id: savedRecord.id,
      status: savedRecord.status,
      progressPercentage: Number(savedRecord.progress_percentage || 0),
      lastOpenedAt: savedRecord.last_opened_at || '',
      completedAt: savedRecord.completed_at || '',
    },
  });
});

router.post('/billing-portal', requireAuth, async (req, res) => {
  const subscriptionRecord = await getCurrentLearningSubscription(req.auth.id);
  const customerId = String(subscriptionRecord?.stripe_customer_id || subscriptionRecord?.stripeCustomerId || '').trim();
  const stripeSubscriptionId = String(subscriptionRecord?.stripe_subscription_id || '').trim();

  if (!customerId) {
    return res.status(400).json({ error: 'No Stripe customer available for this user' });
  }

  const action = String(req.body?.action || '').trim();
  const returnUrl = `${FRONTEND_URL}/learning/subscription`;
  const flowData = {};

  if (action === 'cancel' && stripeSubscriptionId && subscriptionRecord.cancel_at_period_end !== true) {
    flowData.flow_data = {
      type: 'subscription_cancel',
      subscription_cancel: {
        subscription: stripeSubscriptionId,
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          return_url: `${returnUrl}?portal=cancelled`,
        },
      },
    };
  }

  if (action === 'update' && stripeSubscriptionId) {
    flowData.flow_data = {
      type: 'subscription_update',
      subscription_update: {
        subscription: stripeSubscriptionId,
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          return_url: `${returnUrl}?portal=updated`,
        },
      },
    };
  }

  const configurationId = await ensureLearningBillingPortalConfiguration();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    configuration: configurationId,
    return_url: returnUrl,
    ...flowData,
  });

  res.json({
    success: true,
    url: portalSession.url,
  });
});

router.get('/subscription-details', requireAuth, async (req, res) => {
  let subscriptionRecord = await getCurrentLearningSubscription(req.auth.id);

  if (!subscriptionRecord) {
    return res.json({
      subscription: null,
      package: null,
      paymentMethod: null,
      invoices: [],
    });
  }

  const syncedSubscription = await syncLearningSubscriptionRecordFromStripe(subscriptionRecord);
  subscriptionRecord = syncedSubscription.subscriptionRecord;
  const stripeSubscription = syncedSubscription.stripeSubscription;

  const packageRecord = await pb.collection('learning_packages').getOne(subscriptionRecord.package_id, {
    $autoCancel: false,
  }).catch(() => null);

  const customerId = String(subscriptionRecord.stripe_customer_id || '').trim();
  const stripeSubscriptionId = String(subscriptionRecord.stripe_subscription_id || '').trim();

  let paymentMethod = null;
  let invoices = [];

  const subscriptionPaymentMethod = stripeSubscription?.default_payment_method || null;
  if (subscriptionPaymentMethod && typeof subscriptionPaymentMethod !== 'string') {
    paymentMethod = {
      id: subscriptionPaymentMethod.id,
      type: subscriptionPaymentMethod.type || '',
      label: formatPaymentMethodLabel(subscriptionPaymentMethod),
    };
  }

  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['invoice_settings.default_payment_method'],
    }).catch(() => null);

    const defaultPaymentMethod = customer?.invoice_settings?.default_payment_method || null;
    if (!paymentMethod && defaultPaymentMethod) {
      paymentMethod = {
        id: defaultPaymentMethod.id,
        type: defaultPaymentMethod.type || '',
        label: formatPaymentMethodLabel(defaultPaymentMethod),
      };
    }
  }

  const storedInvoices = await syncStoredInvoicesForSubscription(subscriptionRecord, 6);
  if (storedInvoices.length > 0) {
    invoices = storedInvoices.map((record) => serializeLearningInvoice(record));
  } else if (stripeSubscriptionId) {
    invoices = (await getStripeInvoicesForSubscription(stripeSubscriptionId, 6)).map((invoice) => serializeStripeInvoice(invoice));
  }

  res.json({
    subscription: serializeSubscription(subscriptionRecord),
    package: packageRecord ? serializePackage(packageRecord) : null,
    paymentMethod,
    invoices,
  });
});

router.post(
  '/admin/media',
  requireAuth,
  admin,
  express.raw({ type: '*/*', limit: LEARNING_MEDIA_MAX_BYTES }),
  async (req, res) => {
    const mediaType = String(req.query?.mediaType || '').trim();
    const contentType = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const rawFileName = String(req.query?.fileName || '').trim();
    const fileName = rawFileName.split(/[\\/]/).pop()?.trim() || 'learning-media.bin';
    const label = String(req.query?.label || fileName).trim().slice(0, 160) || fileName;
    const fileBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

    if (!LEARNING_MEDIA_TYPES.has(mediaType)) {
      return res.status(400).json({ error: 'Unsupported learning media type' });
    }

    if (!LEARNING_MEDIA_MIME_TYPES.has(contentType)) {
      return res.status(400).json({ error: 'Unsupported learning media file type' });
    }

    if (fileBuffer.length === 0) {
      return res.status(400).json({ error: 'Learning media file is required' });
    }

    if (fileBuffer.length > LEARNING_MEDIA_MAX_BYTES) {
      return res.status(413).json({ error: 'Learning media file is too large' });
    }

    try {
      const data = new FormData();
      data.append('label', label);
      data.append('media_type', mediaType);
      data.append('file', new Blob([fileBuffer], { type: contentType }), fileName);

      const record = await pb.collection('learning_media').create(data, { $autoCancel: false });
      return res.status(201).json(serializeLearningMedia(record));
    } catch (error) {
      logger.error(`[LEARNING] Failed to upload admin media: ${error.message}`);
      return res.status(500).json({ error: 'Failed to upload learning media' });
    }
  },
);

router.get('/admin/content', requireAuth, admin, async (_req, res) => {
  try {
    const packages = await pb.collection('learning_packages').getFullList({
      sort: 'sort_order,title',
      $autoCancel: false,
    });
    const modules = await pb.collection('learning_modules').getFullList({
      sort: 'package_id,position,title',
      $autoCancel: false,
    });
    const lessons = await pb.collection('learning_lessons').getFullList({
      sort: 'module_id,position,title',
      $autoCancel: false,
    });
    const subscriptions = await pb.collection('learning_subscriptions').getFullList({
      sort: '-updated',
      $autoCancel: false,
    });
    const users = await pb.collection('users').getFullList({
      sort: 'email',
      $autoCancel: false,
    });
    const events = await pb.collection('learning_subscription_events').getFullList({
      sort: '-created',
      $autoCancel: false,
    });
    const coupons = await pb.collection('learning_coupons').getFullList({
      sort: 'code',
      $autoCancel: false,
    });

    const packageMap = new Map(packages.map((record) => [record.id, record]));
    const userMap = new Map(users.map((record) => [record.id, record]));
    const normalizedSubscriptions = [];
    for (const subscription of subscriptions) {
      normalizedSubscriptions.push(await expireSubscriptionIfNeeded(subscription));
    }

    await Promise.all(normalizedSubscriptions.map((record) =>
      syncStoredInvoicesForSubscription(record, 6).catch((error) => {
        logger.warn(`[LEARNING] Could not refresh invoices for subscription ${record.id}: ${error.message}`);
        return [];
      })));

    const invoices = await pb.collection('learning_invoices').getFullList({
      sort: '-created_at,-created',
      $autoCancel: false,
    });

    const subscribers = await Promise.all(normalizedSubscriptions.map(async (record) => serializeAdminSubscriber({
      subscriptionRecord: record,
      userRecord: userMap.get(record.user_id) || null,
      packageRecord: packageMap.get(record.package_id) || null,
      invoiceSummary: await getAdminInvoiceSummary(record),
    })));

    return res.json({
      packages: packages.map((record) => serializePackage(record)),
      modules: modules.map((record) => serializeModule(record)),
      lessons: lessons.map((record) => serializeLesson(record, { includeAssetSources: true })),
      subscribers,
      events: events.map((record) => serializeSubscriptionEvent(record, {
        userRecord: userMap.get(record.user_id) || null,
        packageRecord: packageMap.get(record.package_id) || null,
      })),
      invoices: invoices.map((record) => serializeLearningInvoice(record)),
      coupons: coupons.map((record) => serializeLearningCoupon(record)),
    });
  } catch (error) {
    logger.error(`[LEARNING] Failed to load admin content: ${error.message}`);
    return res.status(500).json({ error: 'Failed to load learning admin content' });
  }
});

router.post('/admin/packages', requireAuth, admin, async (req, res) => {
  const payload = {
    slug: String(req.body?.slug || '').trim(),
    title: String(req.body?.title || '').trim(),
    subtitle: String((req.body?.subtitle ?? req.body?.shortDescription) || '').trim(),
    description: String((req.body?.description ?? req.body?.longDescription) || '').trim(),
    target_audience: String(req.body?.targetAudience || '').trim(),
    hero_copy: String(req.body?.heroCopy || '').trim(),
    hero_image_url: String((req.body?.heroImageUrl ?? req.body?.coverImageUrl) || '').trim(),
    thumbnail_url: String(req.body?.thumbnailUrl || '').trim(),
    bundle_key: String(req.body?.bundleKey || '').trim(),
    promo_badge: String(req.body?.promoBadge || '').trim(),
    promo_text: String(req.body?.promoText || '').trim(),
    coupons_enabled: req.body?.couponsEnabled === true,
    pricing_copy: String(req.body?.pricingCopy || '').trim(),
    cta_text: String(req.body?.ctaText || '').trim(),
    seo_title: String(req.body?.seoTitle || '').trim(),
    seo_description: String(req.body?.seoDescription || '').trim(),
    og_title: String(req.body?.ogTitle || '').trim(),
    og_description: String(req.body?.ogDescription || '').trim(),
    og_image_url: String(req.body?.ogImageUrl || '').trim(),
    price_amount: Number(req.body?.priceAmount || 0),
    yearly_price_amount: Number(req.body?.yearlyPriceAmount || 0),
    currency: String(req.body?.currency || 'EUR').trim() || 'EUR',
    billing_interval: ['month', 'year'].includes(String(req.body?.billingInterval || '').trim()) ? String(req.body?.billingInterval).trim() : 'month',
    billing_interval_count: Number(req.body?.billingIntervalCount || 1) || 1,
    status: ['draft', 'published', 'archived'].includes(req.body?.status) ? req.body.status : 'draft',
    sort_order: Number(req.body?.sortOrder || 0),
    value_points: Array.isArray(req.body?.valuePoints) ? req.body.valuePoints : [],
    included_content: Array.isArray(req.body?.includedContent) ? req.body.includedContent : [],
    faq: Array.isArray(req.body?.faq) ? req.body.faq : [],
  };

  const missingFields = getMissingAdminPackageFields(payload);
  if (missingFields.length > 0) {
    return sendMissingAdminFields(res, missingFields);
  }

  const createdRecord = await pb.collection('learning_packages').create(payload);
  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_package_created',
    targetType: 'package',
    targetId: createdRecord.id,
    packageId: createdRecord.id,
    payload: {
      title: createdRecord.title,
      status: createdRecord.status,
      billingInterval: createdRecord.billing_interval,
    },
  });
  res.status(201).json(serializePackage(createdRecord));
});

router.put('/admin/packages/:id', requireAuth, admin, async (req, res) => {
  const existingRecord = await pb.collection('learning_packages').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!existingRecord) {
    return res.status(404).json({ error: 'Learning package not found' });
  }

  const payload = {
    slug: req.body?.slug,
    title: req.body?.title,
    subtitle: req.body?.subtitle ?? req.body?.shortDescription,
    description: req.body?.description ?? req.body?.longDescription,
    target_audience: req.body?.targetAudience,
    hero_copy: req.body?.heroCopy,
    hero_image_url: req.body?.heroImageUrl ?? req.body?.coverImageUrl,
    thumbnail_url: req.body?.thumbnailUrl,
    bundle_key: req.body?.bundleKey,
    promo_badge: req.body?.promoBadge,
    promo_text: req.body?.promoText,
    coupons_enabled: req.body?.couponsEnabled,
    pricing_copy: req.body?.pricingCopy,
    cta_text: req.body?.ctaText,
    seo_title: req.body?.seoTitle,
    seo_description: req.body?.seoDescription,
    og_title: req.body?.ogTitle,
    og_description: req.body?.ogDescription,
    og_image_url: req.body?.ogImageUrl,
    price_amount: req.body?.priceAmount,
    yearly_price_amount: req.body?.yearlyPriceAmount,
    currency: req.body?.currency,
    billing_interval: req.body?.billingInterval,
    billing_interval_count: req.body?.billingIntervalCount,
    status: req.body?.status,
    sort_order: req.body?.sortOrder,
    value_points: req.body?.valuePoints,
    included_content: req.body?.includedContent,
    faq: req.body?.faq,
  };

  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
  const missingFields = getMissingAdminPackageFields(mergeRecordPayload(existingRecord, payload));
  if (missingFields.length > 0) {
    return sendMissingAdminFields(res, missingFields);
  }

  const updatedRecord = await pb.collection('learning_packages').update(req.params.id, payload);
  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_package_updated',
    targetType: 'package',
    targetId: updatedRecord.id,
    packageId: updatedRecord.id,
    payload: {
      title: updatedRecord.title,
      status: updatedRecord.status,
      billingInterval: updatedRecord.billing_interval,
    },
  });
  res.json(serializePackage(updatedRecord));
});

router.delete('/admin/packages/:id', requireAuth, admin, async (req, res) => {
  const packageRecord = await pb.collection('learning_packages').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!packageRecord) {
    return res.status(404).json({ error: 'Learning package not found' });
  }

  const moduleRecords = await getLearningRecordsByFilter(
    'learning_modules',
    `package_id="${escapePbString(packageRecord.id)}"`,
    'position,title',
  );
  const couponRecords = await getLearningRecordsByFilter(
    'learning_coupons',
    `package_id="${escapePbString(packageRecord.id)}"`,
  );
  let deletedModules = 0;
  let deletedLessons = 0;
  let deletedProgress = 0;
  let deletedPlanAssignments = 0;
  let deletedPlanDays = 0;
  let deletedPlanSnapshots = 0;
  let deletedPlans = 0;

  for (const moduleRecord of moduleRecords) {
    const result = await deleteLearningModuleRecord(moduleRecord);
    deletedModules += result.deletedModules;
    deletedLessons += result.deletedLessons;
    deletedProgress += result.deletedProgress;
    deletedPlanAssignments += result.deletedPlanAssignments;
    deletedPlanDays += result.deletedPlanDays;
    deletedPlanSnapshots += result.deletedPlanSnapshots;
    deletedPlans += result.deletedPlans;
  }

  const remainingLessonRecords = await getLearningRecordsByFilter(
    'learning_lessons',
    `package_id="${escapePbString(packageRecord.id)}"`,
    'position,title',
  );
  for (const lessonRecord of remainingLessonRecords) {
    const result = await deleteLearningLessonRecord(lessonRecord);
    deletedLessons += result.deletedLessons;
    deletedProgress += result.deletedProgress;
    deletedPlanAssignments += result.deletedPlanAssignments;
    deletedPlanDays += result.deletedPlanDays;
    deletedPlanSnapshots += result.deletedPlanSnapshots;
    deletedPlans += result.deletedPlans;
  }

  deletedProgress += await deleteLearningProgressByFilter(`package_id="${escapePbString(packageRecord.id)}"`);
  const packagePlanRecords = await deleteLearningPackagePlanRecords(packageRecord.id);
  deletedPlanAssignments += packagePlanRecords.deletedPlanAssignments;
  deletedPlanDays += packagePlanRecords.deletedPlanDays;
  deletedPlanSnapshots += packagePlanRecords.deletedPlanSnapshots;
  deletedPlans += packagePlanRecords.deletedPlans;
  await deleteLearningRecords('learning_coupons', couponRecords);
  await pb.collection('learning_packages').delete(packageRecord.id, { $autoCancel: false });

  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_package_deleted',
    targetType: 'package',
    targetId: packageRecord.id,
    packageId: packageRecord.id,
    payload: {
      title: packageRecord.title,
      deletedModules,
      deletedLessons,
      deletedProgress,
      deletedPlanAssignments,
      deletedPlanDays,
      deletedPlanSnapshots,
      deletedPlans,
      deletedCoupons: couponRecords.length,
    },
  });

  res.json({
    success: true,
    deletedPackageId: packageRecord.id,
    deletedModules,
    deletedLessons,
    deletedProgress,
    deletedPlanAssignments,
    deletedPlanDays,
    deletedPlanSnapshots,
    deletedPlans,
    deletedCoupons: couponRecords.length,
  });
});

router.post('/admin/modules', requireAuth, admin, async (req, res) => {
  const payload = {
    package_id: String(req.body?.packageId || '').trim(),
    slug: String(req.body?.slug || '').trim(),
    title: String(req.body?.title || '').trim(),
    description: String((req.body?.description ?? req.body?.shortText) || '').trim(),
    status: ['draft', 'published'].includes(req.body?.status ?? req.body?.publishState) ? (req.body?.status ?? req.body?.publishState) : 'draft',
    is_preview: req.body?.isPreview === true,
    position: Number(req.body?.position || 0),
    estimated_duration_minutes: Number(req.body?.estimatedDurationMinutes || 0),
  };

  const missingFields = getMissingAdminModuleFields(payload);
  if (missingFields.length > 0) {
    return sendMissingAdminFields(res, missingFields);
  }

  const packageRecord = await pb.collection('learning_packages').getOne(payload.package_id, {
    $autoCancel: false,
  }).catch(() => null);
  if (!packageRecord) {
    return res.status(404).json({ error: 'Learning package not found' });
  }

  const createdRecord = await pb.collection('learning_modules').create(payload);

  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_module_created',
    targetType: 'module',
    targetId: createdRecord.id,
    packageId: createdRecord.package_id,
    payload: {
      title: createdRecord.title,
      status: createdRecord.status,
    },
  });
  res.status(201).json(serializeModule(createdRecord));
});

router.put('/admin/modules/:id', requireAuth, admin, async (req, res) => {
  const existingRecord = await pb.collection('learning_modules').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!existingRecord) {
    return res.status(404).json({ error: 'Learning module not found' });
  }

  const payload = {
    package_id: req.body?.packageId,
    slug: req.body?.slug,
    title: req.body?.title,
    description: req.body?.description ?? req.body?.shortText,
    status: req.body?.status ?? req.body?.publishState,
    is_preview: req.body?.isPreview,
    position: req.body?.position,
    estimated_duration_minutes: req.body?.estimatedDurationMinutes,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);
  const mergedPayload = mergeRecordPayload(existingRecord, payload);
  const missingFields = getMissingAdminModuleFields(mergedPayload);
  if (missingFields.length > 0) {
    return sendMissingAdminFields(res, missingFields);
  }

  const packageRecord = await pb.collection('learning_packages').getOne(mergedPayload.package_id, {
    $autoCancel: false,
  }).catch(() => null);
  if (!packageRecord) {
    return res.status(404).json({ error: 'Learning package not found' });
  }

  const updatedRecord = await pb.collection('learning_modules').update(req.params.id, payload);
  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_module_updated',
    targetType: 'module',
    targetId: updatedRecord.id,
    packageId: updatedRecord.package_id,
    payload: {
      title: updatedRecord.title,
      status: updatedRecord.status,
    },
  });
  res.json(serializeModule(updatedRecord));
});

router.delete('/admin/modules/:id', requireAuth, admin, async (req, res) => {
  const moduleRecord = await pb.collection('learning_modules').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!moduleRecord) {
    return res.status(404).json({ error: 'Learning module not found' });
  }

  const result = await deleteLearningModuleRecord(moduleRecord);
  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_module_deleted',
    targetType: 'module',
    targetId: moduleRecord.id,
    packageId: moduleRecord.package_id,
    payload: {
      title: moduleRecord.title,
      deletedLessons: result.deletedLessons,
      deletedProgress: result.deletedProgress,
      deletedPlanAssignments: result.deletedPlanAssignments,
      deletedPlanDays: result.deletedPlanDays,
      deletedPlanSnapshots: result.deletedPlanSnapshots,
      deletedPlans: result.deletedPlans,
    },
  });

  res.json({
    success: true,
    deletedModuleId: moduleRecord.id,
    ...result,
  });
});

router.post('/admin/lessons', requireAuth, admin, async (req, res) => {
  const richContent = sanitizeLearningRichContent(req.body?.richContent, req.body?.textContent || '');
  const textContent = getLearningRichPlainText(richContent, req.body?.textContent || '');
  const payload = {
    package_id: String(req.body?.packageId || '').trim(),
    module_id: String(req.body?.moduleId || '').trim(),
    slug: String(req.body?.slug || '').trim(),
    title: String(req.body?.title || '').trim(),
    description: String(req.body?.description || '').trim(),
    status: ['draft', 'published'].includes(req.body?.status ?? req.body?.releaseState) ? (req.body?.status ?? req.body?.releaseState) : 'draft',
    content_type: ['video', 'text', 'pdf', 'download', 'mixed'].includes(req.body?.contentType) ? req.body.contentType : 'mixed',
    video_url: String(req.body?.videoUrl || '').trim(),
    text_content: textContent,
    rich_content: richContent,
    material_url: String(req.body?.materialUrl || '').trim(),
    pdf_url: String(req.body?.pdfUrl || '').trim(),
    download_url: String(req.body?.downloadUrl || '').trim(),
    attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
    is_preview: req.body?.isPreview === true,
    position: Number(req.body?.position || 0),
    estimated_minutes: Number(req.body?.estimatedMinutes || 0),
  };

  const missingFields = getMissingAdminLessonFields(payload);
  if (missingFields.length > 0) {
    return sendMissingAdminFields(res, missingFields);
  }

  const moduleRecord = await pb.collection('learning_modules').getOne(payload.module_id, {
    $autoCancel: false,
  }).catch(() => null);
  if (!moduleRecord) {
    return res.status(404).json({ error: 'Learning module not found' });
  }
  if (payload.package_id && moduleRecord.package_id !== payload.package_id) {
    return res.status(400).json({ error: 'Lesson package must match the selected module package' });
  }

  const createdRecord = await pb.collection('learning_lessons').create(payload);

  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_lesson_created',
    targetType: 'lesson',
    targetId: createdRecord.id,
    packageId: createdRecord.package_id,
    payload: {
      title: createdRecord.title,
      status: createdRecord.status,
      contentType: createdRecord.content_type,
    },
  });
  res.status(201).json(serializeLesson(createdRecord, { includeAssetSources: true }));
});

router.put('/admin/lessons/:id', requireAuth, admin, async (req, res) => {
  const existingRecord = await pb.collection('learning_lessons').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!existingRecord) {
    return res.status(404).json({ error: 'Learning lesson not found' });
  }

  const saveMode = ['draft', 'publish'].includes(req.body?.saveMode) ? req.body.saveMode : 'save';
  const richContentWasProvided = req.body?.richContent !== undefined;
  const richContent = richContentWasProvided
    ? sanitizeLearningRichContent(req.body?.richContent, req.body?.textContent || existingRecord.text_content || '')
    : undefined;
  const textContent = richContentWasProvided
    ? getLearningRichPlainText(richContent, req.body?.textContent || existingRecord.text_content || '')
    : req.body?.textContent;

  const payload = {
    package_id: req.body?.packageId,
    module_id: req.body?.moduleId,
    slug: req.body?.slug,
    title: req.body?.title,
    description: req.body?.description,
    status: req.body?.status ?? req.body?.releaseState,
    content_type: req.body?.contentType,
    video_url: req.body?.videoUrl,
    text_content: textContent,
    rich_content: richContent,
    material_url: req.body?.materialUrl,
    pdf_url: req.body?.pdfUrl,
    download_url: req.body?.downloadUrl,
    attachments: req.body?.attachments,
    is_preview: req.body?.isPreview,
    position: req.body?.position,
    estimated_minutes: req.body?.estimatedMinutes,
  };
  Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

  if (saveMode === 'draft' && existingRecord.status === 'published') {
    const draftPayload = getAdminLessonDraftPayload({
      requestBody: req.body,
      richContent,
      textContent,
    });
    Object.keys(draftPayload).forEach((key) => draftPayload[key] === undefined && delete draftPayload[key]);

    const draftModuleId = req.body?.moduleId || existingRecord.module_id;
    const draftPackageId = req.body?.packageId || existingRecord.package_id;
    const moduleRecord = await pb.collection('learning_modules').getOne(draftModuleId, {
      $autoCancel: false,
    }).catch(() => null);
    if (!moduleRecord) {
      return res.status(404).json({ error: 'Learning module not found' });
    }
    if (draftPackageId && moduleRecord.package_id !== draftPackageId) {
      return res.status(400).json({ error: 'Lesson package must match the selected module package' });
    }

    const updatedRecord = await pb.collection('learning_lessons').update(req.params.id, draftPayload);
    await logLearningAdminAction({
      actorUserId: req.auth.id,
      eventType: 'admin_lesson_draft_saved',
      targetType: 'lesson',
      targetId: updatedRecord.id,
      packageId: updatedRecord.package_id,
      payload: {
        title: draftPayload.draft_title || updatedRecord.title,
        status: updatedRecord.status,
      },
    });
    return res.json(serializeLesson(updatedRecord, { includeAssetSources: true }));
  }

  if (saveMode === 'publish') {
    Object.assign(payload, {
      status: 'published',
      ...clearAdminLessonDraftPayload,
    });
  }

  const mergedPayload = mergeRecordPayload(existingRecord, payload);
  const missingFields = getMissingAdminLessonFields(mergedPayload);
  if (missingFields.length > 0) {
    return sendMissingAdminFields(res, missingFields);
  }

  const moduleRecord = await pb.collection('learning_modules').getOne(mergedPayload.module_id, {
    $autoCancel: false,
  }).catch(() => null);
  if (!moduleRecord) {
    return res.status(404).json({ error: 'Learning module not found' });
  }
  if (mergedPayload.package_id && moduleRecord.package_id !== mergedPayload.package_id) {
    return res.status(400).json({ error: 'Lesson package must match the selected module package' });
  }

  const updatedRecord = await pb.collection('learning_lessons').update(req.params.id, payload);
  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_lesson_updated',
    targetType: 'lesson',
    targetId: updatedRecord.id,
    packageId: updatedRecord.package_id,
    payload: {
      title: updatedRecord.title,
      status: updatedRecord.status,
      contentType: updatedRecord.content_type,
    },
  });
  res.json(serializeLesson(updatedRecord, { includeAssetSources: true }));
});

router.delete('/admin/lessons/:id', requireAuth, admin, async (req, res) => {
  const lessonRecord = await pb.collection('learning_lessons').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!lessonRecord) {
    return res.status(404).json({ error: 'Learning lesson not found' });
  }

  const result = await deleteLearningLessonRecord(lessonRecord);
  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_lesson_deleted',
    targetType: 'lesson',
    targetId: lessonRecord.id,
    packageId: lessonRecord.package_id,
    payload: {
      title: lessonRecord.title,
      moduleId: lessonRecord.module_id,
      deletedProgress: result.deletedProgress,
      deletedPlanAssignments: result.deletedPlanAssignments,
      deletedPlanDays: result.deletedPlanDays,
      deletedPlanSnapshots: result.deletedPlanSnapshots,
      deletedPlans: result.deletedPlans,
    },
  });

  res.json({
    success: true,
    deletedLessonId: lessonRecord.id,
    ...result,
  });
});

router.post('/admin/lessons/:id/duplicate', requireAuth, admin, async (req, res) => {
  const sourceLesson = await pb.collection('learning_lessons').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!sourceLesson) {
    return res.status(404).json({ error: 'Learning lesson not found' });
  }

  const duplicatedRecord = await pb.collection('learning_lessons').create({
    package_id: sourceLesson.package_id,
    module_id: sourceLesson.module_id,
    slug: await buildDuplicateSlug(sourceLesson.slug),
    title: `${sourceLesson.title} (Copy)`,
    description: sourceLesson.description || '',
    status: 'draft',
    content_type: sourceLesson.content_type || 'mixed',
    video_url: sourceLesson.video_url || '',
    text_content: sourceLesson.text_content || '',
    rich_content: sanitizeLearningRichContent(safeJson(sourceLesson.rich_content), sourceLesson.text_content || ''),
    material_url: sourceLesson.material_url || '',
    pdf_url: sourceLesson.pdf_url || '',
    download_url: sourceLesson.download_url || '',
    attachments: safeJson(sourceLesson.attachments),
    is_preview: sourceLesson.is_preview === true,
    position: Number(sourceLesson.position || 0) + 1,
    estimated_minutes: Number(sourceLesson.estimated_minutes || 0),
  });

  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_lesson_duplicated',
    targetType: 'lesson',
    targetId: duplicatedRecord.id,
    packageId: duplicatedRecord.package_id,
    payload: {
      sourceLessonId: sourceLesson.id,
      title: duplicatedRecord.title,
      status: duplicatedRecord.status,
    },
  });
  res.status(201).json(serializeLesson(duplicatedRecord, { includeAssetSources: true }));
});

router.post('/admin/coupons', requireAuth, admin, async (req, res) => {
  console.log('[LEARNING ADMIN COUPON CREATE] req.body', req.body);
  const payload = buildLearningCouponPayload(req.body);

  if (!payload.code || !payload.title) {
    return res.status(400).json({ error: 'Coupon code and title are required' });
  }

  if (payload.package_id) {
    const packageRecord = await pb.collection('learning_packages').getOne(payload.package_id, {
      $autoCancel: false,
    }).catch(() => null);

    if (!packageRecord) {
      return res.status(404).json({ error: 'Learning package not found' });
    }
  }

  const createdRecord = await pb.collection('learning_coupons').create(payload);
  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_coupon_created',
    targetType: 'coupon',
    targetId: createdRecord.id,
    packageId: createdRecord.package_id || '',
    payload: {
      code: createdRecord.code,
      status: createdRecord.status,
      discountType: createdRecord.discount_type,
    },
  });

  res.status(201).json(serializeLearningCoupon(createdRecord));
});

router.put('/admin/coupons/:id', requireAuth, admin, async (req, res) => {
  console.log('[LEARNING ADMIN COUPON UPDATE] req.body', req.body);
  const existingRecord = await pb.collection('learning_coupons').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!existingRecord) {
    return res.status(404).json({ error: 'Learning coupon not found' });
  }

  const payload = buildLearningCouponPayload(req.body, { partial: true });
  if (payload.package_id) {
    const packageRecord = await pb.collection('learning_packages').getOne(payload.package_id, {
      $autoCancel: false,
    }).catch(() => null);

    if (!packageRecord) {
      return res.status(404).json({ error: 'Learning package not found' });
    }
  }

  const stripeImmutableFields = [
    'discountType',
    'percentOff',
    'amountOff',
    'currency',
    'duration',
    'durationInMonths',
  ];
  const changedStripeShape = stripeImmutableFields.some((field) => req.body?.[field] !== undefined);
  if (changedStripeShape && req.body?.stripeCouponId === undefined) {
    payload.stripe_coupon_id = '';
    payload.stripe_promotion_code_id = '';
  }

  const updatedRecord = await pb.collection('learning_coupons').update(existingRecord.id, payload);
  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_coupon_updated',
    targetType: 'coupon',
    targetId: updatedRecord.id,
    packageId: updatedRecord.package_id || '',
    payload: {
      code: updatedRecord.code,
      previousStatus: existingRecord.status || '',
      status: updatedRecord.status,
      discountType: updatedRecord.discount_type,
    },
  });

  res.json(serializeLearningCoupon(updatedRecord));
});

router.delete('/admin/coupons/:id', requireAuth, admin, async (req, res) => {
  const existingRecord = await pb.collection('learning_coupons').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!existingRecord) {
    return res.status(404).json({ error: 'Learning coupon not found' });
  }

  await pb.collection('learning_coupons').delete(existingRecord.id);
  await logLearningAdminAction({
    actorUserId: req.auth.id,
    eventType: 'admin_coupon_deleted',
    targetType: 'coupon',
    targetId: existingRecord.id,
    packageId: existingRecord.package_id || '',
    payload: {
      code: existingRecord.code || '',
      status: existingRecord.status || '',
      discountType: existingRecord.discount_type || '',
    },
  });

  res.json({ success: true, id: existingRecord.id });
});

router.post('/admin/subscribers/grant', requireAuth, admin, async (req, res) => {
  const userEmail = String(req.body?.userEmail || '').trim().toLowerCase();
  const packageId = String(req.body?.packageId || '').trim();
  const durationDays = Math.max(1, Number(req.body?.durationDays || 30));

  if (!userEmail || !packageId) {
    return res.status(400).json({ error: 'User email and package are required' });
  }

  const userRecord = await pb.collection('users').getFirstListItem(`email="${userEmail.replace(/"/g, '\\"')}"`, {
    $autoCancel: false,
  }).catch(() => null);
  if (!userRecord) {
    return res.status(404).json({ error: 'User not found' });
  }

  const packageRecord = await pb.collection('learning_packages').getOne(packageId, {
    $autoCancel: false,
  }).catch(() => null);
  if (!packageRecord) {
    return res.status(404).json({ error: 'Learning package not found' });
  }

  const existingRecord = await pb.collection('learning_subscriptions').getFirstListItem(
    `user_id="${userRecord.id}" && package_id="${packageId}"`,
    { sort: '-updated', $autoCancel: false },
  ).catch(() => null);

  const now = new Date().toISOString();
  const endsAt = addDaysToIso(now, durationDays);
  const payload = {
    user_id: userRecord.id,
    package_id: packageId,
    status: 'active',
    cancel_at_period_end: false,
    current_period_start: now,
    current_period_end: endsAt,
    canceled_at: '',
    price_amount: Number(packageRecord.price_amount || 0),
    currency: packageRecord.currency || 'EUR',
    billing_interval: 'manual',
    access_ends_at: endsAt,
    grace_ends_at: '',
  };

  const savedRecord = existingRecord
    ? await pb.collection('learning_subscriptions').update(existingRecord.id, payload)
    : await pb.collection('learning_subscriptions').create(payload);

  await logLearningSubscriptionEvent({
    subscriptionRecord: savedRecord,
    eventType: existingRecord ? 'subscription_manually_extended' : 'subscription_manually_granted',
    source: 'admin',
    payload: {
      adminId: req.auth.id,
      actorUserId: req.auth.id,
      durationDays,
    },
  });

  res.status(existingRecord ? 200 : 201).json(serializeAdminSubscriber({
    subscriptionRecord: savedRecord,
    userRecord,
    packageRecord,
  }));
});

router.post('/admin/subscribers/:id/status', requireAuth, admin, async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!ADMIN_SUBSCRIPTION_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Unsupported subscription status' });
  }

  const subscriptionRecord = await pb.collection('learning_subscriptions').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!subscriptionRecord) {
    return res.status(404).json({ error: 'Subscriber record not found' });
  }

  const payload = buildManualSubscriptionStatusPayload({
    subscriptionRecord,
    status,
    durationDays: req.body?.durationDays,
  });

  if (!payload) {
    return res.status(400).json({ error: 'Unsupported subscription status' });
  }

  const savedRecord = await pb.collection('learning_subscriptions').update(subscriptionRecord.id, payload);

  await logLearningSubscriptionEvent({
    subscriptionRecord: savedRecord,
    eventType: getManualSubscriptionStatusEventType({
      subscriptionRecord,
      status,
    }),
    source: 'admin',
    payload: {
      adminId: req.auth.id,
      actorUserId: req.auth.id,
      previousStatus: subscriptionRecord.status || '',
      status,
      durationDays: Number(req.body?.durationDays || 0),
      reason: String(req.body?.reason || '').trim(),
    },
  });

  const userRecord = await pb.collection('users').getOne(savedRecord.user_id, { $autoCancel: false }).catch(() => null);
  const packageRecord = await pb.collection('learning_packages').getOne(savedRecord.package_id, { $autoCancel: false }).catch(() => null);

  res.json(serializeAdminSubscriber({
    subscriptionRecord: savedRecord,
    userRecord,
    packageRecord,
  }));
});

router.post('/admin/subscribers/:id/revoke', requireAuth, admin, async (req, res) => {
  const subscriptionRecord = await pb.collection('learning_subscriptions').getOne(req.params.id, {
    $autoCancel: false,
  }).catch(() => null);

  if (!subscriptionRecord) {
    return res.status(404).json({ error: 'Subscriber record not found' });
  }

  const now = new Date().toISOString();
  const savedRecord = await pb.collection('learning_subscriptions').update(subscriptionRecord.id, {
    status: 'expired',
    cancel_at_period_end: false,
    current_period_end: now,
    access_ends_at: now,
    grace_ends_at: '',
    canceled_at: now,
  });

  await logLearningSubscriptionEvent({
    subscriptionRecord: savedRecord,
    eventType: 'subscription_manually_revoked',
    source: 'admin',
    payload: {
      adminId: req.auth.id,
      actorUserId: req.auth.id,
    },
  });

  const userRecord = await pb.collection('users').getOne(savedRecord.user_id, { $autoCancel: false }).catch(() => null);
  const packageRecord = await pb.collection('learning_packages').getOne(savedRecord.package_id, { $autoCancel: false }).catch(() => null);

  res.json(serializeAdminSubscriber({
    subscriptionRecord: savedRecord,
    userRecord,
    packageRecord,
  }));
});

export default router;





