import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canAccessZ3Tier,
  getLearningSubscriptionLookupCandidates,
  getZ3TierFeatureAccess,
  getZ3TierRank,
  hasLearningSubscriptionLookupCandidates,
  isLearningTierCheckoutEnabled,
  normalizeZ3TierSlug,
  Z3_LEARNING_TIERS,
} from '../src/utils/learningTierMapping.js';

test('normalizes Z3 tier aliases from slugs and metadata labels', () => {
  assert.equal(normalizeZ3TierSlug('z3-start'), Z3_LEARNING_TIERS.START);
  assert.equal(normalizeZ3TierSlug('Z3 Struktur'), Z3_LEARNING_TIERS.STRUKTUR);
  assert.equal(normalizeZ3TierSlug('z3_prufungstrainer_year'), Z3_LEARNING_TIERS.PRUEFUNGSTRAINER);
  assert.equal(normalizeZ3TierSlug('zahni-masterclass'), '');
});

test('orders Z3 tiers from start to pruefungstrainer', () => {
  assert.equal(getZ3TierRank('z3-start'), 1);
  assert.equal(getZ3TierRank('z3-struktur'), 2);
  assert.equal(getZ3TierRank('z3-pruefungstrainer'), 3);
  assert.equal(getZ3TierRank('unknown'), 0);
});

test('allows higher Z3 tiers to access lower-tier learning content only', () => {
  assert.equal(canAccessZ3Tier({
    userTierSlug: 'z3-struktur',
    requiredTierSlug: 'z3-start',
  }), true);
  assert.equal(canAccessZ3Tier({
    userTierSlug: 'z3-start',
    requiredTierSlug: 'z3-struktur',
  }), false);
  assert.equal(canAccessZ3Tier({
    userTierSlug: 'z3-pruefungstrainer',
    requiredTierSlug: 'z3-struktur',
  }), true);
  assert.equal(canAccessZ3Tier({
    userTierSlug: 'unknown',
    requiredTierSlug: 'z3-start',
  }), false);
});

test('maps Z3 tiers to the intended learning feature access', () => {
  assert.deepEqual(getZ3TierFeatureAccess({
    userTierSlug: 'z3-start',
    hasAccess: true,
  }), {
    content: true,
    learningContent: true,
    learningPlan: false,
    dailyWeeklyTasks: false,
    progress: false,
    examTrainer: false,
    questionPool: false,
    trainingMode: false,
    examMode: false,
    analysis: false,
  });

  assert.deepEqual(getZ3TierFeatureAccess({
    userTierSlug: 'z3-struktur',
    hasAccess: true,
  }), {
    content: true,
    learningContent: true,
    learningPlan: true,
    dailyWeeklyTasks: true,
    progress: true,
    examTrainer: false,
    questionPool: false,
    trainingMode: false,
    examMode: false,
    analysis: false,
  });

  assert.deepEqual(getZ3TierFeatureAccess({
    userTierSlug: 'z3-pruefungstrainer',
    hasAccess: true,
  }), {
    content: true,
    learningContent: true,
    learningPlan: true,
    dailyWeeklyTasks: true,
    progress: true,
    examTrainer: true,
    questionPool: true,
    trainingMode: true,
    examMode: true,
    analysis: true,
  });

  assert.equal(getZ3TierFeatureAccess({
    userTierSlug: 'z3-pruefungstrainer',
    hasAccess: false,
  }).content, false);
});

test('keeps all Z3 tiers enabled for checkout', () => {
  assert.equal(isLearningTierCheckoutEnabled('z3-start'), true);
  assert.equal(isLearningTierCheckoutEnabled('z3-struktur'), true);
  assert.equal(isLearningTierCheckoutEnabled('z3-pruefungstrainer'), true);
  assert.equal(isLearningTierCheckoutEnabled('zahni-masterclass'), true);
});

test('collects package lookup candidates from checkout metadata and subscription prices', () => {
  const candidates = getLearningSubscriptionLookupCandidates({
    metadata: {
      user_id: 'user_metadata',
      package_slug: 'z3-start',
      stripe_price_id: 'price_meta',
    },
    checkoutSession: {
      client_reference_id: 'user_checkout',
      metadata: {
        package_id: 'pkg_checkout',
        z3_tier: 'z3-struktur',
      },
    },
    stripeSubscription: {
      metadata: {
        learning_tier: 'z3-pruefungstrainer',
      },
      items: {
        data: [
          {
            price: {
              id: 'price_sub',
              lookup_key: 'z3-pruefungstrainer-month',
              product: {
                id: 'prod_sub',
                metadata: {
                  package_id: 'pkg_product',
                  package_slug: 'z3-pruefungstrainer',
                },
              },
            },
          },
        ],
      },
    },
  });

  assert.deepEqual(candidates.userIds, ['user_metadata', 'user_checkout']);
  assert.deepEqual(candidates.packageIds, ['pkg_checkout', 'pkg_product']);
  assert.deepEqual(candidates.slugs, [
    Z3_LEARNING_TIERS.START,
    Z3_LEARNING_TIERS.STRUKTUR,
    Z3_LEARNING_TIERS.PRUEFUNGSTRAINER,
  ]);
  assert.deepEqual(candidates.stripePriceIds, ['price_meta', 'price_sub']);
  assert.deepEqual(candidates.stripeProductIds, ['prod_sub']);
});

test('detects learning subscription events from metadata or Stripe price lookup data', () => {
  assert.equal(hasLearningSubscriptionLookupCandidates({
    metadata: { type: 'learning_subscription' },
  }), true);
  assert.equal(hasLearningSubscriptionLookupCandidates({
    stripeSubscription: {
      items: {
        data: [{ price: { lookup_key: 'z3-start-month' } }],
      },
    },
  }), true);
  assert.equal(hasLearningSubscriptionLookupCandidates({
    metadata: { type: 'marketplace_order' },
  }), false);
});
