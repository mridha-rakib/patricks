import React, { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CalendarClock, CheckCircle2, Clock3, CreditCard, LockKeyhole, Search } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import AccountLayout from '@/components/AccountLayout.jsx';
import { getLearningDashboard, recalculateLearningPlan, searchLearningContent } from '@/lib/learningApi.js';
import { localizeLearningDashboard } from '@/lib/learningContentLocalization.js';
import {
  getBillingIntervalLabel,
  getLearningProgressStatusLabel,
  getLearningTopicStatusLabel,
  getLearningTopicStatusToneClass,
  getMinutesLabel,
  getNextChargeCopy,
  getPriceIntervalLabel,
} from '@/lib/learningPresentation.js';
import {
  getSubscriptionDateLabelKey,
  getSubscriptionDisplayEndDate,
  getSubscriptionNoAccessBodyKey,
  getSubscriptionNoAccessTitleKey,
  getSubscriptionStatusHintKey,
  getSubscriptionStatusLabel,
  getSubscriptionStatusToneClass,
} from '@/lib/subscriptionStatus.js';
import { getLearningSubtopicPath, getLearningTopicPath } from '@/lib/learningRoutes.js';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import pb from '@/lib/pocketbaseClient.js';
import { toast } from 'sonner';

const formatDate = (value, locale) => {
  if (!value) return '--';
  return new Date(value).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const getPlanProgressPercent = (progress) => {
  const explicitPercent = Number(progress?.percent || 0);
  if (explicitPercent > 0) return Math.min(100, explicitPercent);

  const totalAssignments = Number(progress?.totalAssignments || 0);
  if (totalAssignments > 0) {
    return Math.round((Number(progress?.completedAssignments || 0) / totalAssignments) * 100);
  }

  const targetMinutes = Number(progress?.targetMinutes || 0);
  if (targetMinutes > 0) {
    return Math.round((Number(progress?.completedMinutes || 0) / targetMinutes) * 100);
  }

  return 0;
};

const getPlanAssignmentToneClass = (status) => {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'started') return 'bg-[#0000FF]/10 text-[#0000FF]';
  if (status === 'to_repeat') return 'bg-amber-100 text-amber-800';
  if (status === 'overdue') return 'bg-rose-100 text-rose-700';
  return 'bg-slate-100 text-slate-600';
};

const getPlanAssignmentProgressStatus = (status) => {
  if (status === 'open') return 'not_started';
  if (status === 'started') return 'in_progress';
  return status;
};

