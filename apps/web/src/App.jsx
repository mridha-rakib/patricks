import React from 'react';
import { Route, Routes, BrowserRouter as Router } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner.jsx';
import { AuthProvider } from '@/contexts/AuthContext.jsx';
import { CartProvider } from '@/contexts/CartContext.jsx';
import { FavoritesProvider } from '@/contexts/FavoritesContext.jsx';
import { ShopVisibilityProvider } from '@/contexts/ShopVisibilityContext.jsx';
import { TranslationProvider } from '@/contexts/TranslationContext.jsx';
import ScrollToTop from './components/ScrollToTop.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import SellerRoute from './components/SellerRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';

import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';

import HomePage from './pages/HomePage.jsx';
import ShopPage from './pages/ShopPage.jsx';
import MarketplacePage from './pages/MarketplacePage.jsx';
import LearningLandingPage from './pages/LearningLandingPage.jsx';
import LearningPackageSelectorPage from './pages/LearningPackageSelectorPage.jsx';
import LearningPackagePage from './pages/LearningPackagePage.jsx';
import LearningCheckoutPage from './pages/LearningCheckoutPage.jsx';
import LearningDashboardPage from './pages/LearningDashboardPage.jsx';
import LearningModulePage from './pages/LearningModulePage.jsx';
import LearningLessonPage from './pages/LearningLessonPage.jsx';
import LearningSubscriptionPage from './pages/LearningSubscriptionPage.jsx';
import LearningAdminPage from './pages/LearningAdminPage.jsx';
import ProductDetailPage from './pages/ProductDetailPage.jsx';
import ReviewsPage from './pages/ReviewsPage.jsx';
import CartPage from './pages/CartPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import SuccessPage from './pages/SuccessPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import SellerDashboard from './pages/SellerDashboard.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import AdminFiltersPage from './pages/AdminFiltersPage.jsx';
import ProductVerificationAdminPage from './pages/ProductVerificationAdminPage.jsx';
import AuthPage from './pages/AuthPage.jsx';
import PasswordResetPage from './pages/PasswordResetPage.jsx';
import EmailVerificationPage from './pages/EmailVerificationPage.jsx';
import NewProductForm from './pages/NewProductForm.jsx';
import FavoritesPage from './pages/FavoritesPage.jsx';
import SellerInfoPage from './pages/SellerInfoPage.jsx';
import SellerProductsPage from './pages/SellerProductsPage.jsx';
import MyOrdersPage from './pages/MyOrdersPage.jsx';
import OrderDetailsPage from './pages/OrderDetailsPage.jsx';
import VerificationSuccess from './pages/VerificationSuccess.jsx';
import CheckoutCancelPage from './pages/CheckoutCancelPage.jsx';
import VerificationCancelPage from './pages/VerificationCancelPage.jsx';

// Static Pages
import ImpressumPage from './pages/ImpressumPage.jsx';
import DatenschutzPage from './pages/DatenschutzPage.jsx';
import AgbPage from './pages/AgbPage.jsx';
import WiderrufsbelehrungPage from './pages/WiderrufsbelehrungPage.jsx';
import WiderrufsformularPage from './pages/WiderrufsformularPage.jsx';
import FaqPage from './pages/FaqPage.jsx';
import HilfePage from './pages/HilfePage.jsx';
import AboutPage from './pages/AboutPage.jsx';
import ContactPage from './pages/ContactPage.jsx';

