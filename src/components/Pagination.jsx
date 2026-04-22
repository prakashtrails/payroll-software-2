import React from 'react';

/**
 * Simple pagination bar. Renders nothing when there is only one page.
 *
 * @param {number}   page         - Current page (1-based)
 * @param {number}   totalPages   - Total number of pages
 * @param {number}   totalCount   - Total row count (shown as label)
 * @param {function} onPageChange - Called with the new page number
 */
export default function Pagination({ page, totalPages, totalCount, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  // Always show first, last, current ±1
  const show = new Set([1, totalPages, page, page - 1, page + 1].filter((p) => p >= 1 && p <= totalPages));
  const sorted = [...show].sort((a, b) => a - b);

  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) pages.push('...');
    pages.push(p);
    prev = p;
  }

  return (
    <div className="pagination">
      <button
        className="page-btn"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <i className="fas fa-chevron-left" />
      </button>

      {pages.map((p, i) =>
        p === '...'
          ? <span key={`dots-${i}`} className="page-dots">…</span>
          : (
            <button
              key={p}
              className={`page-btn${p === page ? ' active' : ''}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          )
      )}

      <button
        className="page-btn"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <i className="fas fa-chevron-right" />
      </button>

      {totalCount != null && (
        <span className="page-count">{totalCount} total</span>
      )}
    </div>
  );
}
