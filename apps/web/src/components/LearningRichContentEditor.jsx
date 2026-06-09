import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Bold,
  ChevronDown,
  ChevronUp,
  Columns3,
  Heading2,
  Image as ImageIcon,
  ListPlus,
  Plus,
  Rows3,
  Table2,
  Trash2,
  Type,
  UploadCloud,
} from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';
import {
  createImageBlock,
  createListBlock,
  createParagraphBlock,
  createTableBlock,
  normalizeLearningRichBlocks,
} from '@/lib/learningRichContent.js';
import LearningRichContentRenderer from '@/components/LearningRichContentRenderer.jsx';

const sizeOptions = [
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'heading', label: 'Heading' },
];

const editorFontSizeByValue = {
  small: '2',
  normal: '3',
  large: '5',
  heading: '6',
};

const valueByEditorFontSize = {
  1: 'small',
  2: 'small',
  3: 'normal',
  4: 'large',
  5: 'large',
  6: 'heading',
  7: 'heading',
};

const inlineClassBySize = {
  small: 'text-sm leading-6',
  normal: 'text-base leading-7',
  large: 'text-lg leading-8',
  heading: 'text-2xl leading-tight',
};

const getSpanKey = (span) => `${span.bold ? '1' : '0'}:${span.size || 'normal'}`;

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const getBlockSpans = (block) => (
  Array.isArray(block?.spans) && block.spans.length > 0
    ? block.spans
    : [{ text: block?.text || '', bold: block?.bold === true, size: block?.size || 'normal' }]
);

const getBlockText = (block) => getBlockSpans(block).map((span) => span.text).join('');

const spansToHtml = (spans) => getBlockSpans({ spans })
  .map((span) => (
    `<span data-bold="${span.bold ? 'true' : 'false'}" data-size="${span.size || 'normal'}" class="${inlineClassBySize[span.size] || inlineClassBySize.normal}${span.bold ? ' font-bold text-slate-900' : ''}">${escapeHtml(span.text)}</span>`
  ))
  .join('');

const mergeInlineSpans = (spans) => {
  const merged = [];
  for (const span of spans) {
    if (!span.text) continue;
    const normalized = {
      text: span.text,
      bold: span.bold === true,
      size: sizeOptions.some((option) => option.value === span.size) ? span.size : 'normal',
    };
    const previous = merged.at(-1);
    if (previous && getSpanKey(previous) === getSpanKey(normalized)) {
      previous.text += normalized.text;
    } else {
      merged.push(normalized);
    }
  }
  return merged;
};

const splitText = (text, start, end) => [
  text.slice(0, start),
  text.slice(start, end),
  text.slice(end),
];

const applyInlineStyle = (block, selection, patch) => {
  const spans = getBlockSpans(block);
  const fullText = getBlockText(block);
  const start = Math.max(0, Math.min(selection?.start ?? 0, selection?.end ?? 0, fullText.length));
  const end = Math.max(0, Math.min(selection?.end ?? 0, fullText.length));

  if (start === end) {
    return block;
  }

  let cursor = 0;
  const nextSpans = [];
  for (const span of spans) {
    const spanStart = cursor;
    const spanEnd = cursor + span.text.length;
    cursor = spanEnd;

    if (spanEnd <= start || spanStart >= end) {
      nextSpans.push(span);
      continue;
    }

    const localStart = Math.max(0, start - spanStart);
    const localEnd = Math.min(span.text.length, end - spanStart);
    const [before, selected, after] = splitText(span.text, localStart, localEnd);
    if (before) nextSpans.push({ ...span, text: before });
    if (selected) nextSpans.push({ ...span, ...patch, text: selected });
    if (after) nextSpans.push({ ...span, text: after });
  }

  const mergedSpans = mergeInlineSpans(nextSpans);
  return {
    ...block,
    text: mergedSpans.map((span) => span.text).join(''),
    spans: mergedSpans,
    bold: false,
    size: 'normal',
  };
};

const getSelectionOffsets = (root) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);

  return {
    start: before.toString().length,
    end: before.toString().length + range.toString().length,
  };
};

