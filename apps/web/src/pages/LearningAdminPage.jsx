import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  BookOpen,
  Copy as CopyIcon,
  Eye,
  FileText,
  GripVertical,
  Layers3,
  PencilLine,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Ticket,
  Trash2,
  UploadCloud,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { Input } from '@/components/ui/input.jsx';
import LearningRichContentEditor from '@/components/LearningRichContentEditor.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import {
  createLearningAdminLesson,
  createLearningAdminModule,
  createLearningAdminPackage,
  createLearningAdminCoupon,
  deleteLearningAdminLesson,
  deleteLearningAdminModule,
  deleteLearningAdminPackage,
  duplicateLearningAdminLesson,
  getLearningAdminContent,
  grantLearningAdminSubscriberAccess,
  revokeLearningAdminSubscriberAccess,
  updateLearningAdminCoupon,
  updateLearningAdminSubscriberStatus,
  updateLearningAdminLesson,
  updateLearningAdminModule,
  updateLearningAdminPackage,
  uploadLearningAdminMedia,
} from '@/lib/learningApi.js';
import {
  getSubscriptionBadgeToneClass,
  getSubscriptionDisplayEndDate,
  getSubscriptionStatusLabel,
} from '@/lib/subscriptionStatus.js';
import { getLearningRichPlainText, textContentToRichBlocks } from '@/lib/learningRichContent.js';
import pb from '@/lib/pocketbaseClient.js';
import { useTranslation } from '@/contexts/TranslationContext.jsx';

const emptyPackageForm = {
  id: '',
  slug: '',
  title: '',
  subtitle: '',
  description: '',
  heroCopy: '',
  targetAudience: '',
  heroImageUrl: '',
  thumbnailUrl: '',
  bundleKey: '',
  promoBadge: '',
  promoText: '',
  couponsEnabled: false,
  pricingCopy: '',
  ctaText: '',
  seoTitle: '',
  seoDescription: '',
  ogTitle: '',
  ogDescription: '',
  ogImageUrl: '',
  priceAmount: '39',
  yearlyPriceAmount: '390',
  currency: 'EUR',
  billingInterval: 'month',
  billingIntervalCount: '1',
  stripeProductId: '',
  stripePriceId: '',
  yearlyStripePriceId: '',
  status: 'draft',
  sortOrder: '1',
  valuePointsText: '',
  includedContentText: '',
  faqText: '',
};

const emptyModuleForm = {
  id: '',
  packageId: '',
  slug: '',
  title: '',
  description: '',
  status: 'draft',
  position: '1',
  estimatedDurationMinutes: '0',
  isPreview: false,
  afterModuleId: '',
};

const emptyLessonForm = {
  id: '',
  packageId: '',
  moduleId: '',
  slug: '',
  title: '',
  description: '',
  status: 'draft',
  contentType: 'mixed',
  videoUrl: '',
  textContent: '',
  richContent: [],
  pdfUrl: '',
  downloadUrl: '',
  attachmentsText: '',
  estimatedMinutes: '12',
  position: '1',
  isPreview: false,
  hasUnpublishedChanges: false,
  afterLessonId: '',
};

const emptySubscriberForm = {
  userEmail: '',
  packageId: '',
  durationDays: '30',
};

const emptyCouponForm = {
  id: '',
  code: '',
  title: '',
  description: '',
  packageId: '',
  bundleKey: '',
  status: 'draft',
  discountType: 'percent',
  percentOff: '10',
  amountOff: '0',
  currency: 'EUR',
  duration: 'once',
  durationInMonths: '1',
  startsAt: '',
  expiresAt: '',
  maxRedemptions: '0',
  stripeCouponId: '',
  stripePromotionCodeId: '',
  promotionText: '',
};

const subscriptionStatuses = ['active', 'past_due', 'canceled', 'expired', 'unpaid', 'paused'];

const cleanAdminListLine = (line) =>
  String(line || '')
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^["']|["'],?$|,$/g, '')
    .trim();

const parseLooseJson = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const candidates = [
    raw,
    raw.startsWith('{') && !raw.endsWith('}') ? `{${raw}}` : '',
    raw.startsWith('{') ? `[${raw.replace(/,\s*$/, '')}]` : '',
    raw.includes('\n') ? `[${raw.replace(/,\s*$/, '')}]` : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying looser candidates before falling back to line parsing.
    }
  }

  return null;
};

const parseLineList = (value) => {
  const parsed = parseLooseJson(value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => {
        if (typeof item === 'string') return cleanAdminListLine(item);
        if (item && typeof item === 'object') {
          return cleanAdminListLine(item.label || item.title || item.text || item.value || item.question || '');
        }
        return cleanAdminListLine(item);
      })
      .filter(Boolean);
  }

  return String(value || '')
    .split('\n')
    .map((line) => cleanAdminListLine(line))
    .filter(Boolean);
};

const parseFaq = (value) => {
  const raw = String(value || '').trim();
  const parsed = parseLooseJson(value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const question = String(item.question || item.q || '').trim();
        const answer = String(item.answer || item.a || '').trim();
        return question && answer ? { question, answer } : null;
      })
      .filter(Boolean);
  }

  if (raw.includes('"question"') || raw.includes('"answer"')) {
    const questions = [...raw.matchAll(/"question"\s*:\s*"([^"]+)"/gi)].map((match) => match[1].trim());
    const answers = [...raw.matchAll(/"answer"\s*:\s*"([^"]+)"/gi)].map((match) => match[1].trim());
    const pairedFaq = questions
      .map((question, index) => ({ question, answer: answers[index] || '' }))
      .filter((item) => item.question && item.answer);

    if (pairedFaq.length > 0) {
      return pairedFaq;
    }
  }

  return raw
    .split('\n')
    .map((line) => cleanAdminListLine(line))
    .filter(Boolean)
    .map((line) => {
      const [questionPart, ...answerParts] = line.split('|');
      const question = String(questionPart || '').trim();
      const answer = answerParts.join('|').trim();
      return question && answer ? { question, answer } : null;
    })
    .filter(Boolean);
};

const parseAttachments = (value) =>
  parseLineList(value)
    .map((line) => {
      const [labelPart, urlPart] = line.split('|');
      const label = String(labelPart || '').trim();
      const url = String(urlPart || labelPart || '').trim();
      return url ? { label: label || url, url } : null;
    })
    .filter(Boolean);

const formatFaq = (faq) =>
  (Array.isArray(faq) ? faq : [])
    .map((item) => `${item.question || ''} | ${item.answer || ''}`.trim())
    .join('\n');

const formatAttachments = (attachments) =>
  (Array.isArray(attachments) ? attachments : [])
    .map((item) => `${item.label || ''} | ${item.url || ''}`.trim())
    .join('\n');

const hasEventPayloadValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasEventPayloadValue(item));
  if (typeof value === 'object') return Object.values(value).some((item) => hasEventPayloadValue(item));
  return true;
};

const isAdminVisibleEvent = (event) => {
  if (!event?.eventType) return false;
  if (event.source === 'admin_action') return true;
  if (!['cancellation_scheduled', 'cancellation_reversed'].includes(event.eventType)) return true;
  return hasEventPayloadValue(event.payload);
};

const formatCurrency = (amount, currency = 'EUR') => {
  try {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: currency || 'EUR',
      maximumFractionDigits: 2,
    }).format(Number(amount || 0));
  } catch {
    return `${Number(amount || 0).toFixed(2)} ${currency || 'EUR'}`;
  }
};

const getStatusBadgeClass = (status) => {
  if (status === 'published' || status === 'active' || status === 'paid') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'draft' || status === 'paused') {
    return 'border-slate-200 bg-slate-50 text-slate-600';
  }
  if (status === 'archived' || status === 'canceled' || status === 'expired' || status === 'void') {
    return 'border-zinc-200 bg-zinc-100 text-zinc-600';
  }
  if (status === 'past_due' || status === 'unpaid' || status === 'open') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-blue-200 bg-blue-50 text-blue-700';
};

const adminPackageFieldLabels = {
  title: 'Package title',
  slug: 'URL slug',
  shortDescription: 'Subtitle',
  price: 'Monthly price',
  interval: 'Billing interval',
  status: 'Status',
  heroCopy: 'Hero copy',
  usp: 'USPs / value points',
  pricingCopy: 'Pricing copy',
  faq: 'FAQ',
  cta: 'CTA text',
};

