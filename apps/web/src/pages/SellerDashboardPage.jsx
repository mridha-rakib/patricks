import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import { Edit, Trash2, Eye, Package, ShoppingBag, DollarSign, Plus, Download } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext.jsx';
import pb from '@/lib/pocketbaseClient.js';
import apiServerClient from '@/lib/apiServerClient.js';
import {
  buildOrderFromLabelError,
  buildOrderFromLabelResponse,
  canGenerateOrderLabel,
  downloadBase64Pdf,
  downloadBlob,
  getOrderLabelIssue,
  getOrderLabelStatus,
  getOrderLabelText,
  getOrderTrackingNumber,
  hasOrderLabel,
} from '@/lib/dhlLabelUi.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { toast } from 'sonner';

const SellerDashboardPage = () => {
  const { currentUser } = useAuth();
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generatingLabel, setGeneratingLabel] = useState(null);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');

  const parseOrderAddress = (raw) => {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      let filterStr = `seller_id="${currentUser.id}"`;
      if (statusFilter !== 'all') {
        filterStr += ` && status="${statusFilter}"`;
      }

      const result = await pb.collection('products').getList(page, 10, {
        filter: filterStr,
        sort: '-created',
        $autoCancel: false
      });

      setProducts(result.items);
      setTotalPages(result.totalPages);
    } catch (error) {
      console.error('Error fetching products:', error);
      toast.error('Fehler beim Laden der Produkte');
    } finally {
      setLoading(false);
    }
  }, [currentUser.id, page, statusFilter]);

  const fetchOrders = useCallback(async () => {
    try {
      const result = await pb.collection('orders').getFullList({
        filter: `seller_id="${currentUser.id}"`,
        sort: '-created',
        $autoCancel: false
      });

      const productIds = [...new Set(result.map(o => o.product_id).filter(Boolean))];

      let productMap = {};
      if (productIds.length > 0) {
        const productFilter = productIds.map(id => `id="${id}"`).join(' || ');
        const products = await pb.collection('products').getFullList({
          filter: productFilter,
          $autoCancel: false
        });

        productMap = products.reduce((acc, product) => {
          acc[product.id] = product;
          return acc;
        }, {});
      }

      const enrichedOrders = result.map(order => {
        const parsedAddress = parseOrderAddress(order.shipping_address);

        return {
          ...order,
          buyerName: parsedAddress.name || parsedAddress.fullName || parsedAddress.name1 || 'Unbekannt',
          product: order.product_id ? (productMap[order.product_id] || null) : null,
        };
      });

      setOrders(enrichedOrders);
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error('Fehler beim Laden der Verkäufe');
    }
  }, [currentUser.id]);

  useEffect(() => {
    fetchProducts();
    fetchOrders();

    const onFocus = () => {
      fetchProducts();
      fetchOrders();
    };

    window.addEventListener('focus', onFocus);

    const intervalId = window.setInterval(() => {
      fetchProducts();
      fetchOrders();
    }, 5000);

    pb.collection('orders').subscribe('*', (e) => {
      if (e.record?.seller_id === currentUser.id) {
        fetchOrders();
      }
    });

    pb.collection('products').subscribe('*', (e) => {
      if (e.record?.seller_id === currentUser.id) {
        fetchProducts();
      }
    });

    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(intervalId);
      pb.collection('orders').unsubscribe('*');
      pb.collection('products').unsubscribe('*');
    };
  }, [currentUser.id, fetchProducts, fetchOrders]);

  const handleDeleteProduct = async (id) => {
    if (!window.confirm('Möchtest du dieses Produkt wirklich löschen?')) return;

    try {
      await pb.collection('products').delete(id, { $autoCancel: false });
      toast.success('Produkt erfolgreich gelöscht');
      fetchProducts();
    } catch (error) {
      console.error('Error deleting product:', error);
      toast.error('Fehler beim Löschen des Produkts');
    }
  };

  const handleDownloadLabel = async (order) => {
    if (order.dhl_label_pdf) {
      downloadBase64Pdf(order.dhl_label_pdf, `DHL_Label_${order.order_number || order.id}.pdf`);
      return;
    }

    if (hasOrderLabel(order)) {
      setGeneratingLabel(order.id);
      try {
        const response = await apiServerClient.fetch(`/dhl-labels/${order.id}/pdf`, {
          headers: {
            Authorization: `Bearer ${pb.authStore.token}`,
          },
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || data.details || 'Label konnte nicht geladen werden');
        }

        const blob = await response.blob();
        downloadBlob(blob, `DHL_Label_${order.order_number || order.id}.pdf`);
      } catch (error) {
        console.error('Error downloading label:', error);
        toast.error(error.message || 'Fehler beim Laden des Labels');
      } finally {
        setGeneratingLabel(null);
      }
      return;
    }

    if (!canGenerateOrderLabel(order)) {
      const issue = getOrderLabelIssue(order);
      toast.error(issue || 'Label kann fuer diese Bestellung nicht erstellt werden.');
      return;
    }

    setGeneratingLabel(order.id);

    try {
      const response = await apiServerClient.fetch('/dhl-labels/generate-label', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pb.authStore.token}`,
        },
        body: JSON.stringify({
          order_id: order.id
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setOrders(prev =>
          prev.map(o => (o.id === order.id ? buildOrderFromLabelError(o, data, 'Label generation failed') : o))
        );
        throw new Error(data.error || data.details || 'Label generation failed');
      }

      const updatedOrder = buildOrderFromLabelResponse(order, data);
      const pdfBase64 = updatedOrder.dhl_label_pdf;

      if (!pdfBase64) {
        throw new Error('Kein PDF vom DHL-Endpunkt erhalten');
      }

      downloadBase64Pdf(pdfBase64, `DHL_Label_${order.order_number || order.id}.pdf`);

      setOrders(prev =>
        prev.map(o =>
          o.id === order.id
            ? { ...o, ...updatedOrder }
            : o
        )
      );

      toast.success('Label erfolgreich generiert und heruntergeladen');
    } catch (error) {
      console.error('Error generating label:', error);
      toast.error(error.message || 'Fehler beim Generieren des Labels');
    } finally {
      setGeneratingLabel(null);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active':
      case 'verified':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">Verifiziert</Badge>;
      case 'pending_verification':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-800 border-yellow-300">In Prüfung</Badge>;
      case 'sold':
        return <Badge variant="secondary" className="bg-gray-100 text-gray-600">Verkauft</Badge>;
      case 'rejected':
        return <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-200">Abgelehnt</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <>
      <Helmet>
        <title>Verkäuferbereich - Zahnibörse</title>
      </Helmet>

      <main className="flex-1 bg-[hsl(var(--muted-bg))] py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Verkäufer Dashboard</h1>
              <p className="text-muted-foreground mt-1">
                Willkommen zurück, {currentUser?.seller_username}!
              </p>
            </div>
            <Link to="/seller/new-product">
              <Button className="gap-2 bg-[#0000FF] hover:bg-[#0000CC] text-white">
                <Plus className="w-4 h-4" />
                Neues Produkt
              </Button>
            </Link>
          </div>

          <Tabs defaultValue="products" className="w-full">
            <TabsList className="mb-8 bg-white border shadow-sm">
              <TabsTrigger value="products" className="gap-2"><Package className="w-4 h-4" /> Meine Produkte</TabsTrigger>
              <TabsTrigger value="orders" className="gap-2"><ShoppingBag className="w-4 h-4" /> Meine Verkäufe</TabsTrigger>
              <TabsTrigger value="earnings" className="gap-2"><DollarSign className="w-4 h-4" /> Einnahmen</TabsTrigger>
            </TabsList>

            <TabsContent value="products" className="bg-white rounded-[var(--radius-md)] shadow-sm border border-[hsl(var(--border))] p-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <h2 className="text-xl font-semibold">Meine Produkte</h2>
                <div className="w-full sm:w-64">
                  <Select
                    value={statusFilter}
                    onValueChange={(val) => { setStatusFilter(val); setPage(1); }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Status filtern" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle Status</SelectItem>
                      <SelectItem value="active">Verifiziert</SelectItem>
                      <SelectItem value="pending_verification">In Prüfung</SelectItem>
                      <SelectItem value="sold">Verkauft</SelectItem>
                      <SelectItem value="rejected">Abgelehnt</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {loading ? (
                <div className="py-12 text-center text-muted-foreground">Lade Produkte...</div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[80px]">Bild</TableHead>
                          <TableHead>Produkt</TableHead>
                          <TableHead>Preis</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Datum</TableHead>
                          <TableHead className="text-right">Aktionen</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {products.map(product => (
                          <TableRow key={product.id}>
                            <TableCell>
                              <div className="w-12 h-12 rounded-md bg-muted overflow-hidden border">
                                {product.image ? (
                                  <img
                                    src={pb.files.getUrl(product, product.image)}
                                    alt={product.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">Bild</div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-medium max-w-[200px] truncate" title={product.name}>
                              {product.name}
                            </TableCell>
                            <TableCell>€{product.price.toFixed(2)}</TableCell>
                            <TableCell>{getStatusBadge(product.status)}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">
                              {new Date(product.created).toLocaleDateString('de-DE')}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                {(product.status === 'active' || product.status === 'verified') && (
                                  <Link to={`/product/${product.id}`}>
                                    <Button variant="ghost" size="icon" title="Ansehen">
                                      <Eye className="w-4 h-4 text-blue-600" />
                                    </Button>
                                  </Link>
                                )}
                                <Button variant="ghost" size="icon" title="Bearbeiten" onClick={() => toast('Bearbeiten-Funktion folgt in Kürze')}>
                                  <Edit className="w-4 h-4 text-gray-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  title="Löschen"
                                  onClick={() => handleDeleteProduct(product.id)}
                                >
                                  <Trash2 className="w-4 h-4 text-red-600" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                        {products.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-12 text-[hsl(var(--secondary-text))]">
                              Keine Produkte gefunden.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-6 pt-4 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                      >
                        Zurück
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        Seite {page} von {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                      >
                        Weiter
                      </Button>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="orders" className="bg-white rounded-[var(--radius-md)] shadow-sm border border-[hsl(var(--border))] p-6">
              <h2 className="text-xl font-semibold mb-6">Meine Verkäufe</h2>
              {loading ? <div className="py-12 text-center text-muted-foreground">Lade Verkäufe...</div> : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bestellnr.</TableHead>
                        <TableHead>Käufer</TableHead>
                        <TableHead>Produkt</TableHead>
                        <TableHead>Datum</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Sendungsnummer</TableHead>
                        <TableHead className="text-right">Aktionen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map(order => (
                        <TableRow key={order.id}>
                          <TableCell className="font-medium">{order.order_number || order.id.substring(0, 8)}</TableCell>
                          <TableCell>{order.buyerName || 'Unbekannt'}</TableCell>
                          <TableCell className="max-w-[150px] truncate">
                            {order.product?.name || order.product_id || 'Produkt'}
                          </TableCell>
                          <TableCell>{new Date(order.created).toLocaleDateString('de-DE')}</TableCell>
                          <TableCell><Badge variant="outline">{order.status || 'Bezahlt'}</Badge></TableCell>
                          <TableCell>
                            {getOrderTrackingNumber(order) ? (
                              <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{getOrderTrackingNumber(order)}</span>
                            ) : (
                              <span className="text-xs text-gray-400" title={getOrderLabelIssue(order)}>{getOrderLabelText(order)}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              onClick={() => handleDownloadLabel(order)}
                              disabled={generatingLabel === order.id || getOrderLabelStatus(order) === 'generating' || getOrderLabelStatus(order) === 'unknown'}
                            >
                              {generatingLabel === order.id ? (
                                <span className="animate-pulse">Generiere...</span>
                              ) : (
                                <>
                                  <Download className="w-4 h-4" />
                                  Label
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {orders.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-12 text-[hsl(var(--secondary-text))]">
                            Noch keine Verkäufe vorhanden.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="earnings" className="bg-white rounded-[var(--radius-md)] shadow-sm border border-[hsl(var(--border))] p-6">
              <h2 className="text-xl font-semibold mb-6">Einnahmen</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="p-6 bg-blue-50 rounded-[var(--radius-md)] border border-blue-100">
                  <div className="text-sm text-blue-600 font-medium mb-2">Verfügbares Guthaben</div>
                  <div className="text-3xl font-bold text-[hsl(var(--primary))]">€0.00</div>
                </div>
                <div className="p-6 bg-gray-50 rounded-[var(--radius-md)] border border-gray-200">
                  <div className="text-sm text-gray-600 font-medium mb-2">Ausstehend</div>
                  <div className="text-3xl font-bold text-gray-900">€0.00</div>
                </div>
              </div>
              <p className="text-sm text-[hsl(var(--secondary-text))]">
                Hinweis: Auf alle Verkäufe wird eine Servicegebühr von 7% erhoben.
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </>
  );
};

export default SellerDashboardPage;