const restoreSelection = (root, start, end = start) => {
  const selection = window.getSelection();
  if (!selection) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let cursor = 0;
  let startSet = false;
  let endSet = false;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nextCursor = cursor + node.textContent.length;

    if (!startSet && start <= nextCursor) {
      range.setStart(node, Math.max(0, start - cursor));
      startSet = true;
    }
    if (!endSet && end <= nextCursor) {
      range.setEnd(node, Math.max(0, end - cursor));
      endSet = true;
      break;
    }
    cursor = nextCursor;
  }

  if (!startSet) {
    range.setStart(root, root.childNodes.length);
  }
  if (!endSet) {
    range.setEnd(root, root.childNodes.length);
  }

  selection.removeAllRanges();
  selection.addRange(range);
};

const parseEditorSpans = (root) => {
  const spans = [];
  const visit = (node, inherited = { bold: false, size: 'normal' }) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) {
        spans.push({ ...inherited, text: node.textContent });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tagName = node.tagName?.toLowerCase();
    const fontWeight = node.style?.fontWeight || '';
    const fontSize = node.getAttribute?.('size');
    const next = {
      bold: node.dataset?.bold === 'true'
        || tagName === 'b'
        || tagName === 'strong'
        || fontWeight === 'bold'
        || Number.parseInt(fontWeight, 10) >= 600
        || inherited.bold,
      size: node.dataset?.size || valueByEditorFontSize[fontSize] || inherited.size,
    };
    node.childNodes.forEach((child) => visit(child, next));
  };

  root.childNodes.forEach((child) => visit(child));
  return mergeInlineSpans(spans);
};

const getSelectionStyle = (block, selection) => {
  const spans = getBlockSpans(block);
  const fullText = getBlockText(block);
  const start = Math.max(0, Math.min(selection?.start ?? 0, selection?.end ?? 0, fullText.length));
  const end = Math.max(0, Math.min(selection?.end ?? 0, fullText.length));
  if (start === end) {
    return { bold: false, size: 'normal', hasSelection: false };
  }

  let cursor = 0;
  const selectedSpans = [];
  for (const span of spans) {
    const spanStart = cursor;
    const spanEnd = cursor + span.text.length;
    cursor = spanEnd;
    if (spanEnd <= start || spanStart >= end) continue;
    selectedSpans.push(span);
  }

  const first = selectedSpans[0] || {};
  const sameSize = selectedSpans.every((span) => span.size === first.size);
  return {
    bold: selectedSpans.length > 0 && selectedSpans.every((span) => span.bold === true),
    size: sameSize ? first.size || 'normal' : 'normal',
    hasSelection: selectedSpans.length > 0,
  };
};

const getStyleAtOffset = (block, offset) => {
  const spans = getBlockSpans(block);
  let cursor = 0;
  for (const span of spans) {
    const nextCursor = cursor + span.text.length;
    if (offset <= nextCursor) {
      return {
        bold: span.bold === true,
        size: span.size || 'normal',
        hasSelection: false,
      };
    }
    cursor = nextCursor;
  }
  const last = spans.at(-1) || {};
  return {
    bold: last.bold === true,
    size: last.size || 'normal',
    hasSelection: false,
  };
};