const formatAdminError = (error) => {
  const fields = Array.isArray(error?.data?.fields) ? error.data.fields : [];
  if (fields.length === 0) {
    return error.message || '';
  }

  const labels = fields.map((field) => adminPackageFieldLabels[field] || field);
  return `${error.message || 'Mandatory admin fields are missing'}: ${labels.join(', ')}`;
};

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const LearningAdminPage = () => {
  const { t } = useTranslation();
  const [content, setContent] = useState({ packages: [], modules: [], lessons: [], subscribers: [], events: [], invoices: [], coupons: [] });
  const [loading, setLoading] = useState(true);
  const [packageForm, setPackageForm] = useState(emptyPackageForm);
  const [moduleForm, setModuleForm] = useState(emptyModuleForm);
  const [lessonForm, setLessonForm] = useState(emptyLessonForm);
  const [subscriberForm, setSubscriberForm] = useState(emptySubscriberForm);
  const [couponForm, setCouponForm] = useState(emptyCouponForm);
  const [subscriberStatusFilter, setSubscriberStatusFilter] = useState('all');
  const [mediaUploading, setMediaUploading] = useState('');
  const [activeSection, setActiveSection] = useState('editor');
  const [builderPanel, setBuilderPanel] = useState('curriculum');
  const [curriculumEditorMode, setCurriculumEditorMode] = useState('lesson');
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [packageSearch, setPackageSearch] = useState('');
  const [draggedModuleId, setDraggedModuleId] = useState('');
  const [draggedLessonId, setDraggedLessonId] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const token = pb.authStore.token;
  const copy = useCallback((key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  }, [t]);

  const loadContent = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await getLearningAdminContent({ token });
      setContent({
        packages: Array.isArray(result.packages) ? result.packages : [],
        modules: Array.isArray(result.modules) ? result.modules : [],
        lessons: Array.isArray(result.lessons) ? result.lessons : [],
        subscribers: Array.isArray(result.subscribers) ? result.subscribers : [],
        events: Array.isArray(result.events) ? result.events : [],
        invoices: Array.isArray(result.invoices) ? result.invoices : [],
        coupons: Array.isArray(result.coupons) ? result.coupons : [],
      });
    } catch (error) {
      console.error('Failed to load learning admin content:', error);
      toast.error(error.message || t('learning.admin_load_error'));
    } finally {
      setLoading(false);
    }
  }, [t, token]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  useEffect(() => {
    if (selectedPackageId && content.packages.some((item) => item.id === selectedPackageId)) return;
    setSelectedPackageId(content.packages[0]?.id || '');
  }, [content.packages, selectedPackageId]);

  useEffect(() => {
    if (!selectedPackageId || lessonForm.id || lessonForm.moduleId) return;
    const firstModule = content.modules.find((item) => item.packageId === selectedPackageId);
    if (!firstModule) return;

    setLessonForm((current) => ({
      ...current,
      packageId: selectedPackageId,
      moduleId: firstModule.id,
      position: getNextLessonPosition(firstModule.id),
      afterLessonId: getLastLessonId(firstModule.id),
    }));
  }, [content.modules, lessonForm.id, lessonForm.moduleId, selectedPackageId]);

  const lessonPackageId = lessonForm.packageId || selectedPackageId;
  const modulesForSelectedPackage = useMemo(
    () => content.modules.filter((item) => item.packageId === lessonPackageId),
    [content.modules, lessonPackageId],
  );
  const visibleSubscriptionEvents = useMemo(
    () => content.events.filter(isAdminVisibleEvent),
    [content.events],
  );
  const subscriberStatusCounts = useMemo(
    () => content.subscribers.reduce((counts, item) => {
      const status = item.subscription?.status || 'unknown';
      return {
        ...counts,
        [status]: Number(counts[status] || 0) + 1,
      };
    }, {}),
    [content.subscribers],
  );
  const filteredSubscribers = useMemo(
    () => content.subscribers.filter((item) =>
      subscriberStatusFilter === 'all' || item.subscription?.status === subscriberStatusFilter),
    [content.subscribers, subscriberStatusFilter],
  );

  const packageSummaries = useMemo(() => {
    const query = packageSearch.trim().toLowerCase();

    return content.packages
      .map((learningPackage) => {
        const modules = content.modules.filter((item) => item.packageId === learningPackage.id);
        const lessons = content.lessons.filter((item) => item.packageId === learningPackage.id);
        const subscribers = content.subscribers.filter((item) => item.subscription?.packageId === learningPackage.id);
        const invoices = content.invoices.filter((item) => item.packageId === learningPackage.id);
        const coupons = content.coupons.filter((item) =>
          item.packageId === learningPackage.id
          || (item.bundleKey && item.bundleKey === learningPackage.bundleKey)
        );
        const events = visibleSubscriptionEvents.filter((item) => item.packageId === learningPackage.id);
        const activeSubscribers = subscribers.filter((item) => item.subscription?.hasAccess);
        const publishedModules = modules.filter((item) => item.status === 'published');
        const publishedLessons = lessons.filter((item) => item.status === 'published');
        const revenue = invoices.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);

        return {
          package: learningPackage,
          modules,
          lessons,
          subscribers,
          invoices,
          coupons,
          events,
          activeSubscribers,
          revenue,
          publishedModules,
          publishedLessons,
          previewLessons: lessons.filter((item) => item.isPreview),
          completionPercent: lessons.length > 0 ? Math.round((publishedLessons.length / lessons.length) * 100) : 0,
        };
      })
      .filter((item) => {
        if (!query) return true;
        return [
          item.package.title,
          item.package.slug,
          item.package.status,
          item.package.bundleKey,
        ].some((value) => String(value || '').toLowerCase().includes(query));
      });
  }, [content, packageSearch, visibleSubscriptionEvents]);

  const selectedPackageSummary = useMemo(
    () => packageSummaries.find((item) => item.package.id === selectedPackageId)
      || packageSummaries[0]
      || null,
    [packageSummaries, selectedPackageId],
  );

  const globalStats = useMemo(() => {
    const paidRevenue = content.invoices.reduce((sum, item) => sum + Number(item.amountPaid || 0), 0);
    const activeSubscribers = content.subscribers.filter((item) => item.subscription?.hasAccess);
    const publishedLessons = content.lessons.filter((item) => item.status === 'published');

    return [
      {
        label: copy('learning.admin_packages', 'Packages'),
        value: content.packages.length,
        detail: `${content.packages.filter((item) => item.status === 'published').length} ${copy('learning.admin_status_published', 'published')}`,
        icon: BookOpen,
      },
      {
        label: copy('learning.admin_lessons', 'Lessons'),
        value: content.lessons.length,
        detail: `${publishedLessons.length} ${copy('learning.admin_status_published', 'published')}`,
        icon: FileText,
      },
      {
        label: copy('learning.admin_subscribers', 'Subscribers'),
        value: activeSubscribers.length,
        detail: `${content.subscribers.length} ${copy('learning.admin_total_label', 'total')}`,
        icon: Users,
      },
      {
        label: copy('learning.admin_revenue', 'Revenue'),
        value: formatCurrency(paidRevenue, content.invoices[0]?.currency || 'EUR'),
        detail: `${content.invoices.length} ${copy('learning.admin_invoices', 'invoices').toLowerCase()}`,
        icon: BarChart3,
      },
    ];
  }, [content, copy]);

  const latestContentSummaries = useMemo(
    () => [...packageSummaries]
      .sort((left, right) => {
        const leftTime = new Date(left.events[0]?.created || 0).getTime();
        const rightTime = new Date(right.events[0]?.created || 0).getTime();
        return rightTime - leftTime;
      })
      .slice(0, 4),
    [packageSummaries],
  );

  const overviewAnalytics = useMemo(() => {
    const publishedPackages = content.packages.filter((item) => item.status === 'published').length;
    const draftPackages = content.packages.filter((item) => item.status === 'draft').length;
    const archivedPackages = content.packages.filter((item) => item.status === 'archived').length;
    const lessonsWithMedia = content.lessons.filter((item) => item.hasVideo || item.hasPdf || item.hasDownload || item.attachmentCount > 0).length;
    const previewLessons = content.lessons.filter((item) => item.isPreview).length;
    const paidInvoices = content.invoices.filter((item) => item.status === 'paid').length;

    return {
      publishedPackages,
      draftPackages,
      archivedPackages,
      lessonsWithMedia,
      previewLessons,
      paidInvoices,
    };
  }, [content]);

  const selectedModules = selectedPackageSummary?.modules || [];
  const selectedLessons = selectedPackageSummary?.lessons || [];
  const selectedSubscribers = selectedPackageSummary?.subscribers || [];
  const selectedInvoices = selectedPackageSummary?.invoices || [];
  const selectedCoupons = selectedPackageSummary?.coupons || [];
  const selectedEvents = selectedPackageSummary?.events || [];
  const selectedLessonModule = modulesForSelectedPackage.find((item) => item.id === lessonForm.moduleId) || null;

  const getPreviousItemId = (items, itemId) => {
    const index = items.findIndex((item) => item.id === itemId);
    return index > 0 ? items[index - 1].id : '';
  };

  const getLastModuleId = (packageId, excludedId = '') =>
    content.modules
      .filter((item) => item.packageId === packageId && item.id !== excludedId)
      .at(-1)?.id || '';

  const getLastLessonId = (moduleId, excludedId = '') =>
    content.lessons
      .filter((item) => item.moduleId === moduleId && item.id !== excludedId)
      .at(-1)?.id || '';

  const eventLabel = (eventType) => {
    const key = `learning.event_${eventType}`;
    const translated = t(key);
    return translated === key ? eventType : translated;
  };
  const eventDetails = (item) => {
    const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
    return [
      item.userName || item.userEmail,
      item.packageTitle,
      payload.title,
      payload.status,
      payload.billingInterval,
      payload.currentPeriodEnd,
      payload.amountPaid ? `${payload.amountPaid}` : '',
    ].filter((value, index, values) => value && values.indexOf(value) === index);
  };
  const statusLabel = (status) => getSubscriptionStatusLabel(t, status);

  const selectPackage = (packageId) => {
    const normalizedPackageId = packageId || '';
    setSelectedPackageId(normalizedPackageId);
    setSubscriberStatusFilter('all');
    setModuleForm((current) => (
      current.id
        ? current
        : { ...current, packageId: normalizedPackageId }
    ));
    setLessonForm((current) => {
      if (current.id) return current;

      const moduleStillBelongsToPackage = content.modules.some((item) =>
        item.packageId === normalizedPackageId && item.id === current.moduleId);

      return {
        ...current,
        packageId: normalizedPackageId,
        moduleId: moduleStillBelongsToPackage ? current.moduleId : '',
      };
    });
  };

  const hydratePackageForm = (item) => {
    setPackageForm({
      id: item.id,
      slug: item.slug || '',
      title: item.title || '',
      subtitle: item.shortDescription || item.subtitle || '',
      description: item.longDescription || item.description || '',
      heroCopy: item.heroCopy || '',
      targetAudience: item.targetAudience || '',
      heroImageUrl: item.coverImageUrl || item.heroImageUrl || '',
      thumbnailUrl: item.thumbnailUrl || '',
      bundleKey: item.bundleKey || '',
      promoBadge: item.promoBadge || '',
      promoText: item.promoText || '',
      couponsEnabled: item.couponsEnabled === true,
      pricingCopy: item.pricingCopy || '',
      ctaText: item.ctaText || '',
      seoTitle: item.seoTitle || '',
      seoDescription: item.seoDescription || '',
      ogTitle: item.ogTitle || '',
      ogDescription: item.ogDescription || '',
      ogImageUrl: item.ogImageUrl || '',
      priceAmount: String(item.priceAmount ?? ''),
      yearlyPriceAmount: String(item.yearlyPriceAmount ?? ''),
      currency: item.currency || 'EUR',
      billingInterval: item.billingInterval || item.interval || 'month',
      billingIntervalCount: String(item.billingIntervalCount ?? 1),
      stripeProductId: item.stripeProductId || '',
      stripePriceId: item.stripePriceId || '',
      yearlyStripePriceId: item.yearlyStripePriceId || '',
      status: item.status || 'draft',
      sortOrder: String(item.sortOrder ?? 0),
      valuePointsText: (item.valuePoints || []).join('\n'),
      includedContentText: (item.includedContent || []).join('\n'),
      faqText: formatFaq(item.faq),
    });
    selectPackage(item.id);
    setBuilderPanel('package');
    setActiveSection('editor');
  };

  const hydrateModuleForm = (item) => {
    setModuleForm({
      id: item.id,
      packageId: item.packageId || '',
      slug: item.slug || '',
      title: item.title || '',
      description: item.shortText || item.description || '',
      status: item.publishState || item.status || 'draft',
      position: String(item.order ?? item.position ?? 0),
      estimatedDurationMinutes: String(item.estimatedDurationMinutes ?? 0),
      isPreview: item.isPreview === true,
      afterModuleId: getPreviousItemId(
        content.modules.filter((moduleItem) => moduleItem.packageId === item.packageId),
        item.id
      ),
    });
    selectPackage(item.packageId || selectedPackageId);
    setBuilderPanel('curriculum');
    setCurriculumEditorMode('module');
    setActiveSection('editor');
  };

  const hydrateLessonForm = (item) => {
    const draft = item.hasUnpublishedChanges && item.draft ? item.draft : null;
    setLessonForm({
      id: item.id,
      packageId: item.packageId || '',
      moduleId: item.moduleId || '',
      slug: item.slug || '',
      title: draft?.title || item.title || '',
      description: draft?.description || item.description || '',
      status: item.releaseState || item.status || 'draft',
      contentType: draft?.contentType || item.contentType || 'mixed',
      videoUrl: draft?.videoUrl || item.videoUrl || '',
      textContent: draft?.textContent || item.textContent || '',
      richContent: Array.isArray(draft?.richContent) && draft.richContent.length > 0
        ? draft.richContent
        : Array.isArray(item.richContent) && item.richContent.length > 0
          ? item.richContent
          : textContentToRichBlocks(item.textContent || ''),
      pdfUrl: draft?.pdfUrl || item.pdfUrl || '',
      downloadUrl: draft?.downloadUrl || item.downloadUrl || '',
      attachmentsText: formatAttachments(draft?.attachments || item.attachments),
      estimatedMinutes: String(item.estimatedMinutes ?? 0),
      position: String(item.order ?? item.position ?? 0),
      isPreview: item.isPreview === true,
      hasUnpublishedChanges: item.hasUnpublishedChanges === true,
      afterLessonId: getPreviousItemId(
        content.lessons.filter((lessonItem) => lessonItem.moduleId === item.moduleId),
        item.id
      ),
    });
    selectPackage(item.packageId || selectedPackageId);
    setBuilderPanel('curriculum');
    setCurriculumEditorMode('lesson');
    setActiveSection('editor');
  };

  const hydrateCouponForm = (item) => {
    setCouponForm({
      id: item.id,
      code: item.code || '',
      title: item.title || '',
      description: item.description || '',
      packageId: item.packageId || '',
      bundleKey: item.bundleKey || '',
      status: item.status || 'draft',
      discountType: item.discountType || 'percent',
      percentOff: String(item.percentOff ?? 0),
      amountOff: String(item.amountOff ?? 0),
      currency: item.currency || 'EUR',
      duration: item.duration || 'once',
      durationInMonths: String(item.durationInMonths ?? 0),
      startsAt: item.startsAt || '',
      expiresAt: item.expiresAt || '',
      maxRedemptions: String(item.maxRedemptions ?? 0),
      stripeCouponId: item.stripeCouponId || '',
      stripePromotionCodeId: item.stripePromotionCodeId || '',
      promotionText: item.promotionText || '',
    });
    if (item.packageId) selectPackage(item.packageId);
    setActiveSection('billing');
  };

  const getPackageSlugForSubmit = () => {
    const baseSlug = slugify(packageForm.slug || packageForm.title) || `learning-package-${Date.now()}`;
    const existingSlugs = new Set(
      content.packages
        .filter((item) => item.id !== packageForm.id)
        .map((item) => item.slug)
        .filter(Boolean)
    );

    if (!existingSlugs.has(baseSlug)) return baseSlug;

    for (let attempt = 2; attempt <= 50; attempt += 1) {
      const candidate = `${baseSlug}-${attempt}`;
      if (!existingSlugs.has(candidate)) return candidate;
    }

    return `${baseSlug}-${Date.now()}`;
  };

  const getPackageSortOrderForSubmit = () => {
    if (packageForm.id && packageForm.sortOrder !== '') {
      return Number(packageForm.sortOrder || 0);
    }

    const maxSortOrder = content.packages.reduce((max, item) => {
      const sortOrder = Number(item.sortOrder ?? item.order ?? 0);
      return Number.isFinite(sortOrder) ? Math.max(max, sortOrder) : max;
    }, 0);

    return maxSortOrder + 1;
  };

  const getNextModulePosition = (packageId) => {
    const maxPosition = content.modules
      .filter((item) => item.packageId === packageId)
      .reduce((max, item) => {
        const position = Number(item.position ?? item.order ?? 0);
        return Number.isFinite(position) ? Math.max(max, position) : max;
      }, 0);

    return String(maxPosition + 1);
  };

  const getNextLessonPosition = (moduleId) => {
    const maxPosition = content.lessons
      .filter((item) => item.moduleId === moduleId)
      .reduce((max, item) => {
        const position = Number(item.position ?? item.order ?? 0);
        return Number.isFinite(position) ? Math.max(max, position) : max;
      }, 0);

    return String(maxPosition + 1);
  };

  const getUniqueSlug = ({ currentId, fallback, records }) => {
    const baseSlug = slugify(fallback) || `learning-item-${Date.now()}`;
    const existingSlugs = new Set(
      records
        .filter((item) => item.id !== currentId)
        .map((item) => item.slug)
        .filter(Boolean)
    );

    if (!existingSlugs.has(baseSlug)) return baseSlug;

    for (let attempt = 2; attempt <= 50; attempt += 1) {
      const candidate = `${baseSlug}-${attempt}`;
      if (!existingSlugs.has(candidate)) return candidate;
    }

    return `${baseSlug}-${Date.now()}`;
  };

  const placeItemAfter = (items, item, afterId) => {
    const remainingItems = items.filter((candidate) => candidate.id !== item.id);
    const insertIndex = afterId
      ? remainingItems.findIndex((candidate) => candidate.id === afterId) + 1
      : 0;
    const normalizedIndex = insertIndex > 0 ? insertIndex : 0;

    return [
      ...remainingItems.slice(0, normalizedIndex),
      item,
      ...remainingItems.slice(normalizedIndex),
    ];
  };

  const placeItemFromDrag = (items, draggedId, targetId, placement) => {
    if (!draggedId || !targetId || draggedId === targetId) return items;

    const draggedItem = items.find((item) => item.id === draggedId);
    if (!draggedItem) return items;

    const remainingItems = items.filter((item) => item.id !== draggedId);
    const targetIndex = remainingItems.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) return items;

    const insertIndex = placement === 'before' ? targetIndex : targetIndex + 1;
    return [
      ...remainingItems.slice(0, insertIndex),
      draggedItem,
      ...remainingItems.slice(insertIndex),
    ];
  };

  const getDropPlacement = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
  };

  const persistModuleOrder = async (orderedModules, { notify = true, reload = true } = {}) => {
    const updates = orderedModules.map((moduleRecord, index) =>
      updateLearningAdminModule({
        token,
        id: moduleRecord.id,
        payload: { position: index + 1 },
      }));

    await Promise.all(updates);

    setContent((current) => ({
      ...current,
      modules: current.modules.map((moduleRecord) => {
        const index = orderedModules.findIndex((item) => item.id === moduleRecord.id);
        return index === -1 ? moduleRecord : { ...moduleRecord, position: index + 1, order: index + 1 };
      }),
    }));

    if (notify) toast.success(copy('learning.admin_order_saved', 'Order saved'));
    if (reload) await loadContent();
  };

  const persistLessonOrder = async (orderedLessons, { notify = true, reload = true } = {}) => {
    const updates = orderedLessons.map((lessonRecord, index) =>
      updateLearningAdminLesson({
        token,
        id: lessonRecord.id,
        payload: { position: index + 1 },
      }));

    await Promise.all(updates);

    setContent((current) => ({
      ...current,
      lessons: current.lessons.map((lessonRecord) => {
        const index = orderedLessons.findIndex((item) => item.id === lessonRecord.id);
        return index === -1 ? lessonRecord : { ...lessonRecord, position: index + 1, order: index + 1 };
      }),
    }));

    if (notify) toast.success(copy('learning.admin_order_saved', 'Order saved'));
    if (reload) await loadContent();
  };

  const reorderModulesByDrag = async (event, targetModuleId) => {
    event.preventDefault();
    const placement = getDropPlacement(event);
    const orderedModules = placeItemFromDrag(selectedModules, draggedModuleId, targetModuleId, placement);
    setDraggedModuleId('');

    if (orderedModules === selectedModules) return;

    try {
      await persistModuleOrder(orderedModules);
    } catch (error) {
      console.error('Failed to reorder learning modules:', error);
      toast.error(error.message || t('learning.admin_save_error'));
      await loadContent();
    }
  };

  const reorderLessonsByDrag = async (event, targetLessonId, moduleId) => {
    event.preventDefault();
    const moduleLessons = selectedLessons.filter((lesson) => lesson.moduleId === moduleId);
    const placement = getDropPlacement(event);
    const orderedLessons = placeItemFromDrag(moduleLessons, draggedLessonId, targetLessonId, placement);
    setDraggedLessonId('');

    if (orderedLessons === moduleLessons) return;

    try {
      await persistLessonOrder(orderedLessons);
    } catch (error) {
      console.error('Failed to reorder learning lessons:', error);
      toast.error(error.message || t('learning.admin_save_error'));
      await loadContent();
    }
  };

  const submitPackage = async (event) => {
    event.preventDefault();

    try {
      const editablePackageForm = { ...packageForm };
      delete editablePackageForm.stripeProductId;
      delete editablePackageForm.stripePriceId;
      delete editablePackageForm.yearlyStripePriceId;
      const payload = {
        ...editablePackageForm,
        slug: getPackageSlugForSubmit(),
        bundleKey: packageForm.bundleKey || '',
        couponsEnabled: packageForm.couponsEnabled === true,
        billingIntervalCount: Number(packageForm.billingIntervalCount || 1) || 1,
        seoTitle: packageForm.seoTitle || packageForm.title,
        seoDescription: packageForm.seoDescription || packageForm.subtitle || packageForm.description,
        ogTitle: packageForm.ogTitle || packageForm.title,
        ogDescription: packageForm.ogDescription || packageForm.subtitle || packageForm.description,
        ogImageUrl: packageForm.ogImageUrl || packageForm.heroImageUrl || packageForm.thumbnailUrl,
        priceAmount: Number(packageForm.priceAmount || 0),
        yearlyPriceAmount: Number(packageForm.yearlyPriceAmount || 0),
        sortOrder: getPackageSortOrderForSubmit(),
        valuePoints: parseLineList(packageForm.valuePointsText),
        includedContent: parseLineList(packageForm.includedContentText),
        faq: parseFaq(packageForm.faqText),
      };

      if (packageForm.id) {
        await updateLearningAdminPackage({ token, id: packageForm.id, payload });
        setSelectedPackageId(packageForm.id);
      } else {
        const created = await createLearningAdminPackage({ token, payload });
        setSelectedPackageId(created.id || '');
        setModuleForm({ ...emptyModuleForm, packageId: created.id || '' });
        setLessonForm({ ...emptyLessonForm, packageId: created.id || '' });
        setBuilderPanel('curriculum');
        setCurriculumEditorMode('module');
      }

      toast.success(t('learning.admin_save_success'));
      setPackageForm(emptyPackageForm);
      await loadContent();
    } catch (error) {
      console.error('Failed to save learning package:', error);
      toast.error(formatAdminError(error) || t('learning.admin_save_error'));
    }
  };

  const submitModule = async (event) => {
    event.preventDefault();

    try {
      const packageId = moduleForm.packageId || selectedPackageId;
      const payload = {
        ...moduleForm,
        slug: getUniqueSlug({
          currentId: moduleForm.id,
          fallback: moduleForm.slug || moduleForm.title,
          records: content.modules,
        }),
        packageId,
        position: Number(moduleForm.position || 0),
        estimatedDurationMinutes: Number(moduleForm.estimatedDurationMinutes || 0),
      };

      let savedModule = null;
      if (moduleForm.id) {
        savedModule = await updateLearningAdminModule({ token, id: moduleForm.id, payload });
      } else {
        savedModule = await createLearningAdminModule({ token, payload });
      }

      toast.success(t('learning.admin_save_success'));
      setSelectedPackageId(packageId);
      const modulesForPackage = content.modules.filter((item) => item.packageId === packageId);
      const orderedModules = placeItemAfter(
        modulesForPackage,
        { ...(savedModule || moduleForm), id: savedModule?.id || moduleForm.id, packageId },
        moduleForm.afterModuleId || ''
      );
      await persistModuleOrder(orderedModules, { notify: false, reload: false });
      setModuleForm({
        ...emptyModuleForm,
        packageId,
        position: getNextModulePosition(packageId),
        afterModuleId: getLastModuleId(packageId, savedModule?.id || moduleForm.id),
      });
      if (!lessonForm.id && savedModule?.id) {
        setLessonForm((current) => ({
          ...current,
          packageId,
          moduleId: current.moduleId || savedModule.id,
        }));
        setCurriculumEditorMode('lesson');
      }
      await loadContent();
    } catch (error) {
      console.error('Failed to save learning module:', error);
      toast.error(error.message || t('learning.admin_save_error'));
    }
  };

  const submitLesson = async (event) => {
    event.preventDefault();

    try {
      const packageId = lessonForm.packageId || selectedPackageId;
      const saveMode = event.nativeEvent?.submitter?.value || 'save';
      const richPlainText = getLearningRichPlainText(lessonForm.richContent);
      const payload = {
        ...lessonForm,
        slug: getUniqueSlug({
          currentId: lessonForm.id,
          fallback: lessonForm.slug || lessonForm.title,
          records: content.lessons,
        }),
        packageId,
        saveMode,
        status: saveMode === 'publish' ? 'published' : saveMode === 'draft' ? 'draft' : lessonForm.status,
        textContent: richPlainText || lessonForm.textContent || '',
        richContent: lessonForm.richContent,
        attachments: parseAttachments(lessonForm.attachmentsText),
        estimatedMinutes: Number(lessonForm.estimatedMinutes || 0),
        position: Number(lessonForm.position || 0),
      };

      let savedLesson = null;
      if (lessonForm.id) {
        savedLesson = await updateLearningAdminLesson({ token, id: lessonForm.id, payload });
      } else {
        savedLesson = await createLearningAdminLesson({ token, payload });
      }

      toast.success(t('learning.admin_save_success'));
      setSelectedPackageId(packageId);
      const lessonsForModule = content.lessons.filter((item) => item.moduleId === payload.moduleId);
      const orderedLessons = placeItemAfter(
        lessonsForModule,
        {
          ...(savedLesson || lessonForm),
          id: savedLesson?.id || lessonForm.id,
          packageId,
          moduleId: payload.moduleId,
        },
        lessonForm.afterLessonId || ''
      );
      await persistLessonOrder(orderedLessons, { notify: false, reload: false });
      setLessonForm({
        ...emptyLessonForm,
        packageId,
        moduleId: payload.moduleId,
        position: getNextLessonPosition(payload.moduleId),
        afterLessonId: getLastLessonId(payload.moduleId, savedLesson?.id || lessonForm.id),
      });
      setCurriculumEditorMode('lesson');
      await loadContent();
    } catch (error) {
      console.error('Failed to save learning lesson:', error);
      toast.error(error.message || t('learning.admin_save_error'));
    }
  };

  const duplicateLesson = async (lessonId) => {
    try {
      await duplicateLearningAdminLesson({ token, id: lessonId });
      toast.success(t('learning.admin_save_success'));
      await loadContent();
    } catch (error) {
      console.error('Failed to duplicate learning lesson:', error);
      toast.error(error.message || t('learning.admin_save_error'));
    }
  };

  const requestDelete = (type, item) => {
    if (!item?.id) return;
    setDeleteTarget({ type, item });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      if (deleteTarget.type === 'package') {
        await deleteLearningAdminPackage({ token, id: deleteTarget.item.id });
        if (packageForm.id === deleteTarget.item.id) setPackageForm(emptyPackageForm);
        if (moduleForm.packageId === deleteTarget.item.id) setModuleForm(emptyModuleForm);
        if (lessonForm.packageId === deleteTarget.item.id) setLessonForm(emptyLessonForm);
        if (selectedPackageId === deleteTarget.item.id) setSelectedPackageId('');
        setBuilderPanel('package');
      } else if (deleteTarget.type === 'module') {
        await deleteLearningAdminModule({ token, id: deleteTarget.item.id });
        if (moduleForm.id === deleteTarget.item.id) {
          setModuleForm({
            ...emptyModuleForm,
            packageId: selectedPackageId || '',
            position: getNextModulePosition(selectedPackageId || ''),
          });
        }
        if (lessonForm.moduleId === deleteTarget.item.id) setLessonForm({ ...emptyLessonForm, packageId: selectedPackageId || '' });
      } else if (deleteTarget.type === 'lesson') {
        await deleteLearningAdminLesson({ token, id: deleteTarget.item.id });
        if (lessonForm.id === deleteTarget.item.id) {
          setLessonForm({
            ...emptyLessonForm,
            packageId: selectedPackageId || '',
            moduleId: deleteTarget.item.moduleId || '',
            position: getNextLessonPosition(deleteTarget.item.moduleId || ''),
          });
        }
      }

      toast.success(t('learning.admin_delete_success'));
      setDeleteTarget(null);
      await loadContent();
    } catch (error) {
      console.error('Failed to delete learning content:', error);
      toast.error(error.message || t('learning.admin_delete_error'));
    } finally {
      setDeleting(false);
    }
  };

  const submitCoupon = async (event) => {
    event.preventDefault();

    try {
      const payload = {
        ...couponForm,
        percentOff: Number(couponForm.percentOff || 0),
        amountOff: Number(couponForm.amountOff || 0),
        durationInMonths: Number(couponForm.durationInMonths || 0),
        maxRedemptions: Number(couponForm.maxRedemptions || 0),
      };

      if (couponForm.id) {
        await updateLearningAdminCoupon({ token, id: couponForm.id, payload });
      } else {
        await createLearningAdminCoupon({ token, payload });
      }

      toast.success(t('learning.admin_save_success'));
      setCouponForm(emptyCouponForm);
      await loadContent();
    } catch (error) {
      console.error('Failed to save learning coupon:', error);
      toast.error(error.message || t('learning.admin_save_error'));
    }
  };

  const uploadLessonMedia = async ({ file, mediaType, targetField }) => {
    if (!file) return;

    setMediaUploading(targetField);
    try {
      const record = await uploadLearningAdminMedia({ token, file, mediaType, label: file.name });
      setLessonForm((current) => ({ ...current, [targetField]: record.url || '' }));
      toast.success(t('learning.admin_media_upload_success'));
    } catch (error) {
      console.error('Failed to upload learning media:', error);
      toast.error(error.message || t('learning.admin_media_upload_error'));
    } finally {
      setMediaUploading('');
    }
  };

  const uploadPackageImage = async ({ file, targetField }) => {
    if (!file) return;

    setMediaUploading(targetField);
    try {
      const record = await uploadLearningAdminMedia({ token, file, mediaType: 'image', label: file.name });
      setPackageForm((current) => ({ ...current, [targetField]: record.url || '' }));
      toast.success(t('learning.admin_media_upload_success'));
    } catch (error) {
      console.error('Failed to upload learning package image:', error);
      toast.error(error.message || t('learning.admin_media_upload_error'));
    } finally {
      setMediaUploading('');
    }
  };

  const uploadLessonInlineImage = async (file) => {
    if (!file) return null;

    setMediaUploading('richContentImage');
    try {
      const record = await uploadLearningAdminMedia({ token, file, mediaType: 'image', label: file.name });
      toast.success(t('learning.admin_media_upload_success'));
      return record;
    } catch (error) {
      console.error('Failed to upload inline learning image:', error);
      toast.error(error.message || t('learning.admin_media_upload_error'));
      return null;
    } finally {
      setMediaUploading('');
    }
  };

  const grantSubscriberAccess = async (event) => {
    event.preventDefault();

    try {
      await grantLearningAdminSubscriberAccess({
        token,
        payload: {
          userEmail: subscriberForm.userEmail,
          packageId: subscriberForm.packageId,
          durationDays: Number(subscriberForm.durationDays || 30),
        },
      });
      toast.success(t('learning.admin_save_success'));
      setSelectedPackageId(subscriberForm.packageId || selectedPackageId);
      setSubscriberForm(emptySubscriberForm);
      await loadContent();
    } catch (error) {
      console.error('Failed to grant subscriber access:', error);
      toast.error(error.message || t('learning.admin_save_error'));
    }
  };

  const revokeSubscriberAccess = async (subscriberId) => {
    try {
      await revokeLearningAdminSubscriberAccess({ token, id: subscriberId });
      toast.success(t('learning.admin_save_success'));
      await loadContent();
    } catch (error) {
      console.error('Failed to revoke subscriber access:', error);
      toast.error(error.message || t('learning.admin_save_error'));
    }
  };

  const updateSubscriberStatus = async (subscriberId, status) => {
    try {
      await updateLearningAdminSubscriberStatus({
        token,
        id: subscriberId,
        payload: {
          status,
          durationDays: Number(subscriberForm.durationDays || 30),
        },
      });
      toast.success(t('learning.admin_status_update_success'));
      await loadContent();
    } catch (error) {
      console.error('Failed to update subscriber status:', error);
      toast.error(error.message || t('learning.admin_save_error'));
    }
  };

  const startNewPackage = () => {
    setPackageForm(emptyPackageForm);
    setSelectedPackageId('');
    setModuleForm(emptyModuleForm);
    setLessonForm(emptyLessonForm);
    setBuilderPanel('package');
    setCurriculumEditorMode('module');
    setActiveSection('editor');
  };

  const startNewModule = () => {
    const packageId = selectedPackageId || content.packages[0]?.id || '';
    if (packageId) setSelectedPackageId(packageId);
    setModuleForm({
      ...emptyModuleForm,
      packageId,
      position: getNextModulePosition(packageId),
      afterModuleId: getLastModuleId(packageId),
    });
    setBuilderPanel('curriculum');
    setCurriculumEditorMode('module');
    setActiveSection('editor');
  };

  const startNewLesson = () => {
    const packageId = selectedPackageId || content.packages[0]?.id || '';
    const firstModuleId = content.modules.find((item) => item.packageId === packageId)?.id || '';
    if (packageId) setSelectedPackageId(packageId);
    setLessonForm({
      ...emptyLessonForm,
      packageId,
      moduleId: firstModuleId,
      position: getNextLessonPosition(firstModuleId),
      afterLessonId: getLastLessonId(firstModuleId),
    });
    setBuilderPanel('curriculum');
    setCurriculumEditorMode('lesson');
    setActiveSection('editor');
  };

  const startNewLessonForModule = (moduleRecord) => {
    if (!moduleRecord) return;
    setSelectedPackageId(moduleRecord.packageId || '');
    setLessonForm({
      ...emptyLessonForm,
      packageId: moduleRecord.packageId || '',
      moduleId: moduleRecord.id,
      position: getNextLessonPosition(moduleRecord.id),
      afterLessonId: getLastLessonId(moduleRecord.id),
    });
    setBuilderPanel('curriculum');
    setCurriculumEditorMode('lesson');
    setActiveSection('editor');
  };

  const deleteTypeLabel = deleteTarget?.type === 'package'
    ? copy('learning.admin_package', 'Package')
    : deleteTarget?.type === 'module'
      ? copy('learning.admin_module', 'Module')
      : copy('learning.admin_lesson', 'Lesson');
  const deleteTargetName = deleteTarget?.item?.title || deleteTypeLabel;
  const deleteConfirmTitle = deleteTarget?.type === 'package'
    ? copy('learning.admin_delete_package_confirm_title', 'Delete this package?')
    : deleteTarget?.type === 'module'
      ? copy('learning.admin_delete_module_confirm_title', 'Delete this module?')
      : deleteTarget?.type === 'lesson'
        ? copy('learning.admin_delete_lesson_confirm_title', 'Delete this lesson?')
        : copy('learning.admin_delete_confirm_title', 'Delete this item?');
  const deleteConfirmBody = deleteTarget?.type === 'package'
    ? copy('learning.admin_delete_package_confirm_body', 'Are you sure you want to delete this package?')
    : deleteTarget?.type === 'module'
      ? copy('learning.admin_delete_module_confirm_body', 'Are you sure you want to delete this module?')
      : deleteTarget?.type === 'lesson'
        ? copy('learning.admin_delete_lesson_confirm_body', 'Are you sure you want to delete this lesson?')
        : copy('learning.admin_delete_confirm_body', 'Are you sure you want to delete this item?');

  return (
    <>
      <Helmet>
        <title>{`${t('learning.admin_title')} - Zahniboerse`}</title>
        <meta name="robots" content="noindex,nofollow,noarchive" />
      </Helmet>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="rounded-[8px]">
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmBody} {deleteTargetName ? `${deleteTypeLabel}: ${deleteTargetName}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault();
                confirmDelete();
              }}
            >
              {deleting ? t('common.loading') : copy('learning.admin_delete', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <main className="learning-shell flex-1">
        <div className="container mx-auto max-w-[1600px] px-4 py-10 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">{t('learning.admin_eyebrow')}</p>
              <h1 className="mt-3 text-4xl font-bold text-slate-900">{t('learning.admin_title')}</h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
                {copy('learning.admin_dashboard_body', 'Manage every learning package from one workspace: publish content, inspect subscribers, review revenue, and drill into package-level activity.')}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" className="rounded-[8px]" onClick={loadContent} disabled={loading}>
                <Activity className="size-4" />
                {loading ? t('common.loading') : copy('admin_dashboard.refresh', 'Refresh')}
              </Button>
              <Button type="button" className="rounded-[8px] bg-[#0000FF] text-white hover:bg-[#0000CC]" onClick={startNewPackage}>
                <Plus className="size-4" />
                {copy('learning.admin_new_package', 'New package')}
              </Button>
            </div>
          </div>

          <section className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {globalStats.map((item) => {
              const Icon = item.icon;
              return (
                <Card key={item.label} className="border-black/6 bg-white shadow-card">
                  <CardContent className="flex items-start justify-between gap-4 p-5">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-950">{item.value}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
                    </div>
                    <span className="rounded-[8px] bg-[#0000FF]/10 p-3 text-[#0000FF]">
                      <Icon className="size-5" />
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </section>

          <Tabs value={activeSection} onValueChange={setActiveSection} className="space-y-6">
            <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-[8px] bg-white p-1 shadow-card">
              <TabsTrigger value="overview" className="rounded-[8px] px-4 py-2">{copy('admin_dashboard.overview', 'Overview')}</TabsTrigger>
              <TabsTrigger value="contents" className="rounded-[8px] px-4 py-2">{copy('learning.admin_all_learning_contents', 'All learning contents')}</TabsTrigger>
              <TabsTrigger value="editor" className="rounded-[8px] px-4 py-2">{copy('learning.admin_content_builder', 'Content builder')}</TabsTrigger>
              <TabsTrigger value="subscribers" className="rounded-[8px] px-4 py-2">{t('learning.admin_subscribers')}</TabsTrigger>
              <TabsTrigger value="billing" className="rounded-[8px] px-4 py-2">{copy('learning.admin_billing', 'Billing')}</TabsTrigger>
              <TabsTrigger value="activity" className="rounded-[8px] px-4 py-2">{copy('learning.admin_activity', 'Activity')}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-6">
                  <Card className="border-black/6 bg-white shadow-card">
                    <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle className="text-2xl">{copy('learning.admin_overview_snapshot', 'Learning overview')}</CardTitle>
                        <CardDescription>{copy('learning.admin_overview_snapshot_hint', 'A fast read on recent content, publication health, subscriber access, and revenue signals.')}</CardDescription>
                      </div>
                      <Button type="button" variant="outline" className="rounded-[8px]" onClick={() => setActiveSection('contents')}>
                        <FileText className="size-4" />
                        {copy('learning.admin_view_all_content', 'View all content')}
                      </Button>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{copy('learning.admin_publication_health', 'Publication health')}</p>
                        <p className="mt-3 text-3xl font-semibold text-slate-950">{overviewAnalytics.publishedPackages}</p>
                        <p className="mt-1 text-sm text-slate-500">{copy('learning.admin_status_published', 'Published')}</p>
                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500">
                          <span>{overviewAnalytics.draftPackages} {copy('learning.admin_status_draft', 'draft')}</span>
                          <span>{overviewAnalytics.archivedPackages} {copy('learning.admin_status_archived', 'archived')}</span>
                        </div>
                      </div>
                      <div className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{copy('learning.admin_media_coverage', 'Media coverage')}</p>
                        <p className="mt-3 text-3xl font-semibold text-slate-950">{overviewAnalytics.lessonsWithMedia}/{content.lessons.length}</p>
                        <p className="mt-1 text-sm text-slate-500">{copy('learning.admin_lessons_with_assets', 'lessons with assets')}</p>
                        <p className="mt-4 text-xs text-slate-500">{overviewAnalytics.previewLessons} {copy('learning.admin_preview_lessons', 'preview lessons')}</p>
                      </div>
                      <div className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{copy('learning.admin_billing_health', 'Billing health')}</p>
                        <p className="mt-3 text-3xl font-semibold text-slate-950">{overviewAnalytics.paidInvoices}</p>
                        <p className="mt-1 text-sm text-slate-500">{copy('learning.admin_paid_invoices', 'paid invoices')}</p>
                        <p className="mt-4 text-xs text-slate-500">{subscriberStatusCounts.past_due || 0} {statusLabel('past_due').toLowerCase()}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-black/6 bg-white shadow-card">
                    <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle>{copy('learning.admin_latest_content', 'Latest content')}</CardTitle>
                        <CardDescription>{copy('learning.admin_latest_content_hint', 'Recently active packages with their content and subscriber position.')}</CardDescription>
                      </div>
                      <Button type="button" variant="outline" className="rounded-[8px]" onClick={startNewPackage}>
                        <Plus className="size-4" />
                        {copy('learning.admin_new_package', 'New package')}
                      </Button>
                    </CardHeader>
                    <CardContent className="grid gap-3 lg:grid-cols-2">
                      {latestContentSummaries.map((item) => (
                        <button
                          key={item.package.id}
                          type="button"
                          onClick={() => selectPackage(item.package.id)}
                          className={`rounded-[8px] border p-4 text-left transition-colors ${
                            selectedPackageId === item.package.id
                              ? 'border-[#0000FF]/40 bg-[#0000FF]/5'
                              : 'border-black/6 bg-[#f7f7f7] hover:border-[#0000FF]/25'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="h-14 w-20 shrink-0 overflow-hidden rounded-[8px] bg-slate-100">
                              {item.package.thumbnailUrl || item.package.coverImageUrl ? (
                                <img src={item.package.thumbnailUrl || item.package.coverImageUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-slate-400">
                                  <BookOpen className="size-5" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate font-semibold text-slate-950">{item.package.title}</h3>
                                <Badge className={`rounded-[8px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-none ${getStatusBadgeClass(item.package.status)}`}>{item.package.status}</Badge>
                              </div>
                              <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">{item.package.subtitle || item.package.description || '--'}</p>
                              <p className="mt-3 text-xs text-slate-500">
                                {item.publishedLessons.length}/{item.lessons.length} {t('learning.admin_lessons').toLowerCase()} - {item.activeSubscribers.length} {t('learning.admin_subscribers').toLowerCase()}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))}
                      {latestContentSummaries.length === 0 && (
                        <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-6 text-sm text-slate-500">
                          {copy('learning.admin_no_packages', 'No learning packages yet.')}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-black/6 bg-white shadow-card">
                    <CardHeader>
                      <CardTitle>{copy('learning.admin_recent_learning_activity', 'Recent learning activity')}</CardTitle>
                      <CardDescription>{copy('learning.admin_recent_learning_activity_hint', 'Latest package, lesson, subscription, and billing events across the learning area.')}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {visibleSubscriptionEvents.slice(0, 5).map((item) => {
                        const details = eventDetails(item);
                        return (
                          <article key={item.id} className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">{eventLabel(item.eventType)}</h3>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">{item.created || '--'}</p>
                            {details.length > 0 && (
                              <p className="mt-3 text-sm leading-6 text-slate-600">{details.join(' - ')}</p>
                            )}
                          </article>
                        );
                      })}
                      {visibleSubscriptionEvents.length === 0 && (
                        <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-4 text-sm text-slate-500">{t('learning.admin_no_subscription_events')}</div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-black/6 bg-white shadow-card">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-2xl">
                      <ShieldCheck className="size-5 text-[#0000FF]" />
                      {copy('learning.admin_selected_content', 'Selected content')}
                    </CardTitle>
                    <CardDescription>{copy('learning.admin_selected_content_hint', 'Open one package to inspect content, subscribers, billing, and recent events together.')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedPackageSummary ? (
                      <div className="space-y-5">
                        <div className="overflow-hidden rounded-[8px] bg-[#0000FF] text-white shadow-card">
                          {selectedPackageSummary.package.coverImageUrl && (
                            <img
                              src={selectedPackageSummary.package.coverImageUrl}
                              alt=""
                              className="h-40 w-full object-cover"
                            />
                          )}
                          <div className="p-5">
                            <Badge className={`rounded-[8px] border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-none ${getStatusBadgeClass(selectedPackageSummary.package.status)}`}>
                              {selectedPackageSummary.package.status}
                            </Badge>
                            <h2 className="mt-3 text-2xl font-semibold">{selectedPackageSummary.package.title}</h2>
                            <p className="mt-2 text-sm leading-6 text-blue-50">{selectedPackageSummary.package.subtitle || selectedPackageSummary.package.description || '--'}</p>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <Button type="button" size="sm" className="rounded-[8px] bg-white text-[#0000FF] hover:bg-blue-50" onClick={() => hydratePackageForm(selectedPackageSummary.package)}>
                                <PencilLine className="size-4" />
                                {t('learning.admin_edit')}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="rounded-[8px] border-white/35 bg-transparent text-white hover:bg-white/15 hover:text-white"
                                onClick={() => requestDelete('package', selectedPackageSummary.package)}
                              >
                                <Trash2 className="size-4" />
                                {copy('learning.admin_delete', 'Delete')}
                              </Button>
                              {selectedPackageSummary.package.status === 'published' && (
                                <Button asChild type="button" size="sm" variant="outline" className="rounded-[8px] border-white/35 bg-transparent text-white hover:bg-white/15 hover:text-white">
                                  <Link to={`/learning/packages/${selectedPackageSummary.package.slug}`}>
                                    <Eye className="size-4" />
                                    {copy('learning.admin_view_public', 'View public')}
                                  </Link>
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
                          {[
                            [t('learning.admin_modules'), selectedPackageSummary.modules.length],
                            [t('learning.admin_lessons'), selectedPackageSummary.lessons.length],
                            [t('learning.admin_subscribers'), selectedPackageSummary.subscribers.length],
                            [copy('learning.admin_coupons', 'Coupons'), selectedPackageSummary.coupons.length],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                              <p className="text-xs text-slate-500">{label}</p>
                              <p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{copy('learning.admin_latest_activity', 'Latest activity')}</p>
                          <div className="mt-3 space-y-3">
                            {selectedEvents.slice(0, 4).map((item) => (
                              <div key={item.id} className="rounded-[8px] bg-white p-3">
                                <p className="text-sm font-medium text-slate-800">{eventLabel(item.eventType)}</p>
                                <p className="mt-1 text-xs text-slate-500">{item.created || '--'}</p>
                              </div>
                            ))}
                            {selectedEvents.length === 0 && (
                              <p className="text-sm text-slate-500">{t('learning.admin_no_subscription_events')}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-8 text-center text-sm text-slate-500">
                        {copy('learning.admin_no_packages', 'No learning packages yet.')}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="contents" className="space-y-6">
              <Card className="border-black/6 bg-white shadow-card">
                <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-2xl">{copy('learning.admin_all_learning_contents', 'All learning contents')}</CardTitle>
                    <CardDescription>{copy('learning.admin_all_learning_contents_hint', 'Compare packages, publication state, subscribers, revenue, and content depth at a glance.')}</CardDescription>
                  </div>
                  <div className="relative w-full md:w-80">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={packageSearch}
                      onChange={(event) => setPackageSearch(event.target.value)}
                      className="pl-9"
                      placeholder={copy('learning.admin_search_packages', 'Search packages...')}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="overflow-hidden rounded-[8px] border border-black/6">
                    <Table>
                      <TableHeader className="bg-[#f7f7f7]">
                        <TableRow>
                          <TableHead className="min-w-[280px] px-4 py-3">{copy('learning.admin_content_name', 'Learning content')}</TableHead>
                          <TableHead className="min-w-[120px] px-4 py-3">{t('learning.admin_publication')}</TableHead>
                          <TableHead className="px-4 py-3 text-center">{t('learning.admin_modules')}</TableHead>
                          <TableHead className="px-4 py-3 text-center">{t('learning.admin_lessons')}</TableHead>
                          <TableHead className="px-4 py-3 text-center">{t('learning.admin_subscribers')}</TableHead>
                          <TableHead className="min-w-[120px] px-4 py-3">{copy('learning.admin_revenue', 'Revenue')}</TableHead>
                          <TableHead className="min-w-[160px] px-4 py-3">{copy('learning.admin_publish_progress', 'Publish progress')}</TableHead>
                          <TableHead className="px-4 py-3 text-right">{copy('admin_verifications.actions', 'Actions')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {packageSummaries.map((item) => (
                          <TableRow
                            key={item.package.id}
                            onClick={() => selectPackage(item.package.id)}
                            className={`cursor-pointer ${
                              selectedPackageId === item.package.id
                                ? 'bg-[#0000FF]/5 hover:bg-[#0000FF]/10'
                                : 'hover:bg-[#f7f7f7]'
                            }`}
                          >
                            <TableCell className="px-4 py-4">
                              <div className="flex items-center gap-3">
                                <div className="h-12 w-16 shrink-0 overflow-hidden rounded-[8px] bg-slate-100">
                                  {item.package.thumbnailUrl || item.package.coverImageUrl ? (
                                    <img
                                      src={item.package.thumbnailUrl || item.package.coverImageUrl}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                                      <BookOpen className="size-5" />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate font-semibold text-slate-950">{item.package.title}</p>
                                  <p className="mt-1 truncate text-xs text-slate-500">/{item.package.slug}</p>
                                  <p className="mt-1 line-clamp-1 text-xs text-slate-500">{item.package.subtitle || item.package.description || '--'}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="px-4 py-4">
                              <Badge className={`rounded-[8px] border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-none ${getStatusBadgeClass(item.package.status)}`}>
                                {item.package.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-4 py-4 text-center font-semibold text-slate-900">
                              {item.publishedModules.length}/{item.modules.length}
                            </TableCell>
                            <TableCell className="px-4 py-4 text-center font-semibold text-slate-900">
                              {item.publishedLessons.length}/{item.lessons.length}
                            </TableCell>
                            <TableCell className="px-4 py-4 text-center font-semibold text-slate-900">
                              {item.activeSubscribers.length}/{item.subscribers.length}
                            </TableCell>
                            <TableCell className="px-4 py-4 font-semibold text-slate-900">
                              {formatCurrency(item.revenue, item.package.currency)}
                            </TableCell>
                            <TableCell className="px-4 py-4">
                              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-[#0000FF]" style={{ width: `${item.completionPercent}%` }} />
                              </div>
                              <p className="mt-2 text-xs text-slate-500">{item.completionPercent}%</p>
                            </TableCell>
                            <TableCell className="px-4 py-4 align-middle text-right" onClick={(event) => event.stopPropagation()}>
                              <div className="flex min-h-9 items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  className="h-9 w-9 rounded-[8px]"
                                  onClick={() => hydratePackageForm(item.package)}
                                  aria-label={t('learning.admin_edit')}
                                  title={t('learning.admin_edit')}
                                >
                                  <PencilLine className="size-4" />
                                </Button>
                                {item.package.status === 'published' && (
                                  <Button
                                    asChild
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className="h-9 w-9 rounded-[8px]"
                                    aria-label={copy('learning.admin_view_public', 'View public')}
                                    title={copy('learning.admin_view_public', 'View public')}
                                  >
                                    <Link to={`/learning/packages/${item.package.slug}`}>
                                      <Eye className="size-4" />
                                    </Link>
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="outline"
                                  className="h-9 w-9 rounded-[8px] border-red-200 text-red-700 hover:bg-red-50"
                                  onClick={() => requestDelete('package', item.package)}
                                  aria-label={copy('learning.admin_delete_package', 'Delete package')}
                                  title={copy('learning.admin_delete_package', 'Delete package')}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {packageSummaries.length === 0 && (
                    <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-8 text-center text-sm text-slate-500">
                      {copy('learning.admin_no_packages_match', 'No learning packages match the current search.')}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="editor" className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-black/6 bg-white p-4 shadow-card">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {copy('learning.admin_working_package', 'Working package')}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {copy('learning.admin_working_package_hint', 'Modules and lessons shown below belong only to the selected package. Save a package first, then add modules, then add lessons inside those modules.')}
                  </p>
                </div>
                <div className="flex w-full min-w-0 flex-1 flex-wrap justify-start gap-3 sm:min-w-[260px] md:justify-end">
                  <select
                    value={selectedPackageId}
                    onChange={(event) => selectPackage(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm sm:min-w-[260px] sm:w-auto"
                  >
                    <option value="">{copy('learning.admin_select_content_package', 'Select learning content')}</option>
                    {content.packages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                  </select>
                  <Button type="button" variant="outline" className="rounded-[8px]" onClick={startNewPackage}>
                    <Plus className="size-4" />
                    {copy('learning.admin_new_package', 'New package')}
                  </Button>
                  {selectedPackageSummary && (
                    <Button type="button" variant="outline" className="rounded-[8px]" onClick={() => hydratePackageForm(selectedPackageSummary.package)}>
                      <PencilLine className="size-4" />
                      {copy('learning.admin_package_details', 'Package details')}
                    </Button>
                  )}
                  {selectedPackageSummary && (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-[8px] border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => requestDelete('package', selectedPackageSummary.package)}
                    >
                      <Trash2 className="size-4" />
                      {copy('learning.admin_delete_package', 'Delete package')}
                    </Button>
                  )}
                </div>
              </div>
              <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] 2xl:grid-cols-[minmax(560px,0.9fr)_minmax(680px,1.1fr)]">
                <Card className="border-black/6 bg-white shadow-card">
                  <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <CardTitle>{copy('learning.admin_curriculum_map', 'Curriculum map')}</CardTitle>
                      <CardDescription>
                        {selectedPackageSummary
                          ? `${selectedPackageSummary.package.title} - ${selectedModules.length} ${t('learning.admin_modules').toLowerCase()}, ${selectedLessons.length} ${t('learning.admin_lessons').toLowerCase()}`
                          : copy('learning.admin_select_package_first', 'Select a package first')}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" className="rounded-[8px]" onClick={startNewModule} disabled={!selectedPackageSummary}>
                        <Layers3 className="size-4" />
                        {copy('learning.admin_new_module', 'Module')}
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="rounded-[8px]" onClick={startNewLesson} disabled={!selectedPackageSummary || selectedModules.length === 0}>
                        <FileText className="size-4" />
                        {copy('learning.admin_new_lesson', 'Lesson')}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedModules.map((moduleRecord, moduleIndex) => {
                      const moduleLessons = selectedLessons.filter((lesson) => lesson.moduleId === moduleRecord.id);
                      return (
                        <div
                          key={moduleRecord.id}
                          className={`rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4 ${draggedModuleId === moduleRecord.id ? 'opacity-60' : ''}`}
                          onDragOver={(event) => {
                            if (draggedModuleId) event.preventDefault();
                          }}
                          onDrop={(event) => reorderModulesByDrag(event, moduleRecord.id)}
                        >
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                            <div className="flex min-w-0 gap-3">
                              <span
                                draggable
                                onDragStart={(event) => {
                                  setDraggedModuleId(moduleRecord.id);
                                  event.dataTransfer.effectAllowed = 'move';
                                }}
                                onDragEnd={() => setDraggedModuleId('')}
                                className="mt-0.5 flex h-9 w-9 shrink-0 cursor-grab items-center justify-center rounded-[8px] border border-black/10 bg-white text-slate-500 active:cursor-grabbing"
                                aria-label={copy('learning.admin_drag_module', 'Drag module')}
                                title={copy('learning.admin_drag_to_reorder', 'Drag to reorder')}
                              >
                                <GripVertical className="size-4" />
                              </span>
                              <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-semibold text-slate-950">{moduleRecord.title}</h3>
                                <Badge className={`rounded-[8px] border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] shadow-none ${getStatusBadgeClass(moduleRecord.status)}`}>
                                  {moduleRecord.status}
                                </Badge>
                                {moduleRecord.isPreview && <Badge className="rounded-[8px] bg-blue-50 text-blue-700 shadow-none">{t('learning.preview_label')}</Badge>}
                              </div>
                              <p className="mt-1 text-sm text-slate-500">{copy('learning.admin_module_position', 'Module')} {moduleIndex + 1} - {moduleLessons.length} {t('learning.admin_lessons').toLowerCase()}</p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center justify-end gap-2">
                              <Button type="button" size="sm" variant="outline" className="rounded-[8px]" onClick={() => startNewLessonForModule(moduleRecord)}>
                                <Plus className="size-4" />
                                {copy('learning.admin_add_lesson', 'Add lesson')}
                              </Button>
                              <Button type="button" size="sm" variant="outline" className="rounded-[8px]" onClick={() => hydrateModuleForm(moduleRecord)}>
                                {t('learning.admin_edit')}
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                className="h-9 w-9 rounded-[8px] border-red-200 text-red-700 hover:bg-red-50"
                                onClick={() => requestDelete('module', moduleRecord)}
                                aria-label={copy('learning.admin_delete_module', 'Delete module')}
                                title={copy('learning.admin_delete_module', 'Delete module')}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="mt-4 space-y-2">
                            {moduleLessons.map((lesson, lessonIndex) => (
                              <div
                                key={lesson.id}
                                className={`grid gap-3 rounded-[8px] bg-white p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${draggedLessonId === lesson.id ? 'opacity-60' : ''}`}
                                onDragOver={(event) => {
                                  if (draggedLessonId) event.preventDefault();
                                }}
                                onDrop={(event) => reorderLessonsByDrag(event, lesson.id, moduleRecord.id)}
                              >
                                <div className="flex min-w-0 gap-3">
                                  <span
                                    draggable
                                    onDragStart={(event) => {
                                      setDraggedLessonId(lesson.id);
                                      event.dataTransfer.effectAllowed = 'move';
                                    }}
                                    onDragEnd={() => setDraggedLessonId('')}
                                    className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-[8px] border border-black/10 bg-[#f7f7f7] text-slate-500 active:cursor-grabbing"
                                    aria-label={copy('learning.admin_drag_lesson', 'Drag lesson')}
                                    title={copy('learning.admin_drag_to_reorder', 'Drag to reorder')}
                                  >
                                    <GripVertical className="size-4" />
                                  </span>
                                  <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-900">{lesson.title}</p>
                                  <p className="mt-1 text-xs text-slate-500">{copy('learning.admin_lesson_position', 'Lesson')} {lessonIndex + 1} - {lesson.contentType} - {lesson.estimatedMinutes || 0} {t('learning.admin_minutes_short')}</p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center justify-end gap-2">
                                  <Badge className={`rounded-[8px] border px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] shadow-none ${getStatusBadgeClass(lesson.status)}`}>
                                    {lesson.status}
                                  </Badge>
                                  <Button type="button" size="sm" variant="outline" className="rounded-[8px]" onClick={() => hydrateLessonForm(lesson)}>
                                    {t('learning.admin_edit')}
                                  </Button>
                                  <Button type="button" size="icon" variant="outline" className="rounded-[8px]" onClick={() => duplicateLesson(lesson.id)} aria-label={t('learning.admin_duplicate')}>
                                    <CopyIcon className="size-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="outline"
                                    className="h-9 w-9 rounded-[8px] border-red-200 text-red-700 hover:bg-red-50"
                                    onClick={() => requestDelete('lesson', lesson)}
                                    aria-label={copy('learning.admin_delete_lesson', 'Delete lesson')}
                                    title={copy('learning.admin_delete_lesson', 'Delete lesson')}
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                            {moduleLessons.length === 0 && (
                              <div className="rounded-[8px] border border-dashed border-black/10 bg-white p-3 text-sm text-slate-500">
                                {copy('learning.admin_no_lessons_in_module', 'No lessons in this module yet.')}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {selectedModules.length === 0 && (
                      <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-6 text-sm text-slate-500">
                        {copy('learning.admin_no_modules_for_package', 'No modules have been created for this package yet.')}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  {builderPanel === 'package' && (
                  <Card className="border-black/6 bg-white shadow-card">
                    <CardHeader>
                      <CardTitle>{t('learning.admin_packages')}</CardTitle>
                      <CardDescription>{t('learning.admin_packages_hint')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <form className="space-y-3" onSubmit={submitPackage}>
                        <Input required value={packageForm.title} onChange={(event) => setPackageForm((current) => ({ ...current, title: event.target.value }))} placeholder={t('learning.admin_package_title')} />
                        <Input required value={packageForm.subtitle} onChange={(event) => setPackageForm((current) => ({ ...current, subtitle: event.target.value }))} placeholder={t('learning.admin_package_subtitle')} />
                        <Textarea value={packageForm.description} onChange={(event) => setPackageForm((current) => ({ ...current, description: event.target.value }))} placeholder={t('learning.admin_package_description')} />
                        <Textarea required value={packageForm.heroCopy} onChange={(event) => setPackageForm((current) => ({ ...current, heroCopy: event.target.value }))} placeholder={t('learning.admin_hero_copy')} />
                        <Textarea value={packageForm.targetAudience} onChange={(event) => setPackageForm((current) => ({ ...current, targetAudience: event.target.value }))} placeholder={t('learning.target_audience')} />
                        <div className="grid gap-3 md:grid-cols-3">
                          <Input required value={packageForm.priceAmount} onChange={(event) => setPackageForm((current) => ({ ...current, priceAmount: event.target.value }))} placeholder={t('learning.price_label')} />
                          <Input value={packageForm.yearlyPriceAmount} onChange={(event) => setPackageForm((current) => ({ ...current, yearlyPriceAmount: event.target.value }))} placeholder={t('learning.yearly_price')} />
                          <select required value={packageForm.billingInterval} onChange={(event) => setPackageForm((current) => ({ ...current, billingInterval: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                            <option value="month">{t('learning.monthly')}</option>
                            <option value="year">{t('learning.yearly')}</option>
                          </select>
                        </div>
                        <MediaUrlField
                          value={packageForm.heroImageUrl}
                          onChange={(value) => setPackageForm((current) => ({ ...current, heroImageUrl: value }))}
                          placeholder={t('learning.admin_hero_image_url')}
                          uploadLabel={t('learning.admin_upload_image')}
                          accept="image/jpeg,image/png,image/webp"
                          disabled={mediaUploading === 'heroImageUrl'}
                          loading={mediaUploading === 'heroImageUrl'}
                          onUpload={(file) => uploadPackageImage({ file, targetField: 'heroImageUrl' })}
                        />
                        <MediaUrlField
                          value={packageForm.thumbnailUrl}
                          onChange={(value) => setPackageForm((current) => ({ ...current, thumbnailUrl: value }))}
                          placeholder={t('learning.admin_thumbnail_url')}
                          uploadLabel={t('learning.admin_upload_image')}
                          accept="image/jpeg,image/png,image/webp"
                          disabled={mediaUploading === 'thumbnailUrl'}
                          loading={mediaUploading === 'thumbnailUrl'}
                          onUpload={(file) => uploadPackageImage({ file, targetField: 'thumbnailUrl' })}
                        />
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input value={packageForm.promoBadge} onChange={(event) => setPackageForm((current) => ({ ...current, promoBadge: event.target.value }))} placeholder={t('learning.admin_promo_badge')} />
                          <Input required value={packageForm.ctaText} onChange={(event) => setPackageForm((current) => ({ ...current, ctaText: event.target.value }))} placeholder={t('learning.admin_cta_text')} />
                        </div>
                        <Textarea value={packageForm.promoText} onChange={(event) => setPackageForm((current) => ({ ...current, promoText: event.target.value }))} placeholder={t('learning.admin_promo_text')} />
                        <Textarea required value={packageForm.pricingCopy} onChange={(event) => setPackageForm((current) => ({ ...current, pricingCopy: event.target.value }))} placeholder={t('learning.admin_pricing_copy')} />
                        <select required value={packageForm.status} onChange={(event) => setPackageForm((current) => ({ ...current, status: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                          <option value="draft">{t('learning.admin_status_draft')}</option>
                          <option value="published">{t('learning.admin_status_published')}</option>
                          <option value="archived">{t('learning.admin_status_archived')}</option>
                        </select>
                        <Textarea required value={packageForm.valuePointsText} onChange={(event) => setPackageForm((current) => ({ ...current, valuePointsText: event.target.value }))} placeholder={t('learning.admin_value_points')} />
                        <Textarea value={packageForm.includedContentText} onChange={(event) => setPackageForm((current) => ({ ...current, includedContentText: event.target.value }))} placeholder={t('learning.admin_included_content')} />
                        <Textarea required value={packageForm.faqText} onChange={(event) => setPackageForm((current) => ({ ...current, faqText: event.target.value }))} placeholder={t('learning.admin_faq_lines')} />
                        <FormActions
                          primaryLabel={t('learning.admin_save')}
                          resetLabel={t('learning.admin_reset')}
                          onReset={() => setPackageForm(emptyPackageForm)}
                        />
                      </form>
                    </CardContent>
                  </Card>
                  )}

                  <div className="rounded-[8px] border border-blue-100 bg-blue-50/70 p-4">
                    <p className="text-sm font-semibold text-slate-900">{copy('learning.admin_curriculum_creation_flow', 'Curriculum creation flow')}</p>
                    <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                      <div className="rounded-[8px] bg-white p-3">
                        <span className="font-semibold text-[#0000FF]">1.</span> {copy('learning.admin_flow_package', 'Save or select a package.')}
                      </div>
                      <div className="rounded-[8px] bg-white p-3">
                        <span className="font-semibold text-[#0000FF]">2.</span> {copy('learning.admin_flow_module', 'Create multiple modules inside it.')}
                      </div>
                      <div className="rounded-[8px] bg-white p-3">
                        <span className="font-semibold text-[#0000FF]">3.</span> {copy('learning.admin_flow_lesson', 'Use Add lesson on a module to place lessons correctly.')}
                      </div>
                    </div>
                  </div>

                  {builderPanel === 'curriculum' && (
                  <Card className="border-black/6 bg-white shadow-card">
                    <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <CardTitle>{copy('learning.admin_curriculum_item_editor', 'Curriculum item editor')}</CardTitle>
                        <CardDescription>
                          {curriculumEditorMode === 'module'
                            ? copy('learning.admin_module_editor_hint', 'Create one module at a time. After saving, add lessons inside that module.')
                            : copy('learning.admin_lesson_editor_hint', 'Create one lesson at a time under the selected module.')}
                        </CardDescription>
                      </div>
                      <div className="grid grid-cols-2 gap-2 rounded-[8px] bg-slate-100 p-1">
                        <Button
                          type="button"
                          variant={curriculumEditorMode === 'module' ? 'default' : 'ghost'}
                          className={`rounded-[8px] ${curriculumEditorMode === 'module' ? 'bg-[#0000FF] text-white hover:bg-[#0000CC]' : ''}`}
                          onClick={startNewModule}
                          disabled={!selectedPackageSummary}
                        >
                          <Layers3 className="size-4" />
                          {copy('learning.admin_module', 'Module')}
                        </Button>
                        <Button
                          type="button"
                          variant={curriculumEditorMode === 'lesson' ? 'default' : 'ghost'}
                          className={`rounded-[8px] ${curriculumEditorMode === 'lesson' ? 'bg-[#0000FF] text-white hover:bg-[#0000CC]' : ''}`}
                          onClick={startNewLesson}
                          disabled={!selectedPackageSummary || selectedModules.length === 0}
                        >
                          <FileText className="size-4" />
                          {copy('learning.admin_lesson', 'Lesson')}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {curriculumEditorMode === 'module' ? (
                        <div className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                          <div className="mb-4">
                            <h3 className="text-base font-semibold text-slate-950">
                              {moduleForm.id ? copy('learning.admin_edit_module', 'Edit module') : copy('learning.admin_create_module', 'Create module')}
                            </h3>
                            <p className="mt-1 text-sm text-slate-600">
                              {selectedPackageSummary
                                ? `${copy('learning.admin_module_will_belong_to', 'This module belongs to')} ${selectedPackageSummary.package.title}.`
                                : copy('learning.admin_save_or_select_package_first', 'Save or select a package before adding modules.')}
                            </p>
                          </div>
                          <form className="space-y-3" onSubmit={submitModule}>
                            <Input required value={moduleForm.title} onChange={(event) => setModuleForm((current) => ({ ...current, title: event.target.value }))} placeholder={t('learning.admin_module_title')} />
                            <Textarea value={moduleForm.description} onChange={(event) => setModuleForm((current) => ({ ...current, description: event.target.value }))} placeholder={t('learning.admin_module_description')} />
                            <label className="block space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy('learning.admin_place_after', 'Place after')}</span>
                              <select
                                value={moduleForm.afterModuleId || ''}
                                onChange={(event) => setModuleForm((current) => ({ ...current, afterModuleId: event.target.value }))}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              >
                                <option value="">{copy('learning.admin_place_first', 'At the beginning')}</option>
                                {selectedModules
                                  .filter((item) => item.id !== moduleForm.id)
                                  .map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                              </select>
                            </label>
                            <select required value={moduleForm.status} onChange={(event) => setModuleForm((current) => ({ ...current, status: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                              <option value="draft">{t('learning.admin_status_draft')}</option>
                              <option value="published">{t('learning.admin_status_published')}</option>
                            </select>
                            <label className="flex items-center gap-2 text-sm text-slate-600">
                              <input type="checkbox" checked={moduleForm.isPreview} onChange={(event) => setModuleForm((current) => ({ ...current, isPreview: event.target.checked }))} />
                              {copy('learning.admin_module_free_preview', 'Make all lessons in this module available as free preview')}
                            </label>
                            <FormActions primaryLabel={moduleForm.id ? t('learning.admin_save') : copy('learning.admin_create_module', 'Create module')} resetLabel={t('learning.admin_reset')} onReset={() => setModuleForm({ ...emptyModuleForm, packageId: selectedPackageId || '', position: getNextModulePosition(selectedPackageId || '') })} />
                          </form>
                        </div>
                      ) : (
                        <div className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                          <div className="mb-4">
                            <h3 className="text-base font-semibold text-slate-950">
                              {lessonForm.id ? copy('learning.admin_edit_lesson', 'Edit lesson') : copy('learning.admin_create_lesson', 'Create lesson')}
                            </h3>
                            <p className="mt-1 text-sm text-slate-600">
                              {selectedLessonModule
                                ? `${copy('learning.admin_lesson_will_belong_to', 'This lesson will be added to')} ${selectedLessonModule.title}.`
                                : copy('learning.admin_create_module_first_hint', 'Create or select a module before adding lessons.')}
                            </p>
                          </div>
                          <form className="space-y-3" onSubmit={submitLesson}>
                            <label className="block space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy('learning.admin_module', 'Module')}</span>
                              <select
                                required
                                value={lessonForm.moduleId}
                                onChange={(event) => {
                                  const moduleId = event.target.value;
                                  setLessonForm((current) => ({
                                    ...current,
                                    moduleId,
                                    position: current.id ? current.position : getNextLessonPosition(moduleId),
                                    afterLessonId: getLastLessonId(moduleId, current.id),
                                  }));
                                }}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              >
                                <option value="">{modulesForSelectedPackage.length > 0 ? t('common.select') : copy('learning.admin_create_module_first', 'Create a module first')}</option>
                                {modulesForSelectedPackage.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                              </select>
                            </label>
                            <Input required value={lessonForm.title} onChange={(event) => setLessonForm((current) => ({ ...current, title: event.target.value }))} placeholder={t('learning.admin_lesson_title')} />
                            <Textarea value={lessonForm.description} onChange={(event) => setLessonForm((current) => ({ ...current, description: event.target.value }))} placeholder={t('learning.admin_lesson_description')} />
                            <LearningRichContentEditor
                              value={lessonForm.richContent}
                              fallbackText={lessonForm.textContent}
                              uploading={mediaUploading === 'richContentImage'}
                              onUploadImage={uploadLessonInlineImage}
                              onChange={(richContent) => setLessonForm((current) => ({
                                ...current,
                                richContent,
                                textContent: getLearningRichPlainText(richContent),
                              }))}
                            />
                            <label className="block space-y-1">
                              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{copy('learning.admin_place_after', 'Place after')}</span>
                              <select
                                value={lessonForm.afterLessonId || ''}
                                onChange={(event) => setLessonForm((current) => ({ ...current, afterLessonId: event.target.value }))}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                              >
                                <option value="">{copy('learning.admin_place_first', 'At the beginning')}</option>
                                {selectedLessons
                                  .filter((item) => item.moduleId === lessonForm.moduleId && item.id !== lessonForm.id)
                                  .map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                              </select>
                            </label>
                            <div className="grid gap-3 md:grid-cols-3">
                              <select required value={lessonForm.contentType} onChange={(event) => setLessonForm((current) => ({ ...current, contentType: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                                <option value="video">{t('learning.format_video')}</option>
                                <option value="text">{t('learning.format_text')}</option>
                                <option value="pdf">{t('learning.format_pdf')}</option>
                                <option value="download">{t('learning.format_download')}</option>
                                <option value="mixed">{t('learning.format_mixed')}</option>
                              </select>
                              <select required value={lessonForm.status} onChange={(event) => setLessonForm((current) => ({ ...current, status: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                                <option value="draft">{t('learning.admin_status_draft')}</option>
                                <option value="published">{t('learning.admin_status_published')}</option>
                              </select>
                              <Input value={lessonForm.estimatedMinutes} onChange={(event) => setLessonForm((current) => ({ ...current, estimatedMinutes: event.target.value }))} placeholder={t('learning.admin_minutes')} />
                            </div>
                            <div className="grid gap-3">
                              <MediaUrlField value={lessonForm.videoUrl} onChange={(value) => setLessonForm((current) => ({ ...current, videoUrl: value }))} placeholder={t('learning.admin_video_url')} uploadLabel={t('learning.admin_upload_video')} accept="video/mp4,video/webm" disabled={mediaUploading === 'videoUrl'} loading={mediaUploading === 'videoUrl'} onUpload={(file) => uploadLessonMedia({ file, mediaType: 'video', targetField: 'videoUrl' })} />
                              <MediaUrlField value={lessonForm.pdfUrl} onChange={(value) => setLessonForm((current) => ({ ...current, pdfUrl: value }))} placeholder={t('learning.admin_pdf_url')} uploadLabel={t('learning.admin_upload_pdf')} accept="application/pdf" disabled={mediaUploading === 'pdfUrl'} loading={mediaUploading === 'pdfUrl'} onUpload={(file) => uploadLessonMedia({ file, mediaType: 'pdf', targetField: 'pdfUrl' })} />
                              <MediaUrlField value={lessonForm.downloadUrl} onChange={(value) => setLessonForm((current) => ({ ...current, downloadUrl: value }))} placeholder={t('learning.admin_download_url')} uploadLabel={t('learning.admin_upload_download')} accept="application/pdf,application/zip,application/octet-stream" disabled={mediaUploading === 'downloadUrl'} loading={mediaUploading === 'downloadUrl'} onUpload={(file) => uploadLessonMedia({ file, mediaType: 'download', targetField: 'downloadUrl' })} />
                            </div>
                            <label className="flex items-center gap-2 text-sm text-slate-600">
                              <input type="checkbox" checked={lessonForm.isPreview} onChange={(event) => setLessonForm((current) => ({ ...current, isPreview: event.target.checked }))} />
                              {copy('learning.admin_lesson_free_preview', 'Make this lesson available as free preview')}
                            </label>
                            <div className="rounded-[8px] border border-blue-100 bg-blue-50/70 p-3 text-sm text-slate-700">
                              <p className="font-semibold text-slate-900">
                                {lessonForm.hasUnpublishedChanges
                                  ? copy('learning.admin_unpublished_changes', 'Unpublished draft changes are loaded in this editor.')
                                  : copy('learning.admin_draft_publish_hint_title', 'Draft and publish')}
                              </p>
                              <p className="mt-1">
                                {copy('learning.admin_draft_publish_hint', 'Save Draft keeps published lessons visible as they are. Publish makes the editor version visible to learners.')}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-3">
                              <Button type="submit" name="saveMode" value="draft" variant="outline" className="flex-1 rounded-[8px]">
                                {copy('learning.admin_save_draft', 'Save draft')}
                              </Button>
                              <Button type="submit" name="saveMode" value="publish" className="flex-1 rounded-[8px] bg-[#0000FF] text-white hover:bg-[#0000CC]">
                                {copy('learning.admin_publish_lesson', 'Publish')}
                              </Button>
                              {lessonForm.id && (
                                <Button type="button" variant="outline" className="rounded-[8px]" asChild>
                                  <Link to={`/learning/lessons/${lessonForm.id}`} target="_blank" rel="noreferrer">
                                    <Eye className="size-4" />
                                    {copy('learning.admin_preview_as_learner', 'Preview as learner')}
                                  </Link>
                                </Button>
                              )}
                              <Button type="button" variant="outline" className="rounded-[8px]" onClick={() => {
                                const moduleId = modulesForSelectedPackage[0]?.id || '';
                                setLessonForm({ ...emptyLessonForm, packageId: selectedPackageId || '', moduleId, position: getNextLessonPosition(moduleId) });
                              }}>
                                {t('learning.admin_reset')}
                              </Button>
                            </div>
                          </form>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  )}


                </div>
              </section>
            </TabsContent>

            <TabsContent value="subscribers" className="space-y-6">
              <section className="grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
                <Card className="border-black/6 bg-white shadow-card">
                  <CardHeader>
                    <CardTitle>{t('learning.admin_subscribers')}</CardTitle>
                    <CardDescription>{t('learning.admin_subscribers_hint')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={grantSubscriberAccess}>
                      <Input value={subscriberForm.userEmail} onChange={(event) => setSubscriberForm((current) => ({ ...current, userEmail: event.target.value }))} placeholder={t('learning.admin_student_email')} />
                      <select value={subscriberForm.packageId} onChange={(event) => setSubscriberForm((current) => ({ ...current, packageId: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                        <option value="">{t('common.select')}</option>
                        {content.packages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                      </select>
                      <Input value={subscriberForm.durationDays} onChange={(event) => setSubscriberForm((current) => ({ ...current, durationDays: event.target.value }))} placeholder={t('learning.admin_access_days')} />
                      <Button type="submit" className="w-full rounded-[8px] bg-[#0000FF] text-white hover:bg-[#0000CC]">{t('learning.admin_grant_access')}</Button>
                    </form>
                    <div className="mt-6 grid gap-2 sm:grid-cols-2">
                      {subscriptionStatuses.map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setSubscriberStatusFilter(status)}
                          className={`rounded-[8px] border px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
                            subscriberStatusFilter === status
                              ? 'border-[#0000FF]/30 bg-[#0000FF]/10 text-[#0000FF]'
                              : 'border-black/6 bg-[#f7f7f7] text-slate-500 hover:border-[#0000FF]/20'
                          }`}
                        >
                          {statusLabel(status)} - {subscriberStatusCounts[status] || 0}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setSubscriberStatusFilter('all')}
                        className={`rounded-[8px] border px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] transition-colors ${
                          subscriberStatusFilter === 'all'
                            ? 'border-[#0000FF]/30 bg-[#0000FF]/10 text-[#0000FF]'
                            : 'border-black/6 bg-white text-slate-500 hover:border-[#0000FF]/20'
                        }`}
                      >
                        {t('learning.admin_all_statuses')} - {content.subscribers.length}
                      </button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-black/6 bg-white shadow-card">
                  <CardHeader>
                    <CardTitle>{copy('learning.admin_subscriber_table', 'Subscriber statistics')}</CardTitle>
                    <CardDescription>
                      {selectedPackageSummary
                        ? `${selectedPackageSummary.package.title} - ${selectedSubscribers.length} ${t('learning.admin_subscribers').toLowerCase()}`
                        : copy('learning.admin_select_package_first', 'Select a package first')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-[8px] border border-black/6">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{copy('admin_dashboard.customer', 'Customer')}</TableHead>
                            <TableHead>{copy('learning.admin_access_state', 'Access')}</TableHead>
                            <TableHead>{t('learning.admin_latest_invoice')}</TableHead>
                            <TableHead className="text-right">{copy('admin_verifications.actions', 'Actions')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredSubscribers
                            .filter((item) => !selectedPackageId || item.subscription?.packageId === selectedPackageId)
                            .map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>
                                  <p className="font-medium text-slate-900">{item.userName || item.userEmail}</p>
                                  <p className="text-xs text-slate-500">{item.userEmail}</p>
                                </TableCell>
                                <TableCell>
                                  <Badge className={`rounded-[8px] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-none ${getSubscriptionBadgeToneClass(item.subscription.status)}`}>
                                    {statusLabel(item.subscription.status)}
                                  </Badge>
                                  <p className="mt-2 text-xs text-slate-500">{t('learning.admin_access_until')} {getSubscriptionDisplayEndDate(item.subscription) || '--'}</p>
                                </TableCell>
                                <TableCell>
                                  <p className="text-sm text-slate-700">{item.invoiceSummary?.latestStatus || '--'}</p>
                                  <p className="text-xs text-slate-500">{item.invoiceSummary?.count || 0} {t('learning.admin_total_label')}</p>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <select
                                      value={item.subscription.status}
                                      onChange={(event) => updateSubscriberStatus(item.id, event.target.value)}
                                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                    >
                                      {subscriptionStatuses.map((status) => (
                                        <option key={status} value={status}>{statusLabel(status)}</option>
                                      ))}
                                    </select>
                                    <Button type="button" size="sm" variant="outline" className="rounded-[8px] border-red-200 text-red-700 hover:bg-red-50" onClick={() => revokeSubscriberAccess(item.id)}>
                                      {t('learning.admin_revoke_access')}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    </div>
                    {filteredSubscribers.filter((item) => !selectedPackageId || item.subscription?.packageId === selectedPackageId).length === 0 && (
                      <div className="mt-4 rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-4 text-sm text-slate-500">{t('learning.admin_no_subscribers')}</div>
                    )}
                  </CardContent>
                </Card>
              </section>
            </TabsContent>

            <TabsContent value="billing" className="space-y-6">
              <section className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
                <Card className="border-black/6 bg-white shadow-card">
                  <CardHeader>
                    <CardTitle>{t('learning.admin_coupons')}</CardTitle>
                    <CardDescription>{t('learning.admin_coupons_hint')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form className="space-y-3" onSubmit={submitCoupon}>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input value={couponForm.code} onChange={(event) => setCouponForm((current) => ({ ...current, code: event.target.value }))} placeholder={t('learning.admin_coupon_code')} />
                        <Input value={couponForm.title} onChange={(event) => setCouponForm((current) => ({ ...current, title: event.target.value }))} placeholder={t('learning.admin_coupon_title')} />
                      </div>
                      <Textarea value={couponForm.description} onChange={(event) => setCouponForm((current) => ({ ...current, description: event.target.value }))} placeholder={t('learning.admin_coupon_description')} />
                      <Textarea value={couponForm.promotionText} onChange={(event) => setCouponForm((current) => ({ ...current, promotionText: event.target.value }))} placeholder={t('learning.admin_coupon_promotion_text')} />
                      <select value={couponForm.packageId} onChange={(event) => setCouponForm((current) => ({ ...current, packageId: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                        <option value="">{t('learning.admin_all_packages')}</option>
                        {content.packages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                      </select>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <select value={couponForm.discountType} onChange={(event) => setCouponForm((current) => ({ ...current, discountType: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                          <option value="percent">{t('learning.admin_discount_percent')}</option>
                          <option value="fixed_amount">{t('learning.admin_discount_fixed')}</option>
                        </select>
                        <select value={couponForm.status} onChange={(event) => setCouponForm((current) => ({ ...current, status: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                          <option value="draft">{t('learning.admin_status_draft')}</option>
                          <option value="active">{t('learning.admin_status_active')}</option>
                          <option value="archived">{t('learning.admin_status_archived')}</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Input value={couponForm.percentOff} onChange={(event) => setCouponForm((current) => ({ ...current, percentOff: event.target.value }))} placeholder={t('learning.admin_percent_off')} />
                        <Input value={couponForm.amountOff} onChange={(event) => setCouponForm((current) => ({ ...current, amountOff: event.target.value }))} placeholder={t('learning.admin_amount_off')} />
                        <Input value={couponForm.currency} onChange={(event) => setCouponForm((current) => ({ ...current, currency: event.target.value }))} placeholder={t('learning.currency')} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <select value={couponForm.duration} onChange={(event) => setCouponForm((current) => ({ ...current, duration: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                          <option value="once">{t('learning.admin_coupon_once')}</option>
                          <option value="repeating">{t('learning.admin_coupon_repeating')}</option>
                          <option value="forever">{t('learning.admin_coupon_forever')}</option>
                        </select>
                        <Input value={couponForm.durationInMonths} onChange={(event) => setCouponForm((current) => ({ ...current, durationInMonths: event.target.value }))} placeholder={t('learning.admin_duration_months')} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Input value={couponForm.startsAt} onChange={(event) => setCouponForm((current) => ({ ...current, startsAt: event.target.value }))} placeholder={t('learning.admin_starts_at')} />
                        <Input value={couponForm.expiresAt} onChange={(event) => setCouponForm((current) => ({ ...current, expiresAt: event.target.value }))} placeholder={t('learning.admin_expires_at')} />
                        <Input value={couponForm.maxRedemptions} onChange={(event) => setCouponForm((current) => ({ ...current, maxRedemptions: event.target.value }))} placeholder={t('learning.admin_max_redemptions')} />
                      </div>
                      <FormActions primaryLabel={t('learning.admin_save')} resetLabel={t('learning.admin_reset')} onReset={() => setCouponForm(emptyCouponForm)} />
                    </form>
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card className="border-black/6 bg-white shadow-card">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><Ticket className="size-5 text-[#0000FF]" />{t('learning.admin_promotional_actions')}</CardTitle>
                      <CardDescription>{selectedPackageSummary?.package.title || t('learning.admin_all_packages')}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 lg:grid-cols-2">
                      {selectedCoupons.map((item) => (
                        <article key={item.id} className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">{item.code}</h3>
                              <p className="text-sm text-slate-500">{item.title}</p>
                            </div>
                            <Badge className={`rounded-[8px] border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-none ${getStatusBadgeClass(item.status)}`}>{item.status}</Badge>
                          </div>
                          <p className="mt-3 text-sm leading-6 text-slate-600">{item.promotionText || item.description || '--'}</p>
                          <p className="mt-3 text-xs text-slate-500">
                            {item.discountType === 'percent' ? `${item.percentOff}%` : `${item.amountOff} ${item.currency}`} - {item.redemptionCount}/{item.maxRedemptions || t('learning.admin_unlimited')}
                          </p>
                          <Button type="button" variant="outline" size="sm" className="mt-4 rounded-[8px]" onClick={() => hydrateCouponForm(item)}>{t('learning.admin_edit')}</Button>
                        </article>
                      ))}
                      {selectedCoupons.length === 0 && (
                        <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-4 text-sm text-slate-500">{t('learning.admin_no_coupons')}</div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-black/6 bg-white shadow-card">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2"><Receipt className="size-5 text-[#0000FF]" />{t('learning.admin_invoices')}</CardTitle>
                      <CardDescription>{formatCurrency(selectedPackageSummary?.revenue || 0, selectedPackageSummary?.package.currency || 'EUR')} {copy('learning.admin_revenue', 'Revenue').toLowerCase()}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-3 lg:grid-cols-2">
                      {selectedInvoices.map((item) => (
                        <article key={item.id} className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">{item.number || item.stripeInvoiceId}</h3>
                              <p className="mt-1 text-xs text-slate-500">{item.createdAt || '--'}</p>
                            </div>
                            <Badge className={`rounded-[8px] border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-none ${getStatusBadgeClass(item.status)}`}>{item.status}</Badge>
                          </div>
                          <p className="mt-3 text-sm text-slate-600">{formatCurrency(item.amountPaid || item.amountDue, item.currency)}</p>
                        </article>
                      ))}
                      {selectedInvoices.length === 0 && (
                        <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-4 text-sm text-slate-500">{t('learning.admin_no_invoices')}</div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="activity" className="space-y-6">
              <Card className="border-black/6 bg-white shadow-card">
                <CardHeader>
                  <CardTitle>{t('learning.admin_subscription_events')}</CardTitle>
                  <CardDescription>{selectedPackageSummary?.package.title || t('learning.admin_all_packages')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(selectedPackageId ? selectedEvents : visibleSubscriptionEvents).map((item) => {
                    const details = eventDetails(item);
                    return (
                      <article key={item.id} className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">{eventLabel(item.eventType)}</h3>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{item.created || '--'}</p>
                        {details.length > 0 && (
                          <p className="mt-3 text-sm leading-6 text-slate-600">{details.join(' - ')}</p>
                        )}
                      </article>
                    );
                  })}
                  {(selectedPackageId ? selectedEvents : visibleSubscriptionEvents).length === 0 && (
                    <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-4 text-sm text-slate-500">{t('learning.admin_no_subscription_events')}</div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </>
  );
};

const FormActions = ({ primaryLabel, resetLabel, onReset }) => (
  <div className="flex flex-wrap gap-3">
    <Button type="submit" className="flex-1 rounded-[8px] bg-[#0000FF] text-white hover:bg-[#0000CC]">{primaryLabel}</Button>
    <Button type="button" variant="outline" className="rounded-[8px]" onClick={onReset}>{resetLabel}</Button>
  </div>
);

const MediaUrlField = ({
  value,
  onChange,
  placeholder,
  uploadLabel,
  accept,
  disabled,
  loading,
  onUpload,
}) => (
  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
    <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    <label className={`flex h-10 min-w-[160px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-black/10 bg-white px-3 text-sm font-medium text-slate-600 transition-colors hover:border-[#0000FF]/30 hover:text-[#0000FF] ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
      <UploadCloud className="size-4" />
      {loading ? 'Loading...' : uploadLabel}
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          onUpload(file);
        }}
      />
    </label>
  </div>
);

export default LearningAdminPage;
