import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../auth/auth-provider';
import { useSpacesQuery } from '../spaces/use-spaces-query';
import type { Fetcher } from '../../shared/api/request-json';
import { createRequestHeaders } from '../../shared/api/request-json';

interface SearchTestResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  score: number;
  path: string;
  location: { page?: number; slide?: number; sheet?: string } | null;
}

interface SearchTestResponse {
  query: string;
  totalResults: number;
  results: SearchTestResult[];
}

async function runSearchTest(
  fetcher: Fetcher,
  query: string,
  spaceIds: string[],
): Promise<SearchTestResponse> {
  const response = await fetcher('/api/search-test', {
    method: 'POST',
    headers: { ...createRequestHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ query, spaceIds }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `SEARCH_TEST_HTTP_${response.status}`);
  }
  return response.json() as Promise<SearchTestResponse>;
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  const pct = Math.min((score / max) * 100, 100);
  return (
    <span className="score-bar">
      <span className="score-bar-fill" style={{ width: `${pct}%` }} />
      <span className="score-bar-label">{score.toFixed(3)}</span>
    </span>
  );
}

export function SearchTestPage() {
  const auth = useAuth();
  const spaces = useSpacesQuery(auth.authorizedFetch);
  const [selectedSpaceIds, setSelectedSpaceIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!query.trim() || selectedSpaceIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const data = await runSearchTest(auth.authorizedFetch, query, selectedSpaceIds);
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'SEARCH_FAILED');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/chat">
          <span className="brand-mark">A</span>
          <span>
            <strong>Atlas RAG</strong>
            <small>SEARCH TEST</small>
          </span>
        </Link>
        <nav className="document-nav">
          <Link to="/chat">返回问答</Link>
          <span>{auth.user?.username}</span>
        </nav>
      </header>
      <main className="documents-layout">
        <p className="eyebrow">RETRIEVAL DEBUG</p>
        <h1>检索测试台</h1>

        <div className="search-test-form">
          <input
            className="document-search"
            type="text"
            placeholder="输入测试查询…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch(); }}
          />
          <div className="search-test-spaces">
            {(spaces.data ?? []).map((space) => (
              <label key={space.id} className="search-test-space-option">
                <input
                  type="checkbox"
                  checked={selectedSpaceIds.includes(space.id)}
                  onChange={() =>
                    setSelectedSpaceIds((prev) =>
                      prev.includes(space.id)
                        ? prev.filter((id) => id !== space.id)
                        : [...prev, space.id],
                    )
                  }
                />
                {space.name}
              </label>
            ))}
          </div>
          <button
            type="button"
            className="upload-button"
            disabled={loading || !query.trim() || selectedSpaceIds.length === 0}
            onClick={() => void handleSearch()}
          >
            {loading ? '检索中…' : '测试检索'}
          </button>
        </div>

        {error ? <p role="alert" className="document-error">{error}</p> : null}

        {result ? (
          <section className="search-test-results">
            <p className="search-test-summary">
              「{result.query}」— {result.totalResults} 个结果
            </p>
            {result.results.length === 0 ? (
              <p className="document-empty">没有检索到结果。</p>
            ) : (
              <div className="search-test-list">
                {result.results.map((item) => (
                  <article className="search-test-card" key={item.chunkId}>
                    <div className="search-test-card-header">
                      <span className={`path-badge path-badge--${item.path}`}>
                        {item.path}
                      </span>
                      <ScoreBar score={item.score} max={1} />
                      <span className="search-test-doc">{item.documentTitle}</span>
                      {item.location?.page != null ? (
                        <span className="search-test-loc">p{item.location.page}</span>
                      ) : null}
                    </div>
                    <p className="search-test-content">{item.content}</p>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