const ParagraphRichEditor = forwardRef(({ block, onChange, onSelect, onStyleChange }, ref) => {
  const editorRef = useRef(null);
  const blockRef = useRef(block);
  const initializedRef = useRef(false);
  const lastSelectionRef = useRef(null);
  const spans = getBlockSpans(block);
  const spansSignature = JSON.stringify(spans);

  const updateToolbarStyle = (selection) => {
    const currentBlock = blockRef.current;
    const style = selection && selection.start !== selection.end
      ? getSelectionStyle(currentBlock, selection)
      : getStyleAtOffset(currentBlock, selection?.end ?? getBlockText(currentBlock).length);
    onStyleChange?.(style);
  };

  const captureSelection = () => {
    const root = editorRef.current;
    if (!root) return;
    const offsets = getSelectionOffsets(root);
    if (offsets) {
      lastSelectionRef.current = offsets;
      onSelect(offsets);
      updateToolbarStyle(offsets);
    }
  };

  const syncFromDom = () => {
    const root = editorRef.current;
    if (!root) return blockRef.current;
    const nextSpans = parseEditorSpans(root);
    const normalizedSpans = nextSpans.length > 0
      ? nextSpans
      : [{ text: '', bold: false, size: 'normal' }];
    const nextBlock = {
      ...blockRef.current,
      text: normalizedSpans.map((span) => span.text).join(''),
      spans: normalizedSpans,
      bold: false,
      size: 'normal',
    };
    blockRef.current = nextBlock;
    onChange(nextBlock);
    return nextBlock;
  };

  const commitInput = () => {
    const root = editorRef.current;
    if (!root) return;
    const offsets = getSelectionOffsets(root);
    syncFromDom();
    if (offsets) {
      lastSelectionRef.current = offsets;
      onSelect(offsets);
      updateToolbarStyle(offsets);
      requestAnimationFrame(() => restoreSelection(root, offsets.start, offsets.end));
    }
  };

  useEffect(() => {
    blockRef.current = block;
  }, [block]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    if (initializedRef.current && document.activeElement === root) return;
    root.innerHTML = spansToHtml(spans);
    initializedRef.current = true;
  }, [block.id, spansSignature]);

  const formatSelection = (format) => {
    const root = editorRef.current;
    if (!root) return;
    const selection = getSelectionOffsets(root);
    const activeSelection = selection || lastSelectionRef.current;
    if (!activeSelection) return;

    root.focus();
    restoreSelection(root, activeSelection.start, activeSelection.end);
    document.execCommand('styleWithCSS', false, false);
    if (format === 'bold') {
      document.execCommand('bold', false);
    } else {
      document.execCommand('fontSize', false, editorFontSizeByValue[format] || editorFontSizeByValue.normal);
    }
    const nextSelection = getSelectionOffsets(root) || activeSelection;
    const nextBlock = syncFromDom();
    lastSelectionRef.current = nextSelection;
    onSelect(nextSelection);
    onStyleChange?.({
      bold: document.queryCommandState('bold'),
      size: valueByEditorFontSize[String(document.queryCommandValue('fontSize') || '')]
        || (format === 'bold' ? getStyleAtOffset(nextBlock, nextSelection.end).size : format),
      hasSelection: nextSelection.start !== nextSelection.end,
    });
  };

  useImperativeHandle(ref, () => ({
    format: formatSelection,
  }));

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      tabIndex={0}
      className="min-h-[132px] w-full rounded-md border border-input bg-white px-3 py-3 text-base leading-7 text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onInput={commitInput}
      onKeyUp={captureSelection}
      onMouseUp={captureSelection}
      onFocus={captureSelection}
      onBlur={captureSelection}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
          event.preventDefault();
          formatSelection('bold');
        }
      }}
      data-placeholder="Write lesson content..."
    />
  );
});

ParagraphRichEditor.displayName = 'ParagraphRichEditor';

const moveBlock = (blocks, fromIndex, toIndex) => {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return blocks;
  const next = [...blocks];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

const parseTableImport = (value) => {
  const rows = String(value || '')
    .split('\n')
    .map((line) => line.split('\t').map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));

  if (rows.length === 0) return null;
  return {
    header: rows[0],
    rows: rows.slice(1).length > 0 ? rows.slice(1) : [rows[0].map(() => '')],
  };
};

const ToolbarButton = ({ children, label, active = false, ...props }) => (
  <Button
    type="button"
    variant={active ? 'default' : 'outline'}
    size="icon"
    title={label}
    aria-label={label}
    className={`size-9 rounded-[8px] ${active ? 'bg-[#0000FF] text-white hover:bg-[#0000CC]' : 'bg-white'}`}
    {...props}
  >
    {children}
  </Button>
);

