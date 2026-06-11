import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Filter,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import AccountLayout from '@/components/AccountLayout.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Checkbox } from '@/components/ui/checkbox.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Label } from '@/components/ui/label.jsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.jsx';
import { Switch } from '@/components/ui/switch.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table.jsx';
import { useTranslation } from '@/contexts/TranslationContext.jsx';
import apiServerClient from '@/lib/apiServerClient.js';

const FILTER_TYPES = [
  { value: 'checkbox_group', label: 'Checkbox group' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'price_range', label: 'Price range' },
];

const FILTER_OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'range', label: 'Range' },
];

const FILTER_SCOPES = [
  { value: 'shop', label: 'Shop' },
  { value: 'marketplace', label: 'Marketplace' },
];

const PRODUCT_TYPES = [
  { value: 'Article', label: 'Article' },
  { value: 'Set', label: 'Set' },
  { value: 'Consumable', label: 'Consumable' },
];

const emptyFilterForm = {
  id: '',
  key: '',
  label: '',
  labelDe: '',
  labelEn: '',
  type: 'checkbox_group',
  scope: ['shop', 'marketplace'],
  parameterKey: '',
  productField: '',
  operator: 'equals',
  appliesToProductType: [],
  active: true,
  sortOrder: '50',
  minParameterKey: '',
  maxParameterKey: '',
};

const emptyOptionForm = {
  id: '',
  filterKey: '',
  value: '',
  label: '',
  labelDe: '',
  labelEn: '',
  active: true,
  sortOrder: '10',
};

const copyByLanguage = {
  DE: {
    title: 'Shop-Filter verwalten',
    description: 'Erstelle, sortiere und deaktiviere Filter, die im Shop und Marktplatz geladen werden.',
    back: 'Zurueck zum Admin Dashboard',
    addFilter: 'Filter erstellen',
    editFilter: 'Filter bearbeiten',
    addOption: 'Option erstellen',
    editOption: 'Option bearbeiten',
    filters: 'Filter',
    options: 'Optionen',
    active: 'Aktiv',
    inactive: 'Inaktiv',
    noFilters: 'Noch keine Filter vorhanden.',
    noOptions: 'Dieser Filter hat keine Optionen.',
    key: 'Key',
    label: 'Label',
    labelDe: 'Label DE',
    labelEn: 'Label EN',
    type: 'Typ',
    scope: 'Bereich',
    parameterKey: 'URL-Parameter',
    productField: 'Produktfeld',
    operator: 'Operator',
    sortOrder: 'Sortierung',
    productTypes: 'Produkttypen',
    minParameterKey: 'Min-Parameter',
    maxParameterKey: 'Max-Parameter',
    value: 'Wert',
    status: 'Status',
    actions: 'Aktionen',
    save: 'Speichern',
    saving: 'Speichert...',
    cancel: 'Abbrechen',
    delete: 'Loeschen',
    edit: 'Bearbeiten',
    loadError: 'Filter konnten nicht geladen werden.',
    saveError: 'Filter konnte nicht gespeichert werden.',
    optionSaveError: 'Option konnte nicht gespeichert werden.',
    deleteError: 'Eintrag konnte nicht geloescht werden.',
    saved: 'Filter gespeichert.',
    optionSaved: 'Option gespeichert.',
    deleted: 'Eintrag geloescht.',
    keyHelp: 'Nur Kleinbuchstaben, Zahlen und Unterstriche. Nach dem Erstellen bleibt der Key stabil.',
    priceRangeHint: 'Preisfilter brauchen keine Optionen. Min/Max Parameter werden fuer die URL genutzt.',
    confirmDeleteFilter: 'Diesen Filter inklusive aller Optionen loeschen?',
    confirmDeleteOption: 'Diese Option loeschen?',
  },
  EN: {
    title: 'Manage shop filters',
    description: 'Create, sort, and deactivate filters loaded by the shop and marketplace.',
    back: 'Back to admin dashboard',
    addFilter: 'Create filter',
    editFilter: 'Edit filter',
    addOption: 'Create option',
    editOption: 'Edit option',
    filters: 'Filters',
    options: 'Options',
    active: 'Active',
    inactive: 'Inactive',
    noFilters: 'No filters have been created yet.',
    noOptions: 'This filter has no options.',
    key: 'Key',
    label: 'Label',
    labelDe: 'Label DE',
    labelEn: 'Label EN',
    type: 'Type',
    scope: 'Scope',
    parameterKey: 'URL parameter',
    productField: 'Product field',
    operator: 'Operator',
    sortOrder: 'Sort order',
    productTypes: 'Product types',
    minParameterKey: 'Min parameter',
    maxParameterKey: 'Max parameter',
    value: 'Value',
    status: 'Status',
    actions: 'Actions',
    save: 'Save',
    saving: 'Saving...',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    loadError: 'Filters could not be loaded.',
    saveError: 'Filter could not be saved.',
    optionSaveError: 'Option could not be saved.',
    deleteError: 'Entry could not be deleted.',
    saved: 'Filter saved.',
    optionSaved: 'Option saved.',
    deleted: 'Entry deleted.',
    keyHelp: 'Lowercase letters, numbers, and underscores only. The key stays stable after creation.',
    priceRangeHint: 'Price filters do not need options. Min/max parameters are used in the URL.',
    confirmDeleteFilter: 'Delete this filter and all of its options?',
    confirmDeleteOption: 'Delete this option?',
  },
};

