import React from 'react';
import { getLearningAssetUrl } from '@/lib/learningApi.js';
import { normalizeLearningRichBlocks } from '@/lib/learningRichContent.js';

const paragraphClassBySize = {
  small: 'text-sm leading-6 text-slate-600',
  normal: 'text-base leading-7 text-slate-700',
  large: 'text-lg leading-8 text-slate-700',
  heading: 'text-2xl font-semibold leading-tight text-slate-900',
};

const inlineClassBySize = {
  small: 'text-sm leading-6',
  normal: 'text-base leading-7',
  large: 'text-lg leading-8',
  heading: 'text-2xl leading-tight',
};

const getAssetUrl = (value) => getLearningAssetUrl(value) || String(value || '').trim();

const coverMetadataPattern = /^(cover|title|titel|author|autor|autorin|authors|edition|auflage|ausgabe|publisher|verlag|isbn|doi|copyright|version|stand|created|erstellt|date|datum)\s*[:\-|]/i;
const coverMetadataValuePattern = /^(isbn|doi)\s+/i;
const coverPagePattern = /^(cover page|deckblatt|titelblatt|book cover|pdf metadata)$/i;

const getBlockText = (block) => {
  if (block.type === 'list') {
    return (block.items || []).join('\n');
  }

  if (block.type !== 'paragraph') {
    return '';
  }

  if (Array.isArray(block.spans) && block.spans.length > 0) {
    return block.spans.map((span) => span.text).join('');
  }

  return block.text || '';
};

const isCoverMetadataBlock = (block) => {
  const lines = getBlockText(block)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0 || lines.length > 6) return false;

  return lines.every((line) =>
    coverMetadataPattern.test(line)
    || coverMetadataValuePattern.test(line)
    || coverPagePattern.test(line));
};

const stripLeadingCoverMetadata = (blocks) => {
  let contentStarted = false;

  return blocks.filter((block, index) => {
    if (contentStarted || index > 12) {
      contentStarted = true;
      return true;
    }

    if (isCoverMetadataBlock(block)) {
      return false;
    }

    contentStarted = true;
    return true;
  });
};

const LearningRichContentRenderer = ({
  blocks,
  fallbackText = '',
  className = '',
  compact = false,
}) => {
  const normalizedBlocks = stripLeadingCoverMetadata(
    normalizeLearningRichBlocks(blocks, fallbackText)
      .filter((block) => block.type !== 'paragraph' || block.text.trim()),
  );

  if (normalizedBlocks.length === 0) {
    return null;
  }

  return (
    <div className={`learning-rich-content ${compact ? 'space-y-4' : 'space-y-6'} ${className}`}>
      {normalizedBlocks.map((block) => {
        if (block.type === 'image') {
          const url = getAssetUrl(block.url);
          if (!url) return null;

          return (
            <figure key={block.id} className="overflow-hidden rounded-[8px] border border-black/10 bg-white">
              <img src={url} alt={block.alt || block.caption || ''} className="max-h-[620px] w-full object-contain" />
              {block.caption && (
                <figcaption className="border-t border-black/5 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {block.caption}
                </figcaption>
              )}
            </figure>
          );
        }

        if (block.type === 'table') {
          const hasHeader = block.header?.some((cell) => String(cell || '').trim());
          return (
            <div key={block.id} className="overflow-x-auto rounded-[8px] border border-black/10 bg-white">
              <table className="min-w-[640px] border-collapse text-left text-sm">
                {hasHeader && (
                  <thead className="bg-slate-100 text-slate-900">
                    <tr>
                      {block.header.map((cell, index) => (
                        <th key={`${block.id}-head-${index}`} className="border-b border-black/10 px-4 py-3 align-top font-semibold">
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${block.id}-row-${rowIndex}`} className="border-t border-black/5 first:border-t-0">
                      {row.map((cell, cellIndex) => (
                        <td key={`${block.id}-cell-${rowIndex}-${cellIndex}`} className="px-4 py-3 align-top text-slate-700">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === 'list') {
          const items = (block.items || []).filter((item) => String(item || '').trim());
          if (items.length === 0) return null;

          return (
            <section key={block.id} className="border-l-2 border-[#0000FF]/18 pl-5">
              <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-slate-700">
                {items.map((item, index) => (
                  <li key={`${block.id}-item-${index}`}>{item}</li>
                ))}
              </ul>
            </section>
          );
        }

        const spans = Array.isArray(block.spans) && block.spans.length > 0
          ? block.spans
          : [{ text: block.text, bold: block.bold, italic: block.italic, size: block.size }];
        const hasInlineFormatting = spans.length > 1
          || spans.some((span) => span.bold !== block.bold || span.italic !== block.italic || span.size !== block.size);
        const classNameForSize = paragraphClassBySize[block.size] || paragraphClassBySize.normal;
        return (
          <section key={block.id} className="border-l-2 border-[#0000FF]/18 pl-5">
            <p className={hasInlineFormatting ? 'text-base leading-8 text-slate-700' : `${classNameForSize} ${block.bold ? 'font-bold' : ''} ${block.italic ? 'italic' : ''}`}>
              {spans.map((span, index) => (
                <span
                  key={`${block.id}-span-${index}`}
                  className={`${inlineClassBySize[span.size] || inlineClassBySize.normal} ${span.bold ? 'font-bold text-slate-900' : ''} ${span.italic ? 'italic' : ''}`}
                >
                  {span.text}
                </span>
              ))}
            </p>
          </section>
        );
      })}
    </div>
  );
};

export default LearningRichContentRenderer;
