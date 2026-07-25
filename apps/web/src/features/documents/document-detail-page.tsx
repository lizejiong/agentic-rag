import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { useAuth } from '../auth/auth-provider';
import {
  deleteDocument,
  downloadDocument,
  getDocumentChunks,
  getDocumentContent,
  replaceFile,
  uploadFile,
  waitForImport,
  type DocumentChunk,
  type DocumentContent,
} from './documents-api';
import { useDocumentQuery } from './use-document-query';

const statusClass = (status: string): string => {
  if (['READY', 'SUCCEEDED', 'ACTIVE'].includes(status)) return 'status-ready';
  if (['FAILED', 'CANCELLED'].includes(status)) return 'status-failed';
  return 'status-pending';
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLocation(location: unknown): string {
  if (!location || typeof location !== 'object') return '-';
  const loc = location as Record<string, unknown>;
  const parts: string[] = [];
  if (loc.page != null) parts.push(`p${loc.page}`);
  if (loc.slide != null) parts.push(`slide ${loc.slide}`);
  if (loc.sheet) parts.push(String(loc.sheet));
  return parts.length > 0 ? parts.join(' ') : '-';
}

export function DocumentDetailPage() {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const document = useDocumentQuery(auth.authorizedFetch, documentId);

  const [contentView, setContentView] = useState<'hidden' | 'loading' | 'visible'>('hidden');
  const [documentContent, setDocumentContent] = useState<DocumentContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null);
  const [chunksLoading, setChunksLoading] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);

  const handleLoadChunks = async () => {
    setChunksLoading(true);
    try {
      const data = await getDocumentChunks(auth.authorizedFetch, documentId);
      setChunks(data);
    } catch {
      setContentError('CHUNK_LIST_LOAD_FAILED');
    } finally {
      setChunksLoading(false);
    }
  };

  const handleView = async () => {
    setContentView('loading');
    setContentError(null);
    try {
      const content = await getDocumentContent(auth.authorizedFetch, documentId);
      setDocumentContent(content);
      setContentView('visible');
    } catch (error: unknown) {
      setContentError(error instanceof Error ? error.message : 'DOCUMENT_CONTENT_LOAD_FAILED');
      setContentView('hidden');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('确定要删除此文档吗？删除后可从回收站恢复。')) return;
    const spaceId = document.data!.spaceId;
    setDeleting(true);
    try {
      await deleteDocument(auth.authorizedFetch, documentId);
      navigate(`/spaces/${spaceId}/documents`, { replace: true });
    } catch (error: unknown) {
      setContentError(
        error instanceof Error ? error.message : 'DOCUMENT_DELETE_FAILED',
      );
      setDeleting(false);
    }
  };

  const handleReplace = async (file: File) => {
    setReplacing(true);
    try {
      const ticket = await replaceFile(auth.authorizedFetch, documentId, {
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
      });
      const token = auth.getAccessToken() ?? (await auth.refreshAccessToken());
      if (!token) throw new Error('AUTH_SESSION_EXPIRED');
      await uploadFile(
        { clientFileId: crypto.randomUUID(), ...ticket },
        file,
        token,
        () => {},
      );
      await waitForImport(auth.authorizedFetch, ticket.importId);
      document.refetch();
    } catch (error: unknown) {
      setContentError(
        error instanceof Error ? error.message : 'FILE_REPLACE_FAILED',
      );
    } finally {
      setReplacing(false);
    }
  };

  const handleDownload = async () => {
    const currentVersion = document.data?.versions[0];
    if (!currentVersion) return;
    try {
      await downloadDocument(
        auth.authorizedFetch,
        documentId,
        currentVersion.originalFileName,
      );
    } catch (error: unknown) {
      setContentError(
        error instanceof Error ? error.message : 'DOCUMENT_DOWNLOAD_FAILED',
      );
    }
  };

  if (document.isPending) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <Link className="brand" to="/chat">
            <span className="brand-mark">A</span>
            <span>
              <strong>Atlas RAG</strong>
              <small>LOADING</small>
            </span>
          </Link>
        </header>
        <main className="documents-layout">
          <p>正在加载文档…</p>
        </main>
      </div>
    );
  }

  if (document.isError || !document.data) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <Link className="brand" to="/chat">
            <span className="brand-mark">A</span>
            <span>
              <strong>Atlas RAG</strong>
              <small>ERROR</small>
            </span>
          </Link>
        </header>
        <main className="documents-layout">
          <p role="alert">文档加载失败或文档不存在。</p>
          <Link to="/chat">返回首页</Link>
        </main>
      </div>
    );
  }

  const doc = document.data;
  const activeVersion = doc.versions[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/chat">
          <span className="brand-mark">A</span>
          <span>
            <strong>Atlas RAG</strong>
            <small>DOCUMENT</small>
          </span>
        </Link>
        <nav className="document-nav">
          <Link to={`/spaces/${doc.spaceId}/documents`}>返回文档列表</Link>
          <span>{auth.user?.username}</span>
        </nav>
      </header>

      <main className="documents-layout">
        <section className="document-detail-meta">
          <p className="eyebrow">DOCUMENT DETAIL</p>
          <h1>{doc.title}</h1>

          <div className="document-meta-grid">
            <div>
              <dt className="meta-label">类型</dt>
              <dd>
                <span
                  className={`document-type-badge document-type-badge--${doc.sourceType.toLowerCase()}`}
                >
                  {doc.sourceType}
                </span>
              </dd>
            </div>
            <div>
              <dt className="meta-label">状态</dt>
              <dd>{doc.availability}</dd>
            </div>
            {doc.createdBy ? (
              <div>
                <dt className="meta-label">上传人</dt>
                <dd>{doc.createdBy.username}</dd>
              </div>
            ) : null}
            <div>
              <dt className="meta-label">创建时间</dt>
              <dd>{new Date(doc.createdAt).toLocaleString('zh-CN')}</dd>
            </div>
            <div>
              <dt className="meta-label">更新时间</dt>
              <dd>{new Date(doc.updatedAt).toLocaleString('zh-CN')}</dd>
            </div>
          </div>

          <div className="document-actions">
            <button
              type="button"
              className="document-action-btn document-action-btn--view"
              disabled={contentView === 'loading'}
              onClick={() => void handleView()}
            >
              {contentView === 'loading' ? '加载中…' : '查看内容'}
            </button>
            <button
              type="button"
              className="document-action-btn document-action-btn--download"
              disabled={!activeVersion || activeVersion.processingStatus !== 'READY'}
              onClick={() => void handleDownload()}
            >
              下载原文件
            </button>
            <input
              ref={replaceInput}
              className="visually-hidden"
              type="file"
              accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.md,.csv,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleReplace(file);
              }}
            />
            <button
              type="button"
              className="document-action-btn document-action-btn--download"
              disabled={replacing}
              onClick={() => replaceInput.current?.click()}
            >
              {replacing ? '替换中…' : '替换文件'}
            </button>
            <button
              type="button"
              className="document-action-btn document-action-btn--delete"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? '删除中…' : '删除文档'}
            </button>
          </div>

          {contentError ? (
            <p role="alert" className="document-error">
              {contentError}
            </p>
          ) : null}

          {contentView === 'visible' && documentContent ? (
            <section className="document-content-view">
              <p className="content-meta">
                共 {documentContent.elementCount} 个元素
              </p>
              <pre>{documentContent.fullText}</pre>
            </section>
          ) : null}
        </section>

        <section className="document-detail-section">
          <h2>
            文本块（Chunks）
            {!chunks && chunksLoading === false ? (
              <button
                type="button"
                className="chunk-load-btn"
                onClick={() => void handleLoadChunks()}
              >
                加载
              </button>
            ) : null}
            {chunksLoading ? <span className="chunk-loading">加载中…</span> : null}
          </h2>
          {chunks && chunks.length === 0 ? (
            <p className="document-empty">暂无文本块。</p>
          ) : chunks ? (
            <div className="document-table-wrap">
              <table className="document-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>内容</th>
                    <th>Token</th>
                    <th>位置</th>
                  </tr>
                </thead>
                <tbody>
                  {chunks.map((chunk) => (
                    <tr key={chunk.id}>
                      <td>{chunk.index}</td>
                      <td className="chunk-content-cell">
                        {chunk.content.slice(0, 200)}
                        {chunk.content.length > 200 ? '…' : ''}
                      </td>
                      <td>{chunk.tokenCount}</td>
                      <td className="chunk-location-cell">
                        {formatLocation(chunk.location)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="document-detail-section">
          <h2>版本历史</h2>
          {doc.versions.length === 0 ? (
            <p className="document-empty">暂无版本记录。</p>
          ) : (
            <div className="document-table-wrap">
              <table className="document-table">
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>文件名</th>
                    <th>类型</th>
                    <th>大小</th>
                    <th>状态</th>
                    <th>发布时间</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.versions.map((v) => (
                    <tr key={v.id}>
                      <td>v{v.versionNumber}</td>
                      <td>{v.originalFileName}</td>
                      <td>{v.detectedMimeType ?? v.declaredMimeType}</td>
                      <td>{v.sizeBytes != null ? formatBytes(v.sizeBytes) : '-'}</td>
                      <td className={statusClass(v.processingStatus)}>
                        {v.processingStatus}
                      </td>
                      <td>
                        {v.publishedAt
                          ? new Date(v.publishedAt).toLocaleString('zh-CN')
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
