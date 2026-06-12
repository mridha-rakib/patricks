import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, Image as ImageIcon, PlayCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import LearningRichContentRenderer from '@/components/LearningRichContentRenderer.jsx';
import {
  getLearningAssetUrl,
  getLearningLesson,
  getLearningLessonBySlug,
  updateLearningLessonProgress,
} from '@/lib/learningApi.js';
import { localizeLearningLessonPayload } from '@/lib/learningContentLocalization.js';
import {
  getLearningContentTypeLabel,
  getLearningProgressStatusLabel,
  getMinutesLabel,
} from '@/lib/learningPresentation.js';
import { normalizeLearningRichBlocks } from '@/lib/learningRichContent.js';
import { getLearningSubtopicPath, getLearningTopicPath } from '@/lib/learningRoutes.js';
import {
  getSubscriptionNoAccessBodyKey,
  getSubscriptionNoAccessTitleKey,
} from '@/lib/subscriptionStatus.js';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import pb from '@/lib/pocketbaseClient.js';
import { toast } from 'sonner';

let pdfJsLoadPromise = null;

const loadPdfJs = async () => {
  if (!pdfJsLoadPromise) {
    pdfJsLoadPromise = import('pdfjs-dist').then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      return pdfjsLib;
    });
  }

  return pdfJsLoadPromise;
};

const getPreviewKindFromMime = (mimeType = '') => {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized.includes('pdf')) return 'pdf';
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  return 'unknown';
};

const getPreviewKindFromSource = (assetUrl = '', label = '') => {
  const cleanUrl = String(assetUrl || '').split('?')[0].split('#')[0].toLowerCase();
  const source = `${cleanUrl} ${String(label || '').toLowerCase()}`;
  if (cleanUrl.includes('/assets/video')) return 'video';
  if (cleanUrl.includes('/assets/pdf')) return 'pdf';
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(source)) return 'image';
  if (/\.(mp4|webm|ogg|mov|m4v)$/.test(source)) return 'video';
  if (/\.pdf$/.test(source) || source.includes('pdf')) return 'pdf';
  if (String(label).toLowerCase().includes('video')) return 'video';
  return 'unknown';
};

const isPdfBuffer = (buffer) => {
  const signature = new TextDecoder()
    .decode(new Uint8Array(buffer).slice(0, 5))
    .trim();
  return signature.startsWith('%PDF');
};

