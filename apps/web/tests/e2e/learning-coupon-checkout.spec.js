import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';

const createAuthToken = () => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: now + 60 * 60, type: 'auth' })).toString('base64url');
  return `${header}.${payload}.signature`;
};

const userRecord = {
  id: 'coupon_user',
  collectionId: '_pb_users_auth_',
  collectionName: 'users',
  email: 'coupon@example.test',
  emailVisibility: true,
  verified: true,
  name: 'Coupon User',
  is_seller: false,
  is_admin: false,
};

const packagePayload = {
  id: 'pkg_start',
  slug: 'z3-start',
  title: 'Z3 Start',
  subtitle: 'Start package',
  description: 'A package for coupon checkout tests.',
  priceAmount: 19,
  yearlyPriceAmount: 89,
  currency: 'EUR',
  billingInterval: 'month',
  checkoutEnabled: true,
  couponsEnabled: false,
  billingOptions: [
    { id: 'month', interval: 'month', priceAmount: 19 },
    { id: 'year', interval: 'year', priceAmount: 89 },
  ],
  valuePoints: [],
  includedContent: [],
  faq: [],
  modules: [],
};

const setupAuth = async (page) => {
  await page.addInitScript(({ authRecord, authToken }) => {
    window.localStorage.setItem('language', 'EN');
    window.localStorage.setItem('pocketbase_auth', JSON.stringify({
      token: authToken,
      record: authRecord,
    }));
  }, { authRecord: userRecord, authToken: createAuthToken() });
};

test.describe('learning free coupon checkout', () => {
  test('applies a free subscription coupon without collecting payment details', async ({ page }) => {
    await setupAuth(page);

    let freeSubscriptionActivated = false;
    const validationRequests = [];
    const checkoutRequests = [];

    await page.route('**/hcgi/api/learning/packages/z3-start', async (route) => {
      await route.fulfill({ json: packagePayload });
    });

    await page.route('**/hcgi/api/learning/dashboard', async (route) => {
      await route.fulfill({
        json: freeSubscriptionActivated
          ? {
            hasAccess: true,
            subscription: {
              id: 'sub_free',
              packageId: 'pkg_start',
              status: 'active',
              priceAmount: 0,
              currency: 'EUR',
              billingInterval: 'month',
              currentPeriodStart: '2026-06-05T00:00:00.000Z',
              currentPeriodEnd: '2026-07-05T00:00:00.000Z',
              accessEndsAt: '2026-07-05T00:00:00.000Z',
              effectiveAccessEndsAt: '2026-07-05T00:00:00.000Z',
              hasAccess: true,
            },
            package: packagePayload,
            modules: [],
            recentlyOpened: [],
            progress: { percent: 0 },
            availablePackages: [packagePayload],
          }
          : {
            hasAccess: false,
            subscription: null,
            package: null,
            modules: [],
            recentlyOpened: [],
            progress: { percent: 0 },
            availablePackages: [packagePayload],
          },
      });
    });

    await page.route('**/hcgi/api/learning/coupons/validate', async (route) => {
      validationRequests.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          success: true,
          coupon: {
            id: 'coupon_free',
            code: 'FREE100',
            discountType: 'percent',
            percentOff: 100,
          },
          billingCycle: 'month',
          currency: 'EUR',
          originalAmount: 19,
          discountAmount: 19,
          finalAmount: 0,
          isFree: true,
        },
      });
    });

    await page.route('**/hcgi/api/learning/checkout', async (route) => {
      checkoutRequests.push(route.request().postDataJSON());
      freeSubscriptionActivated = true;
      await route.fulfill({
        json: {
          success: true,
          freeSubscription: true,
          finalAmount: 0,
          subscription: {
            id: 'sub_free',
            packageId: 'pkg_start',
            status: 'active',
            priceAmount: 0,
            currency: 'EUR',
            billingInterval: 'month',
            hasAccess: true,
          },
        },
      });
    });

    await page.goto('/learning/subscribe/z3-start');

    const applyButton = page.getByRole('button', { name: 'Apply' });
    await expect(page.getByText('Coupon code')).toBeVisible();
    await expect(applyButton).toBeDisabled();

    await page.getByPlaceholder('Enter code').fill('FREE100');
    await expect(applyButton).toBeEnabled();
    await applyButton.click();

    const checkoutSummary = page.getByRole('complementary');
    await expect(checkoutSummary.getByText('Coupon code applied. The price is now 0.00.')).toBeVisible();
    await expect(checkoutSummary.getByText('No payment details are required for this coupon code.')).toBeVisible();
    await expect(page.getByText('€0.00').first()).toBeVisible();

    await checkoutSummary.getByLabel(/I accept the Terms/).check();
    await checkoutSummary.getByLabel(/I accept the Privacy Policy/).check();
    await page.getByRole('button', { name: /Complete free subscription/ }).click();

    await expect(page).toHaveURL(/\/learning\/dashboard\?payment=free-coupon/);
    await expect(page.getByRole('main').getByText('Your free subscription is active. You can start right away.')).toBeVisible();
    expect(validationRequests).toEqual([{
      packageSlug: 'z3-start',
      billingCycle: 'month',
      couponCode: 'FREE100',
    }]);
    expect(checkoutRequests).toEqual([{
      packageSlug: 'z3-start',
      billingCycle: 'month',
      couponCode: 'FREE100',
      acceptedTerms: true,
      acceptedPrivacy: true,
      newsletterOptIn: false,
    }]);
  });
});
