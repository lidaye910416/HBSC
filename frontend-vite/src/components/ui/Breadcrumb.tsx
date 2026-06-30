import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import '../../components/Breadcrumb.css';

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[];
  variant?: 'dark' | 'light';
  className?: string;
}

export function Breadcrumb({
  items,
  variant = 'light',
  className,
}: BreadcrumbProps) {
  if (!items || items.length === 0) return null;

  const dedupedItems = items.reduce((acc: BreadcrumbItem[], item) => {
    const prev = acc[acc.length - 1];
    if (prev && prev.label === item.label) return acc;
    acc.push(item);
    return acc;
  }, []);

  if (dedupedItems.length === 0) return null;

  const classes = [
    'breadcrumb',
    `breadcrumb--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <nav className={classes} aria-label="面包屑" role="navigation">
      <ol>
        {dedupedItems.map((item, index) => {
          const isLast = index === dedupedItems.length - 1;
          const isCurrent = isLast || !item.to;
          return (
            <li key={`${item.label}-${index}`}>
              {isCurrent ? (
                <span className="breadcrumb__current" aria-current="page">
                  {item.label}
                </span>
              ) : (
                <Link to={item.to as string} className="breadcrumb__link">
                  {item.label}
                </Link>
              )}
              {!isLast && (
                <ChevronRight
                  size={12}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className="breadcrumb__separator"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumb;