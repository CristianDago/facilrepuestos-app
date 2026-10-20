import { PAGE_SIZE_OPTIONS } from '../../hooks/usePagination';
import styles from './Pagination.module.css';

interface Props {
  page: number; totalPages: number; totalItems: number;
  pageSize: number; onPage: (p: number) => void; onPageSize: (s: number) => void;
}

export default function Pagination({ page, totalPages, totalItems, pageSize, onPage, onPageSize }: Props) {
  if (totalItems === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, totalItems);
  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }
  return (
    <div className={styles.wrap}>
      <span className={styles.info}>{from}–{to} de {totalItems}</span>
      <div className={styles.controls}>
        <button className={styles.btn} onClick={() => onPage(page - 1)} disabled={page === 1}>‹</button>
        {pages.map((p, i) => p === '...'
          ? <span key={`e${i}`} className={styles.ellipsis}>…</span>
          : <button key={p} className={`${styles.btn} ${p === page ? styles.active : ''}`} onClick={() => onPage(p as number)}>{p}</button>
        )}
        <button className={styles.btn} onClick={() => onPage(page + 1)} disabled={page === totalPages}>›</button>
      </div>
      <div className={styles.sizer}>
        <span>Por página</span>
        <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))}>
          {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
  );
}
