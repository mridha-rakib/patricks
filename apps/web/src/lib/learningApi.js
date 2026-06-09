import apiServerClient from '@/lib/apiServerClient.js';

const API_PROXY_URL = '/hcgi/api';
const API_DIRECT_URL = import.meta.env.VITE_API_SERVER_URL || 'http://127.0.0.1:3001';

const getLearningAssetUrl = (relativeUrl) => {
  const normalized = String(relativeUrl || '').trim();
  if (!normalized) {
    return '';
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return `${API_DIRECT_URL}${normalized}`;
  }

  return `${API_PROXY_URL}${normalized}`;
};

const withJson = async (response) => {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMessage = typeof data.error === 'string'
      ? data.error
      : data.error?.message || data.message || 'Learning API request failed';
    const error = new Error(errorMessage);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
};

const findModuleInPackage = (packageDetail, topicSlug) => (
  Array.isArray(packageDetail?.modules)
    ? packageDetail.modules.find((moduleRecord) => moduleRecord?.slug === topicSlug)
    : null
);

const findLessonInModule = (moduleRecord, subtopicSlug) => (
  Array.isArray(moduleRecord?.lessons)
    ? moduleRecord.lessons.find((lessonRecord) => lessonRecord?.slug === subtopicSlug)
    : null
);

const createLearningNotFoundError = (message) => {
  const error = new Error(message);
  error.status = 404;
  return error;
};

export const listLearningPackages = async () => {
  const response = await apiServerClient.fetch('/learning/packages');
  return withJson(response);
};

export const getLearningPackage = async (slug) => {
  const response = await apiServerClient.fetch(`/learning/packages/${encodeURIComponent(slug)}`);
  return withJson(response);
};

export const getLearningDashboard = async (token) => {
  const response = await apiServerClient.fetch('/learning/dashboard', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const searchLearningContent = async ({ token, query, limit = 12 }) => {
  const params = new URLSearchParams({
    query,
    limit: String(limit),
  });

  const response = await apiServerClient.fetch(`/learning/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const getLearningPlan = async ({ token }) => {
  const response = await apiServerClient.fetch('/learning/plan', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const recalculateLearningPlan = async ({ token }) => {
  const response = await apiServerClient.fetch('/learning/plan/recalculate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });

  return withJson(response);
};

export const createLearningCheckout = async ({ token, packageSlug, billingCycle = 'month', couponCode = '' }) => {
  const response = await apiServerClient.fetch('/learning/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ packageSlug, billingCycle, couponCode }),
  });

  return withJson(response);
};

export const validateLearningCoupon = async ({ token, packageSlug, billingCycle = 'month', couponCode = '' }) => {
  const response = await apiServerClient.fetch('/learning/coupons/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ packageSlug, billingCycle, couponCode }),
  });

  return withJson(response);
};

export const createLearningBillingPortal = async ({ token, action = '' }) => {
  const response = await apiServerClient.fetch('/learning/billing-portal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action }),
  });

  return withJson(response);
};

export const getLearningSubscriptionDetails = async ({ token }) => {
  const response = await apiServerClient.fetch('/learning/subscription-details', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const getLearningModule = async ({ token, moduleId }) => {
  const response = await apiServerClient.fetch(`/learning/modules/${encodeURIComponent(moduleId)}`, {
    headers: token ? {
      Authorization: `Bearer ${token}`,
    } : undefined,
  });

  return withJson(response);
};

export const getLearningModuleBySlug = async ({ token, packageSlug, topicSlug }) => {
  const packageDetail = await getLearningPackage(packageSlug);
  const moduleRecord = findModuleInPackage(packageDetail, topicSlug);
  if (!moduleRecord?.id) {
    throw createLearningNotFoundError('Learning topic not found');
  }

  return getLearningModule({ token, moduleId: moduleRecord.id });
};

export const getLearningLesson = async ({ token, lessonId }) => {
  const response = await apiServerClient.fetch(`/learning/lessons/${encodeURIComponent(lessonId)}`, {
    headers: token ? {
      Authorization: `Bearer ${token}`,
    } : undefined,
  });

  return withJson(response);
};

export const getLearningLessonBySlug = async ({
  token,
  packageSlug,
  topicSlug,
  subtopicSlug,
}) => {
  const packageDetail = await getLearningPackage(packageSlug);
  const moduleRecord = findModuleInPackage(packageDetail, topicSlug);
  const lessonRecord = findLessonInModule(moduleRecord, subtopicSlug);
  if (!lessonRecord?.id) {
    throw createLearningNotFoundError('Learning lesson not found');
  }

  return getLearningLesson({ token, lessonId: lessonRecord.id });
};

export const updateLearningLessonProgress = async ({ token, lessonId, status, progressPercentage }) => {
  const response = await apiServerClient.fetch(`/learning/lessons/${encodeURIComponent(lessonId)}/progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ status, progressPercentage }),
  });

  return withJson(response);
};