const LearningRichContentEditor = ({
  value,
  onChange,
  fallbackText = '',
  onUploadImage,
  uploading = false,
}) => {
  const blocks = useMemo(() => normalizeLearningRichBlocks(value, fallbackText, { preserveEmpty: true }), [fallbackText, value]);
  const [selectedBlockId, setSelectedBlockId] = useState(blocks[0]?.id || '');
  const [selectionByBlockId, setSelectionByBlockId] = useState({});
  const [typingStyleByBlockId, setTypingStyleByBlockId] = useState({});
  const selectionByBlockIdRef = useRef({});
  const selectedBlockIdRef = useRef(blocks[0]?.id || '');
  const editorRefs = useRef({});
  const [previewMode, setPreviewMode] = useState(false);
  const [tableImport, setTableImport] = useState('');

  const selectedBlock = blocks.find((block) => block.id === selectedBlockId) || blocks[0];
  const selectedRange = selectionByBlockId[selectedBlock?.id] || null;
  const selectedRangeStyle = selectedBlock?.type === 'paragraph'
    ? getSelectionStyle(selectedBlock, selectedRange)
    : { bold: false, size: 'normal', hasSelection: false };
  const selectedStyle = selectedRangeStyle.hasSelection
    ? selectedRangeStyle
    : typingStyleByBlockId[selectedBlock?.id] || selectedRangeStyle;

  const commit = (nextBlocks) => {
    const normalized = normalizeLearningRichBlocks(nextBlocks, '', { preserveEmpty: true });
    onChange(normalized);
    if (!normalized.some((block) => block.id === selectedBlockId)) {
      setSelectedBlockId(normalized[0]?.id || '');
    }
  };

  const updateBlock = (blockId, patch) => {
    commit(blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)));
  };

  const updateParagraphBlock = (nextBlock) => {
    commit(blocks.map((block) => (block.id === nextBlock.id ? nextBlock : block)));
  };

  const updateSelection = (blockId, selection) => {
    selectedBlockIdRef.current = blockId;
    setSelectedBlockId(blockId);
    if (!selection) return;
    selectionByBlockIdRef.current = {
      ...selectionByBlockIdRef.current,
      [blockId]: selection,
    };
    setSelectionByBlockId((current) => ({
      ...current,
      [blockId]: selection,
    }));
  };

  const updateTypingStyle = (blockId, style) => {
    setTypingStyleByBlockId((current) => ({
      ...current,
      [blockId]: {
        bold: style?.bold === true,
        size: sizeOptions.some((option) => option.value === style?.size) ? style.size : 'normal',
        hasSelection: style?.hasSelection === true,
      },
    }));
  };

  const applyParagraphFormat = (format, selectionOverride = null) => {
    const activeBlockId = selectedBlockIdRef.current || selectedBlockId;
    const activeBlock = blocks.find((block) => block.id === activeBlockId) || selectedBlock;
    if (activeBlock?.type !== 'paragraph') return;
    const activeEditor = editorRefs.current[activeBlock.id];
    if (activeEditor) {
      activeEditor.format(format);
      return;
    }
    const range = selectionOverride || selectionByBlockIdRef.current[activeBlock.id] || selectionByBlockId[activeBlock.id];
    if (!range || range.start === range.end) return;

    const patch = format === 'bold'
      ? { bold: !getSelectionStyle(activeBlock, range).bold }
      : { size: format };
    selectionByBlockIdRef.current = {
      ...selectionByBlockIdRef.current,
      [activeBlock.id]: range,
    };
    setSelectionByBlockId((current) => ({
      ...current,
      [activeBlock.id]: range,
    }));
    updateParagraphBlock(applyInlineStyle(activeBlock, range, patch));
  };

  const insertBlock = (block, { append = false } = {}) => {
    const selectedIndex = blocks.findIndex((item) => item.id === selectedBlockId);
    const insertIndex = append || selectedIndex < 0 ? blocks.length : selectedIndex + 1;
    commit([
      ...blocks.slice(0, insertIndex),
      block,
      ...blocks.slice(insertIndex),
    ]);
    setSelectedBlockId(block.id);
  };

  const removeBlock = (blockId) => {
    if (blocks.length <= 1) {
      commit([createParagraphBlock()]);
      return;
    }
    commit(blocks.filter((block) => block.id !== blockId));
  };

  const updateTableCell = ({ blockId, area, rowIndex, cellIndex, value: cellValue }) => {
    const table = blocks.find((block) => block.id === blockId);
    if (!table || table.type !== 'table') return;

    if (area === 'header') {
      const header = [...table.header];
      header[cellIndex] = cellValue;
      updateBlock(blockId, { header });
      return;
    }

    const rows = table.rows.map((row) => [...row]);
    rows[rowIndex][cellIndex] = cellValue;
    updateBlock(blockId, { rows });
  };

  const addTableRow = (block) => {
    const columnCount = Math.max(block.header.length, block.rows[0]?.length || 1);
    updateBlock(block.id, { rows: [...block.rows, Array(columnCount).fill('')] });
  };

  const addTableColumn = (block) => {
    updateBlock(block.id, {
      header: [...block.header, `Header ${block.header.length + 1}`],
      rows: block.rows.map((row) => [...row, '']),
    });
  };

  const updateListItem = (blockId, itemIndex, itemValue) => {
    const list = blocks.find((block) => block.id === blockId);
    if (!list || list.type !== 'list') return;
    updateBlock(blockId, {
      items: list.items.map((item, index) => (index === itemIndex ? itemValue : item)),
    });
  };

  const addListItem = (block) => {
    updateBlock(block.id, { items: [...(block.items || []), ''] });
  };

  const removeListItem = (block, itemIndex) => {
    const nextItems = (block.items || []).filter((_, index) => index !== itemIndex);
    updateBlock(block.id, { items: nextItems.length > 0 ? nextItems : [''] });
  };

  const applyTableImport = (block) => {
    const parsed = parseTableImport(tableImport);
    if (!parsed) return;
    updateBlock(block.id, parsed);
    setTableImport('');
  };

  const handleImageUpload = async (file) => {
    if (!file || !onUploadImage) return;
    const record = await onUploadImage(file);
    const url = record?.url || '';
    if (!url) return;

    if (selectedBlock?.type === 'image' && !selectedBlock.url) {
      updateBlock(selectedBlock.id, { url, alt: file.name });
      return;
    }

    insertBlock(createImageBlock({ url, alt: file.name }));
  };

  return (
    <div className="rounded-[8px] border border-black/10 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-black/10 bg-slate-50 p-3">
        <ToolbarButton
          label="Bold"
          active={selectedStyle.bold}
          disabled={selectedBlock?.type !== 'paragraph'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => applyParagraphFormat('bold')}
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <div className="flex h-9 overflow-hidden rounded-[8px] border border-black/10 bg-white" role="group" aria-label="Text size">
          {sizeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={selectedBlock?.type !== 'paragraph'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyParagraphFormat(option.value)}
              className={`px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${selectedStyle.size === option.value ? 'bg-[#0000FF] text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <ToolbarButton label="Add text" onClick={() => insertBlock(createParagraphBlock(), { append: true })}>
          <Type className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Add heading" onClick={() => insertBlock(createParagraphBlock({ size: 'heading' }), { append: true })}>
          <Heading2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Add bullet list" onClick={() => insertBlock(createListBlock())}>
          <ListPlus className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Add image" onClick={() => insertBlock(createImageBlock())}>
          <ImageIcon className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Add table" onClick={() => insertBlock(createTableBlock())}>
          <Table2 className="size-4" />
        </ToolbarButton>
        <Button
          type="button"
          variant={previewMode ? 'default' : 'outline'}
          className={`h-9 rounded-[8px] px-3 ${previewMode ? 'bg-[#0000FF] text-white hover:bg-[#0000CC]' : 'bg-white'}`}
          onClick={() => setPreviewMode((current) => !current)}
        >
          {previewMode ? 'Edit' : 'Preview'}
        </Button>
      </div>

      {previewMode ? (
        <div className="p-4">
          <LearningRichContentRenderer blocks={blocks} compact />
        </div>
      ) : (
        <div className="grid gap-0 divide-y divide-black/10">
          {blocks.map((block, index) => (
            <section
              key={block.id}
              className={`grid gap-3 p-4 ${selectedBlockId === block.id ? 'bg-[#f7f7ff]' : 'bg-white'}`}
              onFocus={() => setSelectedBlockId(block.id)}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500"
                  onClick={() => setSelectedBlockId(block.id)}
                >
                  <ListPlus className="size-4" />
                  {block.type}
                </button>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="size-8 rounded-[8px]" disabled={index === 0} onClick={() => commit(moveBlock(blocks, index, index - 1))} aria-label="Move block up">
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="size-8 rounded-[8px]" disabled={index === blocks.length - 1} onClick={() => commit(moveBlock(blocks, index, index + 1))} aria-label="Move block down">
                    <ChevronDown className="size-4" />
                  </Button>
                  <Button type="button" variant="outline" size="icon" className="size-8 rounded-[8px] text-red-600" onClick={() => removeBlock(block.id)} aria-label="Delete block">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              {block.type === 'paragraph' && (
                <ParagraphRichEditor
                  ref={(node) => {
                    if (node) {
                      editorRefs.current[block.id] = node;
                    } else {
                      delete editorRefs.current[block.id];
                    }
                  }}
                  block={block}
                  onChange={updateParagraphBlock}
                  onSelect={(selection) => updateSelection(block.id, selection)}
                  onStyleChange={(style) => updateTypingStyle(block.id, style)}
                />
              )}

              {block.type === 'image' && (
                <div className="grid gap-3">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <Input value={block.url} onChange={(event) => updateBlock(block.id, { url: event.target.value })} placeholder="Image URL" />
                    <label className={`flex h-10 min-w-[150px] cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-black/10 bg-white px-3 text-sm font-medium text-slate-600 transition-colors hover:border-[#0000FF]/30 hover:text-[#0000FF] ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
                      <UploadCloud className="size-4" />
                      {uploading ? 'Uploading...' : 'Upload image'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        disabled={uploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          handleImageUpload(file);
                        }}
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input value={block.alt} onChange={(event) => updateBlock(block.id, { alt: event.target.value })} placeholder="Alt text" />
                    <Input value={block.caption} onChange={(event) => updateBlock(block.id, { caption: event.target.value })} placeholder="Caption" />
                  </div>
                </div>
              )}

              {block.type === 'list' && (
                <div className="grid gap-3">
                  {(block.items || ['']).map((item, itemIndex) => (
                    <div key={`${block.id}-list-item-${itemIndex}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                      <span className="text-lg leading-none text-slate-500">*</span>
                      <Input
                        value={item}
                        onChange={(event) => updateListItem(block.id, itemIndex, event.target.value)}
                        placeholder={`List item ${itemIndex + 1}`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-10 rounded-[8px] text-red-600"
                        onClick={() => removeListItem(block, itemIndex)}
                        aria-label="Remove list item"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="w-fit rounded-[8px]" onClick={() => addListItem(block)}>
                    <Plus className="size-4" />
                    Add item
                  </Button>
                </div>
              )}

              {block.type === 'table' && (
                <div className="grid gap-3">
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="h-9 rounded-[8px]" onClick={() => addTableRow(block)}>
                      <Rows3 className="size-4" />
                      Row
                    </Button>
                    <Button type="button" variant="outline" className="h-9 rounded-[8px]" onClick={() => addTableColumn(block)}>
                      <Columns3 className="size-4" />
                      Column
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-[8px] border border-black/10">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="bg-slate-100">
                        <tr>
                          {block.header.map((cell, cellIndex) => (
                            <th key={`${block.id}-head-edit-${cellIndex}`} className="min-w-[140px] border-b border-r border-black/10 p-2 last:border-r-0">
                              <Input value={cell} onChange={(event) => updateTableCell({ blockId: block.id, area: 'header', cellIndex, value: event.target.value })} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {block.rows.map((row, rowIndex) => (
                          <tr key={`${block.id}-row-edit-${rowIndex}`}>
                            {row.map((cell, cellIndex) => (
                              <td key={`${block.id}-cell-edit-${rowIndex}-${cellIndex}`} className="min-w-[140px] border-b border-r border-black/10 p-2 last:border-r-0">
                                <Input value={cell} onChange={(event) => updateTableCell({ blockId: block.id, area: 'body', rowIndex, cellIndex, value: event.target.value })} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <Textarea value={tableImport} onChange={(event) => setTableImport(event.target.value)} placeholder="Paste tab-separated table data" />
                    <Button type="button" variant="outline" className="rounded-[8px]" onClick={() => applyTableImport(block)}>
                      <Plus className="size-4" />
                      Import
                    </Button>
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default LearningRichContentEditor;