function App() {
  return (
    <Router>
      <TranslationProvider>
        <AuthProvider>
          <ShopVisibilityProvider>
            <CartProvider>
              <FavoritesProvider>
              <ScrollToTop />
              <div className="flex flex-col min-h-screen">
                <Header />
                <div className="pt-[64px] md:pt-[80px] flex-1 flex flex-col">
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/shop" element={<ShopPage />} />
                    <Route path="/marketplace" element={<MarketplacePage />} />
                    <Route path="/learning" element={<LearningLandingPage />} />
                    <Route path="/learning/abo" element={<LearningPackageSelectorPage />} />
                    <Route path="/learning/packages" element={<LearningPackageSelectorPage />} />
                    <Route path="/learning/packages/:slug" element={<LearningPackagePage />} />
                    <Route path="/learning/subscribe/:slug" element={<LearningCheckoutPage />} />
                    <Route path="/learning/topics/:packageSlug/:topicSlug" element={<LearningModulePage />} />
                    <Route path="/learning/topics/:packageSlug/:topicSlug/subtopics/:subtopicSlug" element={<LearningLessonPage />} />
                    <Route path="/learning/modules/:moduleId" element={<LearningModulePage />} />
                    <Route path="/learning/lessons/:lessonId" element={<LearningLessonPage />} />
                    <Route path="/product/:id" element={<ProductDetailPage />} />
                    <Route path="/reviews" element={<ReviewsPage />} />
                    <Route path="/auth" element={<AuthPage />} />
                    <Route path="/auth/reset-password" element={<PasswordResetPage />} />
                    <Route path="/reset-password" element={<PasswordResetPage />} />
                    <Route path="/auth/verify-email" element={<EmailVerificationPage />} />
                    <Route path="/verify-email" element={<EmailVerificationPage />} />
                    
                    {/* Static Pages */}
                    <Route path="/impressum" element={<ImpressumPage />} />
                    <Route path="/datenschutz" element={<DatenschutzPage />} />
                    <Route path="/agb" element={<AgbPage />} />
                    <Route path="/widerrufsbelehrung" element={<WiderrufsbelehrungPage />} />
                    <Route path="/widerrufsformular" element={<WiderrufsformularPage />} />
                    <Route path="/faq" element={<FaqPage />} />
                    <Route path="/hilfe" element={<HilfePage />} />
                    <Route path="/about" element={<AboutPage />} />
                    <Route path="/contact" element={<ContactPage />} />
                    
                    <Route path="/cart" element={
                      <ProtectedRoute>
                        <CartPage />
                      </ProtectedRoute>
                    } />
                    
                    <Route path="/checkout" element={
                      <ProtectedRoute>
                        <CheckoutPage />
                      </ProtectedRoute>
                    } />

                    <Route path="/success" element={
                      <ProtectedRoute>
                        <SuccessPage />
                      </ProtectedRoute>
                    } />

                    <Route path="/checkout-cancel" element={
                      <ProtectedRoute>
                        <CheckoutCancelPage />
                      </ProtectedRoute>
                    } />
                    
                    <Route path="/profile" element={
                      <ProtectedRoute>
                        <ProfilePage />
                      </ProtectedRoute>
                    } />

                    <Route path="/learning/dashboard" element={
                      <ProtectedRoute>
                        <LearningDashboardPage />
                      </ProtectedRoute>
                    } />
                    <Route path="/learning/subscription" element={
                      <ProtectedRoute>
                        <LearningSubscriptionPage />
                      </ProtectedRoute>
                    } />
                    
                    <Route path="/favorites" element={
                      <ProtectedRoute>
                        <FavoritesPage />
                      </ProtectedRoute>
                    } />

                    <Route path="/my-orders" element={
                      <ProtectedRoute>
                        <MyOrdersPage />
                      </ProtectedRoute>
                    } />

                    <Route path="/order-details/:orderId" element={
                      <ProtectedRoute>
                        <OrderDetailsPage />
                      </ProtectedRoute>
                    } />
                    
                    <Route path="/seller-info" element={
                      <ProtectedRoute>
                        <SellerInfoPage />
                      </ProtectedRoute>
                    } />
                    
                    <Route path="/seller-products" element={
                      <SellerRoute>
                        <SellerProductsPage />
                      </SellerRoute>
                    } />
                    
                    <Route path="/seller-dashboard" element={
                      <SellerRoute>
                        <SellerDashboard />
                      </SellerRoute>
                    } />

                    <Route path="/seller/new-product" element={
                      <SellerRoute>
                        <NewProductForm />
                      </SellerRoute>
                    } />

                    <Route path="/verification-success" element={
                      <SellerRoute>
                        <VerificationSuccess />
                      </SellerRoute>
                    } />

                    <Route path="/verification-cancel" element={
                      <SellerRoute>
                        <VerificationCancelPage />
                      </SellerRoute>
                    } />
                    
                    <Route path="/admin" element={
                      <AdminRoute>
                        <AdminDashboardPage />
                      </AdminRoute>
                    } />

                    <Route path="/admin/verifications" element={
                      <AdminRoute>
                        <div className="max-w-7xl mx-auto px-4 py-8 w-full">
                          <ProductVerificationAdminPage />
                        </div>
                      </AdminRoute>
                    } />

                    <Route path="/admin/learning" element={
                      <AdminRoute>
                        <LearningAdminPage />
                      </AdminRoute>
                    } />

                    <Route path="/admin/filters" element={
                      <AdminRoute>
                        <AdminFiltersPage />
                      </AdminRoute>
                    } />
                  </Routes>
                </div>
                <Footer />
              </div>
              <Toaster />
              </FavoritesProvider>
            </CartProvider>
          </ShopVisibilityProvider>
        </AuthProvider>
      </TranslationProvider>
    </Router>
  );
}

export default App;
