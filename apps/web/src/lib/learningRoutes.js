const encodePathPart = (value) => encodeURIComponent(String(value || '').trim());

export const getLearningCheckoutPath = (packageData, billingCycle = 'month', extraParams = {}) => {
  const packageSlug = typeof packageData === 'string' ? packageData : packageData?.slug;
  const normalizedBillingCycle = billingCycle === 'year' ? 'year' : 'month';

  if (!packageSlug) {
    return '/learning/packages';
  }

  const params = new URLSearchParams({
    cycle: normalizedBillingCycle,
    ...Object.fromEntries(
      Object.entries(extraParams).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    ),
  });

  return `/learning/subscribe/${encodePathPart(packageSlug)}?${params.toString()}`;
};

export const getLearningTopicPath = (packageData, moduleRecord) => {
  const packageSlug = typeof packageData === 'string' ? packageData : packageData?.slug;
  const topicSlug = moduleRecord?.slug;

  if (packageSlug && topicSlug) {
    return `/learning/topics/${encodePathPart(packageSlug)}/${encodePathPart(topicSlug)}`;
  }

  return moduleRecord?.id ? `/learning/modules/${encodePathPart(moduleRecord.id)}` : '/learning/dashboard';
};

export const getLearningSubtopicPath = (packageData, moduleRecord, lessonRecord) => {
  const packageSlug = typeof packageData === 'string' ? packageData : packageData?.slug;
  const topicSlug = moduleRecord?.slug || lessonRecord?.moduleSlug;
  const subtopicSlug = lessonRecord?.slug;

  if (packageSlug && topicSlug && subtopicSlug) {
    return `/learning/topics/${encodePathPart(packageSlug)}/${encodePathPart(topicSlug)}/subtopics/${encodePathPart(subtopicSlug)}`;
  }

  return lessonRecord?.id ? `/learning/lessons/${encodePathPart(lessonRecord.id)}` : '/learning/dashboard';
};
