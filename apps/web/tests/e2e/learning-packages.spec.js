import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';

const createAuthToken = () => {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: now + 60 * 60, type: 'auth' })).toString('base64url');
  return `${header}.${payload}.signature`;
};

const userRecord = {
  id: 'learning_user',
  collectionId: '_pb_users_auth_',
  collectionName: 'users',
  email: 'learning@example.test',
  emailVisibility: true,
  verified: true,
  name: 'Learning User',
  is_seller: false,
  is_admin: false,
};

const packages = [
  {
    id: 'pkg_start',
    slug: 'z3-start',
    title: 'Z3 Start',
    priceAmount: 19,
    currency: 'EUR',
    billingInterval: 'month',
  },
  {
    id: 'pkg_struktur',
    slug: 'z3-struktur',
    title: 'Z3 Struktur',
    priceAmount: 39,
    currency: 'EUR',
    billingInterval: 'month',
  },
  {
    id: 'pkg_pruefung',
    slug: 'z3-pruefungstrainer',
    title: 'Z3 Prüfungstrainer',
    priceAmount: 59,
    currency: 'EUR',
    billingInterval: 'month',
    checkoutEnabled: false,
  },
];

const packageDetail = {
  ...packages[0],
  subtitle: 'Start package',
  description: 'A package detail page for checkout routing tests.',
  targetAudience: 'Students who want a focused start.',
  yearlyPriceAmount: 89,
  checkoutEnabled: true,
  moduleCount: 1,
  lessonCount: 1,
  billingOptions: [
    { id: 'month', interval: 'month', priceAmount: 19 },
    { id: 'year', interval: 'year', priceAmount: 89 },
  ],
  valuePoints: [],
  includedContent: [],
  faq: [],
  modules: [{
    id: 'module_start',
    slug: 'orientation',
    title: 'Orientation',
    description: 'A first module for layout checks.',
    isPreview: true,
    lessons: [{
      id: 'lesson_start',
      slug: 'start-here',
      title: 'Start here',
      estimatedMinutes: 12,
      isPreview: true,
    }],
  }],
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

const dashboardPayload = (overrides = {}) => ({
  hasAccess: false,
  subscription: null,
  package: null,
  modules: [],
  recentlyOpened: [],
  progress: { percent: 0 },
  availablePackages: [packageDetail],
  ...overrides,
});

test.describe('Z3 learning package selector', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('language', 'EN');
    });

    await page.route('**/hcgi/api/learning/packages/z3-pruefungstrainer', async (route) => {
      await route.fulfill({
        json: {
          ...packages[2],
          checkoutEnabled: false,
          billingOptions: [
            {
              id: 'month',
              interval: 'month',
              priceAmount: 59,
            },
            {
              id: 'year',
              interval: 'year',
              priceAmount: 299,
            },
          ],
          valuePoints: [],
          includedContent: [],
          faq: [],
          modules: [],
        },
      });
    });

    await page.route('**/hcgi/api/learning/packages', async (route) => {
      await route.fulfill({ json: { items: packages } });
    });
  });

  test('shows the three subscription packages and excludes removed trainer promises', async ({ page }) => {
    await page.goto('/learning/packages');

    await expect(page.getByRole('heading', { name: 'Choose your Z3 E-Learning package' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Z3 Start' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Z3 Struktur' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Z3 Prüfungstrainer' })).toBeVisible();
    await expect(page.getByText('Popular')).toBeVisible();

    await expect(page.getByText('Prioritized review topics')).toBeVisible();
    await expect(page.getByText('Deep-dive High-Yield learning pages')).toBeVisible();
    await expect(page.getByText('Multiple-choice questions for every topic')).toHaveCount(0);
    await expect(page.getByText('Answer explanations')).toHaveCount(0);
    await expect(page.getByText('Mistake analysis & weakness tracking')).toHaveCount(0);
    await expect(page.getByText('Exam simulation')).toHaveCount(0);

    await expect(page.getByRole('link', { name: 'Choose Z3 Start' })).toHaveAttribute('href', '/learning/subscribe/z3-start?cycle=month');
    await expect(page.getByRole('link', { name: 'Choose Z3 Struktur' })).toHaveAttribute('href', '/learning/subscribe/z3-struktur?cycle=month');
    await expect(page.getByRole('link', { name: 'Choose Prüfungstrainer' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Currently unavailable' })).toBeDisabled();
  });

  test('keeps the direct Prüfungstrainer checkout page visible but blocks checkout', async ({ page }) => {
    await page.goto('/learning/subscribe/z3-pruefungstrainer');

    await expect(page.getByRole('heading', { name: 'Z3 Prüfungstrainer' })).toBeVisible();
    await expect(page.getByText('This E-Learning package remains visible, but subscription checkout is currently disabled.')).toBeVisible();
    await expect(page.getByText('Payment status')).toHaveCount(0);
    await expect(page.getByText('Access active until')).toHaveCount(0);
    await expect(page.getByText(/access stays active until the paid period ends/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Currently unavailable' })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Register to subscribe' })).toHaveCount(0);
  });
  test('routes Start subscription to checkout with the selected billing interval', async ({ page }) => {
    await setupAuth(page);

    await page.route('**/hcgi/api/learning/packages/z3-start', async (route) => {
      await route.fulfill({ json: packageDetail });
    });

    await page.route('**/hcgi/api/learning/dashboard', async (route) => {
      await route.fulfill({
        json: {
          hasAccess: false,
          subscription: null,
          package: null,
          modules: [],
          recentlyOpened: [],
          progress: { percent: 0 },
          availablePackages: [packageDetail],
        },
      });
    });

    await page.goto('/learning/packages/z3-start');

    const purchaseCard = page.getByRole('complementary').first();
    await expect(purchaseCard.getByRole('link', { name: /^E-Learning$/ })).toHaveCount(0);
    await expect(purchaseCard.getByText(/Recurring billing|server-side|One subscription activates|multiple packages/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Curriculum preview' })).toHaveCount(1);

    const purchaseCardStyle = await purchaseCard.evaluate((element) => ({
      position: window.getComputedStyle(element).position,
      top: window.getComputedStyle(element).top,
      viewportWidth: window.innerWidth,
    }));

    if (purchaseCardStyle.viewportWidth >= 1024) {
      expect(purchaseCardStyle.position).toBe('sticky');
      expect(purchaseCardStyle.top).toBe('96px');

      await page.evaluate(() => window.scrollTo(0, 300));
      const stickyTop = await purchaseCard.evaluate((element) => Math.round(element.getBoundingClientRect().top));
      expect(stickyTop).toBeGreaterThanOrEqual(95);
      expect(stickyTop).toBeLessThanOrEqual(97);
      await page.evaluate(() => window.scrollTo(0, 0));
    } else {
      expect(purchaseCardStyle.position).not.toBe('fixed');
    }

    const curriculumLayout = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('h2'))
        .find((element) => element.textContent?.trim() === 'Curriculum preview');
      const purchaseCard = document.querySelector('aside.learning-card');
      const statCards = Array.from(document.querySelectorAll('.learning-inline-card'))
        .filter((element) => /Modules|Lessons|min/i.test(element.textContent || ''))
        .slice(0, 3);

      if (!heading || !purchaseCard || statCards.length < 3) {
        return null;
      }

      const statsBottom = Math.max(...statCards.map((element) => element.getBoundingClientRect().bottom));
      const headingTop = heading.getBoundingClientRect().top;
      const purchaseCardBottom = purchaseCard.getBoundingClientRect().bottom;
      return { headingTop, purchaseCardBottom, statsBottom, viewportWidth: window.innerWidth };
    });

    expect(curriculumLayout).not.toBeNull();
    expect(curriculumLayout.headingTop).toBeGreaterThan(curriculumLayout.statsBottom);
    if (curriculumLayout.viewportWidth < 1024) {
      expect(curriculumLayout.headingTop).toBeGreaterThan(curriculumLayout.purchaseCardBottom);
    }

    const startSubscriptionLinks = page.getByRole('link', { name: /Start subscription/ });
    await expect(startSubscriptionLinks.first()).toHaveAttribute('href', '/learning/subscribe/z3-start?cycle=month');

    await page.getByRole('button', { name: 'Yearly' }).click();
    await expect(startSubscriptionLinks.first()).toHaveAttribute('href', '/learning/subscribe/z3-start?cycle=year');

    await startSubscriptionLinks.first().click();

    await expect(page).toHaveURL(/\/learning\/subscribe\/z3-start\?cycle=year/);
    await expect(page.getByRole('heading', { name: 'Z3 Start' })).toBeVisible();
  });

  test('redirects active subscribers from E-Learning entry to unlocked content', async ({ page }) => {
    await setupAuth(page);

    await page.route('**/hcgi/api/learning/dashboard', async (route) => {
      await route.fulfill({
        json: dashboardPayload({
          hasAccess: true,
          subscription: {
            id: 'sub_active',
            packageId: 'pkg_start',
            status: 'active',
            hasAccess: true,
            priceAmount: 19,
            currency: 'EUR',
            billingInterval: 'month',
            currentPeriodEnd: '2026-07-01T00:00:00.000Z',
          },
          package: packageDetail,
        }),
      });
    });

    await page.goto('/learning');

    await expect(page).toHaveURL(/\/learning\/dashboard/);
  });

  test('keeps logged-in users without active subscription on the E-Learning sales page', async ({ page }) => {
    await setupAuth(page);

    await page.route('**/hcgi/api/learning/dashboard', async (route) => {
      await route.fulfill({ json: dashboardPayload() });
    });

    await page.goto('/learning');

    await expect(page).toHaveURL(/\/learning$/);
    await expect(page.getByRole('link', { name: /Start subscription/ }).first()).toBeVisible();
  });
});