const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');

const normalizeParameterKey = (value) => String(value || '').trim().replace(/[^A-Za-z0-9_]+/g, '_');

const getFilterLabel = (filter) => filter.labelDe || filter.labelEn || filter.label || filter.key;

const getOptionLabel = (option) => option.labelDe || option.labelEn || option.label || option.value;

const buildFilterForm = (filter = null) => {
  if (!filter) return emptyFilterForm;

  return {
    id: filter.id || '',
    key: filter.key || '',
    label: filter.label || '',
    labelDe: filter.labelDe || '',
    labelEn: filter.labelEn || '',
    type: filter.type || 'checkbox_group',
    scope: Array.isArray(filter.scope) ? filter.scope : [],
    parameterKey: filter.parameterKey || filter.key || '',
    productField: filter.productField || filter.key || '',
    operator: filter.operator || 'equals',
    appliesToProductType: Array.isArray(filter.appliesToProductType) ? filter.appliesToProductType : [],
    active: filter.active !== false,
    sortOrder: String(filter.sortOrder ?? 0),
    minParameterKey: filter.metadata?.minParameterKey || '',
    maxParameterKey: filter.metadata?.maxParameterKey || '',
  };
};

const buildOptionForm = (filterKey, option = null) => {
  if (!option) {
    return {
      ...emptyOptionForm,
      filterKey,
    };
  }

  return {
    id: option.id || '',
    filterKey: option.filterKey || filterKey,
    value: option.value || '',
    label: option.label || '',
    labelDe: option.labelDe || '',
    labelEn: option.labelEn || '',
    active: option.active !== false,
    sortOrder: String(option.sortOrder ?? 0),
  };
};

const parseApiError = async (response, fallback) => {
  const data = await response.json().catch(() => null);
  return data?.message || data?.error?.message || data?.error || fallback;
};

