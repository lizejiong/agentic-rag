import { Link, Navigate, useParams } from 'react-router';

import { useAuth } from '../auth/auth-provider';
import { useSpacesQuery } from '../spaces/use-spaces-query';
import { DocumentUploadPanel } from './document-upload-panel';
import { useDocumentsQuery } from './use-documents-query';

export function DocumentListPage() {
  const { spaceId = '' } = useParams();
  const auth = useAuth();
  const spaces = useSpacesQuery(auth.authorizedFetch);
  const selectedSpace = spaces.data?.find((space) => space.id === spaceId);
  const documents = useDocumentsQuery(auth.authorizedFetch, spaceId);

  if (!spaceId) return <Navigate replace to="/chat" />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/chat">
          <span className="brand-mark">A</span>
          <span><strong>Atlas RAG</strong><small>DOCUMENTS</small></span>
        </Link>
        <nav className="document-nav">
          <Link to="/chat">返回问答</Link>
          <span>{auth.user?.username}</span>
        </nav>
      </header>
      <main className="documents-layout">
        <header className="documents-heading">
          <div>
            <p className="eyebrow">KNOWLEDGE BASE</p>
            <h1>{selectedSpace?.name ?? '文档管理'}</h1>
          </div>
          <select value={spaceId} onChange={(event) => { window.location.href = `/spaces/${event.target.value}/documents`; }}>
            {(spaces.data ?? []).map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}
          </select>
        </header>
        <DocumentUploadPanel
          spaceId={spaceId}
          fetcher={auth.authorizedFetch}
          getAccessToken={auth.getAccessToken}
          refreshAccessToken={auth.refreshAccessToken}
          onQueued={() => documents.refetch()}
        />
        <section className="document-list" aria-label="文档列表">
          {documents.isPending ? <p>正在加载文档…</p> : null}
          {documents.isError ? <p role="alert">文档列表加载失败。</p> : null}
          {documents.data?.length === 0 ? <p className="document-empty">这个空间还没有文档。</p> : null}
          {documents.data?.map((document) => (
            <article className="document-card" key={document.id}>
              <div>
                <h2>{document.title}</h2>
                <p>v{document.latestVersion?.versionNumber ?? 1} · {document.latestVersion?.processingStatus ?? 'PENDING_UPLOAD'}</p>
              </div>
              <div className="document-status">
                <strong>{document.latestImport?.progress ?? 0}%</strong>
                <span>{document.availability}</span>
              </div>
              {document.latestImport?.errorMessage ? <p role="alert">{document.latestImport.errorMessage}</p> : null}
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
