import { createPortal } from 'react-dom';

/** Small building blocks shared by the pages, so every page looks and behaves the same. */

export const PageHeader = ({ title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
    <div>
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
      {subtitle && <p className="text-gray-500 mt-1 text-sm max-w-2xl">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>
);

export const Card = ({ className = '', children }) => (
  <div className={`bg-white border border-gray-200 rounded-xl shadow-sm ${className}`}>{children}</div>
);

// Rendered at the end of <body>, so no page layout can clip or shift it
export const Modal = (props) => createPortal(<ModalBox {...props} />, document.body);

const ModalBox = ({ title, subtitle, onClose, children, footer, wide = false }) => (
  <div className="fixed inset-0 bg-gray-900/50 flex items-center justify-center p-4 z-[80]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div role="dialog" aria-modal="true" aria-label={title}
      className={`bg-white rounded-xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] flex flex-col`}>
      <div className="px-6 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        )}
      </div>
      <div className="px-6 py-5 overflow-y-auto">{children}</div>
      {footer && <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl flex justify-end gap-2">{footer}</div>}
    </div>
  </div>
);

const TONES = {
  gray: 'bg-gray-100 text-gray-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  green: 'bg-green-100 text-green-700',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
};

export const Badge = ({ tone = 'gray', children, title }) => (
  <span title={title} className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${TONES[tone] || TONES.gray}`}>{children}</span>
);

export const Button = ({ variant = 'primary', className = '', ...props }) => {
  const styles = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
    secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
    danger: 'bg-white text-red-600 border border-red-200 hover:bg-red-50',
    ghost: 'text-gray-600 hover:bg-gray-100',
  };
  return (
    <button {...props}
      className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles[variant]} ${className}`} />
  );
};

export const Field = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-sm font-semibold text-gray-700 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
  </label>
);

export const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500';

export const EmptyState = ({ children }) => (
  <div className="p-10 text-center text-gray-500 border border-dashed border-gray-200 rounded-xl bg-white">{children}</div>
);

export const initials = (name) => (name || '?').replace(/\(.*?\)/g, '').split(' ').filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export const Avatar = ({ name, size = 'md' }) => (
  <div className={`${size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'} rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center flex-shrink-0`}>
    {initials(name)}
  </div>
);