const AdminFiltersPage = () => {
  const { language } = useTranslation();
  const copy = copyByLanguage[language] || copyByLanguage.DE;
  const [filters, setFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedFilterId, setSelectedFilterId] = useState('');
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [optionDialogOpen, setOptionDialogOpen] = useState(false);
  const [filterForm, setFilterForm] = useState(emptyFilterForm);
  const [optionForm, setOptionForm] = useState(emptyOptionForm);

  const selectedFilter = useMemo(() => {
    if (filters.length === 0) return null;
    return filters.find((filter) => filter.id === selectedFilterId) || filters[0];
  }, [filters, selectedFilterId]);

  const fetchFilters = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiServerClient.fetch('/admin/shop-filters');
      if (!response.ok) {
        throw new Error(await parseApiError(response, copy.loadError));
      }

      const result = await response.json();
      const items = Array.isArray(result.items) ? result.items : [];
      setFilters(items);
      setSelectedFilterId((current) => (
        current && items.some((filter) => filter.id === current)
          ? current
          : items[0]?.id || ''
      ));
    } catch (error) {
      console.error('Failed to load admin shop filters:', error);
      toast.error(error.message || copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    fetchFilters();
  }, [fetchFilters]);

  const updateFilterForm = (field, value) => {
    setFilterForm((current) => {
      const next = { ...current, [field]: value };

      if (field === 'key') {
        const key = normalizeKey(value);
        next.key = key;
        if (!current.parameterKey || current.parameterKey === current.key) next.parameterKey = key;
        if (!current.productField || current.productField === current.key) next.productField = key;
      }

      if (field === 'type' && value === 'price_range') {
        next.operator = 'range';
        if (!next.minParameterKey) next.minParameterKey = `${next.parameterKey || next.key}Min`;
        if (!next.maxParameterKey) next.maxParameterKey = `${next.parameterKey || next.key}Max`;
      }

      if (field === 'parameterKey') {
        next.parameterKey = normalizeParameterKey(value);
      }

      if (field === 'productField') {
        next.productField = normalizeParameterKey(value);
      }

      return next;
    });
  };

  const toggleFilterArrayField = (field, value, checked) => {
    setFilterForm((current) => {
      const values = new Set(current[field] || []);
      if (checked) values.add(value);
      else values.delete(value);
      return { ...current, [field]: [...values] };
    });
  };

  const openCreateFilter = () => {
    setFilterForm(emptyFilterForm);
    setFilterDialogOpen(true);
  };

  const openEditFilter = (filter) => {
    setFilterForm(buildFilterForm(filter));
    setFilterDialogOpen(true);
  };

  const openCreateOption = (filter) => {
    setOptionForm(buildOptionForm(filter.key));
    setOptionDialogOpen(true);
  };

  const openEditOption = (filter, option) => {
    setOptionForm(buildOptionForm(filter.key, option));
    setOptionDialogOpen(true);
  };

  const saveFilter = async (event) => {
    event.preventDefault();
    setSaving(true);

    try {
      const metadata = filterForm.type === 'price_range'
        ? {
          minParameterKey: filterForm.minParameterKey || `${filterForm.parameterKey || filterForm.key}Min`,
          maxParameterKey: filterForm.maxParameterKey || `${filterForm.parameterKey || filterForm.key}Max`,
        }
        : {};
      const payload = {
        key: filterForm.key,
        label: filterForm.label || filterForm.labelEn || filterForm.labelDe,
        labelDe: filterForm.labelDe,
        labelEn: filterForm.labelEn,
        type: filterForm.type,
        scope: filterForm.scope,
        parameterKey: filterForm.parameterKey || filterForm.key,
        productField: filterForm.productField || filterForm.key,
        operator: filterForm.operator,
        appliesToProductType: filterForm.appliesToProductType,
        active: filterForm.active,
        sortOrder: filterForm.sortOrder,
        metadata,
      };
      const isEditing = Boolean(filterForm.id);
      const response = await apiServerClient.fetch(
        isEditing ? `/admin/shop-filters/${filterForm.id}` : '/admin/shop-filters',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response, copy.saveError));
      }

      const result = await response.json();
      await fetchFilters();
      setSelectedFilterId(result.item?.id || filterForm.id);
      setFilterDialogOpen(false);
      toast.success(copy.saved);
    } catch (error) {
      console.error('Failed to save shop filter:', error);
      toast.error(error.message || copy.saveError);
    } finally {
      setSaving(false);
    }
  };

  const saveOption = async (event) => {
    event.preventDefault();
    setSaving(true);

    try {
      const isEditing = Boolean(optionForm.id);
      const response = await apiServerClient.fetch(
        isEditing ? `/admin/shop-filter-options/${optionForm.id}` : '/admin/shop-filter-options',
        {
          method: isEditing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(optionForm),
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response, copy.optionSaveError));
      }

      await fetchFilters();
      setOptionDialogOpen(false);
      toast.success(copy.optionSaved);
    } catch (error) {
      console.error('Failed to save shop filter option:', error);
      toast.error(error.message || copy.optionSaveError);
    } finally {
      setSaving(false);
    }
  };

  const updateFilterActive = async (filter, active) => {
    const payload = {
      ...buildFilterForm(filter),
      active,
    };

    const response = await apiServerClient.fetch(`/admin/shop-filters/${filter.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, copy.saveError));
    }

    await fetchFilters();
  };

  const updateOptionActive = async (option, active) => {
    const payload = {
      ...buildOptionForm(option.filterKey, option),
      active,
    };

    const response = await apiServerClient.fetch(`/admin/shop-filter-options/${option.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await parseApiError(response, copy.optionSaveError));
    }

    await fetchFilters();
  };

  const handleToggleFilter = async (filter, active) => {
    try {
      await updateFilterActive(filter, active);
      toast.success(copy.saved);
    } catch (error) {
      console.error('Failed to toggle shop filter:', error);
      toast.error(error.message || copy.saveError);
    }
  };

  const handleToggleOption = async (option, active) => {
    try {
      await updateOptionActive(option, active);
      toast.success(copy.optionSaved);
    } catch (error) {
      console.error('Failed to toggle shop filter option:', error);
      toast.error(error.message || copy.optionSaveError);
    }
  };

  const deleteFilter = async (filter) => {
    if (!window.confirm(copy.confirmDeleteFilter)) return;

    try {
      const response = await apiServerClient.fetch(`/admin/shop-filters/${filter.id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(await parseApiError(response, copy.deleteError));
      }

      await fetchFilters();
      toast.success(copy.deleted);
    } catch (error) {
      console.error('Failed to delete shop filter:', error);
      toast.error(error.message || copy.deleteError);
    }
  };

  const deleteOption = async (option) => {
    if (!window.confirm(copy.confirmDeleteOption)) return;

    try {
      const response = await apiServerClient.fetch(`/admin/shop-filter-options/${option.id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(await parseApiError(response, copy.deleteError));
      }

      await fetchFilters();
      toast.success(copy.deleted);
    } catch (error) {
      console.error('Failed to delete shop filter option:', error);
      toast.error(error.message || copy.deleteError);
    }
  };

  return (
    <>
      <Helmet>
        <title>{copy.title} - Zahnibörse</title>
      </Helmet>

      <AccountLayout
        activeKey="admin-filters"
        title={copy.title}
        description={copy.description}
        headerAction={(
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="rounded-[8px]">
              <Link to="/admin">
                <ArrowLeft className="h-4 w-4" />
                {copy.back}
              </Link>
            </Button>
            <Button onClick={openCreateFilter} className="rounded-[8px] bg-[#0000FF] text-white hover:bg-[#0000CC]">
              <Plus className="h-4 w-4" />
              {copy.addFilter}
            </Button>
          </div>
        )}
      >
        {loading ? (
          <div className="rounded-[8px] border border-black/10 bg-white p-10 text-center text-sm text-[#666666]">
            Loading...
          </div>
        ) : filters.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-black/15 bg-white p-10 text-center">
            <Filter className="mx-auto h-10 w-10 text-[#0000FF]" />
            <h2 className="mt-4 text-xl font-bold text-[#151515]">{copy.noFilters}</h2>
            <Button onClick={openCreateFilter} className="mt-5 rounded-[8px] bg-[#0000FF] text-white hover:bg-[#0000CC]">
              <Plus className="h-4 w-4" />
              {copy.addFilter}
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
            <section className="rounded-[8px] border border-black/10 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-black/10 p-4">
                <div>
                  <h2 className="font-bold text-[#151515]">{copy.filters}</h2>
                  <p className="text-sm text-[#666666]">{filters.length} total</p>
                </div>
                <SlidersHorizontal className="h-5 w-5 text-[#0000FF]" />
              </div>
              <div className="divide-y divide-black/10">
                {filters.map((filter) => {
                  const selected = selectedFilter?.id === filter.id;
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      onClick={() => setSelectedFilterId(filter.id)}
                      className={`flex w-full items-start gap-3 px-4 py-4 text-left transition-colors ${
                        selected ? 'bg-[#f3f3ff]' : 'hover:bg-[#fafafa]'
                      }`}
                    >
                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${filter.active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-[#151515]">{getFilterLabel(filter)}</span>
                        <span className="mt-1 block truncate font-mono text-xs text-[#666666]">{filter.key}</span>
                        <span className="mt-2 flex flex-wrap gap-1">
                          <Badge variant="outline" className="rounded-[8px]">{filter.type}</Badge>
                          {filter.scope.map((scope) => (
                            <Badge key={scope} variant="secondary" className="rounded-[8px]">{scope}</Badge>
                          ))}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {selectedFilter && (
              <section className="min-w-0 rounded-[8px] border border-black/10 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-black/10 p-5 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-bold text-[#151515]">{getFilterLabel(selectedFilter)}</h2>
                      <Badge className={selectedFilter.active ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}>
                        {selectedFilter.active ? copy.active : copy.inactive}
                      </Badge>
                    </div>
                    <p className="mt-2 font-mono text-sm text-[#666666]">{selectedFilter.key}</p>
                    <div className="mt-3 grid gap-2 text-sm text-[#4f4f4f] sm:grid-cols-2 lg:grid-cols-4">
                      <span>{copy.type}: <strong>{selectedFilter.type}</strong></span>
                      <span>{copy.operator}: <strong>{selectedFilter.operator}</strong></span>
                      <span>{copy.parameterKey}: <strong>{selectedFilter.parameterKey}</strong></span>
                      <span>{copy.productField}: <strong>{selectedFilter.productField}</strong></span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2 rounded-[8px] border border-black/10 px-3 py-2">
                      <Switch
                        checked={selectedFilter.active}
                        onCheckedChange={(checked) => handleToggleFilter(selectedFilter, checked)}
                        aria-label={copy.active}
                      />
                      <span className="text-sm font-semibold">{copy.active}</span>
                    </div>
                    <Button variant="outline" className="rounded-[8px]" onClick={() => openEditFilter(selectedFilter)}>
                      <Edit3 className="h-4 w-4" />
                      {copy.edit}
                    </Button>
                    <Button variant="outline" className="rounded-[8px] border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => deleteFilter(selectedFilter)}>
                      <Trash2 className="h-4 w-4" />
                      {copy.delete}
                    </Button>
                  </div>
                </div>

                <div className="p-5">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-bold text-[#151515]">{copy.options}</h3>
                      <p className="text-sm text-[#666666]">{selectedFilter.options?.length || 0} total</p>
                    </div>
                    {selectedFilter.type !== 'price_range' && (
                      <Button onClick={() => openCreateOption(selectedFilter)} className="rounded-[8px] bg-[#0000FF] text-white hover:bg-[#0000CC]">
                        <Plus className="h-4 w-4" />
                        {copy.addOption}
                      </Button>
                    )}
                  </div>

                  {selectedFilter.type === 'price_range' ? (
                    <div className="rounded-[8px] border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                      {copy.priceRangeHint}
                    </div>
                  ) : selectedFilter.options?.length > 0 ? (
                    <div className="overflow-x-auto rounded-[8px] border border-black/10">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{copy.value}</TableHead>
                            <TableHead>{copy.label}</TableHead>
                            <TableHead>{copy.sortOrder}</TableHead>
                            <TableHead>{copy.status}</TableHead>
                            <TableHead className="text-right">{copy.actions}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedFilter.options.map((option) => (
                            <TableRow key={option.id}>
                              <TableCell className="font-mono text-xs">{option.value}</TableCell>
                              <TableCell>
                                <div className="font-medium">{getOptionLabel(option)}</div>
                                <div className="text-xs text-[#666666]">{option.labelDe} / {option.labelEn}</div>
                              </TableCell>
                              <TableCell>{option.sortOrder}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Switch
                                    checked={option.active}
                                    onCheckedChange={(checked) => handleToggleOption(option, checked)}
                                    aria-label={copy.active}
                                  />
                                  <span className="text-sm">{option.active ? copy.active : copy.inactive}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  <Button variant="outline" size="sm" className="rounded-[8px]" onClick={() => openEditOption(selectedFilter, option)}>
                                    <Edit3 className="h-4 w-4" />
                                    {copy.edit}
                                  </Button>
                                  <Button variant="outline" size="sm" className="rounded-[8px] border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => deleteOption(option)}>
                                    <Trash2 className="h-4 w-4" />
                                    {copy.delete}
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="rounded-[8px] border border-dashed border-black/15 p-8 text-center text-sm text-[#666666]">
                      {copy.noOptions}
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </AccountLayout>

      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{filterForm.id ? copy.editFilter : copy.addFilter}</DialogTitle>
            <DialogDescription>{copy.keyHelp}</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveFilter} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="filter-key">{copy.key}</Label>
                <Input
                  id="filter-key"
                  value={filterForm.key}
                  onChange={(event) => updateFilterForm('key', event.target.value)}
                  disabled={Boolean(filterForm.id)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="filter-label">{copy.label}</Label>
                <Input
                  id="filter-label"
                  value={filterForm.label}
                  onChange={(event) => updateFilterForm('label', event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="filter-label-de">{copy.labelDe}</Label>
                <Input
                  id="filter-label-de"
                  value={filterForm.labelDe}
                  onChange={(event) => updateFilterForm('labelDe', event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="filter-label-en">{copy.labelEn}</Label>
                <Input
                  id="filter-label-en"
                  value={filterForm.labelEn}
                  onChange={(event) => updateFilterForm('labelEn', event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>{copy.type}</Label>
                <Select value={filterForm.type} onValueChange={(value) => updateFilterForm('type', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FILTER_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{copy.operator}</Label>
                <Select value={filterForm.operator} onValueChange={(value) => updateFilterForm('operator', value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FILTER_OPERATORS.map((operator) => (
                      <SelectItem key={operator.value} value={operator.value}>{operator.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="filter-parameter">{copy.parameterKey}</Label>
                <Input
                  id="filter-parameter"
                  value={filterForm.parameterKey}
                  onChange={(event) => updateFilterForm('parameterKey', event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="filter-field">{copy.productField}</Label>
                <Input
                  id="filter-field"
                  value={filterForm.productField}
                  onChange={(event) => updateFilterForm('productField', event.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="filter-sort">{copy.sortOrder}</Label>
                <Input
                  id="filter-sort"
                  type="number"
                  min="0"
                  value={filterForm.sortOrder}
                  onChange={(event) => updateFilterForm('sortOrder', event.target.value)}
                />
              </div>
              <div className="flex items-center gap-3 rounded-[8px] border border-black/10 px-3 py-2">
                <Switch
                  checked={filterForm.active}
                  onCheckedChange={(checked) => updateFilterForm('active', checked)}
                  aria-label={copy.active}
                />
                <Label>{copy.active}</Label>
              </div>
            </div>

            <fieldset className="rounded-[8px] border border-black/10 p-4">
              <legend className="px-1 text-sm font-semibold">{copy.scope}</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {FILTER_SCOPES.map((scope) => (
                  <label key={scope.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={filterForm.scope.includes(scope.value)}
                      onCheckedChange={(checked) => toggleFilterArrayField('scope', scope.value, checked === true)}
                    />
                    {scope.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="rounded-[8px] border border-black/10 p-4">
              <legend className="px-1 text-sm font-semibold">{copy.productTypes}</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {PRODUCT_TYPES.map((type) => (
                  <label key={type.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={filterForm.appliesToProductType.includes(type.value)}
                      onCheckedChange={(checked) => toggleFilterArrayField('appliesToProductType', type.value, checked === true)}
                    />
                    {type.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {filterForm.type === 'price_range' && (
              <div className="grid gap-4 rounded-[8px] border border-blue-100 bg-blue-50 p-4 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="filter-min-param">{copy.minParameterKey}</Label>
                  <Input
                    id="filter-min-param"
                    value={filterForm.minParameterKey}
                    onChange={(event) => updateFilterForm('minParameterKey', normalizeParameterKey(event.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="filter-max-param">{copy.maxParameterKey}</Label>
                  <Input
                    id="filter-max-param"
                    value={filterForm.maxParameterKey}
                    onChange={(event) => updateFilterForm('maxParameterKey', normalizeParameterKey(event.target.value))}
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFilterDialogOpen(false)}>{copy.cancel}</Button>
              <Button type="submit" disabled={saving} className="bg-[#0000FF] text-white hover:bg-[#0000CC]">
                <CheckCircle2 className="h-4 w-4" />
                {saving ? copy.saving : copy.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={optionDialogOpen} onOpenChange={setOptionDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{optionForm.id ? copy.editOption : copy.addOption}</DialogTitle>
            <DialogDescription>{selectedFilter ? getFilterLabel(selectedFilter) : ''}</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveOption} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="option-value">{copy.value}</Label>
                <Input
                  id="option-value"
                  value={optionForm.value}
                  onChange={(event) => setOptionForm((current) => ({ ...current, value: event.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="option-label">{copy.label}</Label>
                <Input
                  id="option-label"
                  value={optionForm.label}
                  onChange={(event) => setOptionForm((current) => ({ ...current, label: event.target.value }))}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="option-label-de">{copy.labelDe}</Label>
                <Input
                  id="option-label-de"
                  value={optionForm.labelDe}
                  onChange={(event) => setOptionForm((current) => ({ ...current, labelDe: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="option-label-en">{copy.labelEn}</Label>
                <Input
                  id="option-label-en"
                  value={optionForm.labelEn}
                  onChange={(event) => setOptionForm((current) => ({ ...current, labelEn: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="option-sort">{copy.sortOrder}</Label>
                <Input
                  id="option-sort"
                  type="number"
                  min="0"
                  value={optionForm.sortOrder}
                  onChange={(event) => setOptionForm((current) => ({ ...current, sortOrder: event.target.value }))}
                />
              </div>
              <div className="flex items-center gap-3 rounded-[8px] border border-black/10 px-3 py-2">
                <Switch
                  checked={optionForm.active}
                  onCheckedChange={(checked) => setOptionForm((current) => ({ ...current, active: checked }))}
                  aria-label={copy.active}
                />
                <Label>{copy.active}</Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOptionDialogOpen(false)}>{copy.cancel}</Button>
              <Button type="submit" disabled={saving} className="bg-[#0000FF] text-white hover:bg-[#0000CC]">
                <CheckCircle2 className="h-4 w-4" />
                {saving ? copy.saving : copy.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminFiltersPage;
