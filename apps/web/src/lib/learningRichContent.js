export const LEARNING_RICH_TEXT_SIZES = ['small', 'normal', 'large', 'heading'];

export const createLearningRichContentId = () =>
  `block_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const createParagraphBlock = (overrides = {}) => ({
  id: createLearningRichContentId(),
  type: 'paragraph',
  text: '',
  spans: [],
  size: 'normal',
  bold: false,
  ...overrides,
});

export const createImageBlock = (overrides = {}) => ({
  id: createLearningRichContentId(),
  type: 'image',
  url: '',
  alt: '',
  caption: '',
  ...overrides,
});

export const createTableBlock = (overrides = {}) => ({
  id: createLearningRichContentId(),
  type: 'table',
  header: ['Header 1', 'Header 2'],
  rows: [
    ['Value 1', 'Value 2'],
    ['', ''],
  ],
  ...overrides,
});

export const createListBlock = (overrides = {}) => ({
  id: createLearningRichContentId(),
  type: 'list',
  items: ['First item', 'Second item'],
  ...overrides,
});

export const textContentToRichBlocks = (value) => {
  const blocks = String(value || '')
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => createParagraphBlock({
      id: `legacy_text_${index}`,
      text,
      size: index === 0 ? 'large' : 'normal',
    }));

  return blocks.length > 0 ? blocks : [createParagraphBlock()];
};

const normalizeTableRows = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map((row) => (Array.isArray(row) ? row : [])
      .map((cell) => String(cell || '').slice(0, 1000)))
    .filter((row) => row.length > 0)
    .slice(0, 50);

export const normalizeInlineSpans = (spans, fallbackText = '', fallback = {}) => {
  const source = Array.isArray(spans) && spans.length > 0
    ? spans
    : [{ text: fallbackText, bold: fallback.bold === true, size: fallback.size || 'normal' }];

  const normalized = source
    .map((span) => ({
      text: String(span?.text || '').slice(0, 12000),
      bold: span?.bold === true,
      size: LEARNING_RICH_TEXT_SIZES.includes(span?.size) ? span.size : 'normal',
    }))
    .filter((span) => span.text.length > 0);

  const merged = [];
  for (const span of normalized) {
    const previous = merged.at(-1);
    if (previous && previous.bold === span.bold && previous.size === span.size) {
      previous.text += span.text;
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
};

export const normalizeLearningRichBlocks = (blocks, fallbackText = '', { preserveEmpty = false } = {}) => {
  const source = Array.isArray(blocks) && blocks.length > 0
    ? blocks
    : textContentToRichBlocks(fallbackText);

  const normalized = source
    .map((block, index) => {
      const type = String(block?.type || '').trim();
      const id = String(block?.id || `learning_block_${index}`).trim();

      if (type === 'image') {
        return {
          id,
          type: 'image',
          url: String(block.url || '').trim(),
          alt: String(block.alt || '').trim(),
          caption: String(block.caption || '').trim(),
        };
      }

      if (type === 'table') {
        const header = (Array.isArray(block.header) ? block.header : [])
          .map((cell) => String(cell || '').slice(0, 1000))
          .slice(0, 12);
        const rows = normalizeTableRows(block.rows);
        return {
          id,
          type: 'table',
          header: header.length > 0 ? header : ['Header 1', 'Header 2'],
          rows: rows.length > 0 ? rows : [['', '']],
        };
      }

      if (type === 'list') {
        const items = (Array.isArray(block.items) ? block.items : [])
          .map((item) => String(item || '').slice(0, 1000))
          .filter((item) => item.trim())
          .slice(0, 50);
        return {
          id,
          type: 'list',
          items: items.length > 0 ? items : [''],
        };
      }

      const size = LEARNING_RICH_TEXT_SIZES.includes(block?.size) ? block.size : 'normal';
      const text = String(block?.text || '').slice(0, 12000);
      const spans = normalizeInlineSpans(block?.spans, text, {
        bold: block?.bold === true,
        size,
      });
      return {
        id,
        type: 'paragraph',
        text: spans.map((span) => span.text).join('') || text,
        spans,
        size,
        bold: block?.bold === true,
      };
    })
    .filter((block) => {
      if (preserveEmpty) return true;
      if (block.type === 'image') return Boolean(block.url);
      if (block.type === 'table') return block.header.length > 0 || block.rows.length > 0;
      if (block.type === 'list') return block.items.some((item) => String(item || '').trim());
      return Boolean(block.text.trim());
    });

  return normalized.length > 0 ? normalized : [createParagraphBlock()];
};

export const getLearningRichPlainText = (blocks) =>
  normalizeLearningRichBlocks(blocks)
    .map((block) => {
      if (block.type === 'image') {
        return [block.alt, block.caption].filter(Boolean).join(' ');
      }
      if (block.type === 'table') {
        return [
          ...(block.header || []),
          ...(block.rows || []).flat(),
        ].join(' ');
      }
      if (block.type === 'list') {
        return (block.items || []).join(' ');
      }
      return Array.isArray(block.spans) && block.spans.length > 0
        ? block.spans.map((span) => span.text).join('')
        : block.text;
    })
    .filter(Boolean)
    .join('\n\n');