const getPlanFeedbackToneClass = (tone) => {
  if (tone === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-blue-200 bg-blue-50 text-blue-900';
};

const LearningDashboardPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t, language } = useTranslation();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [paymentRefreshAttempts, setPaymentRefreshAttempts] = useState(0);
  const [learningSearchTerm, setLearningSearchTerm] = useState('');
  const [learningSearchResults, setLearningSearchResults] = useState([]);
  const [learningSearchLoading, setLearningSearchLoading] = useState(false);
  const [learningSearchTouched, setLearningSearchTouched] = useState(false);
  const [planRecalculationLoading, setPlanRecalculationLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const token = pb.authStore.token;
    if (!token) {
      navigate('/auth');
      return undefined;
    }

    const loadDashboard = async () => {
      try {
        const data = await getLearningDashboard(token);
        if (active) {
          setDashboard(localizeLearningDashboard(data, language));
        }
      } catch (error) {
        console.error('Failed to load learning dashboard:', error);
        toast.error(t('learning.dashboard_load_error'));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadDashboard();

    return () => {
      active = false;
    };
  }, [language, navigate, refreshTick, t]);

  const locale = language === 'DE' ? 'de-DE' : 'en-US';
  const paymentState = searchParams.get('payment');

  const statusLabel = useMemo(() => getSubscriptionStatusLabel(t, dashboard?.subscription?.status), [dashboard?.subscription?.status, t]);

  const subscriptionStatus = dashboard?.subscription?.status || '';
  const hasSubscription = Boolean(dashboard?.subscription);
  const statusHintKey = getSubscriptionStatusHintKey(subscriptionStatus);
  const displayEndDate = getSubscriptionDisplayEndDate(dashboard?.subscription);
  const formattedDisplayEndDate = formatDate(displayEndDate, locale);
  const formattedCurrentPeriodEnd = formatDate(dashboard?.subscription?.currentPeriodEnd, locale);
  const nextChargeCopy = getNextChargeCopy(t, dashboard?.subscription, formattedCurrentPeriodEnd);
  const dateLabelKey = getSubscriptionDateLabelKey(dashboard?.subscription);
  const continueLesson = useMemo(() => {
    if (!dashboard?.modules?.length) return null;

    const recent = dashboard.recentlyOpened?.[0];
    if (recent) return recent;

    for (const moduleRecord of dashboard.modules) {
      const firstPending = moduleRecord.lessons.find((lesson) => lesson.progress?.status !== 'completed');
      if (firstPending) return firstPending;
    }

    return dashboard.modules[0]?.lessons?.[0] || null;
  }, [dashboard]);
  const noAccessTitle = t(getSubscriptionNoAccessTitleKey(subscriptionStatus));
  const noAccessBody = t(getSubscriptionNoAccessBodyKey(subscriptionStatus));
  const reminderActive = useMemo(() => {
    if (!['active', 'trialing'].includes(subscriptionStatus)) return false;
    const nextChargeDate = dashboard?.subscription?.currentPeriodEnd;
    if (!nextChargeDate || !dashboard?.hasAccess) return false;
    const diffMs = new Date(nextChargeDate).getTime() - Date.now();
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    return diffDays >= 0 && diffDays <= 5;
  }, [dashboard, subscriptionStatus]);
  const learningPlan = dashboard?.learningPlan;
  const featureAccess = dashboard?.featureAccess || {};
  const planSections = learningPlan?.sections || {};
  const planContinueAssignment = learningPlan?.continueAssignment;
  const planWeeklyPercent = getPlanProgressPercent(learningPlan?.weeklyProgress);
  const planOverallPercent = getPlanProgressPercent(learningPlan?.overallProgress || learningPlan?.summary);
  const planFeedback = learningPlan?.feedback;

  const handlePlanRecalculation = async () => {
    const token = pb.authStore.token;
    if (!token || planRecalculationLoading) return;

    setPlanRecalculationLoading(true);
    try {
      const result = await recalculateLearningPlan({ token });
      setDashboard((currentDashboard) => currentDashboard
        ? {
          ...currentDashboard,
          learningPlan: result.learningPlan,
        }
        : currentDashboard);
      toast.success(t('learning.plan_recalculation_success'));
    } catch (error) {
      console.error('Failed to recalculate learning plan:', error);
      toast.error(t('learning.plan_recalculation_error'));
    } finally {
      setPlanRecalculationLoading(false);
    }
  };

  const renderPlanAssignment = (assignment) => {
    const content = (
      <div className="learning-inline-card flex h-full flex-col justify-between gap-4 p-4 transition-colors hover:border-[#0000FF]/25">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={`rounded-[8px] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-none ${getPlanAssignmentToneClass(assignment.status)}`}>
              {getLearningProgressStatusLabel(t, getPlanAssignmentProgressStatus(assignment.status))}
            </Badge>
            {assignment.estimatedMinutes > 0 && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                <Clock3 className="size-3" />
                {getMinutesLabel(t, assignment.estimatedMinutes)}
              </span>
            )}
          </div>
          <h4 className="mt-3 text-base font-semibold text-slate-900">{assignment.title}</h4>
          {assignment.topic?.title && (
            <p className="mt-1 text-xs font-medium text-[#0000FF]/70">{assignment.topic.title}</p>
          )}
          {assignment.description && (
            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{assignment.description}</p>
          )}
        </div>
        {assignment.path && (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#0000FF]">
            {t('learning.open_lesson')}
            <ArrowRight className="size-4" />
          </span>
        )}
      </div>
    );

    if (!assignment.path) {
      return <div key={assignment.id}>{content}</div>;
    }

    return (
      <Link key={assignment.id} to={assignment.path} className="block h-full">
        {content}
      </Link>
    );
  };

  const renderPlanAssignmentList = (items = []) => (
    items.length > 0 ? (
      <div className="mt-4 grid gap-3">
        {items.slice(0, 4).map(renderPlanAssignment)}
      </div>
    ) : (
      <div className="mt-4 rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-4 text-sm text-slate-500">
        {t('learning.plan_no_assignments')}
      </div>
    )
  );

  const renderPlanProgressCard = ({ title, progress, percent }) => (
    <div className="learning-subtle-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{title}</p>
          <h3 className="mt-2 text-3xl font-semibold text-slate-900">{percent}%</h3>
        </div>
        <CheckCircle2 className="mt-1 size-5 text-[#00A99D]" />
      </div>
      <div className="learning-progress-track mt-4">
        <div className="learning-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-3 text-sm text-slate-600">
        {t('learning.plan_progress_detail', {
          completed: Number(progress?.completedAssignments || 0),
          total: Number(progress?.totalAssignments || 0),
        })}
      </p>
    </div>
  );

  const renderContentTree = () => (
    <section className="learning-card mt-8 p-6 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.curriculum_preview')}</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-900">{t('learning.curriculum_preview')}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t('learning.content_tree_body')}</p>
        </div>
        <Badge className="w-fit rounded-[8px] bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
          {dashboard.progress?.percent || 0}%
        </Badge>
      </div>

      <div className="mt-6 space-y-4">
        {(dashboard.modules || []).map((moduleRecord) => {
          const modulePackage = moduleRecord.package || dashboard.package;

          return (
          <section key={moduleRecord.id} className="learning-subtle-card p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="break-words text-xl font-semibold text-slate-900">{moduleRecord.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{moduleRecord.description}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                <Badge className="rounded-[8px] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
                  {moduleRecord.lessons.length} {t('learning.lessons_count')}
                </Badge>
                <Badge className={`rounded-[8px] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] shadow-none ${getLearningTopicStatusToneClass(moduleRecord.progress?.topicStatus || moduleRecord.progress?.status)}`}>
                  {getLearningTopicStatusLabel(t, moduleRecord.progress?.topicStatus || moduleRecord.progress?.status)}
                </Badge>
              </div>
            </div>

            <div className="mt-4 max-w-sm">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>{t('learning.progress')}</span>
                <span>{moduleRecord.progress?.completedLessons || 0}/{moduleRecord.progress?.totalLessons || moduleRecord.lessons.length}</span>
              </div>
              <div className="learning-progress-track mt-2">
                <div className="learning-progress-fill" style={{ width: `${moduleRecord.progress?.percent || 0}%` }} />
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {moduleRecord.lessons.map((lesson) => (
                <Link
                  key={lesson.id}
                  to={getLearningSubtopicPath(lesson.package || modulePackage, moduleRecord, lesson)}
                  className="learning-inline-card flex flex-col gap-3 px-4 py-3 transition-colors hover:border-[#0000FF]/25 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-900">{lesson.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{getMinutesLabel(t, lesson.estimatedMinutes)}</p>
                    <div className="learning-progress-track mt-3 max-w-[160px]">
                      <div className="learning-progress-fill" style={{ width: `${lesson.progress?.progressPercentage || 0}%` }} />
                    </div>
                  </div>
                  <Badge className={`w-fit rounded-[8px] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-none ${
                    lesson.progress?.status === 'completed'
                      ? 'bg-emerald-100 text-emerald-700'
                      : lesson.progress?.status === 'in_progress'
                        ? 'bg-[#0000FF]/10 text-[#0000FF]'
                        : 'bg-slate-100 text-slate-500'
                  }`}>
                    {getLearningProgressStatusLabel(t, lesson.progress?.status)}
                  </Badge>
                </Link>
              ))}
            </div>

            <div className="mt-4">
              <Button asChild variant="outline" className="h-10 w-full rounded-[8px] border-black/10 bg-white px-5 text-slate-700 shadow-none hover:bg-slate-50 sm:w-auto">
                <Link to={getLearningTopicPath(modulePackage, moduleRecord)}>{t('learning.open_module')}</Link>
              </Button>
            </div>
          </section>
          );
        })}
      </div>
    </section>
  );

  useEffect(() => {
    if (paymentState !== 'success') return undefined;
    if (dashboard?.hasAccess) return undefined;
    if (paymentRefreshAttempts >= 8) return undefined;

    const timeoutId = window.setTimeout(() => {
      setPaymentRefreshAttempts((current) => current + 1);
      setRefreshTick((current) => current + 1);
    }, paymentRefreshAttempts === 0 ? 1200 : 3000);

    return () => window.clearTimeout(timeoutId);
  }, [dashboard?.hasAccess, paymentRefreshAttempts, paymentState]);

  useEffect(() => {
    const query = learningSearchTerm.trim();

    if (!dashboard?.hasAccess || query.length < 2) {
      setLearningSearchResults([]);
      setLearningSearchLoading(false);
      return undefined;
    }

    let active = true;
    const timeoutId = window.setTimeout(async () => {
      const token = pb.authStore.token;
      if (!token) return;

      setLearningSearchLoading(true);
      setLearningSearchTouched(true);
      try {
        const result = await searchLearningContent({ token, query });
        if (active) {
          setLearningSearchResults(result.items || []);
        }
      } catch (error) {
        console.error('Failed to search learning content:', error);
        if (active) {
          setLearningSearchResults([]);
          toast.error(t('learning.search_error'));
        }
      } finally {
        if (active) {
          setLearningSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [dashboard?.hasAccess, learningSearchTerm, t]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f7f7f7] text-slate-500">{t('common.loading')}</div>;
  }

  if (!dashboard?.subscription || !dashboard?.hasAccess) {
    const packageFallback = dashboard?.availablePackages?.[0];
    const packageShell = dashboard?.package || packageFallback;
    const lockedModules = Array.isArray(dashboard?.modules) ? dashboard.modules : [];
    const primaryCtaLabel = hasSubscription ? t('learning.reactivate') : t('learning.choose_package');
    const primaryCtaPath = hasSubscription && packageShell?.slug
      ? `/learning/subscribe/${packageShell.slug}`
      : '/learning/packages';

    return (
      <>
        <Helmet>
          <title>{`${t('learning.dashboard')} - Zahnibörse`}</title>
          <meta name="robots" content="noindex,nofollow,noarchive" />
        </Helmet>

        <AccountLayout activeKey="elearning" className="learning-shell" contentClassName="max-w-3xl">
          <section className="rounded-[8px] border border-black/6 bg-white p-8 text-center shadow-card md:p-10">
              <Badge className="rounded-[8px] bg-[#0000FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0000FF] shadow-none">
                {t('learning.dashboard')}
              </Badge>
              <h1 className="mt-5 text-4xl font-bold text-slate-900">{noAccessTitle}</h1>
              <p className="mt-4 text-base leading-7 text-slate-600">{noAccessBody}</p>
              {paymentState === 'success' && (
                <div className="mt-6 rounded-[8px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                  {t('learning.payment_processing_dashboard')}
                </div>
              )}
              {hasSubscription && (
                <div className={`mt-6 rounded-[8px] border p-4 text-sm ${getSubscriptionStatusToneClass(subscriptionStatus)}`}>
                  <p className="font-semibold">{statusLabel}</p>
                  {statusHintKey && <p className="mt-2">{t(statusHintKey)}</p>}
                </div>
              )}
              {packageShell && (
                <div className="mt-8 rounded-[8px] border border-black/6 bg-[#f7f7f7] p-5 text-left">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.current_package')}</p>
                      <h2 className="mt-2 text-2xl font-semibold text-slate-900">{packageShell.title}</h2>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{packageShell.subtitle || packageShell.description}</p>
                    </div>
                    {packageShell.priceAmount !== undefined && (
                      <Badge className="rounded-[8px] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
                        {getPriceIntervalLabel(t, packageShell.priceAmount, packageShell.currency, packageShell.billingInterval, locale)}
                      </Badge>
                    )}
                  </div>

                  {lockedModules.length > 0 && (
                    <div className="mt-5 space-y-3">
                      {lockedModules.map((moduleRecord) => (
                        <div key={moduleRecord.id} className="rounded-[8px] border border-black/6 bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-base font-semibold text-slate-900">{moduleRecord.title}</h3>
                              <p className="mt-1 text-sm leading-6 text-slate-600">{moduleRecord.description}</p>
                            </div>
                            <Badge className="rounded-[8px] bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 shadow-none">
                              {t('learning.status_locked')}
                            </Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(moduleRecord.lessons || []).slice(0, 3).map((lesson) => (
                              <span key={lesson.id} className="inline-flex items-center gap-2 rounded-[8px] bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
                                <LockKeyhole className="size-3" />
                                {lesson.title}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button asChild className="h-11 rounded-[8px] bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC]">
                  <Link to={primaryCtaPath}>
                    {primaryCtaLabel}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                {hasSubscription && (
                  <Button asChild variant="outline" className="h-11 rounded-[8px] border-black/10 bg-white px-6 text-slate-700 shadow-none hover:bg-slate-50">
                    <Link to="/learning/subscription">{t('learning.my_subscription')}</Link>
                  </Button>
                )}
              </div>
          </section>
        </AccountLayout>
      </>
    );
  }

  return (
    <>
      <Helmet>
        <title>{`${t('learning.dashboard')} - Zahnibörse`}</title>
        <meta name="robots" content="noindex,nofollow,noarchive" />
      </Helmet>

      <AccountLayout activeKey="elearning" className="learning-shell">
        <div>
          <section className="learning-card overflow-hidden">
            <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="p-7 md:p-9">
                <Badge className="rounded-[8px] bg-[#0000FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0000FF] shadow-none">
                  {t('learning.current_package')}
                </Badge>
                <h1 className="mt-5 text-4xl font-bold text-slate-900">{dashboard.package?.title}</h1>
                <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{dashboard.package?.subtitle}</p>

                {(paymentState === 'success' || paymentState === 'free-coupon') && (
                  <div className="mt-6 rounded-[8px] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                    {paymentState === 'free-coupon'
                      ? t('learning.free_subscription_success')
                      : t('learning.payment_success_dashboard')}
                  </div>
                )}

                <div className="mt-8 max-w-md">
                  <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
                    <span>{t('learning.progress')}</span>
                    <span>{dashboard.progress?.percent || 0}%</span>
                  </div>
                  <div className="learning-progress-track mt-3">
                    <div className="learning-progress-fill" style={{ width: `${dashboard.progress?.percent || 0}%` }} />
                  </div>
                </div>

                {continueLesson && (
                  <div className="learning-subtle-card mt-6 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.continue_learning')}</p>
                    <h2 className="mt-3 text-2xl font-semibold text-slate-900">{continueLesson.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{continueLesson.description}</p>
                    <Button asChild className="mt-5 h-11 rounded-[8px] bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC]">
                      <Link to={getLearningSubtopicPath(continueLesson.package || dashboard.package, { slug: continueLesson.moduleSlug }, continueLesson)}>
                        {t('learning.continue_learning')}
                        <ArrowRight className="size-4" />
                      </Link>
                    </Button>
                  </div>
                )}
              </div>

              <div className="border-t border-black/6 bg-[#f7f7f7] p-7 md:p-9 lg:border-l lg:border-t-0">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.manage_subscription')}</p>
                    <h2 className="mt-2 text-3xl font-semibold text-slate-900">{statusLabel}</h2>
                  </div>
                  <Badge className="rounded-[8px] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
                    {getPriceIntervalLabel(t, dashboard.subscription.priceAmount, dashboard.subscription.currency, dashboard.subscription.billingInterval, locale)}
                  </Badge>
                </div>

                <div className="mt-6 space-y-3">
                  {subscriptionStatus === 'past_due' && (
                    <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      {t('learning.status_past_due_hint')}
                    </div>
                  )}
                  {subscriptionStatus === 'canceled' && (
                    <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      {t('learning.status_canceled_hint')}
                    </div>
                  )}
                  {reminderActive && (
                    <div className="rounded-[8px] border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                      {t('learning.next_charge_reminder')}
                    </div>
                  )}
                  <div className="learning-inline-card flex gap-3 p-4">
                    <CalendarClock className="mt-0.5 size-5 shrink-0 text-[#0000FF]" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{t(dateLabelKey)}</p>
                      <p className="mt-1 text-sm text-slate-600">{formattedDisplayEndDate}</p>
                    </div>
                  </div>
                  <div className="learning-inline-card flex gap-3 p-4">
                    <CreditCard className="mt-0.5 size-5 shrink-0 text-[#0000FF]" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{t('learning.next_billing_date')}</p>
                      <p className="mt-1 text-sm text-slate-600">{nextChargeCopy}</p>
                    </div>
                  </div>
                  <div className="learning-inline-card flex gap-3 p-4">
                    <CreditCard className="mt-0.5 size-5 shrink-0 text-[#0000FF]" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{t('learning.billing_cycle')}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {getBillingIntervalLabel(t, dashboard.subscription.billingInterval)}
                      </p>
                    </div>
                  </div>
                  {dashboard.subscription.cancelAtPeriodEnd && subscriptionStatus !== 'canceled' && (
                    <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      {t('learning.cancel_at_period_end')}
                    </div>
                  )}
                </div>

                <div className="mt-6 grid gap-3">
                  <Button asChild className="h-11 w-full rounded-[8px] bg-[#0000FF] text-white shadow-none hover:bg-[#0000CC]">
                    <Link to="/learning/subscription">{t('learning.manage_subscription')}</Link>
                  </Button>
                  <Button asChild variant="outline" className="h-11 w-full rounded-[8px] border-black/10 bg-white text-slate-700 shadow-none hover:bg-slate-50">
                    <Link to="/learning/subscription">{t('learning.view_invoices')}</Link>
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {renderContentTree()}

          {learningPlan?.enabled && (
            <section className="learning-card mt-8 p-6 md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.plan_eyebrow')}</p>
                  <h2 className="mt-3 text-3xl font-semibold text-slate-900">{t('learning.plan_title')}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t('learning.plan_body')}</p>
                </div>
                <Badge className="rounded-[8px] bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
                  {learningPlan.summary?.percent || 0}%
                </Badge>
              </div>

              {!learningPlan.hasPlan ? (
                <div className="mt-6 rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-5 text-sm leading-6 text-slate-600">
                  <p className="font-semibold text-slate-900">{t('learning.plan_empty_title')}</p>
                  <p className="mt-2">{t('learning.plan_empty_body')}</p>
                </div>
              ) : (
                <>
                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    <div className="learning-subtle-card p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('learning.plan_today')}</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-900">{planSections.today?.length || 0}</p>
                    </div>
                    <div className="learning-subtle-card p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('learning.plan_catch_up')}</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-900">{planSections.catchUp?.length || 0}</p>
                    </div>
                    <div className="learning-subtle-card p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t('learning.plan_prepare')}</p>
                      <p className="mt-2 text-3xl font-semibold text-slate-900">{planSections.preparation?.length || 0}</p>
                    </div>
                  </div>

                  {planFeedback?.messageKey && (
                    <div className={`mt-6 rounded-[8px] border p-5 text-sm leading-6 ${getPlanFeedbackToneClass(planFeedback.tone)}`}>
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <p className="font-semibold">
                          {t(planFeedback.messageKey, planFeedback.params || {})}
                        </p>
                        {learningPlan.recalculation?.canRecalculate && (
                          <Button
                            type="button"
                            onClick={handlePlanRecalculation}
                            disabled={planRecalculationLoading}
                            className="h-10 rounded-[8px] bg-[#0000FF] px-5 text-white shadow-none hover:bg-[#0000CC] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {planRecalculationLoading ? t('common.loading') : t('learning.plan_recalculate')}
                          </Button>
                        )}
                      </div>
                      {learningPlan.recalculation?.canRecalculate && (
                        <p className="mt-2 text-sm opacity-85">{t('learning.plan_recalculate_body')}</p>
                      )}
                    </div>
                  )}

                  {planContinueAssignment?.path && (
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[#0000FF]/15 bg-[#0000FF]/5 p-5">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.continue_learning')}</p>
                        <h3 className="mt-2 text-xl font-semibold text-slate-900">{planContinueAssignment.title}</h3>
                        {planContinueAssignment.description && (
                          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">{planContinueAssignment.description}</p>
                        )}
                      </div>
                      <Button asChild className="h-11 rounded-[8px] bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC]">
                        <Link to={planContinueAssignment.path}>
                          {t('learning.plan_continue')}
                          <ArrowRight className="size-4" />
                        </Link>
                      </Button>
                    </div>
                  )}

                  <div className="mt-6 grid gap-5 xl:grid-cols-3">
                    <div className="learning-subtle-card p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.plan_today')}</p>
                      <h3 className="mt-2 text-xl font-semibold text-slate-900">{t('learning.plan_today_title')}</h3>
                      {renderPlanAssignmentList(planSections.today)}
                    </div>
                    <div className="learning-subtle-card p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">{t('learning.plan_catch_up')}</p>
                      <h3 className="mt-2 text-xl font-semibold text-slate-900">{t('learning.plan_catch_up_title')}</h3>
                      {renderPlanAssignmentList(planSections.catchUp)}
                    </div>
                    <div className="learning-subtle-card p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#00A99D]">{t('learning.plan_prepare')}</p>
                      <h3 className="mt-2 text-xl font-semibold text-slate-900">{t('learning.plan_prepare_title')}</h3>
                      {renderPlanAssignmentList(planSections.preparation)}
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 md:grid-cols-2">
                    {renderPlanProgressCard({
                      title: t('learning.plan_weekly_progress'),
                      progress: learningPlan.weeklyProgress,
                      percent: planWeeklyPercent,
                    })}
                    {renderPlanProgressCard({
                      title: t('learning.plan_overall_progress'),
                      progress: learningPlan.overallProgress,
                      percent: planOverallPercent,
                    })}
                  </div>
                </>
              )}
            </section>
          )}

          {featureAccess.examTrainer && (
            <section className="learning-card mt-8 p-6 md:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.exam_trainer_eyebrow')}</p>
                  <h2 className="mt-3 text-3xl font-semibold text-slate-900">{t('learning.exam_trainer_title')}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t('learning.exam_trainer_body')}</p>
                </div>
                <Badge className="w-fit rounded-[8px] bg-[#0000FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0000FF] shadow-none">
                  {t('learning.status_unlocked')}
                </Badge>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {[
                  { title: t('learning.exam_question_pool'), body: t('learning.exam_question_pool_body'), Icon: Search },
                  { title: t('learning.exam_training_mode'), body: t('learning.exam_training_mode_body'), Icon: Clock3 },
                  { title: t('learning.exam_analysis'), body: t('learning.exam_analysis_body'), Icon: CheckCircle2 },
                ].map(({ title, body, Icon }) => (
                  <div key={title} className="learning-subtle-card p-5">
                    <Icon className="size-5 text-[#0000FF]" />
                    <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="learning-card mt-8 p-6 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.search_eyebrow')}</p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-900">{t('learning.search_title')}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t('learning.search_body')}</p>
              </div>
              {learningSearchResults.length > 0 && (
                <Badge className="rounded-[8px] bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
                  {learningSearchResults.length} {t('learning.search_results_count')}
                </Badge>
              )}
            </div>

            <div className="relative mt-6">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={learningSearchTerm}
                onChange={(event) => setLearningSearchTerm(event.target.value)}
                placeholder={t('learning.search_placeholder')}
                aria-label={t('learning.search_title')}
                className="h-12 w-full rounded-[8px] border border-black/10 bg-white pl-11 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-[#0000FF]/40"
              />
            </div>

            <div className="mt-5 space-y-3" aria-live="polite">
              {learningSearchLoading && (
                <div className="rounded-[8px] border border-black/6 bg-[#f7f7f7] p-4 text-sm text-slate-500">
                  {t('learning.search_loading')}
                </div>
              )}

              {!learningSearchLoading && learningSearchTerm.trim().length >= 2 && learningSearchTouched && learningSearchResults.length === 0 && (
                <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-5 text-sm text-slate-500">
                  {t('learning.search_empty')}
                </div>
              )}

              {!learningSearchLoading && learningSearchResults.map((item) => (
                <Link
                  key={`${item.type}-${item.id}`}
                  to={item.path}
                  className="learning-subtle-card block p-4 transition-colors hover:border-[#0000FF]/25 hover:bg-white"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="rounded-[8px] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0000FF] shadow-none">
                          {item.type === 'topic' ? t('learning.search_type_topic') : t('learning.search_type_subtopic')}
                        </Badge>
                        {item.topic?.title && item.type === 'subtopic' && (
                          <span className="text-xs font-medium text-slate-500">{item.topic.title}</span>
                        )}
                      </div>
                      <h3 className="mt-2 text-lg font-semibold text-slate-900">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.excerpt || item.description}</p>
                    </div>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-[#0000FF]" />
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section className="learning-card mt-8 p-6 md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0000FF]/70">{t('learning.recently_opened')}</p>
            <h2 className="mt-3 text-3xl font-semibold text-slate-900">{t('learning.most_recent_lesson')}</h2>

            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {dashboard.recentlyOpened?.length > 0 ? dashboard.recentlyOpened.map((lesson) => (
                <Link key={lesson.id} to={getLearningSubtopicPath(lesson.package || dashboard.package, { slug: lesson.moduleSlug }, lesson)} className="learning-subtle-card block p-4 transition-colors hover:border-[#0000FF]/25 hover:bg-white">
                  <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#0000FF]/70">
                    {getLearningProgressStatusLabel(t, lesson.progress?.status || 'in_progress')}
                  </p>
                  <h3 className="mt-2 break-words text-xl font-semibold text-slate-900">{lesson.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{lesson.description}</p>
                  <p className="mt-3 text-xs text-slate-500">{formatDate(lesson.progress?.lastOpenedAt, locale)}</p>
                </Link>
              )) : (
                <div className="rounded-[8px] border border-dashed border-black/10 bg-[#f7f7f7] p-5 text-sm text-slate-500 md:col-span-3">
                  {t('learning.no_recent')}
                </div>
              )}
            </div>
          </section>
        </div>
      </AccountLayout>
    </>
  );
};

export default LearningDashboardPage;
