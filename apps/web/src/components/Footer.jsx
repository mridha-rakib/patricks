import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Facebook, Instagram, Twitter, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import { subscribeToNewsletter } from '@/lib/newsletterApi.js';
import Logo from './Logo.jsx';

const defaultFooterContent = {
  // Public footer content can be edited in public/footer-content.json.
  // Keep empty arrays when a section should not show placeholder links.
  socialLinks: [],
  legalLinks: [
    { labelKey: 'footer.impressum', href: '/impressum' },
    { labelKey: 'footer.privacy', href: '/datenschutz' },
    { labelKey: 'footer.terms', href: '/agb' },
    { labelKey: 'footer.revocation', href: '/widerrufsbelehrung' },
    { labelKey: 'footer.revocation_form', href: '/widerrufsformular' },
  ],
  supportLinks: [
    { labelKey: 'footer.faq', href: '/faq' },
    { labelKey: 'footer.contact', href: '/contact' },
    { labelKey: 'footer.shipping', href: '/hilfe' },
    { labelKey: 'footer.about', href: '/about' },
  ],
};

const socialIcons = {
  Instagram,
  Facebook,
  Twitter,
};

const resolveFooterLabel = (item, language, t) => item?.[`label${language}`] || item?.label || (item?.labelKey ? t(item.labelKey) : '');

const Footer = () => {
  const location = useLocation();
  const {
    currentUser
  } = useAuth();
  const {
    t,
    language,
    setLanguage
  } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [footerContent, setFooterContent] = useState(defaultFooterContent);

  useEffect(() => {
    let active = true;

    fetch('/footer-content.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active || !data || typeof data !== 'object') return;
        setFooterContent({
          socialLinks: Array.isArray(data.socialLinks) ? data.socialLinks : defaultFooterContent.socialLinks,
          legalLinks: Array.isArray(data.legalLinks) ? data.legalLinks : defaultFooterContent.legalLinks,
          supportLinks: Array.isArray(data.supportLinks) ? data.supportLinks : defaultFooterContent.supportLinks,
        });
      })
      .catch(() => {
        if (active) setFooterContent(defaultFooterContent);
      });

    return () => {
      active = false;
    };
  }, []);

  if (location.pathname === '/auth') {
    return null;
  }

  const handleNewsletterSignup = async e => {
    e.preventDefault();
    const targetEmail = currentUser ? currentUser.email : email;
    if (!targetEmail) return;
    setLoading(true);
    try {
      await subscribeToNewsletter({
        email: targetEmail,
        fallbackMessage: t('footer.newsletter_error'),
      });
      toast.success(t('footer.newsletter_success'));
      setEmail('');
    } catch (error) {
      console.error('Newsletter error:', error);
      toast.error(t('footer.newsletter_error'));
    } finally {
      setLoading(false);
    }
  };
  return <footer className="bg-[#333333] text-[#ffffff] pt-[80px] pb-[40px] mt-auto">
      <div className="max-w-[1280px] mx-auto px-[16px] md:px-[24px] lg:px-[32px]">
        
        {/* Footer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-[48px] mb-[64px]">
          
          {/* Column 1: Branding */}
          <div className="flex flex-col">
            <div className="mb-[24px]">
              <Logo size="md" color="#ffffff" className="font-['Playfair_Display'] font-bold text-[30px] tracking-[-0.025em]" />
            </div>
            <p className="font-['Inter'] text-[14px] font-normal text-[#9ca3af] leading-[1.6] max-w-[288px] mb-[24px]">
              {t('brand.tagline')}
            </p>
            {footerContent.socialLinks.length > 0 && (
              <div className="flex items-center gap-[16px] mt-[8px]">
                {footerContent.socialLinks.map((item) => {
                  const Icon = socialIcons[item.label] || Globe;
                  return (
                    <a key={`${item.label}-${item.url}`} href={item.url} target="_blank" rel="noopener noreferrer" aria-label={item.label} className="text-[#9ca3af] hover:text-[#0000FF] transition-all duration-150">
                      <Icon size={20} />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Column 2: Rechtliches */}
          <div className="flex flex-col">
            <h3 className="font-['Playfair_Display'] font-semibold text-[18px] text-[#ffffff] mb-[24px]">
              {t('footer.legal')}
            </h3>
            <nav className="flex flex-col gap-[12px]">
              {footerContent.legalLinks.map((item) => (
                <Link key={`${item.href}-${item.labelKey || item.label}`} to={item.href} className="font-['Inter'] text-[14px] text-[#9ca3af] hover:text-[#0000FF] transition-all duration-150">
                  {resolveFooterLabel(item, language, t)}
                </Link>
              ))}
            </nav>
          </div>

          {/* Column 3: Hilfe & Support */}
          <div className="flex flex-col">
            <h3 className="font-['Playfair_Display'] font-semibold text-[18px] text-[#ffffff] mb-[24px]">
              {t('footer.support')}
            </h3>
            <nav className="flex flex-col gap-[12px]">
              {footerContent.supportLinks.map((item) => (
                <Link key={`${item.href}-${item.labelKey || item.label}`} to={item.href} className="font-['Inter'] text-[14px] text-[#9ca3af] hover:text-[#0000FF] transition-all duration-150">
                  {resolveFooterLabel(item, language, t)}
                </Link>
              ))}
            </nav>
          </div>

          {/* Column 4: Newsletter */}
          <div className="flex flex-col">
            <h3 className="font-['Playfair_Display'] font-semibold text-[18px] text-[#ffffff] mb-[24px]">
              {t('footer.newsletter')}
            </h3>
            <p className="font-['Inter'] text-[14px] text-[#9ca3af] mb-[16px]">
              {t('footer.newsletter_desc')}
            </p>
            <form onSubmit={handleNewsletterSignup} className="flex flex-col gap-[12px]">
              {!currentUser && <input type="email" placeholder={t('footer.email_placeholder')} value={email} onChange={e => setEmail(e.target.value)} required aria-label={t('footer.email_label')} className="w-full bg-[#444444] border-none text-[#ffffff] placeholder:text-[#6b7280] rounded-[8px] px-[14px] py-[10px] font-['Inter'] text-[14px] focus:outline-none focus:ring-2 focus:ring-[#0000FF] transition-all duration-150 min-h-[44px]" />}
              <button type="submit" disabled={loading} className="w-full bg-[#0000FF] text-[#ffffff] font-['Inter'] font-medium text-[14px] rounded-[8px] px-[16px] py-[10px] hover:bg-[#0000CC] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]">
                {loading ? t('footer.subscribing') : currentUser ? t('footer.subscribe_current') : t('footer.subscribe')}
              </button>
            </form>
          </div>

        </div>

        {/* Footer Bottom */}
        <div className="border-t border-[#374151] pt-[32px] flex flex-col lg:flex-row justify-between items-center gap-[16px]">
          <p className="font-['Inter'] text-[14px] text-[#6b7280] text-center lg:text-left">
            © {new Date().getFullYear()} Zahnibörse. {t('footer.rights')}
          </p>
          
          <div className="flex items-center gap-2 text-[#9ca3af]">
            <Globe size={16} />
            <select value={language} onChange={e => setLanguage(e.target.value)} className="bg-transparent border-none text-[14px] font-['Inter'] focus:outline-none cursor-pointer hover:text-white transition-colors" aria-label={t('footer.language')}>
              <option value="DE" className="text-black">{t('language.german')}</option>
              <option value="EN" className="text-black">{t('language.english')}</option>
            </select>
          </div>
        </div>

      </div>
    </footer>;
};
export default Footer;
