export const Z3_LEARNING_TIERS = Object.freeze({
  START: 'z3-start',
  STRUKTUR: 'z3-struktur',
  PRUEFUNGSTRAINER: 'z3-pruefungstrainer',
});

export const Z3_LEARNING_TIER_ORDER = Object.freeze([
  Z3_LEARNING_TIERS.START,
  Z3_LEARNING_TIERS.STRUKTUR,
  Z3_LEARNING_TIERS.PRUEFUNGSTRAINER,
]);

export const DISABLED_Z3_CHECKOUT_TIERS = Object.freeze([
]);

const Z3_TIER_ALIASES = new Map([
  ['start', Z3_LEARNING_TIERS.START],
  ['z3start', Z3_LEARNING_TIERS.START],
  ['z3-start', Z3_LEARNING_TIERS.START],
  ['z3-start-month', Z3_LEARNING_TIERS.START],
  ['z3-start-year', Z3_LEARNING_TIERS.START],
  ['struktur', Z3_LEARNING_TIERS.STRUKTUR],
  ['z3struktur', Z3_LEARNING_TIERS.STRUKTUR],
  ['z3-struktur', Z3_LEARNING_TIERS.STRUKTUR],
  ['z3-struktur-month', Z3_LEARNING_TIERS.STRUKTUR],
  ['z3-struktur-year', Z3_LEARNING_TIERS.STRUKTUR],
  ['pruefungstrainer', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
  ['prufungstrainer', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
  ['z3pruefungstrainer', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
  ['z3prufungstrainer', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
  ['z3-pruefungstrainer', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
  ['z3-prufungstrainer', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
  ['z3-pruefungstrainer-month', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
  ['z3-pruefungstrainer-year', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
  ['z3-prufungstrainer-month', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
  ['z3-prufungstrainer-year', Z3_LEARNING_TIERS.PRUEFUNGSTRAINER],
]);

const normalizeIdentifier = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/_/g, '-')
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '');

export const normalizeZ3TierSlug = (value) => {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return '';

  const compact = normalized.replace(/-/g, '');
  const direct = Z3_TIER_ALIASES.get(normalized) || Z3_TIER_ALIASES.get(compact);
  if (direct) return direct;

  for (const tierSlug of Z3_LEARNING_TIER_ORDER) {
    if (normalized.startsWith(`${tierSlug}-`)) {
      return tierSlug;
    }
  }

  return '';
};

export const getZ3TierRank = (tierSlug) => {
  const normalized = normalizeZ3TierSlug(tierSlug);
  const index = Z3_LEARNING_TIER_ORDER.indexOf(normalized);
  return index === -1 ? 0 : index + 1;
};

export const canAccessZ3Tier = ({ userTierSlug, requiredTierSlug }) => {
  const requiredRank = getZ3TierRank(requiredTierSlug);
  if (requiredRank === 0) return false;

  return getZ3TierRank(userTierSlug) >= requiredRank;
};

export const getZ3TierFeatureAccess = ({ userTierSlug, hasAccess = false } = {}) => {
  const normalizedTierSlug = normalizeZ3TierSlug(userTierSlug);
  const content = Boolean(hasAccess && getZ3TierRank(normalizedTierSlug) > 0);
  const learningPlan = Boolean(content && canAccessZ3Tier({
    userTierSlug: normalizedTierSlug,
    requiredTierSlug: Z3_LEARNING_TIERS.STRUKTUR,
  }));
  const examTrainer = Boolean(content && canAccessZ3Tier({
    userTierSlug: normalizedTierSlug,
    requiredTierSlug: Z3_LEARNING_TIERS.PRUEFUNGSTRAINER,
  }));

  return {
    content,
    learningContent: content,
    learningPlan,
    dailyWeeklyTasks: learningPlan,
    progress: learningPlan,
    examTrainer,
    questionPool: examTrainer,
    trainingMode: examTrainer,
    examMode: examTrainer,
    analysis: examTrainer,
  };
};

export const isLearningTierCheckoutEnabled = (tierSlug) => {
  const normalized = normalizeZ3TierSlug(tierSlug);
  if (!normalized) return true;

  return !DISABLED_Z3_CHECKOUT_TIERS.includes(normalized);
};

const pushUnique = (target, value, transform = (item) => String(item || '').trim()) => {
  const normalized = transform(value);
  if (normalized && !target.includes(normalized)) {
    target.push(normalized);
  }
};

const getRecordId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.id || '').trim();
};

const addMetadataCandidates = (metadata, candidates) => {
  if (!metadata || typeof metadata !== 'object') return;

  [
    metadata.user_id,
    metadata.userId,
    metadata.learning_user_id,
    metadata.learningUserId,
  ].forEach((value) => pushUnique(candidates.userIds, value));

  [
    metadata.package_id,
    metadata.packageId,
    metadata.learning_package_id,
    metadata.learningPackageId,
  ].forEach((value) => pushUnique(candidates.packageIds, value));

  [
    metadata.package_slug,
    metadata.packageSlug,
    metadata.learning_package_slug,
    metadata.learningPackageSlug,
    metadata.learning_tier,
    metadata.learningTier,
    metadata.z3_tier,
    metadata.z3Tier,
    metadata.tier,
    metadata.plan,
  ].forEach((value) => pushUnique(candidates.slugs, value, normalizeZ3TierSlug));

  [
    metadata.stripe_price_id,
    metadata.stripePriceId,
    metadata.price_id,
    metadata.priceId,
  ].forEach((value) => pushUnique(candidates.stripePriceIds, value));

  [
    metadata.stripe_product_id,
    metadata.stripeProductId,
    metadata.learning_product_id,
    metadata.learningProductId,
  ].forEach((value) => pushUnique(candidates.stripeProductIds, value));
};

const addPriceCandidates = (price, candidates) => {
  if (!price) return;

  const priceId = typeof price === 'string' ? price : String(price.id || '').trim();
  pushUnique(candidates.stripePriceIds, priceId);

  if (typeof price === 'object') {
    pushUnique(candidates.stripeProductIds, getRecordId(price.product));
    pushUnique(candidates.slugs, price.lookup_key, normalizeZ3TierSlug);
    addMetadataCandidates(price.metadata, candidates);

    if (price.product && typeof price.product === 'object') {
      addMetadataCandidates(price.product.metadata, candidates);
    }
  }
};

const addSubscriptionItemCandidates = (items, candidates) => {
  if (!Array.isArray(items)) return;

  for (const item of items) {
    addMetadataCandidates(item?.metadata, candidates);
    addPriceCandidates(item?.price || item?.plan, candidates);
  }
};

export const getLearningSubscriptionLookupCandidates = ({
  metadata = {},
  checkoutSession = null,
  stripeSubscription = null,
} = {}) => {
  const candidates = {
    userIds: [],
    packageIds: [],
    slugs: [],
    stripePriceIds: [],
    stripeProductIds: [],
  };

  addMetadataCandidates(metadata, candidates);
  addMetadataCandidates(checkoutSession?.metadata, candidates);
  addMetadataCandidates(stripeSubscription?.metadata, candidates);
  pushUnique(candidates.userIds, checkoutSession?.client_reference_id);

  addSubscriptionItemCandidates(stripeSubscription?.items?.data, candidates);
  addSubscriptionItemCandidates(checkoutSession?.line_items?.data, candidates);

  return candidates;
};

export const hasLearningSubscriptionLookupCandidates = (input = {}) => {
  const metadataType = String(input.metadata?.type || input.checkoutSession?.metadata?.type || input.stripeSubscription?.metadata?.type || '').trim();
  if (metadataType === 'learning_subscription') {
    return true;
  }

  const candidates = getLearningSubscriptionLookupCandidates(input);
  return candidates.packageIds.length > 0
    || candidates.slugs.length > 0
    || candidates.stripePriceIds.length > 0
    || candidates.stripeProductIds.length > 0;
};