export const getLearningAdminContent = async ({ token }) => {
  const response = await apiServerClient.fetch('/learning/admin/content', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const createLearningAdminPackage = async ({ token, payload }) => {
  const response = await apiServerClient.fetch('/learning/admin/packages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export const updateLearningAdminPackage = async ({ token, id, payload }) => {
  const response = await apiServerClient.fetch(`/learning/admin/packages/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export const deleteLearningAdminPackage = async ({ token, id }) => {
  const response = await apiServerClient.fetch(`/learning/admin/packages/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const createLearningAdminModule = async ({ token, payload }) => {
  const response = await apiServerClient.fetch('/learning/admin/modules', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export const updateLearningAdminModule = async ({ token, id, payload }) => {
  const response = await apiServerClient.fetch(`/learning/admin/modules/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export const deleteLearningAdminModule = async ({ token, id }) => {
  const response = await apiServerClient.fetch(`/learning/admin/modules/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const createLearningAdminLesson = async ({ token, payload }) => {
  const response = await apiServerClient.fetch('/learning/admin/lessons', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export const updateLearningAdminLesson = async ({ token, id, payload }) => {
  const response = await apiServerClient.fetch(`/learning/admin/lessons/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export const deleteLearningAdminLesson = async ({ token, id }) => {
  const response = await apiServerClient.fetch(`/learning/admin/lessons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const duplicateLearningAdminLesson = async ({ token, id }) => {
  const response = await apiServerClient.fetch(`/learning/admin/lessons/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const uploadLearningAdminMedia = async ({ token, file, mediaType, label = '' }) => {
  const params = new URLSearchParams({
    label: label || file?.name || 'learning-media',
    mediaType,
    fileName: file?.name || 'learning-media',
  });

  const response = await apiServerClient.fetch(`/learning/admin/media?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file?.type || 'application/octet-stream',
    },
    body: file,
  });

  return withJson(response);
};

export const createLearningAdminCoupon = async ({ token, payload }) => {
  const response = await apiServerClient.fetch('/learning/admin/coupons', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export const updateLearningAdminCoupon = async ({ token, id, payload }) => {
  const response = await apiServerClient.fetch(`/learning/admin/coupons/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export const deleteLearningAdminCoupon = async ({ token, id }) => {
  const response = await apiServerClient.fetch(`/learning/admin/coupons/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const grantLearningAdminSubscriberAccess = async ({ token, payload }) => {
  const response = await apiServerClient.fetch('/learning/admin/subscribers/grant', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export const revokeLearningAdminSubscriberAccess = async ({ token, id }) => {
  const response = await apiServerClient.fetch(`/learning/admin/subscribers/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  return withJson(response);
};

export const updateLearningAdminSubscriberStatus = async ({ token, id, payload }) => {
  const response = await apiServerClient.fetch(`/learning/admin/subscribers/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  return withJson(response);
};

export { getLearningAssetUrl };
