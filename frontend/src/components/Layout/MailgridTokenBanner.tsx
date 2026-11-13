import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMailgridReportStatus, MailgridTokenState } from '../../services/api';

/** Admin-only alert while the Mailgrid report token is missing or rejected; it clears after a successful run. */
export function MailgridTokenBanner() {
  const [state, setState] = useState<MailgridTokenState | null>(null);

  useEffect(() => {
    let active = true;
    getMailgridReportStatus().then((value) => { if (active) setState(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!state || state === 'configured') return null;
  return (
    <div role="alert" className="border-b border-amber-300 bg-amber-50">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm text-amber-900 sm:px-6 lg:px-8">
        <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        <p className="font-medium">Token do relatório Mailgrid inválido ou não configurado</p>
        <Link to="/settings/mailgrid-reports" className="rounded font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
          Ver configuração
        </Link>
      </div>
    </div>
  );
}
