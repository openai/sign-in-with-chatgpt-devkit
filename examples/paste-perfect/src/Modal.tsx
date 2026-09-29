import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-label={title}>
    <div className="modal-content">
      <header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>
      {children}
    </div>
  </dialog>;
}