const wait = (milliseconds) => new Promise((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

const fetchAssetWithRetry = async (assetUrl) => {
  let lastError = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(assetUrl, { method: 'GET', cache: 'no-store' });
      if (response.ok) {
        return response;
      }

      lastError = new Error(`Asset preview failed (${response.status})`);
      if (![408, 409, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        throw lastError;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < 2) {
      await wait(350 * (attempt + 1));
    }
  }

  throw lastError || new Error('Asset preview failed');
};

const LearningPdfCanvasPreview = ({ fileData, label, t, className = '' }) => {
  const containerRef = useRef(null);
  const [renderState, setRenderState] = useState('loading');

  useEffect(() => {
    if (!fileData) return undefined;

    let cancelled = false;
    const renderTasks = [];
    const container = containerRef.current;
    if (!container) return undefined;

    container.innerHTML = '';
    setRenderState('loading');

    const renderPdf = async () => {
      try {
        const pdfjsLib = await loadPdfJs();
        const loadingTask = pdfjsLib.getDocument({
          data: fileData,
          disableAutoFetch: true,
          disableStream: true,
        });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const containerWidth = Math.max(320, container.clientWidth || 860);

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;

          const page = await pdf.getPage(pageNumber);
          const baseViewport = page.getViewport({ scale: 1 });
          const scale = Math.min(1.65, Math.max(0.72, (containerWidth - 40) / baseViewport.width));
          const viewport = page.getViewport({ scale });
          const pixelRatio = window.devicePixelRatio || 1;

          const pageShell = document.createElement('div');
          pageShell.className = 'mx-auto mb-5 max-w-full rounded-[8px] border border-black/10 bg-white p-3 shadow-sm';

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width * pixelRatio);
          canvas.height = Math.floor(viewport.height * pixelRatio);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.className = 'mx-auto block max-w-full';
          canvas.setAttribute('aria-label', `${label} page ${pageNumber}`);

          const context = canvas.getContext('2d');
          context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

          pageShell.appendChild(canvas);
          container.appendChild(pageShell);

          const renderTask = page.render({ canvasContext: context, viewport });
          renderTasks.push(renderTask);
          await renderTask.promise;
        }

        if (!cancelled) {
          setRenderState('ready');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to render learning PDF preview:', error);
          setRenderState('error');
        }
      }
    };

    renderPdf();

    return () => {
      cancelled = true;
      renderTasks.forEach((task) => task.cancel?.());
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [fileData, label]);

  if (renderState === 'error') {
    return (
      <div className="rounded-[8px] border border-dashed border-black/15 bg-slate-50 p-5 text-sm text-slate-500">
        {t('learning.preview_unavailable')}
      </div>
    );
  }

  return (
    <div
      className={`rounded-[8px] border border-black/10 bg-slate-100 p-3 ${className || 'max-h-[720px] overflow-y-auto'}`}
      onContextMenu={(event) => event.preventDefault()}
    >
      {renderState === 'loading' && (
        <div className="flex h-40 items-center justify-center text-sm text-slate-500">
          {t('common.loading')}
        </div>
      )}
      <div ref={containerRef} className={renderState === 'loading' ? 'hidden' : ''} />
    </div>
  );
};

const LearningAssetPreview = ({
  assetUrl,
  kind,
  label,
  t,
  onAssetRefresh,
  className = '',
}) => {
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [previewError, setPreviewError] = useState(false);
  const [resolvedKind, setResolvedKind] = useState(kind);
  const refreshAttemptedRef = useRef(false);

  useEffect(() => {
    refreshAttemptedRef.current = false;
  }, [assetUrl]);

  useEffect(() => {
    if (!assetUrl) {
      setPreviewUrl('');
      setPreviewData(null);
      setPreviewError(false);
      setResolvedKind(kind);
      return undefined;
    }

    let active = true;
    let objectUrl = '';

    const loadPreview = async () => {
      setPreviewError(false);
      setPreviewUrl('');
      setPreviewData(null);
      setResolvedKind(kind);

      try {
        const response = await fetchAssetWithRetry(assetUrl);
        const blob = await response.blob();
        let nextKind = kind === 'unknown' ? getPreviewKindFromMime(blob.type) : kind;
        if (nextKind === 'unknown') {
          nextKind = getPreviewKindFromSource(assetUrl, label);
        }

        if (nextKind === 'pdf') {
          const buffer = await blob.arrayBuffer();
          if (active) {
            setResolvedKind(nextKind);
            setPreviewData(new Uint8Array(buffer));
          }
          return;
        }

        if (nextKind === 'unknown') {
          const buffer = await blob.arrayBuffer();
          if (isPdfBuffer(buffer)) {
            if (active) {
              setResolvedKind('pdf');
              setPreviewData(new Uint8Array(buffer));
            }
            return;
          }
        }

        objectUrl = URL.createObjectURL(blob);
        if (active) {
          setResolvedKind(nextKind);
          setPreviewUrl(objectUrl);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch (error) {
        console.error('Failed to load learning asset preview:', error);
        if (active && typeof onAssetRefresh === 'function' && !refreshAttemptedRef.current) {
          refreshAttemptedRef.current = true;
          const refreshed = await onAssetRefresh();
          if (active && refreshed) {
            return;
          }
        }

        if (active) {
          setPreviewError(true);
        }
      }
    };

    loadPreview();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [assetUrl, kind, label, onAssetRefresh]);

  if (previewError || resolvedKind === 'unknown') {
    return (
      <div className="rounded-[8px] border border-dashed border-black/15 bg-slate-50 p-5 text-sm text-slate-500">
        {t('learning.preview_unavailable')}
      </div>
    );
  }

  if (!previewUrl && !previewData) {
    return (
      <div className={`flex items-center justify-center rounded-[8px] border border-black/10 bg-slate-50 text-sm text-slate-500 ${className || 'h-40'}`}>
        {t('common.loading')}
      </div>
    );
  }

  if (resolvedKind === 'pdf') {
    return (
      <LearningPdfCanvasPreview
        fileData={previewData}
        label={label}
        t={t}
        className={className}
      />
    );
  }

  if (resolvedKind === 'image') {
    return (
      <div className="overflow-hidden rounded-[8px] border border-black/10 bg-white">
        <img src={previewUrl} alt={label} className="max-h-[620px] w-full object-contain" />
      </div>
    );
  }

  return (
    <video
      controls
      controlsList="nodownload"
      disablePictureInPicture
      src={previewUrl}
      className={`w-full rounded-[8px] border border-black/10 bg-[#eef2ff] ${className || 'aspect-video'}`}
    />
  );
};

const LearningLessonPage = () => {
  const {
    lessonId,
    packageSlug,
    topicSlug,
    subtopicSlug,
  } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { t, language } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [accessDenied, setAccessDenied] = useState(null);

  const loadCurrentLesson = useCallback(async () => {
    const token = pb.authStore.token;
    const result = subtopicSlug
      ? await getLearningLessonBySlug({
        token,
        packageSlug,
        topicSlug,
        subtopicSlug,
      })
      : await getLearningLesson({ token, lessonId });

    return localizeLearningLessonPayload(result, language);
  }, [language, lessonId, packageSlug, subtopicSlug, topicSlug]);

  useEffect(() => {
    let active = true;

    const loadLesson = async () => {
      try {
        const result = await loadCurrentLesson();
        if (active) {
          setData(result);
          setAccessDenied(null);
        }
      } catch (error) {
        console.error('Failed to load learning lesson:', error);
        if (active && [401, 403].includes(error.status)) {
          setAccessDenied({
            packageSlug: error.data?.packageSlug || '',
            status: error.data?.subscription?.status || '',
          });
        } else {
          toast.error(error.message || t('learning.load_error'));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadLesson();

    return () => {
      active = false;
    };
  }, [loadCurrentLesson, t]);

  const refreshLearningLessonAssets = useCallback(async () => {
    try {
      const result = await loadCurrentLesson();
      setData(result);
      setAccessDenied(null);
      return true;
    } catch (error) {
      console.error('Failed to refresh learning asset URLs:', error);
      return false;
    }
  }, [loadCurrentLesson]);

  const saveProgress = async (status, progressPercentage) => {
    const token = pb.authStore.token;
    if (!token || !data?.viewer?.canSaveProgress) {
      navigate('/auth');
      return;
    }

    setSaving(true);
    try {
      const result = await updateLearningLessonProgress({
        token,
        lessonId: data.lesson.id,
        status,
        progressPercentage,
      });

      setData((current) => current ? {
        ...current,
        lesson: {
          ...current.lesson,
          progress: result.progress,
        },
      } : current);
      toast.success(t('learning.progress_saved'));
    } catch (error) {
      console.error('Failed to save lesson progress:', error);
      toast.error(error.message || t('learning.progress_save_error'));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!data?.viewer?.canSaveProgress || !data?.lesson?.id) {
      return;
    }

    const currentStatus = data.lesson.progress?.status || 'not_started';
    const currentPercentage = Number(data.lesson.progress?.progressPercentage || 0);
    const shouldAutoMark = currentStatus === 'not_started' || !data.lesson.progress?.lastOpenedAt;

    if (!shouldAutoMark || autoSaving) {
      return;
    }

    let active = true;
    const token = pb.authStore.token;

    const markOpened = async () => {
      if (!token) return;
      setAutoSaving(true);
      try {
        const result = await updateLearningLessonProgress({
          token,
          lessonId: data.lesson.id,
          status: currentStatus === 'completed' ? 'completed' : 'in_progress',
          progressPercentage: currentStatus === 'completed' ? 100 : Math.max(10, currentPercentage),
        });

        if (active) {
          setData((current) => current ? {
            ...current,
            lesson: {
              ...current.lesson,
              progress: result.progress,
            },
          } : current);
        }
      } catch (error) {
        console.error('Failed to auto-save lesson progress:', error);
      } finally {
        if (active) {
          setAutoSaving(false);
        }
      }
    };

    markOpened();

    return () => {
      active = false;
    };
  }, [autoSaving, data]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f7f7f7] text-slate-500">{t('common.loading')}</div>;
  }

  if (!data?.lesson) {
    if (accessDenied) {
      const noAccessTitle = t(getSubscriptionNoAccessTitleKey(accessDenied.status));
      const noAccessBody = t(getSubscriptionNoAccessBodyKey(accessDenied.status));

      return (
        <main className="learning-shell flex-1">
          <div className="container mx-auto px-4 py-16 sm:px-6 lg:px-8">
            <section className="learning-card mx-auto max-w-3xl p-8 text-center md:p-10">
              <Badge className="rounded-[8px] bg-[#0000FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0000FF] shadow-none">
                {t('learning.status_locked')}
              </Badge>
              <h1 className="mt-5 text-3xl font-bold text-slate-900">{noAccessTitle}</h1>
              <p className="mt-4 text-base leading-7 text-slate-600">{noAccessBody}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Button asChild className="h-11 rounded-[8px] bg-[#0000FF] px-6 text-white shadow-none hover:bg-[#0000CC]">
                  <Link to={accessDenied.packageSlug ? `/learning/subscribe/${accessDenied.packageSlug}` : '/learning'}>
                    {['expired', 'unpaid', 'paused'].includes(accessDenied.status) ? t('learning.subscribe_again') : t('learning.subscribe')}
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 rounded-[8px] border-black/10 bg-white px-6 text-slate-700 shadow-none hover:bg-slate-50">
                  <Link to={isAuthenticated ? '/profile' : '/auth'}>{isAuthenticated ? t('nav.profile') : t('nav.login')}</Link>
                </Button>
              </div>
            </section>
          </div>
        </main>
      );
    }

    return <div className="flex min-h-screen items-center justify-center bg-[#f7f7f7] text-slate-500">{t('learning.package_not_found')}</div>;
  }

  const attachments = Array.isArray(data.lesson.attachments) ? data.lesson.attachments : [];
  const videoAssetUrl = getLearningAssetUrl(data.lesson.videoAssetUrl);
  const pdfAssetUrl = getLearningAssetUrl(data.lesson.pdfAssetUrl);
  const downloadAssetUrl = getLearningAssetUrl(data.lesson.downloadAssetUrl);
  const hasVideo = Boolean(videoAssetUrl);
  const hasPdf = Boolean(pdfAssetUrl);
  const hasDownload = Boolean(downloadAssetUrl);
  const hasResources = hasPdf || hasDownload || attachments.length > 0;
  const hasTopMaterial = hasVideo || hasResources;
  const richContentBlocks = normalizeLearningRichBlocks(data.lesson.richContent, data.lesson.textContent)
    .filter((block) => block.type !== 'paragraph' || block.text.trim());
  const hasTextContent = richContentBlocks.length > 0;
  const contentTypeLabel = getLearningContentTypeLabel(t, data.lesson.contentType);

  const getPreviewKind = (assetUrl, label = '') => {
    return getPreviewKindFromSource(assetUrl, label);
  };

  const getPreviewIcon = (kind) => {
    if (kind === 'image') return ImageIcon;
    if (kind === 'video') return PlayCircle;
    return FileText;
  };

  const renderResourcePreview = ({ assetUrl, label }) => {
    if (!assetUrl) return null;

    const kind = getPreviewKind(assetUrl, label);
    const Icon = getPreviewIcon(kind);

    return (
      <article key={`${label}-${assetUrl}`} className="learning-inline-card overflow-hidden p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Icon className="size-4 text-[#0000FF]" />
          <span>{label}</span>
        </div>

        <LearningAssetPreview
          assetUrl={assetUrl}
          kind={kind}
          label={label}
          t={t}
          onAssetRefresh={refreshLearningLessonAssets}
        />
      </article>
    );
  };

  const renderResources = (isTop = false) => (
    <div className={`learning-subtle-card ${isTop ? '' : 'mt-8'} p-6`}>
      <h2 className="text-2xl font-semibold text-slate-900">{t('learning.resources')}</h2>
      <div className="mt-5 space-y-3">
        {hasPdf && (
          renderResourcePreview({ assetUrl: pdfAssetUrl, label: 'PDF' })
        )}
        {hasDownload && (
          renderResourcePreview({ assetUrl: downloadAssetUrl, label: t('learning.material_preview') })
        )}
        {attachments.map((item) => (
          renderResourcePreview({ assetUrl: getLearningAssetUrl(item.url), label: item.label })
        ))}
      </div>
    </div>
  );

  const shouldPreviewVideoAsset = getPreviewKind(videoAssetUrl, 'video') === 'video';

  return (
    <>
      <Helmet>
        <title>{`${data.lesson.title} - ${t('nav.learning')} - Zahnibörse`}</title>
        <meta name="robots" content="noindex,nofollow,noarchive" />
      </Helmet>

      <main className="learning-shell flex-1">
        <div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8 md:py-16">
          <nav className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-500" aria-label="Breadcrumb">
            <Link to="/learning/dashboard" className="transition-colors hover:text-[#0000FF]">
              {t('learning.dashboard')}
            </Link>
            <span aria-hidden="true">/</span>
            <Link to={getLearningTopicPath(data.package, data.module)} className="break-words transition-colors hover:text-[#0000FF]">
              {data.module?.title || t('learning.open_module')}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="break-words text-slate-900">{data.lesson.title}</span>
          </nav>

          <section className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.08fr)_360px] xl:grid-cols-[minmax(0,1.12fr)_380px]">
            <div className="learning-card p-6 md:p-8">
              {hasVideo && (
                <div className="learning-subtle-card overflow-hidden p-3">
                  <div className="overflow-hidden rounded-[8px] border border-black/6 bg-[#eef2ff]">
                    {data.lesson.videoPresentation === 'stream' || shouldPreviewVideoAsset ? (
                      <LearningAssetPreview
                        assetUrl={videoAssetUrl}
                        kind="video"
                        label={data.lesson.title}
                        t={t}
                        onAssetRefresh={refreshLearningLessonAssets}
                        className="aspect-video"
                      />
                    ) : (
                      <iframe
                        title={data.lesson.title}
                        src={videoAssetUrl}
                        className="aspect-video h-full w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    )}
                  </div>
                </div>
              )}

              {!hasVideo && hasResources && renderResources(true)}

              <div className={hasTopMaterial ? 'mt-8' : ''}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-[8px] bg-[#0000FF]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0000FF] shadow-none">
                    {contentTypeLabel}
                  </Badge>
                  <Badge className="rounded-[8px] bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
                    {getMinutesLabel(t, data.lesson.estimatedMinutes)}
                  </Badge>
                </div>
                <h1 className="mt-5 break-words text-3xl font-bold text-slate-900 md:text-4xl">{data.lesson.title}</h1>
                <div className="learning-subtle-card mt-6 p-5">
                  <h2 className="text-xl font-semibold text-slate-900">{t('learning.lesson_description')}</h2>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-[8px] bg-white p-3">
                      <dt className="font-semibold text-slate-900">{t('learning.formats_label')}</dt>
                      <dd className="mt-1 text-slate-600">{contentTypeLabel}</dd>
                    </div>
                    <div className="rounded-[8px] bg-white p-3">
                      <dt className="font-semibold text-slate-900">{t('learning.lesson_time')}</dt>
                      <dd className="mt-1 text-slate-600">{getMinutesLabel(t, data.lesson.estimatedMinutes)}</dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-base leading-7 text-slate-600">{data.lesson.description}</p>
                </div>
              </div>

              {hasVideo && hasResources && renderResources(false)}

              {hasTextContent && (
                <article className="mt-8 border-t border-black/10 pt-8">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">{t('learning.web_learning_page')}</p>
                      <h2 className="mt-2 text-2xl font-semibold text-slate-900">{t('learning.lesson_content')}</h2>
                    </div>
                    <Badge className="rounded-[8px] bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 shadow-none">
                      {richContentBlocks.length} {richContentBlocks.length === 1 ? t('learning.section_count_single') : t('learning.section_count_plural')}
                    </Badge>
                  </div>
                  <LearningRichContentRenderer className="mt-6" blocks={richContentBlocks} fallbackText={data.lesson.textContent} />
                </article>
              )}
            </div>

            <aside className="learning-card p-6 md:p-8 lg:sticky lg:top-[104px] lg:self-start">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0000FF]/75">{data.viewer?.isPreviewOnly ? t('learning.preview_label') : t('learning.progress')}</p>
              <div className="learning-subtle-card mt-4 p-5">
                <p className="text-sm text-slate-500">{t('learning.status_label')}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">
                  {data.viewer?.isPreviewOnly ? t('learning.preview_label') : getLearningProgressStatusLabel(t, data.lesson.progress?.status)}
                </p>
                {data.viewer?.canSaveProgress ? (
                  <>
                    <p className="mt-2 text-sm text-slate-500">{data.lesson.progress?.progressPercentage || 0}%</p>
                    <div className="learning-progress-track mt-4">
                      <div className="learning-progress-fill" style={{ width: `${data.lesson.progress?.progressPercentage || 0}%` }} />
                    </div>
                    <p className="mt-3 text-sm text-slate-500">{t('learning.progress_auto_saved')}</p>
                  </>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">{t('learning.preview_progress_hint')}</p>
                )}
              </div>

              {data.viewer?.canSaveProgress ? (
                <div className="mt-6 space-y-3">
                  <Button
                    type="button"
                    onClick={() => saveProgress('completed', 100)}
                    disabled={saving}
                    variant="outline"
                    className="h-11 w-full rounded-[8px] border-emerald-200 bg-emerald-50 text-emerald-700 shadow-none hover:bg-emerald-100"
                  >
                    <CheckCircle2 className="size-4" />
                    {t('learning.mark_complete')}
                  </Button>
                </div>
              ) : (
                <div className="mt-6 space-y-3">
                  <Button asChild className="h-auto min-h-11 w-full rounded-[8px] bg-[#0000FF] px-4 py-3 text-white shadow-none hover:bg-[#0000CC]">
                    <Link to={data.package?.slug ? `/learning/subscribe/${data.package.slug}` : '/learning'}>
                      {t('learning.subscribe')}
                    </Link>
                  </Button>
                  {!isAuthenticated && (
                    <Button asChild variant="outline" className="h-auto min-h-11 w-full rounded-[8px] border-black/10 bg-white px-4 py-3 text-slate-700 shadow-none hover:bg-slate-50">
                      <Link to="/auth">{t('nav.login')}</Link>
                    </Button>
                  )}
                </div>
              )}

              <div className="mt-8 space-y-3">
                {data.previousLesson && (
                  <Button asChild variant="outline" className="h-auto min-h-11 w-full rounded-[8px] border-black/10 bg-white px-4 py-3 text-slate-700 shadow-none hover:bg-slate-50">
                    <Link to={getLearningSubtopicPath(data.package, { slug: data.previousLesson.moduleSlug }, data.previousLesson)}>
                      <ArrowLeft className="size-4" />
                      <span className="whitespace-normal text-center">{t('learning.previous_lesson')}</span>
                    </Link>
                  </Button>
                )}
                {data.nextLesson && (
                  <Button asChild className="h-auto min-h-11 w-full rounded-[8px] bg-[#0000FF] px-4 py-3 text-white shadow-none hover:bg-[#0000CC]">
                    <Link to={getLearningSubtopicPath(data.package, { slug: data.nextLesson.moduleSlug }, data.nextLesson)}>
                      <span className="whitespace-normal text-center">{t('learning.next_lesson')}</span>
                      <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                )}
              </div>
            </aside>
          </section>
        </div>
      </main>
    </>
  );
};

export default LearningLessonPage;
