import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Search, Heart, ShoppingBag, LogIn, X, User, Trash2, Minus, Plus, Languages } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext.jsx';
import { useCart } from '@/contexts/CartContext.jsx';
import { useFavorites } from '@/contexts/FavoritesContext.jsx';
import { useShopVisibility } from '@/contexts/ShopVisibilityContext.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import pb from '@/lib/pocketbaseClient.js';
import apiServerClient from '@/lib/apiServerClient.js';
import { getProductImageUrl } from '@/lib/productImages.js';
import Logo from './Logo.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from 'sonner';

const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, isAuthenticated, isSeller, isAdmin, logout } = useAuth();
  const { cartItems, itemCount, removeFromCart, updateQuantity, getTotal } = useCart();
  const { t, language, setLanguage } = useTranslation();
  const { shopEnabled } = useShopVisibility();
  
  // CRITICAL FIX: Use FavoritesContext instead of manual API calls
  const { favorites, loading: favLoading, removeFromFavorites } = useFavorites();
  const favoritesCount = favorites.length;
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hoveredNavPath, setHoveredNavPath] = useState(null);
  const [navIndicator, setNavIndicator] = useState({ left: 0, width: 0, visible: false });
  
  // Modals state
  const [showCartModal, setShowCartModal] = useState(false);
  const [showFavModal, setShowFavModal] = useState(false);
  
  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef(null);
  const navItemRefs = useRef({});

  const showShopNavigation = shopEnabled;
  const navLinks = [
    { name: t('nav.home'), path: '/' },
    ...(showShopNavigation ? [{ name: t('nav.shop'), path: '/shop' }] : []),
    { name: t('nav.marketplace'), path: '/marketplace' },
    { name: t('nav.learning'), path: '/learning' },
  ];

  const currentLanguageName = language === 'DE' ? t('language.german') : t('language.english');
  const formatPrice = (value) =>
    new Intl.NumberFormat(language === 'DE' ? 'de-DE' : 'en-US', {
      style: 'currency',
      currency: 'EUR',
    }).format(Number(value || 0));

  const isActive = (path) => {
    if (path === '/') {
      return location.pathname === '/';
    }

    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  useEffect(() => {
    const updateNavIndicator = () => {
      const activePath = navLinks.find((link) => isActive(link.path))?.path;
      const targetPath = hoveredNavPath || activePath;
      const targetNode = targetPath ? navItemRefs.current[targetPath] : null;

      if (!targetNode) {
        setNavIndicator((current) => (
          current.visible ? { ...current, visible: false } : current
        ));
        return;
      }

      const horizontalInset = 10;
      setNavIndicator({
        left: targetNode.offsetLeft + horizontalInset,
        width: Math.max(targetNode.offsetWidth - horizontalInset * 2, 16),
        visible: true,
      });
    };

    updateNavIndicator();
    window.addEventListener('resize', updateNavIndicator);
    return () => window.removeEventListener('resize', updateNavIndicator);
  }, [hoveredNavPath, location.pathname, language, showShopNavigation]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleLogout = () => {
    logout();
    setDropdownOpen(false);
    navigate('/');
  };

  // Handle Search
  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchTerm.trim().length > 1) {
        setIsSearching(true);
        try {
          const response = await apiServerClient.fetch(`/search?query=${encodeURIComponent(searchTerm)}`);
          const data = await response.json();
          setSearchResults(data.items || []);
          setShowSearchResults(true);
        } catch (error) {
          console.error('Search error:', error);
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
        setShowSearchResults(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm]);

  // Close search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-close dropdown on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (dropdownOpen) setDropdownOpen(false);
      if (showSearchResults) setShowSearchResults(false);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [dropdownOpen, showSearchResults]);

  const getInitial = () => {
    if (currentUser?.name && currentUser.name.trim().length > 0) {
      return currentUser.name.charAt(0).toUpperCase();
    }
    return <User size={18} />;
  };

  const handleCartClick = (e) => {
    if (isMobile) {
      e.preventDefault();
      setShowCartModal(true);
    }
  };

  const handleFavClick = (e) => {
    if (isMobile) {
      e.preventDefault();
      if (!isAuthenticated) {
        navigate('/auth');
      } else {
        setShowFavModal(true);
      }
    }
  };

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 h-[64px] md:h-[80px] border-b border-[hsl(var(--border))] bg-white/95 backdrop-blur transition-all duration-300">
        <div className="max-w-[1440px] mx-auto h-full px-4 md:px-6 xl:px-8 flex items-center justify-between">
          
          {/* LEFT: Mobile Hamburger & Desktop Nav */}
          <div className="flex items-center flex-1">
            <div className="md:hidden flex items-center">
              <button 
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="text-[hsl(var(--foreground))] hover:text-[#0000FF] transition-all duration-150 p-2 -ml-2"
                aria-label={t('nav.menu')}
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
            
            <nav
              className="relative hidden md:flex items-center gap-5 rounded-[8px] bg-white/95 px-1"
              onMouseLeave={() => setHoveredNavPath(null)}
            >
              <span
                className={`absolute bottom-0 h-[2px] rounded-full bg-[#0000FF] transition-all duration-300 ease-out ${
                  navIndicator.visible ? 'opacity-100' : 'opacity-0'
                }`}
                style={{
                  left: `${navIndicator.left}px`,
                  width: `${navIndicator.width}px`,
                }}
                aria-hidden="true"
              />
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  ref={(node) => {
                    navItemRefs.current[link.path] = node;
                  }}
                  to={link.path}
                  onMouseEnter={() => setHoveredNavPath(link.path)}
                  className={`relative z-10 rounded-[8px] px-1 py-2 text-[14px] font-semibold transition-colors duration-200 ${
                    isActive(link.path) 
                      ? 'text-[#0000FF]' 
                      : 'text-[hsl(var(--secondary-text))] hover:text-[#0000FF]'
                  }`}
                >
                  {link.name}
                </Link>
              ))}
            </nav>
          </div>

          {/* CENTER: Logo */}
          <div className="flex-shrink-0 absolute left-1/2 -translate-x-1/2 md:static md:translate-x-0 md:px-5">
            <Logo size={isMobile ? "sm" : "md"} color="#0000FF" />
          </div>

          {/* RIGHT: Actions */}
          <div className="flex items-center justify-end gap-2 md:gap-3 flex-1">
            
            {/* Desktop Search */}
            <div className="hidden xl:flex relative group" ref={searchRef}>
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={16} className="text-[hsl(var(--secondary-text))]" />
              </div>
              <input
                type="text"
                placeholder={t('search.placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onFocus={() => { if (searchTerm.length > 1) setShowSearchResults(true); }}
                className="w-[250px] 2xl:w-[300px] h-10 pl-9 pr-4 rounded-[8px] bg-[hsl(var(--muted-bg))] border border-[hsl(var(--border))] text-[14px] text-[hsl(var(--foreground))] placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-[#0000FF] focus:ring-2 focus:ring-blue-100 transition-all duration-200"
              />
              
              {/* Search Results Dropdown */}
              {showSearchResults && (
                <div className="absolute top-full mt-2 right-0 w-[340px] bg-white border border-[hsl(var(--border))] rounded-[8px] overflow-hidden z-50">
                  {isSearching ? (
                    <div className="p-4 text-center text-sm text-gray-500">{t('search.loading')}</div>
                  ) : searchResults.length > 0 ? (
                    <div className="max-h-[300px] overflow-y-auto">
                      {searchResults.map((product) => (
                        <Link 
                          key={product.id} 
                          to={`/product/${product.id}${product.source === 'shop' ? '?type=shop' : ''}`}
                          onClick={() => { setShowSearchResults(false); setSearchTerm(''); }}
                          className="flex items-center gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors"
                        >
                          <div className="w-10 h-10 bg-gray-100 rounded overflow-hidden shrink-0">
                            {getProductImageUrl(product) ? (
                              <img src={getProductImageUrl(product)} alt={product.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">{t('image.placeholder')}</div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                            <p className="text-xs text-[#0000FF] font-semibold">{formatPrice(product.price)}</p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-sm text-gray-500">{t('search.empty')}</div>
                  )}
                </div>
              )}
            </div>

            {/* Icons */}
            <div className="flex items-center gap-1.5 md:gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="hidden h-10 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-semibold text-[hsl(var(--secondary-text))] transition-colors hover:bg-blue-50 hover:text-[#0000FF] focus:outline-none focus:ring-2 focus:ring-blue-100 md:flex"
                  aria-label={t('footer.language')}
                >
                  <Languages size={17} />
                  <span>{currentLanguageName}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36 rounded-[8px] border border-[hsl(var(--border))] bg-white p-1">
                  <DropdownMenuItem
                    onClick={() => setLanguage('EN')}
                    className="cursor-pointer rounded-md font-medium focus:bg-blue-50"
                  >
                    {t('language.english')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setLanguage('DE')}
                    className="cursor-pointer rounded-md font-medium focus:bg-blue-50"
                  >
                    {t('language.german')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Link 
                to="/favorites" 
                onClick={handleFavClick}
                className="relative flex h-10 w-10 items-center justify-center rounded-[8px] text-[hsl(var(--secondary-text))] hover:bg-blue-50 hover:text-[#0000FF] transition-all duration-150" 
                aria-label={t('favorites.title')}
              >
                <Heart size={21} strokeWidth={1.7} className={favoritesCount > 0 ? "fill-[#0000FF] text-[#0000FF]" : ""} />
                {favoritesCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-[#0000FF] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {favoritesCount}
                  </span>
                )}
              </Link>

              <Link 
                to="/cart" 
                onClick={handleCartClick}
                className="relative flex h-10 w-10 items-center justify-center rounded-[8px] text-[hsl(var(--secondary-text))] hover:bg-blue-50 hover:text-[#0000FF] transition-all duration-150" 
                aria-label={t('cart.title')}
              >
                <ShoppingBag size={21} strokeWidth={1.7} />
                {itemCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-[#0000FF] text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {itemCount}
                  </span>
                )}
              </Link>
            </div>

            {/* Auth / Profile */}
            <div className="hidden md:flex items-center pl-1">
              {isAuthenticated ? (
                <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                  <DropdownMenuTrigger className="focus:outline-none">
                    <Avatar className="h-10 w-10 border border-[hsl(var(--border))] bg-white hover:border-[#0000FF] transition-all duration-150 cursor-pointer">
                      <AvatarImage
                        src={currentUser?.avatar ? pb.files.getUrl(currentUser, currentUser.avatar, { thumb: '96x96' }) : ''}
                        alt={currentUser?.name || currentUser?.email || 'Profile'}
                      />
                      <AvatarFallback className="bg-blue-50 text-[#0000FF] font-medium flex items-center justify-center">
                        {getInitial()}
                      </AvatarFallback>
                    </Avatar>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-white border border-gray-200 rounded-[8px] p-1">
                    <div className="px-2 py-2 text-sm font-medium text-gray-900 border-b border-gray-100 mb-1">
                      {currentUser?.name || currentUser?.email}
                    </div>
                    
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-gray-50 rounded-md focus:bg-gray-50">
                      <Link to="/profile" onClick={() => setDropdownOpen(false)} className="w-full text-gray-700">{t('nav.profile')}</Link>
                    </DropdownMenuItem>
                    
                    {!isAdmin && (
                      <DropdownMenuItem asChild className="cursor-pointer hover:bg-gray-50 rounded-md focus:bg-gray-50">
                        <Link to="/my-orders" onClick={() => setDropdownOpen(false)} className="w-full text-gray-700">{t('nav.orders')}</Link>
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-gray-50 rounded-md focus:bg-gray-50">
                      <Link to="/learning/dashboard" onClick={() => setDropdownOpen(false)} className="w-full text-gray-700">{t('learning.dashboard')}</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="cursor-pointer hover:bg-gray-50 rounded-md focus:bg-gray-50">
                      <Link to="/learning/subscription" onClick={() => setDropdownOpen(false)} className="w-full text-gray-700">{t('learning.my_subscription')}</Link>
                    </DropdownMenuItem>
                    
                    {isSeller && (
                      <DropdownMenuItem asChild className="cursor-pointer hover:bg-gray-50 rounded-md focus:bg-gray-50">
                        <Link to="/seller-products" onClick={() => setDropdownOpen(false)} className="w-full text-gray-700">{t('nav.seller_items')}</Link>
                      </DropdownMenuItem>
                    )}
                    
                    {isAdmin && (
                      <DropdownMenuItem asChild className="cursor-pointer hover:bg-gray-50 rounded-md focus:bg-gray-50">
                        <Link to="/admin" onClick={() => setDropdownOpen(false)} className="w-full text-gray-700">{t('nav.admin')}</Link>
                      </DropdownMenuItem>
                    )}
                    {isAdmin && (
                      <DropdownMenuItem asChild className="cursor-pointer hover:bg-gray-50 rounded-md focus:bg-gray-50">
                        <Link to="/admin/learning" onClick={() => setDropdownOpen(false)} className="w-full text-gray-700">{t('learning.admin_title')}</Link>
                      </DropdownMenuItem>
                    )}
                    {isAdmin && (
                      <DropdownMenuItem asChild className="cursor-pointer hover:bg-gray-50 rounded-md focus:bg-gray-50">
                        <Link to="/admin/filters" onClick={() => setDropdownOpen(false)} className="w-full text-gray-700">
                          {language === 'EN' ? 'Shop filters' : 'Shop-Filter'}
                        </Link>
                      </DropdownMenuItem>
                    )}
                    
                    <DropdownMenuSeparator className="bg-gray-100 my-1" />
                    <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600 hover:bg-red-50 hover:text-red-700 focus:bg-red-50 focus:text-red-700 rounded-md">
                      {t('nav.logout')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Link 
                  to="/auth" 
                  className="flex min-h-10 min-w-[104px] items-center justify-center gap-2 whitespace-nowrap rounded-[8px] bg-[#0000FF] px-4 lg:px-5 py-2 text-[13px] lg:text-[14px] font-semibold text-white hover:bg-[#0000CC] transition-all duration-150"
                >
                  <LogIn size={16} />
                  <span className="whitespace-nowrap">{t('nav.login')}</span>
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-[64px] left-0 right-0 max-h-[calc(100vh-64px)] overflow-y-auto border-b border-[hsl(var(--border))] bg-white px-4 py-4">
            <div className="relative mb-2">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search size={16} className="text-[hsl(var(--secondary-text))]" />
              </div>
              <input
                type="text"
                placeholder={t('search.placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-[44px] pl-9 pr-4 rounded-[8px] bg-[hsl(var(--muted-bg))] border border-[hsl(var(--border))] text-[16px] focus:outline-none focus:bg-white focus:border-[#0000FF] focus:ring-2 focus:ring-blue-100"
              />
              {/* Mobile Search Results */}
              {showSearchResults && searchResults.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-[hsl(var(--border))] rounded-[8px] overflow-hidden z-50 max-h-[250px] overflow-y-auto">
                  {searchResults.map((product) => (
                    <Link 
                      key={product.id} 
                      to={`/product/${product.id}${product.source === 'shop' ? '?type=shop' : ''}`}
                      onClick={() => { setShowSearchResults(false); setSearchTerm(''); setIsMobileMenuOpen(false); }}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                    >
                      <div className="w-10 h-10 bg-gray-100 rounded overflow-hidden shrink-0">
                        {getProductImageUrl(product) && <img src={getProductImageUrl(product)} alt={product.name} className="w-full h-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 grid gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={`rounded-[8px] px-3.5 py-3 text-[16px] font-semibold transition-colors ${
                    isActive(link.path) 
                      ? 'bg-[#0000FF] text-white' 
                      : 'bg-[hsl(var(--muted-bg))] text-[hsl(var(--foreground))] hover:bg-blue-50 hover:text-[#0000FF]'
                  }`}
                >
                  {link.name}
                </Link>
              ))}
            </div>
            
            <div className="mt-4 pt-4 border-t border-[hsl(var(--border))]">
              <div className="flex items-center justify-between gap-3 rounded-[8px] bg-[hsl(var(--muted-bg))] px-3.5 py-3 text-[hsl(var(--secondary-text))]">
                <div className="flex items-center gap-2">
                  <Languages size={16} />
                  <span className="text-[15px] font-semibold">{t('footer.language')}</span>
                </div>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="bg-transparent border-none text-[16px] font-semibold focus:outline-none cursor-pointer"
                  aria-label={t('footer.language')}
                >
                  <option value="DE" className="text-black">{t('language.german')}</option>
                  <option value="EN" className="text-black">{t('language.english')}</option>
                </select>
              </div>

              {isAuthenticated ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-3 my-4 rounded-[8px] border border-[hsl(var(--border))] bg-white p-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage
                        src={currentUser?.avatar ? pb.files.getUrl(currentUser, currentUser.avatar, { thumb: '96x96' }) : ''}
                        alt={currentUser?.name || currentUser?.email || 'Profile'}
                      />
                      <AvatarFallback className="bg-blue-50 text-[#0000FF] flex items-center justify-center">
                        {getInitial()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{currentUser?.name || currentUser?.email}</span>
                  </div>
                  <Link to="/profile" onClick={() => setIsMobileMenuOpen(false)} className="rounded-[8px] px-3.5 py-3 text-[16px] font-medium hover:bg-[hsl(var(--muted-bg))]">{t('nav.profile')}</Link>
                  {!isAdmin && <Link to="/my-orders" onClick={() => setIsMobileMenuOpen(false)} className="rounded-[8px] px-3.5 py-3 text-[16px] font-medium hover:bg-[hsl(var(--muted-bg))]">{t('nav.orders')}</Link>}
                  <Link to="/learning/dashboard" onClick={() => setIsMobileMenuOpen(false)} className="rounded-[8px] px-3.5 py-3 text-[16px] font-medium hover:bg-[hsl(var(--muted-bg))]">{t('learning.dashboard')}</Link>
                  <Link to="/learning/subscription" onClick={() => setIsMobileMenuOpen(false)} className="rounded-[8px] px-3.5 py-3 text-[16px] font-medium hover:bg-[hsl(var(--muted-bg))]">{t('learning.my_subscription')}</Link>
                  {isSeller && <Link to="/seller-products" onClick={() => setIsMobileMenuOpen(false)} className="rounded-[8px] px-3.5 py-3 text-[16px] font-medium hover:bg-[hsl(var(--muted-bg))]">{t('nav.seller_items')}</Link>}
                  {isAdmin && <Link to="/admin" onClick={() => setIsMobileMenuOpen(false)} className="rounded-[8px] px-3.5 py-3 text-[16px] font-medium hover:bg-[hsl(var(--muted-bg))]">{t('nav.admin')}</Link>}
                  {isAdmin && <Link to="/admin/learning" onClick={() => setIsMobileMenuOpen(false)} className="rounded-[8px] px-3.5 py-3 text-[16px] font-medium hover:bg-[hsl(var(--muted-bg))]">{t('learning.admin_title')}</Link>}
                  {isAdmin && <Link to="/admin/filters" onClick={() => setIsMobileMenuOpen(false)} className="rounded-[8px] px-3.5 py-3 text-[16px] font-medium hover:bg-[hsl(var(--muted-bg))]">{language === 'EN' ? 'Shop filters' : 'Shop-Filter'}</Link>}
                  <button onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }} className="rounded-[8px] px-3.5 py-3 text-left text-[16px] font-medium text-red-600 hover:bg-red-50">{t('nav.logout')}</button>
                </div>
              ) : (
                <Link 
                  to="/auth" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="mt-4 flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-[8px] bg-[#0000FF] px-5 py-3 text-[16px] font-semibold text-white"
                >
                  <LogIn size={18} />
                  <span className="whitespace-nowrap">{t('nav.login')}</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Mobile Cart Modal */}
      <Dialog open={showCartModal} onOpenChange={setShowCartModal}>
        <DialogContent className="w-[95vw] max-w-md rounded-[8px] p-0 overflow-hidden bg-white flex flex-col max-h-[85vh]">
          <DialogHeader className="p-4 border-b border-gray-100">
            <DialogTitle className="text-xl font-['Playfair_Display']">{t('cart.title')}</DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {cartItems.length === 0 ? (
              <div className="text-center py-8">
                <ShoppingBag className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                <p className="text-gray-500">{t('cart.empty_title')}</p>
              </div>
            ) : (
              cartItems.map((item) => {
                const isMarketplaceItem = item.product_type !== 'shop';
                const stockLimit = isMarketplaceItem
                  ? 1
                  : Math.max(1, Math.floor(Number(item.product?.stock_quantity ?? item.product?.stockQuantity ?? item.product?.stock ?? 1) || 1));

                return (
                <div key={item.id} className="flex gap-3 bg-gray-50 p-3 rounded-[8px]">
                  <div className="w-20 h-20 bg-white rounded-lg overflow-hidden flex-shrink-0 border border-gray-100">
                    {getProductImageUrl(item.product) && (
                      <img src={getProductImageUrl(item.product)} alt={item.product.name} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <h3 className="font-medium text-sm line-clamp-2 leading-tight">{item.product?.name}</h3>
                      <p className="text-xs text-gray-500 mt-1">{formatPrice(item.product?.price)}</p>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {isMarketplaceItem ? (
                        <span className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600">
                          {t('common.quantity')}: 1
                        </span>
                      ) : (
                        <div className="flex items-center gap-1 bg-white rounded-md border border-gray-200">
                          <button onClick={() => updateQuantity(item.id, item.product_id, item.quantity - 1)} disabled={item.quantity <= 1} className="p-1 text-gray-500 disabled:opacity-50">
                            <Minus size={14} />
                          </button>
                          <span className="text-xs font-medium w-6 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, item.product_id, item.quantity + 1)}
                            disabled={item.quantity >= stockLimit}
                            className="p-1 text-gray-500 disabled:opacity-50"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      )}
                      <button onClick={() => removeFromCart(item.id, item.product_id)} className="text-red-500 p-1">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                );
              })
            )}
          </div>
          
          {cartItems.length > 0 && (
            <div className="p-4 border-t border-gray-100 bg-gray-50">
              <div className="flex justify-between items-center mb-4">
                <span className="font-medium">{t('common.total')}</span>
                <span className="font-bold text-lg text-[#0000FF]">{formatPrice(getTotal())}</span>
              </div>
              <Button 
                className="w-full bg-[#0000FF] hover:bg-[#0000CC] text-white min-h-[44px]"
                onClick={() => { setShowCartModal(false); navigate('/checkout'); }}
              >
                {t('cart.checkout')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Mobile Favorites Modal */}
      <Dialog open={showFavModal} onOpenChange={setShowFavModal}>
        <DialogContent className="w-[95vw] max-w-md rounded-[8px] p-0 overflow-hidden bg-white flex flex-col max-h-[85vh]">
          <DialogHeader className="p-4 border-b border-gray-100">
            <DialogTitle className="text-xl font-['Playfair_Display']">{t('favorites.title')}</DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {favLoading ? (
              <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>
            ) : favorites.length === 0 ? (
              <div className="text-center py-8">
                <Heart className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                <p className="text-gray-500">{t('favorites.empty')}</p>
              </div>
            ) : (
              favorites.map((fav) => {
                const product = fav.expand?.product_id || fav.product;
                if (!product) return null;
                return (
                  <div key={fav.id} className="flex gap-3 bg-gray-50 p-3 rounded-[8px] relative">
                    <div className="w-20 h-20 bg-white rounded-lg overflow-hidden flex-shrink-0 border border-gray-100">
                      {getProductImageUrl(product) && (
                        <img src={getProductImageUrl(product)} alt={product.name} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between pr-6">
                      <div>
                        <h3 className="font-medium text-sm line-clamp-2 leading-tight">{product.name}</h3>
                        <p className="text-sm font-bold text-[#0000FF] mt-1">{formatPrice(product.price)}</p>
                      </div>
                      <Button 
                        size="sm" 
                        className="w-full mt-2 bg-white text-black border border-gray-200 hover:bg-gray-100 h-8 text-xs"
                        onClick={() => { setShowFavModal(false); navigate(`/product/${product.id}`); }}
                      >
                        {t('common.view')}
                      </Button>
                    </div>
                    <button 
                      onClick={() => {
                        removeFromFavorites(product.id);
                        toast.success(t('common.remove_favorite'));
                      }} 
                      className="absolute top-3 right-3 text-gray-400 hover:text-red-500"
                    >
                      <X size={18} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Header;
